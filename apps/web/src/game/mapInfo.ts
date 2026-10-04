import { type GameState, type MapId } from "@bomberman/engine";
import type { TrackName } from "./audio";
import type { TileTheme } from "./sprites";

/** What the client shows and plays for each map; exhaustive, so a new map fails to compile until described. */
export const MAP_INFO: Record<MapId, { level: string; desc: string; music: TrackName; theme: TileTheme }> = {
  classic: { level: "Médio", desc: "O tabuleiro de sempre: pilares alternados e muitos tijolos.", music: "battle", theme: "garden" },
  open: { level: "Simples", desc: "Poucos pilares e bastante espaço para correr. Bom para começar.", music: "battle2", theme: "snow" },
  maze: { level: "Complexo", desc: "Pilares extras nos cruzamentos forçam desvios. Partidas mais táticas.", music: "battle", theme: "temple" },
  quadrants: { level: "Complexo", desc: "Quatro salas separadas por muros; a briga acontece nas quatro passagens.", music: "battle2", theme: "factory" },
  duel: { level: "x1 · Pequeno", desc: "Um contra um num tabuleiro apertado: o encontro vem logo.", music: "battle", theme: "temple" },
  faceoff: { level: "x1 · Médio", desc: "Um contra um com espaço para pegar uns itens antes da briga.", music: "battle2", theme: "factory" },
};

export const mapInfo = (id: string) => MAP_INFO[id as MapId] ?? MAP_INFO.classic;

/** The music a match should be playing right now: none once it's over, the hurry theme in sudden death. */
export function musicFor(game: GameState): TrackName | null {
  if (game.phase !== "playing") return null;
  return game.timeLeft === 0 ? "hurry" : mapInfo(game.mapId).music;
}
