import { describe, expect, test } from "bun:test";
import {
  BOMB_FUSE_TICKS,
  CLASSIC,
  DUEL,
  FACEOFF,
  FLAME_TICKS,
  GRID_H,
  GRID_W,
  MAPS,
  mapSeats,
  PLAYER_RADIUS,
  TILE,
  computeRanking,
  countingDown,
  createGame,
  killPlayer,
  knockoutsBy,
  step,
  type GameState,
} from "../src";
import { corridor, makeGame, run, testBomb } from "./helpers";


describe("maps", () => {
  test.each(MAPS.map((m) => [m.id, m] as const))("%s is a walled rectangle with spawns in its corners", (_, map) => {
    const w = map.rows[0].length;
    const h = map.rows.length;
    for (const row of map.rows) expect(row).toHaveLength(w);
    expect(map.rows[0]).toBe("#".repeat(w));
    expect(map.rows[h - 1]).toBe("#".repeat(w));
    for (const row of map.rows) expect(row[0] + row[w - 1]).toBe("##");
    const corners = { "1": [1, 1], "2": [w - 2, 1], "3": [1, h - 2], "4": [w - 2, h - 2] };
    const spawns = [...map.rows.join("")].filter((c) => c >= "1" && c <= "9");
    expect([2, 4]).toContain(mapSeats(map));
    for (const n of spawns) {
      const [x, y] = corners[n as keyof typeof corners];
      expect(map.rows[y][x]).toBe(n);
    }
  });

  test("the big maps are 15x13 for four; the one-on-one maps are smaller, with two spawns in opposite corners", () => {
    for (const map of MAPS.filter((m) => mapSeats(m) === 4)) expect([map.rows[0].length, map.rows.length]).toEqual([GRID_W, GRID_H]);
    expect([DUEL.rows[0].length, DUEL.rows.length]).toEqual([11, 9]);
    expect([FACEOFF.rows[0].length, FACEOFF.rows.length]).toEqual([13, 11]);
    for (const map of [DUEL, FACEOFF]) {
      expect(mapSeats(map)).toBe(2);
      const s = createGame({ map, seed: 3, players: [{ id: "a", color: 0 }, { id: "b", color: 1 }] });
      expect(s.players.map((p) => [p.x, p.y])).toEqual([[1.5, 1.5], [s.width - 1.5, s.height - 1.5]]);
    }
  });

  test("classic keeps spawn corners clear", () => {
    const s = createGame({
      map: CLASSIC,
      seed: 7,
      players: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, color: n - 1 })),
    });
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [13, 1], [12, 1], [13, 2], [1, 11], [2, 11], [1, 10], [13, 11], [12, 11], [13, 10]]) {
      expect(s.tiles[y * s.width + x]).toBe(TILE.EMPTY);
    }
  });

  test("same seed gives the same map", () => {
    const mk = (seed: number) => createGame({ map: CLASSIC, seed, players: [{ id: "a", color: 0 }] }).tiles;
    expect(mk(5)).toEqual(mk(5));
    expect(mk(5)).not.toEqual(mk(6));
  });
});

describe("bombs", () => {
  const open = ["#########", "#1.....2#", "#.......#", "#########"];

  test("explodes after the fuse and leaves flames for FLAME_TICKS", () => {
    const s = makeGame(open);
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(1);
    run(s, 30, { p1: { dx: 1 } }); // walk out of the blast
    run(s, BOMB_FUSE_TICKS - 32);
    expect(s.bombs).toHaveLength(1);
    step(s);
    expect(s.bombs).toHaveLength(0);
    expect(s.flames.length).toBeGreaterThan(0);
    run(s, FLAME_TICKS);
    expect(s.flames).toHaveLength(0);
  });

  test("respects the bomb limit and frees a slot after exploding", () => {
    const s = makeGame(open);
    step(s, { p1: { bomb: true } });
    step(s, { p1: { dx: 1 } });
    run(s, 10, { p1: { dx: 1 } });
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(1);
    run(s, BOMB_FUSE_TICKS);
    expect(s.players[0].bombsActive).toBe(0);
  });

  test("flames stop at hard blocks and destroy only the first soft block", () => {
    const s = makeGame(["#########", "#1.+++.2#", "#########"], 2);
    s.players[0].range = 5;
    step(s, { p1: { bomb: true } });
    run(s, BOMB_FUSE_TICKS);
    expect(s.tiles[1 * s.width + 3]).toBe(TILE.EMPTY);
    expect(s.tiles[1 * s.width + 4]).toBe(TILE.SOFT);
    expect(s.flames.some((f) => f.x === 4)).toBe(false);
  });

  test("chain reaction detonates neighbouring bombs in the same tick", () => {
    const s = makeGame(["#########", "#1.....2#", "#########"], 2);
    s.players[0].bombsMax = 2;
    step(s, { p1: { bomb: true } });
    run(s, 10, { p1: { dx: 1 } });
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(2);
    s.bombs[0].ticksLeft = 1; // the first bomb goes off, second still has a long fuse
    step(s);
    expect(s.bombs).toHaveLength(0);
  });

  test("everyone caught in the blast means a draw", () => {
    const s = makeGame(["#########", "#1.2....#", "#########"], 2);
    step(s, { p1: { bomb: true } });
    run(s, BOMB_FUSE_TICKS, { p1: { dx: -1 } }); // p1 stays against the wall, p2 sits 2 tiles away
    expect(s.players.map((p) => p.alive)).toEqual([false, false]);
    expect(s.phase).toBe("finished");
    expect(s.winner).toBeNull();
  });

  test("the survivor wins", () => {
    const s = makeGame(["#########", "#1.....2#", "#########"], 2);
    step(s, { p1: { bomb: true } });
    run(s, BOMB_FUSE_TICKS, { p1: { dx: -1 } });
    expect(s.players[0].alive).toBe(false);
    expect(s.players[1].alive).toBe(true);
    expect(s.phase).toBe("finished");
    expect(s.winner).toBe("p2");
    run(s, FLAME_TICKS);
    expect(s.flames).toHaveLength(0);
  });

  test("cannot place on an existing bomb or on a flame", () => {
    const s = makeGame(open);
    step(s, { p1: { bomb: true } });
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(1);
  });
});

describe("movement", () => {
  test("cannot walk through walls or leave the arena", () => {
    const s = makeGame(["#####", "#1.2#", "#####"], 2);
    run(s, 60, { p1: { dx: -1 } });
    expect(s.players[0].x).toBeGreaterThanOrEqual(1.5 - 0.12);
    run(s, 60, { p1: { dy: -1 } });
    expect(s.players[0].y).toBeGreaterThanOrEqual(1.5 - 0.12 - 1e-3);
    expect(s.players[0].y).toBeLessThanOrEqual(1.5);
  });

  test("player can leave its own freshly placed bomb but cannot walk back in", () => {
    const s = makeGame(["#########", "#1.....2#", "#########"], 2);
    step(s, { p1: { bomb: true } });
    run(s, 30, { p1: { dx: 1 } });
    expect(s.players[0].x).toBeGreaterThan(2.9);
    const x = s.players[0].x;
    run(s, 30, { p1: { dx: -1 } });
    expect(s.players[0].x).toBeGreaterThan(2.3);
    expect(s.players[0].x).toBeLessThanOrEqual(x);
  });

  test("someone only brushing the tile a bomb is laid on is held back from it, not let through", () => {
    const s = makeGame(corridor("1........2"));
    const [p1, p2] = s.players;
    testBomb(s, 1, 1); // p2's own bomb behind them: the new one shuts them in
    p1.x = 3.5;
    p2.x = 2.7; // centre on (2,1), shoulder already over (3,1), walking on to the right
    step(s, { p1: { bomb: true }, p2: { dx: 1 } });
    expect(p2.x).toBeLessThanOrEqual(3 - PLAYER_RADIUS);
    run(s, 30, { p2: { dx: 1 } });
    expect(p2.x).toBeLessThanOrEqual(3 - PLAYER_RADIUS);
    expect(p2.passing).toEqual([]);
  });

  test("someone standing on the tile a bomb is laid on may walk off it, either way", () => {
    const s = makeGame(corridor("1........2"));
    const [p1, p2] = s.players;
    p1.x = 3.5;
    p2.x = 3.3; // centre on (3,1)
    step(s, { p1: { bomb: true }, p2: { dx: 1 } });
    run(s, 20, { p2: { dx: 1 } });
    expect(p2.x).toBeGreaterThan(4 + PLAYER_RADIUS);
  });

  test("slides around a corner when slightly misaligned", () => {
    const s = makeGame(["#####", "#1..#", "#.#.#", "#.#2#", "#####"], 2);
    s.players[0].x = 1.5;
    s.players[0].y = 1.8; // slightly low, pushing right into the corridor at row 1
    run(s, 20, { p1: { dx: 1 } });
    expect(s.players[0].x).toBeGreaterThan(2.5);
  });
});

describe("power-ups", () => {
  test("picking up bomb/fire/speed upgrades the player", () => {
    const s = makeGame(["#########", "#1.....2#", "#########"], 2);
    s.powerUps.push({ x: 2, y: 1, kind: "bomb" }, { x: 3, y: 1, kind: "fire" }, { x: 4, y: 1, kind: "speed" });
    run(s, 40, { p1: { dx: 1 } });
    const p = s.players[0];
    expect(p.bombsMax).toBe(2);
    expect(p.range).toBe(3);
    expect(p.speedLevel).toBe(1);
    expect(s.powerUps).toHaveLength(0);
  });

  test("flames destroy power-ups lying on the floor but not ones freshly dropped", () => {
    const s = makeGame(["#########", "#1..+..2#", "#########"], 2);
    s.powerUps.push({ x: 2, y: 1, kind: "bomb" });
    s.players[0].x = 3.5;
    step(s, { p1: { bomb: true } });
    run(s, BOMB_FUSE_TICKS);
    expect(s.powerUps.find((u) => u.x === 2)).toBeUndefined();
  });
});

describe("determinism", () => {
  test("identical inputs produce identical states", () => {
    const mk = () => createGame({ map: CLASSIC, seed: 42, players: [{ id: "a", color: 0 }, { id: "b", color: 1 }] });
    const a = mk();
    const b = mk();
    for (let i = 0; i < 400; i++) {
      const inputs = { a: { dx: i % 40 < 20 ? 1 : 0, dy: i % 40 >= 20 ? 1 : 0, bomb: i % 50 === 0 } };
      step(a, inputs);
      step(b, inputs);
    }
    expect(a).toEqual(b);
  });
});

describe("ranking", () => {
  const killAt = (s: GameState, id: string, tick: number) => {
    const p = s.players.find((o) => o.id === id)!;
    s.tick = tick;
    killPlayer(s, p, "blast");
  };

  test("survivor first, then by how long each lasted", () => {
    const s = makeGame(["#########", "#1.2.3.4#", "#########"], 4);
    killAt(s, "p2", 10);
    killAt(s, "p3", 30);
    killAt(s, "p4", 20);
    expect(computeRanking(s)).toEqual([
      { id: "p1", place: 1 },
      { id: "p3", place: 2 },
      { id: "p4", place: 3 },
      { id: "p2", place: 4 },
    ]);
  });

  test("players who fall on the same tick share a place", () => {
    const s = makeGame(["#########", "#1.2.3.4#", "#########"], 4);
    killAt(s, "p1", 50);
    killAt(s, "p2", 50);
    killAt(s, "p3", 20);
    killAt(s, "p4", 20);
    expect(computeRanking(s).map((r) => r.place)).toEqual([1, 1, 3, 3]);
  });

  test("a mutual knock-out is a shared first place", () => {
    const s = makeGame(["#########", "#1.2....#", "#########"], 2);
    step(s, { p1: { bomb: true } });
    for (let i = 0; i < BOMB_FUSE_TICKS; i++) step(s, { p1: { dx: -1 } });
    expect(s.players.every((p) => !p.alive)).toBe(true);
    expect(computeRanking(s).map((r) => r.place)).toEqual([1, 1]);
  });
});

describe("ready… go", () => {
  test("until the countdown is over nobody moves or drops a bomb, and the clock waits", () => {
    const s = makeGame(corridor("1....2"), 2, 1, { countdownTicks: 10, timeLimitTicks: 100 });
    run(s, 10, { p1: { dx: 1, bomb: true } });
    expect(countingDown(s)).toBe(true);
    expect(s.players[0].x).toBe(1.5);
    expect(s.bombs).toHaveLength(0);
    expect(s.timeLeft).toBe(100);
    step(s, { p1: { dx: 1 } });
    expect(countingDown(s)).toBe(false);
    expect(s.players[0].x).toBeGreaterThan(1.5);
    expect(s.timeLeft).toBe(99);
  });
});

describe("who knocked out whom", () => {
  test("a blast is credited to the bomb's owner, a bomber caught in their own included", () => {
    const s = makeGame(corridor("1...2"));
    testBomb(s, 2, 1, { owner: "p2", ticksLeft: 1, range: 3 });
    step(s);
    expect(s.players.map((p) => p.death)).toEqual([
      { how: "blast", by: "p2" },
      { how: "blast", by: "p2" },
    ]);
    expect(knockoutsBy(s, "p2")).toBe(1); // their own doesn't count
    expect(knockoutsBy(s, "p1")).toBe(0);
  });

  test("a chain reaction is credited to whoever's bomb the flame came from", () => {
    const s = makeGame(corridor("1.....2"));
    testBomb(s, 2, 1, { owner: "p1", ticksLeft: 1, range: 2 }); // sets off p2's bomb at x=4...
    testBomb(s, 4, 1, { owner: "p2", ticksLeft: 200, range: 3 }); // ...whose blast reaches p2 at x=6
    s.players[0].invuln = 99; // p1 sits this one out
    step(s);
    expect(s.players[1].death).toEqual({ how: "blast", by: "p2" });
  });
});
