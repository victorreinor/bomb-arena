import { POWERUP_KINDS, type DiseaseKind, type PowerUpKind } from "@bomberman/engine";

/** Column of each power-up in powerups.png. */
export const ITEM_COL = Object.fromEntries(POWERUP_KINDS.map((kind, i) => [kind, i])) as Record<PowerUpKind, number>;
export const ITEM_COUNT = POWERUP_KINDS.length;

/** Name and description for the UI, plus the colour of its particles. */
export const ITEM_INFO: Record<PowerUpKind, { name: string; desc: string; color: string }> = {
  bomb: { name: "Bomba extra", desc: "+1 bomba ao mesmo tempo.", color: "#3f7bff" },
  fire: { name: "Fogo", desc: "+1 de alcance da explosão.", color: "#ff7a1a" },
  speed: { name: "Velocidade", desc: "Você anda mais rápido.", color: "#ffd23a" },
  kick: { name: "Chute", desc: "Ande contra uma bomba para chutá-la; ela desliza até bater em algo.", color: "#d9a05a" },
  punch: { name: "Soco", desc: "Ação (Shift) de frente para uma bomba: ela voa 3 casas.", color: "#e8404a" },
  glove: { name: "Luva", desc: "Ação (Shift) sobre uma bomba para pegá-la; Ação ou Bomba de novo para arremessar.", color: "#ffd23a" },
  remote: { name: "Bomba remota", desc: "Suas bombas só explodem quando você aperta Ação (Shift), da mais antiga à mais nova.", color: "#b8c0d8" },
  bombPass: { name: "Atravessar bombas", desc: "Você passa por cima das bombas.", color: "#8fd0ff" },
  wallPass: { name: "Atravessar blocos", desc: "Você passa pelos blocos de tijolo (não pelos de pedra).", color: "#d9a05a" },
  vest: { name: "Colete", desc: "Aguenta uma explosão e dá alguns segundos de invulnerabilidade.", color: "#8fd0ff" },
  skull: { name: "Caveira", desc: "Maldição aleatória por 15 s; passa para quem você encostar. Cuidado!", color: "#b36bff" },
  line: { name: "Bomba em linha", desc: "Uso único: sua próxima bomba coloca todas as bombas livres em fila à sua frente.", color: "#ff9a1e" },
  power: { name: "Bomba de poder", desc: "A primeira bomba de cada leva tem alcance máximo.", color: "#ff3b30" },
};

export const DISEASE_NAME: Record<DiseaseKind, string> = {
  slow: "Lento",
  fast: "Acelerado",
  noBomb: "Sem bombas",
  autoBomb: "Bombas automáticas",
  reverse: "Controles invertidos",
  shortRange: "Alcance mínimo",
};
