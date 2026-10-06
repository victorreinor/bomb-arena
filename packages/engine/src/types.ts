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

/** What stands on a cell: nothing, stone, a brick, or a crate (solid and fireproof, but anyone can push it). */
export const TILE = { EMPTY: 0, HARD: 1, SOFT: 2, CRATE: 3 } as const;
export type Tile = (typeof TILE)[keyof typeof TILE];

/**
 * What the floor of a cell does, under whatever stands on it: nothing, ice, a lava vent, a conveyor belt
 * (BELT plus the index of its direction in BELT_DIRS) or a portal pad (PORTAL plus the number of its pair).
 */
export const FLOOR = { PLAIN: 0, ICE: 1, VENT: 2, BELT: 3, PORTAL: 7 } as const;
/** The way each belt code runs: FLOOR.BELT + i runs BELT_DIRS[i]. */
export const BELT_DIRS = ["up", "right", "down", "left"] as const satisfies readonly Dir[];

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
  "egg",
  "pierce",
  "rubber",
  "mine",
] as const;
export type PowerUpKind = (typeof POWERUP_KINDS)[number];

/** Mounts that hatch from eggs; each has one power on the pet key (row order of pets.png). */
export const PET_KINDS = ["runner", "jumper", "pusher", "kicker"] as const;
export type PetKind = (typeof PET_KINDS)[number];

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
  /** use the mount's power (edge-triggered) */
  pet: boolean;
}

export type Inputs = Record<string, Partial<Input> | undefined>;

/** The one-shot buttons of an Input (pressed once per key press, cleared after the tick uses them). */
export const BUTTONS = ["bomb", "action", "pet"] as const;
export type Button = (typeof BUTTONS)[number];

export const emptyInput = (): Input => ({ dx: 0, dy: 0, bomb: false, action: false, pet: false });

export interface Player {
  id: string;
  /** index into the player colour palette (0-3) */
  color: number;
  /** the side they are on in a team match (0 or 1); null when it's everyone for themselves */
  team: number | null;
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
  /** their blasts go through bricks */
  pierceBomb: boolean;
  /** their kicked bombs bounce back off walls instead of stopping */
  rubberBomb: boolean;
  /** absorbs one hit */
  vest: boolean;
  /** ticks of invulnerability left (after the vest breaks) */
  invuln: number;
  /** ticks left seeing stars after a thrown bomb bounced off their head: no moving, no buttons */
  stunned: number;
  /** pending one-shot line bombs */
  lineCharges: number;
  /** pending one-shot mines: the next bombs laid bury themselves */
  mineCharges: number;
  /** ticks spent leaning on a crate: at PUSH_TICKS it moves */
  push: number;
  disease: { kind: DiseaseKind; ticksLeft: number } | null;
  /** id of the bomb being carried (glove) */
  holding: number | null;
  /** tick at which they were eliminated; null while alive */
  diedAt: number | null;
  /** how they went out: a blast (and whose bomb it was, their own included), a falling block, or leaving */
  death: { how: DeathCause; by: string | null } | null;
  /** the mount being ridden; it takes the next hit instead of the rider */
  pet: { kind: PetKind; cooldown: number; dashTicks: number } | null;
  /** revenge mode: after dying, a ghost on the outer wall (index into borderRing) that throws bombs in */
  ghost: { pos: number; moveTimer: number; cooldown: number } | null;
  /** mid-air (jumper pet): position goes from `from` to `to`, untouchable until landing */
  jump: { fromX: number; fromY: number; toX: number; toY: number; ticks: number; total: number } | null;
}

export type DeathCause = "blast" | "crush" | "lava" | "left";

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
  pierce: "pierceBomb",
  rubber: "rubberBomb",
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
  /** its blast goes through bricks, breaking every one in reach */
  pierce: boolean;
  /** kicked, it bounces back off whatever stops it (but people) */
  rubber: boolean;
  /** buries itself after MINE_ARM_TICKS: unseen by others, walked over, set off by an opponent stepping on it */
  mine: boolean;
  /** kicked and sliding in this direction, one tile every KICK_INTERVAL_TICKS */
  slide: Dir | null;
  slideTimer: number;
  /** ticks per tile while sliding (a pet's kick is faster than the boots) */
  slideInterval: number;
  /** id of the player carrying it */
  held: string | null;
  /** in the air after a punch or throw; x/y stay at the origin until it lands on `to`, flying `dir`-wards */
  flight: { toX: number; toY: number; dir: Dir; ticks: number; total: number } | null;
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
  /** whose bomb's blast this is (the latest to reach the tile): who gets the credit if it catches someone */
  owner: string;
  /** everyone whose bombs fed this fire, in the order they first did (none for lava): with friendly fire off, what tells a team-mate's fire from one that burns */
  owners: string[];
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
   * ASCII rows. `#` hard block, `+` soft block, `o` soft block with probability `softDensity`, `.` empty,
   * `1`-`4` player spawn points (as many players as spawns), `=` crate, `~` ice, `*` lava vent,
   * `^` `>` `v` `<` conveyor belts, and `A`-`D` portals (each letter twice: the two ends of a pair).
   */
  rows: string[];
  softDensity: number;
}

export type Phase = "playing" | "finished";

export interface GameState {
  tick: number;
  phase: Phase;
  /** winner player id once finished (in a team match, the first of the winning team still standing: see `winners`); null on a draw */
  winner: string | null;
  width: number;
  height: number;
  tiles: Tile[];
  /** what each cell's floor does (FLOOR codes); null on maps where it's all plain */
  floor: number[] | null;
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  powerUps: PowerUp[];
  nextBombId: number;
  rng: number;
  mapId: string;
  /** dead players become ghosts on the outer wall and keep throwing bombs */
  revenge: boolean;
  /** in a team match, whether a team-mate's blast kills (one's own bomb always does) */
  friendlyFire: boolean;
  /** ticks until sudden death (null: no time limit); at 0 the blocks start falling */
  timeLeft: number | null;
  /** how many cells of the sudden-death spiral have been filled */
  fallen: number;
  /** the tick play starts after: until then nobody moves and the clock waits (the "Ready… Go!" countdown) */
  goTick: number;
}

export interface CreateGameOptions {
  map: MapDef;
  /**
   * `spawn` picks the map spawn point (0-3); defaults to SPAWN_ORDER so two players start in opposite corners.
   * `team` (0 or 1) puts them on a side: the match is then between teams.
   */
  players: { id: string; color: number; spawn?: number; team?: number }[];
  seed: number;
  revenge?: boolean;
  /** in a team match, whether a team-mate's blast kills; on unless said otherwise */
  friendlyFire?: boolean;
  /** match length before sudden death, in ticks; omit or null for no limit */
  timeLimitTicks?: number | null;
  /** ticks of "Ready… Go!" before anyone can move (0, the default, starts at once) */
  countdownTicks?: number;
}
