import { DEFAULT_BOT_LEVEL, botId, botInput, botName, isBotLevel, type BotLevel } from "./bot";
import { TICK_RATE } from "./constants";
import { createGame, killPlayer, step } from "./game";
import { getMap, isMapId } from "./maps";
import {
  BEST_OF_OPTIONS,
  DEFAULT_TIME_LIMIT,
  MAX_MEMBERS,
  MAX_NAME_LENGTH,
  MIN_MEMBERS,
  PLAYER_COLORS,
  TIME_LIMIT_OPTIONS,
  minutesToTicks,
  type ClientMsg,
  type ErrorCode,
  type MemberView,
  type RoomResult,
  type RoomView,
} from "./protocol";
import { BUTTONS, emptyInput, type GameState, type Input } from "./types";

export const RECONNECT_GRACE_TICKS = 10 * TICK_RATE;
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
}

/** Bots and the host never have to press "ready". */
export const isReady = (room: { hostId: string | null }, m: Pick<Member, "id" | "ready" | "bot">) =>
  m.bot !== null || m.id === room.hostId || m.ready;
const canHost = (m: Member) => m.connected && !m.bot;

export interface RoomState {
  code: string;
  phase: "lobby" | "playing";
  hostId: string | null;
  mapId: string;
  capacity: number;
  revenge: boolean;
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
  inputs: Record<string, Input>;
  /** -1 until the current match is over, then counts down to the return to the lobby */
  resultsTicksLeft: number;
  lastResult: RoomResult | null;
}

export const clampCapacity = (n: unknown): number =>
  Number.isInteger(n) ? Math.max(MIN_MEMBERS, Math.min(MAX_MEMBERS, n as number)) : MAX_MEMBERS;

export function createRoom(code: string, capacity: number = MAX_MEMBERS): RoomState {
  return {
    code,
    phase: "lobby",
    hostId: null,
    mapId: "classic",
    capacity: clampCapacity(capacity),
    revenge: false,
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
  });
}

/** Every way out of the room (leaving, timing out, being dropped at a round boundary, a bot removed) goes through here. */
function removeMember(room: RoomState, id: string) {
  const player = room.game?.players.find((p) => p.id === id);
  if (player?.alive) killPlayer(room.game!, player); // the dead keep their place in the ranking
  room.members = room.members.filter((m) => m.id !== id);
  delete room.inputs[id];
  delete room.scores[id];
  pickHost(room);
  dropOrphanBots(room);
}

/** Lobby settings are the host's to change, and only between matches. */
const hostInLobby = (room: RoomState, id: string) => room.phase === "lobby" && room.hostId === id;
const isOption = (options: readonly number[], value: number) => options.includes(value);

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
  if (!m || !Number.isInteger(color) || color < 0 || color >= PLAYER_COLORS) return false;
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
  if (!hostInLobby(room, id) || !isMapId(mapId) || room.mapId === mapId) return false;
  room.mapId = mapId;
  return true;
}

/** How many players the room takes; never below who is already in. */
export function setCapacity(room: RoomState, id: string, capacity: number): boolean {
  if (!hostInLobby(room, id) || capacity !== clampCapacity(capacity) || capacity < room.members.length) return false;
  if (room.capacity === capacity) return false;
  room.capacity = capacity;
  return true;
}

export function setRevenge(room: RoomState, id: string, on: boolean): boolean {
  if (!hostInLobby(room, id) || room.revenge === on) return false;
  room.revenge = on;
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

/** Leaving on purpose: gone at once (no reconnect grace); in a match their bomber is out. */
export function leaveRoom(room: RoomState, id: string): boolean {
  if (!member(room, id)) return false;
  removeMember(room, id);
  return true;
}

/** The host may start once at least two connected players are in and all of them are ready. */
export function canStart(room: {
  phase: RoomView["phase"];
  hostId: string | null;
  members: Pick<MemberView, "id" | "connected" | "ready" | "bot">[];
}): boolean {
  if (room.phase !== "lobby") return false;
  const connected = room.members.filter((m) => m.connected);
  return connected.length >= MIN_MEMBERS && connected.every((m) => isReady(room, m));
}

/** Members still away when a round starts or ends lose their seat. */
function dropDisconnected(room: RoomState) {
  for (const m of room.members.filter((o) => !o.connected)) removeMember(room, m.id);
}

export function startGame(room: RoomState, id: string, seed: number): boolean {
  if (room.hostId !== id || !canStart(room)) return false;
  dropDisconnected(room);
  if (room.lastResult?.seriesWon) room.scores = {}; // a new series begins
  const players = room.members.map((m) => ({ id: m.id, color: m.color }));
  const timeLimitTicks = room.timeLimit > 0 ? minutesToTicks(room.timeLimit) : null;
  room.game = createGame({ map: getMap(room.mapId), players, seed, revenge: room.revenge, timeLimitTicks });
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
export function setInput(room: RoomState, id: string, raw: Partial<Record<keyof Input, unknown>>) {
  const m = member(room, id);
  if (!m || !m.inGame || room.phase !== "playing") return;
  const clamp = (n: unknown) => (n === -1 || n === 1 ? n : 0);
  const prev = room.inputs[id];
  const input: Input = { ...emptyInput(), dx: clamp(raw.dx), dy: clamp(raw.dy) };
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
  step(game, room.inputs);
  for (const input of Object.values(room.inputs)) for (const b of BUTTONS) input[b] = false;

  if (game.phase === "finished") {
    if (room.resultsTicksLeft < 0) {
      const winner = game.winner ? member(room, game.winner) : undefined;
      if (winner) room.scores[winner.id] = (room.scores[winner.id] ?? 0) + 1;
      const seriesWon = !!winner && room.bestOf > 1 && room.scores[winner.id] >= Math.ceil(room.bestOf / 2);
      room.lastResult = { winnerName: winner?.name ?? null, winnerColor: winner?.color ?? null, seriesWon };
      room.resultsTicksLeft = RESULTS_TICKS;
      changed = true;
    } else if (--room.resultsTicksLeft <= 0) {
      endRound(room);
      changed = true;
    }
  }
  return changed;
}

export function roomView(room: RoomState): RoomView {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    mapId: room.mapId,
    capacity: room.capacity,
    revenge: room.revenge,
    bestOf: room.bestOf,
    timeLimit: room.timeLimit,
    round: room.round,
    members: room.members.map(({ id, name, color, ready, connected, inGame, bot }) => ({
      id,
      name,
      color,
      ready: isReady(room, { id, ready, bot }),
      connected,
      inGame,
      score: room.scores[id] ?? 0,
      bot,
    })),
    lastResult: room.lastResult,
  };
}
