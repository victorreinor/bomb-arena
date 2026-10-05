import { describe, expect, test } from "bun:test";
import {
  BELT_CARRY_TICKS,
  BELT_SPEED,
  BASE_SPEED,
  FLOOR,
  MAPS,
  PUSH_TICKS,
  TICK_RATE,
  TILE,
  VENT_PERIOD_TICKS,
  canPlaceAt,
  fromSnapshot,
  step,
  tileAt,
  toSnapshot,
  type GameState,
} from "../src";
import { corridor, makeGame, play, run, testBomb } from "./helpers";


describe("conveyor belts", () => {
  test("carry whoever stands on them; walking against one is slow going", () => {
    const s = makeGame(corridor("1>>>>>>>>.2"));
    s.players[0].x = 2.5;
    run(s, TICK_RATE);
    expect(s.players[0].x).toBeCloseTo(2.5 + BELT_SPEED, 5);

    const t = makeGame(corridor("1<<<<<<<<.2"));
    t.players[0].x = 2.5;
    run(t, TICK_RATE, { p1: { dx: 1 } });
    expect(t.players[0].x).toBeCloseTo(2.5 + BASE_SPEED - BELT_SPEED, 5);
  });

  test("don't push anyone through a wall", () => {
    const s = makeGame(corridor("1.>>>>#..2")); // the wall is at 7
    s.players[0].x = 3.5;
    run(s, 2 * TICK_RATE);
    expect(s.players[0].x).toBeLessThan(7 - 0.38 + 1e-6);
    expect(s.players[0].x).toBeGreaterThan(6.5);
  });

  test("move the bombs and items lying on them a tile at a time", () => {
    const s = makeGame(corridor("1.>>>>>>..2"));
    const bomb = testBomb(s, 3, 1);
    s.powerUps.push({ x: 5, y: 1, kind: "fire" });
    run(s, 2 * BELT_CARRY_TICKS);
    expect(bomb.x).toBe(5);
    expect(s.powerUps[0].x).toBe(7);
  });

  test("the board's floor goes over the wire with its tiles, and stays put in between", () => {
    const s = makeGame(corridor("1.>>>>..2"));
    const full = JSON.parse(JSON.stringify(toSnapshot(s, true)));
    expect(full.floor).toEqual(s.floor);
    const lean = toSnapshot(s, false);
    expect("floor" in lean).toBe(false);
    expect(fromSnapshot(lean, { tiles: s.tiles, floor: s.floor })!.floor).toBe(s.floor);
    expect(makeGame(corridor("1....2")).floor).toBeNull(); // plain maps carry none
  });
});

describe("ice", () => {
  test("once moving on ice there's no steering: the bomber slides on until something stops it", () => {
    const s = makeGame(corridor("1~~~~~#..2"));
    run(s, 10, { p1: { dx: 1 } }); // onto the ice
    for (let t = 0; t < 60 && s.players[0].moving; t++) {
      step(s, { p1: { dy: -1 } }); // pressing up does nothing while sliding
      expect([s.players[0].y, s.players[0].facing]).toEqual([1.5, "right"]);
    }
    expect(s.players[0].x).toBeCloseTo(7 - 0.38, 3); // up against the wall at 7
    // stopped, the controls work again
    run(s, 10, { p1: { dx: -1 } });
    expect(s.players[0].facing).toBe("left");
  });

  test("the slide ends where the ice does", () => {
    const s = makeGame(corridor("1~~~.....2"));
    run(s, 8, { p1: { dx: 1 } });
    run(s, 60);
    expect(Math.floor(s.players[0].x)).toBe(5);
    expect(s.players[0].moving).toBe(false);
  });

  test("standing still on ice stays still", () => {
    const s = makeGame(corridor("1~~~~~~..2"));
    s.players[0].x = 3.5;
    run(s, 30);
    expect(s.players[0].x).toBe(3.5);
  });
});

describe("portals", () => {
  test("stepping onto one puts the bomber on its other end, and walking on doesn't bring it back", () => {
    const s = makeGame(corridor("1A....A...2"));
    let lowest = Infinity;
    let teleported = false;
    for (let t = 0; t < 40; t++) {
      step(s, { p1: { dx: 1 } });
      if (s.players[0].x > 6) teleported = true;
      if (teleported) lowest = Math.min(lowest, s.players[0].x);
    }
    expect(teleported).toBe(true);
    expect(lowest).toBe(7.5); // came out in the middle of the far pad
    expect(s.players[0].x).toBeGreaterThan(8);
  });

  test("a kicked bomb goes in one end and slides on out of the other", () => {
    const s = makeGame(corridor("1..A..A....2"));
    s.players[0].kick = true;
    const bomb = testBomb(s, 3, 1);
    run(s, 40, { p1: { dx: 1 } });
    expect(bomb.x).toBe(11); // past the far pad at 7, up to p2 on 12
  });

  test("bots plan their way through them", () => {
    // the item is only reachable through the portal behind the bot, in a dead end it has no other reason to visit
    const s = makeGame(["#######", "#A1...#", "#######", "#..A.2#", "#######"]);
    s.powerUps.push({ x: 1, y: 3, kind: "fire" });
    play(s, ["p1"], 3 * TICK_RATE);
    expect(s.players[0].range).toBe(3);
  });

  test("on every map each portal has exactly one other end", () => {
    for (const map of MAPS) {
      const ends = new Map<string, number>();
      for (const ch of map.rows.join("")) if (ch >= "A" && ch <= "Z") ends.set(ch, (ends.get(ch) ?? 0) + 1);
      for (const [letter, n] of ends) expect([map.id, letter, n]).toEqual([map.id, letter, 2]);
    }
  });

  test("on every map each portal end has a tile beside it that's always clear, so nobody comes out walled in", () => {
    for (const map of MAPS) {
      map.rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch < "A" || ch > "Z") return;
          const beside = [map.rows[y - 1][x], map.rows[y + 1][x], row[x - 1], row[x + 1]];
          expect([map.id, x, y, beside.some((c) => !"#+o=".includes(c))]).toEqual([map.id, x, y, true]);
        }),
      );
    }
  });

  test("nobody can lay a bomb on one", () => {
    const s = makeGame(corridor("1A..A.2"));
    expect(canPlaceAt(s, 2, 1)).toBe(false);
    expect(s.floor![2 + s.width]).toBe(FLOOR.PORTAL);
  });
});

describe("crates", () => {
  test("leaning on one for a moment shoves it a tile; keep pushing and it keeps going", () => {
    const s = makeGame(corridor("1.=.....2"));
    run(s, 10 + PUSH_TICKS + 5, { p1: { dx: 1 } }); // about 10 ticks to reach it
    expect(tileAt(s, 3, 1)).toBe(TILE.EMPTY);
    expect(tileAt(s, 4, 1)).toBe(TILE.CRATE);
    run(s, 40, { p1: { dx: 1 } });
    expect(s.tiles.indexOf(TILE.CRATE) % s.width).toBeGreaterThan(5);
  });

  test("it won't move into a wall, a bomb or an item", () => {
    for (const [inner, setUp] of [
      ["1.=#...2", () => {}],
      ["1.=....2", (s: GameState) => void testBomb(s, 4, 1)],
      ["1.=....2", (s: GameState) => void s.powerUps.push({ x: 4, y: 1, kind: "bomb" })],
    ] as const) {
      const s = makeGame(corridor(inner));
      setUp(s);
      run(s, 60, { p1: { dx: 1 } });
      expect(tileAt(s, 3, 1)).toBe(TILE.CRATE);
    }
  });

  test("it stops blasts and doesn't burn", () => {
    const s = makeGame(corridor("1...=..2"));
    testBomb(s, 3, 1, { range: 3, ticksLeft: 1 });
    step(s);
    expect(tileAt(s, 5, 1)).toBe(TILE.CRATE);
    expect(s.flames.some((f) => f.x > 4)).toBe(false);
  });
});

describe("lava vents", () => {
  test("erupt every so often: fire nobody owns on each, and whoever stands there burns", () => {
    const s = makeGame(corridor("1.*...2"));
    s.players[0].x = 3.5;
    run(s, VENT_PERIOD_TICKS - 1);
    expect(s.flames).toHaveLength(0);
    step(s);
    expect(s.flames.map((f) => [f.x, f.owner])).toEqual([[3, ""]]);
    expect(s.players[0].death).toEqual({ how: "lava", by: null });
  });

  test("set off a bomb lying on them", () => {
    const s = makeGame(corridor("1..*..2"));
    testBomb(s, 4, 1, { ticksLeft: 1000 });
    run(s, VENT_PERIOD_TICKS);
    expect(s.bombs).toHaveLength(0);
  });

  test("bots get off a vent before it erupts", () => {
    // on the vent, right next to the enemy it hunts and with no bomb to lay: only the lava gets it moving
    const s = makeGame(corridor("1...*...2"));
    s.players[1].x = 5.5;
    s.players[0].x = 6.5;
    s.players[1].bombsMax = 0;
    run(s, VENT_PERIOD_TICKS - TICK_RATE); // a second to go
    play(s, ["p2"], TICK_RATE + 5);
    expect(s.players[1].alive).toBe(true);
  });
});
