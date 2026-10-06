import { describe, expect, test } from "bun:test";
import {
  BOMB_FUSE_TICKS,
  DASH_TICKS,
  INVULN_TICKS,
  JUMP_TICKS,
  PET_COOLDOWN_TICKS,
  PET_KINDS,
  TILE,
  handleClientMessage,
  step,
  stepRoom,
  type GameState,
  type PetKind,
} from "../src";
import { corridor, makeGame, run, startedMatch, testBomb, testFlame } from "./helpers";


function mount(s: GameState, kind: PetKind, i = 0) {
  s.players[i].pet = { kind, cooldown: 0, dashTicks: 0 };
}

describe("eggs", () => {
  test("picking up an egg mounts a pet", () => {
    const s = makeGame(corridor("1.........2"));
    s.powerUps.push({ x: 1, y: 1, kind: "egg" });
    step(s);
    expect(PET_KINDS).toContain(s.players[0].pet!.kind);
    expect(s.powerUps).toHaveLength(0);
  });

  test("a rider leaves the next egg on the floor", () => {
    const s = makeGame(corridor("1.........2"));
    mount(s, "runner");
    s.powerUps.push({ x: 1, y: 1, kind: "egg" });
    step(s);
    expect(s.players[0].pet!.kind).toBe("runner");
    expect(s.powerUps).toHaveLength(1);
  });
});

describe("taking a hit while riding", () => {
  test("the pet is lost, the rider survives and is briefly invulnerable", () => {
    const s = makeGame(corridor("1.........2"));
    mount(s, "jumper");
    testFlame(s, 1, 1, { ticksLeft: 5 });
    step(s);
    const p = s.players[0];
    expect(p.alive).toBe(true);
    expect(p.pet).toBeNull();
    expect(p.invuln).toBeGreaterThan(INVULN_TICKS - 3);
  });

  test("the pet goes before the vest", () => {
    const s = makeGame(corridor("1.........2"));
    mount(s, "runner");
    s.players[0].vest = true;
    testFlame(s, 1, 1, { ticksLeft: 5 });
    step(s);
    expect(s.players[0].pet).toBeNull();
    expect(s.players[0].vest).toBe(true);
  });

  test("dying clears the pet", () => {
    const s = makeGame(corridor("1.2.......#"));
    mount(s, "runner", 1);
    s.players[1].invuln = 0;
    // two blasts in a row: the first costs the pet, the second (after invulnerability) the life
    testFlame(s, 3, 1, { ticksLeft: 2 });
    step(s);
    s.players[1].invuln = 0;
    testFlame(s, 3, 1, { ticksLeft: 2 });
    step(s);
    expect(s.players[1].alive).toBe(false);
    expect(s.players[1].pet).toBeNull();
  });
});

describe("runner (dash)", () => {
  test("charges ahead much faster than walking and stops at a wall", () => {
    const s = makeGame(corridor("1.............#2"));
    mount(s, "runner");
    s.players[0].facing = "right";
    const walk = makeGame(corridor("1.............#2"));
    run(walk, 6, { p1: { dx: 1 } });

    step(s, { p1: { pet: true } });
    run(s, 5);
    expect(s.players[0].x - 1.5).toBeGreaterThan((walk.players[0].x - 1.5) * 2);

    run(s, DASH_TICKS + 10);
    expect(s.players[0].x).toBeLessThan(15); // the hard block at tile 15 stops it
    expect(s.players[0].pet!.dashTicks).toBe(0);
  });

  test("ignores the controls while dashing", () => {
    const s = makeGame(corridor("1.........2"));
    mount(s, "runner");
    s.players[0].facing = "right";
    step(s, { p1: { pet: true } });
    run(s, 4, { p1: { dx: -1 } });
    expect(s.players[0].x).toBeGreaterThan(2);
  });
});

describe("jumper (hop)", () => {
  test("jumps two tiles over a block and cannot be burnt in mid-air", () => {
    const s = makeGame(corridor("1.+.....2"));
    mount(s, "jumper");
    const p = s.players[0];
    p.x = 2.5;
    p.facing = "right";
    step(s, { p1: { pet: true } });
    expect(p.jump).not.toBeNull();
    testFlame(s, 3, 1, { ticksLeft: JUMP_TICKS });
    run(s, JUMP_TICKS - 1);
    expect(p.alive).toBe(true);
    run(s, 2);
    expect(p.jump).toBeNull();
    expect(Math.floor(p.x)).toBe(4);
  });

  test("needs a free landing spot", () => {
    const s = makeGame(corridor("1.+#....2"));
    mount(s, "jumper");
    s.players[0].x = 2.5;
    s.players[0].facing = "right";
    step(s, { p1: { pet: true } });
    expect(s.players[0].jump).toBeNull();
    expect(s.players[0].pet!.cooldown).toBe(0); // a failed attempt costs nothing
  });

  test("never jumps out over the outer wall", () => {
    const s = makeGame(corridor("1.........2"));
    mount(s, "jumper");
    s.players[0].facing = "left";
    step(s, { p1: { pet: true } });
    expect(s.players[0].jump).toBeNull();
  });
});

describe("pusher", () => {
  test("shoves the brick block ahead by one tile", () => {
    const s = makeGame(corridor("1.+.....2"));
    mount(s, "pusher");
    s.players[0].x = 2.5;
    s.players[0].facing = "right";
    step(s, { p1: { pet: true } });
    const w = s.width;
    expect(s.tiles[1 * w + 3]).toBe(TILE.EMPTY);
    expect(s.tiles[1 * w + 4]).toBe(TILE.SOFT);
  });

  test("won't push into another block, a bomb or a player", () => {
    const s = makeGame(corridor("1.++....2"));
    mount(s, "pusher");
    s.players[0].x = 2.5;
    s.players[0].facing = "right";
    step(s, { p1: { pet: true } });
    expect(s.tiles[1 * s.width + 3]).toBe(TILE.SOFT);
    expect(s.tiles[1 * s.width + 4]).toBe(TILE.SOFT);

    const t = makeGame(corridor("1.+2....."));
    mount(t, "pusher");
    t.players[0].x = 2.5;
    t.players[0].facing = "right";
    step(t, { p1: { pet: true } });
    expect(t.tiles[1 * t.width + 3]).toBe(TILE.SOFT);
  });
});

describe("kicker", () => {
  test("kicks the bomb ahead fast, even without the boots", () => {
    const s = makeGame(corridor("1............2"));
    mount(s, "kicker");
    s.players[0].facing = "right";
    s.players[0].bombsMax = 2;
    // a bomb on the next tile (placed by p2 so p1 is not standing on it)
    testBomb(s, 2, 1);
    step(s, { p1: { pet: true } });
    run(s, 6);
    expect(s.bombs[0].x).toBeGreaterThanOrEqual(8); // one tile per tick
    run(s, 10);
    expect(s.bombs[0].x).toBe(13); // stops in front of p2 on tile 14
  });

  test("with no bomb ahead, it kicks the one they stand on", () => {
    const s = makeGame(corridor("1............2"));
    mount(s, "kicker");
    s.players[0].facing = "right";
    step(s, { p1: { bomb: true } });
    step(s, { p1: { pet: true } });
    expect(s.players[0].pet!.cooldown).toBe(PET_COOLDOWN_TICKS.kicker);
    run(s, 16);
    expect(s.bombs[0].x).toBe(13);
  });
});

describe("cooldowns", () => {
  test("a power can't be spammed", () => {
    const s = makeGame(corridor("1.+.........2"));
    mount(s, "pusher");
    const p = s.players[0];
    const w = s.width;
    p.x = 2.5;
    p.facing = "right";
    step(s, { p1: { pet: true } }); // brick 3 -> 4
    expect(p.pet!.cooldown).toBe(PET_COOLDOWN_TICKS.pusher);
    expect(s.tiles[1 * w + 4]).toBe(TILE.SOFT);

    // right behind the brick again, with room to push it: still recharging, nothing happens
    p.x = 3.5;
    step(s, { p1: { pet: true } });
    expect(s.tiles[1 * w + 4]).toBe(TILE.SOFT);

    run(s, PET_COOLDOWN_TICKS.pusher);
    expect(p.pet!.cooldown).toBe(0);
    step(s, { p1: { pet: true } }); // now it works: brick 4 -> 5
    expect(s.tiles[1 * w + 5]).toBe(TILE.SOFT);
  });
});

describe("online", () => {
  test("the pet key travels through client messages", () => {
    const room = startedMatch();
    const g = room.game!;
    g.players[0].pet = { kind: "runner", cooldown: 0, dashTicks: 0 };
    g.players[0].facing = "right";
    handleClientMessage(room, "u1", { t: "input", dx: 0, dy: 0, bomb: false, action: false, pet: true }, () => 1);
    stepRoom(room);
    expect(g.players[0].pet!.cooldown).toBe(PET_COOLDOWN_TICKS.runner);
    expect(room.inputs.u1.pet).toBe(false);
  });

  test("bombs still work while riding", () => {
    const s = makeGame(corridor("1.........2"));
    mount(s, "runner");
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(1);
    run(s, BOMB_FUSE_TICKS);
  });
});
