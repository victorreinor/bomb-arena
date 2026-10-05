import type { PetKind, PowerUpKind } from "./types";

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

/** half the player hitbox, in tiles */
export const PLAYER_RADIUS = 0.38;

export const BOMB_FUSE_TICKS = 3 * TICK_RATE;
/** "Ready… Go!" at the start of a match: nobody moves for this long */
export const START_COUNTDOWN_TICKS = 2 * TICK_RATE;
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
  egg: 6,
  pierce: 3,
  rubber: 3,
  mine: 4,
} as const satisfies Record<PowerUpKind, number>;

/** a kicked bomb slides one tile every this many ticks (10 tiles/s) */
export const KICK_INTERVAL_TICKS = 3;
/** punched/thrown bombs fly this many tiles and spend FLIGHT_TICKS in the air */
export const THROW_DISTANCE = 3;
export const FLIGHT_TICKS = 10;
/** a bomb landing on someone's head bounces on to the next tile in this many ticks, leaving them dizzy */
export const BOUNCE_TICKS = 6;
export const STUN_TICKS = TICK_RATE;
/** remote bombs still blow up on their own after this long */
export const REMOTE_FUSE_TICKS = 10 * TICK_RATE;
export const INVULN_TICKS = Math.round(2.5 * TICK_RATE);
export const DISEASE_TICKS = 15 * TICK_RATE;
/** with the "autoBomb" curse a bomb is dropped this often */
export const AUTO_BOMB_INTERVAL_TICKS = 10;
export const MAX_LINE_CHARGES = 3;
export const MAX_MINE_CHARGES = 3;
/** a mine lies in the open this long before it buries itself, and goes off on its own after MINE_FUSE_TICKS */
export const MINE_ARM_TICKS = TICK_RATE;
export const MINE_FUSE_TICKS = 10 * TICK_RATE;
export const SLOW_FACTOR = 0.45;

/** ticks before each pet's power can be used again */
export const PET_COOLDOWN_TICKS: Record<PetKind, number> = { runner: 45, jumper: 30, pusher: 20, kicker: 15 };
/** runner: how long a dash lasts at most, and how much faster it is */
export const DASH_TICKS = 14;
export const DASH_FACTOR = 3;
/** never move more than this many tiles in one tick, so a fast dash cannot skip through a wall */
export const MAX_STEP_TILES = 0.9;
/** jumper: hop two tiles in this many ticks */
export const JUMP_TICKS = 12;
/** revenge ghosts: one border tile per this many ticks, a bomb at most this often, and how big it blows */
export const GHOST_MOVE_TICKS = 4;
export const GHOST_THROW_COOLDOWN_TICKS = 2 * TICK_RATE;
export const GHOST_BOMB_RANGE = 2;
/** sudden death: once time is up, one block drops every this many ticks, spiralling inwards */
export const FALL_INTERVAL_TICKS = 4;
/** with the people out and only bots left alive, the clock is cut to this: nobody is left to wait for them */
export const BOTS_ONLY_TICKS = 20 * TICK_RATE;
/** kicker: its bombs slide one tile every tick */
export const PET_KICK_INTERVAL_TICKS = 1;
export const FAST_FACTOR = 1.9;
/** conveyor belts carry whoever stands on them this fast (tiles per second): slower than walking, so one can walk against them */
export const BELT_SPEED = 2;
/** belts move the bombs and items lying on them one tile every this many ticks */
export const BELT_CARRY_TICKS = 15;
/** leaning on a crate this many ticks shoves it a tile */
export const PUSH_TICKS = 8;
/** how far off a crate's lane (in tiles) a bomber may stand and still push it */
export const PUSH_ALIGN = 0.25;
/** lava vents all erupt every this many ticks of play; the client shows them glowing for VENT_WARN_TICKS before */
export const VENT_PERIOD_TICKS = 5 * TICK_RATE;
export const VENT_WARN_TICKS = TICK_RATE;
