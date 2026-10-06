/**
 * End-to-end smoke test against a running server (`bun run dev:server`).
 * Usage: bun run e2e [ws://localhost:8787]
 */
import { PROTOCOL_VERSION, RANDOM_MAP, fromSnapshot, isMapId, randomRoomCode, type ClientMsg, type GameState, type RoomView, type ServerMsg } from "../packages/engine/src";

const BASE = process.argv[2] ?? "ws://localhost:8787";

class Client {
  ws!: WebSocket;
  room: RoomView | null = null;
  lastState: Extract<ServerMsg, { t: "state" }> | null = null;
  /** the last input number the server acknowledged for us */
  acked = 0;
  states: Extract<ServerMsg, { t: "state" }>[] = [];
  errors: string[] = [];
  pongs: number[] = [];
  closed = false;
  id = "";

  constructor(
    public name: string,
    public pid = `${name}-${Math.random().toString(36).slice(2)}-xxxxxxxx`.slice(0, 30),
    /** the protocol to speak (as the web client does); without one the server sends everything in full */
    public version?: number,
  ) {}

  connect(code: string, create = false, max?: number, teams = false): Promise<void> {
    return new Promise((resolve, reject) => {
      this.closed = false;
      const v = this.version ? `&v=${this.version}` : "";
      this.ws = new WebSocket(`${BASE}/ws/${code}?pid=${this.pid}&name=${this.name}${create ? "&create=1" : ""}${max ? `&max=${max}` : ""}${teams ? "&teams=1" : ""}${v}`);
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as ServerMsg;
        if (msg.t === "room") this.room = msg.room;
        else if (msg.t === "state") {
          this.lastState = msg;
          const ack = msg.acks?.[this.id];
          if (ack) this.acked = ack[0]; // acknowledgements only come when they change
          this.states.push(msg);
        }
        else if (msg.t === "error") this.errors.push(msg.code);
        else if (msg.t === "pong") this.pongs.push(msg.at);
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
check("the match opens with a Ready… Go! countdown", a.lastState!.game.goTick > 0);
await until("go", () => a.lastState!.game.tick > a.lastState!.game.goTick);

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
a.send({ t: "input", dx: 1, dy: 0, bomb: false, seq: 41 });
await sleep(400);
check("input moves the player on the server", pa().x > x0 + 0.5 || pa().y !== y0);
check("snapshots acknowledge the numbered input (for the client's prediction)", a.acked === 41);
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

// lean snapshots: the board comes with the first state, then only when it changes; never the RNG
const lean = new Client("Lena");
const leanRoom = randomRoomCode();
await lean.connect(leanRoom, true, 2);
const states = lean.states;
await until("lean room", () => lean.room !== null);
lean.send({ t: "addBot" });
await until("bot added", () => lean.room!.members.some((m) => m.bot));
check("host can add a bot", lean.room!.members.length === 2);
lean.send({ t: "start" });
await until("lean states", () => states.length > 20);
await until("lean go", () => lean.lastState!.game.tick > lean.lastState!.game.goTick);
check("first snapshot carries the board", Array.isArray(states[0].game.tiles));
check("later snapshots skip an unchanged board", states.slice(1, 10).some((s) => s.game.tiles === undefined));
check("snapshots never carry the RNG", states.every((s) => !("rng" in s.game)));
// watch the whole interval: a bot can walk out, drop a bomb and be back on its starting spot
const botPositions = new Set<string>();
const botBombs = new Set<number>();
for (let i = 0; i < 30; i++) {
  const bot = lean.lastState!.game.players.find((p) => p.id === "bot-1")!;
  botPositions.add(`${bot.x.toFixed(2)},${bot.y.toFixed(2)}`);
  for (const b of lean.lastState!.game.bombs) if (b.owner === "bot-1") botBombs.add(b.id);
  await sleep(50);
}
check(`the bot plays on its own (${botPositions.size} positions, ${botBombs.size} bombs)`, botPositions.size > 1 || botBombs.size > 0);

// pings come straight back, carrying what was sent
lean.send({ t: "ping", at: 1234.5 });
await until("pong", () => lean.pongs.length > 0);
check("a ping is answered with the same stamp", lean.pongs[0] === 1234.5);

// a client that speaks protocol 2 gets players and bombs as changes (in full once a second) and can rebuild them
const delta = new Client("Dora", undefined, PROTOCOL_VERSION);
await delta.connect(randomRoomCode(), true, 2);
await until("delta room", () => delta.room !== null);
delta.send({ t: "addBot" });
await until("delta bot", () => delta.room!.members.length === 2);
delta.send({ t: "start" });
await until("delta states", () => delta.states.length > 75, 5000);
const deltaStates = delta.states.map((s) => s.game);
check("protocol 2: most snapshots carry changes, not players", deltaStates.filter((g) => g.changes && !g.players).length > 50);
check("protocol 2: players come in full at least once a second", deltaStates.filter((g) => g.players).length >= 2);
let rebuilt: GameState | null = null;
let rebuildOk = true;
let board = { tiles: deltaStates[0].tiles!, floor: deltaStates[0].floor ?? null };
for (const g of deltaStates) {
  if (g.tiles) board = { tiles: g.tiles, floor: g.floor ?? null };
  const next = fromSnapshot(g, board, rebuilt);
  if (!next || (g.players && rebuilt && g.players.length !== rebuilt.players.length)) rebuildOk = false;
  rebuilt = next ?? rebuilt;
}
check("protocol 2: every snapshot rebuilds on the one before", rebuildOk && rebuilt!.players.every((p) => typeof p.x === "number" && p.id !== undefined));

// a room created for teams: newcomers fill the sides evenly, a match takes three, and with the sides and the
// map left to chance the server draws them: two against one, on a real map
const tHost = new Client("Tina");
await tHost.connect(randomRoomCode(), true, 2, true);
await until("team room", () => tHost.room !== null);
check("room created with teams=1 plays in teams, with three seats at least", tHost.room!.teams === true && tHost.room!.members[0].team === 0 && tHost.room!.capacity === 3);
tHost.send({ t: "addBot" });
await until("team bot", () => tHost.room!.members.length === 2);
check("the next one in goes to the other side", tHost.room!.members[1].team === 1);
// messages are handled in order: had the match started, the room would have turned the bot away
tHost.send({ t: "start" });
tHost.send({ t: "addBot" });
tHost.send({ t: "randomTeams", on: true });
tHost.send({ t: "map", mapId: RANDOM_MAP });
await until("third, drawn sides, random map", () => tHost.room!.members.length === 3 && tHost.room!.randomTeams === true && tHost.room!.randomMap === true);
check("two can't play in teams", tHost.lastState === null && tHost.room!.phase === "lobby");
tHost.send({ t: "start" });
await until("team match", () => tHost.lastState !== null);
const drawn = tHost.lastState!.game.players.map((p) => p.team);
check(`the sides are drawn two against one (${drawn.join()})`, drawn.join() === "0,0,1");
check(`a map is drawn for the match (${tHost.lastState!.game.mapId})`, isMapId(tHost.lastState!.game.mapId) && tHost.room!.mapId === tHost.lastState!.game.mapId);
tHost.send({ t: "leave" });

// the host can send someone out: they are told why and hung up on, and the room no longer lists them
const kHost = new Client("Kai");
const kGuest = new Client("Kim");
const kRoom = randomRoomCode();
await kHost.connect(kRoom, true);
await until("kick room", () => kHost.room !== null);
await kGuest.connect(kRoom);
await until("guest in", () => kHost.room!.members.length === 2);
kHost.send({ t: "kick", id: kGuest.id });
await until("kicked", () => kGuest.errors.length > 0 && kHost.room!.members.length === 1);
check("a kicked player is told they were removed", kGuest.errors[0] === "removed");
await until("kicked closed", () => kGuest.closed);
check("and their connection is closed", kGuest.closed);

// leaving is immediate: the other player sees them gone without the reconnect grace
lean.send({ t: "leave" });
await sleep(300);
const watcher = new Client("Walt");
await watcher.connect(leanRoom);
await until("room gone or empty", () => watcher.errors.length > 0 || watcher.room !== null);
check("after the last human leaves, the room (and its bots) is gone", watcher.errors[0] === "not_found");

for (const cl of [a, b, c, d, e1, ghost, dup, h, i2, j, lean, watcher, kHost, kGuest, delta, tHost]) cl.ws?.close();
console.log(failed === 0 ? "\nAll e2e checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
