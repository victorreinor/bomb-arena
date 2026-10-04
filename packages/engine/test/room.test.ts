import { describe, expect, test } from "bun:test";
import {
  GRID_H,
  GRID_W,
  MAPS,
  mapSeats,
  RECONNECT_GRACE_TICKS,
  RESULTS_TICKS,
  TILE,
  addBot,
  canStart,
  createGame,
  createRoom,
  disconnect,
  isValidRoomCode,
  joinRoom,
  normalizeRoomCode,
  randomRoomCode,
  roomView,
  setCapacity,
  setColor,
  setInput,
  setMap,
  setReady,
  startGame,
  stepRoom,
  tooManyForMap,
  START_COUNTDOWN_TICKS,
  type RoomState,
} from "../src";
import { pastCountdown, send } from "./helpers";

function lobby(names: string[]): RoomState {
  const room = createRoom("BCDFG");
  names.forEach((n, i) => joinRoom(room, `u${i + 1}`, n));
  return room;
}

function startedRoom(count = 2): RoomState {
  const room = lobby(["A", "B", "C", "D"].slice(0, count));
  for (const m of room.members) setReady(room, m.id, true);
  expect(startGame(room, "u1", 1)).toBe(true);
  pastCountdown(room);
  return room;
}

describe("maps", () => {
  test.each(MAPS.map((m) => [m.id, m] as const))("%s: every spawn and open tile is reachable", (_, map) => {
    const game = createGame({
      map: { ...map, softDensity: 1 },
      seed: 1,
      players: Array.from({ length: mapSeats(map) }, (_, i) => ({ id: `p${i}`, color: i })),
    });
    const seen = new Set<number>();
    const queue = [game.players[0]];
    seen.add(Math.floor(game.players[0].y) * game.width + Math.floor(game.players[0].x));
    const stack = [...seen];
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % game.width;
      const y = Math.floor(i / game.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * game.width + x + dx;
        if (game.tiles[j] === TILE.HARD || seen.has(j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    expect(queue).toHaveLength(1);
    const open = game.tiles.filter((t) => t !== TILE.HARD).length;
    expect(seen.size).toBe(open);
    for (const p of game.players) {
      expect(seen.has(Math.floor(p.y) * game.width + Math.floor(p.x))).toBe(true);
    }
  });
});

describe("room codes", () => {
  test("generated codes are valid and normalisation is forgiving", () => {
    for (let i = 0; i < 50; i++) expect(isValidRoomCode(randomRoomCode())).toBe(true);
    expect(normalizeRoomCode(" bcd-fg ")).toBe("BCDFG");
    expect(isValidRoomCode("ABCDE")).toBe(false); // vowels are not in the alphabet
  });
});

describe("joining", () => {
  test("first member is host and colours are unique", () => {
    const room = lobby(["Ana", "Bia", "Cris"]);
    expect(room.hostId).toBe("u1");
    expect(new Set(room.members.map((m) => m.color)).size).toBe(3);
  });

  test("room holds at most 4 members", () => {
    const room = lobby(["a", "b", "c", "d"]);
    expect(joinRoom(room, "u5", "e")).toEqual({ ok: false, error: "full" });
  });

  test("names are trimmed and capped; empty names get a default", () => {
    const room = createRoom("BCDFG");
    joinRoom(room, "x", "   ");
    joinRoom(room, "y", "A very long name indeed");
    expect(room.members[0].name).toBe("Jogador");
    expect(room.members[1].name.length).toBeLessThanOrEqual(12);
  });

  test("colour can be changed only to a free one", () => {
    const room = lobby(["a", "b"]);
    const taken = room.members[1].color;
    expect(setColor(room, "u1", taken)).toBe(false);
    expect(setColor(room, "u1", 3)).toBe(true);
    expect(setColor(room, "u1", 9)).toBe(false);
  });

  test("a member who joins mid-match waits for the next one", () => {
    const room = startedRoom(2);
    expect(joinRoom(room, "late", "Late")).toEqual({ ok: true, reconnected: false });
    const late = room.members.find((m) => m.id === "late")!;
    expect(late.inGame).toBe(false);
    expect(room.game!.players.map((p) => p.id)).not.toContain("late");
    expect(setReady(room, "late", true)).toBe(false); // not in lobby
    setInput(room, "late", { dx: 1, dy: 0, bomb: true, action: false });
    expect(room.inputs.late).toBeUndefined();
  });
});

describe("starting", () => {
  test("needs 2+ players, everyone ready, and only the host can start", () => {
    const room = lobby(["a"]);
    expect(canStart(room)).toBe(false);
    joinRoom(room, "u2", "b");
    expect(canStart(room)).toBe(false);
    setReady(room, "u2", true);
    expect(canStart(room)).toBe(true);
    expect(startGame(room, "u2", 1)).toBe(false);
    expect(startGame(room, "u1", 1)).toBe(true);
    expect(room.phase).toBe("playing");
  });

  test("two players start in opposite corners", () => {
    const room = startedRoom(2);
    const [a, b] = room.game!.players;
    expect([a.x, a.y]).toEqual([1.5, 1.5]);
    expect([b.x, b.y]).toEqual([GRID_W - 1.5, GRID_H - 1.5]);
  });

  test("only the host picks the map, and only known maps", () => {
    const room = lobby(["a", "b"]);
    expect(setMap(room, "u2", "maze")).toBe(false);
    expect(setMap(room, "u1", "nope")).toBe(false);
    expect(setMap(room, "u1", "maze")).toBe(true);
    for (const m of room.members) setReady(room, m.id, true);
    startGame(room, "u1", 3);
    expect(room.game!.mapId).toBe("maze");
  });
});

describe("match flow", () => {
  test("inputs are clamped and bomb presses are consumed after one tick", () => {
    const room = startedRoom(2);
    setInput(room, "u1", { dx: 99, dy: -1, bomb: true });
    expect(room.inputs.u1).toEqual({ dx: 0, dy: -1, bomb: true, action: false, pet: false });
    stepRoom(room);
    expect(room.game!.bombs).toHaveLength(1);
    expect(room.inputs.u1.bomb).toBe(false);
    stepRoom(room);
    expect(room.game!.bombs).toHaveLength(1);
  });

  test("after the match ends, results show then everyone (incl. the waiting) return to the lobby", () => {
    const room = startedRoom(2);
    joinRoom(room, "late", "Late");
    room.game!.players[1].alive = false; // u2 dies
    let changedAtResult = false;
    for (let i = 0; i < 5; i++) changedAtResult ||= stepRoom(room);
    expect(changedAtResult).toBe(true);
    expect(room.lastResult?.winnerName).toBe("A");
    expect(room.phase).toBe("playing");
    for (let i = 0; i < RESULTS_TICKS + 2; i++) stepRoom(room);
    expect(room.phase).toBe("lobby");
    expect(room.game).toBeNull();
    expect(room.members.map((m) => m.id)).toEqual(["u1", "u2", "late"]);
    expect(room.members.every((m) => !m.ready && !m.inGame)).toBe(true);
    expect(roomView(room).lastResult?.winnerName).toBe("A");
    for (const m of room.members) setReady(room, m.id, true);
    expect(startGame(room, "u1", 5)).toBe(true);
    expect(room.game!.players).toHaveLength(3);
  });
});

describe("disconnects", () => {
  test("host passes to the next connected member", () => {
    const room = lobby(["a", "b"]);
    disconnect(room, "u1");
    expect(room.hostId).toBe("u2");
  });

  test("reconnecting within the grace period keeps the seat and colour", () => {
    const room = startedRoom(2);
    const color = room.members[1].color;
    disconnect(room, "u2");
    for (let i = 0; i < RECONNECT_GRACE_TICKS - 5; i++) stepRoom(room);
    expect(joinRoom(room, "u2", "B")).toEqual({ ok: true, reconnected: true });
    stepRoom(room);
    expect(room.members.find((m) => m.id === "u2")!.color).toBe(color);
    expect(room.game!.players[1].alive).toBe(true);
  });

  test("a player who stays away during a match is eliminated", () => {
    const room = startedRoom(2);
    disconnect(room, "u2");
    for (let i = 0; i < RECONNECT_GRACE_TICKS + 5; i++) stepRoom(room);
    expect(room.game!.players[1].alive).toBe(false);
    expect(room.members.map((m) => m.id)).toEqual(["u1"]);
    expect(room.game!.phase).toBe("finished");
    expect(room.game!.winner).toBe("u1");
  });

  test("lobby members who vanish are dropped after the grace period", () => {
    const room = lobby(["a", "b"]);
    disconnect(room, "u2");
    for (let i = 0; i < RECONNECT_GRACE_TICKS + 2; i++) stepRoom(room);
    expect(room.members.map((m) => m.id)).toEqual(["u1"]);
  });
});

describe("capacity", () => {
  test("a 2-player room is full after the second member", () => {
    const room = createRoom("BCDFG", 2);
    joinRoom(room, "a", "A");
    expect(joinRoom(room, "b", "B")).toEqual({ ok: true, reconnected: false });
    expect(joinRoom(room, "c", "C")).toEqual({ ok: false, error: "full" });
    expect(roomView(room).capacity).toBe(2);
  });

  test("capacity is clamped to 2-4 and defaults to 4", () => {
    expect(createRoom("BCDFG").capacity).toBe(4);
    expect(createRoom("BCDFG", 9).capacity).toBe(4);
    expect(createRoom("BCDFG", 1).capacity).toBe(2);
    expect(createRoom("BCDFG", NaN).capacity).toBe(4);
  });

  test("only the host can change it, never below the current headcount, only in the lobby", () => {
    const room = lobby(["a", "b", "c"]);
    expect(setCapacity(room, "u2", 4)).toBe(false);
    expect(setCapacity(room, "u1", 2)).toBe(false); // 3 are already in
    expect(setCapacity(room, "u1", 5)).toBe(false);
    expect(setCapacity(room, "u1", 3)).toBe(true);
    expect(joinRoom(room, "u4", "d")).toEqual({ ok: false, error: "full" });
    expect(setCapacity(room, "u1", 4)).toBe(true);
    expect(joinRoom(room, "u4", "d").ok).toBe(true);
    for (const m of room.members) setReady(room, m.id, true);
    startGame(room, "u1", 1);
    expect(setCapacity(room, "u1", 4)).toBe(false);
  });
});

describe("sending someone out", () => {
  test("only the host, only between matches, only people (bots go with removeBot), never themselves", () => {
    const room = lobby(["A", "B", "C"]);
    addBot(room, "u1");
    const bot = room.members.find((m) => m.bot)!;
    expect(send(room, "u2", { t: "kick", id: "u3" })).toBe(false);
    expect(send(room, "u1", { t: "kick", id: "u1" })).toBe(false);
    expect(send(room, "u1", { t: "kick", id: bot.id })).toBe(false);
    expect(send(room, "u1", { t: "kick", id: "u3" })).toBe(true);
    expect(room.members.map((m) => m.id)).toEqual(["u1", "u2", bot.id]);

    for (const m of room.members) setReady(room, m.id, true);
    startGame(room, "u1", 1);
    expect(send(room, "u1", { t: "kick", id: "u2" })).toBe(false);
  });
});

describe("one-on-one maps", () => {
  test("can be picked with more in the room, but a match there only starts with two", () => {
    const room = lobby(["A", "B", "C"]);
    for (const m of room.members) setReady(room, m.id, true);
    expect(setMap(room, "u1", "duel")).toBe(true);
    expect(tooManyForMap(roomView(room))).toBe(true);
    expect(canStart(roomView(room))).toBe(false);
    expect(startGame(room, "u1", 1)).toBe(false);
    send(room, "u3", { t: "leave" });
    expect(startGame(room, "u1", 1)).toBe(true);
    expect([room.game!.width, room.game!.height]).toEqual([11, 9]);
  });
});

describe("match start", () => {
  test("a match in a room opens with the Ready… Go! countdown", () => {
    const room = lobby(["A", "B"]);
    setReady(room, "u2", true);
    startGame(room, "u1", 1);
    expect(room.game!.goTick).toBe(START_COUNTDOWN_TICKS);
  });

  test("pings are the server's to answer: the room ignores them", () => {
    const room = lobby(["A", "B"]);
    expect(send(room, "u1", { t: "ping", at: 5 })).toBe(false);
  });
});
