import { BUTTONS, TICK_MS, TILE, bombAt, countingDown, emptyInput, pickUp, stepPlayer, type Bomb, type GameState, type Input, type InputAck, type Player, type PowerUp, type Tile } from "@bomb-arena/engine";
import { bombsPlaced, type GameEvent } from "./events";
import { lerpPlayer } from "./snapshots";

/** An input as sent: its number and the local clock (in ticks) when it left. */
interface Sent {
  seq: number;
  input: Input;
  at: number;
}

/** How far past the newest snapshot the prediction may run, in ticks (beyond that something is off: show the server). */
const MAX_AHEAD = 20;
/** inputs kept waiting for an acknowledgement (a server that never sends one mustn't make the list grow) */
const MAX_SENT = 64;

export interface Prediction {
  /** our bomber as of now: walked as far as our latest inputs take it */
  player: Player;
  /** how far the newest snapshot moved our predicted bomber, to ease out rather than jump to */
  correction: { x: number; y: number };
  /** our bombs on the predicted board, those the server already confirmed included */
  bombs: Bomb[];
  /** the ones only the prediction has so far (just laid, not yet in a snapshot) */
  fresh: Bomb[];
  /** items on the newest snapshot's board that our bomber has walked over since */
  taken: PowerUp[];
  /** an item it is stepping onto right now (taken on the coming tick): gone the moment we draw it there */
  reaching: PowerUp[];
  /** the board as predicted: crates where our bomber has shoved them */
  tiles: Tile[];
}

/** A replay from one snapshot: our bomber at the last whole tick and the next, our bombs, the items we took. */
type Replay = Omit<Prediction, "player" | "correction"> & { player: Player; next: Player };

/** The input in force at `tick`: the newest one landed by then; its buttons fire only on the tick it lands. */
function inputAt(sent: Sent[], lands: number[], tick: number): Input {
  let i = -1;
  while (i + 1 < sent.length && lands[i + 1] <= tick) i++;
  if (i < 0) return emptyInput();
  if (lands[i] === tick) return sent[i].input;
  const held = { ...sent[i].input };
  for (const b of BUTTONS) held[b] = false;
  return held;
}

/**
 * Client-side prediction of our own bomber. The server stays in charge: every snapshot is the truth up to
 * its tick. From there we replay, with the engine's own `stepPlayer`, the inputs the server hasn't applied
 * yet, each at the server tick it will land on, so our bomber moves (and lays bombs) the moment we ask.
 * The server tells us the tick each input took over (the acks), which lines our clock up with its ticks.
 */
export class Predictor {
  /** numbering starts from the clock: above anything an earlier page or connection used */
  private seq = Date.now();
  private sent: Sent[] = [];
  /** server tick minus local tick at which our inputs take effect; null until one is acknowledged */
  private offset: number | null = null;
  private acked = 0;
  /** the last replay and what it was made from: frames in between only move along it */
  private cached: { key: string; latest: GameState; replay: Replay } | null = null;
  /** what we showed last frame, and when: a new snapshot's correction is measured against it */
  private shown: { x: number; y: number; now: number; latest: GameState } | null = null;

  constructor(private readonly me: string) {}

  /** Whether our clock is lined up with the server's yet (an input has been acknowledged). */
  get synced() {
    return this.offset !== null;
  }

  /** Number an input about to go out, and remember it. */
  record(input: Input, now: number): number {
    this.seq++;
    this.sent.push({ seq: this.seq, input: { ...input }, at: now / TICK_MS });
    if (this.sent.length > MAX_SENT) this.sent.shift();
    return this.seq;
  }

  /** A new round: the server forgets our inputs, so do we. */
  reset() {
    this.sent = [];
    this.offset = null;
    this.acked = 0;
    this.cached = null;
    this.shown = null;
  }

  predict(latest: GameState, acks: Record<string, InputAck>, now: number): Prediction | null {
    this.learn(acks[this.me]);
    const self = latest.players.find((p) => p.id === this.me);
    /** ticks past `latest` the server will be at when an input sent at `t` lands */
    const at = (t: number) => (this.offset === null ? -1 : t / TICK_MS + this.offset - latest.tick);
    const ahead = at(now);
    if (latest.phase !== "playing" || !self?.alive || ahead < 0 || ahead > MAX_AHEAD) {
      this.shown = null;
      return null;
    }

    const r = this.replay(latest, Math.floor(ahead));
    const player = lerpPlayer(r.player, r.next, ahead - Math.floor(ahead));
    let correction = { x: 0, y: 0 };
    const before = this.shown;
    if (before && before.latest !== latest && at(before.now) >= 0) {
      // where the new snapshot puts us at last frame's time, against where we drew us then
      const then = at(before.now);
      const old = this.replay(latest, Math.floor(then));
      const was = lerpPlayer(old.player, old.next, then - Math.floor(then));
      correction = { x: before.x - was.x, y: before.y - was.y };
    }
    this.shown = { x: player.x, y: player.y, now, latest };
    return { player, correction, bombs: r.bombs, fresh: r.fresh, taken: r.taken, reaching: r.reaching, tiles: r.tiles };
  }

  /** An acknowledgement of a newer input tells how far our clock is from the server's ticks. */
  private learn(ack: InputAck | undefined) {
    if (!ack || ack[0] <= this.acked) return;
    const [seq, tick] = ack;
    this.acked = seq;
    const i = this.sent.findIndex((s) => s.seq === seq);
    if (i < 0) return;
    const sample = tick - this.sent[i].at;
    this.offset = this.offset === null ? sample : this.offset * 0.8 + sample * 0.2;
    this.sent.splice(0, i); // the acknowledged input stays: it's still the one held down
  }

  /** Our bomber `whole` ticks past `latest` (and one more), on a private copy of the board. */
  private replay(latest: GameState, whole: number): Replay {
    const key = `${whole}:${this.seq}:${this.acked}:${this.offset}`;
    if (this.cached?.latest === latest && this.cached.key === key) return this.cached.replay;

    const world = structuredClone(latest);
    world.floor = latest.floor; // never changes, and the engine caches its portal pairs by this very array
    world.nextBombId = latest.bombs.reduce((n, b) => Math.max(n, b.id + 1), 0); // snapshots leave the counter out
    const known = world.nextBombId;
    const me = world.players.find((p) => p.id === this.me)!;
    // inputs the snapshot already includes are in force from the start; the rest land after it at the earliest
    const lands = this.sent.map((s) => (s.seq > this.acked ? Math.max(Math.round(s.at + this.offset!), latest.tick + 1) : -Infinity));
    const advance = () => {
      world.tick++;
      if (countingDown(world)) return; // "Ready…": the server holds everyone still, so do we
      stepPlayer(world, me, inputAt(this.sent, lands, world.tick));
      if (!me.jump) pickUp(world, me); // in mid-air items pass underneath
    };
    const gone = () => latest.powerUps.filter((u) => !world.powerUps.some((w) => w.x === u.x && w.y === u.y));
    for (let k = 0; k < whole; k++) advance();
    const player = structuredClone(me);
    const taken = gone();
    advance();
    const reaching = gone().filter((u) => !taken.includes(u));
    const bombs = world.bombs.filter((b) => b.owner === this.me);
    const replay = { player, next: me, bombs, fresh: bombs.filter((b) => b.id >= known), taken, reaching, tiles: world.tiles };
    this.cached = { key, latest, replay };
    return replay;
  }
}

/** a jump in the predicted position bigger than this many tiles is shown at once rather than eased */
const SNAP_TILES = 1.5;
/** how fast an eased correction fades (per second) */
const EASE_RATE = 14;

/**
 * Puts the prediction on screen: our bomber where the prediction has it (a correction from a new snapshot
 * is eased out rather than jumped to), our bombs the moment they're laid, and their sound and effects too,
 * leaving out the server's own report of them when it arrives later.
 */
export class PredictedView {
  private err = { x: 0, y: 0 };
  private lastNow = 0;
  /** cells of the bombs only the prediction had last frame, to spot the ones just laid */
  private fresh = new Set<number>();
  /** cells of items we picked up ahead of the server: hidden until the playback has them gone too */
  private grabbed = new Set<number>();
  private live = false;

  constructor(private readonly me: string) {}

  /** `view` with our bomber and bombs as predicted, plus events for bombs that just appeared. */
  apply(view: GameState, pred: Prediction | null, now: number): { view: GameState; events: GameEvent[] } {
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    const starting = !this.live;
    this.live = pred !== null;
    if (!pred) {
      this.err = { x: 0, y: 0 };
      this.fresh.clear();
      this.grabbed.clear();
      return { view, events: [] };
    }

    // when the prediction takes over, start from where the playback had us and glide ahead from there
    const drawn = starting ? view.players.find((p) => p.id === this.me) : undefined;
    if (drawn) this.err = { x: drawn.x - pred.player.x, y: drawn.y - pred.player.y };
    this.err.x += pred.correction.x;
    this.err.y += pred.correction.y;
    if (Math.hypot(this.err.x, this.err.y) > SNAP_TILES) this.err = { x: 0, y: 0 };
    const fade = Math.exp(-dt * EASE_RATE);
    this.err.x *= fade;
    this.err.y *= fade;

    const { player } = pred;
    const players = view.players.map((p) =>
      p.id === this.me && p.alive
        ? { ...p, x: player.x + this.err.x, y: player.y + this.err.y, facing: player.facing, moving: player.moving, jump: player.jump }
        : p,
    );
    // our bombs the playback hasn't reached yet (just laid, or confirmed but still ahead of the picture)
    const ahead = pred.bombs.filter((b) => !b.flight && !b.held && !bombAt(view, b.x, b.y));

    const cell = (b: { x: number; y: number }) => b.y * view.width + b.x;
    const appeared = pred.fresh.filter((b) => !this.fresh.has(cell(b)));
    this.fresh = new Set(pred.fresh.map(cell));
    const events = bombsPlaced(appeared, () => true);
    // items vanish as we draw our bomber onto them (the skull's curse is the server's to announce), and stay
    // gone while the playback catches up with the server taking them
    const here = cell({ x: Math.floor(player.x + this.err.x), y: Math.floor(player.y + this.err.y) });
    const got = [...pred.taken, ...pred.reaching.filter((u) => cell(u) === here)];
    for (const u of got) {
      if (this.grabbed.has(cell(u))) continue;
      this.grabbed.add(cell(u));
      if (u.kind !== "skull") events.push({ type: "pickup", id: this.me, x: u.x + 0.5, y: u.y + 0.5, kind: u.kind });
    }
    const powerUps = this.grabbed.size > 0 ? view.powerUps.filter((u) => !this.grabbed.has(cell(u))) : view.powerUps;
    for (const c of this.grabbed) {
      if (!got.some((u) => cell(u) === c) && !view.powerUps.some((u) => cell(u) === c)) this.grabbed.delete(c);
    }
    // crates we shove move with us, not a round trip later (bricks and the rest still follow the playback)
    const crate = (t: Tile) => t === TILE.CRATE;
    const moved = view.tiles.some((t, i) => crate(t) !== crate(pred.tiles[i]));
    const tiles = moved ? view.tiles.map((t, i) => (crate(t) || crate(pred.tiles[i]) ? pred.tiles[i] : t)) : view.tiles;
    return { view: { ...view, players, bombs: [...view.bombs, ...ahead], powerUps, tiles }, events };
  }

  /** While we predict, the server's report of our own bombs and pick-ups comes after we already showed and played them. */
  withoutOwn(events: GameEvent[]): GameEvent[] {
    if (!this.live) return events;
    return events.flatMap((e): GameEvent[] => {
      if (e.type === "pose") return e.pose === "place" && e.id === this.me ? [] : [e];
      if (e.type === "pickup") return e.id === this.me ? [] : [e];
      if (e.type !== "bombPlaced") return [e];
      const bombs = e.bombs.filter((b) => b.owner !== this.me);
      return bombs.length > 0 ? [{ ...e, bombs }] : [];
    });
  }
}
