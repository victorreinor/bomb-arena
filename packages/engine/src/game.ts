import {
  AUTO_BOMB_INTERVAL_TICKS,
  BASE_SPEED,
  BOMB_FUSE_TICKS,
  DISEASE_TICKS,
  FAST_FACTOR,
  FLAME_TICKS,
  FLIGHT_TICKS,
  INVULN_TICKS,
  KICK_INTERVAL_TICKS,
  MAX_BOMBS,
  MAX_LINE_CHARGES,
  MAX_RANGE,
  MAX_SPEED_LEVEL,
  PLAYER_RADIUS,
  POWERUP_DROP_CHANCE,
  POWERUP_WEIGHTS,
  REMOTE_FUSE_TICKS,
  SLOW_FACTOR,
  SPEED_STEP,
  START_BOMBS,
  START_RANGE,
  THROW_DISTANCE,
  TICK_RATE,
} from "./constants";
import { SPAWN_ORDER } from "./maps";
import { nextRandom } from "./rng";
import {
  ABILITY_FIELDS,
  BLAST_DIRS,
  DIR_VEC,
  DISEASE_KINDS,
  TILE,
  dirFrom,
  isAbility,
  type Bomb,
  type CreateGameOptions,
  type Dir,
  type GameState,
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

/** Wrap a coordinate round the arena (thrown bombs leave one edge and come back on the other). */
export function wrap(v: number, size: number): number {
  return ((v % size) + size) % size;
}

function flameAt(state: GameState, x: number, y: number): boolean {
  return state.flames.some((f) => f.x === x && f.y === y);
}

function burnFlames(state: GameState) {
  for (const f of state.flames) f.ticksLeft--;
  state.flames = state.flames.filter((f) => f.ticksLeft > 0);
}

export function createGame(opts: CreateGameOptions): GameState {
  const { map, players, seed } = opts;
  const height = map.rows.length;
  const width = map.rows[0].length;
  const state: GameState = {
    tick: 0,
    phase: "playing",
    winner: null,
    width,
    height,
    tiles: new Array(width * height).fill(TILE.EMPTY),
    players: [],
    bombs: [],
    flames: [],
    powerUps: [],
    nextBombId: 1,
    rng: seed >>> 0,
    mapId: map.id,
  };

  const spawns: { x: number; y: number }[] = [];
  map.rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`map ${map.id}: row ${y} has wrong width`);
    [...row].forEach((ch, x) => {
      const i = y * width + x;
      if (ch === "#") state.tiles[i] = TILE.HARD;
      else if (ch === "+") state.tiles[i] = TILE.SOFT;
      else if (ch === "o") state.tiles[i] = nextRandom(state) < map.softDensity ? TILE.SOFT : TILE.EMPTY;
      else if (ch >= "1" && ch <= "9") spawns[Number(ch) - 1] = { x, y };
    });
  });

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
      vest: false,
      invuln: 0,
      lineCharges: 0,
      disease: null,
      holding: null,
      diedAt: null,
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

/** Eliminate a player (blast, disconnect...); a carried bomb is dropped where they stood. */
export function killPlayer(state: GameState, p: Player) {
  p.alive = false;
  p.diedAt = state.tick;
  p.moving = false;
  p.disease = null;
  if (p.holding !== null) {
    const bomb = state.bombs.find((b) => b.id === p.holding);
    if (bomb) bomb.held = null;
    p.holding = null;
  }
}

export function step(state: GameState, inputs: Inputs = {}): void {
  state.tick++;
  if (state.phase !== "playing") {
    burnFlames(state); // let the last flames burn out so the final frame doesn't freeze mid-blast
    return;
  }

  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.invuln > 0) p.invuln--;
    if (p.disease && --p.disease.ticksLeft <= 0) p.disease = null;

    const input = inputs[p.id];
    const flip = p.disease?.kind === "reverse" ? -1 : 1;
    const dx = Math.sign(input?.dx ?? 0) * flip;
    const dy = Math.sign(input?.dy ?? 0) * flip;
    p.facing = dirFrom(dx, dy) ?? p.facing;

    if (p.disease?.kind === "autoBomb" && state.tick % AUTO_BOMB_INTERVAL_TICKS === 0) placeBomb(state, p);
    if (input?.action) doAction(state, p);
    if (input?.bomb) placeBomb(state, p);
    movePlayer(state, p, dx, dy);
    updatePassing(state, p);
  }

  updateBombs(state);
  burnFlames(state);

  for (const b of state.bombs) b.ticksLeft--;
  for (let due = state.bombs.find((b) => b.ticksLeft <= 0); due; due = state.bombs.find((b) => b.ticksLeft <= 0)) {
    explode(state, due);
  }

  for (const p of state.players) {
    if (!p.alive) continue;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (p.invuln === 0 && flameAt(state, tx, ty)) {
      if (!p.vest) {
        killPlayer(state, p);
        continue;
      }
      p.vest = false;
      p.invuln = INVULN_TICKS;
    }
    const pu = state.powerUps.findIndex((u) => u.x === tx && u.y === ty);
    if (pu >= 0) {
      applyPowerUp(state, p, state.powerUps[pu].kind);
      state.powerUps.splice(pu, 1);
    }
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
    case "skull": {
      const kindOfCurse = DISEASE_KINDS[Math.floor(nextRandom(state) * DISEASE_KINDS.length)];
      p.disease = { kind: kindOfCurse, ticksLeft: DISEASE_TICKS };
      break;
    }
  }
}

// ---------------------------------------------------------------- bombs

/** A bomb that stands on a tile and blocks it (not one in the air or in someone's hands). */
function bombAt(state: GameState, x: number, y: number): Bomb | undefined {
  return state.bombs.find((b) => b.x === x && b.y === y && !b.flight && !b.held);
}

function overlapsTile(px: number, py: number, tx: number, ty: number): boolean {
  const reach = 0.5 + PLAYER_RADIUS - EPS;
  return Math.abs(px - (tx + 0.5)) < reach && Math.abs(py - (ty + 0.5)) < reach;
}

function canPlaceAt(state: GameState, x: number, y: number): boolean {
  return tileAt(state, x, y) === TILE.EMPTY && !bombAt(state, x, y) && !flameAt(state, x, y);
}

function newBomb(state: GameState, p: Player, x: number, y: number, range: number): Bomb {
  const bomb: Bomb = {
    id: state.nextBombId++,
    owner: p.id,
    x,
    y,
    ticksLeft: p.remote ? REMOTE_FUSE_TICKS : BOMB_FUSE_TICKS,
    range,
    remote: p.remote,
    power: false,
    slide: null,
    slideTimer: 0,
    held: null,
    flight: null,
  };
  state.bombs.push(bomb);
  p.bombsActive++;
  for (const other of state.players) {
    if (other.alive && overlapsTile(other.x, other.y, x, y)) other.passing.push(bomb.id);
  }
  return bomb;
}

function placeBomb(state: GameState, p: Player) {
  if (p.holding !== null) return void throwBomb(state, p); // pressing bomb again lobs the one you carry
  if (p.disease?.kind === "noBomb") return;
  const available = p.bombsMax - p.bombsActive;
  if (available <= 0) return;

  const range = p.disease?.kind === "shortRange" ? 1 : p.range;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);

  if (p.lineCharges > 0 && available >= 2) {
    // line bomb: every spare bomb, one tile apart, in the direction we face
    const d = DIR_VEC[p.facing];
    let placed = 0;
    for (let i = 0; i < available && canPlaceAt(state, tx + d.dx * i, ty + d.dy * i); i++) {
      newBomb(state, p, tx + d.dx * i, ty + d.dy * i, range);
      placed++;
    }
    if (placed >= 2) p.lineCharges--;
    if (placed > 0) return;
  }

  if (!canPlaceAt(state, tx, ty)) return;
  const power = p.powerBomb && p.bombsActive === 0 && p.disease?.kind !== "shortRange";
  const bomb = newBomb(state, p, tx, ty, power ? MAX_RANGE : range);
  bomb.power = power;
}

// ----------------------------------------------------- special abilities

/** The contextual button: throw > lift (glove) > punch > detonate (remote). */
function doAction(state: GameState, p: Player) {
  if (p.holding !== null) return void throwBomb(state, p);

  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (p.glove) {
    const under = bombAt(state, tx, ty);
    if (under) {
      under.held = p.id;
      under.slide = null;
      p.holding = under.id;
      return;
    }
  }
  if (p.punch) {
    const d = DIR_VEC[p.facing];
    const ahead = bombAt(state, tx + d.dx, ty + d.dy);
    if (ahead) return void launchBomb(state, ahead, p.facing);
  }
  if (p.remote) {
    // state.bombs is kept in id order, so the first match is the oldest
    const next = state.bombs.find((b) => b.owner === p.id && b.remote && !b.flight);
    if (next) next.ticksLeft = 0;
  }
}

function throwBomb(state: GameState, p: Player) {
  const bomb = state.bombs.find((b) => b.id === p.holding);
  p.holding = null;
  if (!bomb) return;
  bomb.held = null;
  bomb.x = Math.floor(p.x);
  bomb.y = Math.floor(p.y);
  launchBomb(state, bomb, p.facing);
}

/** Send a bomb flying THROW_DISTANCE tiles (wrapping round the arena); it lands on the first free tile from there. */
function launchBomb(state: GameState, bomb: Bomb, dir: Dir) {
  const d = DIR_VEC[dir];
  let toX = bomb.x;
  let toY = bomb.y;
  for (let k = THROW_DISTANCE; k < THROW_DISTANCE + state.width + state.height; k++) {
    const x = wrap(bomb.x + d.dx * k, state.width);
    const y = wrap(bomb.y + d.dy * k, state.height);
    const clear = tileAt(state, x, y) === TILE.EMPTY && !bombAt(state, x, y);
    if (clear) {
      toX = x;
      toY = y;
      break;
    }
  }
  bomb.slide = null;
  bomb.flight = { toX, toY, ticks: 0, total: FLIGHT_TICKS };
}

/** Walking into a bomb with the boots sends it sliding the way we face. */
function tryKick(state: GameState, p: Player) {
  if (!p.kick) return;
  const d = DIR_VEC[p.facing];
  const bomb = bombAt(state, Math.floor(p.x) + d.dx, Math.floor(p.y) + d.dy);
  if (!bomb || bomb.slide || p.passing.includes(bomb.id)) return;
  bomb.slide = p.facing;
  bomb.slideTimer = 1;
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
      if (++b.flight.ticks >= b.flight.total) {
        b.x = b.flight.toX;
        b.y = b.flight.toY;
        b.flight = null;
        if (flameAt(state, b.x, b.y)) b.ticksLeft = 0;
      }
      continue;
    }

    if (b.slide && --b.slideTimer <= 0) {
      const d = DIR_VEC[b.slide];
      const nx = b.x + d.dx;
      const ny = b.y + d.dy;
      const blocked =
        tileAt(state, nx, ny) !== TILE.EMPTY ||
        bombAt(state, nx, ny) !== undefined ||
        state.players.some((p) => p.alive && overlapsTile(p.x, p.y, nx, ny));
      if (blocked) {
        b.slide = null;
      } else {
        b.x = nx;
        b.y = ny;
        b.slideTimer = KICK_INTERVAL_TICKS;
        if (flameAt(state, nx, ny)) b.ticksLeft = 0;
      }
    }
  }
}

function updatePassing(state: GameState, p: Player) {
  if (p.passing.length === 0) return;
  p.passing = p.passing.filter((id) => {
    const b = state.bombs.find((o) => o.id === id);
    return b !== undefined && overlapsTile(p.x, p.y, b.x, b.y);
  });
}

function addFlame(state: GameState, x: number, y: number, arms: number) {
  const existing = state.flames.find((f) => f.x === x && f.y === y);
  if (existing) {
    existing.arms |= arms;
    existing.ticksLeft = FLAME_TICKS;
  } else {
    state.flames.push({ x, y, arms, ticksLeft: FLAME_TICKS });
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
        if (tile === TILE.HARD) break;

        const hit = state.bombs.find((o) => o.x === x && o.y === y && !o.flight && !exploded.has(o.id));
        const stops = tile === TILE.SOFT || hit !== undefined;
        const last = stops || i === bomb.range;
        addFlame(state, x, y, d.back | (last ? 0 : d.arm));
        if (i === 1) centerArms |= d.arm;
        if (tile === TILE.SOFT) {
          burnt.add(y * state.width + x);
          break;
        }
        if (hit) {
          queue.push(hit);
          break;
        }
      }
    }
    addFlame(state, bomb.x, bomb.y, centerArms);
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

// ------------------------------------------------------------- movement

function solidFor(state: GameState, p: Player, tx: number, ty: number): boolean {
  const tile = tileAt(state, tx, ty);
  if (tile === TILE.HARD || (tile === TILE.SOFT && !p.wallPass)) return true;
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
function movePlayer(state: GameState, p: Player, dx: number, dy: number) {
  if (dx !== 0) dy = 0;
  p.moving = false;
  if (dx === 0 && dy === 0) return;

  const before = { x: p.x, y: p.y };
  const s = playerSpeed(p) / TICK_RATE;
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
    const lane = Math.floor(p[cross]);
    const ahead = Math.floor(p[main]) + d;
    const aheadBlocked = main === "x" ? solidFor(state, p, ahead, lane) : solidFor(state, p, lane, ahead);
    if (!aheadBlocked) slide(state, p, cross, lane + 0.5, s);
  }

  p.moving = Math.abs(p.x - before.x) > EPS || Math.abs(p.y - before.y) > EPS;
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
