import {
  KICK_INTERVAL_TICKS,
  createGame,
  handleClientMessage,
  step,
  type Bomb,
  type ClientMsg,
  type CreateGameOptions,
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
  options: Pick<CreateGameOptions, "revenge" | "timeLimitTicks"> = {},
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

/** Advance `ticks` steps with the same inputs every tick. */
export function run(s: GameState, ticks: number, inputs: Inputs = {}) {
  for (let i = 0; i < ticks; i++) step(s, inputs);
}

/** A client message from member `id`, as the server would apply it (matches started this way use seed 7). */
export const send = (room: RoomState, id: string, msg: ClientMsg) => handleClientMessage(room, id, msg, () => 7);
