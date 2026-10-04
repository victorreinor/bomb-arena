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
  type GameSnapshot,
  type InputAck,
  type RoomState,
  type SentLists,
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
 * Clients that take changes still get every player and bomb in full this often (in ticks), so one that
 * somehow fell out of step is back in a second.
 */
const FULL_LISTS_TICKS = TICK_RATE;
/**
 * A connection we are done with is left this long (ms) for the client to hang up: when the server closes
 * first, workerd logs "Network connection lost". Clients that don't (older ones) are closed after it.
 */
const HANG_UP_GRACE_MS = 1000;

/**
 * Answers a client's close. At our compatibility date workerd doesn't do it by itself, and until it's
 * answered the browser never reports the socket closed (a refused client would never get to its error).
 */
function closeBack(ws: WebSocket) {
  try {
    ws.close(1000);
  } catch {
    // already closed
  }
}

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
  /** the protocol the client speaks (see PROTOCOL_VERSION) */
  version: number;
}

export class Room {
  private room: RoomState | null = null;
  private sessions = new Map<WebSocket, Session>();
  /** tiles as last broadcast; snapshots only carry tiles when these change (or someone new arrives) */
  private sentTiles: Tile[] | null = null;
  private sentRound = -1;
  /** players and bombs as last broadcast: clients that speak protocol 2 only get what changed in them */
  private sentLists: SentLists | null = null;
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
    const version = Number(url.searchParams.get("v")) || 1;
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
        this.attach(server, pid, version);
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Tell the client why it can't stay, then hang up. */
  private reject(ws: WebSocket, code: ErrorCode, message: string) {
    this.send(ws, { t: "error", code, message });
    this.hangUp(ws, 4000, code);
  }

  /** Close a connection we are done with, unless the client does first (see HANG_UP_GRACE_MS). */
  private hangUp(ws: WebSocket, code: number, reason: string) {
    const timer = setTimeout(() => {
      try {
        ws.close(code, reason);
      } catch {
        // already closed
      }
    }, HANG_UP_GRACE_MS);
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      closeBack(ws);
    });
  }

  private attach(ws: WebSocket, id: string, version: number) {
    // the same player reconnecting (e.g. a refresh) replaces the stale socket
    for (const [other, session] of this.sessions) {
      if (session.id === id) {
        this.sessions.delete(other);
        this.reject(other, "replaced", "Você entrou nesta sala em outra aba.");
      }
    }
    this.sessions.set(ws, { id, bucket: new TokenBucket(MESSAGES_PER_SECOND, MESSAGE_BURST, Date.now()), dropped: 0, version });
    // the newcomer needs the board, the players and the bombs in full
    this.sentTiles = null;
    this.sentLists = null;
    ws.addEventListener("message", (e) => this.onMessage(ws, e));
    ws.addEventListener("close", () => {
      closeBack(ws);
      this.onClose(ws);
    });
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
    // a ping is about the connection, not the room: answer straight away
    if (msg?.t === "ping") return typeof msg.at === "number" ? this.send(ws, { t: "pong", at: msg.at }) : undefined;
    this.dirty = handleClientMessage(room, session.id, msg, randomSeed) || this.dirty;
    this.hangUpNonMembers(room, msg?.t === "kick");
  }

  /**
   * Whoever is no longer a member stops getting updates and is hung up on. After a kick they are told
   * why, so their client goes home instead of reconnecting.
   */
  private hangUpNonMembers(room: RoomState, kicked = false) {
    for (const [ws, session] of this.sessions) {
      if (room.members.some((m) => m.id === session.id)) continue;
      this.sessions.delete(ws);
      if (kicked) this.reject(ws, "removed", "O anfitrião tirou você da sala.");
      else this.hangUp(ws, 1000, "left");
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
    if (this.sentRound !== room.round) {
      this.sentRound = room.round;
      this.sentTiles = null;
      this.sentLists = null;
      this.sentAcks.clear();
    }
    const tilesChanged = !this.sentTiles || game.tiles.some((t, i) => t !== this.sentTiles![i]);
    if (tilesChanged) this.sentTiles = [...game.tiles];
    const acks: Record<string, InputAck> = {};
    for (const [id, ack] of Object.entries(inputAcks(room))) {
      const key = ack.join(":");
      if (this.sentAcks.get(id) === key) continue;
      this.sentAcks.set(id, key);
      acks[id] = ack;
    }
    const sent = game.tick % FULL_LISTS_TICKS === 0 ? null : this.sentLists;
    this.sentLists = structuredClone({ players: game.players, bombs: game.bombs });
    const state = (snap: GameSnapshot): ServerMsg => ({ t: "state", round: room.round, resultsIn: room.resultsTicksLeft, game: snap, ...(Object.keys(acks).length > 0 && { acks }) });
    // older clients get every player and bomb in full; each form is only built if someone needs it
    let full: string | undefined;
    let lean: string | undefined;
    for (const [ws, session] of this.sessions) {
      const data =
        session.version >= 2
          ? (lean ??= JSON.stringify(state(toSnapshot(game, tilesChanged, sent))))
          : (full ??= JSON.stringify(state(toSnapshot(game, tilesChanged))));
      this.sendRaw(ws, data);
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, data: string) {
    try {
      ws.send(data);
    } catch {
      // socket already closing; its close handler cleans up
    }
  }

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const ws of this.sessions.keys()) this.sendRaw(ws, data);
  }
}
