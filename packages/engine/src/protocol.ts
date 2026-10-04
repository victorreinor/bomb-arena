import type { BotLevel } from "./bot";
import { TICK_RATE } from "./constants";
import type { GameState, Tile } from "./types";

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 4;
export const PLAYER_COLORS = 4;
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 12;
/** "best of N" series the host can pick (1 = single matches, just a running score) */
export const BEST_OF_OPTIONS = [1, 3, 5] as const;
/** match length in minutes before sudden death; 0 = no limit */
export const TIME_LIMIT_OPTIONS = [2, 3, 5, 0] as const;
export const DEFAULT_TIME_LIMIT = 3;
export const minutesToTicks = (minutes: number) => minutes * 60 * TICK_RATE;

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

export function randomRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export interface MemberView {
  id: string;
  name: string;
  color: number;
  /** effective readiness: bots and the host always count as ready */
  ready: boolean;
  connected: boolean;
  /** false while waiting for the next match (joined after it started) */
  inGame: boolean;
  /** matches won in the current series / session */
  score: number;
  /** a computer player's level (added by the host); null for people */
  bot: BotLevel | null;
}

export interface RoomResult {
  winnerName: string | null;
  winnerColor: number | null;
  /** this win also took the best-of-N series (the score starts over next match) */
  seriesWon: boolean;
}

export interface RoomView {
  code: string;
  phase: "lobby" | "playing";
  hostId: string | null;
  mapId: string;
  /** how many players the room accepts (2-4), set by the host */
  capacity: number;
  /** increments every match; lets clients reset their snapshot buffers */
  round: number;
  members: MemberView[];
  /** result of the match that just ended (shown in the lobby) */
  lastResult: RoomResult | null;
  /** revenge mode: the dead keep throwing bombs from the outer wall */
  revenge: boolean;
  bestOf: number;
  /** minutes before sudden death; 0 = no limit */
  timeLimit: number;
}

export type ClientMsg =
  | { t: "color"; color: number }
  | { t: "ready"; ready: boolean }
  | { t: "map"; mapId: string }
  | { t: "capacity"; capacity: number }
  | { t: "revenge"; on: boolean }
  | { t: "bestOf"; n: number }
  | { t: "timeLimit"; minutes: number }
  | { t: "leave" }
  | { t: "addBot"; level?: BotLevel }
  | { t: "botLevel"; id: string; level: BotLevel }
  | { t: "removeBot"; id: string }
  | { t: "start" }
  | { t: "input"; dx: number; dy: number; bomb: boolean; action: boolean; pet: boolean };

export type ErrorCode = "not_found" | "exists" | "full" | "bad_request" | "replaced";

export type ServerMsg =
  | { t: "welcome"; id: string }
  | { t: "room"; room: RoomView }
  | { t: "state"; round: number; resultsIn: number; game: GameSnapshot }
  | { t: "error"; code: ErrorCode; message: string };

/**
 * What goes over the wire every tick: the game minus what clients never use (the RNG, so nobody can
 * predict drops, and the bomb id counter) and with `tiles` only when they changed.
 */
export type GameSnapshot = Omit<GameState, "tiles" | "rng" | "nextBombId"> & { tiles?: Tile[] };

export function toSnapshot(game: GameState, withTiles: boolean): GameSnapshot {
  const { rng: _rng, nextBombId: _next, tiles, ...rest } = game;
  return withTiles ? { ...rest, tiles } : rest;
}

/** Rebuilds a full state from a snapshot and the last tiles received. */
export function fromSnapshot(snap: GameSnapshot, lastTiles: Tile[]): GameState {
  return { ...snap, tiles: snap.tiles ?? lastTiles, rng: 0, nextBombId: 0 };
}
