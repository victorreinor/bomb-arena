import { describe, expect, test } from "bun:test";
import { CLASSIC, FALL_INTERVAL_TICKS, TILE, createGame, fallOrder, step, type GameState, type MapDef } from "../src";
import { run, testBomb } from "./helpers";

/** 5x3 inner arena; the spiral fills the outer ring of it first and the centre (3,2) almost last. */
function game(timeLimitTicks: number | null, revenge = false): GameState {
  const rows = ["#######", "#1....#", "#.....#", "#....2#", "#######"];
  const map: MapDef = { id: "t", name: "t", rows, softDensity: 0 };
  return createGame({ map, seed: 1, revenge, timeLimitTicks, players: [{ id: "p1", color: 0 }, { id: "p2", color: 1 }] });
}

/** Move p1 off the first cell of the spiral so the match keeps going. */
const p1ToCentre = (s: GameState) => Object.assign(s.players[0], { x: 3.5, y: 2.5 });

describe("fall order", () => {
  test("covers every inner cell exactly once, outer ring first", () => {
    const order = fallOrder(15, 13);
    expect(order).toHaveLength(13 * 11);
    expect(new Set(order).size).toBe(order.length);
    expect(order[0]).toBe(1 * 15 + 1); // top-left inner corner
    const ring = 2 * 13 + 2 * 9; // 13 wide, 11 tall
    for (const i of order.slice(0, ring)) {
      const x = i % 15;
      const y = Math.floor(i / 15);
      expect(x === 1 || x === 13 || y === 1 || y === 11).toBe(true);
    }
  });
});

describe("sudden death", () => {
  test("without a time limit nothing ever falls", () => {
    const s = game(null);
    run(s, 500);
    expect(s.fallen).toBe(0);
  });

  test("the clock counts down, then blocks drop one every few ticks", () => {
    const s = game(10);
    p1ToCentre(s);
    run(s, 10);
    expect(s.timeLeft).toBe(0);
    expect(s.fallen).toBe(0);
    run(s, FALL_INTERVAL_TICKS * 3);
    expect(s.fallen).toBeGreaterThanOrEqual(2);
    const first = fallOrder(s.width, s.height)[0];
    expect(s.tiles[first]).toBe(TILE.HARD);
  });

  test("a falling block crushes whoever stands on its cell, pet or vest notwithstanding", () => {
    const s = game(0);
    const p = s.players[0]; // at (1,1): the first cell of the spiral
    p.pet = { kind: "runner", cooldown: 0, dashTicks: 0 };
    p.vest = true;
    run(s, FALL_INTERVAL_TICKS + 1);
    expect(p.alive).toBe(false);
    expect(s.phase).toBe("finished");
    expect(s.winner).toBe("p2");
  });

  test("in revenge mode the crushed come back as ghosts", () => {
    const s = game(0, true);
    run(s, FALL_INTERVAL_TICKS + 1);
    expect(s.players[0].ghost).not.toBeNull();
  });

  test("bombs and items under a falling block are destroyed and the owner gets the bomb back", () => {
    const s = game(0);
    p1ToCentre(s);
    const p2 = s.players[1];
    testBomb(s, 2, 1, { ticksLeft: 999 });
    p2.bombsActive = 1;
    s.powerUps.push({ x: 3, y: 1, kind: "fire" });
    run(s, FALL_INTERVAL_TICKS * 4);
    expect(s.bombs).toHaveLength(0);
    expect(p2.bombsActive).toBe(0);
    expect(s.powerUps).toHaveLength(0);
  });

  test("someone brushing the cell from next door is nudged free instead of getting stuck", () => {
    const s = game(0);
    s.players[0].x = 1.5;
    s.players[0].y = 2.5;
    s.players[1].x = 2.5; // centre on (2,2) but leaning into (2,1)
    s.players[1].y = 2.3;
    // pre-fill so the next block to fall is (2,1)
    s.fallen = 1;
    s.tiles[1 * s.width + 1] = TILE.HARD;
    run(s, FALL_INTERVAL_TICKS + 1);
    expect(s.tiles[1 * s.width + 2]).toBe(TILE.HARD);
    expect(s.players[1].alive).toBe(true);
    expect(s.players[1].y).toBe(2.5);
  });

  test("real maps: the whole arena eventually fills and the match ends", () => {
    const s = createGame({ map: CLASSIC, seed: 3, timeLimitTicks: 0, players: [{ id: "a", color: 0 }, { id: "b", color: 1 }] });
    run(s, fallOrder(s.width, s.height).length * FALL_INTERVAL_TICKS + 10);
    expect(s.phase).toBe("finished");
  });
});
