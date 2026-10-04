import type { MapDef } from "./types";

export const GRID_W = 15;
export const GRID_H = 13;

const SPAWNS: [number, number][] = [
  [1, 1],
  [GRID_W - 2, 1],
  [1, GRID_H - 2],
  [GRID_W - 2, GRID_H - 2],
];

/** Which spawn (index into SPAWNS) the n-th player gets: with 2 players they start in opposite corners. */
export const SPAWN_ORDER = [0, 3, 1, 2];

const isBorder = (x: number, y: number) => x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1;
const isClassicPillar = (x: number, y: number) => x % 2 === 0 && y % 2 === 0;

/** `#` where `hard` says so, random soft blocks (`o`) elsewhere, and a safe L-shaped pocket per spawn. */
function build(hard: (x: number, y: number) => boolean): string[] {
  const grid: string[][] = [];
  for (let y = 0; y < GRID_H; y++) {
    const row: string[] = [];
    for (let x = 0; x < GRID_W; x++) row.push(isBorder(x, y) || hard(x, y) ? "#" : "o");
    grid.push(row);
  }
  SPAWNS.forEach(([sx, sy], i) => {
    const dx = sx === 1 ? 1 : -1;
    const dy = sy === 1 ? 1 : -1;
    grid[sy][sx] = String(i + 1);
    grid[sy][sx + dx] = ".";
    grid[sy + dy][sx] = ".";
  });
  return grid.map((r) => r.join(""));
}

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

export const MAPS: MapDef[] = [CLASSIC, OPEN_FIELD, MAZE, QUADRANTS];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? CLASSIC;
}

export function isMapId(id: unknown): id is string {
  return typeof id === "string" && MAPS.some((m) => m.id === id);
}
