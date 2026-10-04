import type { CSSProperties } from "react";
import { computeRanking, type GameState } from "@bomberman/engine";
import { COLOR_NAMES } from "./colors";

export interface PodiumEntry {
  id: string;
  name: string;
  color: number;
  place: number;
}

/** Podium rows for a finished match. */
export function podiumEntries(game: GameState, nameOf: (id: string) => string): PodiumEntry[] {
  return computeRanking(game).map(({ id, place }) => ({
    id,
    place,
    name: nameOf(id),
    color: game.players.find((p) => p.id === id)!.color,
  }));
}

const BLOCK_HEIGHT: Record<number, number> = { 1: 130, 2: 98, 3: 72, 4: 52 };

/** Classic podium order: 2nd on the left, 1st in the middle, then 3rd and 4th. */
function arrange(entries: PodiumEntry[]): PodiumEntry[] {
  const s = [...entries].sort((a, b) => a.place - b.place);
  if (s.length <= 1) return s;
  return [s[1], s[0], ...s.slice(2)];
}

/** The winner celebrates; everybody else sobs. Ties share a place (and the happy face). */
export function Podium({ entries }: { entries: PodiumEntry[] }) {
  return (
    <div className="podium" role="list" aria-label="Classificação final">
      {arrange(entries).map((e, i) => {
        const happy = e.place === 1;
        return (
          <div key={e.id} className="podium-col" role="listitem" style={{ "--i": i } as CSSProperties}>
            <div className="podium-name" title={e.name}>
              {e.name}
            </div>
            <div className="podium-char">
              {happy && <span className="crown" aria-hidden>👑</span>}
              <span
                className={`emote ${happy ? "happy" : "sad"}`}
                role="img"
                aria-label={`${COLOR_NAMES[e.color]} ${happy ? "feliz" : "chorando"}`}
                style={{ backgroundImage: `url(/sprites/bomber-emotes-${e.color}.png)` }}
              />
            </div>
            <div className={`podium-block place-${Math.min(e.place, 4)}`} style={{ height: BLOCK_HEIGHT[Math.min(e.place, 4)] }}>
              {e.place}º
            </div>
          </div>
        );
      })}
    </div>
  );
}
