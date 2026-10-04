import type { GameState } from "./types";

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 4;
export const PLAYER_COLORS = 4;
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 12;

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
  ready: boolean;
  connected: boolean;
  /** false while waiting for the next match (joined after it started) */
  inGame: boolean;
}

export interface RoomResult {
  winnerName: string | null;
  winnerColor: number | null;
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
}

export type ClientMsg =
  | { t: "color"; color: number }
  | { t: "ready"; ready: boolean }
  | { t: "map"; mapId: string }
  | { t: "capacity"; capacity: number }
  | { t: "start" }
  | { t: "input"; dx: number; dy: number; bomb: boolean; action: boolean };

export type ErrorCode = "not_found" | "exists" | "full" | "bad_request" | "replaced";

export type ServerMsg =
  | { t: "welcome"; id: string }
  | { t: "room"; room: RoomView }
  | { t: "state"; round: number; resultsIn: number; game: GameState }
  | { t: "error"; code: ErrorCode; message: string };
