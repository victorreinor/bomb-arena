import {
  FLAME_TICKS,
  KICK_INTERVAL_TICKS,
  TILE,
  createGame,
  createRoom,
  handleClientMessage,
  joinRoom,
  step,
  stepRoom,
  type Bomb,
  type ClientMsg,
  type CreateGameOptions,
  type Flame,
  type GameState,
  type Inputs,
  type MapDef,
  type RoomState,
} from "../src";

/** Build a state from ASCII rows; `.` empty, `#` hard, `+` soft, digits spawn. */
export function makeGame(
  rows: string[],
  playerCount = 2,
  seed = 1,
  options: Pick<CreateGameOptions, "revenge" | "timeLimitTicks" | "countdownTicks"> = {},
): GameState {
  const map: MapDef = { id: "test", name: "test", rows, softDensity: 0 };
  return createGame({
    map,
    seed,
    ...options,
    players: Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, color: i })),
  });
}

/** One-row arena: `corridor("1....2")` is a walled strip with p1 on the left and p2 on the right. */
export const corridor = (inner: string) => ["#".repeat(inner.length + 2), `#${inner}#`, "#".repeat(inner.length + 2)];

/** A bomb dropped straight into the state (by default owned by p2, with a fuse long enough not to interfere). */
export function testBomb(s: GameState, x: number, y: number, extra: Partial<Bomb> = {}): Bomb {
  const bomb: Bomb = {
    id: s.nextBombId++,
    owner: "p2",
    x,
    y,
    ticksLeft: 200,
    range: 2,
    remote: false,
    power: false,
    slide: null,
    slideTimer: 0,
    slideInterval: KICK_INTERVAL_TICKS,
    held: null,
    flight: null,
    ...extra,
  };
  s.bombs.push(bomb);
  return bomb;
}

/** A flame put straight onto (x, y) (by default from p2's bomb, burning for FLAME_TICKS). */
export function testFlame(s: GameState, x: number, y: number, extra: Partial<Flame> = {}): Flame {
  const flame: Flame = { x, y, arms: 0, ticksLeft: FLAME_TICKS, owner: "p2", ...extra };
  s.flames.push(flame);
  return flame;
}

/** Advance `ticks` steps with the same inputs every tick. */
export function run(s: GameState, ticks: number, inputs: Inputs = {}) {
  for (let i = 0; i < ticks; i++) step(s, inputs);
}

/**
 * A 2-player room (u1 hosting, u2) whose match has started through client messages and is past its
 * countdown, on an arena cleared of soft blocks so nothing gets in the way.
 */
export function startedMatch(): RoomState {
  const room = createRoom("BCDFG", 2);
  joinRoom(room, "u1", "A");
  joinRoom(room, "u2", "B");
  handleClientMessage(room, "u2", { t: "ready", ready: true }, () => 1);
  if (!handleClientMessage(room, "u1", { t: "start" }, () => 1)) throw new Error("the match didn't start");
  pastCountdown(room);
  const g = room.game!;
  g.tiles = g.tiles.map((t) => (t === TILE.SOFT ? TILE.EMPTY : t));
  return room;
}

/** Steps a room to the end of its match's "Ready… Go!" countdown: the next step is the first one inputs count in. */
export function pastCountdown(room: RoomState) {
  while (room.game && room.game.tick < room.game.goTick) stepRoom(room);
}

/** A client message from member `id`, as the server would apply it (matches started this way use seed 7). */
export const send = (room: RoomState, id: string, msg: ClientMsg) => handleClientMessage(room, id, msg, () => 7);
