import type { PowerUpKind } from "./types";

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

/** half the player hitbox, in tiles */
export const PLAYER_RADIUS = 0.38;

export const BOMB_FUSE_TICKS = 3 * TICK_RATE;
export const FLAME_TICKS = Math.round(0.6 * TICK_RATE);

export const START_BOMBS = 1;
export const START_RANGE = 2;
export const MAX_BOMBS = 8;
export const MAX_RANGE = 10;

/** tiles per second */
export const BASE_SPEED = 3.6;
export const SPEED_STEP = 0.7;
export const MAX_SPEED_LEVEL = 5;

export const POWERUP_DROP_CHANCE = 0.3;
/** relative drop odds; the three basics are common, the specials rare, the skull a gamble */
export const POWERUP_WEIGHTS = {
  bomb: 26,
  fire: 26,
  speed: 16,
  kick: 7,
  punch: 5,
  glove: 5,
  remote: 5,
  bombPass: 3,
  wallPass: 3,
  vest: 5,
  skull: 6,
  line: 5,
  power: 4,
} as const satisfies Record<PowerUpKind, number>;

/** a kicked bomb slides one tile every this many ticks (10 tiles/s) */
export const KICK_INTERVAL_TICKS = 3;
/** punched/thrown bombs fly this many tiles and spend FLIGHT_TICKS in the air */
export const THROW_DISTANCE = 3;
export const FLIGHT_TICKS = 10;
/** remote bombs still blow up on their own after this long */
export const REMOTE_FUSE_TICKS = 10 * TICK_RATE;
export const INVULN_TICKS = Math.round(2.5 * TICK_RATE);
export const DISEASE_TICKS = 15 * TICK_RATE;
/** with the "autoBomb" curse a bomb is dropped this often */
export const AUTO_BOMB_INTERVAL_TICKS = 10;
export const MAX_LINE_CHARGES = 3;
export const SLOW_FACTOR = 0.45;
export const FAST_FACTOR = 1.9;
