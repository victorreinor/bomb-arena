import type { CSSProperties } from "react";
import { computeRanking, knockoutsBy, type GameState } from "@bomberman/engine";
import { COLOR_NAMES } from "./colors";

interface PodiumEntry {
  id: string;
  name: string;
  color: number;
  place: number;
  /** others they knocked out */
  kills: number;
}

/** Podium rows for a finished match. */
function podiumEntries(game: GameState, nameOf: (id: string) => string): PodiumEntry[] {
  return computeRanking(game).map(({ id, place }) => ({
    id,
    place,
    name: nameOf(id),
    color: game.players.find((p) => p.id === id)!.color,
    kills: knockoutsBy(game, id),
  }));
}

/** Who went out how, in order: "Ana explodiu Bia", "Caio se explodiu", "Dani foi esmagado", "Edu saiu". */
function knockoutLog(game: GameState, nameOf: (id: string) => string): string[] {
  return game.players
    .filter((p) => p.death)
    .sort((a, b) => a.diedAt! - b.diedAt!)
    .map((p) => {
      const { how, by } = p.death!;
      if (how === "crush") return `${nameOf(p.id)} foi esmagado`;
      if (how === "left") return `${nameOf(p.id)} saiu`;
      return by === p.id || by === null ? `${nameOf(p.id)} se explodiu` : `${nameOf(by)} explodiu ${nameOf(p.id)}`;
    });
}



const BLOCK_HEIGHT: Record<number, number> = { 1: 130, 2: 98, 3: 72, 4: 52 };

/** Classic podium order: 2nd on the left, 1st in the middle, then 3rd and 4th. */
function arrange(entries: PodiumEntry[]): PodiumEntry[] {
  const s = [...entries].sort((a, b) => a.place - b.place);
  if (s.length <= 1) return s;
  return [s[1], s[0], ...s.slice(2)];
}

/**
 * The finished match's podium: the winner celebrates, everybody else sobs (ties share a place and the
 * happy face), with each one's knockouts and, under it, who went out how.
 */
export function Podium({ game, nameOf }: { game: GameState; nameOf: (id: string) => string }) {
  const log = knockoutLog(game, nameOf);
  return (
    <>
      <div className="podium" role="list" aria-label="Classificação final">
        {arrange(podiumEntries(game, nameOf)).map((e, i) => {
          const happy = e.place === 1;
          return (
            <div key={e.id} className="podium-col" role="listitem" style={{ "--i": i } as CSSProperties}>
              <div className="podium-name" title={e.name}>
                {e.name}
              </div>
              {e.kills > 0 && (
                <div className="podium-kills" title={`Explodiu ${e.kills} ${e.kills === 1 ? "pessoa" : "pessoas"}`}>
                  💥 {e.kills}
                </div>
              )}
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
      {log.length > 0 && <p className="knockouts">💥 {log.join(" · ")}</p>}
    </>
  );
}
