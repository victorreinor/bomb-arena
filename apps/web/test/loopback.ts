import {
  SnapshotStream,
  TICK_MS,
  emptyInput,
  handleClientMessage,
  inputAcks,
  stepRoom,
  type Button,
  type ClientMsg,
  type GameSnapshot,
  type GameState,
  type Input,
  type InputAck,
  type RoomState,
} from "@bomberman/engine";
import { diffGame, type GameEvent } from "../src/game/events";
import { PredictedView, Predictor, type Prediction } from "../src/game/predict";
import { SnapshotBuffer } from "../src/game/snapshots";

/** a 60 Hz display */
export const FRAME_MS = 1000 / 60;
/** as in OnlineGame: how often an input is offered while the clock isn't lined up yet, in ms */
const SYNC_RETRY_MS = 250;

interface StateMsg {
  round: number;
  resultsIn: number;
  game: GameSnapshot;
  acks?: Record<string, InputAck>;
}

export interface Network {
  /** ms an input takes to reach the server */
  up: number;
  /** ms a snapshot takes to reach us, plus `jitter` for the one of that tick */
  down: number;
  jitter?: (tick: number) => number;
  /** play a server from before the acks: snapshots never say which input is in force */
  noAcks?: boolean;
  /** the protocol the client speaks: 2 (the default) gets changes rather than every player and bomb in full */
  protocol?: 1 | 2;
}

export interface Frame {
  now: number;
  prediction: Prediction | null;
  /** the newest snapshot */
  latest: GameState | null;
  /** what gets drawn: the playback, with our bomber and bombs as predicted */
  shown: GameState | null;
  /** sounds and effects set off this frame (by the playback and by the prediction) */
  events: GameEvent[];
}

/**
 * One client playing a room over a pretend network. The server side steps the room every tick and sends
 * snapshots through the engine's SnapshotStream, as apps/server does; the client side runs OnlineGame's frame
 * every 1/60 s: send the controls when they change, play snapshots back, predict our bomber.
 */
export class Loopback {
  now = 0;
  readonly buffer = new SnapshotBuffer();
  readonly predictor: Predictor;
  readonly view: PredictedView;
  /** our bomber on the server after each tick */
  readonly served: { tick: number; x: number; y: number }[] = [];
  /** server ticks fall between frames rather than on them */
  private nextTick = 7;
  private nextFrame = FRAME_MS;
  private toServer: { at: number; msg: ClientMsg }[] = [];
  private toClient: { at: number; msg: StateMsg }[] = [];
  /** the server's record of what it has sent */
  private stream = new SnapshotStream();
  private held: Input = emptyInput();
  private pressed = new Set<Button>();
  private last = { dx: 0, dy: 0, at: -Infinity };
  private prev: GameState | null = null;

  constructor(
    readonly room: RoomState,
    readonly me: string,
    private readonly net: Network,
  ) {
    this.predictor = new Predictor(me);
    this.view = new PredictedView(me);
  }

  /** Hold the direction keys like this (nothing held: let go). */
  hold(dx: number, dy: number) {
    this.held = { ...emptyInput(), dx, dy };
  }

  /** Press a button once: it goes out with the next frame. */
  press(button: Button) {
    this.pressed.add(button);
  }

  /** Lets `ms` go by: server ticks, deliveries and frames in the order they fall due. Returns the frames. */
  run(ms: number): Frame[] {
    const end = this.now + ms;
    const frames: Frame[] = [];
    for (;;) {
      const arrival = this.toClient[0]?.at ?? Infinity;
      const t = Math.min(this.nextTick, arrival, this.nextFrame);
      if (t > end) break;
      this.now = t;
      if (t === this.nextTick) {
        this.serverTick();
        this.nextTick += TICK_MS;
      } else if (t === arrival) {
        const { msg } = this.toClient.shift()!;
        this.buffer.push(msg.round, msg.resultsIn, msg.game, t, msg.acks);
      } else {
        frames.push(this.frame());
        this.nextFrame += FRAME_MS;
      }
    }
    this.now = end;
    return frames;
  }

  /** Our bomber on the server at `tick`. */
  servedAt(tick: number) {
    return this.served.find((s) => s.tick === tick);
  }

  private serverTick() {
    for (const { msg } of this.toServer.filter((m) => m.at <= this.now)) handleClientMessage(this.room, this.me, msg, () => 1);
    this.toServer = this.toServer.filter((m) => m.at > this.now);
    stepRoom(this.room);
    const game = this.room.game;
    if (!game) return;
    const me = game.players.find((p) => p.id === this.me);
    if (me) this.served.push({ tick: game.tick, x: me.x, y: me.y });
    const { acks, snapshot } = this.stream.next(this.room.round, game, this.net.noAcks ? {} : inputAcks(this.room));
    const msg: StateMsg = JSON.parse(
      JSON.stringify({ round: this.room.round, resultsIn: this.room.resultsTicksLeft, game: snapshot(this.net.protocol ?? 2), acks }),
    );
    // one connection keeps its order: a late snapshot holds up the ones behind it
    const due = this.now + this.net.down + (this.net.jitter?.(game.tick) ?? 0);
    this.toClient.push({ at: Math.max(due, this.toClient.at(-1)?.at ?? -Infinity), msg });
  }

  /** OnlineGame's frame, without the drawing. */
  private frame(): Frame {
    const now = this.now;
    this.sendControls(now);
    const sample = this.buffer.sample(now);
    if (!sample) return { now, prediction: null, latest: null, shown: null, events: [] };
    const events: GameEvent[] = [];
    for (const snap of this.buffer.takePlayed()) {
      if (this.prev && snap.tick <= this.prev.tick) {
        this.prev = null; // a new round
        this.predictor.reset();
      }
      if (this.prev) events.push(...this.view.withoutOwn(diffGame(this.prev, snap)));
      this.prev = snap;
    }
    const prediction = this.predictor.predict(sample.latest, this.buffer.acks, now);
    const shown = this.view.apply(sample.view, prediction, now);
    events.push(...shown.events);
    return { now, prediction, latest: sample.latest, shown: shown.view, events };
  }

  private sendControls(now: number) {
    const input = { ...this.held };
    for (const b of this.pressed) input[b] = true;
    this.pressed.clear();
    const changed = input.dx !== this.last.dx || input.dy !== this.last.dy || input.bomb || input.action || input.pet;
    if (!changed && (this.predictor.synced || now - this.last.at <= SYNC_RETRY_MS)) return;
    this.last = { dx: input.dx, dy: input.dy, at: now };
    const seq = this.predictor.record(input, now);
    this.toServer.push({ at: now + this.net.up, msg: { t: "input", ...input, seq } });
  }
}
