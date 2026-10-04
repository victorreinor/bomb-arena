import { FLAME_TICKS, TILE, tileAt, wrap, type Bomb, type GameState } from "@bomberman/engine";
import type { AmbientSource, Effects } from "./effects";
import { drawFlames } from "./fire";
import { ITEM_COL } from "./items";
import { TILE_PX, type Sprites } from "./sprites";

export const SCALE = 3;

const FACE_ROW = { down: 0, up: 1, left: 2, right: 3 } as const;

export function canvasSize(state: GameState) {
  return { width: state.width * TILE_PX * SCALE, height: state.height * TILE_PX * SCALE };
}

/** The floor and blocks only change when a soft block burns, so they are drawn once into an offscreen canvas. */
const board = { canvas: null as HTMLCanvasElement | null, tiles: [] as number[], sprites: null as Sprites | null };

function boardImage(state: GameState, sprites: Sprites): HTMLCanvasElement {
  const unchanged =
    board.canvas &&
    board.sprites === sprites &&
    board.tiles.length === state.tiles.length &&
    state.tiles.every((t, i) => t === board.tiles[i]);
  if (unchanged) return board.canvas!;

  const canvas = board.canvas ?? document.createElement("canvas");
  canvas.width = state.width * TILE_PX;
  canvas.height = state.height * TILE_PX;
  const g = canvas.getContext("2d")!;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const t = tileAt(state, x, y);
      // floor right under a block gets the shadowed variant
      const col = t === TILE.HARD ? 2 : t === TILE.SOFT ? 3 : tileAt(state, x, y - 1) !== TILE.EMPTY ? 1 : 0;
      g.drawImage(sprites.tiles, col * TILE_PX, 0, TILE_PX, TILE_PX, x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
    }
  }
  board.canvas = canvas;
  board.tiles = [...state.tiles];
  board.sprites = sprites;
  return canvas;
}

/** Draws one frame. `state` is what to show (already interpolated by the caller, see lerpState). */
export function render(ctx: CanvasRenderingContext2D, state: GameState, sprites: Sprites, timeMs: number, effects?: Effects) {
  effects?.update(timeMs);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(SCALE, SCALE);
  ctx.clearRect(0, 0, state.width * TILE_PX, state.height * TILE_PX);
  const shake = effects?.shakeOffset();
  if (shake) ctx.translate(shake.x, shake.y);

  const cell = (img: HTMLImageElement, col: number, row: number, dx: number, dy: number) =>
    ctx.drawImage(img, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, dx, dy, TILE_PX, TILE_PX);

  ctx.drawImage(boardImage(state, sprites), 0, 0);

  const bob = Math.sin(timeMs / 180) * 0.8;
  for (const u of state.powerUps) cell(sprites.powerups, ITEM_COL[u.kind], 0, u.x * TILE_PX, u.y * TILE_PX + bob);

  const bombFrame = [0, 1, 2, 1][Math.floor(timeMs / 150) % 4];

  /** Where (in sprite pixels) and how high above the floor a bomb is drawn. */
  const bombSpot = (b: Bomb) => {
    let x = b.x;
    let y = b.y;
    let z = 0;
    if (b.flight) {
      const t = Math.min(1, b.flight.ticks / b.flight.total);
      // follow the shortest way round the arena so wrapped throws leave one edge and enter the other
      let dx = b.flight.toX - b.x;
      let dy = b.flight.toY - b.y;
      if (Math.abs(dx) > state.width / 2) dx -= Math.sign(dx) * state.width;
      if (Math.abs(dy) > state.height / 2) dy -= Math.sign(dy) * state.height;
      x = wrap(b.x + dx * t, state.width);
      y = wrap(b.y + dy * t, state.height);
      z = Math.sin(t * Math.PI) * 15;
    }
    return { px: x * TILE_PX, py: y * TILE_PX, z };
  };

  const drawBomb = (b: Bomb, px: number, py: number, z: number) => {
    if (z > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.ellipse(px + 8, py + 13, 6 - z * 0.12, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const dy = py - z;
    if (b.power) {
      ctx.fillStyle = `rgba(255,70,40,${0.25 + 0.15 * Math.sin(timeMs / 110)})`;
      ctx.beginPath();
      ctx.arc(px + 8, dy + 9, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(sprites.bomb, bombFrame * TILE_PX, 0, TILE_PX, TILE_PX, Math.round(px - 2), Math.round(dy - 3), 20, 20);
    } else {
      cell(sprites.bomb, bombFrame, 0, Math.round(px), Math.round(dy));
    }
    if (b.remote) {
      ctx.fillStyle = Math.floor(timeMs / 220) % 2 === 0 ? "#ff3b30" : "#ffd2cf";
      ctx.fillRect(Math.round(px) + 11, Math.round(dy) + 3, 2, 2);
    }
  };

  const ambient: AmbientSource[] = [];
  const carried: Bomb[] = [];
  for (const b of state.bombs) {
    if (b.held) {
      carried.push(b);
      continue;
    }
    const spot = bombSpot(b);
    drawBomb(b, spot.px, spot.py, spot.z);
    const cx = spot.px + 8;
    const cy = spot.py + 9 - spot.z;
    if (b.slide) ambient.push({ kind: "slide", x: cx, y: cy, dir: b.slide });
    if (b.flight) ambient.push({ kind: "flight", x: cx, y: cy });
    if (b.power) ambient.push({ kind: "power", x: cx, y: cy });
    if (b.remote && Math.random() < 0.4) ambient.push({ kind: "remote", x: cx, y: cy });
  }

  drawFlames(ctx, state.flames, FLAME_TICKS, timeMs);

  const players = [...state.players].filter((p) => p.alive).sort((a, b) => a.y - b.y);
  for (const p of players) {
    const col = p.moving ? 1 + (Math.floor(timeMs / 120) % 2) : 0;
    const sx = Math.round(p.x * TILE_PX - 8);
    const sy = Math.round(p.y * TILE_PX - 11);

    ctx.save();
    if (p.invuln > 0 && Math.floor(timeMs / 70) % 2 === 0) ctx.globalAlpha = 0.35;
    cell(sprites.bombers[p.color], col, FACE_ROW[p.facing], sx, sy);
    ctx.restore();

    if (p.vest) ambient.push({ kind: "vest", x: sx + 8, y: sy + 9 });
    if (p.invuln > 0) ambient.push({ kind: "invuln", x: sx + 8, y: sy + 9 });
    if (p.disease) ambient.push({ kind: "curse", x: sx + 8, y: sy + 8 });
    if (p.vest) {
      ctx.strokeStyle = `rgba(143,208,255,${0.65 + 0.3 * Math.sin(timeMs / 150)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(sx + 8, sy + 9, 9.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.disease) {
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = Math.floor(timeMs / 160) % 2 === 0 ? "#b36bff" : "#7dff7d";
      ctx.fillText("☠", sx + 8, sy - 2 - Math.abs(Math.sin(timeMs / 200)) * 2);
    }
  }

  // carried bombs ride above the carrier's head
  for (const b of carried) {
    const carrier = state.players.find((p) => p.id === b.held);
    if (!carrier?.alive) continue;
    const x = Math.round(carrier.x * TILE_PX - 8);
    const y = Math.round(carrier.y * TILE_PX - 11) - 11 - Math.abs(Math.sin(timeMs / 140)) * 1.5;
    drawBomb(b, x, y, 0);
  }

  effects?.ambient(ambient);
  effects?.draw(ctx, sprites, state.width * TILE_PX, state.height * TILE_PX);

  ctx.restore();
}
