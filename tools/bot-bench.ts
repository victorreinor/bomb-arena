/**
 * Bot benchmark: how hard each level is to kill, how often it blunders and how hard it presses, set against
 * the targets below. The seeds are fixed, so the same code always prints the same numbers: change a profile
 * in `packages/engine/src/bot.ts`, run it again and compare.
 * Usage: bun run bench:bots [section ...]   (sections: dodge tip solo stalker attack wait duel; all by default)
 */
import {
  BLAST_DIRS,
  BOMB_FUSE_TICKS,
  BOT_LEVELS,
  CLASSIC,
  FLAME_TICKS,
  KICK_INTERVAL_TICKS,
  PLAYER_RADIUS,
  TICK_RATE,
  TILE,
  blastCells,
  bombRangeFor,
  botId,
  botInput,
  canDropBomb,
  canPlaceAt,
  createGame,
  dangerMap,
  emptyInput,
  hurryBotsAlone,
  isBotId,
  isBuried,
  killPlayer,
  nextRandom,
  playerSpeed,
  solidFor,
  step,
  stepTowards,
  tileAt,
  type Bomb,
  type BotLevel,
  type GameState,
  type Input,
  type Inputs,
  type MapDef,
  type Player,
} from "../packages/engine/src";

/** What each level should score: [lowest, highest] that still counts as on target. */
const TARGETS = {
  dodge: { easy: [22, 38], normal: [6, 14], hard: [0.5, 4] },
  tip: { easy: [18, 32], normal: [4, 12], hard: [0, 2] },
  solo: { easy: [20, 40], normal: [5, 15], hard: [0, 3] },
  attack: { easy: [1.5, 3], normal: [4, 6], hard: [7, 10] },
} as const satisfies Record<string, Record<BotLevel, readonly [number, number]>>;

const MINUTE = 60 * TICK_RATE;
const MATCH_TICKS = 3 * MINUTE;
const BOT = botId(1);
/** the seat a person would take: whatever sits there in a section stands in for one */
const PERSON = "p1";

const sections = new Set(process.argv.slice(2));
const wants = (name: string) => sections.size === 0 || sections.has(name);

const cellOf = (s: GameState, p: Player) => Math.floor(p.y) * s.width + Math.floor(p.x);
const percent = (n: number, of: number) => (of === 0 ? 0 : (100 * n) / of);
const clock = (ticks: number) => `${Math.floor(ticks / MINUTE)}:${String(Math.floor((ticks % MINUTE) / TICK_RATE)).padStart(2, "0")}`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
const whole = (max: number, dice: { rng: number }) => Math.floor(nextRandom(dice) * max);

let decisions = 0;
let decisionMs = 0;
/** botInput, timed: the server runs it for every bot 30 times a second. */
function think(s: GameState, id: string, level: BotLevel): Input {
  const before = performance.now();
  const input = botInput(s, id, level);
  decisionMs += performance.now() - before;
  decisions++;
  return input;
}

function duelGame(map: MapDef, seed: number, timeLimitTicks: number | null = null): GameState {
  return createGame({ map, seed, timeLimitTicks, players: [{ id: BOT, color: 0 }, { id: PERSON, color: 1 }] });
}

const overlaps = (p: Player, x: number, y: number) => {
  const reach = 0.5 + PLAYER_RADIUS - 1e-6;
  return p.alive && Math.abs(p.x - (x + 0.5)) < reach && Math.abs(p.y - (y + 0.5)) < reach;
};

/** A bomb that turns up on (x, y) as if `owner` had just laid it there. */
function layBomb(s: GameState, x: number, y: number, range: number, owner: string): Bomb {
  const bomb: Bomb = {
    id: s.nextBombId++, owner, x, y, ticksLeft: BOMB_FUSE_TICKS, range,
    remote: false, power: false, pierce: false, rubber: false, mine: false,
    slide: null, slideTimer: 0, slideInterval: KICK_INTERVAL_TICKS, held: null, flight: null,
  };
  s.bombs.push(bomb);
  for (const p of s.players) if (overlaps(p, x, y)) p.passing.push(bomb.id);
  return bomb;
}

/** What `check` says about the board as it would be with one more bomb on (x, y); the board is left as it was. */
function withBomb<T>(s: GameState, x: number, y: number, range: number, owner: string, check: () => T): T {
  const before = { bombs: s.bombs.length, next: s.nextBombId, passing: s.players.map((p) => p.passing.length) };
  layBomb(s, x, y, range, owner);
  try {
    return check();
  } finally {
    s.bombs.length = before.bombs;
    s.nextBombId = before.next;
    s.players.forEach((p, i) => (p.passing.length = before.passing[i]));
  }
}

/**
 * Whether a perfect player standing where `p` is could come through every blast now on the board: knowing
 * when each bomb really goes off, waiting for a fire to burn out where that helps, never a tick late.
 * Bricks a blast clears on the way aren't counted as openings, so it errs on the side of "doomed".
 */
function canSurvive(s: GameState, p: Player): boolean {
  const w = s.width;
  const goesOff = dangerMap(s); // on a bomb's own cell: the tick it explodes, chains included
  const fires: [number, number][][] = Array.from({ length: w * s.height }, () => []);
  const blocked = new Map<number, number>();
  let over = 0;
  for (const f of s.flames) {
    fires[f.y * w + f.x].push([0, f.ticksLeft]);
    over = Math.max(over, f.ticksLeft);
  }
  for (const b of s.bombs) {
    if (b.flight || b.held || isBuried(b)) continue;
    const at = goesOff[b.y * w + b.x];
    if (!p.passing.includes(b.id)) blocked.set(b.y * w + b.x, at);
    for (const c of blastCells(s, b.x, b.y, b.range, b.pierce)) fires[c].push([at, at + FLAME_TICKS]);
    over = Math.max(over, at + FLAME_TICKS);
  }
  const hot = (c: number, from: number, to: number) => fires[c].some(([a, b]) => a <= to + 1 && b >= from - 1);

  const perTile = TICK_RATE / playerSpeed(p);
  let reach = new Set([cellOf(s, p)]);
  for (let t = 0; t <= over && reach.size > 0; t += perTile) {
    const next = new Set<number>();
    for (const c of reach) {
      if (!hot(c, t, t + perTile)) next.add(c);
      for (const d of BLAST_DIRS) {
        const nx = (c % w) + d.dx;
        const ny = Math.floor(c / w) + d.dy;
        const n = ny * w + nx;
        const tile = tileAt(s, nx, ny);
        if (tile !== TILE.EMPTY && !(tile === TILE.SOFT && p.wallPass)) continue;
        if (!p.bombPass && (blocked.get(n) ?? -1) > t) continue;
        if (!hot(c, t, t + perTile / 2) && !hot(n, t + perTile / 2, t + perTile)) next.add(n);
      }
    }
    reach = next;
  }
  return reach.size > 0;
}

function row(label: string, cells: (string | number)[]) {
  console.log(`${label.padEnd(8)}${cells.map((c) => String(c).padStart(16)).join("")}`);
}

const scores: Partial<Record<keyof typeof TARGETS, Record<BotLevel, number>>> = {};
function score(metric: keyof typeof TARGETS, level: BotLevel, value: number) {
  (scores[metric] ??= { easy: NaN, normal: NaN, hard: NaN })[level] = value;
}

// ------------------------------------------------------------------ dodge

/**
 * A corridor with a pocket to duck into every few tiles, the person out of reach in a corridor of their own.
 * A bomb that will burn the whole corridor turns up beside the bot with the usual three seconds on it: the
 * nearest pocket it can still get to is two to five steps away, so anyone who looks and runs makes it.
 */
const DODGE_ROWS = ["#####################", "#.........2.........#", "#####################", "#.........1.........#", "####.###.###.###.####", "#####################"];

function dodge(level: BotLevel, trials: number): number {
  let caught = 0;
  let fair = 0;
  for (let seed = 1; seed <= trials; seed++) {
    const s = duelGame({ id: "bench", name: "bench", rows: DODGE_ROWS, softDensity: 0 }, seed * 7919);
    const [bot, person] = s.players;
    person.invuln = Infinity;
    bot.bombsMax = 0; // defence alone: no bombs of its own to get in its way
    const dice = { rng: seed * 104729 };
    // long enough for it to be about its business, and at a different moment of it every time
    for (let t = 45 + whole(90, dice); t > 0; t--) step(s, { [BOT]: think(s, BOT, level) });
    const bx = Math.floor(bot.x);
    const by = Math.floor(bot.y);
    // only where it leaves a way out: not at the mouth of the pocket the bot is in, nor shutting it in at the corridor's end
    const beside = BLAST_DIRS.filter(
      (d) => canPlaceAt(s, bx + d.dx, by + d.dy) && withBomb(s, bx + d.dx, by + d.dy, s.width, PERSON, () => canSurvive(s, bot)),
    );
    if (beside.length === 0) continue;
    const d = beside[whole(beside.length, dice)];
    layBomb(s, bx + d.dx, by + d.dy, s.width, PERSON);
    fair++;
    for (let t = 0; t < BOMB_FUSE_TICKS + FLAME_TICKS && bot.alive; t++) step(s, { [BOT]: think(s, BOT, level) });
    if (!bot.alive) caught++;
  }
  return percent(caught, fair);
}

if (wants("dodge")) {
  console.log("\n== dodge: a bomb beside the bot in a corridor with pockets to duck into, three seconds to do it ==");
  row("level", ["% caught"]);
  for (const level of BOT_LEVELS) {
    const caught = dodge(level, 400);
    row(level, [caught.toFixed(1)]);
    score("dodge", level, caught);
  }
}

// ------------------------------------------------------------------ tip

/**
 * A long bomb down a straight corridor, the bot two tiles inside the tip of its blast with open floor
 * beyond: three tiles' walk to safety and 3 s to do it in. Caught only by misjudging where the fire ends,
 * or by not looking.
 */
function tip(level: BotLevel, trials: number): number {
  let caught = 0;
  let n = 0;
  for (const range of [5, 6, 7, 8]) {
    const inner = [..."2".padEnd(18, ".")];
    inner[1 + range] = "1"; // the bomb goes on column 3, so its blast ends on column 3 + range
    const rows = ["#".repeat(20), `#${inner.join("")}#`, "#".repeat(20)];
    for (let seed = 1; seed <= trials; seed++) {
      const s = duelGame({ id: "bench", name: "bench", rows, softDensity: 0 }, seed * 9973 + range);
      s.players[1].invuln = Infinity;
      layBomb(s, 3, 1, range, PERSON);
      for (let t = 0; t < BOMB_FUSE_TICKS + FLAME_TICKS && s.players[0].alive; t++) step(s, { [BOT]: think(s, BOT, level) });
      if (!s.players[0].alive) caught++;
      n++;
    }
  }
  return percent(caught, n);
}

if (wants("tip")) {
  console.log("\n== tip: a long bomb (reach 5-8) down a corridor, the bot two tiles inside the end of its blast ==");
  row("level", ["% caught"]);
  for (const level of BOT_LEVELS) {
    const caught = tip(level, 100);
    row(level, [caught.toFixed(1)]);
    score("tip", level, caught);
  }
}

// ------------------------------------------------------------------ solo

if (wants("solo")) {
  console.log("\n== solo: three minutes alone on the classic map, clearing bricks ==");
  row("level", ["% blew itself up", "bombs a minute"]);
  for (const level of BOT_LEVELS) {
    const matches = 100;
    let died = 0;
    let bombs = 0;
    let ticks = 0;
    for (let seed = 1; seed <= matches; seed++) {
      const s = duelGame(CLASSIC, seed * 7919);
      s.players[1].invuln = Infinity;
      for (let t = 0; t < MATCH_TICKS && s.players[0].alive; t++) {
        const input = think(s, BOT, level);
        if (input.bomb) bombs++;
        step(s, { [BOT]: input });
        ticks++;
      }
      if (!s.players[0].alive) died++;
    }
    row(level, [percent(died, matches).toFixed(1), ((bombs / ticks) * MINUTE).toFixed(1)]);
    score("solo", level, percent(died, matches));
  }
}

// ------------------------------------------------------------------ stalker

/** Every cell `p` can walk to from `start` through cells `open` allows, with how many steps away it is and the first step there. */
function walkable(s: GameState, p: Player, start: number, open: (cell: number) => boolean = () => true): Map<number, { dist: number; first: number }> {
  const seen = new Map([[start, { dist: 0, first: start }]]);
  const queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const c = queue[k];
    const { dist, first } = seen.get(c)!;
    for (const d of BLAST_DIRS) {
      const nx = (c % s.width) + d.dx;
      const ny = Math.floor(c / s.width) + d.dy;
      const n = ny * s.width + nx;
      if (seen.has(n) || solidFor(s, p, nx, ny) || !open(n)) continue;
      seen.set(n, { dist: dist + 1, first: dist === 0 ? n : first });
      queue.push(n);
    }
  }
  return seen;
}

type Stalking = "pressure" | "trap";

/**
 * A stand-in for someone good hunting the bot: walks at it, blasting its way through bricks, and lays a
 * bomb where it stands either whenever the bot is in reach ("pressure") or only when that leaves the bot no
 * way out at all ("trap"). It plays as someone who can be hurt would: it gets out of every blast, walks
 * into none, and only lays a bomb it could get away from itself. (Nothing does hurt it, so that the match
 * always runs its three minutes.)
 */
function stalk(s: GameState, me: Player, prey: Player, how: Stalking): Input {
  const w = s.width;
  const here = cellOf(s, me);
  const there = cellOf(s, prey);
  const mx = here % w;
  const my = Math.floor(here / w);
  const danger = dangerMap(s);
  const safe = (c: number) => danger[c] === Infinity;
  if (!safe(here)) {
    // in a blast: out of it first, by the shortest way
    const out = [...walkable(s, me, here)].find(([c]) => safe(c));
    return out ? stepTowards(me, out[1].first, w) : emptyInput();
  }
  const reach = walkable(s, me, here, safe);
  const blastFrom = (c: number) => blastCells(s, c % w, Math.floor(c / w), bombRangeFor(me), me.pierceBomb);
  const away = (c: number) => Math.abs((c % w) - (there % w)) + Math.abs(Math.floor(c / w) - Math.floor(there / w));

  // as near the prey as it can get; walled off from it, the nearest cell a bomb breaks a brick from
  const walled = !walkable(s, me, here).has(there);
  let target = here;
  let best = Infinity;
  for (const c of reach.keys()) {
    if (away(c) < best && (!walled || blastFrom(c).some((b) => s.tiles[b] === TILE.SOFT))) {
      best = away(c);
      target = c;
    }
  }
  const input = stepTowards(me, target === here ? here : reach.get(target)!.first, w);
  if (!canDropBomb(me) || !canPlaceAt(s, mx, my)) return input;

  const lay = (wanted: () => boolean) => withBomb(s, mx, my, bombRangeFor(me), me.id, () => wanted() && canSurvive(s, me));
  if (blastFrom(here).includes(there)) input.bomb = lay(() => how === "pressure" || !canSurvive(s, prey));
  else if (walled && target === here) input.bomb = lay(() => true);
  return input;
}

function stalked(level: BotLevel, how: Stalking, matches: number) {
  const killedAt: number[] = [];
  let selfKills = 0;
  for (let seed = 1; seed <= matches; seed++) {
    const s = duelGame(CLASSIC, seed * 5261);
    const [bot, person] = s.players;
    person.invuln = Infinity;
    Object.assign(person, { bombsMax: 2, range: 4 });
    while (s.tick < MATCH_TICKS && bot.alive) {
      step(s, { [BOT]: think(s, BOT, level), [PERSON]: stalk(s, person, bot, how) });
    }
    if (bot.alive) continue;
    if (bot.death?.by === PERSON) killedAt.push(s.tick);
    else selfKills++;
  }
  return { killed: percent(killedAt.length, matches), median: median(killedAt), self: percent(selfKills, matches) };
}

if (wants("stalker")) {
  for (const [how, title] of [
    ["trap", "bombs only when the bot would have no way out at all: how often does it let itself be cornered?"],
    ["pressure", "bombs whenever the bot is in reach: how long does it last?"],
  ] as [Stalking, string][]) {
    console.log(`\n== stalker (${how}): someone unkillable walks at the bot on the classic map and ${title} ==`);
    row("level", ["% killed in 3 min", "median time", "% own bomb"]);
    for (const level of BOT_LEVELS) {
      const r = stalked(level, how, 60);
      row(level, [r.killed.toFixed(1), Number.isNaN(r.median) ? "-" : clock(r.median), r.self.toFixed(1)]);
    }
  }
}

// ------------------------------------------------------------------ attack

if (wants("attack")) {
  console.log("\n== attack: the bot against someone standing still in the far corner of the classic map, three minutes ==");
  row("level", ["hits a minute", "first hit (median)", "never hit"]);
  for (const level of BOT_LEVELS) {
    const matches = 60;
    let hits = 0;
    let ticks = 0;
    let never = 0;
    const first: number[] = [];
    for (let seed = 1; seed <= matches; seed++) {
      const s = duelGame(CLASSIC, seed * 6007);
      const [bot, person] = s.players;
      person.invuln = Infinity;
      const target = cellOf(s, person);
      let burning = false;
      let firstHit = -1;
      for (let t = 0; t < MATCH_TICKS && bot.alive; t++) {
        step(s, { [BOT]: think(s, BOT, level) });
        const now = s.flames.some((f) => f.y * s.width + f.x === target && f.owner === BOT);
        if (now && !burning) {
          hits++;
          if (firstHit < 0) firstHit = s.tick;
        }
        burning = now;
        ticks++;
      }
      firstHit < 0 ? never++ : first.push(firstHit);
    }
    row(level, [((hits / ticks) * MINUTE).toFixed(1), clock(median(first)), `${never}/${matches}`]);
    score("attack", level, (hits / ticks) * MINUTE);
  }
}

// ------------------------------------------------------------------ wait

if (wants("wait")) {
  const diesAt = 30 * TICK_RATE;
  const giveUpAt = 8 * MINUTE;
  for (const [title, limit] of [["the 3-minute clock", MATCH_TICKS], ["no time limit", null]] as [string, number | null][]) {
    console.log(`\n== wait: the person is out at 0:30 and three bots play on, with ${title} ==`);
    row("level", ["median wait", "longest wait", "ended by blocks", `still on at ${clock(giveUpAt)}`]);
    for (const level of BOT_LEVELS) {
      const matches = 30;
      const waits: number[] = [];
      let crushed = 0;
      let unfinished = 0;
      for (let seed = 1; seed <= matches; seed++) {
        const bots = [1, 2, 3].map(botId);
        const s = createGame({
          map: CLASSIC, seed: seed * 3571, timeLimitTicks: limit,
          players: [{ id: PERSON, color: 0 }, ...bots.map((id, i) => ({ id, color: i + 1 }))],
        });
        while (s.phase === "playing" && s.tick < giveUpAt) {
          if (s.tick === diesAt && s.players[0].alive) killPlayer(s, s.players[0], "blast");
          const inputs: Inputs = {};
          for (const id of bots) inputs[id] = think(s, id, level);
          hurryBotsAlone(s, isBotId); // as the room does
          step(s, inputs);
        }
        waits.push(s.tick - diesAt);
        if (s.players.some((p) => p.death?.how === "crush")) crushed++;
        if (s.phase === "playing") unfinished++;
      }
      row(level, [clock(median(waits)), clock(Math.max(...waits)), `${crushed}/${matches}`, `${unfinished}/${matches}`]);
    }
  }
}

// ------------------------------------------------------------------ duel

if (wants("duel")) {
  console.log("\n== duel: bot against bot on the classic map, 3-minute clock (a hint at most: the timid one outlives the bold) ==");
  row("pair", ["first wins %", "second wins %", "draw %"]);
  for (const [a, b] of [["hard", "easy"], ["hard", "normal"], ["normal", "easy"]] as [BotLevel, BotLevel][]) {
    const matches = 80;
    const wins = [0, 0, 0];
    for (let seed = 1; seed <= matches; seed++) {
      // the levels swap corners every other match
      const levels = seed % 2 ? [a, b] : [b, a];
      const ids = [botId(1), botId(2)];
      const s = createGame({ map: CLASSIC, seed: seed * 2311, timeLimitTicks: MATCH_TICKS, players: ids.map((id, i) => ({ id, color: i })) });
      while (s.phase === "playing" && s.tick < MATCH_TICKS + MINUTE) {
        step(s, { [ids[0]]: think(s, ids[0], levels[0]), [ids[1]]: think(s, ids[1], levels[1]) });
      }
      const winner = s.winner === null ? null : levels[ids.indexOf(s.winner)];
      wins[winner === null || a === b ? 2 : winner === a ? 0 : 1]++;
    }
    row(`${a} x ${b}`.padEnd(14), wins.map((n) => percent(n, matches).toFixed(0)));
  }
}

// ------------------------------------------------------------------ summary

const NAMES: Record<keyof typeof TARGETS, string> = {
  dodge: "caught by a bomb beside it, with a pocket to duck into (%)",
  tip: "caught at the tip of a long blast (%)",
  solo: "blew itself up alone in 3 min (%)",
  attack: "hits a minute on a still target",
};
console.log("\n== against the targets ==");
for (const metric of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
  const got = scores[metric];
  if (!got) continue;
  console.log(NAMES[metric]);
  for (const level of BOT_LEVELS) {
    const [low, high] = TARGETS[metric][level];
    const ok = got[level] >= low && got[level] <= high;
    console.log(`  ${level.padEnd(7)} ${got[level].toFixed(1).padStart(6)}   target ${low}-${high}   ${ok ? "ok" : got[level] < low ? "LOW" : "HIGH"}`);
  }
}
if (decisions > 0) console.log(`\n${((1000 * decisionMs) / decisions).toFixed(1)} µs per bot decision (${decisions} of them)`);
