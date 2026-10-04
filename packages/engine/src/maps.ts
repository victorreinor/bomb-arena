import type { MapDef } from "./types";

export const GRID_W = 15;
export const GRID_H = 13;

/**
 * Which spawn the n-th player gets, as an index into the corners (top-left, top-right, bottom-left,
 * bottom-right; spawn digits 1-4): with 2 players they start in opposite corners.
 */
export const SPAWN_ORDER = [0, 3, 1, 2];

const isClassicPillar = (x: number, y: number) => x % 2 === 0 && y % 2 === 0;

/**
 * A `width` x `height` arena walled all round: `#` where `hard` says so, random soft blocks (`o`) elsewhere,
 * and a spawn with a safe L-shaped pocket in each corner listed in `spawns` (all four by default).
 */
function build(hard: (x: number, y: number) => boolean, { width = GRID_W, height = GRID_H, spawns = [0, 1, 2, 3] } = {}): string[] {
  const grid: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(border || hard(x, y) ? "#" : "o");
    }
    grid.push(row);
  }
  const corners = [[1, 1], [width - 2, 1], [1, height - 2], [width - 2, height - 2]];
  for (const i of spawns) {
    const [sx, sy] = corners[i];
    const dx = sx === 1 ? 1 : -1;
    const dy = sy === 1 ? 1 : -1;
    grid[sy][sx] = String(i + 1);
    grid[sy][sx + dx] = ".";
    grid[sy + dy][sx] = ".";
  }
  return grid.map((r) => r.join(""));
}

/** A spawn point in a map's rows: the digit is its number. */
export const isSpawn = (ch: string) => ch >= "1" && ch <= "9";

/** How many players a map has room for: one per spawn point. */
export const mapSeats = (map: MapDef) => [...map.rows.join("")].filter(isSpawn).length;

const key = (x: number, y: number) => `${x},${y}`;
const setOf = (cells: [number, number][]) => new Set(cells.map(([x, y]) => key(x, y)));

/** Classic Super Bomberman layout: a pillar on every even/even cell. */
export const CLASSIC: MapDef = {
  id: "classic",
  name: "Clássico",
  rows: build(isClassicPillar),
  softDensity: 0.75,
};

/** Simple: very few pillars, lots of room to run. */
export const OPEN_FIELD: MapDef = {
  id: "open",
  name: "Campo Aberto",
  rows: build((x, y) => x % 4 === 0 && y % 4 === 0),
  softDensity: 0.6,
};

const MAZE_EXTRA = setOf([
  [3, 3], [11, 3], [3, 9], [11, 9],
  [5, 5], [9, 5], [7, 7],
]);

/** Complex: classic pillars plus extra walls on crossroads, forcing detours. */
export const MAZE: MapDef = {
  id: "maze",
  name: "Labirinto",
  rows: build((x, y) => isClassicPillar(x, y) || MAZE_EXTRA.has(key(x, y))),
  softDensity: 0.8,
};

const QUADRANT_GAPS = setOf([[7, 3], [7, 9], [3, 6], [11, 6]]);
const QUADRANT_PILLARS = setOf([[3, 3], [11, 3], [3, 9], [11, 9]]);

/** Complex: four rooms split by a wall cross; fights happen at the four doors. */
export const QUADRANTS: MapDef = {
  id: "quadrants",
  name: "Quadrantes",
  rows: build((x, y) => {
    if (QUADRANT_PILLARS.has(key(x, y))) return true;
    const onCross = x === 7 || y === 6;
    return onCross && !QUADRANT_GAPS.has(key(x, y));
  }),
  softDensity: 0.7,
};

/** one-on-one maps only have the corners the first two players get (opposite ones) */
const DUEL_SPAWNS = SPAWN_ORDER.slice(0, 2);

/** One on one, small: the two meet almost at once. */
export const DUEL: MapDef = {
  id: "duel",
  name: "Duelo",
  rows: build(isClassicPillar, { width: 11, height: 9, spawns: DUEL_SPAWNS }),
  softDensity: 0.6,
};

/** One on one, middle-sized: a little room to build up before the fight. */
export const FACEOFF: MapDef = {
  id: "faceoff",
  name: "Confronto",
  rows: build(isClassicPillar, { width: 13, height: 11, spawns: DUEL_SPAWNS }),
  softDensity: 0.7,
};

export const MAPS: MapDef[] = [CLASSIC, OPEN_FIELD, MAZE, QUADRANTS, DUEL, FACEOFF];
export const MAP_IDS = ["classic", "open", "maze", "quadrants", "duel", "faceoff"] as const;
export type MapId = (typeof MAP_IDS)[number];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? CLASSIC;
}

export function isMapId(id: unknown): id is string {
  return typeof id === "string" && MAPS.some((m) => m.id === id);
}
