import { describe, expect, test } from "bun:test";
import { MAX_RANGE, step, type GameState } from "@bomberman/engine";
import { corridor, makeGame, testBomb, testFlame } from "../../../packages/engine/test/helpers";
import { diffGame } from "../src/game/events";

/** p1 one step short of an item at (3, 1), walking onto it over the next few ticks: the states before and after. */
function walkOnto(kind: GameState["powerUps"][number]["kind"], setUp: (s: GameState) => void = () => {}) {
  const s = makeGame(corridor("1.....2"));
  s.players[0].x = 2.8;
  s.powerUps.push({ x: 3, y: 1, kind });
  setUp(s);
  const before = structuredClone(s);
  for (let i = 0; i < 3; i++) step(s, { p1: { dx: 1 } });
  return { before, after: s };
}

describe("diffGame: items", () => {
  test("taking an item makes a pickup, even when it adds nothing (fire already at its maximum)", () => {
    const { before, after } = walkOnto("fire", (s) => (s.players[0].range = MAX_RANGE));
    expect(after.powerUps).toHaveLength(0);
    expect(diffGame(before, after).filter((e) => e.type === "pickup")).toEqual([{ type: "pickup", id: "p1", x: after.players[0].x, y: 1.5, kind: "fire" }]);
  });

  test("an item that burns is not a pickup, even with someone standing there", () => {
    const s = makeGame(corridor("1.....2"));
    s.powerUps.push({ x: 1, y: 1, kind: "bomb" });
    s.players[0].invuln = 10;
    const before = structuredClone(s);
    testFlame(s, 1, 1);
    s.powerUps = [];
    s.tick++;
    expect(diffGame(before, s).filter((e) => e.type === "pickup")).toEqual([]);
  });

  test("a skull already cursed with one gives a new curse: that is announced too", () => {
    const { before, after } = walkOnto("skull", (s) => (s.players[0].disease = { kind: "shortRange", ticksLeft: 100 }));
    expect(diffGame(before, after).filter((e) => e.type === "infected" || e.type === "pickup")).toEqual([{ type: "infected", id: "p1", x: after.players[0].x, y: 1.5 }]);
  });

  test("a first skull is announced once, as a curse", () => {
    const { before, after } = walkOnto("skull");
    expect(diffGame(before, after).filter((e) => e.type === "infected" || e.type === "pickup")).toHaveLength(1);
  });

  test("an item taken out of sight (snapshots skipped and the bomber walked on) still counts if it improved something", () => {
    const { before, after } = walkOnto("bomb");
    after.players[0].x = 4.5;
    expect(diffGame(before, after).filter((e) => e.type === "pickup").map((e) => e.type === "pickup" && e.kind)).toEqual(["bomb"]);
  });
});

describe("diffGame: new bombs", () => {
  test("a rubber bomb bouncing off a wall makes a bounce, heading back", () => {
    const s = makeGame(corridor("1...#.2"));
    testBomb(s, 4, 1, { rubber: true, slide: "right", slideTimer: 1 }); // the wall is at 5
    const before = structuredClone(s);
    step(s);
    expect(diffGame(before, s).filter((e) => e.type === "bounce")).toEqual([{ type: "bounce", x: 4, y: 1, dir: "left" }]);
  });

  test("picking up a mine is a pickup of a mine", () => {
    const { before, after } = walkOnto("mine");
    expect(diffGame(before, after).filter((e) => e.type === "pickup").map((e) => e.type === "pickup" && e.kind)).toEqual(["mine"]);
  });
});
