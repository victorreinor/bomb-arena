import {
  FLAME_TICKS,
  RESULTS_TICKS,
  botInput,
  KICK_INTERVAL_TICKS,
  TILE,
  createGame,
  createRoom,
  handleClientMessage,
  joinRoom,
  step,
  stepRoom,
  type Bomb,
  type BotLevel,
  type BotProfile,
  type ClientMsg,
  type CreateGameOptions,
  type Flame,
  type GameState,
  type Inputs,
  type MapDef,
  type RoomState,
} from "../src";

/** Build a state from ASCII rows; `.` empty, `#` hard, `+` soft, digits spawn. `teams` puts p1, p2… on a side each (a team match). */
export function makeGame(
  rows: string[],
  playerCount = 2,
  seed = 1,
  { teams, ...options }: Pick<CreateGameOptions, "revenge" | "friendlyFire" | "timeLimitTicks" | "countdownTicks"> & { teams?: number[] } = {},
): GameState {
  const map: MapDef = { id: "test", name: "test", rows, softDensity: 0 };
  return createGame({
    map,
    seed,
    ...options,
    players: Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, color: i, team: teams?.[i] })),
  });
}

/** A corridor that one bomb sets all alight, with pockets to duck into; p2 out of reach in a corridor of its own. */
export const POCKETS = ["#####################", "#.........2.........#", "#####################", "#.........1.........#", "####.###.###.###.####", "#####################"];

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
    pierce: false,
    rubber: false,
    mine: false,
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
  const owner = extra.owner ?? "p2";
  const flame: Flame = { x, y, arms: 0, ticksLeft: FLAME_TICKS, owner, owners: owner ? [owner] : [], ...extra };
  s.flames.push(flame);
  return flame;
}

/**
 * A bot that makes none of the mistakes the levels are made of and wastes no time: for testing what every
 * level does underneath them, without a level's dice deciding the result.
 */
export const FLAWLESS: BotProfile = {
  reaction: 0, distracted: 0, misjudge: 0, chainBlind: 0, rethink: 4, hesitate: [0, 0], rest: [0, 0], panic: 0, freeze: [0, 0],
  pounces: 1, hunts: 1, itemReach: 8, refuges: 1, reckless: 0,
};

/** Runs a game where the listed ids are bots (of `level`) and everyone else stands still, until it ends or `ticks` run out. */
export function play(s: GameState, bots: string[], ticks: number, level?: BotLevel | BotProfile) {
  for (let i = 0; i < ticks && s.phase === "playing"; i++) {
    const inputs: Inputs = {};
    for (const id of bots) inputs[id] = botInput(s, id, level);
    step(s, inputs);
  }
}

/** Advance `ticks` steps with the same inputs every tick. */
export function run(s: GameState, ticks: number, inputs: Inputs = {}) {
  for (let i = 0; i < ticks; i++) step(s, inputs);
}

/**
 * A 2-player room (u1 hosting, u2) whose match has started through client messages and is past its
 * countdown (still in it with `inCountdown`), on the classic map unless `mapId` says otherwise, cleared of
 * soft blocks so nothing gets in the way.
 */
export function startedMatch({ inCountdown = false, mapId = "classic" } = {}): RoomState {
  const room = createRoom("BCDFG", 2);
  joinRoom(room, "u1", "A");
  joinRoom(room, "u2", "B");
  handleClientMessage(room, "u1", { t: "map", mapId }, () => 1);
  handleClientMessage(room, "u2", { t: "ready", ready: true }, () => 1);
  if (!handleClientMessage(room, "u1", { t: "start" }, () => 1)) throw new Error("the match didn't start");
  if (!inCountdown) pastCountdown(room);
  const g = room.game!;
  g.tiles = g.tiles.map((t) => (t === TILE.SOFT ? TILE.EMPTY : t));
  return room;
}

/** Steps a room to the end of its match's "Ready… Go!" countdown: the next step is the first one inputs count in. */
export function pastCountdown(room: RoomState) {
  while (room.game && room.game.tick < room.game.goTick) stepRoom(room);
}

/** Ends a room's match with only `standing` left alive: the result is in and the podium still up. */
export function finishMatch(room: RoomState, ...standing: string[]) {
  pastCountdown(room);
  for (const p of room.game!.players) if (!standing.includes(p.id)) p.alive = false;
  stepRoom(room);
}

/** Sees the podium out: the room is back in the lobby. */
export function backToLobby(room: RoomState) {
  for (let i = 0; i <= RESULTS_TICKS && room.phase === "playing"; i++) stepRoom(room);
}

/** A client message from member `id`, as the server would apply it (matches started this way use seed 7). */
export const send = (room: RoomState, id: string, msg: ClientMsg) => handleClientMessage(room, id, msg, () => 7);
