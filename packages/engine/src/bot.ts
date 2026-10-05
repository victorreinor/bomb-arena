import { BOMB_FUSE_TICKS, PLAYER_RADIUS, TICK_RATE, VENT_PERIOD_TICKS } from "./constants";
import {
  actionFor,
  beltAt,
  blastCells,
  bombRangeFor,
  bombsLaid,
  borderRing,
  canDropBomb,
  canPlaceAt,
  floorAt,
  isBuried,
  liveVents,
  nearestBorderIndex,
  playerSpeed,
  portalExit,
  solidFor,
  ventCycle,
  wrap,
} from "./game";
import { nextRandom, pickRandom } from "./rng";
import { BLAST_DIRS, DIR_VEC, FLOOR, TILE, emptyInput, type Bomb, type Dir, type GameState, type Input, type Player } from "./types";

/**
 * A computer opponent. Each tick it looks at the board as it understands it and decides, in order:
 *   1. standing where a blast will reach -> run for a safe tile (and keep running for that one);
 *   2. a bomb here would hit bricks or an enemy, and there is a way out -> drop it, after a moment's thought;
 *   3. otherwise keep heading for its current goal (an item, a brick to break, an enemy), picking a new
 *      one now and then; never through a cell a blast is due on.
 * It sees what anyone at the screen sees: every bomb, and everyone's items. What its level changes is how
 * well it uses that, the way people differ: how long it takes to notice someone else's bomb (or whether it
 * misses it until too late), whether it miscounts a long blast or overlooks a chain reaction, how long it
 * hesitates and whether it freezes, how well it picks a refuge, whether it drops a bomb with no way out,
 * and whether it minds what the enemy beside it could do. The easy one also hardly goes after people.
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
  /** chance of never noticing someone else's bomb at all (TUNNEL_VISION times that while running from another) */
  distracted: number;
  /** chance of reckoning a long blast (MISJUDGE_FROM tiles or more) a tile shorter than it is */
  misjudge: number;
  /** chance of not seeing that a bomb will go off early, set off by another's blast */
  chainBlind: number;
  /** ticks between choosing where to go next */
  rethink: number;
  /** ticks spent making up its mind before dropping a bomb: [min, max] */
  hesitate: readonly [number, number];
  /** chance of freezing on finding itself in danger, and for how long: [min, max] ticks */
  panic: number;
  freeze: readonly [number, number];
  /** chance, for each PREY_TICKS with nothing else to do, of going after the nearest enemy rather than strolling about */
  hunts: number;
  /** how many steps out of its way it goes for an item */
  itemReach: number;
  /** how many of the nearest spots to break bricks from it weighs up, to take the one nearest its prey: 1 just breaks the nearest */
  pursuit: number;
  /** spare time, in tiles' worth of walking, it wants when slipping past a cell that will burn */
  margin: number;
  /** how many of the nearest safe cells it picks its refuge from: 1 always runs for the nearest */
  refuges: number;
  /** chance, on coming to a cell where a bomb would do some good but leave no way out, of dropping it anyway */
  reckless: number;
  /** chance, every WARY_TICKS, of minding what the enemies near it could do: a bomb of theirs across its way out */
  wary: number;
}

const PROFILES: Record<BotLevel, Profile> = {
  easy: {
    reaction: 34, distracted: 0.22, misjudge: 0.25, chainBlind: 0.7, rethink: 15, hesitate: [8, 24], panic: 0.4, freeze: [15, 40],
    hunts: 0.3, itemReach: 3, pursuit: 1, margin: 0.5, refuges: 3, reckless: 0.09, wary: 0,
  },
  normal: {
    reaction: 12, distracted: 0.1, misjudge: 0.05, chainBlind: 0.25, rethink: 9, hesitate: [3, 10], panic: 0.15, freeze: [8, 20],
    hunts: 0.8, itemReach: 6, pursuit: 1, margin: 1.5, refuges: 2, reckless: 0.012, wary: 0.35,
  },
  hard: {
    reaction: 4, distracted: 0.015, misjudge: 0, chainBlind: 0, rethink: 4, hesitate: [0, 2], panic: 0, freeze: [0, 0],
    hunts: 1, itemReach: 8, pursuit: 6, margin: 2, refuges: 1, reckless: 0, wary: 1,
  },
};

/** running from one bomb, a bot is this many times likelier to miss the next */
const TUNNEL_VISION = 2;
/** a blast this many tiles long, or longer, is hard to count by eye */
const MISJUDGE_FROM = 4;
/** the least margin (tiles' worth of walking) that still gets a bot off a cell before it burns */
const DASH_MARGIN = 0.5;
/** a bot's wariness is settled anew this often (ticks) */
const WARY_TICKS = 3 * TICK_RATE;
/** an enemy this close (tiles, by rows and columns) is one a wary bot allows for */
const WARY_TILES = 3;
/** how many steps further than the nearest refuge a wary bot goes for one with more ways out */
const WARY_DETOUR = 2;
/** someone else's remote bombs can go off whenever they like: treat them as about to */
const REMOTE_DANGER_TICKS = 20;
/** a lava vent counts as dangerous for this long before it erupts: time enough to get off it */
const VENT_DANGER_TICKS = 2 * TICK_RATE;
/** bombing spots checked for an escape route per tick, nearest first */
const MAX_SPOT_CHECKS = 6;
/** how far (in steps) a bot with nothing to do strolls: far enough to look like it's going somewhere */
const WANDER_STEPS = [3, 8] as const;
/** how long a bot sticks to chasing the same enemy before looking around for a nearer one, or to strolling instead */
const PREY_TICKS = 3 * TICK_RATE;
/** a hunter this close (in tiles, as the crow flies) to its prey stops and waits for a chance to bomb */
const CLOSE_ENOUGH = 1.5;
/**
 * how close to a cell's middle counts as standing on it: as far off as someone pressed flush against a wall,
 * and a hair more, so that rounding never has a bot there nudging itself (on ice a nudge is a slide)
 */
const CENTRED = 0.5 - PLAYER_RADIUS + 1e-6;
const NEVER = Infinity;

/** How a bot sees the bombs on the board. Left out, each is seen as it is. */
export interface BombView {
  /** only these bombs are taken into account */
  known?: (b: Bomb) => boolean;
  /** this player's remote bombs keep their real fuse (it sets them off when it suits it); anyone else's could go off any moment */
  owner?: string | null;
  /** how far a bomb's blast is taken to go */
  reach?: (b: Bomb) => number;
  /** whether a bomb is seen to go off early when another's blast reaches it */
  chains?: (b: Bomb) => boolean;
}

/**
 * Ticks until fire reaches each cell (NEVER when nothing threatens it), chain reactions included, as `view`
 * has it: the board as it is by default, or the way a bot that is slow, careless or miscounting takes it.
 */
export function dangerMap(state: GameState, view: BombView = {}): number[] {
  const { known = () => true, owner = null, reach = (b: Bomb) => b.range, chains = () => true } = view;
  const danger = new Array<number>(state.width * state.height).fill(NEVER);
  for (const f of state.flames) danger[f.y * state.width + f.x] = 0;
  // lava vents about to erupt (and so, any bomb lying on one)
  const eruption = VENT_PERIOD_TICKS - ventCycle(state);
  if (eruption <= VENT_DANGER_TICKS) for (const i of liveVents(state)) danger[i] = Math.min(danger[i], eruption);

  const bombs = state.bombs
    .filter((b) => !b.flight && !b.held && known(b))
    .map((b) => ({
      cell: b.y * state.width + b.x,
      time: Math.min(
        b.ticksLeft,
        b.remote && b.owner !== owner ? REMOTE_DANGER_TICKS : NEVER,
        floorAt(state, b.x, b.y) === FLOOR.VENT ? eruption : NEVER,
      ),
      cells: blastCells(state, b.x, b.y, reach(b), b.pierce),
      chained: chains(b),
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
      if (j !== undefined && !bombs[j].settled && bombs[j].chained) bombs[j].time = Math.min(bombs[j].time, b.time);
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

/** What a bot makes of a bomb, settled the first time it could have seen it. */
interface Sight {
  /** tick from which it knows the bomb is there */
  at: number;
  /** how far it reckons the blast goes */
  reach: number;
  /** whether it sees that another bomb will set this one off early */
  chains: boolean;
}

/** What a bot carries from one tick to the next. */
interface Brain {
  profile: Profile;
  /** its own dice (mulberry32 state), so its choices don't disturb the match's */
  rng: { rng: number };
  /** what it makes of each bomb (by id) */
  seen: Map<number, Sight>;
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
  /** whether, with nothing else to do, it goes after someone or just strolls, and until when */
  hunting: boolean;
  moodUntil: number;
  /** as a ghost: since when an enemy has been in its sights */
  linedSince: number | null;
  /** the cell it last weighed a careless bomb on, and whether it will go through with it */
  rashCell: number | null;
  rash: boolean;
  /** whether it is minding what the enemies near it could do, and until when */
  alert: boolean;
  alertUntil: number;
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
      seen: new Map(),
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
      hunting: false,
      moodUntil: -1,
      linedSince: null,
      rashCell: null,
      rash: false,
      alert: false,
      alertUntil: -1,
    };
    match.set(id, brain);
  }
  brain.profile = PROFILES[level];
  return brain;
}

/** A whole number of ticks in [min, max]. */
const between = (brain: Brain, [min, max]: readonly [number, number]) =>
  min + Math.floor(nextRandom(brain.rng) * (max - min + 1));

/** A bot's first look at a bomb: its own it knows all about; anyone else's it may be slow to see, or get wrong. */
function glance(state: GameState, p: Player, brain: Brain, b: Bomb): Sight {
  if (b.owner === p.id) return { at: state.tick, reach: b.range, chains: true };
  const { reaction, distracted, misjudge, chainBlind } = brain.profile;
  const absent = nextRandom(brain.rng) < distracted * (brain.fleeing ? TUNNEL_VISION : 1);
  const delay = Math.round(reaction * (0.6 + 0.8 * nextRandom(brain.rng)));
  const short = nextRandom(brain.rng) < misjudge && b.range >= MISJUDGE_FROM;
  return { at: absent ? NEVER : state.tick + delay, reach: short ? b.range - 1 : b.range, chains: nextRandom(brain.rng) >= chainBlind };
}

/**
 * The danger map as this bot sees it: its own bombs at once and as they are (its remote ones on their real
 * fuse: it sets them off itself), anyone else's once it has noticed them and as it takes them to be, and
 * nobody else's buried mines (no one sees those).
 */
function perceivedDanger(state: GameState, p: Player, brain: Brain): number[] {
  const hidden = (b: Bomb) => isBuried(b) && b.owner !== p.id;
  let exact = true;
  for (const b of state.bombs) {
    let sight = brain.seen.get(b.id);
    if (!sight) brain.seen.set(b.id, (sight = glance(state, p, brain, b)));
    if (hidden(b) || (b.remote && b.owner === p.id) || sight.at > state.tick || sight.reach !== b.range || !sight.chains) exact = false;
  }
  if (exact) return dangerFor(state);
  const sight = (b: Bomb) => brain.seen.get(b.id)!;
  return dangerMap(state, {
    known: (b) => !hidden(b) && sight(b).at <= state.tick,
    owner: p.id,
    reach: (b) => sight(b).reach,
    chains: (b) => sight(b).chains,
  });
}

/** A bomb that isn't on the board (yet): the cell it would lie on and what it would burn. */
interface Planned {
  cell: number;
  blast: number[];
}
const NO_BOMBS: Planned[] = [];
const FACINGS = Object.keys(DIR_VEC) as Dir[];

/**
 * Where to run from `cell` (no blast reaches it yet) were `bombs` laid this tick: the nearest cell every
 * blast spares, not walking through any of them but the one on `cell` itself.
 */
function wayOut(state: GameState, p: Player, danger: number[], cell: number, margin: number, bombs: Planned[]): Visit | undefined {
  // a fresh bomb's fuse is the longest there is, so it can't set any other off sooner: overlaying its cells is exact
  const after = danger.slice();
  const blocked = new Set<number>();
  for (const b of bombs) {
    for (const c of b.blast) after[c] = Math.min(after[c], BOMB_FUSE_TICKS);
    if (b.cell !== cell) blocked.add(b.cell);
  }
  return explore(state, p, after, cell, margin, blocked).find((v) => v.dist > 0 && after[v.cell] === NEVER);
}

/** The way out after a bomb is laid on a cell, and which way to face laying it (null: whichever way it runs). */
interface Drop {
  escape: Visit;
  facing: Dir | null;
}

/**
 * Whether the bot could lay a bomb on `cell` and get away, allowing for `threats` as well. With a line
 * charge the bombs go in a row the way it faces (straight across its way out, if it faces that way), so it
 * looks for a way to face that leaves it one, laying as few as will do.
 */
function planDrop(state: GameState, p: Player, danger: number[], cell: number, margin: number, threats: Planned[]): Drop | undefined {
  const x = cell % state.width;
  const y = Math.floor(cell / state.width);
  const laid = (facing: Dir): Planned[] =>
    bombsLaid(state, p, facing, x, y).map((b) => ({ cell: b.y * state.width + b.x, blast: blastCells(state, b.x, b.y, b.range, p.pierceBomb) }));
  if (p.lineCharges === 0 || p.bombsMax - p.bombsActive < 2) {
    const escape = wayOut(state, p, danger, cell, margin, [...laid(p.facing), ...threats]);
    return escape && { escape, facing: null };
  }
  const rows = FACINGS.map((facing) => ({ facing, bombs: laid(facing) })).sort((a, b) => a.bombs.length - b.bombs.length);
  for (const { facing, bombs } of rows) {
    const escape = wayOut(state, p, danger, cell, margin, [...bombs, ...threats]);
    if (escape) return { escape, facing };
  }
  return undefined;
}

/**
 * The bombs a bot minding its enemies allows for: one from each of them near `cell` that could lay one,
 * where it stands. None for a bot that isn't minding them just now.
 */
function threatsNear(state: GameState, brain: Brain, cell: number, enemies: Player[]): Planned[] {
  if (!brain.alert) return NO_BOMBS;
  const width = state.width;
  const threats: Planned[] = [];
  for (const e of enemies) {
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (Math.abs(ex - (cell % width)) + Math.abs(ey - Math.floor(cell / width)) > WARY_TILES) continue;
    if (!canDropBomb(e) || !canPlaceAt(state, ex, ey)) continue;
    threats.push({ cell: ey * width + ex, blast: blastCells(state, ex, ey, bombRangeFor(e), e.pierceBomb) });
  }
  return threats;
}

/** Whether one of `threats` has the bot on `here` in its blast with no way out, were it laid now. */
function cornerable(state: GameState, p: Player, brain: Brain, danger: number[], here: number, threats: Planned[]): boolean {
  return threats.some((t) => t.blast.includes(here) && !wayOut(state, p, danger, here, brain.profile.margin, [t]));
}

/**
 * Where to run from the blast the bot stands in: the refuge it is already running for while that holds,
 * otherwise one of the nearest safe cells (the nearest for a bot that picks well, the roomiest for one
 * minding its enemies). Short of time for its usual margin, it cuts it as fine as will still do; with no
 * way out at all it makes for wherever the fire comes last, rather than stand and wait for it.
 */
function shelter(state: GameState, p: Player, brain: Brain, danger: number[], here: number, threats: Planned[]): Visit | undefined {
  const { margin, refuges } = brain.profile;
  const safe = (v: Visit) => danger[v.cell] === NEVER;
  const within = [explore(state, p, danger, here, margin)];
  const kept = (reachable: Visit[]) => reachable.find((v) => v.cell === brain.refuge && safe(v));
  let refuge = kept(within[0]);
  if (!refuge && margin > DASH_MARGIN) {
    within.push(explore(state, p, danger, here, DASH_MARGIN));
    refuge = kept(within[1]);
  }
  if (refuge) return refuge;
  for (const reachable of within) {
    const near = reachable.filter(safe);
    if (near.length === 0) continue;
    if (brain.alert) return roomiest(state, p, danger, near, threats);
    return refuges > 1 ? pickRandom(brain.rng, near.slice(0, refuges)) : near[0];
  }
  const anywhere = explore(state, p, new Array<number>(danger.length).fill(NEVER), here, 0);
  return anywhere.reduce((best, v) => (danger[v.cell] > danger[best.cell] ? v : best));
}

/** Of the safe cells about as near as the nearest, the one hardest to be shut into: most ways out, and out of the enemies' line of fire. */
function roomiest(state: GameState, p: Player, danger: number[], near: Visit[], threats: Planned[]): Visit {
  const width = state.width;
  const room = (v: Visit) => {
    const open = BLAST_DIRS.filter((d) => {
      const nx = (v.cell % width) + d.dx;
      const ny = Math.floor(v.cell / width) + d.dy;
      return !solidFor(state, p, nx, ny) && danger[ny * width + nx] === NEVER;
    }).length;
    return threats.some((t) => t.blast.includes(v.cell)) ? open - BLAST_DIRS.length : open;
  };
  let best = near[0];
  let most = room(best);
  for (const v of near) {
    if (v.dist <= near[0].dist + WARY_DETOUR && room(v) > most) {
      best = v;
      most = room(v);
    }
  }
  return best;
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
 * survive. A margin of NEVER keeps out of every cell a blast is due on, however late. `blocked` cells are
 * walked round like walls: the bombs that would be lying there.
 */
function explore(state: GameState, p: Player, danger: number[], start: number, margin: number, blocked: ReadonlySet<number> = NOBODY): Visit[] {
  const ticksPerTile = TICK_RATE / playerSpeed(p);
  const seen = new Uint8Array(state.width * state.height);
  seen[start] = 1;
  const out: Visit[] = [{ cell: start, dist: 0, first: start }];
  // the whole board, never a horizon: a cut-off that moves with the bot moves its targets too
  for (let k = 0; k < out.length; k++) {
    const { cell, dist, first } = out[k];
    const x = cell % state.width;
    const y = Math.floor(cell / state.width);
    // no cell on the way may be burning when we pass, nor the last one catch fire shortly after we arrive
    const burns = (c: number, steps: number) => danger[c] !== NEVER && danger[c] < (dist + steps) * ticksPerTile + ticksPerTile * margin;
    for (const d of BLAST_DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      const next = ny * state.width + nx;
      // most steps end on the cell stepped into; ice and portals carry the bot further
      const plain = floorAt(state, nx, ny) === FLOOR.PLAIN;
      if ((plain && seen[next]) || solidFor(state, p, nx, ny) || blocked.has(next)) continue;
      const path = plain ? null : stepPath(state, p, nx, ny, d);
      const end = path ? path[path.length - 1] : next;
      if (seen[end] || (path ? path.some((c, i) => burns(c, i + 1)) : burns(next, 1))) continue;
      seen[end] = 1;
      out.push({ cell: end, dist: dist + (path?.length ?? 1), first: dist === 0 ? next : first });
    }
  }
  return out;
}

/**
 * The cells a step into (x, y), going `d`-wards, really takes the bot through, the last being where it
 * comes to rest: on ice it slides on until the ice ends or something stops it, and a portal puts it out
 * at its far end.
 */
function stepPath(state: GameState, p: Player, x: number, y: number, d: { dx: number; dy: number }): number[] {
  const path = [y * state.width + x];
  while (floorAt(state, x, y) === FLOOR.ICE && !solidFor(state, p, x + d.dx, y + d.dy)) {
    x += d.dx;
    y += d.dy;
    path.push(y * state.width + x);
  }
  const exit = portalExit(state, path[path.length - 1]);
  if (exit !== null) path.push(exit);
  return path;
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
export function stepTowards(p: Player, cell: number, width: number): Input {
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

/** Stay on the cell it is on, settling into the middle of it; except on ice, where the least push is a slide all the way. */
function stay(state: GameState, p: Player, here: number): Input {
  return floorAt(state, Math.floor(p.x), Math.floor(p.y)) === FLOOR.ICE ? emptyInput() : stepTowards(p, here, state.width);
}

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
  if (state.tick >= brain.alertUntil) {
    brain.alert = nextRandom(brain.rng) < brain.profile.wary;
    brain.alertUntil = state.tick + WARY_TICKS;
  }
  const enemies = state.players.filter((o) => o.alive && o.id !== p.id);
  const threats = threatsNear(state, brain, here, enemies);

  // 1. in harm's way: run for a safe cell, and keep running for it while it stays safe
  if (danger[here] !== NEVER) {
    brain.goal = null;
    brain.dropAt = null;
    if (!brain.fleeing) {
      brain.fleeing = true;
      brain.refuge = null;
      // people sometimes freeze for a moment, though not when running from a bomb they just dropped
      if (state.tick - brain.droppedAt > 2 && nextRandom(brain.rng) < brain.profile.panic) {
        brain.frozenUntil = state.tick + between(brain, brain.profile.freeze);
      }
    }
    if (state.tick < brain.frozenUntil) return emptyInput();
    const refuge = shelter(state, p, brain, danger, here, threats);
    brain.refuge = refuge?.cell ?? null;
    return refuge ? stepTowards(p, refuge.first, width) : emptyInput();
  }
  brain.fleeing = false;

  // out of reach of its remote bombs (and not being carried into it by a belt): set them off, holding still
  if (actionFor(state, p)?.act === "detonate" && danger[carriedTo(state, p, here)] === NEVER) return { ...stay(state, p, here), action: true };

  // 2. a good spot to bomb, with an escape route afterwards: make up its mind, settle in the middle, drop
  const canBomb = canDropBomb(p);
  const enemyCells = new Set(enemies.map((e) => Math.floor(e.y) * width + Math.floor(e.x)));
  if (canBomb && bombValue(state, p, here, enemyCells) > 0) {
    const drop = planDrop(state, p, danger, here, brain.profile.margin, threats) ?? rashDrop(state, p, brain, here);
    if (drop) {
      brain.dropAt ??= state.tick + between(brain, brain.profile.hesitate);
      const settled = stay(state, p, here);
      if (state.tick < brain.dropAt || settled.dx !== 0 || settled.dy !== 0) return settled;
      brain.dropAt = null;
      brain.goal = null;
      brain.droppedAt = state.tick;
      const steer = drop.facing ? { ...emptyInput(), ...DIR_VEC[drop.facing] } : stepTowards(p, drop.escape.first, width);
      return { ...steer, bomb: true };
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
    goal = chooseGoal(state, p, brain, danger, calm, canBomb, enemies, threats);
    brain.goal = goal?.cell ?? null;
    brain.rethinkAt = state.tick + brain.profile.rethink;
  }
  return goal ? stepTowards(p, goal.first, width) : stay(state, p, here);
}

/**
 * A careless moment: on a cell where a bomb would do some good but leave no way out, a bot may drop it all
 * the same and only then look for somewhere to run. It makes up its mind once for each cell it comes to.
 */
function rashDrop(state: GameState, p: Player, brain: Brain, here: number): Drop | undefined {
  if (brain.rashCell !== here) {
    brain.rashCell = here;
    brain.rash = nextRandom(brain.rng) < brain.profile.reckless;
  }
  if (!brain.rash) return undefined;
  const x = here % state.width;
  const y = Math.floor(here / state.width);
  const d = BLAST_DIRS.find((o) => !solidFor(state, p, x + o.dx, y + o.dy));
  const next = d ? here + d.dx + d.dy * state.width : here;
  return { escape: { cell: next, dist: 1, first: next }, facing: null };
}

/** The cell a belt is carrying the bot towards, or the one it stands on. */
function carriedTo(state: GameState, p: Player, here: number): number {
  const dir = beltAt(state, Math.floor(p.x), Math.floor(p.y));
  return dir ? here + DIR_VEC[dir].dx + DIR_VEC[dir].dy * state.width : here;
}

/**
 * Somewhere worth going: an item close by, a brick to break, or else the nearest enemy (or a stroll). One
 * minding its enemies stays out of their line of fire on the way, and first of all gets out of it when a
 * bomb of theirs would shut it in where it stands.
 */
function chooseGoal(
  state: GameState,
  p: Player,
  brain: Brain,
  danger: number[],
  calm: Visit[],
  canBomb: boolean,
  enemies: Player[],
  threats: Planned[],
): Visit | undefined {
  const width = state.width;
  const exposed = new Set(threats.flatMap((t) => t.blast));
  if (cornerable(state, p, brain, danger, calm[0].cell, threats)) {
    const clear = calm.find((v) => v.dist > 0 && !exposed.has(v.cell));
    if (clear) {
      brain.strolling = true; // walked to the end: half-way there it would still be cornered
      return clear;
    }
  }
  const wanted = new Set(
    state.powerUps.filter((u) => u.kind !== "skull" && !(u.kind === "egg" && p.pet)).map((u) => u.y * width + u.x),
  );
  const errand =
    calm.find((v) => v.dist > 0 && v.dist <= brain.profile.itemReach && wanted.has(v.cell) && !exposed.has(v.cell)) ??
    (canBomb ? bombingSpot(state, p, brain, danger, calm, enemies, threats, exposed) : undefined);
  if (state.tick >= brain.moodUntil) {
    brain.hunting = nextRandom(brain.rng) < brain.profile.hunts;
    brain.moodUntil = state.tick + PREY_TICKS;
  }
  brain.strolling = !errand && !brain.hunting;
  return errand ?? (brain.strolling ? wander(calm, brain) : hunt(state, p, brain, danger, calm, enemies, threats, exposed));
}

/**
 * Where to go to get at its prey (one enemy, kept for a while, so that it isn't torn between two whenever
 * they shuffle about). Minding what the prey could do back, it makes for a cell to bomb it from
 * with a way out whatever the prey does, and failing that waits out of its line of fire, not at its side.
 */
function hunt(
  state: GameState,
  p: Player,
  brain: Brain,
  danger: number[],
  calm: Visit[],
  enemies: Player[],
  threats: Planned[],
  exposed: ReadonlySet<number>,
): Visit | undefined {
  const prey = preyOf(state, p, brain, enemies);
  if (!prey) return undefined;
  const away = Math.abs(prey.x - p.x) + Math.abs(prey.y - p.y);
  if (brain.alert) {
    const spot = canDropBomb(p) ? attackSpot(state, p, brain, danger, calm, prey, enemies) : undefined;
    if (spot) return spot;
    if (exposed.size > 0) return nearestTowards(prey, calm.filter((v) => !exposed.has(v.cell)), state.width) ?? calm[0];
  }
  // already on top of it: chasing the cell it is in would just be shuffling back and forth with it
  if (away < CLOSE_ENOUGH) return calm[0];
  return nearestTowards(prey, calm, state.width);
}

/** The enemy the bot is after: the nearest one, kept for PREY_TICKS before it looks round for a nearer. */
function preyOf(state: GameState, p: Player, brain: Brain, enemies: Player[]): Player | undefined {
  const away = (e: Player) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
  let prey = state.tick < brain.preyUntil ? enemies.find((e) => e.id === brain.prey) : undefined;
  if (!prey) {
    prey = enemies.reduce<Player | undefined>((best, e) => (!best || away(e) < away(best) ? e : best), undefined);
    brain.prey = prey?.id ?? null;
    brain.preyUntil = state.tick + PREY_TICKS;
  }
  return prey;
}

/** The nearest cell a bomb would reach the prey from and still leave a way out, whatever the enemies near it lay. */
function attackSpot(state: GameState, p: Player, brain: Brain, danger: number[], calm: Visit[], prey: Player, enemies: Player[]): Visit | undefined {
  // the same blast reaches from the prey's cell to the bot's as the other way round
  const inReach = new Set(blastCells(state, Math.floor(prey.x), Math.floor(prey.y), bombRangeFor(p), p.pierceBomb));
  let checked = 0;
  for (const v of calm) {
    if (v.dist === 0 || !inReach.has(v.cell) || !canPlaceAt(state, v.cell % state.width, Math.floor(v.cell / state.width))) continue;
    if (planDrop(state, p, danger, v.cell, brain.profile.margin, threatsNear(state, brain, v.cell, enemies))) return v;
    if (++checked === MAX_SPOT_CHECKS) return undefined;
  }
  return undefined;
}

/**
 * A cell near by where a bomb would break bricks and still leave a way out. Without that check two such
 * cells side by side, neither with an escape, would have the bot pacing between them. Enemies in reach
 * don't count here: they move, and a goal that moves with them has the bot dithering (step 2 still bombs
 * anyone in range). A bot in pursuit weighs up the nearest few and breaks through towards its prey, sticking
 * to the spot it was already making for while that still serves.
 */
function bombingSpot(
  state: GameState,
  p: Player,
  brain: Brain,
  danger: number[],
  calm: Visit[],
  enemies: Player[],
  threats: Planned[],
  exposed: ReadonlySet<number>,
): Visit | undefined {
  const spots: Visit[] = [];
  let failed = 0;
  for (const v of calm) {
    if (v.dist === 0 || exposed.has(v.cell) || bombValue(state, p, v.cell, NOBODY) === 0) continue;
    if (planDrop(state, p, danger, v.cell, brain.profile.margin, threats)) spots.push(v);
    else failed++;
    if (spots.length === brain.profile.pursuit || failed === MAX_SPOT_CHECKS) break;
  }
  const prey = spots.length > 1 ? preyOf(state, p, brain, enemies) : undefined;
  if (!prey) return spots[0];
  return spots.find((v) => v.cell === brain.goal) ?? nearestTowards(prey, spots, state.width);
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
