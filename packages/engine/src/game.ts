import {
  AUTO_BOMB_INTERVAL_TICKS,
  BASE_SPEED,
  BELT_CARRY_TICKS,
  BELT_SPEED,
  BOMB_FUSE_TICKS,
  BOTS_ONLY_TICKS,
  BOUNCE_TICKS,
  DASH_FACTOR,
  DASH_TICKS,
  DISEASE_TICKS,
  FALL_INTERVAL_TICKS,
  FAST_FACTOR,
  FLAME_TICKS,
  FLIGHT_TICKS,
  GHOST_BOMB_RANGE,
  GHOST_MOVE_TICKS,
  GHOST_THROW_COOLDOWN_TICKS,
  INVULN_TICKS,
  JUMP_TICKS,
  KICK_INTERVAL_TICKS,
  MAX_BOMBS,
  MAX_LINE_CHARGES,
  MAX_MINE_CHARGES,
  MAX_RANGE,
  MAX_SPEED_LEVEL,
  MAX_STEP_TILES,
  MINE_ARM_TICKS,
  MINE_FUSE_TICKS,
  PET_COOLDOWN_TICKS,
  PET_KICK_INTERVAL_TICKS,
  PLAYER_RADIUS,
  POWERUP_DROP_CHANCE,
  POWERUP_WEIGHTS,
  PUSH_ALIGN,
  PUSH_TICKS,
  REMOTE_FUSE_TICKS,
  SLOW_FACTOR,
  SPEED_STEP,
  START_BOMBS,
  START_RANGE,
  STUN_TICKS,
  THROW_DISTANCE,
  TICK_RATE,
  VENT_PERIOD_TICKS,
} from "./constants";
import { SPAWN_ORDER, isSpawn } from "./maps";
import { nextRandom, pickRandom } from "./rng";
import {
  ABILITY_FIELDS,
  BELT_DIRS,
  BLAST_DIRS,
  DIR_VEC,
  DISEASE_KINDS,
  FLOOR,
  PET_KINDS,
  TILE,
  dirFrom,
  isAbility,
  type Bomb,
  type CreateGameOptions,
  type DeathCause,
  type Dir,
  type Flame,
  type GameState,
  type Input,
  type Inputs,
  type Player,
  type PowerUpKind,
  type Tile,
} from "./types";

const EPS = 1e-6;

/** Tile at (x, y); everything outside the arena counts as hard wall. */
export function tileAt(state: GameState, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return TILE.HARD;
  return state.tiles[y * state.width + x];
}

/** Cache for geometry that depends only on the board size. */
function bySize<V>(cache: Map<number, V>, width: number, height: number, build: () => V): V {
  const key = width * 1000 + height;
  let value = cache.get(key);
  if (value === undefined) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

/** Wrap a coordinate round the arena (thrown bombs leave one edge and come back on the other). */
export function wrap(v: number, size: number): number {
  return ((v % size) + size) % size;
}

function flameAt(state: GameState, x: number, y: number): Flame | undefined {
  return state.flames.find((f) => f.x === x && f.y === y);
}

function burnFlames(state: GameState) {
  for (const f of state.flames) f.ticksLeft--;
  state.flames = state.flames.filter((f) => f.ticksLeft > 0);
}

export function createGame(opts: CreateGameOptions): GameState {
  const { map, players, seed, revenge = false, timeLimitTicks = null, countdownTicks = 0 } = opts;
  const height = map.rows.length;
  const width = map.rows[0].length;
  const state: GameState = {
    tick: 0,
    phase: "playing",
    winner: null,
    width,
    height,
    tiles: new Array(width * height).fill(TILE.EMPTY),
    floor: null,
    players: [],
    bombs: [],
    flames: [],
    powerUps: [],
    nextBombId: 1,
    rng: seed >>> 0,
    mapId: map.id,
    revenge,
    timeLeft: timeLimitTicks,
    fallen: 0,
    goTick: countdownTicks,
  };

  const spawns: { x: number; y: number }[] = [];
  const floor = new Array<number>(width * height).fill(FLOOR.PLAIN);
  map.rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`map ${map.id}: row ${y} has wrong width`);
    [...row].forEach((ch, x) => {
      const i = y * width + x;
      if (ch === "#") state.tiles[i] = TILE.HARD;
      else if (ch === "+") state.tiles[i] = TILE.SOFT;
      else if (ch === "o") state.tiles[i] = nextRandom(state) < map.softDensity ? TILE.SOFT : TILE.EMPTY;
      else if (ch === "=") state.tiles[i] = TILE.CRATE;
      else if (isSpawn(ch)) spawns[Number(ch) - 1] = { x, y };
      else floor[i] = floorCode(ch);
    });
  });
  if (floor.some((f) => f !== FLOOR.PLAIN)) state.floor = floor;

  players.forEach((p, i) => {
    // small test maps may lack the corner SPAWN_ORDER asks for; fall back to the n-th spawn
    const index = p.spawn ?? (spawns[SPAWN_ORDER[i]] ? SPAWN_ORDER[i] : i);
    const spawn = spawns[index];
    if (!spawn) throw new Error(`map ${map.id} has no spawn ${index + 1}`);
    state.players.push({
      id: p.id,
      color: p.color,
      x: spawn.x + 0.5,
      y: spawn.y + 0.5,
      alive: true,
      facing: "down",
      moving: false,
      bombsMax: START_BOMBS,
      bombsActive: 0,
      range: START_RANGE,
      speedLevel: 0,
      passing: [],
      kick: false,
      punch: false,
      glove: false,
      remote: false,
      bombPass: false,
      wallPass: false,
      powerBomb: false,
      pierceBomb: false,
      rubberBomb: false,
      vest: false,
      invuln: 0,
      stunned: 0,
      lineCharges: 0,
      mineCharges: 0,
      push: 0,
      disease: null,
      holding: null,
      diedAt: null,
      death: null,
      pet: null,
      jump: null,
      ghost: null,
    });
  });

  return state;
}

/**
 * Final standings: survivors first, then the rest by who lasted longest.
 * Players who fell on the same tick share a place (1, 2, 2, 4...), so a draw puts them level.
 */
export function computeRanking(state: GameState): { id: string; place: number }[] {
  const lasted = (p: Player) => (p.alive || p.diedAt === null ? Infinity : p.diedAt);
  const sorted = [...state.players].sort((a, b) => lasted(b) - lasted(a));
  return sorted.map((p) => ({ id: p.id, place: 1 + sorted.filter((o) => lasted(o) > lasted(p)).length }));
}

export function playerSpeed(p: Player): number {
  const base = BASE_SPEED + SPEED_STEP * p.speedLevel;
  if (p.disease?.kind === "slow") return base * SLOW_FACTOR;
  if (p.disease?.kind === "fast") return base * FAST_FACTOR;
  return base;
}

/** Eliminate a player (blast, falling block, leaving); a carried bomb is dropped where they stood. */
export function killPlayer(state: GameState, p: Player, how: DeathCause, by: string | null = null) {
  p.alive = false;
  p.diedAt = state.tick;
  p.death = { how, by };
  p.moving = false;
  p.disease = null;
  p.pet = null;
  p.jump = null;
  p.ghost = null;
  dropHeld(state, p);
}

/** A carried bomb falls at its carrier's feet (they can step off it). Returns that bomb, if any. */
function dropHeld(state: GameState, p: Player): Bomb | undefined {
  if (p.holding === null) return undefined;
  const bomb = state.bombs.find((b) => b.id === p.holding);
  if (bomb) {
    bomb.held = null;
    bomb.x = Math.floor(p.x);
    bomb.y = Math.floor(p.y);
    p.passing.push(bomb.id);
  }
  p.holding = null;
  return bomb;
}

/**
 * One living player's part of a tick: timers, then their buttons and their move. The client also runs it
 * on its own copy of the board to predict its bomber between snapshots, so the two always agree.
 */
export function stepPlayer(state: GameState, p: Player, input: Partial<Input> | undefined) {
  if (p.invuln > 0) p.invuln--;
  if (p.disease && --p.disease.ticksLeft <= 0) p.disease = null;
  if (p.pet && p.pet.cooldown > 0) p.pet.cooldown--;
  if (p.jump) return advanceJump(state, p); // nothing else happens in mid-air
  if (p.stunned > 0) {
    p.stunned--; // seeing stars: the controls do nothing
    return;
  }

  const flip = p.disease?.kind === "reverse" ? -1 : 1;
  const dx = Math.sign(input?.dx ?? 0) * flip;
  const dy = Math.sign(input?.dy ?? 0) * flip;
  const dashing = (p.pet?.dashTicks ?? 0) > 0;
  const from = Math.floor(p.y) * state.width + Math.floor(p.x);
  // on ice there's no steering once moving: the bomber slides on until something stops it or the ice ends
  const sliding = !dashing && p.moving && floorAt(state, Math.floor(p.x), Math.floor(p.y)) === FLOOR.ICE;
  if (!dashing && !sliding) p.facing = dirFrom(dx, dy) ?? p.facing;

  if (p.disease?.kind === "autoBomb" && state.tick % AUTO_BOMB_INTERVAL_TICKS === 0) placeBomb(state, p);
  if (input?.action) doAction(state, p);
  if (input?.bomb) placeBomb(state, p);
  if (input?.pet) usePet(state, p);
  if (p.jump) return; // just took off

  if (p.pet && p.pet.dashTicks > 0) {
    // the runner charges straight ahead, ignoring the controls, until it hits something
    p.pet.dashTicks--;
    const d = DIR_VEC[p.facing];
    movePlayer(state, p, d.dx, d.dy, DASH_FACTOR);
    if (!p.moving) p.pet.dashTicks = 0;
  } else if (sliding) {
    const d = DIR_VEC[p.facing];
    movePlayer(state, p, d.dx, d.dy);
  } else {
    movePlayer(state, p, dx, dy);
  }
  rideBelt(state, p);
  takePortal(state, p, from);
  updatePassing(state, p);
}

/**
 * The item on the player's tile becomes theirs (riders leave eggs on the floor for someone else).
 * Like stepPlayer, the client runs it to predict its own bomber.
 */
export function pickUp(state: GameState, p: Player) {
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const pu = state.powerUps.findIndex((u) => u.x === tx && u.y === ty);
  if (pu < 0 || (state.powerUps[pu].kind === "egg" && p.pet)) return;
  applyPowerUp(state, p, state.powerUps[pu].kind);
  state.powerUps.splice(pu, 1);
}

/** Whether the match is still in its "Ready… Go!" countdown: nobody moves and the clock waits. */
export const countingDown = (state: GameState) => state.tick <= state.goTick;

/** How many others went out in a blast of `id`'s bombs. */
export const knockoutsBy = (state: GameState, id: string) => state.players.filter((p) => p.id !== id && p.death?.by === id).length;

export function step(state: GameState, inputs: Inputs = {}): void {
  state.tick++;
  if (state.phase !== "playing") {
    burnFlames(state); // let the last flames burn out so the final frame doesn't freeze mid-blast
    return;
  }
  if (countingDown(state)) return;

  for (const p of state.players) {
    if (p.alive) stepPlayer(state, p, inputs[p.id]);
    else if (p.ghost) stepGhost(state, p, inputs[p.id]);
  }

  updateBombs(state);
  carryOnBelts(state);
  triggerMines(state);
  burnFlames(state);
  eruptVents(state);
  suddenDeath(state);

  for (const b of state.bombs) b.ticksLeft--;
  for (let due = state.bombs.find((b) => b.ticksLeft <= 0); due; due = state.bombs.find((b) => b.ticksLeft <= 0)) {
    explode(state, due);
  }

  for (const p of state.players) {
    if (!p.alive || p.jump) continue; // in mid-air: flames and items pass underneath
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const flame = p.invuln === 0 ? flameAt(state, tx, ty) : undefined;
    if (flame) {
      // the mount takes the hit first, then the vest; otherwise it's over
      if (p.pet) {
        p.pet = null;
        p.invuln = INVULN_TICKS;
      } else if (p.vest) {
        p.vest = false;
        p.invuln = INVULN_TICKS;
      } else {
        // a flame nobody owns came out of a lava vent
        if (flame.owner) eliminate(state, p, "blast", flame.owner);
        else eliminate(state, p, "lava", null);
        continue;
      }
    }
    pickUp(state, p);
  }

  spreadDiseases(state);

  if (state.players.length >= 2) {
    const alive = state.players.filter((p) => p.alive);
    if (alive.length <= 1) {
      state.phase = "finished";
      state.winner = alive[0]?.id ?? null;
    }
  }
}

/** Killed in play (blast or falling block): in revenge mode they come back as a ghost on the wall. */
function eliminate(state: GameState, p: Player, how: Exclude<DeathCause, "left">, by: string | null) {
  killPlayer(state, p, how, by);
  if (state.revenge) p.ghost = { pos: nearestBorderIndex(state, p.x, p.y), moveTimer: 0, cooldown: GHOST_THROW_COOLDOWN_TICKS };
}

// ------------------------------------------------------------ sudden death

const spiralCache = new Map<number, number[]>();

/** Inner cells (tile indices) from the outside in, clockwise from the top-left: the order blocks fall in. */
export function fallOrder(width: number, height: number): number[] {
  return bySize(spiralCache, width, height, () => {
    const order: number[] = [];
    let [left, top, right, bottom] = [1, 1, width - 2, height - 2];
    while (left <= right && top <= bottom) {
      for (let x = left; x <= right; x++) order.push(top * width + x);
      for (let y = top + 1; y <= bottom; y++) order.push(y * width + right);
      if (top < bottom) for (let x = right - 1; x >= left; x--) order.push(bottom * width + x);
      if (left < right) for (let y = bottom - 1; y > top; y--) order.push(y * width + left);
      [left, top, right, bottom] = [left + 1, top + 1, right - 1, bottom - 1];
    }
    return order;
  });
}

/** Counts the match clock down; once it hits zero, blocks drop one by one and crush what is underneath. */
/**
 * With the people out and only bots left alive, nobody is left to wait for them to settle it: the clock is
 * cut to BOTS_ONLY_TICKS (in a match with no time limit too) and sudden death does the rest. Not in revenge
 * mode, where the people who fell are still playing, as ghosts. Whoever runs the match calls this before
 * each step and says who the bots are; the rules themselves don't know.
 */
export function hurryBotsAlone(state: GameState, isBot: (id: string) => boolean): void {
  if (state.phase !== "playing" || state.revenge) return;
  if (state.timeLeft !== null && state.timeLeft <= BOTS_ONLY_TICKS) return;
  const people = state.players.filter((p) => !isBot(p.id));
  if (people.length > 0 && !people.some((p) => p.alive)) state.timeLeft = BOTS_ONLY_TICKS;
}

function suddenDeath(state: GameState) {
  if (state.timeLeft === null) return;
  if (state.timeLeft > 0) {
    state.timeLeft--;
    return;
  }
  if (state.tick % FALL_INTERVAL_TICKS !== 0) return;
  const order = fallOrder(state.width, state.height);
  if (state.fallen >= order.length) return;
  // skip cells that are already stone so every drop lands somewhere new
  while (state.fallen < order.length && state.tiles[order[state.fallen]] === TILE.HARD) state.fallen++;
  if (state.fallen >= order.length) return;
  const i = order[state.fallen++];
  const x = i % state.width;
  const y = Math.floor(i / state.width);
  state.tiles[i] = TILE.HARD;
  const crushed = groundBombAt(state, x, y);
  if (crushed) {
    const owner = state.players.find((p) => p.id === crushed.owner);
    if (owner) owner.bombsActive = Math.max(0, owner.bombsActive - 1);
    state.bombs = state.bombs.filter((o) => o !== crushed);
  }
  state.powerUps = state.powerUps.filter((u) => u.x !== x || u.y !== y);
  state.flames = state.flames.filter((f) => f.x !== x || f.y !== y);
  for (const p of state.players) {
    if (!p.alive || !overlapsTile(p.x, p.y, x, y)) continue;
    if (Math.floor(p.x) === x && Math.floor(p.y) === y) {
      eliminate(state, p, "crush", null); // nothing saves you from a falling block: not the pet, not the vest
    } else {
      // brushing the cell from the next one: nudge back to the middle so they can still move
      p.x = Math.floor(p.x) + 0.5;
      p.y = Math.floor(p.y) + 0.5;
    }
  }
}

/** A cursed player passes the curse on to anyone they bump into. */
function spreadDiseases(state: GameState) {
  for (const p of state.players) {
    if (!p.alive || !p.disease) continue;
    for (const q of state.players) {
      if (q === p || !q.alive || q.disease) continue;
      if (Math.hypot(p.x - q.x, p.y - q.y) < 0.8) q.disease = { ...p.disease };
    }
  }
}

function applyPowerUp(state: GameState, p: Player, kind: PowerUpKind) {
  if (isAbility(kind)) {
    p[ABILITY_FIELDS[kind]] = true;
    return;
  }
  switch (kind) {
    case "bomb":
      p.bombsMax = Math.min(MAX_BOMBS, p.bombsMax + 1);
      break;
    case "fire":
      p.range = Math.min(MAX_RANGE, p.range + 1);
      break;
    case "speed":
      p.speedLevel = Math.min(MAX_SPEED_LEVEL, p.speedLevel + 1);
      break;
    case "line":
      p.lineCharges = Math.min(MAX_LINE_CHARGES, p.lineCharges + 1);
      break;
    case "mine":
      p.mineCharges = Math.min(MAX_MINE_CHARGES, p.mineCharges + 1);
      break;
    case "egg":
      p.pet = { kind: pickRandom(state, PET_KINDS), cooldown: 0, dashTicks: 0 };
      break;
    case "skull": {
      const kindOfCurse = pickRandom(state, DISEASE_KINDS);
      p.disease = { kind: kindOfCurse, ticksLeft: DISEASE_TICKS };
      break;
    }
  }
}

// ---------------------------------------------------------------- bombs

/** A mine that has gone underground: nobody but its owner sees it, anyone walks over it. */
export const isBuried = (b: Bomb) =>
  b.mine && !b.slide && !b.flight && !b.held && b.ticksLeft <= MINE_FUSE_TICKS - MINE_ARM_TICKS;

/** A bomb lying on a tile, buried mines included (not one in the air or in someone's hands). */
export function groundBombAt(state: GameState, x: number, y: number): Bomb | undefined {
  return state.bombs.find((b) => b.x === x && b.y === y && !b.flight && !b.held);
}

/** A bomb that stands on a tile and blocks it: on the ground and not buried. */
export function bombAt(state: GameState, x: number, y: number): Bomb | undefined {
  const bomb = groundBombAt(state, x, y);
  return bomb && !isBuried(bomb) ? bomb : undefined;
}

function overlapsTile(px: number, py: number, tx: number, ty: number): boolean {
  const reach = 0.5 + PLAYER_RADIUS - EPS;
  return Math.abs(px - (tx + 0.5)) < reach && Math.abs(py - (ty + 0.5)) < reach;
}

/**
 * Whether a bomb may be laid on this tile: open floor that isn't a portal, no bomb (not even a buried
 * mine), no fire (a wall-passer standing in a brick can't).
 */
export function canPlaceAt(state: GameState, x: number, y: number): boolean {
  return tileAt(state, x, y) === TILE.EMPTY && !groundBombAt(state, x, y) && !flameAt(state, x, y) && !isPortal(state, x, y);
}

/** Stone and crates stop a blast, and neither burns. */
const stopsBlast = (tile: Tile) => tile === TILE.HARD || tile === TILE.CRATE;

/** A bomb as its owner's items make it; `plain` (a ghost's) leaves out remote, pierce and rubber. */
function newBomb(state: GameState, p: Player, x: number, y: number, range: number, plain = false): Bomb {
  const remote = !plain && p.remote;
  const bomb: Bomb = {
    id: state.nextBombId++,
    owner: p.id,
    x,
    y,
    ticksLeft: remote ? REMOTE_FUSE_TICKS : BOMB_FUSE_TICKS,
    range,
    remote,
    power: false,
    pierce: !plain && p.pierceBomb,
    rubber: !plain && p.rubberBomb,
    mine: false,
    slide: null,
    slideTimer: 0,
    slideInterval: KICK_INTERVAL_TICKS,
    held: null,
    flight: null,
  };
  state.bombs.push(bomb);
  p.bombsActive++;
  letStandersOff(state, bomb);
  return bomb;
}

/** Whoever a bomb appears under (dropped, or landing) may walk off it. */
function letStandersOff(state: GameState, bomb: Bomb) {
  for (const p of state.players) if (p.alive && overlapsTile(p.x, p.y, bomb.x, bomb.y)) p.passing.push(bomb.id);
}

/** A bomber who turns up on a bomb (landing from a hop, out of a portal) may walk off it. */
function letOffBombs(state: GameState, p: Player) {
  for (const b of state.bombs) if (!b.flight && !b.held && overlapsTile(p.x, p.y, b.x, b.y)) p.passing.push(b.id);
}

/** Whether a press of the bomb key could lay a bomb right now (wherever it is). */
export function canDropBomb(p: Player): boolean {
  return p.holding === null && p.disease?.kind !== "noBomb" && p.bombsActive < p.bombsMax;
}

/** Range of the next single bomb this player lays: a power bomb opens each set, the curse caps it at 1. */
export function bombRangeFor(p: Player): number {
  return isPowerBomb(p) ? MAX_RANGE : baseRange(p);
}

const baseRange = (p: Player) => (p.disease?.kind === "shortRange" ? 1 : p.range);
/** The first bomb of a batch from a power-bomb owner goes all the way (not under the short-range curse). */
const isPowerBomb = (p: Player) => p.powerBomb && p.bombsActive === 0 && p.disease?.kind !== "shortRange";

/**
 * Cells (tile indices) a bomb at (x, y) would set on fire: stops at stone and crates, at the first bomb
 * and at the first brick (a piercing blast goes on through bricks).
 */
export function blastCells(state: GameState, x: number, y: number, range: number, pierce = false): number[] {
  const cells = [y * state.width + x];
  for (const d of BLAST_DIRS) {
    for (let i = 1; i <= range; i++) {
      const cx = x + d.dx * i;
      const cy = y + d.dy * i;
      const tile = tileAt(state, cx, cy);
      if (stopsBlast(tile)) break;
      cells.push(cy * state.width + cx);
      if ((tile === TILE.SOFT && !pierce) || bombAt(state, cx, cy)) break;
    }
  }
  return cells;
}

/** Line bomb: the tiles every spare bomb goes on, one apart, from (x, y) the way `facing` points; none without a charge and two bombs to spare. */
function lineTiles(state: GameState, p: Player, facing: Dir, x: number, y: number): { x: number; y: number }[] {
  const available = p.bombsMax - p.bombsActive;
  if (p.lineCharges <= 0 || available < 2) return [];
  const d = DIR_VEC[facing];
  const tiles: { x: number; y: number }[] = [];
  for (let i = 0; i < available && canPlaceAt(state, x + d.dx * i, y + d.dy * i); i++) tiles.push({ x: x + d.dx * i, y: y + d.dy * i });
  return tiles;
}

/**
 * The bombs a press of the bomb key would lay with the player on (x, y) facing `facing`: one underfoot or,
 * with a line charge, a row of them ahead. Bots plan their way out from this, so a row doesn't shut them in.
 */
export function bombsLaid(
  state: GameState,
  p: Player,
  facing: Dir = p.facing,
  x = Math.floor(p.x),
  y = Math.floor(p.y),
): { x: number; y: number; range: number }[] {
  const line = lineTiles(state, p, facing, x, y);
  if (line.length > 0) return line.map((t) => ({ ...t, range: baseRange(p) }));
  return canPlaceAt(state, x, y) ? [{ x, y, range: bombRangeFor(p) }] : [];
}

function placeBomb(state: GameState, p: Player) {
  if (p.holding !== null) return void throwBomb(state, p); // pressing bomb again lobs the one you carry
  if (!canDropBomb(p)) return;

  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);

  const line = lineTiles(state, p, p.facing, tx, ty);
  for (const t of line) newBomb(state, p, t.x, t.y, baseRange(p));
  if (line.length >= 2) p.lineCharges--;
  if (line.length > 0) return;

  if (!canPlaceAt(state, tx, ty)) return;
  const power = isPowerBomb(p);
  const bomb = newBomb(state, p, tx, ty, bombRangeFor(p));
  bomb.power = power;
  if (p.mineCharges > 0) {
    // a mine goes off when stepped on (or after a long fuse), never by remote
    p.mineCharges--;
    Object.assign(bomb, { mine: true, remote: false, ticksLeft: MINE_FUSE_TICKS });
  }
}

// ----------------------------------------------------- special abilities

/** What the contextual button does, and to which bomb. */
export type Action = { act: "throw" } | { act: "lift" | "punch" | "kick" | "detonate"; bomb: Bomb };

/**
 * What the contextual button would do right now: throw > lift (glove) > punch > kick > detonate (remote);
 * null for nothing. The bomb underfoot counts for all of them, so that one just laid can be sent off without
 * stepping off it and back: a punch goes for the bomb ahead and failing that the one underfoot, a kick for
 * the one underfoot alone (the one ahead is kicked by walking into it).
 */
export function actionFor(state: GameState, p: Player): Action | null {
  if (p.holding !== null) return { act: "throw" };
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const under = bombAt(state, tx, ty);
  if (under && p.glove) return { act: "lift", bomb: under };
  const d = DIR_VEC[p.facing];
  const struck = p.punch ? (bombAt(state, tx + d.dx, ty + d.dy) ?? under) : undefined;
  if (struck) return { act: "punch", bomb: struck };
  if (under && p.kick) return { act: "kick", bomb: under };
  // state.bombs is kept in id order, so the first match is the oldest
  const oldest = p.remote ? state.bombs.find((b) => b.owner === p.id && b.remote && !b.flight) : undefined;
  return oldest ? { act: "detonate", bomb: oldest } : null;
}

function doAction(state: GameState, p: Player) {
  const action = actionFor(state, p);
  switch (action?.act) {
    case "throw":
      return throwBomb(state, p);
    case "lift":
      action.bomb.held = p.id;
      action.bomb.slide = null;
      p.holding = action.bomb.id;
      return;
    case "punch":
      return void launchBomb(state, action.bomb, p.facing);
    case "kick":
      return slideBomb(action.bomb, p.facing, KICK_INTERVAL_TICKS);
    case "detonate":
      action.bomb.ticksLeft = 0;
  }
}

function throwBomb(state: GameState, p: Player) {
  const bomb = dropHeld(state, p);
  if (bomb) launchBomb(state, bomb, p.facing); // with nowhere to land it just stays at their feet
}

/**
 * Send a bomb flying `distance` tiles (wrapping round the arena); it lands on the first free tile from there.
 * Returns false when there is nowhere to land.
 */
function launchBomb(state: GameState, bomb: Bomb, dir: Dir, distance = THROW_DISTANCE, ticks = FLIGHT_TICKS): boolean {
  const d = DIR_VEC[dir];
  for (let k = distance; k < distance + state.width + state.height; k++) {
    const x = wrap(bomb.x + d.dx * k, state.width);
    const y = wrap(bomb.y + d.dy * k, state.height);
    if ((x !== bomb.x || y !== bomb.y) && slidesInto(state, x, y) && !isPortal(state, x, y)) {
      bomb.slide = null;
      bomb.flight = { toX: x, toY: y, dir, ticks: 0, total: ticks };
      return true;
    }
  }
  return false;
}

/**
 * A flying bomb touches down. Whoever it lands right on top of is left seeing stars and it bounces on
 * to the next free tile (as in the SNES games); anyone only brushing the tile may walk off it.
 */
function landBomb(state: GameState, b: Bomb) {
  const { toX, toY, dir } = b.flight!;
  b.x = toX;
  b.y = toY;
  b.flight = null;
  const heads = state.players.filter((p) => p.alive && !p.jump && Math.floor(p.x) === toX && Math.floor(p.y) === toY);
  if (heads.length > 0 && launchBomb(state, b, dir, 1, BOUNCE_TICKS)) {
    for (const p of heads) stun(state, p);
    return;
  }
  letStandersOff(state, b);
  if (flameAt(state, toX, toY)) b.ticksLeft = 0;
}

function stun(state: GameState, p: Player) {
  p.stunned = STUN_TICKS;
  p.moving = false;
  if (p.pet) p.pet.dashTicks = 0;
  dropHeld(state, p);
}

/** Sets a bomb sliding `dir`-wards, a tile every `interval` ticks, the first of them this very tick. */
function slideBomb(bomb: Bomb, dir: Dir, interval: number) {
  bomb.slide = dir;
  bomb.slideTimer = 1;
  bomb.slideInterval = interval;
}

/** Walking into a bomb with the boots sends it sliding the way we face. */
function tryKick(state: GameState, p: Player) {
  if (!p.kick) return;
  const d = DIR_VEC[p.facing];
  const bomb = bombAt(state, Math.floor(p.x) + d.dx, Math.floor(p.y) + d.dy);
  if (!bomb || bomb.slide || p.passing.includes(bomb.id)) return;
  slideBomb(bomb, p.facing, KICK_INTERVAL_TICKS);
}

// ------------------------------------------------------------------ pets

/** The mount's power, on its own key. Each power has a cooldown; a failed attempt costs nothing. */
function usePet(state: GameState, p: Player) {
  const pet = p.pet;
  if (!pet || pet.cooldown > 0 || p.holding !== null) return;
  const d = DIR_VEC[p.facing];
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const free = (x: number, y: number) => canPlaceAt(state, x, y);
  let used = false;

  switch (pet.kind) {
    case "runner":
      pet.dashTicks = DASH_TICKS;
      used = true;
      break;
    case "jumper": {
      // hop two tiles, over whatever is in between (the outer wall is never crossed: the landing must be free)
      const toX = tx + d.dx * 2;
      const toY = ty + d.dy * 2;
      if (free(toX, toY)) {
        p.jump = { fromX: p.x, fromY: p.y, toX: toX + 0.5, toY: toY + 0.5, ticks: 0, total: JUMP_TICKS };
        p.moving = true;
        used = true;
      }
      break;
    }
    case "pusher": {
      // shove the brick block in front one tile further
      const brick = { x: tx + d.dx, y: ty + d.dy };
      used = tileAt(state, brick.x, brick.y) === TILE.SOFT && shove(state, brick, { x: brick.x + d.dx, y: brick.y + d.dy });
      break;
    }
    case "kicker": {
      // a kick strong enough to send the bomb flying along the floor, boots or not: the one ahead, or failing that the one underfoot
      const bomb = bombAt(state, tx + d.dx, ty + d.dy) ?? bombAt(state, tx, ty);
      if (bomb) {
        slideBomb(bomb, p.facing, PET_KICK_INTERVAL_TICKS);
        used = true;
      }
      break;
    }
  }
  if (used) pet.cooldown = PET_COOLDOWN_TICKS[pet.kind];
}

function advanceJump(state: GameState, p: Player) {
  const j = p.jump!;
  j.ticks++;
  const t = Math.min(1, j.ticks / j.total);
  p.x = j.fromX + (j.toX - j.fromX) * t;
  p.y = j.fromY + (j.toY - j.fromY) * t;
  p.moving = true;
  if (j.ticks < j.total) return;
  p.jump = null;
  letOffBombs(state, p); // a bomb may have slid onto the landing spot meanwhile
}

/** Carried, flying and sliding bombs. */
function updateBombs(state: GameState) {
  for (const b of state.bombs) {
    if (b.held) {
      const carrier = state.players.find((p) => p.id === b.held);
      if (carrier?.alive) {
        b.x = Math.floor(carrier.x);
        b.y = Math.floor(carrier.y);
      }
      continue;
    }

    if (b.flight) {
      b.ticksLeft = Math.max(b.ticksLeft, 2); // never goes off mid-air
      if (++b.flight.ticks >= b.flight.total) landBomb(state, b);
      continue;
    }

    if (b.slide && --b.slideTimer <= 0) {
      const d = DIR_VEC[b.slide];
      const ahead = groundBombAt(state, b.x + d.dx, b.y + d.dy);
      if (ahead && isBuried(ahead)) ahead.ticksLeft = 0; // ran into a mine and set it off
      if (!moveBomb(state, b, b.slide)) {
        // a rubber bomb bounces back off walls, bricks and bombs (stopping at people, or when boxed in)
        const bounces = b.rubber && !personAt(state, b.x + d.dx, b.y + d.dy) && slidesInto(state, b.x - d.dx, b.y - d.dy);
        b.slide = bounces ? reverse(b.slide) : null;
      }
      b.slideTimer = b.slideInterval;
    }
  }
}

/** Whether a sliding bomb can move on into (x, y): open floor without a bomb on it. */
const slidesInto = (state: GameState, x: number, y: number) => tileAt(state, x, y) === TILE.EMPTY && !groundBombAt(state, x, y);

/** Whether anyone (alive) is standing on any part of tile (x, y). */
const personAt = (state: GameState, x: number, y: number) => state.players.some((p) => p.alive && overlapsTile(p.x, p.y, x, y));

const powerUpAt = (state: GameState, x: number, y: number) => state.powerUps.some((u) => u.x === x && u.y === y);

/**
 * Shoves the block on `from` (a brick, a crate) onto `to` if there's room: open floor, not a portal, with no
 * bomb, fire, item or anyone on it. Returns whether it moved.
 */
function shove(state: GameState, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  if (!canPlaceAt(state, to.x, to.y) || powerUpAt(state, to.x, to.y) || personAt(state, to.x, to.y)) return false;
  state.tiles[to.y * state.width + to.x] = state.tiles[from.y * state.width + from.x];
  state.tiles[from.y * state.width + from.x] = TILE.EMPTY;
  return true;
}

/**
 * Moves a lying bomb a tile `dir`-wards, out of the far end of a portal if it lands on one, and sets it off
 * if there's fire there. False (and it stays) when the way is shut: a wall, a bomb, someone standing
 * there, or the far end of the portal taken.
 */
function moveBomb(state: GameState, b: Bomb, dir: Dir): boolean {
  const d = DIR_VEC[dir];
  let x = b.x + d.dx;
  let y = b.y + d.dy;
  if (!slidesInto(state, x, y) || personAt(state, x, y)) return false;
  const exit = portalExit(state, y * state.width + x);
  if (exit !== null) {
    x = exit % state.width;
    y = Math.floor(exit / state.width);
    if (!slidesInto(state, x, y) || personAt(state, x, y)) return false;
  }
  b.x = x;
  b.y = y;
  if (flameAt(state, x, y)) b.ticksLeft = 0;
  return true;
}

const reverse = (d: Dir): Dir => dirFrom(-DIR_VEC[d].dx, -DIR_VEC[d].dy)!;

/** An opponent stepping on a buried mine sets it off; its owner walks over it safely. */
function triggerMines(state: GameState) {
  for (const b of state.bombs) {
    if (!isBuried(b)) continue;
    const stepped = state.players.some((p) => p.alive && !p.jump && p.id !== b.owner && Math.floor(p.x) === b.x && Math.floor(p.y) === b.y);
    if (stepped) b.ticksLeft = 0;
  }
}

function updatePassing(state: GameState, p: Player) {
  if (p.passing.length === 0) return;
  p.passing = p.passing.filter((id) => {
    const b = state.bombs.find((o) => o.id === id);
    return b !== undefined && overlapsTile(p.x, p.y, b.x, b.y);
  });
}

function addFlame(state: GameState, x: number, y: number, arms: number, owner: string) {
  const existing = flameAt(state, x, y);
  if (existing) {
    existing.arms |= arms;
    existing.ticksLeft = FLAME_TICKS;
    existing.owner = owner;
  } else {
    state.flames.push({ x, y, arms, ticksLeft: FLAME_TICKS, owner });
  }
  const pu = state.powerUps.findIndex((u) => u.x === x && u.y === y);
  if (pu >= 0) state.powerUps.splice(pu, 1);
}

function pickPowerUp(state: GameState): PowerUpKind {
  const entries = Object.entries(POWERUP_WEIGHTS) as [PowerUpKind, number][];
  let roll = nextRandom(state) * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [kind, weight] of entries) {
    roll -= weight;
    if (roll < 0) return kind;
  }
  return entries[0][0];
}

/** Detonate `start` and every bomb its flames reach, in a single tick. */
function explode(state: GameState, start: Bomb) {
  const queue: Bomb[] = [start];
  const exploded = new Set<number>();
  const burnt = new Set<number>();

  while (queue.length > 0) {
    const bomb = queue.shift()!;
    if (exploded.has(bomb.id)) continue;
    exploded.add(bomb.id);
    const owner = state.players.find((p) => p.id === bomb.owner);
    if (owner) owner.bombsActive = Math.max(0, owner.bombsActive - 1);

    let centerArms = 0;
    for (const d of BLAST_DIRS) {
      for (let i = 1; i <= bomb.range; i++) {
        const x = bomb.x + d.dx * i;
        const y = bomb.y + d.dy * i;
        const tile = tileAt(state, x, y);
        if (stopsBlast(tile)) break;

        const hit = state.bombs.find((o) => o.x === x && o.y === y && !o.flight && !exploded.has(o.id));
        const stops = (tile === TILE.SOFT && !bomb.pierce) || hit !== undefined;
        const last = stops || i === bomb.range;
        addFlame(state, x, y, d.back | (last ? 0 : d.arm), bomb.owner);
        if (i === 1) centerArms |= d.arm;
        if (tile === TILE.SOFT) {
          burnt.add(y * state.width + x);
          if (!bomb.pierce) break;
        }
        if (hit) {
          queue.push(hit);
          break;
        }
      }
    }
    addFlame(state, bomb.x, bomb.y, centerArms, bomb.owner);
  }

  state.bombs = state.bombs.filter((b) => !exploded.has(b.id));

  for (const i of [...burnt].sort((a, b) => a - b)) {
    state.tiles[i] = TILE.EMPTY;
    if (nextRandom(state) < POWERUP_DROP_CHANCE) {
      state.powerUps.push({
        x: i % state.width,
        y: Math.floor(i / state.width),
        kind: pickPowerUp(state),
      });
    }
  }
}

// --------------------------------------------------------- special floors

/** Belt codes in a map's rows, in the order of BELT_DIRS. */
const BELT_CHARS = "^>v<";

/** The floor a map character stands for (see MapDef.rows); plain for any other. */
export function floorCode(ch: string): number {
  if (ch === "~") return FLOOR.ICE;
  if (ch === "*") return FLOOR.VENT;
  if (ch.length === 1 && BELT_CHARS.includes(ch)) return FLOOR.BELT + BELT_CHARS.indexOf(ch);
  if (ch >= "A" && ch <= "Z") return FLOOR.PORTAL + ch.charCodeAt(0) - "A".charCodeAt(0);
  return FLOOR.PLAIN;
}

/** The floor code of cell (x, y): plain outside the arena and on maps without special floors. */
export function floorAt(state: GameState, x: number, y: number): number {
  if (!state.floor || x < 0 || y < 0 || x >= state.width || y >= state.height) return FLOOR.PLAIN;
  return state.floor[y * state.width + x];
}

/** The way the belt on (x, y) runs, or null if there is none. */
export function beltAt(state: GameState, x: number, y: number): Dir | null {
  const i = floorAt(state, x, y) - FLOOR.BELT;
  return i >= 0 && i < BELT_DIRS.length ? BELT_DIRS[i] : null;
}

export const isPortal = (state: GameState, x: number, y: number) => floorAt(state, x, y) >= FLOOR.PORTAL;

/** Each portal cell and the one at its other end, per floor (the floor never changes during a match). */
const portalPairs = new WeakMap<number[], Map<number, number>>();

/** The cell (index) at the other end of the portal on `cell`, or null if there's no portal there. */
export function portalExit(state: GameState, cell: number): number | null {
  if (!state.floor) return null;
  let pairs = portalPairs.get(state.floor);
  if (!pairs) {
    const ends = new Map<number, number[]>();
    state.floor.forEach((f, i) => f >= FLOOR.PORTAL && ends.set(f, [...(ends.get(f) ?? []), i]));
    pairs = new Map();
    for (const [a, b] of ends.values()) {
      if (b === undefined) continue;
      pairs.set(a, b);
      pairs.set(b, a);
    }
    portalPairs.set(state.floor, pairs);
  }
  return pairs.get(cell) ?? null;
}

/** Stepping onto a portal from another cell puts the bomber in the middle of its other end. */
function takePortal(state: GameState, p: Player, from: number) {
  const cell = Math.floor(p.y) * state.width + Math.floor(p.x);
  const exit = cell === from ? null : portalExit(state, cell);
  if (exit === null) return;
  p.x = (exit % state.width) + 0.5;
  p.y = Math.floor(exit / state.width) + 0.5;
  letOffBombs(state, p);
}

/** A belt carries whoever stands on it along, drawing them onto its lane, unless something is in the way. */
function rideBelt(state: GameState, p: Player) {
  const dir = beltAt(state, Math.floor(p.x), Math.floor(p.y));
  if (!dir) return;
  const d = DIR_VEC[dir];
  const s = BELT_SPEED / TICK_RATE;
  if (!blockedAt(state, p, p.x + d.dx * s, p.y + d.dy * s)) {
    p.x += d.dx * s;
    p.y += d.dy * s;
  }
  const cross = d.dx !== 0 ? "y" : "x";
  slide(state, p, cross, Math.floor(p[cross]) + 0.5, s);
}

/** Every BELT_CARRY_TICKS, belts move the bombs and items lying on them a tile on, where there's room. */
function carryOnBelts(state: GameState) {
  if (!state.floor || state.tick % BELT_CARRY_TICKS !== 0) return;
  for (const b of state.bombs) {
    const dir = b.slide || b.flight || b.held || isBuried(b) ? null : beltAt(state, b.x, b.y);
    if (dir) moveBomb(state, b, dir);
  }
  for (const u of state.powerUps) {
    const dir = beltAt(state, u.x, u.y);
    if (!dir) continue;
    const x = u.x + DIR_VEC[dir].dx;
    const y = u.y + DIR_VEC[dir].dy;
    if (canPlaceAt(state, x, y) && !powerUpAt(state, x, y)) Object.assign(u, { x, y });
  }
}

/** Where the match is in the lava vents' cycle: they erupt when it comes round to 0 (counted from "Go!"). */
export const ventCycle = (state: GameState) => wrap(state.tick - state.goTick, VENT_PERIOD_TICKS);

/** How many times the vents have erupted by `tick`, in a match that went "Go!" on `goTick`. */
export const eruptionsBy = (tick: number, goTick: number) => Math.max(0, Math.floor((tick - goTick) / VENT_PERIOD_TICKS));

/** The vents (cell indices) that erupt: those not covered by a block (a crate shoved on, a stone fallen in sudden death). */
export function liveVents(state: GameState): number[] {
  return state.floor?.flatMap((f, i) => (f === FLOOR.VENT && state.tiles[i] === TILE.EMPTY ? [i] : [])) ?? [];
}

/** Lava vents erupt all together every VENT_PERIOD_TICKS: fire nobody owns on each, setting off any bomb there. */
function eruptVents(state: GameState) {
  if (!state.floor || ventCycle(state) !== 0) return;
  for (const i of liveVents(state)) {
    const x = i % state.width;
    const y = Math.floor(i / state.width);
    addFlame(state, x, y, 0, "");
    const bomb = groundBombAt(state, x, y);
    if (bomb) bomb.ticksLeft = 0;
  }
}

// ---------------------------------------------------------- revenge ghosts

export interface BorderTile {
  x: number;
  y: number;
  /** the way into the arena from this tile */
  inward: Dir;
  /** the way round the wall, clockwise, from this tile */
  cw: { dx: number; dy: number };
}

const ringCache = new Map<number, BorderTile[]>();

/** The outer wall clockwise from the top-left, corners left out (there is nowhere to throw from them). */
export function borderRing(width: number, height: number): BorderTile[] {
  return bySize(ringCache, width, height, () => {
    const ring: BorderTile[] = [];
    for (let x = 1; x < width - 1; x++) ring.push({ x, y: 0, inward: "down", cw: DIR_VEC.right });
    for (let y = 1; y < height - 1; y++) ring.push({ x: width - 1, y, inward: "left", cw: DIR_VEC.down });
    for (let x = width - 2; x > 0; x--) ring.push({ x, y: height - 1, inward: "up", cw: DIR_VEC.left });
    for (let y = height - 2; y > 0; y--) ring.push({ x: 0, y, inward: "right", cw: DIR_VEC.up });
    return ring;
  });
}

/** Index of the wall tile closest to (x, y). */
export function nearestBorderIndex(state: GameState, x: number, y: number): number {
  const ring = borderRing(state.width, state.height);
  let best = 0;
  let bestDistance = Infinity;
  ring.forEach((t, i) => {
    const d = (t.x + 0.5 - x) ** 2 + (t.y + 0.5 - y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

/** A ghost walks along the wall with the direction keys and lobs a bomb inward with the bomb key. */
function stepGhost(state: GameState, p: Player, input: Partial<Input> | undefined) {
  const ghost = p.ghost!;
  const ring = borderRing(state.width, state.height);
  if (ghost.moveTimer > 0) ghost.moveTimer--;
  if (ghost.cooldown > 0) ghost.cooldown--;

  const { cw } = ring[ghost.pos];
  const along = Math.sign((input?.dx ?? 0) * cw.dx + (input?.dy ?? 0) * cw.dy);
  if (along !== 0 && ghost.moveTimer === 0) {
    ghost.pos = wrap(ghost.pos + along, ring.length);
    ghost.moveTimer = GHOST_MOVE_TICKS;
  }
  const tile = ring[ghost.pos];
  p.x = tile.x + 0.5;
  p.y = tile.y + 0.5;
  p.facing = tile.inward;

  if (input?.bomb && ghost.cooldown === 0 && p.bombsActive === 0) {
    launchBomb(state, newBomb(state, p, tile.x, tile.y, GHOST_BOMB_RANGE, true), tile.inward);
    ghost.cooldown = GHOST_THROW_COOLDOWN_TICKS;
  }
}

// ------------------------------------------------------------- movement

/** Whether this player can't walk into tile (tx, ty) (stone, crates, bricks without wall-pass, and bombs unless passing through them). */
export function solidFor(state: GameState, p: Player, tx: number, ty: number): boolean {
  const tile = tileAt(state, tx, ty);
  if (stopsBlast(tile) || (tile === TILE.SOFT && !p.wallPass)) return true;
  if (p.bombPass) return false;
  const bomb = bombAt(state, tx, ty);
  return bomb !== undefined && !p.passing.includes(bomb.id);
}

function blockedAt(state: GameState, p: Player, x: number, y: number): boolean {
  const r = PLAYER_RADIUS;
  const x0 = Math.floor(x - r);
  const x1 = Math.floor(x + r - EPS);
  const y0 = Math.floor(y - r);
  const y1 = Math.floor(y + r - EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (solidFor(state, p, tx, ty)) return true;
    }
  }
  return false;
}

/** Walk along one axis (horizontal wins); when blocked, press flush and slide round corners. */
function movePlayer(state: GameState, p: Player, dx: number, dy: number, speedFactor = 1) {
  if (dx !== 0) dy = 0;
  p.moving = false;
  let leaning = false;
  if (dx === 0 && dy === 0) {
    p.push = 0;
    return;
  }

  const before = { x: p.x, y: p.y };
  const s = Math.min(MAX_STEP_TILES, (playerSpeed(p) * speedFactor) / TICK_RATE);
  const r = PLAYER_RADIUS;
  const main = dx !== 0 ? "x" : "y"; // axis we walk along
  const cross = main === "x" ? "y" : "x"; // axis we may slide on to round a corner
  const d = dx || dy;

  const next = p[main] + d * s;
  if (!blockedAt(state, p, main === "x" ? next : p.x, main === "y" ? next : p.y)) {
    p[main] = next;
  } else {
    const flush = d > 0 ? Math.floor(next + r) - r - EPS : Math.floor(next - r) + 1 + r + EPS;
    p[main] = d > 0 ? Math.max(p[main], flush) : Math.min(p[main], flush);
    tryKick(state, p);
    leaning = leanOnCrate(state, p, main, d);
    const lane = Math.floor(p[cross]);
    const ahead = Math.floor(p[main]) + d;
    const aheadBlocked = main === "x" ? solidFor(state, p, ahead, lane) : solidFor(state, p, lane, ahead);
    if (!aheadBlocked) slide(state, p, cross, lane + 0.5, s);
  }

  if (!leaning) p.push = 0;
  p.moving = Math.abs(p.x - before.x) > EPS || Math.abs(p.y - before.y) > EPS;
}

/** Walking into a crate, lined up with it: after PUSH_TICKS of that it's shoved a tile on. Returns whether the bomber leans on one. */
function leanOnCrate(state: GameState, p: Player, main: "x" | "y", d: number): boolean {
  const cross = main === "x" ? "y" : "x";
  const lane = Math.floor(p[cross]);
  if (Math.abs(p[cross] - (lane + 0.5)) > PUSH_ALIGN) return false;
  const ahead = Math.floor(p[main]) + d;
  const at = (k: number) => (main === "x" ? { x: k, y: lane } : { x: lane, y: k });
  const crate = at(ahead);
  if (tileAt(state, crate.x, crate.y) !== TILE.CRATE) return false;
  if (++p.push >= PUSH_TICKS && shove(state, crate, at(ahead + d))) p.push = 0;
  return true;
}

function slide(state: GameState, p: Player, axis: "x" | "y", target: number, max: number) {
  const delta = target - p[axis];
  const move = Math.max(-max, Math.min(max, delta));
  if (Math.abs(move) < EPS) return;
  const nx = axis === "x" ? p.x + move : p.x;
  const ny = axis === "y" ? p.y + move : p.y;
  if (!blockedAt(state, p, nx, ny)) {
    p.x = nx;
    p.y = ny;
  }
}
