import {
  TICK_MS,
  TICK_RATE,
  TokenBucket,
  createRoom,
  disconnect,
  joinRoom,
  roomView,
  clampCapacity,
  handleClientMessage,
  inputAcks,
  randomSeed,
  stepRoom,
  toSnapshot,
  type ClientMsg,
  type ErrorCode,
  type InputAck,
  type RoomState,
  type ServerMsg,
  type Tile,
} from "@bomberman/engine";

export interface Env {
  ROOM: DurableObjectNamespace;
}

const MAX_CATCH_UP_STEPS = 5;
const MAX_MESSAGE_BYTES = 512;
const PID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
/** per connection: inputs are sent on change, so a real player stays far below this */
const MESSAGES_PER_SECOND = 40;
const MESSAGE_BURST = 80;
/** a client still flooding after this many dropped messages gets disconnected */
const MAX_DROPPED = 300;

/**
 * One instance per room code. Holds the authoritative room + match state and
 * runs the game loop for as long as somebody is connected. Plain (non-hibernating)
 * WebSockets are used on purpose: the loop needs to stay alive during a match and
 * the in-memory state would be lost on hibernation.
 */
interface Session {
  id: string;
  /** message rate limit for this connection */
  bucket: TokenBucket;
  dropped: number;
}

export class Room {
  private room: RoomState | null = null;
  private sessions = new Map<WebSocket, Session>();
  /** tiles as last broadcast; snapshots only carry tiles when these change (or someone new arrives) */
  private sentTiles: Tile[] | null = null;
  private sentRound = -1;
  /** the input acknowledgements as last broadcast, by player: snapshots only carry the ones that changed */
  private sentAcks = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private acc = 0;
  private dirty = false;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.pathname.split("/").pop()!.toUpperCase();
    const pid = url.searchParams.get("pid") ?? "";
    const name = url.searchParams.get("name") ?? "";
    const create = url.searchParams.get("create") === "1";
    const max = url.searchParams.get("max");
    const capacity = clampCapacity(max === null ? undefined : Number(max));

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    if (!PID_PATTERN.test(pid)) {
      this.reject(server, "bad_request", "Identificador inválido.");
    } else if (create && this.room && !this.room.members.some((m) => m.id === pid)) {
      this.reject(server, "exists", "Essa sala já existe.");
    } else if (!create && !this.room) {
      this.reject(server, "not_found", "Sala não encontrada.");
    } else {
      this.room ??= createRoom(code, capacity);
      const result = joinRoom(this.room, pid, name);
      if (!result.ok) {
        this.reject(server, "full", "A sala está cheia.");
      } else {
        this.attach(server, pid);
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Tell the client why it can't stay, then hang up. */
  private reject(ws: WebSocket, code: ErrorCode, message: string) {
    this.send(ws, { t: "error", code, message });
    ws.close(4000, code);
  }

  private attach(ws: WebSocket, id: string) {
    // the same player reconnecting (e.g. a refresh) replaces the stale socket
    for (const [other, session] of this.sessions) {
      if (session.id === id) {
        this.sessions.delete(other);
        this.reject(other, "replaced", "Você entrou nesta sala em outra aba.");
      }
    }
    this.sessions.set(ws, { id, bucket: new TokenBucket(MESSAGES_PER_SECOND, MESSAGE_BURST, Date.now()), dropped: 0 });
    this.sentTiles = null; // the newcomer needs the full board
    ws.addEventListener("message", (e) => this.onMessage(ws, e));
    ws.addEventListener("close", () => this.onClose(ws));
    ws.addEventListener("error", () => this.onClose(ws));

    this.send(ws, { t: "welcome", id });
    this.dirty = true;
    this.startLoop();
  }

  private onClose(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session || !this.room) return;
    this.sessions.delete(ws);
    disconnect(this.room, session.id);
    this.dirty = true;
  }

  private onMessage(ws: WebSocket, event: MessageEvent) {
    const session = this.sessions.get(ws);
    const room = this.room;
    if (!session || !room || typeof event.data !== "string" || event.data.length > MAX_MESSAGE_BYTES) return;
    if (!session.bucket.take(Date.now())) {
      if (++session.dropped > MAX_DROPPED) {
        this.sessions.delete(ws);
        this.reject(ws, "bad_request", "Mensagens demais.");
      }
      return;
    }

    let msg: ClientMsg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    this.dirty = handleClientMessage(room, session.id, msg, randomSeed) || this.dirty;
    this.hangUpNonMembers(room);
  }

  /** Whoever is no longer a member (left, removed...) stops getting updates and is hung up on. */
  private hangUpNonMembers(room: RoomState) {
    for (const [ws, session] of this.sessions) {
      if (room.members.some((m) => m.id === session.id)) continue;
      this.sessions.delete(ws);
      ws.close(1000, "left");
    }
  }

  private startLoop() {
    if (this.timer) return;
    this.lastTime = Date.now();
    this.acc = 0;
    this.timer = setInterval(() => this.loop(), TICK_MS);
  }

  private stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private loop() {
    const room = this.room;
    if (!room) return this.stopLoop();
    if (this.sessions.size === 0 && room.members.length === 0) {
      this.room = null;
      return this.stopLoop();
    }

    const now = Date.now();
    this.acc += now - this.lastTime;
    this.lastTime = now;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < MAX_CATCH_UP_STEPS) {
      if (stepRoom(room)) this.dirty = true;
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps === MAX_CATCH_UP_STEPS) this.acc = 0; // we fell behind; drop the backlog instead of spiralling
    // after catching up only the newest state matters; clients interpolate across skipped ticks
    if (steps > 0 && room.game) this.broadcastState(room);
    if (steps > 0) this.hangUpNonMembers(room);

    if (this.dirty) {
      this.dirty = false;
      this.broadcast({ t: "room", room: roomView(room) });
    }
  }

  private broadcastState(room: RoomState) {
    const game = room.game!;
    // once the podium is up and the last flames are out nothing moves: once a second keeps the countdown going
    const idle = game.phase === "finished" && game.flames.length === 0;
    if (idle && room.resultsTicksLeft % TICK_RATE !== 0) return;
    const tilesChanged =
      this.sentRound !== room.round || !this.sentTiles || game.tiles.some((t, i) => t !== this.sentTiles![i]);
    if (tilesChanged) {
      if (this.sentRound !== room.round) this.sentAcks.clear();
      this.sentTiles = [...game.tiles];
      this.sentRound = room.round;
    }
    const acks: Record<string, InputAck> = {};
    for (const [id, ack] of Object.entries(inputAcks(room))) {
      const key = ack.join(":");
      if (this.sentAcks.get(id) === key) continue;
      this.sentAcks.set(id, key);
      acks[id] = ack;
    }
    this.broadcast({ t: "state", round: room.round, resultsIn: room.resultsTicksLeft, game: toSnapshot(game, tilesChanged), ...(Object.keys(acks).length > 0 && { acks }) });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket already closing; its close handler cleans up
    }
  }

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(data);
      } catch {
        // see send()
      }
    }
  }
}
