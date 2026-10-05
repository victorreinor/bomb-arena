import { describe, expect, test } from "bun:test";
import {
  AUTO_BOMB_INTERVAL_TICKS,
  BOMB_FUSE_TICKS,
  BOUNCE_TICKS,
  DISEASE_TICKS,
  FLIGHT_TICKS,
  INVULN_TICKS,
  MAX_RANGE,
  REMOTE_FUSE_TICKS,
  START_RANGE,
  STUN_TICKS,
  bombsLaid,
  killPlayer,
  playerSpeed,
  step,
  type GameState,
  type PowerUpKind,
} from "../src";
import { corridor, makeGame, run, testBomb, testFlame } from "./helpers";



describe("kick", () => {
  test("walking into a bomb sets it sliding until it hits a player", () => {
    const s = makeGame(corridor("1..........2"));
    s.players[0].kick = true;
    const bomb = testBomb(s, 3, 1);
    run(s, 60, { p1: { dx: 1 } });
    expect(bomb.x).toBe(11); // p2 stands on tile 12
    expect(bomb.slide).toBeNull();
  });

  test("without the boots the bomb stays put", () => {
    const s = makeGame(corridor("1..........2"));
    const bomb = testBomb(s, 3, 1);
    run(s, 40, { p1: { dx: 1 } });
    expect(bomb.x).toBe(3);
  });

  test("a kicked bomb stops in front of a wall or another bomb", () => {
    const s = makeGame(corridor("1.....#...2"));
    s.players[0].kick = true;
    const bomb = testBomb(s, 3, 1);
    run(s, 60, { p1: { dx: 1 } });
    expect(bomb.x).toBe(6);

    const t = makeGame(corridor("1..........2"));
    t.players[0].kick = true;
    const first = testBomb(t, 3, 1);
    const blocker = testBomb(t, 8, 1);
    run(t, 60, { p1: { dx: 1 } });
    expect(first.x).toBe(7);
    expect(blocker.x).toBe(8);
  });

  test("a kicked bomb slides into fire and goes off", () => {
    const s = makeGame(corridor("1..........2"));
    s.players[0].kick = true;
    testBomb(s, 3, 1);
    testFlame(s, 6, 1, { ticksLeft: 60 });
    run(s, 30, { p1: { dx: 1 } });
    expect(s.bombs).toHaveLength(0);
  });

  test("the bomb you just placed is not kicked by walking off it", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[0].kick = true;
    step(s, { p1: { bomb: true } });
    run(s, 20, { p1: { dx: 1 } });
    expect(s.bombs[0].x).toBe(1);
  });
});

describe("punch", () => {
  test("flies over blocks and lands three tiles further on", () => {
    const s = makeGame(corridor("1b++..2".replace("b", ".")));
    s.players[0].punch = true;
    s.players[0].facing = "right";
    const bomb = testBomb(s, 2, 1);
    step(s, { p1: { action: true } });
    expect(bomb.flight).not.toBeNull();
    expect(bomb.flight!.toX).toBe(5);
    run(s, FLIGHT_TICKS + 1);
    expect(bomb.flight).toBeNull();
    expect(bomb.x).toBe(5);
  });

  test("lands on the next free tile when the target is blocked", () => {
    const s = makeGame(corridor("1.+.+.2"));
    s.players[0].punch = true;
    s.players[0].facing = "right";
    const bomb = testBomb(s, 2, 1);
    step(s, { p1: { action: true } });
    expect(bomb.flight!.toX).toBe(6); // tile 5 is soft; 6 is free
  });

  test("wraps around the arena edge", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[0].punch = true;
    s.players[0].facing = "left";
    s.players[0].x = 2.5;
    const bomb = testBomb(s, 1, 1);
    step(s, { p1: { action: true } });
    const w = s.width;
    expect(bomb.flight!.toX).toBe(w - 2); // 1 - 3 wraps to the far side of the arena
    run(s, FLIGHT_TICKS + 1);
    expect(s.tiles[bomb.y * w + bomb.x]).toBe(0);
  });

  test("a flying bomb is not solid and cannot blow up mid-air", () => {
    const s = makeGame(corridor("1..........2"));
    s.players[0].punch = true;
    s.players[0].facing = "right";
    const bomb = testBomb(s, 2, 1, { owner: "p2", ticksLeft: 1 });
    step(s, { p1: { action: true } });
    run(s, FLIGHT_TICKS - 3);
    expect(bomb.flight).not.toBeNull();
    expect(s.flames).toHaveLength(0);
    run(s, 6);
    expect(s.bombs).toHaveLength(0); // goes off right after landing
  });

  test("needs the punch glove", () => {
    const s = makeGame(corridor("1.....2"));
    s.players[0].facing = "right";
    const bomb = testBomb(s, 2, 1);
    step(s, { p1: { action: true } });
    expect(bomb.flight).toBeNull();
  });
});

describe("glove", () => {
  test("lift the bomb under you, carry it, and throw it", () => {
    const s = makeGame(corridor("1.........2"));
    const p = s.players[0];
    p.glove = true;
    step(s, { p1: { bomb: true } });
    const bomb = s.bombs[0];
    step(s, { p1: { action: true } });
    expect(p.holding).toBe(bomb.id);
    expect(bomb.held).toBe("p1");

    run(s, 20, { p1: { dx: 1 } });
    expect(bomb.x).toBe(Math.floor(p.x)); // it travels with the carrier
    const from = bomb.x;

    step(s, { p1: { action: true } });
    expect(p.holding).toBeNull();
    expect(bomb.flight!.toX).toBe(from + 3);
  });

  test("pressing bomb again also throws, and you can't lay a second bomb while carrying", () => {
    const s = makeGame(corridor("1.........2"));
    const p = s.players[0];
    p.glove = true;
    p.bombsMax = 3;
    p.facing = "right"; // along the corridor: straight down there is nowhere to land
    step(s, { p1: { bomb: true } });
    step(s, { p1: { action: true } });
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(1);
    expect(s.bombs[0].flight).not.toBeNull();
  });

  test("a carried bomb still ticks and blows up in your hands", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[0].glove = true;
    step(s, { p1: { bomb: true } });
    step(s, { p1: { action: true } });
    run(s, BOMB_FUSE_TICKS);
    expect(s.players[0].alive).toBe(false);
  });

  test("a carrier who dies drops the bomb", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[0].glove = true;
    step(s, { p1: { bomb: true } });
    step(s, { p1: { action: true } });
    killPlayer(s, s.players[0], "blast");
    expect(s.bombs[0].held).toBeNull();
    expect(s.players[0].holding).toBeNull();
  });
});

describe("bombs landing on someone", () => {
  /** p1 punches a bomb from (2,1) to (5,1); p2 is put wherever the test needs. */
  function punchAt(p2x: number) {
    const s = makeGame(corridor("1.........2"));
    const [p1, p2] = s.players;
    p1.punch = true;
    p1.facing = "right";
    p2.x = p2x;
    const bomb = testBomb(s, 2, 1, { owner: "p1" });
    step(s, { p1: { action: true } });
    return { s, p2, bomb };
  }

  test("a bomb landing on a head bounces on to the next tile and leaves them seeing stars", () => {
    const { s, p2, bomb } = punchAt(5.5);
    run(s, FLIGHT_TICKS);
    expect(p2.stunned).toBeGreaterThan(0);
    expect(bomb.flight).toMatchObject({ toX: 6, toY: 1 });
    run(s, BOUNCE_TICKS);
    expect(bomb.flight).toBeNull();
    expect(bomb.x).toBe(6);
  });

  test("while dizzy the controls do nothing; afterwards they work again", () => {
    const { s, p2 } = punchAt(5.5);
    run(s, FLIGHT_TICKS);
    run(s, STUN_TICKS - 1, { p2: { dx: -1, bomb: true } });
    expect(p2.x).toBe(5.5);
    expect(s.bombs).toHaveLength(1);
    run(s, 5, { p2: { dx: -1 } });
    expect(p2.x).toBeLessThan(5.5);
  });

  test("someone only brushing the landing tile isn't hit, and can walk off the bomb", () => {
    const { s, p2, bomb } = punchAt(4.7); // centre on (4,1), shoulder over (5,1)
    run(s, FLIGHT_TICKS);
    expect(p2.stunned).toBe(0);
    expect(bomb.x).toBe(5);
    run(s, 10, { p2: { dx: -1 } });
    expect(p2.x).toBeLessThan(4.5);
  });

  test("a dizzy carrier drops the bomb they hold", () => {
    const { s, p2 } = punchAt(5.5);
    p2.glove = true;
    step(s, { p2: { bomb: true } });
    step(s, { p2: { action: true } });
    expect(p2.holding).not.toBeNull();
    run(s, FLIGHT_TICKS);
    expect(p2.holding).toBeNull();
    expect(s.bombs.filter((b) => b.owner === "p2")).toMatchObject([{ x: 5, y: 1, held: null }]);
  });
});

describe("remote bombs", () => {
  test("only go off when detonated, oldest first", () => {
    const s = makeGame(corridor("1.........2"));
    const p = s.players[0];
    p.remote = true;
    p.bombsMax = 2;
    step(s, { p1: { bomb: true } });
    run(s, 40, { p1: { dx: 1 } }); // far enough that the blasts cannot chain
    step(s, { p1: { bomb: true } });
    run(s, BOMB_FUSE_TICKS + 20);
    expect(s.bombs).toHaveLength(2);

    step(s, { p1: { action: true } });
    expect(s.bombs).toHaveLength(1);
    expect(s.bombs[0].x).toBeGreaterThan(1);
    step(s, { p1: { action: true } });
    expect(s.bombs).toHaveLength(0);
  });

  test("still have a long safety fuse", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[0].remote = true;
    step(s, { p1: { bomb: true } });
    expect(s.bombs[0].ticksLeft).toBe(REMOTE_FUSE_TICKS - 1);
    run(s, 10, { p1: { dx: 1 } });
    s.bombs[0].ticksLeft = 1;
    step(s);
    expect(s.bombs).toHaveLength(0);
  });
});

describe("pass-through abilities", () => {
  test("bomb pass walks through bombs", () => {
    const s = makeGame(corridor("1..........2"));
    s.players[0].bombPass = true;
    testBomb(s, 3, 1);
    run(s, 40, { p1: { dx: 1 } });
    expect(s.players[0].x).toBeGreaterThan(5);
  });

  test("wall pass walks through soft blocks but not hard ones", () => {
    const s = makeGame(corridor("1.+.#..2"));
    s.players[0].wallPass = true;
    run(s, 60, { p1: { dx: 1 } });
    expect(s.players[0].x).toBeGreaterThan(3);
    expect(s.players[0].x).toBeLessThan(5);

    const t = makeGame(corridor("1.+...2"));
    run(t, 60, { p1: { dx: 1 } });
    expect(t.players[0].x).toBeLessThan(2.7); // stopped against the soft block at tile 3
  });
});

describe("vest", () => {
  test("absorbs one hit, then grants a short invulnerability", () => {
    const s = makeGame(corridor("1.........2"));
    const p = s.players[0];
    p.vest = true;
    testFlame(s, 1, 1, { ticksLeft: 5 });
    step(s);
    expect(p.alive).toBe(true);
    expect(p.vest).toBe(false);
    expect(p.invuln).toBeGreaterThan(INVULN_TICKS - 3);

    testFlame(s, 1, 1, { ticksLeft: 5 });
    step(s);
    expect(p.alive).toBe(true); // invulnerable
    p.invuln = 0;
    testFlame(s, 1, 1, { ticksLeft: 5 });
    step(s);
    expect(p.alive).toBe(false);
  });
});

describe("skull", () => {
  const curse = (s: GameState, kind: "slow" | "fast" | "noBomb" | "autoBomb" | "reverse" | "shortRange") => {
    s.players[0].disease = { kind, ticksLeft: DISEASE_TICKS };
  };

  test("picking one up curses you for a while", () => {
    const s = makeGame(corridor("1.........2"));
    s.powerUps.push({ x: 1, y: 1, kind: "skull" });
    step(s);
    expect(s.players[0].disease).not.toBeNull();
    s.players[0].disease!.ticksLeft = 2;
    run(s, 3);
    expect(s.players[0].disease).toBeNull();
  });

  test("slow and fast change walking speed", () => {
    const s = makeGame(corridor("1.........2"));
    const normal = playerSpeed(s.players[0]);
    curse(s, "slow");
    expect(playerSpeed(s.players[0])).toBeLessThan(normal);
    curse(s, "fast");
    expect(playerSpeed(s.players[0])).toBeGreaterThan(normal);
  });

  test("noBomb stops you laying bombs", () => {
    const s = makeGame(corridor("1.........2"));
    curse(s, "noBomb");
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(0);
  });

  test("autoBomb drops bombs by itself", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[0].bombsMax = 3;
    curse(s, "autoBomb");
    run(s, AUTO_BOMB_INTERVAL_TICKS * 2);
    expect(s.bombs.length).toBeGreaterThan(0);
  });

  test("reverse flips the controls", () => {
    const s = makeGame(corridor("..1.....2."));
    curse(s, "reverse");
    const x = s.players[0].x;
    run(s, 10, { p1: { dx: 1 } });
    expect(s.players[0].x).toBeLessThan(x);
  });

  test("shortRange limits bombs to one tile", () => {
    const s = makeGame(corridor("1.........2"));
    curse(s, "shortRange");
    step(s, { p1: { bomb: true } });
    expect(s.bombs[0].range).toBe(1);
  });

  test("the curse spreads to whoever you touch", () => {
    const s = makeGame(corridor("1.........2"));
    s.players[1].x = s.players[0].x + 0.5;
    curse(s, "slow");
    step(s);
    expect(s.players[1].disease?.kind).toBe("slow");
  });

  test("dying clears the curse", () => {
    const s = makeGame(corridor("1.........2"));
    curse(s, "slow");
    killPlayer(s, s.players[0], "blast");
    expect(s.players[0].disease).toBeNull();
  });
});

describe("line bomb and power bomb", () => {
  test("a line bomb lays every spare bomb in a row and is used up", () => {
    const s = makeGame(corridor("1.........2"));
    const p = s.players[0];
    p.bombsMax = 3;
    p.lineCharges = 1;
    p.facing = "right";
    step(s, { p1: { bomb: true } });
    expect(s.bombs.map((b) => b.x).sort()).toEqual([1, 2, 3]);
    expect(p.bombsActive).toBe(3);
    expect(p.lineCharges).toBe(0);
  });

  test("the line stops at obstacles", () => {
    const s = makeGame(corridor("1..+......2"));
    const p = s.players[0];
    p.bombsMax = 4;
    p.lineCharges = 1;
    p.facing = "right";
    step(s, { p1: { bomb: true } });
    expect(s.bombs.map((b) => b.x).sort()).toEqual([1, 2, 3]);
  });

  test("with a single spare bomb it is just a normal bomb and the charge is kept", () => {
    const s = makeGame(corridor("1.........2"));
    const p = s.players[0];
    p.lineCharges = 1;
    step(s, { p1: { bomb: true } });
    expect(s.bombs).toHaveLength(1);
    expect(p.lineCharges).toBe(1);
  });

  test("bombsLaid tells what a press would lay, without laying it: a row ahead with a line charge, else one bomb", () => {
    const s = makeGame(corridor("1..+......2"));
    const p = s.players[0];
    p.bombsMax = 4;
    expect(bombsLaid(s, p).map((b) => b.x)).toEqual([1]);
    p.lineCharges = 1;
    expect(bombsLaid(s, p, "right").map((b) => b.x)).toEqual([1, 2, 3]);
    expect(bombsLaid(s, p, "up").map((b) => [b.x, b.y])).toEqual([[1, 1]]); // a wall ahead: only the one underfoot
    expect(s.bombs).toHaveLength(0);
  });

  test("power bomb: the first bomb of a set has maximum range", () => {
    const s = makeGame(corridor("1.........2"));
    const p = s.players[0];
    p.powerBomb = true;
    p.bombsMax = 2;
    step(s, { p1: { bomb: true } });
    expect(s.bombs[0].range).toBe(MAX_RANGE);
    expect(s.bombs[0].power).toBe(true);
    run(s, 10, { p1: { dx: 1 } });
    step(s, { p1: { bomb: true } });
    expect(s.bombs[1].range).toBe(START_RANGE);
  });
});

describe("pick-ups", () => {
  const kinds: [PowerUpKind, (s: GameState) => boolean][] = [
    ["kick", (s) => s.players[0].kick],
    ["punch", (s) => s.players[0].punch],
    ["glove", (s) => s.players[0].glove],
    ["remote", (s) => s.players[0].remote],
    ["bombPass", (s) => s.players[0].bombPass],
    ["wallPass", (s) => s.players[0].wallPass],
    ["vest", (s) => s.players[0].vest],
    ["power", (s) => s.players[0].powerBomb],
    ["line", (s) => s.players[0].lineCharges === 1],
  ];
  test.each(kinds)("%s", (kind, check) => {
    const s = makeGame(corridor("1.........2"));
    s.powerUps.push({ x: 1, y: 1, kind });
    step(s);
    expect(check(s)).toBe(true);
  });
});
