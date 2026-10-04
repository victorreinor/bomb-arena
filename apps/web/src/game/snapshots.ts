import { TICK_MS, fromSnapshot, type GameSnapshot, type GameState, type InputAck, type Player, type Tile } from "@bomberman/engine";

const MAX_BUFFER = 30;
/** how many snapshots the lateness estimate looks back over (about two seconds) */
const TRANSIT_WINDOW = 60;
/** snapshots needed before trusting the estimate; until then the delay stays at its start */
const MIN_SAMPLES = 10;
/** how late a snapshot may turn up and still be waited for: the 90th percentile of recent ones */
const LATE_PERCENTILE = 0.9;
/** a little slack before lateness counts, in ms */
const JITTER_SLACK_MS = 4;
/** ticks behind the newest snapshot we render: at least one (to draw in between), at most three */
const MIN_DELAY = 1;
const MAX_DELAY = 3;
const START_DELAY = 2;

export interface Sample {
  /** state with positions interpolated between the two surrounding snapshots */
  view: GameState;
  latest: GameState;
}

/** A timed animation (a hop, a flight) carries on between two states only if its clock moved on: a restart (a bounce) snaps. */
const carriesOn = (from: { ticks: number } | null, to: { ticks: number } | null) => !!from && !!to && to.ticks > from.ticks;
const lerp = (from: number, to: number, alpha: number) => from + (to - from) * alpha;

/** A player `alpha` of the way from `pa` to `pb`: walking and hops are smooth, the rest is `pb`'s. */
export function lerpPlayer(pa: Player, pb: Player, alpha: number): Player {
  const jump = carriesOn(pa.jump, pb.jump) ? { ...pb.jump!, ticks: lerp(pa.jump!.ticks, pb.jump!.ticks, alpha) } : pb.jump;
  return { ...pb, x: lerp(pa.x, pb.x, alpha), y: lerp(pa.y, pb.y, alpha), jump };
}

/**
 * The state `alpha` of the way from `a` to `b` (consecutive ticks): players walk smoothly,
 * kicked bombs glide and thrown ones keep a smooth arc; everything else snaps to the nearer state.
 */
export function lerpState(a: GameState, b: GameState, alpha: number): GameState {
  const discrete = alpha < 0.5 ? a : b;
  const players = b.players.map((pb) => lerpPlayer(a.players.find((p) => p.id === pb.id) ?? pb, pb, alpha));
  const bombs = discrete.bombs.map((bomb) => {
    const other = (discrete === a ? b : a).bombs.find((o) => o.id === bomb.id);
    if (!other || bomb.held || other.held) return bomb;
    const [from, to] = discrete === a ? [bomb, other] : [other, bomb];
    if (carriesOn(from.flight, to.flight)) {
      return { ...bomb, flight: { ...bomb.flight!, ticks: lerp(from.flight!.ticks, to.flight!.ticks, alpha) } };
    }
    if (from.flight || to.flight) return bomb;
    return { ...bomb, x: lerp(from.x, to.x, alpha), y: lerp(from.y, to.y, alpha) };
  });
  return { ...discrete, players, bombs };
}

/**
 * Jitter buffer: plays server snapshots back smoothly, a little in the past. How far back adapts to the
 * connection: one tick on a steady one, up to three when snapshots turn up late now and then.
 */
export class SnapshotBuffer {
  round = -1;
  /** ticks until the server returns to the lobby (-1 while the match is running) */
  resultsIn = -1;
  /** the input acknowledgements of this round, by player (snapshots only carry those that changed) */
  acks: Record<string, InputAck> = {};
  private snaps: GameState[] = [];
  private play = 0;
  private lastAt = 0;
  private drained = -1;
  /** the board as last received: snapshots only carry tiles when they change */
  private tiles: Tile[] | null = null;
  /** arrival time minus the snapshot's place in the tick schedule, for recent snapshots */
  private transits: number[] = [];
  private delay = START_DELAY;

  push(round: number, resultsIn: number, snap: GameSnapshot, now: number, acks?: Record<string, InputAck>) {
    if (round !== this.round) {
      this.round = round;
      this.snaps = [];
      this.drained = -1;
      this.tiles = null;
      this.acks = {};
      this.transits = []; // tick numbers start over
    }
    Object.assign(this.acks, acks);
    if (snap.tiles) this.tiles = snap.tiles;
    if (!this.tiles) return; // can't draw a board we haven't seen yet
    const game = fromSnapshot(snap, this.tiles);
    this.resultsIn = resultsIn;
    const newest = this.snaps.at(-1);
    if (newest && game.tick <= newest.tick) return;
    this.measure(now, game.tick);
    this.snaps.push(game);
    if (this.snaps.length > MAX_BUFFER) this.snaps.shift();
    if (this.snaps.length === 1) {
      this.play = game.tick;
      this.lastAt = now;
    }
  }

  /**
   * How late snapshots turn up against the server's tick schedule (relative to the quickest lately),
   * so a catch-up burst of ticks doesn't read as lateness; the delay covers the 90th percentile.
   */
  private measure(now: number, tick: number) {
    this.transits.push(now - tick * TICK_MS);
    if (this.transits.length > TRANSIT_WINDOW) this.transits.shift();
    if (this.transits.length < MIN_SAMPLES) return;
    const sorted = [...this.transits].sort((a, b) => a - b);
    const late = sorted[Math.floor(sorted.length * LATE_PERCENTILE)] - sorted[0] - JITTER_SLACK_MS;
    this.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, MIN_DELAY + Math.ceil(late / TICK_MS)));
  }

  clear() {
    this.snaps = [];
    this.round = -1;
    this.resultsIn = -1;
    this.drained = -1;
    this.tiles = null;
    this.acks = {};
    this.transits = [];
  }

  /**
   * Snapshots whose time has come in the playback (oldest first), each returned once.
   * Diffing these in order gives events that line up with what is on screen.
   */
  takePlayed(): GameState[] {
    const out = this.snaps.filter((s) => s.tick > this.drained && s.tick <= this.play + 1e-6);
    if (out.length > 0) this.drained = out[out.length - 1].tick;
    return out;
  }

  sample(now: number): Sample | null {
    const latest = this.snaps.at(-1);
    if (!latest) return null;
    const first = this.snaps[0];

    this.play += Math.min(now - this.lastAt, 100) / TICK_MS;
    this.lastAt = now;
    const target = latest.tick - this.delay;
    this.play = Math.abs(target - this.play) > 8 ? target : this.play + (target - this.play) * 0.1;
    this.play = Math.max(first.tick, Math.min(latest.tick, this.play));

    let ai = 0;
    for (let i = 0; i < this.snaps.length; i++) if (this.snaps[i].tick <= this.play) ai = i;
    const a = this.snaps[ai];
    const b = this.snaps[ai + 1] ?? a;
    const alpha = b.tick === a.tick ? 1 : Math.min(1, (this.play - a.tick) / (b.tick - a.tick));

    return { view: lerpState(a, b, alpha), latest };
  }
}
