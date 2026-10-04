import { describe, expect, test } from "bun:test";
import {
  BOMB_FUSE_TICKS,
  BOT_LEVELS,
  CLASSIC,
  GHOST_THROW_COOLDOWN_TICKS,
  MAPS,
  mapSeats,
  TILE,
  TICK_RATE,
  botInput,
  borderRing,
  canStart,
  createGame,
  createRoom,
  joinRoom,
  roomView,
  stepRoom,
  dangerMap,
  step,
  type BotLevel,
  type GameState,
  type Inputs,
} from "../src";
import { corridor, makeGame, send, testBomb, testFlame } from "./helpers";

/** Runs a game where the listed ids are bots and everyone else stands still. */
function play(s: GameState, bots: string[], ticks: number, level?: BotLevel) {
  for (let i = 0; i < ticks && s.phase === "playing"; i++) {
    const inputs: Inputs = {};
    for (const id of bots) inputs[id] = botInput(s, id, level);
    step(s, inputs);
  }
}

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
});

describe("bot", () => {
  test("bombs the brick next to it and gets out of the way", () => {
    const s = makeGame(["#######", "#1+...#", "#.#.#.#", "#.....#", "#....2#", "#######"]);
    play(s, ["p1"], 200);
    expect(s.players[0].alive).toBe(true);
    expect(s.tiles[1 * s.width + 2]).toBe(TILE.EMPTY);
  });

  test("with remote bombs it gets clear of its own and sets it off, instead of waiting out the long fuse", () => {
    const s = makeGame(corridor("1.....+....2"));
    s.players[0].remote = true;
    play(s, ["p1"], 120); // the safety fuse alone takes 300
    expect(s.players[0].alive).toBe(true);
    expect(s.tiles[1 * s.width + 7]).toBe(TILE.EMPTY);
  });

  test("on a real map it clears bricks for a while without blowing itself up", () => {
    const s = createGame({ map: CLASSIC, seed: 11, players: [{ id: "bot", color: 0 }, { id: "idle", color: 1 }] });
    const bricksBefore = s.tiles.filter((t) => t === TILE.SOFT).length;
    play(s, ["bot"], 30 * TICK_RATE);
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
  // or pace between two cells as their goal flipped. Other people's bombs take a moment to be noticed,
  // so the blast check sticks to the bot's own bombs, which it always knows about.
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
        const own = new Map(calm.map((id) => [id, dangerMap(s, (b) => b.owner === id)]));
        const from = new Map(alive.map((id) => [id, cellOf(id)]));
        step(s, inputs);
        walkedIn += calm.filter((id) => cellOf(id) !== from.get(id) && own.get(id)![cellOf(id)] !== Infinity).length;

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

  test("its own bomb it runs from at once", () => {
    expect(botInput(onOwnBomb(), "p1", "easy").dx).not.toBe(0);
  });

  test("under the reverse curse it pushes the other way, to still go where it means to", () => {
    const run = (cursed: boolean) => {
      const s = onOwnBomb();
      if (cursed) s.players[0].disease = { kind: "reverse", ticksLeft: 999 };
      play(s, ["p1"], 10, "hard");
      return s.players[0].x;
    };
    expect(run(true)).toBe(run(false));
    expect(run(true)).not.toBe(3.5);
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
    for (let i = 0; i < 3 * TICK_RATE; i++) stepRoom(room);
    expect(bot.x !== start.x || bot.y !== start.y || room.game!.bombs.length > 0).toBe(true);
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
