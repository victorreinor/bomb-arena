import { describe, expect, test } from "bun:test";
import {
  createRoom,
  handleClientMessage,
  joinRoom,
  stepRoom,
  TILE,
  type Bomb,
  type ClientMsg,
  type RoomState,
} from "../src";

/** A started 2-player match on a plain corridor, driven only through client messages. */
function match(): RoomState {
  const room = createRoom("BCDFG", 2);
  joinRoom(room, "u1", "A");
  joinRoom(room, "u2", "B");
  handleClientMessage(room, "u2", { t: "ready", ready: true }, () => 1);
  expect(handleClientMessage(room, "u1", { t: "start" }, () => 1)).toBe(true);
  // open the arena up: remove soft blocks so nothing gets in the way
  const g = room.game!;
  g.tiles = g.tiles.map((t) => (t === TILE.SOFT ? TILE.EMPTY : t));
  return room;
}

const send = (room: RoomState, msg: ClientMsg, id = "u1") => handleClientMessage(room, id, msg, () => 1);
const tick = (room: RoomState, n = 1) => {
  for (let i = 0; i < n; i++) stepRoom(room);
};
const idle = { t: "input", dx: 0, dy: 0, bomb: false, action: false } as const;

describe("client messages reach the game", () => {
  test("the action button is delivered (remote detonation online)", () => {
    const room = match();
    const p = room.game!.players[0];
    p.remote = true;
    send(room, { ...idle, bomb: true });
    tick(room);
    expect(room.game!.bombs).toHaveLength(1);
    send(room, { ...idle, dx: 1 });
    tick(room, 30); // walk clear of the blast
    expect(room.game!.bombs).toHaveLength(1);
    send(room, { ...idle, action: true });
    tick(room);
    expect(room.game!.bombs).toHaveLength(0);
    expect(room.game!.flames.length).toBeGreaterThan(0);
  });

  test("a single action press fires once, not on every following tick", () => {
    const room = match();
    const p = room.game!.players[0];
    p.remote = true;
    p.bombsMax = 2;
    send(room, { ...idle, bomb: true });
    tick(room);
    send(room, { ...idle, dx: 1 });
    tick(room, 30);
    send(room, { ...idle, bomb: true, dx: 1 });
    tick(room, 30);
    expect(room.game!.bombs).toHaveLength(2);
    send(room, { ...idle, dx: 1, action: true });
    tick(room, 20); // only the first press counted
    expect(room.game!.bombs).toHaveLength(1);
  });

  test("glove: lift and throw with action messages", () => {
    const room = match();
    const p = room.game!.players[0];
    p.glove = true;
    send(room, { ...idle, bomb: true });
    tick(room);
    send(room, { ...idle, action: true });
    tick(room);
    expect(p.holding).not.toBeNull();
    send(room, { ...idle, action: true });
    tick(room);
    expect(p.holding).toBeNull();
    const flying = room.game!.bombs.find((b: Bomb) => b.flight);
    expect(flying).toBeDefined();
  });

  test("punch via messages", () => {
    const room = match();
    const g = room.game!;
    g.players[0].punch = true;
    g.players[0].facing = "right";
    g.bombs.push({
      id: g.nextBombId++, owner: "u2", x: 2, y: 1, ticksLeft: 200, range: 2, remote: false, power: false,
      slide: null, slideTimer: 0, held: null, flight: null,
    });
    send(room, { ...idle, action: true });
    tick(room);
    expect(g.bombs[0].flight).not.toBeNull();
  });

  test("garbage input is ignored safely", () => {
    const room = match();
    send(room, { t: "input", dx: "x", dy: 99, bomb: "yes", action: 1 } as unknown as ClientMsg);
    send(room, { t: "nope" } as unknown as ClientMsg);
    send(room, null as unknown as ClientMsg);
    tick(room, 5);
    expect(room.game!.bombs).toHaveLength(0);
    expect(room.game!.players[0].alive).toBe(true);
  });

  test("lobby messages report whether the lobby changed", () => {
    const room = createRoom("BCDFG", 4);
    joinRoom(room, "u1", "A");
    expect(handleClientMessage(room, "u1", { t: "map", mapId: "maze" }, () => 1)).toBe(true);
    expect(handleClientMessage(room, "u1", { t: "map", mapId: "nope" }, () => 1)).toBe(false);
    expect(handleClientMessage(room, "u1", { t: "capacity", capacity: 3 }, () => 1)).toBe(true);
    expect(handleClientMessage(room, "u1", { t: "input", dx: 1, dy: 0, bomb: false, action: false }, () => 1)).toBe(false);
  });
});
