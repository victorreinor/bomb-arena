import type { BotLevel } from "./bot";
import { TICK_RATE } from "./constants";
import type { Bomb, Flame, GameState, Player, Tile } from "./types";

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
  /** the host sends someone (not a bot: see removeBot) out of the room */
  | { t: "kick"; id: string }
  /** answered at once with a pong carrying the same `at`, to measure the round trip */
  | { t: "ping"; at: number }
  | { t: "start" }
  /** `seq` numbers the input so the client can tell which of its inputs a snapshot already includes */
  | { t: "input"; dx: number; dy: number; bomb: boolean; action: boolean; pet: boolean; seq?: number };

/** [seq, tick]: an input the server is applying, and the tick it was first applied on */
export type InputAck = [seq: number, tick: number];

export type ErrorCode = "not_found" | "exists" | "full" | "bad_request" | "replaced" | "removed";

export type ServerMsg =
  | { t: "welcome"; id: string }
  | { t: "room"; room: RoomView }
  /** `acks`: per player, the input (by `seq`) their bomber moves by and the tick it took over; only those that changed */
  | { t: "state"; round: number; resultsIn: number; game: GameSnapshot; acks?: Record<string, InputAck> }
  | { t: "pong"; at: number }
  | { t: "error"; code: ErrorCode; message: string };

/**
 * The protocol a client speaks, sent as `v` when it connects. 2: it understands snapshots whose players
 * and bombs only carry what changed (`changes`). A client that doesn't say gets them in full.
 */
export const PROTOCOL_VERSION = 2;

/** Players and bombs as last sent to the clients that take changes: what the next changes are measured against. */
export interface SentLists {
  players: Player[];
  bombs: Bomb[];
}

/**
 * What changed since the previous snapshot. Players: one entry each, in order, with the fields that
 * changed (null if none did). Bombs: every bomb still there, in order, by id, with the fields that
 * changed (a new one in full); those left out are gone.
 */
export interface SnapshotChanges {
  players: (Partial<Player> | null)[];
  bombs: (Partial<Bomb> & Pick<Bomb, "id">)[];
}

/**
 * What goes over the wire every tick: the game minus what clients never use (the RNG, so nobody can
 * predict drops, the bomb id counter, whose blast each flame is), with `tiles` only when they changed
 * and, for clients that speak protocol 2, `changes` standing in for `players` and `bombs` between full ones.
 */
export type GameSnapshot = Omit<GameState, "tiles" | "rng" | "nextBombId" | "flames" | "players" | "bombs"> & {
  tiles?: Tile[];
  flames: Omit<Flame, "owner">[];
  players?: Player[];
  bombs?: Bomb[];
  changes?: SnapshotChanges;
};

/**
 * The snapshot of `game`. With `sent` (players and bombs as last sent, to a client that keeps up with
 * every snapshot) only what changed in them goes; without, or once the players no longer line up, all of them.
 */
export function toSnapshot(game: GameState, withTiles: boolean, sent: SentLists | null = null): GameSnapshot {
  const { rng: _rng, nextBombId: _next, tiles, flames, players, bombs, ...rest } = game;
  const lean: GameSnapshot = { ...rest, flames: flames.map(({ owner: _owner, ...f }) => f) };
  const sameLineUp = sent?.players.length === players.length && sent.players.every((p, i) => p.id === players[i].id);
  if (sent && sameLineUp) {
    const known = new Map(sent.bombs.map((b) => [b.id, b]));
    lean.changes = {
      players: players.map((p, i) => changedFields(sent.players[i], p)),
      bombs: bombs.map((b) => {
        const was = known.get(b.id);
        return was ? { ...changedFields(was, b), id: b.id } : b;
      }),
    };
  } else {
    Object.assign(lean, { players, bombs });
  }
  return withTiles ? { ...lean, tiles } : lean;
}

const sameValue = (a: unknown, b: unknown) =>
  a === b || (typeof a === "object" && typeof b === "object" && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** The fields of `after` that differ from `before`; null when none do. */
function changedFields<T extends object>(before: T, after: T): Partial<T> | null {
  const changed: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (!sameValue(after[key], before[key])) changed[key] = after[key];
  }
  return Object.keys(changed).length > 0 ? changed : null;
}

/**
 * Rebuilds a full state from a snapshot, the last tiles received and the players and bombs as of the
 * previous snapshot (which its `changes` apply to). Flames come without their owner (only the server
 * credits knockouts), and a server from before the countdown sends no `goTick`. Null when the snapshot
 * only has changes and there is nothing to apply them to.
 */
export function fromSnapshot(snap: GameSnapshot, lastTiles: Tile[], last: SentLists | null = null): GameState | null {
  const { changes, ...rest } = snap;
  let { players, bombs } = snap;
  if (changes) {
    if (!last || last.players.length !== changes.players.length) return null;
    const known = new Map(last.bombs.map((b) => [b.id, b]));
    players = last.players.map((p, i) => (changes.players[i] ? { ...p, ...changes.players[i] } : p));
    bombs = changes.bombs.map((b) => ({ ...known.get(b.id), ...b }) as Bomb);
  }
  if (!players || !bombs) return null;
  return {
    ...rest,
    players,
    bombs,
    tiles: snap.tiles ?? lastTiles,
    flames: snap.flames.map((f) => ({ ...f, owner: "" })),
    goTick: snap.goTick ?? 0,
    rng: 0,
    nextBombId: 0,
  };
}
