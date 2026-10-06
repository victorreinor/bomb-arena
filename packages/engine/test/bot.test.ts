import { describe, expect, test } from "bun:test";
import {
  BOMB_FUSE_TICKS,
  BOTS_ONLY_TICKS,
  BOT_LEVELS,
  CLASSIC,
  GHOST_THROW_COOLDOWN_TICKS,
  MAPS,
  PLAYER_RADIUS,
  mapSeats,
  TILE,
  TICK_RATE,
  blastCells,
  botInput,
  borderRing,
  canStart,
  createGame,
  createRoom,
  joinRoom,
  killPlayer,
  roomView,
  stepRoom,
  dangerMap,
  step,
  stepTowards,
  type BotLevel,
  type BotProfile,
  type Inputs,
} from "../src";
import { FLAWLESS, POCKETS, corridor, makeGame, pastCountdown, play, send, testBomb, testFlame } from "./helpers";

/** p1 in the middle of a corridor, standing on a bomb of its own. */
function onOwnBomb() {
  const s = makeGame(corridor("1.....2"));
  const p1 = s.players[0];
  p1.x = 3.5;
  testBomb(s, 3, 1, { owner: "p1" });
  p1.passing.push(s.bombs[0].id);
  p1.bombsActive = 1;
  return s;
}

describe("danger map", () => {
  test("marks the blast cross with the time left and stops at walls", () => {
    const s = makeGame(["#######", "#1...2#", "#.#.#.#", "#.....#", "#######"]);
    testBomb(s, 3, 1, { owner: "p1", ticksLeft: 40 });
    const d = dangerMap(s);
    const at = (x: number, y: number) => d[y * s.width + x];
    expect(at(3, 1)).toBe(40);
    expect(at(1, 1)).toBe(40);
    expect(at(3, 3)).toBe(40); // (3,2) is empty, so the blast goes on down to (3,3)
    expect(at(1, 3)).toBe(Infinity);
  });

  test("chain reactions inherit the earlier time", () => {
    const s = makeGame(["#########", "#1.....2#", "#########"]);
    testBomb(s, 2, 1, { owner: "p1", ticksLeft: 10 });
    testBomb(s, 4, 1, { owner: "p1", ticksLeft: 80 });
    const d = dangerMap(s);
    expect(d[1 * s.width + 6]).toBe(10); // reached by bomb 2, which bomb 1 sets off at tick 10
  });

  test("a bot's view of it can take a blast for shorter than it is, or miss that one bomb sets off another", () => {
    const s = makeGame(["#########", "#1.....2#", "#########"]);
    testBomb(s, 2, 1, { owner: "p1", ticksLeft: 10 });
    testBomb(s, 4, 1, { owner: "p1", ticksLeft: 80 });
    const at = (d: number[], x: number) => d[1 * s.width + x];
    expect(at(dangerMap(s, { chains: () => false }), 6)).toBe(80);
    const short = dangerMap(s, { reach: () => 1 }); // neither reaches the other now
    expect([at(short, 3), at(short, 5), at(short, 6)]).toEqual([10, 80, Infinity]);
  });
});

/** Three on a board, p1 and p2 against p3, each stood on the tile given (the test maps' own spawns only place two apart). */
function twoOnOne(rows: string[], tiles: [number, number][], friendlyFire = true) {
  const s = makeGame(rows, 3, 1, { friendlyFire, teams: [0, 0, 1] });
  s.players.forEach((p, i) => Object.assign(p, { x: tiles[i][0] + 0.5, y: tiles[i][1] + 0.5 }));
  return s;
}

/** p1 beside a brick worth a bomb, with a way out round the corner; p2 far off. */
const BRICK_BESIDE = ["#######", "#1+...#", "#.#.#.#", "#.....#", "#....2#", "#######"];

describe("bot", () => {
  test("bombs the brick next to it and gets out of the way", () => {
    const s = makeGame(BRICK_BESIDE);
    play(s, ["p1"], 200, FLAWLESS);
    expect(s.players[0].alive).toBe(true);
    expect(s.tiles[1 * s.width + 2]).toBe(TILE.EMPTY);
  });

  test("with remote bombs it gets clear of its own and sets it off, instead of waiting out the long fuse", () => {
    const s = makeGame(corridor("1.....+....2"));
    s.players[0].remote = true;
    play(s, ["p1"], 120, FLAWLESS); // the safety fuse alone takes 300
    expect(s.players[0].alive).toBe(true);
    expect(s.tiles[1 * s.width + 7]).toBe(TILE.EMPTY);
  });

  test("on a real map it clears bricks for a while without blowing itself up", () => {
    const s = createGame({ map: CLASSIC, seed: 11, players: [{ id: "bot", color: 0 }, { id: "idle", color: 1 }] });
    const bricksBefore = s.tiles.filter((t) => t === TILE.SOFT).length;
    play(s, ["bot"], 30 * TICK_RATE, FLAWLESS);
    expect(s.players[0].alive).toBe(true);
    expect(s.tiles.filter((t) => t === TILE.SOFT).length).toBeLessThan(bricksBefore - 5);
  });

  test.each(MAPS.map((m) => [m.id, m] as const))("a match of bots filling %s ends (sudden death guarantees it)", (_, map) => {
    const ids = ["a", "b", "c", "d"].slice(0, mapSeats(map));
    const s = createGame({
      map,
      seed: 5,
      timeLimitTicks: 60 * TICK_RATE,
      players: ids.map((id, i) => ({ id, color: i })),
    });
    play(s, ids, 4 * 60 * TICK_RATE);
    expect(s.phase).toBe("finished");
  });

  // They used to drop a bomb, run to safety, head back through the blast, run again... over and over;
  // or pace between two cells as their goal flipped. Other people's bombs they may be slow to see or get
  // wrong, so the blast check sticks to the bot's own, which it always knows about; and to steps it chose
  // to take: on ice a slide can carry it on against its will.
  test.each(MAPS.flatMap((m) => BOT_LEVELS.map((level) => [m.id, level, m] as const)))(
    "on %s, %s bots never walk into their own blast and never pace about with nothing going on",
    (_, level, map) => {
      const ids = ["a", "b", "c", "d"].slice(0, mapSeats(map));
      const s = createGame({ map, seed: 2, players: ids.map((id, i) => ({ id, color: i })) });
      const cellOf = (id: string) => {
        const p = s.players.find((o) => o.id === id)!;
        return Math.floor(p.y) * s.width + Math.floor(p.x);
      };
      const recent: Record<string, { cell: number; busy: boolean }[]> = Object.fromEntries(ids.map((id) => [id, []]));
      let walkedIn = 0;
      let paced = 0;
      for (let i = 0; i < 40 * TICK_RATE && s.phase === "playing"; i++) {
        const danger = dangerMap(s);
        const inputs: Inputs = {};
        for (const id of ids) inputs[id] = botInput(s, id, level);
        const alive = ids.filter((id) => s.players.find((o) => o.id === id)!.alive);
        const calm = alive.filter((id) => danger[cellOf(id)] === Infinity && !inputs[id]!.bomb);
        const own = new Map(
          calm.map((id) => [
            id,
            new Set([
              ...s.bombs.filter((b) => b.owner === id && !b.flight && !b.held).flatMap((b) => blastCells(s, b.x, b.y, b.range, b.pierce)),
              ...s.flames.filter((f) => f.owner === id).map((f) => f.y * s.width + f.x),
            ]),
          ]),
        );
        const from = new Map(alive.map((id) => [id, cellOf(id)]));
        step(s, inputs);
        const steered = (id: string) => {
          const to = cellOf(id) - from.get(id)!;
          if (Math.abs(to) !== 1 && Math.abs(to) !== s.width) return true; // came out of a portal: its choice too
          return Math.sign(inputs[id]!.dx ?? 0) === Math.sign(to % s.width) && Math.sign(inputs[id]!.dy ?? 0) === Math.sign(Math.trunc(to / s.width));
        };
        walkedIn += calm.filter((id) => cellOf(id) !== from.get(id) && own.get(id)!.has(cellOf(id)) && steered(id)).length;

        // pacing: back and forth between two cells, 6+ times in 3 s, with no bomb out, no danger, no curse
        for (const id of alive) {
          const p = s.players.find((o) => o.id === id)!;
          const h = recent[id];
          h.push({ cell: from.get(id)!, busy: p.bombsActive > 0 || danger[from.get(id)!] !== Infinity || !!p.disease });
          if (h.length > 3 * TICK_RATE) h.shift();
          const flips = h.filter((e, k) => k > 0 && e.cell !== h[k - 1].cell).length;
          if (h.length === 3 * TICK_RATE && !h.some((e) => e.busy) && new Set(h.map((e) => e.cell)).size === 2 && flips >= 6) {
            paced++;
            h.length = 0;
          }
        }
      }
      expect(walkedIn).toBe(0);
      expect(paced).toBe(0);
    },
  );

  test("it notices other people's bombs only after a moment, and sooner the harder it is", () => {
    const reactsAfter = (level: BotLevel) => {
      const s = makeGame(corridor("1.....2"), 2, 7);
      s.players[0].x = 3.5; // bot in the middle, p2's bomb right next to it
      testBomb(s, 4, 1, { ticksLeft: BOMB_FUSE_TICKS });
      for (let t = 0; t < 60; t++) {
        const input = botInput(s, "p1", level);
        if (input.dx !== 0) return t;
        step(s, { p1: input });
      }
      return Infinity;
    };
    const hard = reactsAfter("hard");
    const easy = reactsAfter("easy");
    expect(hard).toBeGreaterThan(0);
    expect(hard).toBeLessThan(easy);
    expect(easy).toBeLessThan(60);
  });

  // what makes a level easy or hard is how often it gets this wrong, not how fast it walks; and none gets it
  // right every time: they are pitched at people, who can't watch the whole board at once
  test("the easier the bot, the oftener a bomb laid at its side catches it, though there's a pocket to duck into", () => {
    const caught = (level: BotLevel | BotProfile) => {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const s = makeGame(POCKETS, 2, seed);
        testBomb(s, 11, 3, { ticksLeft: BOMB_FUSE_TICKS, range: 20 });
        play(s, ["p1"], BOMB_FUSE_TICKS + 5, level);
        if (!s.players[0].alive) n++;
      }
      return n;
    };
    const [easy, normal, hard] = BOT_LEVELS.map(caught);
    expect(caught(FLAWLESS)).toBe(0); // there is time to spare: whoever is caught wasn't looking, or froze
    expect(hard).toBeGreaterThan(5);
    expect(normal).toBeGreaterThan(hard);
    expect(easy).toBeGreaterThan(normal);
    expect(easy).toBeLessThan(40); // of 60: even the easy one gets away as often as not
  });

  test("the easier the bot, the longer it takes between bombs", () => {
    const laid = (level: BotLevel) => {
      let bombs = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const s = createGame({ map: CLASSIC, seed, players: [{ id: "bot", color: 0 }, { id: "idle", color: 1 }] });
        const first = s.nextBombId;
        play(s, ["bot"], 60 * TICK_RATE, level);
        bombs += s.nextBombId - first;
      }
      return bombs;
    };
    const [easy, normal, hard] = BOT_LEVELS.map(laid);
    expect(easy).toBeGreaterThan(12); // still at it: more than two a minute
    expect(normal).toBeGreaterThan(1.4 * easy);
    expect(hard).toBeGreaterThan(1.4 * normal);
  });

  test("someone within reach is worth a bomb only to a bot in the mood; bricks always are", () => {
    const minding: BotProfile = { ...FLAWLESS, pounces: 0, hunts: 0 }; // its own business
    const laid = (rows: string[], profile: BotProfile) => {
      const s = makeGame(rows);
      const first = s.nextBombId;
      play(s, ["p1"], 5 * TICK_RATE, profile);
      return s.nextBombId - first;
    };
    const together = corridor("1..2....");
    expect(laid(together, FLAWLESS)).toBeGreaterThan(0);
    expect(laid(together, minding)).toBe(0);
    expect(laid(BRICK_BESIDE, minding)).toBeGreaterThan(0);
  });

  // it used to press on through "Ready…": nothing came of it, but it took the bomb it never laid for dropped
  test("during the countdown it waits like everyone else, and is off as soon as it's over", () => {
    const s = makeGame(BRICK_BESIDE, 2, 1, { countdownTicks: 2 * TICK_RATE });
    for (let t = 0; t < 2 * TICK_RATE; t++) {
      expect(botInput(s, "p1", FLAWLESS)).toMatchObject({ dx: 0, dy: 0, bomb: false });
      step(s);
    }
    play(s, ["p1"], 5, FLAWLESS);
    expect(s.bombs).toHaveLength(1);
  });

  test("its own bomb it runs from at once", () => {
    expect(botInput(onOwnBomb(), "p1", "easy").dx).not.toBe(0);
  });

  test("under the reverse curse it pushes the other way, to still go where it means to", () => {
    const run = (cursed: boolean) => {
      const s = onOwnBomb();
      if (cursed) s.players[0].disease = { kind: "reverse", ticksLeft: 999 };
      play(s, ["p1"], 10, FLAWLESS);
      return s.players[0].x;
    };
    expect(run(true)).toBe(run(false));
    expect(run(true)).not.toBe(3.5);
  });

  // it faces its way out as it lays a bomb, and a line charge used to lay the row straight across it
  test("with a line charge it doesn't lay the row across its own way out", () => {
    const s = makeGame(BRICK_BESIDE);
    Object.assign(s.players[0], { bombsMax: 3, lineCharges: 1 });
    play(s, ["p1"], 200, FLAWLESS);
    expect(s.players[0].alive).toBe(true);
    expect(s.tiles[1 * s.width + 2]).toBe(TILE.EMPTY);
  });

  // rounding had a bot pressed against a wall "lining up" with a nudge sideways, which on ice is a slide all the way
  test("pressed flush against a wall it counts as lined up", () => {
    const s = makeGame(corridor("1....2"));
    const p = s.players[0];
    p.y = 1.5 + 0.5 - PLAYER_RADIUS;
    expect(stepTowards(p, 1 * s.width + 2, s.width)).toMatchObject({ dx: 1, dy: 0 });
  });

  // it used to want more time to spare than this, and stood waiting for the blast when it didn't have it
  test("with barely time to get off, it still makes a dash for the pocket", () => {
    const s = makeGame(["#############", "#####.1.#####", "#####.#.#####", "#############", "#.....2.....#", "#############"]);
    const bomb = testBomb(s, 6, 1, { ticksLeft: 24, range: 10 });
    s.players[0].passing.push(bomb.id);
    play(s, ["p1"], 60, FLAWLESS);
    expect(s.players[0].alive).toBe(true);
  });

  // so that when a level does blow itself up, it is one of the mistakes it was given and not a flaw underneath
  test("alone on a real map, a bot that makes no mistakes doesn't blow itself up", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = createGame({ map: CLASSIC, seed, players: [{ id: "bot", color: 0 }, { id: "idle", color: 1 }] });
      play(s, ["bot"], 45 * TICK_RATE, FLAWLESS);
      expect([seed, s.players[0].alive]).toEqual([seed, true]);
    }
  });

  // it used to stand there pressing the bomb key forever: no bomb may be laid inside a brick
  test("with wall-pass, a bot inside a brick goes and bombs from open floor", () => {
    const s = makeGame(["#########", "#1......#", "#.#.#.#.#", "#.+++...#", "#.#.#.#.#", "#......2#", "#########"]);
    Object.assign(s.players[0], { x: 3.5, y: 3.5, wallPass: true });
    const firstId = s.nextBombId;
    play(s, ["p1"], 5 * TICK_RATE);
    expect(s.nextBombId).toBeGreaterThan(firstId);
  });

  test("two bombing spots without a way out don't have the bot pacing between them", () => {
    // fire still burning on the only way out: neither (2,1) nor (3,1) is a safe place to drop a bomb
    const s = makeGame(["#######", "#..1+.#", "#.#+#.#", "#.....#", "#....2#", "#######"]);
    testFlame(s, 1, 1, { ticksLeft: 20 });
    testFlame(s, 1, 2, { ticksLeft: 20 });
    const cells = new Set<number>();
    for (let i = 0; i < 15; i++) {
      play(s, ["p1"], 1);
      cells.add(Math.floor(s.players[0].x));
    }
    expect([...cells]).toEqual([3]);
  });

  test("in a team match it goes after the other team and leaves its own alone", () => {
    // p2, at its side, is a team-mate; p3, across the corridor, is not
    const s = twoOnOne(corridor("12........3"), [[1, 1], [2, 1], [11, 1]]);
    const first = s.nextBombId;
    play(s, ["p1"], 2 * TICK_RATE, FLAWLESS);
    expect(s.nextBombId).toBe(first); // nothing laid on its team-mate
    expect(s.players[0].x).toBeGreaterThan(5); // and well on its way to p3
  });

  test("it doesn't lay a bomb that would catch a team-mate, unless friendly fire is off", () => {
    // a brick worth a bomb at p1's side and a way out below, with team-mate p2 standing in what would burn
    const laid = (friendlyFire: boolean) => {
      const s = twoOnOne(["#######", "#1+..3#", "#2#.#.#", "#.....#", "#######"], [[1, 1], [1, 2], [5, 1]], friendlyFire);
      const first = s.nextBombId;
      play(s, ["p1"], TICK_RATE, FLAWLESS);
      return s.nextBombId - first;
    };
    expect(laid(true)).toBe(0);
    expect(laid(false)).toBe(1);
  });

  test("a ghost bot takes aim at an enemy lined up below it, then lobs a bomb", () => {
    // a third player keeps the match going while p1 haunts it
    const s = makeGame(["#######", "#1....#", "#3....#", "#....2#", "#######"], 3);
    s.revenge = true;
    const ring = borderRing(s.width, s.height);
    const p1 = s.players[0];
    p1.alive = false;
    p1.ghost = { pos: ring.findIndex((t) => t.x === 5 && t.y === 0), moveTimer: 0, cooldown: 0 };
    let threwAt = -1;
    for (let t = 0; t < TICK_RATE && threwAt < 0; t++) {
      const input = botInput(s, "p1"); // p2 is in column 5
      if (input.bomb) threwAt = t;
      else expect(input.dx === 0 && input.dy === 0).toBe(true); // holds still while aiming
      step(s, { p1: input });
    }
    expect(threwAt).toBeGreaterThan(0);
    p1.ghost.cooldown = GHOST_THROW_COOLDOWN_TICKS;
    expect(botInput(s, "p1").bomb).toBe(false);
  });

  test("as a ghost it takes no aim at a team-mate", () => {
    // p2, lined up below, is on p1's side; p3 is over on the left
    const s = twoOnOne(["#######", "#1....#", "#3....#", "#....2#", "#######"], [[1, 1], [5, 3], [1, 2]]);
    s.revenge = true;
    const ring = borderRing(s.width, s.height);
    const p1 = s.players[0];
    p1.alive = false;
    p1.ghost = { pos: ring.findIndex((t) => t.x === 5 && t.y === 0), moveTimer: 0, cooldown: 0 };
    let threwFrom = -1;
    for (let t = 0; t < 2 * TICK_RATE && threwFrom < 0; t++) {
      const input = botInput(s, "p1", FLAWLESS);
      if (input.bomb) threwFrom = ring[p1.ghost.pos].x;
      step(s, { p1: input });
    }
    expect(threwFrom).toBe(1); // not from over p2: it went round to where p3 is lined up
  });
});

describe("bots in a room", () => {
  test("the host fills seats with bots, which count as ready", () => {
    const room = createRoom("BCDFG", 3);
    joinRoom(room, "u1", "Ana");
    expect(send(room, "u1", { t: "addBot" })).toBe(true);
    expect(send(room, "u1", { t: "addBot" })).toBe(true);
    expect(send(room, "u1", { t: "addBot" })).toBe(false); // room full
    expect(roomView(room).members.filter((m) => m.bot).map((m) => m.name)).toEqual(["Bot 1", "Bot 2"]);
    expect(canStart(room)).toBe(true); // one human + bots is enough
  });

  test("bots come in levels: normal unless the host picks another, and the host can change it", () => {
    const room = createRoom("BCDFG", 4);
    joinRoom(room, "u1", "Ana");
    joinRoom(room, "u2", "Bia");
    send(room, "u1", { t: "addBot", level: "hard" });
    send(room, "u1", { t: "addBot", level: "nonsense" as BotLevel });
    expect(roomView(room).members.map((m) => m.bot)).toEqual([null, null, "hard", "normal"]);
    expect(send(room, "u1", { t: "botLevel", id: "bot-1", level: "easy" })).toBe(true);
    expect(send(room, "u1", { t: "botLevel", id: "bot-1", level: "easy" })).toBe(false); // no change
    expect(send(room, "u2", { t: "botLevel", id: "bot-2", level: "easy" })).toBe(false); // not the host
    expect(send(room, "u1", { t: "botLevel", id: "u2", level: "easy" })).toBe(false); // not a bot
    expect(send(room, "u1", { t: "botLevel", id: "bot-2", level: "nonsense" as BotLevel })).toBe(false);
    expect(roomView(room).members.map((m) => m.bot)).toEqual([null, null, "easy", "normal"]);
  });

  test("only the host adds or removes bots", () => {
    const room = createRoom("BCDFG", 4);
    joinRoom(room, "u1", "Ana");
    joinRoom(room, "u2", "Bia");
    expect(send(room, "u2", { t: "addBot" })).toBe(false);
    send(room, "u1", { t: "addBot" });
    expect(send(room, "u2", { t: "removeBot", id: "bot-1" })).toBe(false);
    expect(send(room, "u1", { t: "removeBot", id: "u2" })).toBe(false); // not a bot
    expect(send(room, "u1", { t: "removeBot", id: "bot-1" })).toBe(true);
  });

  test("bots play the match on their own", () => {
    const room = createRoom("BCDFG", 2);
    joinRoom(room, "u1", "Ana");
    send(room, "u1", { t: "addBot" });
    send(room, "u1", { t: "start" });
    const bot = room.game!.players.find((p) => p.id === "bot-1")!;
    const start = { x: bot.x, y: bot.y };
    for (let i = 0; i < 5 * TICK_RATE; i++) stepRoom(room); // the countdown, then a moment to make up its mind
    expect(bot.x !== start.x || bot.y !== start.y || room.game!.bombs.length > 0).toBe(true);
  });

  test("once the last person is out, the room cuts the clock so the bots don't keep everyone waiting", () => {
    const room = createRoom("BCDFG", 3);
    joinRoom(room, "u1", "Ana");
    send(room, "u1", { t: "addBot" });
    send(room, "u1", { t: "addBot" });
    send(room, "u1", { t: "timeLimit", minutes: 0 });
    send(room, "u1", { t: "start" });
    pastCountdown(room);
    const game = room.game!;
    stepRoom(room);
    expect(game.timeLeft).toBeNull(); // Ana is still in it
    killPlayer(game, game.players.find((p) => p.id === "u1")!, "blast");
    stepRoom(room);
    expect(game.phase).toBe("playing");
    expect(game.timeLeft).toBeLessThanOrEqual(BOTS_ONLY_TICKS);
  });

  test("a bot is never the host, and bots leave with the last human", () => {
    const room = createRoom("BCDFG", 3);
    joinRoom(room, "u1", "Ana");
    send(room, "u1", { t: "addBot" });
    send(room, "u1", { t: "leave" });
    expect(room.members).toHaveLength(0);
    expect(room.hostId).toBeNull();
  });
});
