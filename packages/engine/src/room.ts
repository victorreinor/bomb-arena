import { TICK_RATE } from "./constants";
import { createGame, killPlayer, step } from "./game";
import { getMap, isMapId } from "./maps";
import {
  MAX_MEMBERS,
  MAX_NAME_LENGTH,
  MIN_MEMBERS,
  PLAYER_COLORS,
  type ClientMsg,
  type ErrorCode,
  type RoomResult,
  type RoomView,
} from "./protocol";
import type { GameState, Input } from "./types";

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
}

export interface RoomState {
  code: string;
  phase: "lobby" | "playing";
  hostId: string | null;
  mapId: string;
  capacity: number;
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
  if (host?.connected) return;
  room.hostId = room.members.find((m) => m.connected)?.id ?? null;
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

  const taken = new Set(room.members.map((m) => m.color));
  const color = Array.from({ length: PLAYER_COLORS }, (_, i) => i).find((c) => !taken.has(c)) ?? 0;
  room.members.push({
    id,
    name,
    color,
    ready: false,
    connected: true,
    // joining a match in progress means waiting for the next one
    inGame: false,
    disconnectedAt: null,
  });
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

export function setMap(room: RoomState, id: string, mapId: string): boolean {
  if (room.phase !== "lobby" || room.hostId !== id || !isMapId(mapId)) return false;
  room.mapId = mapId;
  return true;
}

/** Host changes how many players the room takes; it can never go below who is already in. */
export function setCapacity(room: RoomState, id: string, capacity: number): boolean {
  if (room.phase !== "lobby" || room.hostId !== id || !Number.isInteger(capacity)) return false;
  const next = clampCapacity(capacity);
  if (next !== capacity || next < room.members.length) return false;
  room.capacity = next;
  return true;
}

/** The host may start once at least two connected players are in and everyone but the host is ready. */
export function canStart(room: Pick<RoomView, "phase" | "hostId" | "members">): boolean {
  if (room.phase !== "lobby") return false;
  const connected = room.members.filter((m) => m.connected);
  return connected.length >= MIN_MEMBERS && connected.every((m) => m.id === room.hostId || m.ready);
}

export function startGame(room: RoomState, id: string, seed: number): boolean {
  if (room.hostId !== id || !canStart(room)) return false;
  room.members = room.members.filter((m) => m.connected);
  const players = room.members.map((m) => ({ id: m.id, color: m.color }));
  room.game = createGame({ map: getMap(room.mapId), players, seed });
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

export function setInput(room: RoomState, id: string, raw: { dx: number; dy: number; bomb: boolean; action?: boolean }) {
  const m = member(room, id);
  if (!m || !m.inGame || room.phase !== "playing") return;
  const clamp = (n: unknown) => (n === -1 || n === 1 ? n : 0);
  const prev = room.inputs[id];
  // bomb/action are one-shot presses: keep them queued until the next tick consumes them
  room.inputs[id] = {
    dx: clamp(raw.dx),
    dy: clamp(raw.dy),
    bomb: !!(prev?.bomb || raw.bomb === true),
    action: !!(prev?.action || raw.action === true),
  };
}

/**
 * Applies one message from a client to the room. Returns true when something shown in the
 * lobby changed (so the room should be re-broadcast); inputs never count.
 * Lives here, not in the server, so that every message type is covered by tests.
 */
export function handleClientMessage(room: RoomState, id: string, msg: ClientMsg, newSeed: () => number): boolean {
  switch (msg?.t) {
    case "input":
      setInput(room, id, { dx: msg.dx, dy: msg.dy, bomb: msg.bomb === true, action: msg.action === true });
      return false;
    case "color":
      return setColor(room, id, msg.color);
    case "ready":
      return setReady(room, id, msg.ready === true);
    case "map":
      return setMap(room, id, msg.mapId);
    case "capacity":
      return setCapacity(room, id, msg.capacity);
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
  room.members = room.members.filter((m) => m.connected);
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
    const player = room.game?.players.find((p) => p.id === m.id);
    if (player) killPlayer(room.game!, player);
    room.members = room.members.filter((o) => o !== m);
    changed = true;
  }
  pickHost(room);

  const game = room.game;
  if (!game) return changed;

  step(game, room.inputs);
  for (const input of Object.values(room.inputs)) {
    input.bomb = false;
    input.action = false;
  }

  if (game.phase === "finished") {
    if (room.resultsTicksLeft < 0) {
      const winner = game.winner ? member(room, game.winner) : undefined;
      room.lastResult = { winnerName: winner?.name ?? null, winnerColor: winner?.color ?? null };
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
    round: room.round,
    members: room.members.map(({ id, name, color, ready, connected, inGame }) => ({
      id,
      name,
      color,
      ready,
      connected,
      inGame,
    })),
    lastResult: room.lastResult,
  };
}
