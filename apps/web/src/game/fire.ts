import { BLAST_DIRS, type Flame } from "@bomberman/engine";
import { TILE_PX } from "./sprites";

/** Fire is painted in 2x2 sprite-pixel cells so it matches the chunky pixel art around it. */
const CELL = 2;
const CELLS = TILE_PX / CELL; // per tile side

/** heat threshold -> colour, hottest first */
const PALETTE: [number, string][] = [
  [0.95, "#fffbe0"],
  [0.75, "#ffe36a"],
  [0.52, "#ffae2a"],
  [0.32, "#ff6a1a"],
  [0.14, "#d02a10"],
  [0.07, "rgba(120,22,10,0.75)"],
];

/** Cheap smooth noise in 0..1 that drifts upward over time; world coordinates keep neighbouring tiles seamless. */
function fireNoise(x: number, y: number, t: number): number {
  return 0.5 + 0.25 * Math.sin(x * 0.45 + t * 6 + Math.sin(y * 0.35 - t * 4)) + 0.25 * Math.sin(y * 0.6 + t * 8 + x * 0.25);
}

/** Cells grouped by colour so each colour is set once per paint. Reused across frames. */
class Buckets {
  private cells: number[][] = PALETTE.map(() => []);

  add(heat: number, x: number, y: number) {
    for (let i = 0; i < PALETTE.length; i++) {
      if (heat > PALETTE[i][0]) {
        this.cells[i].push(x, y);
        return;
      }
    }
  }

  paint(ctx: CanvasRenderingContext2D) {
    this.cells.forEach((list, i) => {
      if (list.length === 0) return;
      ctx.fillStyle = PALETTE[i][1];
      for (let k = 0; k < list.length; k += 2) ctx.fillRect(list[k], list[k + 1], CELL, CELL);
      list.length = 0;
    });
  }
}
const buckets = new Buckets();

/**
 * Distance from each cell centre of a tile to the flame's shape (a core plus one capsule per arm),
 * for every one of the 16 arm combinations. Only depends on geometry, so it is computed once.
 */
const SHAPE_DISTANCE: Float32Array[] = Array.from({ length: 16 }, (_, arms) => {
  const dirs = BLAST_DIRS.filter((d) => arms & d.arm);
  const dist = new Float32Array(CELLS * CELLS);
  for (let iy = 0; iy < CELLS; iy++) {
    for (let ix = 0; ix < CELLS; ix++) {
      const u = (ix - CELLS / 2) * CELL + CELL / 2;
      const v = (iy - CELLS / 2) * CELL + CELL / 2;
      let d = Math.hypot(u, v);
      for (const { dx, dy } of dirs) {
        const along = Math.max(0, Math.min(1, (u * dx + v * dy) / 9));
        d = Math.min(d, Math.hypot(u - dx * 9 * along, v - dy * 9 * along));
      }
      dist[iy * CELLS + ix] = d;
    }
  }
  return dist;
});

const glowCache = new Map<string, HTMLCanvasElement>();

/** A soft radial glow rendered once; draw it scaled with `globalAlpha` instead of building gradients per frame. */
export function glowSprite(kind: "warm" | "hot"): HTMLCanvasElement {
  let canvas = glowCache.get(kind);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const g = canvas.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (kind === "hot") {
      grad.addColorStop(0, "rgba(255,240,200,1)");
      grad.addColorStop(0.35, "rgba(255,150,40,0.7)");
    } else {
      grad.addColorStop(0, "rgba(255,150,50,1)");
    }
    grad.addColorStop(1, "rgba(255,60,10,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(kind, canvas);
  }
  return canvas;
}

/** Additive glow of `radius` px centred on (cx, cy). */
export function drawGlow(ctx: CanvasRenderingContext2D, kind: "warm" | "hot", cx: number, cy: number, radius: number, alpha: number) {
  if (alpha <= 0 || radius <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(glowSprite(kind), cx - radius, cy - radius, radius * 2, radius * 2);
}

/**
 * Blast fire for every flame tile. Each tile grows in, flickers and licks at the edges, burns from
 * white-hot to dark red, then dies back from the edges. `life` = ticksLeft / flameTicks, 1 -> 0.
 */
export function drawFlames(ctx: CanvasRenderingContext2D, flames: Flame[], flameTicks: number, timeMs: number) {
  if (flames.length === 0) return;
  const t = timeMs / 1000;

  // light the floor around the fire
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const f of flames) {
    const life = f.ticksLeft / flameTicks;
    const grow = Math.min(1, (1 - life) / 0.12);
    const cx = f.x * TILE_PX + TILE_PX / 2;
    const cy = f.y * TILE_PX + TILE_PX / 2;
    drawGlow(ctx, "warm", cx, cy, TILE_PX * 1.2 * (0.5 + 0.5 * grow), 0.5 * Math.min(1, life / 0.3));
  }
  ctx.restore();

  for (const f of flames) {
    const life = f.ticksLeft / flameTicks;
    const grow = Math.min(1, (1 - life) / 0.12);
    const shrink = Math.min(1, life / 0.3);
    const halfWidth = 6.8 * (0.55 + 0.45 * grow) * (0.5 + 0.5 * shrink);
    const dying = Math.max(0, 0.55 - life) * 0.9;
    const dist = SHAPE_DISTANCE[f.arms & 15];
    const left = f.x * TILE_PX;
    const top = f.y * TILE_PX;
    for (let i = 0; i < dist.length; i++) {
      const shape = 1 - dist[i] / halfWidth;
      if (shape < -0.6) continue;
      const x = left + (i % CELLS) * CELL;
      const y = top + Math.floor(i / CELLS) * CELL;
      const n = fireNoise(x + CELL / 2, y + CELL / 2, t);
      // the core burns steadily; only the edges lick and flicker
      const edge = 1 - Math.min(1, Math.max(0, shape) * 1.4) * 0.75;
      buckets.add(shape * 1.45 + (n - 0.5) * 0.8 * edge - dying, x, y);
    }
  }
  buckets.paint(ctx);
}

/** A rolling fireball (centre of a blast); `t` runs 0 -> 1 over its life, `radius` is the peak size in px. */
export function drawFireball(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, t: number, timeMs: number) {
  const r = radius * (t < 0.3 ? 0.25 + (t / 0.3) * 0.75 : 1 - ((t - 0.3) / 0.7) * 0.75);
  const reach = Math.ceil((r + 6) / CELL);
  const secs = timeMs / 1000;
  for (let iy = -reach; iy < reach; iy++) {
    for (let ix = -reach; ix < reach; ix++) {
      const u = ix * CELL + CELL / 2;
      const v = iy * CELL + CELL / 2;
      const f = 1 - Math.hypot(u, v * 1.1) / r;
      if (f < -0.6) continue;
      const n = fireNoise(cx + u, cy + v, secs);
      const edge = 1 - Math.min(1, Math.max(0, f) * 1.4) * 0.7;
      buckets.add(f * 1.5 + (n - 0.5) * 0.9 * edge - t * 0.5, Math.round(cx + ix * CELL), Math.round(cy + iy * CELL));
    }
  }
  buckets.paint(ctx);
}
