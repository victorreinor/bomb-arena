/**
 * End-to-end smoke test against a running server (`bun run dev:server`).
 * Usage: bun run e2e [ws://localhost:8787]
 */
import { randomRoomCode, type ClientMsg, type RoomView, type ServerMsg } from "../packages/engine/src";

const BASE = process.argv[2] ?? "ws://localhost:8787";

class Client {
  ws!: WebSocket;
  room: RoomView | null = null;
  lastState: Extract<ServerMsg, { t: "state" }> | null = null;
  errors: string[] = [];
  closed = false;
  id = "";

  constructor(
    public name: string,
    public pid = `${name}-${Math.random().toString(36).slice(2)}-xxxxxxxx`.slice(0, 30),
  ) {}

  connect(code: string, create = false, max?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.closed = false;
      this.ws = new WebSocket(`${BASE}/ws/${code}?pid=${this.pid}&name=${this.name}${create ? "&create=1" : ""}${max ? `&max=${max}` : ""}`);
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as ServerMsg;
        if (msg.t === "room") this.room = msg.room;
        else if (msg.t === "state") this.lastState = msg;
        else if (msg.t === "error") this.errors.push(msg.code);
        else if (msg.t === "welcome") this.id = msg.id;
      };
      this.ws.onopen = () => resolve();
      this.ws.onclose = () => (this.closed = true);
      this.ws.onerror = () => reject(new Error("socket error"));
    });
  }

  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(label: string, cond: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error(`timeout: ${label}`);
    await sleep(20);
  }
}
let failed = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}

const code = randomRoomCode();
const a = new Client("Ana");
const b = new Client("Bia");
const c = new Client("Caio");
const ghost = new Client("Ghost");

// joining a room that does not exist
await ghost.connect(randomRoomCode());
await until("not_found", () => ghost.errors.length > 0);
check("joining an unknown room is rejected (not_found)", ghost.errors[0] === "not_found");

await a.connect(code, true);
await until("A in room", () => a.room?.members.length === 1);
check("creator becomes host", a.room!.hostId === a.id);

const dup = new Client("Dup");
await dup.connect(code, true);
await until("exists", () => dup.errors.length > 0);
check("creating an existing code is rejected (exists)", dup.errors[0] === "exists");

await b.connect(code);
await until("B in room", () => a.room?.members.length === 2 && b.room?.members.length === 2);
check("second player joins with the code, gets a different colour", a.room!.members[0].color !== a.room!.members[1].color);

b.send({ t: "color", color: 3 });
await until("colour change", () => a.room!.members.find((m) => m.id === b.id)?.color === 3);
check("colour change reaches everyone", true);

a.send({ t: "start" });
await sleep(200);
check("host cannot start until everyone is ready", a.room!.phase === "lobby");

b.send({ t: "ready", ready: true });
await until("ready", () => a.room!.members.find((m) => m.id === b.id)?.ready === true);
a.send({ t: "map", mapId: "maze" });
await until("map", () => b.room!.mapId === "maze");
a.send({ t: "start" });
await until("playing", () => a.room!.phase === "playing" && a.lastState !== null && b.lastState !== null);
check("match starts and both receive snapshots", true);
check("chosen map is used", a.lastState!.game.mapId === "maze");

await c.connect(code);
await until("C waiting", () => c.room?.members.find((m) => m.id === c.id) !== undefined);
check("late joiner is waiting (not in game)", c.room!.members.find((m) => m.id === c.id)!.inGame === false);
check("late joiner still spectates snapshots", (await (async () => { await sleep(200); return c.lastState !== null; })()));

const ticksBefore = a.lastState!.game.tick;
await sleep(500);
const rate = (a.lastState!.game.tick - ticksBefore) / 0.5;
check(`server ticks at ~30 Hz (measured ${rate.toFixed(0)})`, rate > 24 && rate < 36);

const pa = () => a.lastState!.game.players.find((p) => p.id === a.id)!;
const x0 = pa().x;
const y0 = pa().y;
a.send({ t: "input", dx: 1, dy: 0, bomb: false });
await sleep(400);
check("input moves the player on the server", pa().x > x0 + 0.5 || pa().y !== y0);
a.send({ t: "input", dx: 0, dy: 0, bomb: true });
await until("bomb", () => a.lastState!.game.bombs.length === 1);
check("bomb press places a bomb", true);

const d = new Client("Dan");
const e1 = new Client("Eva");
await d.connect(code);
await e1.connect(code);
await until("full reply", () => e1.errors.length > 0 || e1.closed);
check("5th member is rejected (full)", e1.errors[0] === "full");

// reconnect keeps the seat
b.ws.close();
await sleep(300);
await b.connect(code);
await until("B back", () => a.room!.members.find((m) => m.id === b.id)?.connected === true);
check("reconnect within the grace period keeps the same seat", a.room!.members.length === 4);

// a room created for 2 players closes after the second one, and the host can raise it
const duo = randomRoomCode();
const h = new Client("Hugo");
const i2 = new Client("Iris");
const j = new Client("Jose");
await h.connect(duo, true, 2);
await until("duo created", () => h.room?.capacity === 2);
check("room created with max=2 reports capacity 2", true);
await i2.connect(duo);
await until("duo joined", () => h.room?.members.length === 2);
await j.connect(duo);
await until("duo full", () => j.errors.length > 0 || j.closed);
check("3rd player is rejected in a 2-player room (full)", j.errors[0] === "full");
h.send({ t: "capacity", capacity: 3 });
await until("capacity raised", () => h.room?.capacity === 3);
await j.connect(duo);
await until("duo joined 3", () => h.room?.members.length === 3);
check("host raising capacity lets the 3rd in", true);
i2.send({ t: "ready", ready: true });
await until("duo ready", () => h.room?.members.find((m) => m.id === i2.id)?.ready === true);
j.send({ t: "ready", ready: true });
await until("trio ready", () => h.room?.members.find((m) => m.id === j.id)?.ready === true);
h.send({ t: "start" });
await until("duo playing", () => h.room?.phase === "playing");
await until("duo snapshot", () => h.lastState !== null);
check("3-player match starts with all three in the game", h.lastState!.game.players.length === 3);

for (const cl of [a, b, c, d, e1, ghost, dup, h, i2, j]) cl.ws?.close();
console.log(failed === 0 ? "\nAll e2e checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
