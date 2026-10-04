import { describe, expect, test } from "bun:test";
import {
  FLIGHT_TICKS,
  GHOST_MOVE_TICKS,
  GHOST_THROW_COOLDOWN_TICKS,
  RECONNECT_GRACE_TICKS,
  borderRing,
  createGame,
  createRoom,
  disconnect,
  handleClientMessage,
  joinRoom,
  roomView,
  step,
  stepRoom,
  type GameState,
  type MapDef,
} from "../src";
import { run } from "./helpers";

/** An open 9x7 arena with three players, revenge on unless said otherwise. */
function arena(revenge = true): GameState {
  const rows = ["#########", "#1.....2#", "#.......#", "#.......#", "#.......#", "#3......#", "#########"];
  const map: MapDef = { id: "t", name: "t", rows, softDensity: 0 };
  return createGame({ map, seed: 1, revenge, players: ["p1", "p2", "p3"].map((id, i) => ({ id, color: i, spawn: i })) });
}

function burn(s: GameState, id: string) {
  const p = s.players.find((o) => o.id === id)!;
  s.flames.push({ x: Math.floor(p.x), y: Math.floor(p.y), arms: 0, ticksLeft: 3 });
  step(s);
}

describe("revenge mode", () => {
  test("is off by default: the dead just stay dead", () => {
    const s = arena(false);
    burn(s, "p1");
    expect(s.players[0].alive).toBe(false);
    expect(s.players[0].ghost).toBeNull();
  });

  test("the dead become a ghost on the wall nearest to where they fell", () => {
    const s = arena();
    burn(s, "p1");
    const p = s.players[0];
    expect(p.alive).toBe(false);
    expect(p.ghost).not.toBeNull();
    const tile = borderRing(s.width, s.height)[p.ghost!.pos];
    expect(Math.hypot(tile.x - 1, tile.y - 1)).toBeLessThanOrEqual(1); // next to the top-left corner
  });

  test("ghosts walk along the wall, round the corners", () => {
    const s = arena();
    burn(s, "p1");
    const ring = borderRing(s.width, s.height);
    const start = s.players[0].ghost!.pos;
    // on the top side, right = clockwise; the first step is immediate, then one every GHOST_MOVE_TICKS
    run(s, GHOST_MOVE_TICKS * 2 + 1, { p1: { dx: 1 } });
    expect(s.players[0].ghost!.pos).toBe((start + 3) % ring.length);
    run(s, GHOST_MOVE_TICKS * 2 + 1, { p1: { dx: -1 } });
    expect(s.players[0].ghost!.pos).toBe((start + 1) % ring.length);
    // from the first tile of the top side, counter-clockwise wraps round onto the left side
    s.players[0].ghost!.pos = 0;
    run(s, GHOST_MOVE_TICKS + 1, { p1: { dx: -1 } });
    const tile = ring[s.players[0].ghost!.pos];
    expect(tile).toMatchObject({ x: 0, y: 1, inward: "right" });
    expect(s.players[0].facing).toBe("right");
  });

  test("a ghost lobs a bomb into the arena, then has to wait", () => {
    const s = arena();
    burn(s, "p1");
    const p = s.players[0];
    run(s, GHOST_THROW_COOLDOWN_TICKS);
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(1);
    const bomb = s.bombs[0];
    expect(bomb.owner).toBe("p1");
    expect(bomb.flight).not.toBeNull();
    const tile = borderRing(s.width, s.height)[p.ghost!.pos];
    expect(tile.inward).toBe("down");
    expect(bomb.flight!.toY).toBe(3); // three tiles in from the top wall
    run(s, FLIGHT_TICKS + 1);
    expect(bomb.flight).toBeNull();

    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(1); // one at a time, and on cooldown anyway
  });

  test("a ghost's bomb can take out the living", () => {
    const s = arena();
    burn(s, "p1");
    run(s, GHOST_THROW_COOLDOWN_TICKS);
    const target = s.players[2]; // p3, at (1, 5)
    target.x = 1.5;
    target.y = 3.5;
    // walk the ghost to the top tile above column 1 and throw: the bomb lands at (1, 3)
    const ring = borderRing(s.width, s.height);
    s.players[0].ghost!.pos = ring.findIndex((t) => t.x === 1 && t.y === 0);
    step(s, { p1: { bomb: true } });
    run(s, 200);
    expect(target.alive).toBe(false);
  });

  test("players eliminated by disconnecting never haunt the arena", () => {
    const room = createRoom("BCDFG", 3);
    ["u1", "u2", "u3"].forEach((id) => joinRoom(room, id, id));
    expect(handleClientMessage(room, "u1", { t: "revenge", on: true }, () => 1)).toBe(true);
    handleClientMessage(room, "u2", { t: "ready", ready: true }, () => 1);
    handleClientMessage(room, "u3", { t: "ready", ready: true }, () => 1);
    handleClientMessage(room, "u1", { t: "start" }, () => 1);
    expect(room.game!.revenge).toBe(true);
    disconnect(room, "u3");
    for (let i = 0; i < RECONNECT_GRACE_TICKS + 2; i++) stepRoom(room);
    const p3 = room.game!.players.find((p) => p.id === "u3")!;
    expect(p3.alive).toBe(false);
    expect(p3.ghost).toBeNull();
  });

  test("only the host toggles it, in the lobby, and everyone sees it", () => {
    const room = createRoom("BCDFG", 2);
    joinRoom(room, "u1", "A");
    joinRoom(room, "u2", "B");
    expect(roomView(room).revenge).toBe(false);
    expect(handleClientMessage(room, "u2", { t: "revenge", on: true }, () => 1)).toBe(false);
    expect(handleClientMessage(room, "u1", { t: "revenge", on: true }, () => 1)).toBe(true);
    expect(roomView(room).revenge).toBe(true);
    handleClientMessage(room, "u2", { t: "ready", ready: true }, () => 1);
    handleClientMessage(room, "u1", { t: "start" }, () => 1);
    expect(handleClientMessage(room, "u1", { t: "revenge", on: false }, () => 1)).toBe(false);
  });
});
