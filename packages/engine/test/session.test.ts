import { describe, expect, test } from "bun:test";
import {
  RECONNECT_GRACE_TICKS,
  RESULTS_TICKS,
  TICK_RATE,
  TokenBucket,
  createRoom,
  disconnect,
  fromSnapshot,
  joinRoom,
  killPlayer,
  roomView,
  stepRoom,
  toSnapshot,
  type RoomState,
} from "../src";
import { pastCountdown, send } from "./helpers";

function lobby(n = 2): RoomState {
  const room = createRoom("BCDFG", 4);
  for (let i = 1; i <= n; i++) joinRoom(room, `u${i}`, `P${i}`);
  return room;
}

function start(room: RoomState) {
  for (const m of room.members) if (m.id !== room.hostId) send(room, m.id, { t: "ready", ready: true });
  expect(send(room, room.hostId!, { t: "start" })).toBe(true);
  pastCountdown(room);
}

/** Ends the running match with `winner` alive and everyone else dead, then waits out the podium. */
function win(room: RoomState, winner: string) {
  for (const p of room.game!.players) if (p.id !== winner) p.alive = false;
  for (let i = 0; i < RESULTS_TICKS + 3; i++) stepRoom(room);
  expect(room.phase).toBe("lobby");
}

describe("leaving", () => {
  test("in the lobby the member is gone at once and the host passes on", () => {
    const room = lobby(3);
    expect(send(room, "u1", { t: "leave" })).toBe(true);
    expect(room.members.map((m) => m.id)).toEqual(["u2", "u3"]);
    expect(room.hostId).toBe("u2");
  });

  test("mid-match their bomber is out straight away, without becoming a ghost", () => {
    const room = lobby(3);
    send(room, "u1", { t: "revenge", on: true });
    start(room);
    send(room, "u3", { t: "leave" });
    const p3 = room.game!.players.find((p) => p.id === "u3")!;
    expect(p3.alive).toBe(false);
    expect(p3.death).toEqual({ how: "left", by: null });
    expect(p3.ghost).toBeNull();
    expect(room.members.some((m) => m.id === "u3")).toBe(false);
  });

  test("leaving twice is harmless", () => {
    const room = lobby(2);
    send(room, "u2", { t: "leave" });
    expect(send(room, "u2", { t: "leave" })).toBe(false);
  });
});

describe("score and best-of-N", () => {
  test("wins add up for the session; draws give nobody a point", () => {
    const room = lobby(2);
    start(room);
    win(room, "u2");
    start(room);
    win(room, "u2");
    start(room);
    for (const p of room.game!.players) p.alive = false; // draw
    for (let i = 0; i < RESULTS_TICKS + 3; i++) stepRoom(room);
    const view = roomView(room);
    expect(view.members.find((m) => m.id === "u2")!.score).toBe(2);
    expect(view.members.find((m) => m.id === "u1")!.score).toBe(0);
    expect(view.lastResult!.seriesWon).toBe(false); // single matches: no series
  });

  test("best of 3: two wins take the series, then the score starts over", () => {
    const room = lobby(2);
    expect(send(room, "u2", { t: "bestOf", n: 3 })).toBe(false); // host only
    expect(send(room, "u1", { t: "bestOf", n: 4 })).toBe(false); // not an option
    expect(send(room, "u1", { t: "bestOf", n: 3 })).toBe(true);
    start(room);
    win(room, "u1");
    expect(roomView(room).lastResult!.seriesWon).toBe(false);
    start(room);
    win(room, "u1");
    expect(roomView(room).lastResult).toMatchObject({ winnerName: "P1", seriesWon: true });
    expect(roomView(room).members.find((m) => m.id === "u1")!.score).toBe(2);
    start(room);
    expect(roomView(room).members.every((m) => m.score === 0)).toBe(true);
  });

  test("changing the series length resets the score", () => {
    const room = lobby(2);
    start(room);
    win(room, "u1");
    send(room, "u1", { t: "bestOf", n: 5 });
    expect(roomView(room).members.every((m) => m.score === 0)).toBe(true);
  });
});

describe("time limit", () => {
  test("defaults to 3 minutes before sudden death; the host can change or remove it", () => {
    const room = lobby(2);
    expect(roomView(room).timeLimit).toBe(3);
    start(room);
    expect(room.game!.timeLeft).toBe(3 * 60 * TICK_RATE);
    win(room, "u1");
    expect(send(room, "u1", { t: "timeLimit", minutes: 7 })).toBe(false);
    expect(send(room, "u1", { t: "timeLimit", minutes: 0 })).toBe(true);
    start(room);
    expect(room.game!.timeLeft).toBeNull();
  });
});

describe("snapshots", () => {
  test("never carry the RNG, and carry tiles only when asked", () => {
    const room = lobby(2);
    start(room);
    const game = room.game!;
    const lean = toSnapshot(game, false);
    expect("rng" in lean).toBe(false);
    expect("nextBombId" in lean).toBe(false);
    expect(lean.tiles).toBeUndefined();
    expect(toSnapshot(game, true).tiles).toEqual(game.tiles);
    const rebuilt = fromSnapshot(lean, game.tiles);
    expect(rebuilt.tiles).toBe(game.tiles);
    expect(rebuilt.players).toEqual(game.players);
    expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(game).length - 300);
  });
});

describe("token bucket", () => {
  test("allows bursts, then the steady rate", () => {
    const bucket = new TokenBucket(10, 5, 0);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (bucket.take(0)) ok++;
    expect(ok).toBe(5);
    expect(bucket.take(50)).toBe(false); // half a token
    expect(bucket.take(100)).toBe(true); // 10/s -> one token every 100 ms
    expect(bucket.take(10_000)).toBe(true);
  });
});

describe("timing out after dying", () => {
  test("keeps the original time of death, so the ranking doesn't change", () => {
    const room = lobby(3);
    start(room);
    const game = room.game!;
    const p2 = game.players.find((p) => p.id === "u2")!;
    for (let i = 0; i < 5; i++) stepRoom(room);
    killPlayer(game, p2, "blast");
    const diedAt = p2.diedAt;
    disconnect(room, "u2"); // closes the tab after dying
    for (let i = 0; i < RECONNECT_GRACE_TICKS + 5; i++) stepRoom(room);
    expect(room.members.some((m) => m.id === "u2")).toBe(false);
    expect(p2.diedAt).toBe(diedAt);
  });
});
