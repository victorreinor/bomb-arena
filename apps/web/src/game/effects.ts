import { DIR_VEC, type Dir, type PetKind, type PowerUpKind } from "@bomb-arena/engine";
import { COLOR_CSS } from "./colors";
import type { ActionPose, GameEvent } from "./events";
import { drawFireball, drawGlow } from "./fire";
import { ITEM_INFO, PET_INFO } from "./items";
import { settings } from "./settings";
import { ANCHOR, THEME_COLORS, TILE_PX as T, drawBomber, drawMount, type Sprites, type TileTheme } from "./sprites";

/** All positions and sizes below are in sprite pixels (one tile = T). */
const MAX_PARTICLES = 500;

type ParticleKind = "spark" | "smoke" | "debris";

interface Timed {
  age: number;
  life: number;
}

interface Particle extends Timed {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
}

type ParticleSpec = Pick<Particle, "kind" | "x" | "y" | "life" | "size" | "color"> &
  Partial<Pick<Particle, "vx" | "vy" | "gravity" | "drag">>;

/** A glow or a fireball: something round that grows and fades at (x, y). */
interface Blob extends Timed {
  x: number;
  y: number;
  radius: number;
}

interface Ring extends Blob {
  color: string;
}

interface Death extends Timed {
  x: number;
  y: number;
  color: number;
}

/** A lost mount bolting away from its rider. */
interface Runaway extends Timed {
  x: number;
  y: number;
  kind: PetKind;
  dir: Dir;
}

const DEATH_BLINK_S = 0.4;
const DEATH_TOTAL_S = 1.3;
/** how long a bomber holds each action pose, in ms */
const POSE_MS: Record<ActionPose, number> = { kick: 220, punch: 220, throw: 260, place: 180 };

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <V>(list: readonly V[]) => list[Math.floor(Math.random() * list.length)];
const SPARK_COLORS = ["#ffffff", "#fff3a8", "#ffd23a", "#ff9a1e", "#ff5a1a"];


/** Ages every entry by `dt` and drops the expired ones, in place. */
function prune<V extends Timed>(list: V[], dt: number) {
  let kept = 0;
  for (const item of list) {
    item.age += dt;
    if (item.age < item.life) list[kept++] = item;
  }
  list.length = kept;
}

/** Something that should shed particles every frame while it exists (in sprite pixels). */
export interface AmbientSource {
  kind: "slide" | "flight" | "power" | "remote" | "vest" | "invuln" | "curse" | "dash";
  x: number;
  y: number;
  /** direction of travel for sliding bombs */
  dir?: Dir;
}

const AMBIENT_RATE: Record<AmbientSource["kind"], number> = {
  slide: 70,
  flight: 90,
  power: 22,
  remote: 5,
  vest: 24,
  invuln: 50,
  curse: 16,
  dash: 60,
};

interface BurstOptions {
  kind?: ParticleKind;
  speed?: [number, number];
  life?: [number, number];
  size?: [number, number];
  gravity?: number;
  drag?: number;
  /** added to every particle's velocity */
  bias?: { x: number; y: number };
  /** random spread of the starting position */
  jitter?: number;
}

/**
 * Purely visual: explosions, smoke, debris, screen shake and death animations.
 * Fed with the same game events that drive the sounds; the game rules never read it.
 */
export class Effects {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private glows: Blob[] = [];
  private fireballs: Blob[] = [];
  private deaths: Death[] = [];
  private runaways: Runaway[] = [];
  /** action poses by player id, until (in update() time) */
  private poses = new Map<string, { pose: ActionPose; until: number }>();
  private shake = 0;
  private flash = 0;
  /** the map's look, for the colour of debris */
  private theme: TileTheme = "garden";
  private lastNow = 0;
  private dt = 0;

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.glows.length = 0;
    this.fireballs.length = 0;
    this.deaths.length = 0;
    this.runaways.length = 0;
    this.poses.clear();
    this.shake = 0;
    this.flash = 0;
  }

  /** The pose this bomber is caught in right now, if any (kicking, punching, throwing, laying a bomb). */
  poseOf(id: string): ActionPose | null {
    const pose = this.poses.get(id);
    return pose && pose.until > this.lastNow ? pose.pose : null;
  }

  spawn(events: GameEvent[], theme: TileTheme) {
    this.theme = theme;
    for (const e of events) {
      switch (e.type) {
        case "explosion":
          this.explosion(e);
          break;
        case "death":
          this.death(e.x, e.y, e.color);
          break;
        case "pickup":
          this.pickup(e.x, e.y, e.kind);
          break;
        case "bombPlaced":
          for (const b of e.bombs) this.placed(b.x, b.y, b.power, b.remote);
          break;
        case "kick":
          this.kick(e.x, e.y, e.dir);
          break;
        case "bounce":
          this.bounce(e.x, e.y, e.dir);
          break;
        case "throw":
          this.thrown(e.x, e.y);
          break;
        case "land":
          this.land(e.x, e.y, e.power);
          break;
        case "lift":
          this.lift(e.x, e.y);
          break;
        case "shield":
          this.shield(e.x, e.y);
          break;
        case "infected":
          this.infected(e.x, e.y);
          break;
        case "itemDrop":
          this.itemDrop(e.x, e.y, e.kind);
          break;
        case "mount":
          this.mount(e.x, e.y, e.pet);
          break;
        case "petLost":
          this.petLost(e.x, e.y, e.pet, e.facing);
          break;
        case "petPower":
          this.petPower(e.x, e.y, e.pet, e.dir);
          break;
        case "petLand":
          this.petLand(e.x, e.y);
          break;
        case "stun":
          this.stun(e.x, e.y);
          break;
        case "pose":
          this.poses.set(e.id, { pose: e.pose, until: this.lastNow + POSE_MS[e.pose] });
          break;
        case "haunt":
          this.haunt(e.x, e.y);
          break;
        case "blockFall":
          for (const c of e.cells) this.blockFall(c.x, c.y);
          break;
        case "hurry":
          this.jolt(1, 0.25);
          break;
        case "warp":
          this.warp(e.from.x, e.from.y);
          this.warp(e.to.x, e.to.y);
          break;
        case "cratePush":
          this.cratePush(e.x, e.y, e.dir);
          break;
        case "eruption":
          for (const c of e.cells) this.erupt(c.x, c.y);
          this.jolt(1.6);
          break;
      }
    }
  }

  // ------------------------------------------------------------ building blocks

  private add(p: ParticleSpec) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({
      kind: p.kind,
      x: p.x,
      y: p.y,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      age: 0,
      life: p.life,
      size: p.size,
      color: p.color,
      gravity: p.gravity ?? 0,
      drag: p.drag ?? 0,
    });
  }

  /** Radial burst of particles. */
  private burst(cx: number, cy: number, count: number, colors: readonly string[], o: BurstOptions = {}) {
    const [smin, smax] = o.speed ?? [30, 90];
    const [lmin, lmax] = o.life ?? [0.3, 0.7];
    const [zmin, zmax] = o.size ?? [1, 2];
    const jitter = o.jitter ?? 0;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const speed = rand(smin, smax);
      this.add({
        kind: o.kind ?? "spark",
        x: cx + rand(-jitter, jitter),
        y: cy + rand(-jitter, jitter),
        vx: Math.cos(a) * speed + (o.bias?.x ?? 0),
        vy: Math.sin(a) * speed + (o.bias?.y ?? 0),
        life: rand(lmin, lmax),
        size: rand(zmin, zmax),
        color: pick(colors),
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 2,
      });
    }
  }

  private puffs(cx: number, cy: number, count: number, color: string, spread = 14, rise = 14) {
    for (let i = 0; i < count; i++) {
      this.add({
        kind: "smoke",
        x: cx + rand(-3, 3),
        y: cy + rand(-2, 2),
        vx: rand(-spread, spread),
        vy: rand(-rise, -2),
        life: rand(0.35, 0.8),
        size: rand(2, 4),
        color,
        drag: 1.4,
      });
    }
  }

  /** Bits of brick or stone thrown up and falling back down. */
  private debris(cx: number, cy: number, count: number, colors: readonly string[], o: { speed?: [number, number]; lift?: number; life?: [number, number]; size?: [number, number]; gravity?: number } = {}) {
    this.burst(cx, cy, count, colors, {
      kind: "debris",
      jitter: 4,
      speed: o.speed ?? [20, 50],
      bias: { x: 0, y: -(o.lift ?? 40) },
      life: o.life ?? [0.3, 0.6],
      size: o.size ?? [1.2, 2],
      gravity: o.gravity ?? 240,
      drag: 0.6,
    });
  }

  /** Something heavy hitting the floor: a dusty ring and a puff cloud. */
  private thump(cx: number, cy: number, radius: number, puffs: number) {
    this.ring(cx, cy, 0.32, radius, "#d8cfb4");
    this.puffs(cx, cy, puffs, "#8a8274", 24, 7);
  }

  private ring(x: number, y: number, life: number, radius: number, color: string) {
    this.rings.push({ x, y, age: 0, life, radius, color });
  }

  private glow(x: number, y: number, life: number, radius: number) {
    this.glows.push({ x, y, age: 0, life, radius });
  }

  /** Screen shake (and optionally a white flash); the strongest recent hit wins. */
  private jolt(shake: number, flash = 0) {
    if (settings.reduceMotion) return; // particles stay, the screen holds still
    this.shake = Math.max(this.shake, shake);
    this.flash = Math.max(this.flash, flash);
  }

  // ------------------------------------------------------------------ events

  private explosion(e: Extract<GameEvent, { type: "explosion" }>) {
    for (const b of e.bombs) {
      const cx = (b.x + 0.5) * T;
      const cy = (b.y + 0.5) * T;
      this.glow(cx, cy, 0.5, T * 2.4);
      this.fireballs.push({ x: cx, y: cy, age: 0, life: 0.6, radius: b.range >= 6 ? 17 : 13 });
      this.ring(cx, cy, 0.38, (b.range + 0.6) * T, "#ffc070");
      this.ring(cx, cy, 0.26, (b.range + 0.2) * T * 0.7, "#ff8a2a");
      this.burst(cx, cy, 22, SPARK_COLORS, { speed: [30, 130], life: [0.3, 0.8], size: [1, 2.2], drag: 2.2 });
    }

    for (const f of e.flames) {
      const cx = (f.x + 0.5) * T;
      const cy = (f.y + 0.5) * T;
      this.glow(cx, cy, 0.35, T * 1.1);
      for (let i = 0; i < 2; i++) {
        this.add({
          kind: "spark",
          x: cx + rand(-5, 5),
          y: cy + rand(-5, 5),
          vx: rand(-40, 40),
          vy: rand(-70, -10),
          life: rand(0.3, 0.7),
          size: rand(1, 1.8),
          color: pick(SPARK_COLORS.slice(1)),
          drag: 1.5,
        });
      }
      if (Math.random() < 0.7) {
        this.add({
          kind: "smoke",
          x: cx + rand(-4, 4),
          y: cy + rand(-4, 4),
          vx: rand(-6, 6),
          vy: rand(-22, -8),
          life: rand(0.8, 1.4),
          size: rand(4, 7),
          color: "#2b2b36",
          drag: 0.8,
        });
      }
    }

    for (const b of e.blocks) {
      this.debris((b.x + 0.5) * T, (b.y + 0.5) * T, 9, THEME_COLORS[this.theme].brick, { speed: [25, 90], life: [0.5, 1], size: [1.5, 3], gravity: 220 });
    }

    const size = Math.min(1, e.flames.length / 14);
    this.jolt(2.2 + size * 2.6, 0.16 + size * 0.14); // enough flash to feel it, not enough to hide the fire
  }

  private death(x: number, y: number, color: number) {
    const cx = x * T;
    const cy = y * T - 2;
    this.deaths.push({ x: cx, y: cy, color, age: 0, life: DEATH_TOTAL_S });
    this.glow(cx, cy, 0.45, T * 1.8);
    this.ring(cx, cy, 0.5, T * 2.2, "#ffffff");
    const palette = [COLOR_CSS[color] ?? "#ffffff", "#ffffff", "#ffd23a", "#ff7a1a"];
    this.burst(cx, cy, 34, palette, { speed: [30, 150], life: [0.5, 1.1], size: [1.3, 2.6], gravity: 90, drag: 1.4, bias: { x: 0, y: -30 } });
    this.jolt(4, 0.4);
  }

  private pickup(x: number, y: number, kind: PowerUpKind) {
    const cx = x * T;
    const cy = y * T - 2;
    const { color } = ITEM_INFO[kind];
    this.ring(cx, cy, 0.4, T * 1.5, color);
    this.glow(cx, cy, 0.35, T * 1.3);
    this.burst(cx, cy, 20, [color, "#ffffff", color], { speed: [25, 85], life: [0.4, 0.8], size: [1.2, 2.2], gravity: -40, drag: 2.2 });
    this.jolt(0.8);
  }

  private placed(tx: number, ty: number, power: boolean, remote: boolean) {
    const cx = (tx + 0.5) * T;
    const cy = (ty + 0.5) * T + 3;
    this.puffs(cx, cy + 3, 4, "#8a8a99", 16, 6);
    this.ring(cx, cy, 0.25, power ? T * 1.8 : T * 0.9, power ? "#ff6a4a" : "#cfcfdc");
    this.burst(cx, cy, power ? 14 : 5, power ? ["#ff3b30", "#ff9a1e", "#ffd23a"] : ["#ffffff", "#cfcfdc"], { speed: [20, 55], life: [0.2, 0.45], size: [1, 1.8] });
    if (remote) this.burst(cx, cy - 4, 4, ["#ff3b30", "#ffd2cf"], { speed: [15, 35], life: [0.2, 0.4] });
    if (power) this.jolt(1.2);
  }

  private kick(tx: number, ty: number, dir: Dir) {
    const cx = (tx + 0.5) * T;
    const cy = (ty + 0.5) * T;
    const v = DIR_VEC[dir];
    this.ring(cx - v.dx * 6, cy - v.dy * 6, 0.25, T * 1.2, "#ffe0a0");
    this.glow(cx, cy, 0.2, T * 1.1);
    this.burst(cx - v.dx * 6, cy - v.dy * 6, 12, ["#ffffff", "#ffd23a", "#ff9a1e"], { speed: [30, 90], life: [0.2, 0.5], bias: { x: -v.dx * 40, y: -v.dy * 40 } });
    this.puffs(cx - v.dx * 7, cy - v.dy * 7 + 3, 5, "#8a8a99", 14, 8);
    this.jolt(1.4);
  }

  /** A sparkle where something went into or came out of a portal (centre in tiles). */
  private warp(x: number, y: number) {
    const cx = x * T;
    const cy = y * T;
    this.ring(cx, cy, 0.3, T * 1.1, "#c8f4ff");
    this.burst(cx, cy, 12, ["#ffffff", "#5ff0ff", "#ff5fd2"], { speed: [20, 60], life: [0.2, 0.45], gravity: -40 });
  }

  /** Dust kicked up behind a crate shoved onto (tx, ty). */
  private cratePush(tx: number, ty: number, dir: Dir) {
    const v = DIR_VEC[dir];
    this.puffs((tx + 0.5 - v.dx * 0.9) * T, (ty + 0.5 - v.dy * 0.9) * T + 4, 4, "#b8a68a", 10, 6);
  }

  /** Lava spurting out of the vent at (tx, ty). */
  private erupt(tx: number, ty: number) {
    const cx = (tx + 0.5) * T;
    const cy = (ty + 0.5) * T;
    this.glow(cx, cy, 0.5, T * 1.4);
    this.burst(cx, cy, 14, ["#ffd23a", "#ff7a1a", "#ff3b1a"], { speed: [40, 110], life: [0.3, 0.7], gravity: 160 });
    this.puffs(cx, cy - 4, 3, "#4a3a3a", 12, 18);
  }

  /** A rubber bomb springing back off the side it hit (the far side from where it now heads). */
  private bounce(tx: number, ty: number, dir: Dir) {
    const v = DIR_VEC[dir];
    const cx = (tx + 0.5) * T - v.dx * 7;
    const cy = (ty + 0.5) * T - v.dy * 7;
    this.ring(cx, cy, 0.22, T * 0.9, ITEM_INFO.rubber.color);
    this.burst(cx, cy, 8, ["#ffffff", ITEM_INFO.rubber.color], { speed: [25, 70], life: [0.15, 0.35], bias: { x: v.dx * 50, y: v.dy * 50 } });
  }

  private thrown(tx: number, ty: number) {
    const cx = (tx + 0.5) * T;
    const cy = (ty + 0.5) * T;
    this.ring(cx, cy, 0.3, T * 1.6, "#fff0c8");
    this.glow(cx, cy, 0.25, T * 1.3);
    this.burst(cx, cy, 14, ["#ffffff", "#ffe08a", "#ff9a1e"], { speed: [35, 100], life: [0.25, 0.55] });
    this.puffs(cx, cy + 4, 6, "#9a9aa8", 18, 10);
    this.jolt(1.8);
  }

  private land(tx: number, ty: number, power: boolean) {
    const cx = (tx + 0.5) * T;
    const cy = (ty + 0.5) * T + 4;
    this.thump(cx, cy, power ? T * 2.4 : T * 1.5, power ? 14 : 9);
    this.debris(cx, cy, 8, ["#9a9486"], { speed: [20, 45], lift: 55, life: [0.35, 0.7], size: [1.2, 2.2], gravity: 260 });
    this.jolt(power ? 3.2 : 2);
  }

  private lift(tx: number, ty: number) {
    const cx = (tx + 0.5) * T;
    const cy = (ty + 0.5) * T;
    this.ring(cx, cy, 0.3, T * 1.2, "#ffe14a");
    this.burst(cx, cy, 10, ["#ffe14a", "#ffffff"], { speed: [25, 65], life: [0.25, 0.5], gravity: -30 });
    this.puffs(cx, cy + 4, 3, "#9a9aa8", 14, 6);
  }

  private itemDrop(tx: number, ty: number, kind: PowerUpKind) {
    const cx = (tx + 0.5) * T;
    const cy = (ty + 0.5) * T;
    const { color } = ITEM_INFO[kind];
    this.glow(cx, cy, 0.4, T * 1.2);
    this.ring(cx, cy, 0.35, T * 1.1, color);
    this.burst(cx, cy, 10, [color, "#ffffff"], { speed: [15, 50], life: [0.4, 0.8], gravity: -25, size: [1, 1.8] });
  }

  private shield(x: number, y: number) {
    const cx = x * T;
    const cy = y * T - 2;
    this.ring(cx, cy, 0.5, T * 2.1, "#8fd0ff");
    this.ring(cx, cy, 0.32, T * 1.3, "#ffffff");
    this.glow(cx, cy, 0.35, T * 1.5);
    this.burst(cx, cy, 26, ["#8fd0ff", "#ffffff", "#3f7bff"], { speed: [40, 120], life: [0.35, 0.75], size: [1.2, 2.2] });
    this.jolt(2.2, 0.15);
  }

  private infected(x: number, y: number) {
    const cx = x * T;
    const cy = y * T - 4;
    this.ring(cx, cy, 0.5, T * 1.8, "#b36bff");
    this.glow(cx, cy, 0.4, T * 1.4);
    this.puffs(cx, cy, 14, "#6b2a9a", 22, 24);
    this.puffs(cx, cy, 8, "#2f7a3a", 22, 24);
    this.burst(cx, cy, 14, ["#b36bff", "#7dff7d", "#ffffff"], { speed: [25, 80], life: [0.4, 0.9], gravity: -20 });
    this.jolt(1.6);
  }

  private mount(x: number, y: number, pet: PetKind) {
    const cx = x * T;
    const cy = y * T;
    const { color } = PET_INFO[pet];
    this.ring(cx, cy, 0.45, T * 1.7, color);
    this.glow(cx, cy, 0.35, T * 1.4);
    this.burst(cx, cy, 22, [color, "#ffffff", "#ffe14a"], { speed: [25, 80], life: [0.4, 0.9], size: [1.2, 2.2], gravity: -40 });
    this.puffs(cx, cy + 5, 6, "#9a9aa8", 18, 8);
    this.jolt(1);
  }

  private petLost(x: number, y: number, pet: PetKind, facing: Dir) {
    const cx = x * T;
    const cy = y * T;
    // it bolts away from where the rider was heading, sideways when that is up or down
    const dir: Dir = facing === "left" ? "right" : facing === "right" ? "left" : Math.random() < 0.5 ? "left" : "right";
    this.runaways.push({ x: cx, y: cy, kind: pet, dir, age: 0, life: 0.9 });
    this.ring(cx, cy, 0.4, T * 1.6, "#ffffff");
    this.puffs(cx, cy, 10, "#b8b8c8", 22, 14);
    this.burst(cx, cy, 14, [PET_INFO[pet].color, "#ffffff"], { speed: [30, 90], life: [0.3, 0.6] });
    this.jolt(2.2, 0.1);
  }

  private petPower(x: number, y: number, pet: PetKind, dir: Dir) {
    const cx = x * T;
    const cy = y * T;
    const v = DIR_VEC[dir];
    const { color } = PET_INFO[pet];
    switch (pet) {
      case "runner":
        this.ring(cx - v.dx * 6, cy - v.dy * 6, 0.3, T * 1.3, color);
        this.puffs(cx - v.dx * 8, cy - v.dy * 8 + 4, 8, "#9a9aa8", 16, 8);
        this.burst(cx, cy, 10, [color, "#ffffff"], { speed: [30, 70], life: [0.2, 0.4], bias: { x: -v.dx * 60, y: -v.dy * 60 } });
        this.jolt(1.2);
        break;
      case "jumper":
        this.ring(cx, cy + 4, 0.3, T * 1.4, color);
        this.puffs(cx, cy + 5, 8, "#9a9aa8", 20, 6);
        break;
      case "pusher": {
        // dust and grit where the brick scraped into its new place
        const bx = (Math.floor(x) + v.dx * 2 + 0.5) * T;
        const by = (Math.floor(y) + v.dy * 2 + 0.5) * T;
        this.puffs(bx - v.dx * 8, by - v.dy * 8 + 4, 9, "#a08a6a", 18, 10);
        this.debris(bx - v.dx * 8, by - v.dy * 8, 8, THEME_COLORS[this.theme].brick, { lift: 30, gravity: 200 });
        this.jolt(1.6);
        break;
      }
      case "kicker":
        this.ring(cx + v.dx * 10, cy + v.dy * 10, 0.3, T * 1.4, color);
        this.burst(cx + v.dx * 8, cy + v.dy * 8, 12, [color, "#ffffff", "#ffd23a"], { speed: [40, 110], life: [0.2, 0.45], bias: { x: v.dx * 50, y: v.dy * 50 } });
        this.jolt(1.8);
        break;
    }
  }

  private blockFall(tx: number, ty: number) {
    const cx = (tx + 0.5) * T;
    const cy = (ty + 0.5) * T;
    this.ring(cx, cy + 4, 0.3, T * 1.2, "#c8c8d8");
    this.puffs(cx, cy + 6, 6, "#8a8a99", 20, 6);
    this.debris(cx, cy + 4, 6, THEME_COLORS[this.theme].block);
    this.jolt(1.6);
  }

  private haunt(x: number, y: number) {
    const cx = x * T;
    const cy = y * T;
    this.ring(cx, cy, 0.6, T * 1.8, "#b36bff");
    this.puffs(cx, cy, 14, "#6b2a9a", 18, 20);
    this.burst(cx, cy, 12, ["#b36bff", "#ffffff"], { speed: [20, 60], life: [0.4, 0.9], gravity: -30 });
  }

  private petLand(x: number, y: number) {
    this.thump(x * T, y * T + 5, T * 1.3, 8);
    this.jolt(1.2);
  }

  /** a bomb bounced off this head: a spray of stars */
  private stun(x: number, y: number) {
    this.burst(x * T, y * T - 12, 10, ["#ffd23a", "#ffffff"], { speed: [30, 70], life: [0.25, 0.5], gravity: 60 });
    this.jolt(0.8);
  }

  /** Continuous particles for things that are moving or glowing right now (call every rendered frame). */
  ambient(sources: AmbientSource[]) {
    if (this.dt === 0) return;
    for (const src of sources) {
      const n = AMBIENT_RATE[src.kind] * this.dt;
      const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        switch (src.kind) {
          case "slide": {
            const v = DIR_VEC[src.dir ?? "right"];
            if (Math.random() < 0.5) this.puffs(src.x - v.dx * 6, src.y - v.dy * 6 + 5, 1, "#8a8a99", 8, 5);
            else this.add({ kind: "spark", x: src.x - v.dx * 6, y: src.y - v.dy * 6, vx: -v.dx * rand(20, 60) + rand(-15, 15), vy: -v.dy * rand(20, 60) + rand(-15, 15), life: rand(0.15, 0.35), size: rand(1, 1.8), color: pick(["#ffd23a", "#ff9a1e"]), drag: 2 });
            break;
          }
          case "flight":
            this.add({ kind: "spark", x: src.x + rand(-3, 3), y: src.y + rand(-3, 3), vx: rand(-20, 20), vy: rand(-15, 25), life: rand(0.2, 0.45), size: rand(1, 2), color: pick(["#ffffff", "#ffe08a", "#ff9a1e"]), gravity: 50, drag: 1.5 });
            break;
          case "power":
            this.add({ kind: "spark", x: src.x + rand(-6, 6), y: src.y + rand(-2, 4), vx: rand(-6, 6), vy: rand(-45, -15), life: rand(0.3, 0.6), size: rand(1, 1.8), color: pick(["#ff3b30", "#ff9a1e", "#ffd23a"]), drag: 1.2 });
            break;
          case "remote":
            this.add({ kind: "spark", x: src.x + 4, y: src.y - 5, vx: rand(-10, 10), vy: rand(-25, -8), life: rand(0.2, 0.4), size: 1.3, color: "#ff3b30", drag: 1.5 });
            break;
          case "vest": {
            const a = rand(0, Math.PI * 2);
            this.add({ kind: "spark", x: src.x + Math.cos(a) * 10, y: src.y + Math.sin(a) * 10, vx: Math.cos(a + 1.6) * 12, vy: Math.sin(a + 1.6) * 12 - 10, life: rand(0.3, 0.6), size: rand(1, 1.6), color: pick(["#8fd0ff", "#ffffff"]), drag: 1 });
            break;
          }
          case "invuln":
            this.add({ kind: "spark", x: src.x + rand(-7, 7), y: src.y + rand(-9, 7), vx: rand(-10, 10), vy: rand(-30, -5), life: rand(0.2, 0.45), size: rand(1, 1.8), color: pick(["#ffffff", "#ffe14a"]), drag: 1.2 });
            break;
          case "curse":
            this.puffs(src.x + rand(-4, 4), src.y - 8, 1, pick(["#6b2a9a", "#2f7a3a"]), 6, 20);
            break;
          case "dash": {
            const v = DIR_VEC[src.dir ?? "right"];
            if (Math.random() < 0.6) this.puffs(src.x - v.dx * 7, src.y - v.dy * 7, 1, "#9a9aa8", 10, 6);
            else this.add({ kind: "spark", x: src.x - v.dx * 6 + rand(-3, 3), y: src.y - v.dy * 6 - 4 + rand(-3, 3), vx: -v.dx * rand(40, 90), vy: -v.dy * rand(40, 90), life: rand(0.15, 0.3), size: rand(1, 1.6), color: pick(["#ffffff", "#d8f8d8"]), drag: 2 });
            break;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------- simulation

  /** Advances the simulation to `now` (ms). Call once per rendered frame. */
  update(now: number) {
    const dt = this.lastNow ? Math.min((now - this.lastNow) / 1000, 0.05) : 0;
    this.lastNow = now;
    this.dt = dt;

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
    }
    prune(this.particles, dt);
    prune(this.rings, dt);
    prune(this.glows, dt);
    prune(this.fireballs, dt);
    prune(this.deaths, dt);
    prune(this.runaways, dt);

    this.shake *= Math.exp(-9 * dt);
    if (this.shake < 0.05) this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 2.4);
  }

  shakeOffset(): { x: number; y: number } | null {
    if (this.shake === 0) return null;
    return { x: rand(-1, 1) * this.shake, y: rand(-1, 1) * this.shake };
  }

  /** Draws everything that goes on top of the board (call inside the scaled context). */
  draw(ctx: CanvasRenderingContext2D, sprites: Sprites, width: number, height: number) {
    // fire glow and shockwaves add light instead of covering what is below
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const g of this.glows) {
      const t = g.age / g.life;
      drawGlow(ctx, "hot", g.x, g.y, g.radius * (0.55 + 0.6 * Math.sqrt(t)), (1 - t) * 0.85);
    }
    for (const r of this.rings) {
      const t = r.age / r.life;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 * (1 - t) + 0.6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * (1 - (1 - t) ** 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    for (const f of this.fireballs) drawFireball(ctx, f.x, f.y, f.radius, f.age / f.life, this.lastNow);

    ctx.save();
    for (const p of this.particles) {
      if (p.kind !== "smoke") continue;
      const t = p.age / p.life;
      ctx.globalAlpha = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - t) * 0.5;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.7 + t * 1.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // sparks add light (stretched along their motion); debris is solid
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      if (p.kind !== "spark") continue;
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      const len = Math.min(5, Math.hypot(p.vx, p.vy) * 0.05);
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size + Math.abs(p.vx) * 0.02 * len, p.size + Math.abs(p.vy) * 0.02 * len);
    }
    ctx.restore();

    ctx.save();
    for (const p of this.particles) {
      if (p.kind !== "debris") continue;
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.restore();

    for (const d of this.deaths) this.drawDeath(ctx, sprites, d);
    for (const r of this.runaways) this.drawRunaway(ctx, sprites, r);

    if (this.flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, this.flash);
      ctx.fillStyle = "#fff4d6";
      ctx.fillRect(-16, -16, width + 32, height + 32);
      ctx.restore();
    }
  }

  /** The lost mount hops away in a hurry, blinking and fading. */
  private drawRunaway(ctx: CanvasRenderingContext2D, sprites: Sprites, r: Runaway) {
    const t = r.age / r.life;
    const v = DIR_VEC[r.dir];
    ctx.save();
    ctx.globalAlpha = (1 - t) * (Math.floor(r.age / 0.06) % 2 === 0 ? 1 : 0.6);
    const x = r.x + v.dx * 46 * t - ANCHOR.mountLeft;
    const y = r.y - ANCHOR.mountTop - Math.abs(Math.sin(t * Math.PI * 3)) * 6;
    const step = Math.floor(r.age / 0.08) % 2;
    drawMount(ctx, sprites.pets, r.kind, r.dir, step, "body", x, y);
    drawMount(ctx, sprites.pets, r.kind, r.dir, step, "head", x, y);
    ctx.restore();
  }

  /** The bomber blinks, then spins up and away while fading. */
  private drawDeath(ctx: CanvasRenderingContext2D, sprites: Sprites, d: Death) {
    const sheet = sprites.bombers[d.color];
    if (!sheet) return;
    // d.y sits 2px above the player's centre; the frame goes where the standing bomber was
    const ouch = () => drawBomber(ctx, sheet, "ouch", "down", -8, 2 - ANCHOR.standTop);
    ctx.save();
    if (d.age < DEATH_BLINK_S) {
      const lit = Math.floor(d.age / 0.05) % 2 === 0;
      ctx.translate(d.x + rand(-0.8, 0.8), d.y);
      ctx.globalAlpha = lit ? 1 : 0.35;
      ouch();
      if (lit) {
        ctx.globalCompositeOperation = "lighter"; // drawing it twice washes it out to white-hot
        ouch();
      }
    } else {
      const t = (d.age - DEATH_BLINK_S) / (DEATH_TOTAL_S - DEATH_BLINK_S);
      ctx.translate(d.x, d.y - t * 34);
      ctx.rotate(t * Math.PI * 5);
      ctx.globalAlpha = 1 - t;
      const s = 1 - t * 0.4;
      ctx.scale(s, s);
      ouch();
    }
    ctx.restore();
  }
}
