import { describe, expect, test } from "bun:test";
import {
  CLASSIC,
  FLAME_TICKS,
  MINE_ARM_TICKS,
  MINE_FUSE_TICKS,
  canStart,
  computeRanking,
  createGame,
  createRoom,
  joinRoom,
  killPlayer,
  oneSided,
  roomView,
  sameTeam,
  setReady,
  startBlocker,
  step,
  winners,
  type GameState,
  type RoomState,
} from "../src";
import { FLAWLESS, backToLobby, corridor, finishMatch, makeGame, play, run, send, testBomb, testFlame } from "./helpers";

/** Four in a row, far enough apart to be out of each other's way: p1 and p2 against p3 and p4. */
const twoOnTwo = () => makeGame(corridor("1...2...3...4"), 4, 1, { teams: [0, 0, 1, 1] });

/** Who the finished match says won: the whole side, in seat order. */
const won = (s: GameState) => winners(s).map((p) => p.id);

const out = (s: GameState, ...ids: string[]) => {
  for (const id of ids) killPlayer(s, s.players.find((p) => p.id === id)!, "blast");
};

describe("teams", () => {
  test("players are on the side they were given, or on nobody's", () => {
    const players = [{ id: "a", color: 0, team: 1 }, { id: "b", color: 1, team: 0 }, { id: "c", color: 2 }];
    const s = createGame({ map: CLASSIC, seed: 1, players });
    expect(s.players.map((p) => p.team)).toEqual([1, 0, null]);
    expect(sameTeam(s.players[0], s.players[1])).toBe(false);
    expect(sameTeam(s.players[2], s.players[2])).toBe(false); // nobody's side is no side
  });

  test("the match goes on while both teams have someone standing", () => {
    const s = twoOnTwo();
    out(s, "p2", "p3");
    run(s, 3);
    expect(s.phase).toBe("playing");
  });

  test("it ends once only one team is left, however many of it, and that team wins", () => {
    const s = twoOnTwo();
    out(s, "p3", "p4");
    step(s);
    expect(s).toMatchObject({ phase: "finished", winner: "p1" });
    expect(won(s)).toEqual(["p1", "p2"]);
  });

  test("the last of a team standing alone against two still wins it for the team", () => {
    const s = twoOnTwo();
    out(s, "p1", "p3", "p4");
    step(s);
    expect(s).toMatchObject({ phase: "finished", winner: "p2" });
    expect(won(s)).toEqual(["p1", "p2"]); // the fallen one too
  });

  test("both teams gone at once is a draw", () => {
    const s = twoOnTwo();
    out(s, "p1", "p2", "p3", "p4");
    step(s);
    expect(s).toMatchObject({ phase: "finished", winner: null });
    expect(won(s)).toEqual([]);
  });

  test("with no teams the last one standing wins, alone", () => {
    const s = makeGame(corridor("1...2...3"), 3);
    out(s, "p2", "p3");
    step(s);
    expect(s).toMatchObject({ phase: "finished", winner: "p1" });
    expect(won(s)).toEqual(["p1"]);
  });
});

describe("friendly fire", () => {
  /** p1 and p2 (team-mates) and p3 (the other team), with a fire on p1's tile fed by `owners`' bombs. */
  function burning(friendlyFire: boolean, ...owners: string[]) {
    const s = makeGame(corridor("1...2...3"), 3, 1, { friendlyFire, teams: [0, 0, 1] });
    testFlame(s, 1, 1, { owner: owners[owners.length - 1] ?? "", owners }); // nobody's: lava
    step(s);
    return s.players[0];
  }

  test("a team-mate's blast kills like anyone's, unless friendly fire is off", () => {
    expect(burning(true, "p2")).toMatchObject({ alive: false, death: { how: "blast", by: "p2" } });
    expect(burning(false, "p2").alive).toBe(true);
  });

  test("with it off, their own bomb and the other team's still kill", () => {
    expect(burning(false, "p1")).toMatchObject({ alive: false, death: { by: "p1" } });
    expect(burning(false, "p3")).toMatchObject({ alive: false, death: { by: "p3" } });
  });

  // a chain reaction: the fire is the other team's too, whoever's bomb reached the tile last
  test("with it off, a fire a team-mate's bomb fed after the other team's still kills, and they get the credit", () => {
    expect(burning(false, "p3", "p2")).toMatchObject({ alive: false, death: { by: "p3" } });
  });

  test("with it off, lava spares nobody", () => {
    expect(burning(false)).toMatchObject({ alive: false, death: { how: "lava", by: null } });
  });

  test("it only means anything in a team match", () => {
    const s = makeGame(corridor("1...2"), 2, 1, { friendlyFire: false });
    testFlame(s, 1, 1, { owner: "p2", owners: ["p2"] });
    step(s);
    expect(s.players[0].alive).toBe(false);
  });

  test("a bomb's fire remembers every bomb that fed it", () => {
    const s = makeGame(corridor("1.......2"));
    testBomb(s, 4, 1, { owner: "p1", ticksLeft: 1, range: 1 });
    step(s);
    testBomb(s, 6, 1, { owner: "p2", ticksLeft: 1, range: 1 });
    step(s);
    const shared = s.flames.find((f) => f.x === 5)!;
    expect(shared).toMatchObject({ owner: "p2", owners: ["p1", "p2"], ticksLeft: FLAME_TICKS });
  });
});

describe("mines in a team match", () => {
  /** p1 and p2 against p3 in a corridor, each stood on the column given, with `owner`'s mine buried on column 6. */
  function mined(owner: string, columns: [number, number, number]) {
    const s = makeGame(corridor("1.........2"), 3, 1, { teams: [0, 0, 1] });
    s.players.forEach((p, i) => (p.x = columns[i] + 0.5));
    const mine = testBomb(s, 6, 1, { owner, mine: true, range: 1, ticksLeft: MINE_FUSE_TICKS - MINE_ARM_TICKS });
    return { s, mine };
  }

  test("a team-mate walks over it like its owner; someone on the other side sets it off", () => {
    const { s, mine } = mined("p1", [1, 4, 10]);
    run(s, 30, { p2: { dx: 1 } });
    expect(s.players[1].x).toBeGreaterThan(7.5); // right over it and clear of its blast
    expect(s.bombs).toEqual([mine]);
    run(s, 40, { p3: { dx: -1 } });
    expect(s.bombs).toHaveLength(0);
    expect(s.players[2].death).toEqual({ how: "blast", by: "p1" });
    expect(s.players[1].alive).toBe(true);
  });

  test("a bot sees a team-mate's buried mine as it does its own, and stays out of its reach", () => {
    // p3, whom the bot (p2) is after, is on the far side of the mine
    const { s } = mined("p1", [1, 11, 2]);
    play(s, ["p2"], 150, FLAWLESS);
    expect(s.players[1].alive).toBe(true);
    expect(s.players[1].x).toBeGreaterThan(7.5);
  });

  test("the other side's it doesn't see, and walks onto", () => {
    const { s } = mined("p3", [1, 11, 2]);
    play(s, ["p2"], 150, FLAWLESS);
    expect(s.players[1].death).toEqual({ how: "blast", by: "p3" });
  });
});

describe("team ranking", () => {
  test("a team stands or falls together: the winners share first place, the others second", () => {
    const s = twoOnTwo();
    out(s, "p2"); // goes out first of all, and still wins with p1
    run(s, 2);
    out(s, "p3", "p4");
    step(s);
    const places = Object.fromEntries(computeRanking(s).map((r) => [r.id, r.place]));
    expect(places).toEqual({ p1: 1, p2: 1, p3: 2, p4: 2 });
    expect(computeRanking(s).map((r) => r.id).slice(0, 2)).toEqual(["p1", "p2"]); // the one left standing first
  });

  test("one against two: second place is still second", () => {
    const s = makeGame(corridor("1...2...3"), 3, 1, { teams: [0, 1, 1] });
    out(s, "p1");
    step(s);
    expect(computeRanking(s)).toEqual([{ id: "p2", place: 1 }, { id: "p3", place: 1 }, { id: "p1", place: 2 }]);
  });
});

describe("teams in a room", () => {
  /** A lobby in team mode with `names` in it (u1 hosting), everyone ready. */
  function teamLobby(names: string[], capacity = 4): RoomState {
    const room = createRoom("BCDFG", capacity, true);
    names.forEach((n, i) => joinRoom(room, `u${i + 1}`, n));
    for (const m of room.members) setReady(room, m.id, true);
    return room;
  }
  const teamsOf = (room: RoomState) => Object.fromEntries(roomView(room).members.map((m) => [m.id, m.team]));
  test("a room is everyone for themselves unless created (or set by the host) for teams", () => {
    const room = createRoom("BCDFG");
    joinRoom(room, "u1", "Ana");
    joinRoom(room, "u2", "Bia");
    expect(roomView(room)).toMatchObject({ teams: false, friendlyFire: true });
    expect(send(room, "u2", { t: "teams", on: true })).toBe(false); // not the host
    expect(send(room, "u1", { t: "teams", on: true })).toBe(true);
    expect(send(room, "u1", { t: "teams", on: true })).toBe(false); // no change
    expect(roomView(room).teams).toBe(true);
    expect(roomView(createRoom("BCDFG", 4, true)).teams).toBe(true);
  });

  test("whoever comes in goes to the side with fewer, so the teams fill up evenly", () => {
    const room = teamLobby(["Ana", "Bia", "Caio"]);
    expect(teamsOf(room)).toEqual({ u1: 0, u2: 1, u3: 0 });
    send(room, "u1", { t: "addBot" });
    expect(teamsOf(room)).toMatchObject({ "bot-1": 1 });
  });

  test("each picks their own side; the host moves anyone, bots too", () => {
    const room = teamLobby(["Ana", "Bia"]);
    send(room, "u1", { t: "addBot" });
    expect(send(room, "u2", { t: "team", team: 0 })).toBe(true);
    expect(send(room, "u2", { t: "team", team: 0 })).toBe(false); // already there
    expect(send(room, "u2", { t: "team", team: 2 })).toBe(false); // no such side
    expect(send(room, "u2", { t: "team", team: 1, id: "u1" })).toBe(false); // not theirs to move
    expect(send(room, "u1", { t: "team", team: 1, id: "bot-1" })).toBe(true);
    expect(send(room, "u1", { t: "team", team: 1, id: "u2" })).toBe(true);
    expect(teamsOf(room)).toEqual({ u1: 0, u2: 1, "bot-1": 1 });
  });

  test("a team match takes three players, bots included: one against one is everyone for themselves", () => {
    const room = teamLobby(["Ana", "Bia"]);
    expect(startBlocker(roomView(room))).toBe("teamPlayers");
    expect(send(room, "u1", { t: "start" })).toBe(false);
    send(room, "u1", { t: "addBot" });
    expect(startBlocker(roomView(room))).toBeNull();
    expect(send(room, "u1", { t: "start" })).toBe(true);
  });

  test("a team room seats three at least: asked for two, it gets three, and can't be cut back to two", () => {
    expect(createRoom("BCDFG", 2, true).capacity).toBe(3);
    const room = createRoom("BCDFG", 2);
    joinRoom(room, "u1", "Ana");
    expect(send(room, "u1", { t: "teams", on: true })).toBe(true);
    expect(room.capacity).toBe(3);
    expect(send(room, "u1", { t: "capacity", capacity: 2 })).toBe(false);
    send(room, "u1", { t: "teams", on: false });
    expect(send(room, "u1", { t: "capacity", capacity: 2 })).toBe(true);
  });

  test("a match needs someone on each side; three against one is up to them", () => {
    const room = teamLobby(["Ana", "Bia", "Caio", "Duda"]);
    for (const id of ["u2", "u4"]) send(room, id, { t: "team", team: 0 });
    expect(teamsOf(room)).toEqual({ u1: 0, u2: 0, u3: 0, u4: 0 });
    expect(oneSided(roomView(room))).toBe(true);
    expect(canStart(roomView(room))).toBe(false);
    expect(send(room, "u1", { t: "start" })).toBe(false);
    send(room, "u4", { t: "team", team: 1 });
    expect(oneSided(roomView(room))).toBe(false);
    expect(send(room, "u1", { t: "start" })).toBe(true);
    expect(room.game!.players.map((p) => p.team)).toEqual([0, 0, 0, 1]);
    expect(send(room, "u2", { t: "team", team: 1 })).toBe(false); // not in the middle of a match
  });

  test("with teams off, sides don't matter: the match is everyone for themselves", () => {
    const room = createRoom("BCDFG");
    joinRoom(room, "u1", "Ana");
    joinRoom(room, "u2", "Bia");
    send(room, "u2", { t: "team", team: 0 });
    send(room, "u2", { t: "ready", ready: true });
    expect(send(room, "u1", { t: "start" })).toBe(true);
    expect(room.game!.players.map((p) => p.team)).toEqual([null, null]);
  });

  test("two against two: team-mates start in opposite corners, the other team between them", () => {
    const room = teamLobby(["Ana", "Bia", "Caio", "Duda"]);
    send(room, "u1", { t: "start" });
    const game = room.game!;
    const at = (id: string) => game.players.find((p) => p.id === id)!;
    const [right, bottom] = [game.width - 1.5, game.height - 1.5];
    expect([at("u1"), at("u3")].map((p) => [p.team, p.x, p.y])).toEqual([[0, 1.5, 1.5], [0, right, bottom]]);
    expect([at("u2"), at("u4")].map((p) => [p.team, p.x, p.y])).toEqual([[1, right, 1.5], [1, 1.5, bottom]]);
  });

  test("two against one: the pair still start opposite each other, whichever side they are", () => {
    const room = teamLobby(["Ana", "Bia", "Caio"]);
    for (const [id, team] of [["u1", 0], ["u2", 1], ["u3", 1]] as const) send(room, "u1", { t: "team", team, id });
    send(room, "u1", { t: "start" });
    const game = room.game!;
    const at = (id: string) => game.players.find((p) => p.id === id)!;
    expect([at("u2").x, at("u2").y, at("u3").x, at("u3").y]).toEqual([1.5, 1.5, game.width - 1.5, game.height - 1.5]);
    expect([at("u1").team, at("u2").team, at("u3").team]).toEqual([0, 1, 1]);
  });

  test("friendly fire is the host's to turn off, and reaches the match", () => {
    const room = teamLobby(["Ana", "Bia", "Caio"]);
    expect(send(room, "u2", { t: "friendlyFire", on: false })).toBe(false);
    expect(send(room, "u1", { t: "friendlyFire", on: false })).toBe(true);
    expect(roomView(room).friendlyFire).toBe(false);
    send(room, "u1", { t: "start" });
    expect(room.game!.friendlyFire).toBe(false);
  });

  test("the whole winning team scores, fallen or not, and the result names them", () => {
    const room = teamLobby(["Ana", "Bia", "Caio", "Duda"]);
    send(room, "u1", { t: "start" });
    finishMatch(room, "u3"); // Caio, on Ana's side, is the only one left
    const view = roomView(room);
    expect(Object.fromEntries(view.members.map((m) => [m.name, m.score]))).toEqual({ Ana: 1, Bia: 0, Caio: 1, Duda: 0 });
    expect(view.lastResult).toEqual({ winnerName: "Ana e Caio", winnerColor: 0, winnerTeam: 0, seriesWon: false });
  });

  test("a series is the team's: won as soon as its players have the wins it takes", () => {
    const room = teamLobby(["Ana", "Bia", "Caio"]);
    send(room, "u1", { t: "bestOf", n: 3 });
    for (let round = 0; round < 2; round++) {
      for (const m of room.members) setReady(room, m.id, true);
      send(room, "u1", { t: "start" });
      finishMatch(room, "u2");
      expect(roomView(room).lastResult).toMatchObject({ winnerName: "Bia", winnerTeam: 1, seriesWon: round === 1 });
      backToLobby(room);
    }
  });

  test("switching between teams and everyone for themselves starts the score over", () => {
    const room = teamLobby(["Ana", "Bia", "Caio"]);
    send(room, "u1", { t: "start" });
    finishMatch(room, "u1");
    backToLobby(room);
    expect(roomView(room).members[0].score).toBe(1);
    send(room, "u1", { t: "teams", on: false });
    expect(roomView(room).members[0].score).toBe(0);
  });

  test("sides drawn: the host's option, off at first; nobody picks a side then, and the lobby's sides don't hold a match up", () => {
    const room = teamLobby(["Ana", "Bia", "Caio"]);
    expect(roomView(room).randomTeams).toBe(false);
    expect(send(room, "u2", { t: "randomTeams", on: true })).toBe(false); // not the host
    send(room, "u2", { t: "team", team: 0 });
    expect(oneSided(roomView(room))).toBe(true);
    expect(send(room, "u1", { t: "randomTeams", on: true })).toBe(true);
    expect(roomView(room).randomTeams).toBe(true);
    expect(send(room, "u2", { t: "team", team: 1 })).toBe(false);
    expect(send(room, "u1", { t: "team", team: 1, id: "u3" })).toBe(false);
    expect(oneSided(roomView(room))).toBe(false);
    expect(send(room, "u1", { t: "start" })).toBe(true);
  });

  /** Plays `matches` matches in a lobby that draws its sides, and gives each one's sides: the ids on each, sorted. */
  function drawnSides(room: RoomState, matches: number): string[][][] {
    send(room, "u1", { t: "randomTeams", on: true });
    const drawn: string[][][] = [];
    for (let i = 0; i < matches; i++) {
      for (const m of room.members) setReady(room, m.id, true);
      expect(send(room, "u1", { t: "start" })).toBe(true);
      const side = (team: number) => room.game!.players.filter((p) => p.team === team).map((p) => p.id).sort();
      drawn.push([side(0), side(1)]);
      finishMatch(room, "u1");
      backToLobby(room);
    }
    return drawn;
  }
  const partnerOf = (id: string, sides: string[][]) => sides.find((side) => side.includes(id))!.find((o) => o !== id);

  test("drawn sides with four: two against two, and in three matches everyone has been everyone's partner", () => {
    const room = teamLobby(["Ana", "Bia"]);
    send(room, "u1", { t: "addBot" });
    send(room, "u1", { t: "addBot" });
    const drawn = drawnSides(room, 3);
    for (const sides of drawn) expect(sides.map((side) => side.length)).toEqual([2, 2]);
    expect(drawn.map((sides) => partnerOf("u1", sides)).sort()).toEqual(["bot-1", "bot-2", "u2"]);
  });

  test("drawn sides with three: two against one, each has a turn alone, then a new round that doesn't repeat the last", () => {
    const room = teamLobby(["Ana", "Bia", "Caio"]);
    const drawn = drawnSides(room, 4);
    for (const sides of drawn) expect(sides.map((side) => side.length)).toEqual([2, 1]);
    const alone = drawn.map((sides) => sides[1][0]);
    expect(alone.slice(0, 3).sort()).toEqual(["u1", "u2", "u3"]);
    expect(alone[3]).not.toBe(alone[2]);
  });

  test("drawn sides: the series is won by whoever gets the wins first, not by the side of its last match", () => {
    const room = teamLobby(["Ana", "Bia", "Caio"]);
    send(room, "u1", { t: "bestOf", n: 3 });
    drawnSides(room, 2); // Ana stands at the end of both: she won both, with a different partner or alone
    const result = roomView(room).lastResult!;
    expect(result).toMatchObject({ winnerName: "Ana", winnerColor: 0, winnerTeam: null, seriesWon: true });
  });

  test("without teams the result names no team", () => {
    const room = createRoom("BCDFG");
    joinRoom(room, "u1", "Ana");
    joinRoom(room, "u2", "Bia");
    send(room, "u2", { t: "ready", ready: true });
    send(room, "u1", { t: "start" });
    finishMatch(room, "u2");
    expect(roomView(room).lastResult).toEqual({ winnerName: "Bia", winnerColor: 1, winnerTeam: null, seriesWon: false });
  });
});
