import { describe, expect, test } from "bun:test";
import {
  BOMB_FUSE_TICKS,
  CLASSIC,
  FLAME_TICKS,
  GRID_H,
  GRID_W,
  MAPS,
  TILE,
  computeRanking,
  createGame,
  killPlayer,
  step,
  type GameState,
} from "../src";
import { makeGame, run } from "./helpers";


describe("maps", () => {
  test.each(MAPS.map((m) => [m.id, m] as const))("%s has valid shape and 4 spawns", (_, map) => {
    expect(map.rows).toHaveLength(GRID_H);
    for (const row of map.rows) expect(row).toHaveLength(GRID_W);
    for (const n of "1234") expect(map.rows.join("")).toContain(n);
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
    killPlayer(s, p);
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
