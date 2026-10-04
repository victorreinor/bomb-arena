import { TICK_MS, type GameState } from "@bomberman/engine";

/** how many ticks behind the newest snapshot we render, to ride out network jitter */
const DELAY_TICKS = 2;
const MAX_BUFFER = 30;

export interface Sample {
  /** state with positions interpolated between the two surrounding snapshots */
  view: GameState;
  latest: GameState;
}

/**
 * The state `alpha` of the way from `a` to `b` (consecutive ticks): players walk smoothly,
 * kicked bombs glide and thrown ones keep a smooth arc; everything else snaps to the nearer state.
 */
export function lerpState(a: GameState, b: GameState, alpha: number): GameState {
  const lerp = (from: number, to: number) => from + (to - from) * alpha;
  const discrete = alpha < 0.5 ? a : b;
  const players = b.players.map((pb) => {
    const pa = a.players.find((p) => p.id === pb.id) ?? pb;
    return { ...pb, x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y) };
  });
  const bombs = discrete.bombs.map((bomb) => {
    const other = (discrete === a ? b : a).bombs.find((o) => o.id === bomb.id);
    if (!other || bomb.held || other.held) return bomb;
    const [from, to] = discrete === a ? [bomb, other] : [other, bomb];
    if (from.flight && to.flight) return { ...bomb, flight: { ...bomb.flight!, ticks: lerp(from.flight.ticks, to.flight.ticks) } };
    if (from.flight || to.flight) return bomb;
    return { ...bomb, x: lerp(from.x, to.x), y: lerp(from.y, to.y) };
  });
  return { ...discrete, players, bombs };
}

/** Jitter buffer: plays server snapshots back smoothly, a couple of ticks in the past. */
export class SnapshotBuffer {
  round = -1;
  /** ticks until the server returns to the lobby (-1 while the match is running) */
  resultsIn = -1;
  private snaps: GameState[] = [];
  private play = 0;
  private lastAt = 0;
  private drained = -1;

  push(round: number, resultsIn: number, game: GameState, now: number) {
    if (round !== this.round) {
      this.round = round;
      this.snaps = [];
      this.drained = -1;
    }
    this.resultsIn = resultsIn;
    const newest = this.snaps.at(-1);
    if (newest && game.tick <= newest.tick) return;
    this.snaps.push(game);
    if (this.snaps.length > MAX_BUFFER) this.snaps.shift();
    if (this.snaps.length === 1) {
      this.play = game.tick;
      this.lastAt = now;
    }
  }

  clear() {
    this.snaps = [];
    this.round = -1;
    this.resultsIn = -1;
    this.drained = -1;
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
    const target = latest.tick - DELAY_TICKS;
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
