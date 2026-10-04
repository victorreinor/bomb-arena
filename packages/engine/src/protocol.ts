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

/** The board: what stands on each cell and what its floor does. Sent only when it changes. */
export type Board = Pick<GameState, "tiles" | "floor">;

/**
 * What goes over the wire every tick: the game minus what clients never use (the RNG, so nobody can
 * predict drops, the bomb id counter, whose blast each flame is), with the board (`tiles` and `floor`)
 * only when it changed and, for clients that speak protocol 2, `changes` standing in for `players` and
 * `bombs` between full ones.
 */
export type GameSnapshot = Omit<GameState, "tiles" | "floor" | "rng" | "nextBombId" | "flames" | "players" | "bombs"> & {
  tiles?: Tile[];
  floor?: number[] | null;
  flames: Omit<Flame, "owner">[];
  players?: Player[];
  bombs?: Bomb[];
  changes?: SnapshotChanges;
};

/**
 * The snapshot of `game`. With `sent` (players and bombs as last sent, to a client that keeps up with
 * every snapshot) only what changed in them goes; without, or once the players no longer line up, all of them.
 */
export function toSnapshot(game: GameState, withBoard: boolean, sent: SentLists | null = null): GameSnapshot {
  const { rng: _rng, nextBombId: _next, tiles, floor, flames, players, bombs, ...rest } = game;
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
  return withBoard ? { ...lean, tiles, floor } : lean;
}

const sameValue = (a: unknown, b: unknown) => a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

/** The fields of `after` that differ from `before`; null when none do. */
function changedFields<T extends object>(before: T, after: T): Partial<T> | null {
  const changed: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (!sameValue(after[key], before[key])) changed[key] = after[key];
  }
  return Object.keys(changed).length > 0 ? changed : null;
}

/**
 * Rebuilds a full state from a snapshot, the last board received and the players and bombs as of the
 * previous snapshot (which its `changes` apply to). Flames come without their owner (only the server
 * credits knockouts); a server from before the countdown sends no `goTick`, one from before special
 * floors no `floor`. Null when the snapshot only has changes and there is nothing to apply them to.
 */
export function fromSnapshot(snap: GameSnapshot, lastBoard: Board, last: SentLists | null = null): GameState | null {
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
    tiles: snap.tiles ?? lastBoard.tiles,
    floor: snap.tiles ? (snap.floor ?? null) : lastBoard.floor,
    flames: snap.flames.map((f) => ({ ...f, owner: "" })),
    goTick: snap.goTick ?? 0,
    rng: 0,
    nextBombId: 0,
  };
}

/**
 * Clients that take changes still get every player and bomb in full this often (in ticks), so one that
 * somehow fell out of step is back in a second.
 */
export const FULL_LISTS_TICKS = TICK_RATE;

/** A copy of a player or a bomb that later changes to it can't reach: their nested fields are only one level deep. */
const copyEntry = <T extends object>(entry: T): T =>
  Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...v } : v])) as T;

/**
 * What a room has broadcast so far, so each state message carries only what changed: the board when it
 * changes (and in full each round and for a newcomer), players and bombs as changes for clients on
 * protocol 2 (in full every FULL_LISTS_TICKS), and the input acknowledgements that changed. Every client
 * gets every message in order, so they all share this one record.
 */
export class SnapshotStream {
  private round = -1;
  private tiles: Tile[] | null = null;
  private lists: SentLists | null = null;
  private acks = new Map<string, string>();

  /** Someone new is listening: the next message carries everything in full. */
  restart() {
    this.tiles = null;
    this.lists = null;
  }

  /**
   * The next message about `game` (to be built before it steps again): the acknowledgements that changed
   * and, for each protocol a client speaks, its snapshot.
   */
  next(round: number, game: GameState, acks: Record<string, InputAck>) {
    if (round !== this.round) {
      this.round = round;
      this.restart();
      this.acks.clear();
    }
    const withBoard = !this.tiles || game.tiles.some((t, i) => t !== this.tiles![i]);
    if (withBoard) this.tiles = [...game.tiles];
    const changed = Object.entries(acks).filter(([id, ack]) => this.acks.get(id) !== ack.join(":"));
    for (const [id, ack] of changed) this.acks.set(id, ack.join(":"));
    const sent = game.tick % FULL_LISTS_TICKS === 0 ? null : this.lists;
    this.lists = { players: game.players.map(copyEntry), bombs: game.bombs.map(copyEntry) };
    return {
      acks: changed.length > 0 ? Object.fromEntries(changed) : undefined,
      snapshot: (version: number) => toSnapshot(game, withBoard, version >= 2 ? sent : null),
    };
  }
}
