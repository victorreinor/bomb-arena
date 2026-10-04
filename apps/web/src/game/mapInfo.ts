import { type GameState, type MapId } from "@bomb-arena/engine";
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
  assembly: { level: "Esteiras", desc: "Uma esteira dá a volta no meio e leva quem pisa nela, e também bombas e itens. Andar contra ela é lento.", music: "battle", theme: "assembly" },
  portals: { level: "Portais", desc: "Três pares de portais ligam os lados da arena: entrou num, sai no outro. Bomba chutada também passa.", music: "battle2", theme: "space" },
  lake: { level: "Gelo", desc: "Um lago congelado no meio: no gelo ninguém vira nem para até bater em algo ou sair dele.", music: "battle", theme: "ice" },
  warehouse: { level: "Caixotes", desc: "Caixotes que não queimam e seguram explosões. Ande contra um por um instante para empurrá-lo.", music: "battle2", theme: "warehouse" },
  volcano: { level: "Lava", desc: "Fendas de lava em cruz no meio. De 5 em 5 segundos todas cospem fogo: elas brilham antes.", music: "battle", theme: "volcano" },
};

export const mapInfo = (id: string) => MAP_INFO[id as MapId] ?? MAP_INFO.classic;

/** The music a match should be playing right now: none once it's over, the hurry theme in sudden death. */
export function musicFor(game: GameState): TrackName | null {
  if (game.phase !== "playing") return null;
  return game.timeLeft === 0 ? "hurry" : mapInfo(game.mapId).music;
}
