/** mulberry32 — tiny deterministic PRNG whose whole state is a single uint32 */
export function nextRandom(state: { rng: number }): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** One element of a (non-empty) list, drawn with this generator. */
export function pickRandom<T>(state: { rng: number }, list: readonly T[]): T {
  return list[Math.floor(nextRandom(state) * list.length)];
}

/** A fresh random 32-bit seed for a new match. */
export function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}
