import { describe, expect, test } from "bun:test";
import { TICK_RATE, TILE, step, type GameState } from "@bomb-arena/engine";
import { makeGame } from "../../../packages/engine/test/helpers";
import { diffGame, type GameEvent } from "../src/game/events";
import { FALL_WARN_TICKS, HURRY_WARN_TICKS, nextFalls } from "../src/game/hurry";

/** Open floor with stone pillars (which the falling blocks skip) and both bombers in the middle, the last to be reached. */
const ARENA = ["#########", "#.......#", "#.#.#.#.#", "#.......#", "#.#1#2#.#", "#.......#", "#.#.#.#.#", "#.......#", "#########"];

/** Steps `s` until `until` holds, gathering what diffGame makes of each tick. */
function playOn(s: GameState, until: (s: GameState) => boolean): GameEvent[] {
  const events: GameEvent[] = [];
  while (!until(s)) {
    const prev = structuredClone(s);
    step(s);
    events.push(...diffGame(prev, s));
  }
  return events;
}

describe("sudden death on its way", () => {
  test("the warning, the last seconds counted out and sudden death itself come once each, in order", () => {
    const s = makeGame(ARENA, 2, 1, { timeLimitTicks: HURRY_WARN_TICKS + 2 * TICK_RATE });
    const events = playOn(s, (s) => s.timeLeft === 0 && s.fallen > 0);
    const hurry = events.flatMap((e) =>
      e.type === "hurrySoon" || e.type === "hurry" ? [e.type] : e.type === "hurryCount" ? [`${e.type} ${e.seconds}`] : [],
    );
    expect(hurry).toEqual(["hurrySoon", "hurryCount 5", "hurryCount 4", "hurryCount 3", "hurryCount 2", "hurryCount 1", "hurry"]);
  });

  test("a clock that starts inside the warning skips it, but still counts out the last seconds", () => {
    const s = makeGame(ARENA, 2, 1, { timeLimitTicks: 3 * TICK_RATE });
    const events = playOn(s, (s) => s.timeLeft === 0);
    expect(events.filter((e) => e.type === "hurrySoon")).toHaveLength(0);
    expect(events.filter((e) => e.type === "hurryCount")).toMatchObject([{ seconds: 2 }, { seconds: 1 }]);
  });

  test("the shadows foretell where and on which tick each block falls, from before the clock runs out", () => {
    const s = makeGame(ARENA, 2, 1, { timeLimitTicks: 2 * TICK_RATE });
    /** tile index -> the tick its block was foretold to fall on */
    const foretold = new Map<number, number>();
    let early = false;
    let falls = 0;
    while (s.phase === "playing") {
      for (const f of nextFalls(s)) {
        expect(f.ticks).toBeLessThanOrEqual(FALL_WARN_TICKS);
        const i = f.y * s.width + f.x;
        const when = s.tick + f.ticks;
        expect(foretold.get(i) ?? when).toBe(when); // never changes its mind
        foretold.set(i, when);
        if (s.timeLeft! > 0) early = true;
      }
      const prev = structuredClone(s);
      step(s);
      s.tiles.forEach((t, i) => {
        if (t !== TILE.HARD || prev.tiles[i] === TILE.HARD) return;
        expect(foretold.get(i)).toBe(s.tick);
        falls++;
      });
    }
    expect(falls).toBeGreaterThan(10);
    expect(early).toBe(true);
  });
});
