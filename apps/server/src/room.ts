import {
  TICK_MS,
  createRoom,
  disconnect,
  joinRoom,
  roomView,
  clampCapacity,
  handleClientMessage,
  randomSeed,
  stepRoom,
  type ClientMsg,
  type ErrorCode,
  type RoomState,
  type ServerMsg,
} from "@bomberman/engine";

export interface Env {
  ROOM: DurableObjectNamespace;
}

const MAX_CATCH_UP_STEPS = 5;
const MAX_MESSAGE_BYTES = 512;
const PID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;

/**
 * One instance per room code. Holds the authoritative room + match state and
 * runs the game loop for as long as somebody is connected. Plain (non-hibernating)
 * WebSockets are used on purpose: the loop needs to stay alive during a match and
 * the in-memory state would be lost on hibernation.
 */
export class Room {
  private room: RoomState | null = null;
  /** socket -> player id */
  private sessions = new Map<WebSocket, string>();
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
    for (const [other, owner] of this.sessions) {
      if (owner === id) {
        this.sessions.delete(other);
        this.reject(other, "replaced", "Você entrou nesta sala em outra aba.");
      }
    }
    this.sessions.set(ws, id);
    ws.addEventListener("message", (e) => this.onMessage(ws, e));
    ws.addEventListener("close", () => this.onClose(ws));
    ws.addEventListener("error", () => this.onClose(ws));

    this.send(ws, { t: "welcome", id });
    this.dirty = true;
    this.startLoop();
  }

  private onClose(ws: WebSocket) {
    const id = this.sessions.get(ws);
    if (id === undefined || !this.room) return;
    this.sessions.delete(ws);
    disconnect(this.room, id);
    this.dirty = true;
  }

  private onMessage(ws: WebSocket, event: MessageEvent) {
    const id = this.sessions.get(ws);
    const room = this.room;
    if (id === undefined || !room || typeof event.data !== "string" || event.data.length > MAX_MESSAGE_BYTES) return;

    let msg: ClientMsg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    this.dirty = handleClientMessage(room, id, msg, randomSeed) || this.dirty;
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
    if (steps > 0 && room.game) this.broadcast({ t: "state", round: room.round, resultsIn: room.resultsTicksLeft, game: room.game });

    if (this.dirty) {
      this.dirty = false;
      this.broadcast({ t: "room", room: roomView(room) });
    }
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
