import { BOMB_FUSE_TICKS, TICK_RATE } from "./constants";
import {
  blastCells,
  bombAt,
  bombRangeFor,
  borderRing,
  canDropBomb,
  canPlaceAt,
  isBuried,
  nearestBorderIndex,
  playerSpeed,
  solidFor,
  wrap,
} from "./game";
import { nextRandom, pickRandom } from "./rng";
import { BLAST_DIRS, DIR_VEC, TILE, emptyInput, type Bomb, type GameState, type Input, type Player } from "./types";

/**
 * A computer opponent. Each tick it looks at the board as it understands it and decides, in order:
 *   1. standing where a blast will reach -> run for a safe tile (and keep running for that one);
 *   2. a bomb here would hit bricks or an enemy, and there is a way out -> drop it, after a moment's thought;
 *   3. otherwise keep heading for its current goal (an item, a brick to break, an enemy), picking a new
 *      one now and then; never through a cell a blast is due on.
 * Its level makes it more or less human: how long it takes to notice other people's bombs, how often it
 * rethinks, how long it hesitates before dropping, whether it sometimes freezes when in danger, and
 * whether it goes after people at all.
 * What it remembers lives with the match (see `brainFor`), and its dice are its own, seeded from the match,
 * so it plays the same online and offline. Blast and movement rules come from the engine, never copied.
 */

const botPrefix = "bot-";
export const botId = (n: number) => `${botPrefix}${n}`;
export const isBotId = (id: string) => id.startsWith(botPrefix);
export const botName = (id: string) => `Bot ${id.slice(botPrefix.length)}`;

export const BOT_LEVELS = ["easy", "normal", "hard"] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const DEFAULT_BOT_LEVEL: BotLevel = "normal";
export const isBotLevel = (v: unknown): v is BotLevel => BOT_LEVELS.includes(v as BotLevel);

interface Profile {
  /** ticks before someone else's new bomb is noticed (give or take 40%); its own are known at once */
  reaction: number;
  /** ticks between choosing where to go next */
  rethink: number;
  /** ticks spent making up its mind before dropping a bomb: [min, max] */
  hesitate: readonly [number, number];
  /** chance of freezing for a moment on finding itself in danger */
  panic: number;
  /** chance, when there's nothing else to do, of going after the nearest enemy rather than strolling about */
  hunts: number;
  /** how many steps out of its way it goes for an item */
  itemReach: number;
  /** spare time, in tiles' worth of walking, it wants when slipping past a cell that will burn */
  margin: number;
}

const PROFILES: Record<BotLevel, Profile> = {
  easy: { reaction: 24, rethink: 15, hesitate: [8, 24], panic: 0.4, hunts: 0.3, itemReach: 3, margin: 0.5 },
  normal: { reaction: 10, rethink: 9, hesitate: [3, 10], panic: 0.1, hunts: 1, itemReach: 6, margin: 1.5 },
  hard: { reaction: 4, rethink: 4, hesitate: [0, 2], panic: 0, hunts: 1, itemReach: 8, margin: 2 },
};

/** someone else's remote bombs can go off whenever they like: treat them as about to */
const REMOTE_DANGER_TICKS = 20;
/** bombing spots checked for an escape route per tick, nearest first */
const MAX_SPOT_CHECKS = 6;
/** how long a moment of panic lasts: [min, max] ticks */
const PANIC_TICKS = [4, 12] as const;
/** how far (in steps) a bot with nothing to do strolls: far enough to look like it's going somewhere */
const WANDER_STEPS = [3, 8] as const;
/** how long a bot sticks to chasing the same enemy before looking around for a nearer one */
const PREY_TICKS = 3 * TICK_RATE;
/** a hunter this close (in tiles, as the crow flies) to its prey stops and waits for a chance to bomb */
const CLOSE_ENOUGH = 1.5;
/** how close to a cell's middle counts as standing on it */
const CENTRED = 0.12;
const NEVER = Infinity;

/**
 * Ticks until fire reaches each cell (NEVER when nothing threatens it), chain reactions included.
 * Only bombs `known` counts are taken into account. Remote bombs could go off any moment, except to their
 * `owner`, who sets them off when it suits it.
 */
export function dangerMap(state: GameState, known: (b: Bomb) => boolean = () => true, owner: string | null = null): number[] {
  const danger = new Array<number>(state.width * state.height).fill(NEVER);
  for (const f of state.flames) danger[f.y * state.width + f.x] = 0;

  const bombs = state.bombs
    .filter((b) => !b.flight && !b.held && known(b))
    .map((b) => ({
      cell: b.y * state.width + b.x,
      time: b.remote && b.owner !== owner ? Math.min(b.ticksLeft, REMOTE_DANGER_TICKS) : b.ticksLeft,
      cells: blastCells(state, b.x, b.y, b.range, b.pierce),
      settled: false,
    }));
  const bombIn = new Map(bombs.map((b, i) => [b.cell, i]));

  // settle the earliest bomb first: anything its blast reaches goes off no later than it does
  for (let k = 0; k < bombs.length; k++) {
    let next = -1;
    for (let i = 0; i < bombs.length; i++) {
      if (!bombs[i].settled && (next < 0 || bombs[i].time < bombs[next].time)) next = i;
    }
    const b = bombs[next];
    b.settled = true;
    for (const cell of b.cells) {
      const j = bombIn.get(cell);
      if (j !== undefined && !bombs[j].settled) bombs[j].time = Math.min(bombs[j].time, b.time);
      danger[cell] = Math.min(danger[cell], b.time);
    }
  }
  return danger;
}

/** One full danger map per game tick, shared by every bot that has noticed every bomb. */
const dangerCache = new WeakMap<GameState, { tick: number; danger: number[] }>();
function dangerFor(state: GameState): number[] {
  const hit = dangerCache.get(state);
  if (hit && hit.tick === state.tick) return hit.danger;
  const danger = dangerMap(state);
  dangerCache.set(state, { tick: state.tick, danger });
  return danger;
}

/** What a bot carries from one tick to the next. */
interface Brain {
  profile: Profile;
  /** its own dice (mulberry32 state), so its choices don't disturb the match's */
  rng: { rng: number };
  /** tick from which each bomb (by id) is known about */
  noticeAt: Map<number, number>;
  fleeing: boolean;
  /** the safe cell it is running for */
  refuge: number | null;
  frozenUntil: number;
  droppedAt: number;
  /** when it will have made up its mind to drop the bomb it is thinking about */
  dropAt: number | null;
  /** the cell it is heading for, and when it will next reconsider */
  goal: number | null;
  rethinkAt: number;
  /** the goal is just a stroll: walked to the end rather than reconsidered on the way */
  strolling: boolean;
  /** the enemy it is going after, and until when */
  prey: string | null;
  preyUntil: number;
  /** as a ghost: since when an enemy has been in its sights */
  linedSince: number | null;
}

/** Brains live as long as their match: a new GameState starts every bot afresh. */
const brains = new WeakMap<GameState, Map<string, Brain>>();
function brainFor(state: GameState, id: string, level: BotLevel): Brain {
  let match = brains.get(state);
  if (!match) brains.set(state, (match = new Map()));
  let brain = match.get(id);
  if (!brain) {
    let seed = state.rng ^ 0x811c9dc5;
    for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 0x01000193);
    brain = {
      profile: PROFILES[level],
      rng: { rng: seed >>> 0 },
      noticeAt: new Map(),
      fleeing: false,
      refuge: null,
      frozenUntil: -1,
      droppedAt: -1,
      dropAt: null,
      goal: null,
      rethinkAt: -1,
      strolling: false,
      prey: null,
      preyUntil: -1,
      linedSince: null,
    };
    match.set(id, brain);
  }
  brain.profile = PROFILES[level];
  return brain;
}

/** A whole number of ticks in [min, max]. */
const between = (brain: Brain, [min, max]: readonly [number, number]) =>
  min + Math.floor(nextRandom(brain.rng) * (max - min + 1));

/**
 * The danger map as this bot sees it: its own bombs at once (its remote ones on their real fuse: it sets
 * them off itself), anyone else's once it has noticed them, and nobody else's buried mines (no one sees those).
 */
function perceivedDanger(state: GameState, p: Player, brain: Brain): number[] {
  const hidden = (b: Bomb) => isBuried(b) && b.owner !== p.id;
  let blind = state.bombs.some((b) => hidden(b) || (b.remote && b.owner === p.id));
  for (const b of state.bombs) {
    let at = brain.noticeAt.get(b.id);
    if (at === undefined) {
      const delay = b.owner === p.id ? 0 : Math.round(brain.profile.reaction * (0.6 + 0.8 * nextRandom(brain.rng)));
      at = state.tick + delay;
      brain.noticeAt.set(b.id, at);
    }
    if (at > state.tick) blind = true;
  }
  return blind ? dangerMap(state, (b) => !hidden(b) && brain.noticeAt.get(b.id)! <= state.tick, p.id) : dangerFor(state);
}

/** Where to run after dropping a bomb on `cell` (no blast reaches yet): the nearest cell every blast spares. */
function escapeFrom(state: GameState, p: Player, danger: number[], cell: number, margin: number): Visit | undefined {
  // the new bomb's fuse is the longest there is, so it can't set any other off sooner: overlaying its cells is exact
  const withBomb = danger.slice();
  for (const c of blastCells(state, cell % state.width, Math.floor(cell / state.width), bombRangeFor(p), p.pierceBomb)) {
    withBomb[c] = Math.min(withBomb[c], BOMB_FUSE_TICKS);
  }
  return explore(state, p, withBomb, cell, margin).find((v) => v.dist > 0 && withBomb[v.cell] === NEVER);
}

interface Visit {
  cell: number;
  dist: number;
  /** first step from the start towards this cell */
  first: number;
}

/**
 * Breadth-first walk from the bot's tile. Cells the fire will reach before the bot is `margin` tiles'
 * worth of walking past them are skipped, so (with margin to spare) every route it returns is one it can
 * survive. A margin of NEVER keeps out of every cell a blast is due on, however late.
 */
function explore(state: GameState, p: Player, danger: number[], start: number, margin: number): Visit[] {
  const ticksPerTile = TICK_RATE / playerSpeed(p);
  const seen = new Uint8Array(state.width * state.height);
  seen[start] = 1;
  const out: Visit[] = [{ cell: start, dist: 0, first: start }];
  // the whole board, never a horizon: a cut-off that moves with the bot moves its targets too
  for (let k = 0; k < out.length; k++) {
    const { cell, dist, first } = out[k];
    const x = cell % state.width;
    const y = Math.floor(cell / state.width);
    for (const d of BLAST_DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      const next = ny * state.width + nx;
      if (seen[next] || solidFor(state, p, nx, ny)) continue;
      const arrival = (dist + 1) * ticksPerTile;
      // the cell must not be burning when we pass, nor catch fire shortly after we arrive
      if (danger[next] !== NEVER && danger[next] < arrival + ticksPerTile * margin) continue;
      seen[next] = 1;
      out.push({ cell: next, dist: dist + 1, first: dist === 0 ? next : first });
    }
  }
  return out;
}

/**
 * How worthwhile a bomb dropped on `cell` would be: bricks it breaks, enemies it reaches. Nothing where the
 * rules won't let a bomb be laid (inside a brick, for one with wall-pass).
 */
function bombValue(state: GameState, p: Player, cell: number, enemyCells: ReadonlySet<number>): number {
  const x = cell % state.width;
  const y = Math.floor(cell / state.width);
  if (!canPlaceAt(state, x, y)) return 0;
  let value = 0;
  for (const c of blastCells(state, x, y, bombRangeFor(p), p.pierceBomb)) {
    if (enemyCells.has(c)) value += 4;
    else if (state.tiles[c] === TILE.SOFT) value += 1;
  }
  return value;
}
const NOBODY: ReadonlySet<number> = new Set();

/** Steer towards the middle of a neighbouring (or the current) cell, lining up on the cross axis first. */
function stepTowards(p: Player, cell: number, width: number): Input {
  const tx = cell % width;
  const ty = Math.floor(cell / width);
  const offX = p.x - (Math.floor(p.x) + 0.5);
  const offY = p.y - (Math.floor(p.y) + 0.5);
  const input = emptyInput();
  const goX = tx !== Math.floor(p.x);
  const goY = ty !== Math.floor(p.y);
  if (goX && Math.abs(offY) > CENTRED) input.dy = -Math.sign(offY);
  else if (goX) input.dx = Math.sign(tx - Math.floor(p.x));
  else if (goY && Math.abs(offX) > CENTRED) input.dx = -Math.sign(offX);
  else if (goY) input.dy = Math.sign(ty - Math.floor(p.y));
  else if (Math.abs(offX) > CENTRED) input.dx = -Math.sign(offX);
  else if (Math.abs(offY) > CENTRED) input.dy = -Math.sign(offY);
  return input;
}

const centred = (p: Player) =>
  Math.abs(p.x - (Math.floor(p.x) + 0.5)) <= CENTRED && Math.abs(p.y - (Math.floor(p.y) + 0.5)) <= CENTRED;

/** What the bot with this id does this tick. */
export function botInput(state: GameState, id: string, level: BotLevel = DEFAULT_BOT_LEVEL): Input {
  const p = state.players.find((o) => o.id === id);
  if (!p || state.phase !== "playing") return emptyInput();
  const brain = brainFor(state, id, level);
  if (!p.alive) return p.ghost ? ghostInput(state, p, brain) : emptyInput();
  if (p.jump || p.stunned > 0) return emptyInput();
  const input = decide(state, p, brain);
  // under the "reverse" curse it pushes the other way, so as to still go where it means to
  return p.disease?.kind === "reverse" ? { ...input, dx: -input.dx || 0, dy: -input.dy || 0 } : input;
}

function decide(state: GameState, p: Player, brain: Brain): Input {
  const width = state.width;
  const here = Math.floor(p.y) * width + Math.floor(p.x);
  const danger = perceivedDanger(state, p, brain);

  // 1. in harm's way: run for the closest safe cell, and keep running for it while it stays safe
  if (danger[here] !== NEVER) {
    brain.goal = null;
    brain.dropAt = null;
    if (!brain.fleeing) {
      brain.fleeing = true;
      brain.refuge = null;
      // people sometimes freeze for a moment, though not when running from a bomb they just dropped
      if (state.tick - brain.droppedAt > 2 && nextRandom(brain.rng) < brain.profile.panic) {
        brain.frozenUntil = state.tick + between(brain, PANIC_TICKS);
      }
    }
    if (state.tick < brain.frozenUntil) return emptyInput();
    const reachable = explore(state, p, danger, here, brain.profile.margin);
    const safe = (v: Visit) => danger[v.cell] === NEVER;
    const refuge = reachable.find((v) => v.cell === brain.refuge && safe(v)) ?? reachable.find(safe);
    brain.refuge = refuge?.cell ?? null;
    return refuge ? stepTowards(p, refuge.first, width) : emptyInput();
  }
  brain.fleeing = false;

  // out of reach of its remote bombs: set them off
  if (detonates(state, p)) return { ...emptyInput(), action: true };

  // 2. a good spot to bomb, with an escape route afterwards: make up its mind, settle in the middle, drop
  const canBomb = canDropBomb(p);
  const enemies = state.players.filter((o) => o.alive && o.id !== p.id);
  const enemyCells = new Set(enemies.map((e) => Math.floor(e.y) * width + Math.floor(e.x)));
  if (canBomb && bombValue(state, p, here, enemyCells) > 0) {
    const escape = escapeFrom(state, p, danger, here, brain.profile.margin);
    if (escape) {
      brain.dropAt ??= state.tick + between(brain, brain.profile.hesitate);
      if (state.tick < brain.dropAt || !centred(p)) return stepTowards(p, here, width);
      brain.dropAt = null;
      brain.goal = null;
      brain.droppedAt = state.tick;
      return { ...stepTowards(p, escape.first, width), bomb: true };
    }
  }
  brain.dropAt = null;

  // 3. keep heading for the current goal; choose another once it's reached, out of reach or due a rethink
  // (a stroll is walked to the end). Only along cells no blast is due on: stepping into one would send it
  // running back next tick, over and over
  const calm = explore(state, p, danger, here, NEVER);
  const keep = brain.strolling || state.tick < brain.rethinkAt;
  let goal = keep ? calm.find((v) => v.cell === brain.goal && v.dist > 0) : undefined;
  if (!goal) {
    goal = chooseGoal(state, p, brain, danger, calm, canBomb, enemies);
    brain.goal = goal?.cell ?? null;
    brain.rethinkAt = state.tick + brain.profile.rethink;
  }
  return stepTowards(p, goal ? goal.first : here, width);
}

/** Whether the action button would now set off one of its remote bombs (rather than lift or punch a bomb at hand). */
function detonates(state: GameState, p: Player): boolean {
  if (!p.remote || p.holding !== null || !state.bombs.some((b) => b.owner === p.id && b.remote && !b.flight)) return false;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const d = DIR_VEC[p.facing];
  return !(p.glove && bombAt(state, tx, ty)) && !(p.punch && bombAt(state, tx + d.dx, ty + d.dy));
}

/** Somewhere worth going: an item close by, a brick to break, or else the nearest enemy (or a stroll). */
function chooseGoal(
  state: GameState,
  p: Player,
  brain: Brain,
  danger: number[],
  calm: Visit[],
  canBomb: boolean,
  enemies: Player[],
): Visit | undefined {
  const width = state.width;
  const wanted = new Set(
    state.powerUps.filter((u) => u.kind !== "skull" && !(u.kind === "egg" && p.pet)).map((u) => u.y * width + u.x),
  );
  const errand =
    calm.find((v) => v.dist > 0 && v.dist <= brain.profile.itemReach && wanted.has(v.cell)) ??
    (canBomb ? bombingSpot(state, p, brain, danger, calm) : undefined);
  brain.strolling = !errand && nextRandom(brain.rng) >= brain.profile.hunts;
  return errand ?? (brain.strolling ? wander(calm, brain) : hunt(state, p, brain, calm, enemies));
}

/**
 * Where to go to get at its prey: one enemy, kept for a while, so that it isn't torn between two
 * whenever they shuffle about.
 */
function hunt(state: GameState, p: Player, brain: Brain, calm: Visit[], enemies: Player[]): Visit | undefined {
  const away = (e: Player) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
  let prey = state.tick < brain.preyUntil ? enemies.find((e) => e.id === brain.prey) : undefined;
  if (!prey) {
    prey = enemies.reduce<Player | undefined>((best, e) => (!best || away(e) < away(best) ? e : best), undefined);
    brain.prey = prey?.id ?? null;
    brain.preyUntil = state.tick + PREY_TICKS;
  }
  if (!prey) return undefined;
  // already on top of it: chasing the cell it is in would just be shuffling back and forth with it
  if (away(prey) < CLOSE_ENOUGH) return calm[0];
  return nearestTowards(prey, calm, state.width);
}

/**
 * The nearest cell where a bomb would break bricks and still leave a way out. Without that check two such
 * cells side by side, neither with an escape, would have the bot pacing between them. Enemies don't count
 * here: they move, and a goal that moves with them has the bot dithering (step 2 still bombs anyone in range).
 */
function bombingSpot(state: GameState, p: Player, brain: Brain, danger: number[], calm: Visit[]): Visit | undefined {
  let checked = 0;
  for (const v of calm) {
    if (v.dist === 0 || bombValue(state, p, v.cell, NOBODY) === 0) continue;
    if (escapeFrom(state, p, danger, v.cell, brain.profile.margin)) return v;
    if (++checked === MAX_SPOT_CHECKS) return undefined;
  }
  return undefined;
}

/**
 * The reachable cell closest, as the crow flies, to the enemy (the start, if already there).
 * Ties go to the lowest cell index rather than to search order, so the target doesn't shift as the bot walks.
 */
function nearestTowards(enemy: Player, reachable: Visit[], width: number): Visit | undefined {
  let best: Visit | undefined;
  let bestDistance = Infinity;
  for (const v of reachable) {
    const d = Math.abs(enemy.x - ((v.cell % width) + 0.5)) + Math.abs(enemy.y - (Math.floor(v.cell / width) + 0.5));
    if (d < bestDistance || (d === bestDistance && v.cell < best!.cell)) {
      bestDistance = d;
      best = v;
    }
  }
  return best;
}

/** Somewhere a few steps away to stroll to, for a bot with nothing better to do (it stays put if boxed in). */
function wander(calm: Visit[], brain: Brain): Visit | undefined {
  const [min, max] = WANDER_STEPS;
  const spots = calm.filter((v) => v.dist >= min && v.dist <= max);
  return spots.length > 0 ? pickRandom(brain.rng, spots) : undefined;
}

/** A ghost bot drifts along the wall towards the nearest enemy and, once it has taken aim, lobs a bomb. */
function ghostInput(state: GameState, p: Player, brain: Brain): Input {
  const ghost = p.ghost!;
  const ring = borderRing(state.width, state.height);
  const tile = ring[ghost.pos];
  const enemies = state.players.filter((o) => o.alive);
  if (enemies.length === 0) return emptyInput();
  const vertical = tile.inward === "down" || tile.inward === "up";
  const lined = enemies.some((e) => (vertical ? Math.floor(e.x) === tile.x : Math.floor(e.y) === tile.y));
  brain.linedSince = lined ? (brain.linedSince ?? state.tick) : null;
  const aimed = lined && state.tick - brain.linedSince! >= brain.profile.reaction / 2;
  if (aimed && ghost.cooldown === 0 && p.bombsActive === 0) return { ...emptyInput(), bomb: true };
  if (ghost.moveTimer > 0) return emptyInput(); // can't step yet anyway
  if (lined) return emptyInput(); // hold still while taking aim

  // walk the shorter way round to the wall tile nearest any enemy
  let target = ghost.pos;
  let best = Infinity;
  for (const e of enemies) {
    const i = nearestBorderIndex(state, e.x, e.y);
    const t = ring[i];
    const d = (e.x - (t.x + 0.5)) ** 2 + (e.y - (t.y + 0.5)) ** 2;
    if (d < best) {
      best = d;
      target = i;
    }
  }
  if (target === ghost.pos) return emptyInput();
  const sign = wrap(target - ghost.pos, ring.length) <= ring.length / 2 ? 1 : -1;
  return { ...emptyInput(), dx: tile.cw.dx * sign, dy: tile.cw.dy * sign };
}
