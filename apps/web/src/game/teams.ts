import type { CSSProperties } from "react";
import { sameTeam, type GameState, type RoomResult } from "@bomb-arena/engine";

/** What the two sides of a team match are called, and the colour that marks each on the board and in the lists. */
export const TEAM_NAMES = ["Time A", "Time B"];
export const TEAM_CSS = ["#35d6ff", "#ff5fd2"];

/** Sets the `--team` colour the stylesheet paints a team's things with (a card's edge, a list's heading). */
export const teamStyle = (team: number) => ({ "--team": TEAM_CSS[team] }) as CSSProperties;

/** Who won, as the lobby and the podium say it: the team and who was on it, or just the winner; null on a draw. */
export const victorLabel = (result: RoomResult) =>
  result.winnerTeam != null ? `${TEAM_NAMES[result.winnerTeam]} (${result.winnerName})` : result.winnerName;

/**
 * The tags over the bombers as a match starts, for whoever plays `me`: "VOCÊ" and, in a team match,
 * "ALIADO" over each team-mate (whose buried mines are then drawn too: see `render`).
 */
export function startTags(game: GameState, me: string): Record<string, string> {
  const self = game.players.find((p) => p.id === me);
  if (!self) return {};
  const tags: Record<string, string> = { [me]: "VOCÊ" };
  for (const p of game.players) if (p.id !== me && sameTeam(p, self)) tags[p.id] = "ALIADO";
  return tags;
}
