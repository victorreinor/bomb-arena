import { FLAME_TICKS, TILE, tileAt, wrap, type Bomb, type GameState, type Player } from "@bomberman/engine";
import type { AmbientSource, Effects } from "./effects";
import type { ActionPose } from "./events";
import { drawFlames } from "./fire";
import { ITEM_COL } from "./items";
import { mapInfo } from "./mapInfo";
import { ANCHOR, TILE_PX, drawBomber, drawMount, drawTile, tileName, type BomberFrame, type Sprites } from "./sprites";

export const SCALE = 3;

/** the top of a pet's hop, in sprite pixels */
const JUMP_HEIGHT = 12;
/** a dizzy bomber turns round and round */
const SPIN = ["down", "left", "up", "right"] as const;
const WALK: BomberFrame[] = ["walkA", "idle", "walkB", "idle"];
const CARRY_WALK: BomberFrame[] = ["carryWalkA", "carry", "carryWalkB", "carry"];

const hop = (p: Player) => (p.jump ? Math.sin(Math.min(1, p.jump.ticks / p.jump.total) * Math.PI) * JUMP_HEIGHT : 0);
/** A mount's legs (and its rider) move in two steps. */
const mountStep = (p: Player, timeMs: number) => (p.moving ? Math.floor(timeMs / 120) % 2 : 0);
/** The top of a bomber's sprite, `z` off the ground: standing, or sitting on its mount (bobbing with its `step`). */
const bomberTop = (p: Player, z: number, step: number) => p.y * TILE_PX - z - (p.pet ? ANCHOR.rideTop + step : ANCHOR.standTop);

/** What the bomber is doing, as a frame: dizzy and riding win, then carrying, a passing action, walking. */
function bomberFrame(p: Player, pose: ActionPose | null, timeMs: number): BomberFrame {
  if (p.stunned > 0) return "dizzy";
  if (p.pet) return "ride";
  const walk = Math.floor(timeMs / 110) % 4;
  if (p.holding !== null) return p.moving ? CARRY_WALK[walk] : "carry";
  if (pose) return pose;
  return p.moving ? WALK[walk] : "idle";
}

export function canvasSize(state: GameState) {
  return { width: state.width * TILE_PX * SCALE, height: state.height * TILE_PX * SCALE };
}

/** The floor and blocks only change when a soft block burns, so they are drawn once into an offscreen canvas. */
const board = {
  canvas: null as HTMLCanvasElement | null,
  tiles: [] as number[],
  /** the array last drawn: snapshots reuse it while the board doesn't change, so this usually short-circuits */
  source: null as readonly number[] | null,
  /** the map's tile sheet it was drawn with */
  sheet: null as HTMLImageElement | null,
};

function boardImage(state: GameState, sprites: Sprites): HTMLCanvasElement {
  const sheet = sprites.tiles[mapInfo(state.mapId).theme];
  const unchanged =
    board.canvas &&
    board.sheet === sheet &&
    (board.source === state.tiles ||
      (board.tiles.length === state.tiles.length && state.tiles.every((t, i) => t === board.tiles[i])));
  board.source = state.tiles;
  if (unchanged) return board.canvas!;

  const canvas = board.canvas ?? document.createElement("canvas");
  canvas.width = state.width * TILE_PX;
  canvas.height = state.height * TILE_PX;
  const g = canvas.getContext("2d")!;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const t = tileAt(state, x, y);
      const kind = t === TILE.HARD ? "hard" : t === TILE.SOFT ? "soft" : "floor";
      drawTile(g, sheet, tileName(kind, tileAt(state, x, y - 1) !== TILE.EMPTY, x, y), x, y);
    }
  }
  board.canvas = canvas;
  board.tiles = [...state.tiles];
  board.sheet = sheet;
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

  const cell = (img: HTMLImageElement, col: number, dx: number, dy: number) =>
    ctx.drawImage(img, col * TILE_PX, 0, TILE_PX, TILE_PX, dx, dy, TILE_PX, TILE_PX);

  ctx.drawImage(boardImage(state, sprites), 0, 0);

  const bob = Math.sin(timeMs / 180) * 0.8;
  for (const u of state.powerUps) cell(sprites.powerups, ITEM_COL[u.kind], u.x * TILE_PX, u.y * TILE_PX + bob);

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
      z = Math.sin(t * Math.PI) * Math.min(15, 5 + (Math.abs(dx) + Math.abs(dy)) * 3.5); // a bounce is a small hop
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
      cell(sprites.bomb, bombFrame, Math.round(px), Math.round(dy));
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
    const z = hop(p);
    const step = mountStep(p, timeMs);
    const sx = Math.round(p.x * TILE_PX - 8);
    const sy = Math.round(bomberTop(p, z, step));
    const facing = p.stunned > 0 ? SPIN[Math.floor(timeMs / 90) % 4] : p.facing;

    if (z > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(p.x * TILE_PX, p.y * TILE_PX + 5, 6 - z * 0.15, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    if (p.invuln > 0 && Math.floor(timeMs / 70) % 2 === 0) ctx.globalAlpha = 0.35;
    // a rider sits between its mount's body and its head
    const mx = p.x * TILE_PX - ANCHOR.mountLeft;
    const my = p.y * TILE_PX - ANCHOR.mountTop - z;
    if (p.pet) drawMount(ctx, sprites.pets, p.pet.kind, facing, step, "body", mx, my);
    drawBomber(ctx, sprites.bombers[p.color], bomberFrame(p, effects?.poseOf(p.id) ?? null, timeMs), facing, sx, sy);
    if (p.pet) drawMount(ctx, sprites.pets, p.pet.kind, facing, step, "head", mx, my);
    ctx.restore();

    if (p.stunned > 0) {
      // three little stars circling the head
      for (let k = 0; k < 3; k++) {
        const a = timeMs / 160 + (k * Math.PI * 2) / 3;
        const x = Math.round(sx + 8 + Math.cos(a) * 7);
        const y = Math.round(sy - 1 + Math.sin(a) * 2.5);
        ctx.fillStyle = "#ffd23a";
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 3);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, 1, 1);
      }
    }

    if (p.pet && p.pet.dashTicks > 0) ambient.push({ kind: "dash", x: p.x * TILE_PX, y: p.y * TILE_PX + 4, dir: p.facing });

    // the bubble and its sparkles wrap the whole bomber, head to boots
    if (p.vest) ambient.push({ kind: "vest", x: sx + 8, y: sy + 13 });
    if (p.invuln > 0) ambient.push({ kind: "invuln", x: sx + 8, y: sy + 13 });
    if (p.disease) ambient.push({ kind: "curse", x: sx + 8, y: sy + 10 });
    if (p.vest) {
      ctx.strokeStyle = `rgba(143,208,255,${0.65 + 0.3 * Math.sin(timeMs / 150)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(sx + 8, sy + 13, 10, 13, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.disease) {
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = Math.floor(timeMs / 160) % 2 === 0 ? "#b36bff" : "#7dff7d";
      ctx.fillText("☠", sx + 8, sy - 2 - Math.abs(Math.sin(timeMs / 200)) * 2);
    }
  }

  // revenge ghosts float on the outer wall, see-through, facing the arena
  for (const p of state.players) {
    if (p.alive || !p.ghost) continue;
    const bob = Math.sin(timeMs / 260 + p.color) * 1.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(150,90,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(p.x * TILE_PX, p.y * TILE_PX - 6 + bob, 10, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.7;
    drawBomber(ctx, sprites.bombers[p.color], "idle", p.facing, p.x * TILE_PX - 8, p.y * TILE_PX - ANCHOR.standTop + 1 + bob);
    ctx.restore();
    ambient.push({ kind: "curse", x: p.x * TILE_PX, y: p.y * TILE_PX + 4 });
  }

  // carried bombs ride above the carrier's head
  for (const b of carried) {
    const carrier = state.players.find((p) => p.id === b.held);
    if (!carrier?.alive) continue;
    const x = Math.round(carrier.x * TILE_PX - 8);
    const y = Math.round(bomberTop(carrier, hop(carrier), mountStep(carrier, timeMs))) - 9 - Math.abs(Math.sin(timeMs / 140)) * 1.5;
    drawBomb(b, x, y, 0);
  }

  effects?.ambient(ambient);
  effects?.draw(ctx, sprites, state.width * TILE_PX, state.height * TILE_PX);

  ctx.restore();
}
