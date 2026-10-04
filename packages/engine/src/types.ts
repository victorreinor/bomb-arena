export type Dir = "up" | "down" | "left" | "right";

export const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** Direction of a single-axis step (horizontal wins), or null when standing still. */
export function dirFrom(dx: number, dy: number): Dir | null {
  if (dx < 0) return "left";
  if (dx > 0) return "right";
  if (dy < 0) return "up";
  if (dy > 0) return "down";
  return null;
}

export const TILE = { EMPTY: 0, HARD: 1, SOFT: 2 } as const;
export type Tile = (typeof TILE)[keyof typeof TILE];

/** Every power-up, in the column order of powerups.png (the sprite tool and the client both read this). */
export const POWERUP_KINDS = [
  "bomb",
  "fire",
  "speed",
  "kick",
  "punch",
  "glove",
  "remote",
  "bombPass",
  "wallPass",
  "vest",
  "skull",
  "line",
  "power",
] as const;
export type PowerUpKind = (typeof POWERUP_KINDS)[number];

/** The skull's random curses; every one wears off after DISEASE_TICKS. */
export const DISEASE_KINDS = ["slow", "fast", "noBomb", "autoBomb", "reverse", "shortRange"] as const;
export type DiseaseKind = (typeof DISEASE_KINDS)[number];

export interface Input {
  /** -1 left, 0 none, 1 right */
  dx: number;
  /** -1 up, 0 none, 1 down */
  dy: number;
  /** place a bomb this tick (edge-triggered by the client) */
  bomb: boolean;
  /** contextual button (edge-triggered): throw / lift with the glove, punch, detonate remote bombs */
  action: boolean;
}

export type Inputs = Record<string, Partial<Input> | undefined>;

export interface Player {
  id: string;
  /** index into the player colour palette (0-3) */
  color: number;
  /** centre position in tile units; tile (tx, ty) covers [tx, tx+1) x [ty, ty+1) */
  x: number;
  y: number;
  alive: boolean;
  facing: Dir;
  moving: boolean;
  bombsMax: number;
  bombsActive: number;
  range: number;
  speedLevel: number;
  /** ids of bombs this player may still walk through (just placed on top of them) */
  passing: number[];
  kick: boolean;
  punch: boolean;
  glove: boolean;
  remote: boolean;
  bombPass: boolean;
  wallPass: boolean;
  powerBomb: boolean;
  /** absorbs one hit */
  vest: boolean;
  /** ticks of invulnerability left (after the vest breaks) */
  invuln: number;
  /** pending one-shot line bombs */
  lineCharges: number;
  disease: { kind: DiseaseKind; ticksLeft: number } | null;
  /** id of the bomb being carried (glove) */
  holding: number | null;
  /** tick at which they were eliminated; null while alive */
  diedAt: number | null;
}

/** Power-ups that switch on a permanent ability, and the Player flag each one sets. */
export const ABILITY_FIELDS = {
  kick: "kick",
  punch: "punch",
  glove: "glove",
  remote: "remote",
  bombPass: "bombPass",
  wallPass: "wallPass",
  vest: "vest",
  power: "powerBomb",
} as const satisfies Partial<Record<PowerUpKind, keyof Player>>;
export type AbilityKind = keyof typeof ABILITY_FIELDS;

export const isAbility = (kind: PowerUpKind): kind is AbilityKind => kind in ABILITY_FIELDS;

export interface Bomb {
  id: number;
  owner: string;
  x: number;
  y: number;
  ticksLeft: number;
  range: number;
  /** only detonates on the owner's command (with a long safety fuse) */
  remote: boolean;
  /** placed by a power-bomb owner: maximum range */
  power: boolean;
  /** kicked and sliding in this direction, one tile every KICK_INTERVAL_TICKS */
  slide: Dir | null;
  slideTimer: number;
  /** id of the player carrying it */
  held: string | null;
  /** in the air after a punch or throw; x/y stay at the origin until it lands on `to` */
  flight: { toX: number; toY: number; ticks: number; total: number } | null;
}

/** bitmask of arms connected to this flame tile */
export const ARM = { UP: 1, RIGHT: 2, DOWN: 4, LEFT: 8 } as const;

/** The four blast directions with their arm bit and the bit of the arm pointing back. */
export const BLAST_DIRS = [
  { dx: 0, dy: -1, arm: ARM.UP, back: ARM.DOWN },
  { dx: 1, dy: 0, arm: ARM.RIGHT, back: ARM.LEFT },
  { dx: 0, dy: 1, arm: ARM.DOWN, back: ARM.UP },
  { dx: -1, dy: 0, arm: ARM.LEFT, back: ARM.RIGHT },
] as const;

export interface Flame {
  x: number;
  y: number;
  ticksLeft: number;
  arms: number;
}

export interface PowerUp {
  x: number;
  y: number;
  kind: PowerUpKind;
}

export interface MapDef {
  id: string;
  name: string;
  /**
   * ASCII rows. `#` hard block, `+` soft block, `o` soft block with probability
   * `softDensity`, `.` empty, `1`-`4` player spawn points.
   */
  rows: string[];
  softDensity: number;
}

export type Phase = "playing" | "finished";

export interface GameState {
  tick: number;
  phase: Phase;
  /** winner player id once finished; null on a draw */
  winner: string | null;
  width: number;
  height: number;
  tiles: Tile[];
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  powerUps: PowerUp[];
  nextBombId: number;
  rng: number;
  mapId: string;
}

export interface CreateGameOptions {
  map: MapDef;
  /** `spawn` picks the map spawn point (0-3); defaults to SPAWN_ORDER so two players start in opposite corners */
  players: { id: string; color: number; spawn?: number }[];
  seed: number;
}
