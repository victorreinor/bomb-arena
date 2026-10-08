import { FALL_INTERVAL_TICKS, TICK_RATE, TILE, fallOrder, type GameState } from "@bomb-arena/engine";

/** How long before sudden death the warning goes up (banner, siren, blinking clock), in ticks. */
export const HURRY_WARN_TICKS = 10 * TICK_RATE;
/** How long the warning banner stays over the board, in ticks. */
export const HURRY_BANNER_TICKS = 2 * TICK_RATE;
/** The last this many seconds before sudden death are counted out, one beep and a big number each. */
export const HURRY_COUNT_SECONDS = 5;
/** How long before a block falls its shadow shows on the tile, in ticks. */
export const FALL_WARN_TICKS = TICK_RATE;

/** Whole seconds left on the clock, as the clock shows them. */
export const secondsLeft = (ticks: number) => Math.ceil(ticks / TICK_RATE);

/**
 * The tiles the next sudden-death blocks fall on within FALL_WARN_TICKS, with the ticks each has left. Blocks
 * drop on ticks that are a multiple of FALL_INTERVAL_TICKS, from the first one after the clock runs out, and
 * tiles that are already stone are skipped without taking a turn (as `suddenDeath` in the engine does).
 */
export function nextFalls(state: GameState): { x: number; y: number; ticks: number }[] {
  if (state.timeLeft === null || state.timeLeft > FALL_WARN_TICKS || state.phase !== "playing") return [];
  const first = (Math.floor((state.tick + state.timeLeft) / FALL_INTERVAL_TICKS) + 1) * FALL_INTERVAL_TICKS - state.tick;
  const order = fallOrder(state.width, state.height);
  const falls: { x: number; y: number; ticks: number }[] = [];
  for (let k = state.fallen; k < order.length; k++) {
    const i = order[k];
    if (state.tiles[i] === TILE.HARD) continue;
    const ticks = first + falls.length * FALL_INTERVAL_TICKS;
    if (ticks > FALL_WARN_TICKS) break;
    falls.push({ x: i % state.width, y: Math.floor(i / state.width), ticks });
  }
  return falls;
}
