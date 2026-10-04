import { createGame, step, type GameState, type Inputs, type MapDef } from "../src";

/** Build a state from ASCII rows; `.` empty, `#` hard, `+` soft, digits spawn. */
export function makeGame(rows: string[], playerCount = 2, seed = 1): GameState {
  const map: MapDef = { id: "test", name: "test", rows, softDensity: 0 };
  return createGame({
    map,
    seed,
    players: Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, color: i })),
  });
}

/** Advance `ticks` steps with the same inputs every tick. */
export function run(s: GameState, ticks: number, inputs: Inputs = {}) {
  for (let i = 0; i < ticks; i++) step(s, inputs);
}
