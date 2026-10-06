import { DEFAULT_BOT_LEVEL, botId, botInput, botName, isBotLevel, type BotLevel } from "./bot";
import { START_COUNTDOWN_TICKS, TICK_RATE } from "./constants";
import { createGame, hurryBotsAlone, killPlayer, step, winners } from "./game";
import { MAPS, RANDOM_MAP, drawMap, getMap, isMapId, mapSeats } from "./maps";
import {
  BEST_OF_OPTIONS,
  DEFAULT_TIME_LIMIT,
  MAX_MEMBERS,
  MAX_NAME_LENGTH,
  MIN_MEMBERS,
  MIN_TEAM_MEMBERS,
  PLAYER_COLORS,
  TEAM_COUNT,
  TIME_LIMIT_OPTIONS,
  minutesToTicks,
  type ClientMsg,
  type ErrorCode,
  type InputAck,
  type MemberView,
  type RoomResult,
  type RoomView,
} from "./protocol";
import { pickFresh } from "./rng";
import { BUTTONS, emptyInput, type GameState, type Input } from "./types";

export const RECONNECT_GRACE_TICKS = 10 * TICK_RATE;
/** stirred into a match's seed to draw its map and sides, so the draws aren't the match's own first rolls */
const DRAW_SALT = 0x9e3779b9;
/** how long the podium stays up before everyone returns to the lobby */
export const RESULTS_TICKS = 10 * TICK_RATE;

export interface Member {
  id: string;
  name: string;
  color: number;
  ready: boolean;
  connected: boolean;
  inGame: boolean;
  disconnectedAt: number | null;
  /** a computer player's level (null for people): always connected, counts as ready, never host */
  bot: BotLevel | null;
  /** the side they play on when the room is in teams */
  team: number;
}

/** Bots and the host never have to press "ready". */
export const isReady = (room: { hostId: string | null }, m: Pick<Member, "id" | "ready" | "bot">) =>
  m.bot !== null || m.id === room.hostId || m.ready;
const canHost = (m: Member) => m.connected && !m.bot;

export interface RoomState {
  code: string;
  phase: "lobby" | "playing";
  hostId: string | null;
  /** the map picked or, with `randomMap`, the last one drawn (which the next draw leaves out) */
  mapId: string;
  /** a map is drawn at random for every match, among those with room for everyone */
  randomMap: boolean;
  capacity: number;
  revenge: boolean;
  /** matches are between two teams (each member's `team`) rather than everyone for themselves */
  teams: boolean;
  /** in a team match, whether a team-mate's blast kills */
  friendlyFire: boolean;
  /** the sides are drawn for every match (`drawTeams`) rather than picked */
  randomTeams: boolean;
  /** the splits drawn since every one was last played, the latest at the end (each one the ids on the first side) */
  teamDraws: string[];
  bestOf: number;
  /** minutes before sudden death; 0 = no limit */
  timeLimit: number;
  /** wins per member id in the current series / session */
  scores: Record<string, number>;
  round: number;
  /** counts every stepRoom call, in lobby too; used for grace periods */
  tick: number;
  members: Member[];
  game: GameState | null;
  inputs: Record<string, HeldInput>;
  /** -1 until the current match is over, then counts down to the return to the lobby */
  resultsTicksLeft: number;
  lastResult: RoomResult | null;
}

/**
 * What a player is holding down, with the number the client gave that input and the tick it first moved
 * the bomber on (the client's prediction lines its clock up with those).
 */
export type HeldInput = Input & { seq?: number; since?: number };

/** The fewest seats a room can have: a team match takes three players. */
export const minSeats = (teams: boolean) => (teams ? MIN_TEAM_MEMBERS : MIN_MEMBERS);

/** A seat count within what a room (in teams or not) can have; all of them, if it isn't a whole number. */
export const clampCapacity = (n: unknown, teams = false): number =>
  Number.isInteger(n) ? Math.max(minSeats(teams), Math.min(MAX_MEMBERS, n as number)) : MAX_MEMBERS;

/** The fewest seats a room can be cut down to: who is already in, and three in teams. */
export const fewestSeats = (room: { teams?: boolean; members: readonly unknown[] }) =>
  Math.max(room.members.length, minSeats(!!room.teams));

/** Whether the room plays in teams that each member picks (rather than drawn for every match). */
export const picksSides = (room: { teams?: boolean; randomTeams?: boolean }) => !!room.teams && !room.randomTeams;

export function createRoom(code: string, capacity: number = MAX_MEMBERS, teams = false): RoomState {
  return {
    code,
    phase: "lobby",
    hostId: null,
    mapId: "classic",
    randomMap: false,
    capacity: clampCapacity(capacity, teams),
    revenge: false,
    teams,
    friendlyFire: true,
    randomTeams: false,
    teamDraws: [],
    bestOf: 1,
    timeLimit: DEFAULT_TIME_LIMIT,
    scores: {},
    round: 0,
    tick: 0,
    members: [],
    game: null,
    inputs: {},
    resultsTicksLeft: -1,
    lastResult: null,
  };
}

const member = (room: RoomState, id: string) => room.members.find((m) => m.id === id);

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

function pickHost(room: RoomState) {
  const host = room.hostId ? member(room, room.hostId) : undefined;
  if (host && canHost(host)) return;
  room.hostId = room.members.find(canHost)?.id ?? null;
}

/** With every human gone, the bots go too (and the room can close). Returns whether anything changed. */
function dropOrphanBots(room: RoomState): boolean {
  if (room.members.length === 0 || room.members.some((m) => !m.bot)) return false;
  room.members = [];
  room.game = null;
  room.phase = "lobby";
  room.inputs = {};
  return true;
}

function addMember(room: RoomState, id: string, name: string, bot: BotLevel | null) {
  room.members.push({
    id,
    name,
    color: freeColor(room),
    ready: false,
    connected: true,
    // joining a match in progress means waiting for the next one
    inGame: false,
    disconnectedAt: null,
    bot,
    team: smallerTeam(room),
  });
}

/** The members on each side, by team. */
const sides = (room: RoomState): Member[][] => Array.from({ length: TEAM_COUNT }, (_, team) => room.members.filter((m) => m.team === team));

/** The side with fewer members (the first, when they are level): where a newcomer goes, so the teams fill up evenly. */
function smallerTeam(room: RoomState): number {
  const sizes = sides(room).map((side) => side.length);
  return sizes.indexOf(Math.min(...sizes));
}

/** Every way out of the room (leaving, timing out, being dropped at a round boundary, a bot removed) goes through here. */
function removeMember(room: RoomState, id: string) {
  const player = room.game?.players.find((p) => p.id === id);
  if (player?.alive) killPlayer(room.game!, player, "left"); // the dead keep their place in the ranking
  room.members = room.members.filter((m) => m.id !== id);
  delete room.inputs[id];
  delete room.scores[id];
  pickHost(room);
  dropOrphanBots(room);
}

/** Lobby settings are the host's to change, and only between matches. */
const hostInLobby = (room: RoomState, id: string) => room.phase === "lobby" && room.hostId === id;
const isOption = (options: readonly number[], value: number) => options.includes(value);
/** Whether `n` is one of `count` things numbered from 0 (a colour, a team). */
const isIndex = (n: number, count: number) => Number.isInteger(n) && n >= 0 && n < count;

function freeColor(room: RoomState): number {
  const taken = new Set(room.members.map((m) => m.color));
  return Array.from({ length: PLAYER_COLORS }, (_, i) => i).find((c) => !taken.has(c)) ?? 0;
}

export type JoinResult = { ok: true; reconnected: boolean } | { ok: false; error: Extract<ErrorCode, "full"> };

export function joinRoom(room: RoomState, id: string, rawName: string): JoinResult {
  const name = cleanName(rawName) || "Jogador";
  const existing = member(room, id);
  if (existing) {
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.name = name;
    pickHost(room);
    return { ok: true, reconnected: true };
  }
  if (room.members.length >= room.capacity) return { ok: false, error: "full" };
  addMember(room, id, name, null);
  pickHost(room);
  return { ok: true, reconnected: false };
}

export function disconnect(room: RoomState, id: string) {
  const m = member(room, id);
  if (!m || !m.connected) return;
  m.connected = false;
  m.disconnectedAt = room.tick;
  delete room.inputs[id];
  pickHost(room);
}

export function setColor(room: RoomState, id: string, color: number): boolean {
  const m = member(room, id);
  if (!m || !isIndex(color, PLAYER_COLORS)) return false;
  if (room.phase === "playing" && m.inGame) return false;
  if (room.members.some((o) => o.id !== id && o.color === color)) return false;
  m.color = color;
  return true;
}

export function setReady(room: RoomState, id: string, ready: boolean): boolean {
  const m = member(room, id);
  if (!m || room.phase !== "lobby") return false;
  m.ready = ready;
  return true;
}

/** Host-only lobby settings. Each returns whether something actually changed (so the room is re-sent). */
export function setMap(room: RoomState, id: string, mapId: string): boolean {
  if (!hostInLobby(room, id)) return false;
  const random = mapId === RANDOM_MAP;
  if (!random && !isMapId(mapId)) return false;
  if (room.randomMap === random && (random || room.mapId === mapId)) return false;
  room.randomMap = random;
  if (!random) room.mapId = mapId;
  return true;
}

/** How many players the room takes; never below who is already in, nor below three in teams. */
export function setCapacity(room: RoomState, id: string, capacity: number): boolean {
  if (!hostInLobby(room, id) || capacity !== clampCapacity(capacity) || capacity < fewestSeats(room)) return false;
  if (room.capacity === capacity) return false;
  room.capacity = capacity;
  return true;
}

export function setRevenge(room: RoomState, id: string, on: boolean): boolean {
  if (!hostInLobby(room, id) || room.revenge === on) return false;
  room.revenge = on;
  return true;
}

/** Two teams, or everyone for themselves; changing it starts the score over, and a room of two seats grows a third. */
export function setTeams(room: RoomState, id: string, on: boolean): boolean {
  if (!hostInLobby(room, id) || room.teams === on) return false;
  room.teams = on;
  room.capacity = clampCapacity(room.capacity, on);
  room.scores = {};
  return true;
}

export function setFriendlyFire(room: RoomState, id: string, on: boolean): boolean {
  if (!hostInLobby(room, id) || room.friendlyFire === on) return false;
  room.friendlyFire = on;
  return true;
}

/** Sides drawn for every match, or picked by each; changing it starts the score over (a series means one or the other). */
export function setRandomTeams(room: RoomState, id: string, on: boolean): boolean {
  if (!hostInLobby(room, id) || room.randomTeams === on) return false;
  room.randomTeams = on;
  room.scores = {};
  return true;
}

/** Which side `target` plays on: anyone picks their own, between matches; the host may move anyone (the bots, for one). */
export function setTeam(room: RoomState, id: string, team: number, target: string = id): boolean {
  const m = member(room, target);
  if (!m || room.phase !== "lobby" || !picksSides(room) || (target !== id && room.hostId !== id)) return false;
  if (!isIndex(team, TEAM_COUNT) || m.team === team) return false;
  m.team = team;
  return true;
}

/** Best-of-N series (1 = single matches); changing it starts the score over. */
export function setBestOf(room: RoomState, id: string, n: number): boolean {
  if (!hostInLobby(room, id) || !isOption(BEST_OF_OPTIONS, n) || room.bestOf === n) return false;
  room.bestOf = n;
  room.scores = {};
  return true;
}

/** Minutes a match lasts before sudden death (0 = no limit). */
export function setTimeLimit(room: RoomState, id: string, minutes: number): boolean {
  if (!hostInLobby(room, id) || !isOption(TIME_LIMIT_OPTIONS, minutes) || room.timeLimit === minutes) return false;
  room.timeLimit = minutes;
  return true;
}

/** Fill a free seat with a computer player (of the default level unless a valid one is asked for). */
export function addBot(room: RoomState, id: string, level?: unknown): boolean {
  if (!hostInLobby(room, id) || room.members.length >= room.capacity) return false;
  let n = 1;
  while (member(room, botId(n))) n++;
  addMember(room, botId(n), botName(botId(n)), isBotLevel(level) ? level : DEFAULT_BOT_LEVEL);
  return true;
}

export function setBotLevel(room: RoomState, id: string, botMemberId: string, level: unknown): boolean {
  const bot = member(room, botMemberId);
  if (!hostInLobby(room, id) || !bot?.bot || !isBotLevel(level) || bot.bot === level) return false;
  bot.bot = level;
  return true;
}

export function removeBot(room: RoomState, id: string, botMemberId: string): boolean {
  if (!hostInLobby(room, id) || !member(room, botMemberId)?.bot) return false;
  removeMember(room, botMemberId);
  return true;
}

/** The host sends a person out of the room, between matches (the server then hangs up on them). */
export function kickMember(room: RoomState, id: string, target: string): boolean {
  const m = member(room, target);
  if (!hostInLobby(room, id) || !m || m.bot || target === id) return false;
  removeMember(room, target);
  return true;
}

/** Leaving on purpose: gone at once (no reconnect grace); in a match their bomber is out. */
export function leaveRoom(room: RoomState, id: string): boolean {
  if (!member(room, id)) return false;
  removeMember(room, id);
  return true;
}

/**
 * Whether the room has more players than the chosen map has spawns for (a one-on-one map with three in).
 * Never with a map drawn at random: only those with room for everyone are drawn.
 */
export const tooManyForMap = (room: { mapId: string; randomMap?: boolean; members: Pick<MemberView, "connected">[] }) =>
  !room.randomMap && room.members.filter((m) => m.connected).length > mapSeats(getMap(room.mapId));

/** Whether a room picking its sides has everyone (connected) on the same one: nobody to play against. Drawn sides never are. */
export const oneSided = (room: { teams?: boolean; randomTeams?: boolean; members: Pick<MemberView, "connected" | "team">[] }) =>
  picksSides(room) && new Set(room.members.filter((m) => m.connected).map((m) => m.team)).size < 2;

/**
 * What a lobby must have settled before a match: too few players in, too few for teams, more than the map
 * seats, one side empty, someone not ready.
 */
export type StartBlocker = "players" | "teamPlayers" | "map" | "sides" | "ready";

/** The room as `startBlocker` and `canStart` need it: a `RoomView` will do, and so will the room itself. */
type Startable = Pick<RoomView, "phase" | "hostId" | "mapId" | "randomMap" | "teams" | "randomTeams"> & {
  members: Pick<MemberView, "id" | "connected" | "ready" | "bot" | "team">[];
};

/**
 * What still keeps a match from starting (the first of them that applies), or null: at least two connected
 * players are in (three in teams), the map has room for them, in teams there is someone on each side, and all
 * are ready.
 */
export function startBlocker(room: Startable): StartBlocker | null {
  const connected = room.members.filter((m) => m.connected);
  if (connected.length < MIN_MEMBERS) return "players";
  if (connected.length < minSeats(!!room.teams)) return "teamPlayers";
  if (tooManyForMap(room)) return "map";
  if (oneSided(room)) return "sides";
  return connected.every((m) => isReady(room, m)) ? null : "ready";
}

/** The host may start a match from the lobby once nothing blocks it. */
export const canStart = (room: Startable): boolean => room.phase === "lobby" && startBlocker(room) === null;

/** Members still away when a round starts or ends lose their seat. */
function dropDisconnected(room: RoomState) {
  for (const m of room.members.filter((o) => !o.connected)) removeMember(room, m.id);
}

/**
 * The order the players take their corners in (SPAWN_ORDER gives the first two opposite ones). In teams the
 * bigger side goes first, so team-mates start across the board from each other with the other team between them.
 */
function lineUp(room: RoomState): Member[] {
  return room.teams ? sides(room).sort((a, b) => b.length - a.length).flat() : room.members;
}

/**
 * Every way to split `ids` into two sides as even as they come (two against two, two against one), each as
 * the ids on the first side, the bigger one. Two against two counts each pairing once: the first id's side.
 */
function evenSplits(ids: string[]): string[][] {
  const size = Math.ceil(ids.length / 2);
  const splits: string[][] = [];
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const side = ids.filter((_, i) => mask & (1 << i));
    if (side.length === size && (ids.length % 2 === 1 || mask & 1)) splits.push(side);
  }
  return splits;
}

/**
 * Sides for a match in a room that draws them: as even as they come, and no split played again until every
 * one has been, so within three matches everyone has played alongside everyone (with three, each has a turn
 * alone). A new round of them never starts with the split just played.
 */
function drawTeams(room: RoomState, dice: { rng: number }) {
  const splits = evenSplits(room.members.map((m) => m.id));
  const keys = splits.map((side) => side.join(" "));
  const played = room.teamDraws.filter((k) => keys.includes(k)); // splits of who is in now
  const roundOver = played.length === keys.length;
  const pick = pickFresh(dice, keys, (k) => (roundOver ? k === played.at(-1) : played.includes(k)));
  room.teamDraws = roundOver ? [pick] : [...played, pick];
  const side = splits[keys.indexOf(pick)];
  for (const m of room.members) m.team = side.includes(m.id) ? 0 : 1;
}

export function startGame(room: RoomState, id: string, seed: number): boolean {
  if (room.hostId !== id || !canStart(room)) return false;
  dropDisconnected(room);
  if (room.lastResult?.seriesWon) room.scores = {}; // a new series begins
  const dice = { rng: (seed ^ DRAW_SALT) >>> 0 };
  if (room.randomMap) {
    const fits = MAPS.filter((m) => mapSeats(m) >= room.members.length);
    room.mapId = drawMap(fits, dice, room.mapId).id;
  }
  if (room.teams && room.randomTeams) drawTeams(room, dice);
  const players = lineUp(room).map((m) => ({ id: m.id, color: m.color, ...(room.teams && { team: m.team }) }));
  const timeLimitTicks = room.timeLimit > 0 ? minutesToTicks(room.timeLimit) : null;
  room.game = createGame({
    map: getMap(room.mapId),
    players,
    seed,
    revenge: room.revenge,
    friendlyFire: room.friendlyFire,
    timeLimitTicks,
    countdownTicks: START_COUNTDOWN_TICKS,
  });
  room.phase = "playing";
  room.round++;
  room.inputs = {};
  room.resultsTicksLeft = -1;
  room.lastResult = null;
  for (const m of room.members) {
    m.inGame = true;
    m.ready = false;
  }
  return true;
}

/** Takes whatever the client sent and keeps only valid values. */
export function setInput(room: RoomState, id: string, raw: Partial<Record<keyof HeldInput, unknown>>) {
  const m = member(room, id);
  if (!m || !m.inGame || room.phase !== "playing") return;
  const clamp = (n: unknown) => (n === -1 || n === 1 ? n : 0);
  const prev = room.inputs[id];
  const input: HeldInput = { ...emptyInput(), dx: clamp(raw.dx), dy: clamp(raw.dy) };
  input.seq = Number.isSafeInteger(raw.seq) ? (raw.seq as number) : prev?.seq;
  if (input.seq === prev?.seq) input.since = prev?.since;
  // buttons are one-shot presses: keep them queued until the next tick consumes them
  for (const b of BUTTONS) input[b] = !!prev?.[b] || raw[b] === true;
  room.inputs[id] = input;
}

/**
 * Applies one message from a client to the room. Returns true when something shown in the
 * lobby changed (so the room should be re-broadcast); inputs never count.
 * Lives here, not in the server, so that every message type is covered by tests.
 */
export function handleClientMessage(room: RoomState, id: string, msg: ClientMsg, newSeed: () => number): boolean {
  switch (msg?.t) {
    case "input":
      setInput(room, id, msg);
      return false;
    case "color":
      return setColor(room, id, msg.color);
    case "ready":
      return setReady(room, id, msg.ready === true);
    case "map":
      return setMap(room, id, msg.mapId);
    case "capacity":
      return setCapacity(room, id, msg.capacity);
    case "revenge":
      return setRevenge(room, id, msg.on === true);
    case "teams":
      return setTeams(room, id, msg.on === true);
    case "friendlyFire":
      return setFriendlyFire(room, id, msg.on === true);
    case "randomTeams":
      return setRandomTeams(room, id, msg.on === true);
    case "team":
      return setTeam(room, id, msg.team, typeof msg.id === "string" ? msg.id : id);
    case "bestOf":
      return setBestOf(room, id, msg.n);
    case "timeLimit":
      return setTimeLimit(room, id, msg.minutes);
    case "leave":
      return leaveRoom(room, id);
    case "addBot":
      return addBot(room, id, msg.level);
    case "botLevel":
      return setBotLevel(room, id, msg.id, msg.level);
    case "removeBot":
      return removeBot(room, id, msg.id);
    case "kick":
      return kickMember(room, id, msg.id);
    case "start":
      return startGame(room, id, newSeed());
    default:
      return false;
  }
}

function endRound(room: RoomState) {
  room.game = null;
  room.phase = "lobby";
  room.inputs = {};
  room.resultsTicksLeft = -1;
  dropDisconnected(room);
  for (const m of room.members) {
    m.inGame = false;
    m.ready = false;
  }
  pickHost(room);
}

/** Advance one tick. Returns true when something visible in `roomView` changed. */
export function stepRoom(room: RoomState): boolean {
  room.tick++;
  let changed = false;

  for (const m of [...room.members]) {
    if (m.connected || m.disconnectedAt === null || room.tick - m.disconnectedAt <= RECONNECT_GRACE_TICKS) continue;
    removeMember(room, m.id);
    changed = true;
  }

  const game = room.game;
  if (!game) return changed;

  for (const m of room.members) if (m.bot && m.inGame) room.inputs[m.id] = botInput(game, m.id, m.bot);
  hurryBotsAlone(game, (id) => !!member(room, id)?.bot);
  step(game, room.inputs);
  for (const input of Object.values(room.inputs)) {
    for (const b of BUTTONS) input[b] = false;
    input.since ??= game.tick;
  }

  if (game.phase === "finished") {
    if (room.resultsTicksLeft < 0) {
      // a team wins together: everyone on it scores, standing or not
      const won = winners(game);
      const scorers = won.flatMap((p) => member(room, p.id) ?? []);
      for (const m of scorers) room.scores[m.id] = (room.scores[m.id] ?? 0) + 1;
      const champions = room.bestOf > 1 ? scorers.filter((m) => room.scores[m.id] >= Math.ceil(room.bestOf / 2)) : [];
      const seriesWon = champions.length > 0;
      // a series goes to whoever got the wins: with sides that change, not always the whole side of its last match
      const named = seriesWon ? champions : scorers;
      room.lastResult = {
        winnerName: named.length > 0 ? listNames(named.map((m) => m.name)) : null,
        winnerColor: named[0]?.color ?? null,
        winnerTeam: named.length === scorers.length ? (won[0]?.team ?? null) : null,
        seriesWon,
      };
      room.resultsTicksLeft = RESULTS_TICKS;
      changed = true;
    } else if (--room.resultsTicksLeft <= 0) {
      endRound(room);
      changed = true;
    }
  }
  return changed;
}

/** "Ana", "Ana e Bia", "Ana, Bia e Caio": the winners' names as the lobby shows them. */
const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : names[0]);

/** For each player whose client numbers its inputs: the input their bomber moves by, and the tick it took over. */
export function inputAcks(room: RoomState): Record<string, InputAck> {
  const acks: Record<string, InputAck> = {};
  for (const [id, { seq, since }] of Object.entries(room.inputs)) if (seq !== undefined && since !== undefined) acks[id] = [seq, since];
  return acks;
}

export function roomView(room: RoomState): RoomView {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    mapId: room.mapId,
    randomMap: room.randomMap,
    capacity: room.capacity,
    revenge: room.revenge,
    teams: room.teams,
    friendlyFire: room.friendlyFire,
    randomTeams: room.randomTeams,
    bestOf: room.bestOf,
    timeLimit: room.timeLimit,
    round: room.round,
    members: room.members.map(({ id, name, color, ready, connected, inGame, bot, team }) => ({
      id,
      name,
      color,
      ready: isReady(room, { id, ready, bot }),
      connected,
      inGame,
      score: room.scores[id] ?? 0,
      bot,
      team,
    })),
    lastResult: room.lastResult,
  };
}
