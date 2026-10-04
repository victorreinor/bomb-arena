import { ABILITY_FIELDS, TICK_RATE, type GameState } from "@bomberman/engine";

/**
 * Exactly what the HUD shows (allow-list), as a string. Screens re-render the HUD only when it
 * changes, so per-tick fields like positions or cooldowns never cause React work.
 */
export function hudKey(game: GameState, resultsIn = -1): string {
  const seconds = resultsIn > 0 ? Math.ceil(resultsIn / TICK_RATE) : -1;
  const clock = game.timeLeft === null ? -1 : Math.ceil(game.timeLeft / TICK_RATE);
  const players = game.players.map((p) =>
    [
      p.id,
      p.alive,
      !!p.ghost,
      p.color,
      p.bombsMax,
      p.range,
      p.speedLevel,
      p.lineCharges,
      p.pet?.kind,
      p.disease?.kind,
      ...Object.values(ABILITY_FIELDS).map((f) => p[f]),
    ].join(","),
  );
  return [game.phase, seconds, clock, ...players].join("|");
}
