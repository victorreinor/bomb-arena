import { TICK_RATE, type GameState, type RoomView } from "@bomberman/engine";

export const bestOfLabel = (n: number) => (n === 1 ? "Partidas avulsas" : `Melhor de ${n}`);
export const timeLimitLabel = (minutes: number) => (minutes === 0 ? "Sem limite" : `${minutes} min`);

/** The running score is worth showing once there is a series, or someone has won something. */
export const showsScore = (room: RoomView) => room.bestOf > 1 || room.members.some((m) => m.score > 0);

/** The match clock; once it runs out, a sudden-death warning. */
export function MatchTimer({ game }: { game: GameState }) {
  if (game.timeLeft === null || game.phase !== "playing") return null;
  if (game.timeLeft === 0) return <div className="match-timer hurry">SUDDEN DEATH!</div>;
  const seconds = Math.ceil(game.timeLeft / TICK_RATE);
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <div className={`match-timer${seconds <= 10 ? " soon" : ""}`}>⏱ {text}</div>;
}
