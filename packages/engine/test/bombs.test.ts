import { describe, expect, test } from "bun:test";
import {
  BOMB_FUSE_TICKS,
  MAX_MINE_CHARGES,
  MINE_ARM_TICKS,
  MINE_FUSE_TICKS,
  TILE,
  blastCells,
  bombAt,
  canPlaceAt,
  groundBombAt,
  isBuried,
  solidFor,
  tileAt,
  step,
  type GameState,
} from "../src";
import { corridor, makeGame, play, run, testBomb } from "./helpers";

const burning = (s: GameState) => s.flames.map((f) => f.x).sort((a, b) => a - b);

describe("pierce bomb", () => {
  test("its blast goes through bricks, breaking every one within reach", () => {
    const s = makeGame(corridor("1.+++......2"));
    testBomb(s, 6, 1, { pierce: true, range: 3, ticksLeft: 1 });
    step(s);
    expect([3, 4, 5].map((x) => tileAt(s, x, 1))).toEqual([TILE.EMPTY, TILE.EMPTY, TILE.EMPTY]);
    expect(burning(s)).toEqual([3, 4, 5, 6, 7, 8, 9]);

    // a plain one only breaks the first
    const t = makeGame(corridor("1.+++......2"));
    testBomb(t, 6, 1, { range: 3, ticksLeft: 1 });
    step(t);
    expect([3, 4, 5].map((x) => tileAt(t, x, 1))).toEqual([TILE.SOFT, TILE.SOFT, TILE.EMPTY]);
  });

  test("stone still stops it, and so does a bomb (which goes off too)", () => {
    const s = makeGame(corridor("1.#+.......2"));
    testBomb(s, 6, 1, { pierce: true, range: 5, ticksLeft: 1 });
    testBomb(s, 8, 1, { range: 1 });
    step(s);
    expect(tileAt(s, 4, 1)).toBe(TILE.EMPTY);
    expect(burning(s)).toEqual([4, 5, 6, 7, 8, 9]); // not the stone at 3; 9 is the second bomb's blast
    expect(s.bombs).toHaveLength(0);
  });

  test("blastCells sees through bricks for it, so bots know where it reaches", () => {
    const s = makeGame(corridor("1.+++......2"));
    const xs = (cells: number[]) => cells.map((c) => c % s.width).sort((a, b) => a - b);
    expect(xs(blastCells(s, 6, 1, 3, true))).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(xs(blastCells(s, 6, 1, 3))).toEqual([5, 6, 7, 8, 9]);
  });

  test("an owner of the item lays piercing bombs; a ghost's bombs never are", () => {
    const s = makeGame(corridor("1.....2"), 2, 1, { revenge: true });
    s.players[0].pierceBomb = true;
    s.players[0].rubberBomb = true;
    step(s, { p1: { bomb: true } });
    expect([s.bombs[0].pierce, s.bombs[0].rubber]).toEqual([true, true]);
  });
});

describe("rubber bomb", () => {
  test("kicked into a wall it bounces back, and stops when it comes back to someone", () => {
    const s = makeGame(corridor("1......#.2"));
    s.players[0].kick = true;
    const bomb = testBomb(s, 3, 1, { rubber: true });
    let furthest = 0;
    for (let t = 0; t < 60; t++) {
      step(s, t < 12 ? { p1: { dx: 1 } } : {}); // walk into it, then stand there
      furthest = Math.max(furthest, bomb.x);
    }
    expect(furthest).toBe(7); // up to the wall at 8
    // back to the tile just past its kicker, who stands overlapping tile 3
    expect(Math.floor(s.players[0].x + 0.5)).toBe(3);
    expect([bomb.x, bomb.slide]).toEqual([4, null]);
  });

  test("boxed in between two walls it stops rather than shake", () => {
    const s = makeGame(corridor("1#.#....2"));
    const bomb = testBomb(s, 3, 1, { rubber: true, slide: "right", slideTimer: 1 });
    run(s, 10);
    expect([bomb.x, bomb.slide]).toEqual([3, null]);
  });
});

describe("mine", () => {
  test("mines stack up to three; the next bomb laid is one, with a long fuse", () => {
    const s = makeGame(corridor("1.....2"));
    for (const x of [2, 3, 4, 5]) s.powerUps.push({ x, y: 1, kind: "mine" });
    run(s, 40, { p1: { dx: 1 } });
    expect(s.players[0].mineCharges).toBe(MAX_MINE_CHARGES);
    step(s, { p1: { bomb: true } });
    expect(s.bombs[0]).toMatchObject({ mine: true, remote: false, ticksLeft: MINE_FUSE_TICKS - 1 }); // a tick of it gone already
    expect(s.players[0].mineCharges).toBe(MAX_MINE_CHARGES - 1);
  });

  test("it lies in the open for a moment, then buries itself: nobody bumps into it any more", () => {
    const s = makeGame(corridor("1.....2"));
    const mine = testBomb(s, 3, 1, { owner: "p1", mine: true, ticksLeft: MINE_FUSE_TICKS });
    expect(bombAt(s, 3, 1)).toBe(mine);
    run(s, MINE_ARM_TICKS);
    expect(isBuried(mine)).toBe(true);
    expect(bombAt(s, 3, 1)).toBeUndefined();
    expect(groundBombAt(s, 3, 1)).toBe(mine);
    expect(solidFor(s, s.players[1], 3, 1)).toBe(false);
    expect(canPlaceAt(s, 3, 1)).toBe(false); // but nothing can be laid on top of it
  });

  test("its owner walks over it; an opponent stepping on it sets it off", () => {
    const s = makeGame(corridor("1.........2"));
    const mine = testBomb(s, 3, 1, { owner: "p1", mine: true, range: 2, ticksLeft: MINE_FUSE_TICKS - MINE_ARM_TICKS });
    run(s, 45, { p1: { dx: 1 } });
    expect(s.players[0].x).toBeGreaterThan(6);
    expect(s.bombs).toEqual([mine]);

    s.players[1].x = 4.5;
    run(s, 15, { p2: { dx: -1 } });
    expect(s.bombs).toHaveLength(0);
    expect(s.players[1].death).toEqual({ how: "blast", by: "p1" });
    expect(s.players[0].alive).toBe(true);
  });

  test("left alone it goes off when its long fuse runs out", () => {
    const s = makeGame(corridor("1.........2"));
    testBomb(s, 5, 1, { owner: "p1", mine: true, ticksLeft: MINE_FUSE_TICKS });
    run(s, MINE_FUSE_TICKS - 1);
    expect(s.bombs).toHaveLength(1);
    step(s);
    expect(s.bombs).toHaveLength(0);
    expect(s.flames.length).toBeGreaterThan(0);
  });

  test("a kicked bomb that runs into a buried mine stops and sets it off", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[0].kick = true;
    const mine = testBomb(s, 7, 1, { owner: "p2", mine: true, range: 1, ticksLeft: MINE_FUSE_TICKS - MINE_ARM_TICKS });
    const kicked = testBomb(s, 3, 1, { owner: "p1", range: 1 });
    run(s, 12, { p1: { dx: 1 } });
    run(s, 15);
    expect(s.bombs).not.toContain(mine);
    expect(s.bombs).not.toContain(kicked); // caught in the mine's blast, a tile away
  });

  test("bots don't see other people's buried mines (and walk onto them), but keep clear of their own", () => {
    const lure = (owner: string) => {
      const s = makeGame(corridor("1.........2"));
      testBomb(s, 6, 1, { owner, mine: true, range: 2, ticksLeft: MINE_FUSE_TICKS - MINE_ARM_TICKS });
      play(s, ["p2"], 150);
      return s.players[1];
    };
    expect(lure("p1").death).toEqual({ how: "blast", by: "p1" }); // went after p1, over the mine
    const careful = lure("p2");
    expect(careful.alive).toBe(true);
    expect(careful.x).toBeGreaterThan(8.5); // never into its own mine's reach (4 to 8)
  });

  test("a bot with mines lays them like bombs, keeps clear and lives on", () => {
    const s = makeGame(corridor("1.....+....2"));
    s.players[0].mineCharges = MAX_MINE_CHARGES;
    play(s, ["p1"], MINE_FUSE_TICKS + 60);
    expect(s.players[0].mineCharges).toBeLessThan(MAX_MINE_CHARGES);
    expect(s.players[0].alive).toBe(true);
    expect(tileAt(s, 7, 1)).toBe(TILE.EMPTY);
  });

  test("never set off by its own kind of trouble: a remote press skips it", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[0].remote = true;
    s.players[0].mineCharges = 1;
    step(s, { p1: { bomb: true } });
    run(s, 5, { p1: { action: true } });
    expect(s.bombs).toHaveLength(1);
    expect(s.bombs[0].ticksLeft).toBeGreaterThan(BOMB_FUSE_TICKS);
  });
});
