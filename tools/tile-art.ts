/**
 * Board tiles, drawn in a 3/4 view: blocks show a lit top face and a darker front face, and the floor
 * right under a block lies in its shadow. Textures come from a seeded generator, so every run draws
 * the same pixels.
 *
 * The sheet's columns (TILE_SHEET), the themes and each theme's key colours (THEME_COLORS, which debris
 * flies off in) come from the client's sprites.ts. Each map has its theme.
 */
import { THEME_COLORS, TILE_PX as T, TILE_SHEET, type TileName, type TileTheme } from "../apps/web/src/game/sprites";
import { nextRandom } from "../packages/engine/src";
import { Img, hex, mix, shade, type RGBA } from "./png";

// ------------------------------------------------------------------ helpers

/** The engine's generator, seeded: the same texture on every run. */
function rng(seed: number) {
  const state = { rng: seed >>> 0 };
  return () => nextRandom(state);
}
/** A theme's key colours, ready to paint with. */
const key = (theme: TileTheme) => ({ brick: THEME_COLORS[theme].brick.map((c) => hex(c)), block: THEME_COLORS[theme].block.map((c) => hex(c)) });

interface Course {
  y: number;
  h: number;
  brick: RGBA;
  lit: RGBA;
  dim: RGBA;
  mortar: RGBA;
  /** where the vertical joints start: courses alternate 0 and 4 */
  off: number;
}
/**
 * Courses of 7-pixel bricks with staggered joints, each brick lit along `litWidth` of its top edge and dim
 * along its bottom; with `chips`, some bricks get a nick.
 */
function brickCourses(img: Img, courses: Course[], litWidth = T, chips?: () => number) {
  for (const c of courses) {
    for (let x0 = c.off - 8; x0 < T; x0 += 8) {
      const x1 = Math.max(0, x0 + 1);
      const x2 = Math.min(T, x0 + 8);
      if (x2 <= x1) continue;
      img.rect(x1, c.y, x2 - x1, c.h, c.brick);
      img.rect(x1, c.y, Math.min(litWidth, x2 - x1), 1, c.lit);
      img.rect(x1, c.y + c.h - 1, x2 - x1, 1, c.dim);
      if (chips && chips() < 0.6) img.set(x1 + Math.floor(chips() * (x2 - x1)), c.y + 1 + Math.floor(chips() * Math.max(1, c.h - 1)), c.dim);
    }
    img.rect(0, c.y + c.h, T, 1, c.mortar);
  }
}

function fill(c: RGBA) {
  const img = new Img(T, T);
  img.rect(0, 0, T, T, c);
  return img;
}
/** Darken the top rows: the shadow a block casts on the floor below it. */
function shadowed(floor: Img): Img {
  const img = new Img(T, T);
  img.blit(floor, 0, 0);
  const strength = [0.62, 0.66, 0.7, 0.76, 0.84, 0.92];
  strength.forEach((f, y) => {
    for (let x = 0; x < T; x++) img.set(x, y, shade(img.get(x, y), f));
  });
  return img;
}

interface TileSet {
  floor: (tone: 0 | 1, detail: boolean) => Img;
  hard: () => Img;
  soft: () => Img;
}

// ------------------------------------------------------------------ garden: grass, stone pillars, red bricks

const garden: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#55ad52" : "#62c05e");
    const img = fill(base);
    const r = rng(11 + tone);
    const dark = shade(base, 0.82);
    const light = mix(base, hex("#b6f08a"), 0.35);
    for (let i = 0; i < 16; i++) {
      // a tuft: two dark blades with a light tip
      const x = Math.floor(r() * T);
      const y = 2 + Math.floor(r() * (T - 3));
      img.set(x, y, dark);
      img.set(x, y - 1, light);
      if (r() < 0.5) img.set(x + 1, y, dark);
    }
    for (let i = 0; i < 6; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), mix(base, hex("#2f7d3a"), 0.4));
    if (detail) {
      // a little flower
      const x = 5 + Math.floor(r() * 6);
      const y = 5 + Math.floor(r() * 6);
      const petal = r() < 0.5 ? hex("#fff4d6") : hex("#ffd0e0");
      img.set(x - 1, y, petal);
      img.set(x + 1, y, petal);
      img.set(x, y - 1, petal);
      img.set(x, y + 1, petal);
      img.set(x, y, hex("#ffcc33"));
      img.set(x, y + 2, shade(base, 0.75));
    }
    return img;
  },
  hard() {
    const img = new Img(T, T);
    const [top, front, accent] = key("garden").block;
    const r = rng(21);
    img.rect(0, 0, T, 11, top);
    for (let i = 0; i < 18; i++) img.set(Math.floor(r() * T), Math.floor(r() * 11), r() < 0.5 ? hex("#a8adbf") : hex("#c6cad8"));
    img.rect(0, 0, T, 1, accent);
    img.rect(0, 0, 1, 11, hex("#d8dbe7"));
    img.rect(T - 1, 0, 1, 11, hex("#8e93a8"));
    // carved cap: a sunken square with a lit lower-right rim
    img.rect(4, 3, 8, 5, hex("#9fa4b8"));
    img.rect(4, 3, 8, 1, hex("#80859b"));
    img.rect(4, 3, 1, 5, hex("#80859b"));
    img.rect(5, 7, 7, 1, hex("#d3d6e2"));
    img.rect(11, 4, 1, 4, hex("#d3d6e2"));
    // front face: darker stone in two courses
    img.rect(0, 11, T, 5, front);
    img.rect(0, 11, T, 1, hex("#959ab0"));
    img.rect(0, 13, T, 1, hex("#5f6379"));
    img.rect(5, 11, 1, 2, hex("#5f6379"));
    img.rect(11, 14, 1, 1, hex("#5f6379"));
    img.rect(2, 14, 1, 1, hex("#5f6379"));
    img.rect(T - 1, 11, 1, 5, hex("#5c6076"));
    img.rect(0, 15, T, 1, hex("#3b3e52"));
    return img;
  },
  soft() {
    const img = new Img(T, T);
    const [brick, lit, dim, mortar] = key("garden").brick;
    img.rect(0, 0, T, T, mortar);
    brickCourses(
      img,
      [
        { y: 0, h: 3, brick, lit, dim: hex("#bd5f30"), mortar, off: 0 },
        { y: 4, h: 3, brick: hex("#d9773f"), lit: hex("#ee975c"), dim, mortar, off: 4 },
        { y: 8, h: 2, brick: hex("#d4733c"), lit: hex("#ea9157"), dim: hex("#b2572a"), mortar: hex("#7e3b1c"), off: 0 },
        { y: 11, h: 4, brick: hex("#a9502a"), lit: hex("#c2653a"), dim: hex("#8a3f20"), mortar: hex("#5a2614"), off: 4 },
      ],
      T,
      rng(31),
    );
    img.rect(0, 10, T, 1, hex("#6a3018"));
    img.rect(0, 0, T, 1, hex("#ffb27a"));
    img.rect(0, 15, T, 1, hex("#3e1a0c"));
    return img;
  },
};

// ------------------------------------------------------------------ factory: tread plates, steel blocks, crates

const factory: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#56606f" : "#5f6979");
    const img = fill(base);
    // tread: short diagonal ridges
    for (let y = 1; y < T; y += 4) {
      for (let x = (y % 8 === 1 ? 1 : 3); x < T - 1; x += 4) {
        img.set(x, y, mix(base, hex("#9aa6ba"), 0.45));
        img.set(x + 1, y + 1, shade(base, 0.78));
      }
    }
    img.rect(0, 0, T, 1, mix(base, hex("#a8b2c4"), 0.35));
    img.rect(0, 0, 1, T, mix(base, hex("#a8b2c4"), 0.25));
    img.rect(0, T - 1, T, 1, shade(base, 0.68));
    img.rect(T - 1, 0, 1, T, shade(base, 0.72));
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) {
      img.set(x, y, hex("#b9c2d2"));
      img.set(x + 1, y + 1, shade(base, 0.6));
    }
    if (detail) {
      // an oil stain
      const r = rng(41 + tone);
      const cx = 6 + Math.floor(r() * 4);
      const cy = 6 + Math.floor(r() * 4);
      for (let y = -2; y <= 2; y++) for (let x = -3; x <= 3; x++) {
        if (x * x / 9 + y * y / 4 <= 1 && r() < 0.85) img.set(cx + x, cy + y, mix(base, hex("#232836"), 0.55));
      }
      img.set(cx - 1, cy - 1, mix(base, hex("#8fd0ff"), 0.35));
    }
    return img;
  },
  hard() {
    const img = new Img(T, T);
    const [top, side, stripe] = key("factory").block;
    img.rect(0, 0, T, 11, top);
    img.rect(0, 0, T, 1, hex("#d6dce8"));
    img.rect(0, 0, 1, 11, hex("#c4cbda"));
    img.rect(T - 1, 0, 1, 11, side);
    img.rect(1, 10, T - 2, 1, side);
    // a big bolt in the middle
    for (let y = 0; y < 11; y++) for (let x = 0; x < T; x++) {
      const d = Math.hypot(x - 7.5, y - 5);
      if (d <= 3.2) img.set(x, y, d > 2.2 ? hex("#c9d0dd") : hex("#7b8499"));
    }
    img.rect(6, 4, 4, 1, hex("#5d657a"));
    for (const [x, y] of [[2, 2], [13, 2], [2, 8], [13, 8]]) img.set(x, y, hex("#e3e8f1"));
    // front face: hazard stripes
    for (let y = 11; y < 15; y++) for (let x = 0; x < T; x++) img.set(x, y, Math.floor((x + y) / 3) % 2 ? stripe : hex("#2b2a33"));
    img.rect(0, 11, T, 1, hex("#cfa21f"));
    img.rect(0, 15, T, 1, hex("#1c1b22"));
    return img;
  },
  soft() {
    const img = new Img(T, T);
    const [plank, lit, front, gap] = key("factory").brick;
    img.rect(0, 0, T, 11, plank);
    for (const y of [3, 7]) img.rect(1, y, T - 2, 1, hex("#8a5a2c"));
    for (let y = 0; y < 11; y++) for (let x = 0; x < T; x++) if ((x * 7 + y * 13) % 11 === 0) img.set(x, y, hex("#b47c43"));
    // frame and a cross brace
    img.rect(0, 0, T, 1, lit);
    img.rect(0, 0, 1, 11, hex("#dba66b"));
    img.rect(T - 1, 0, 1, 11, hex("#7a4c22"));
    for (let i = 1; i < 10; i++) {
      img.set(1 + Math.round(i * 1.45), i, hex("#9a6534"));
      img.set(2 + Math.round(i * 1.45), i, hex("#e0ad74"));
    }
    for (const [x, y] of [[1, 1], [14, 1], [1, 9], [14, 9]]) img.set(x, y, hex("#4d3017"));
    // front face: darker vertical boards
    img.rect(0, 11, T, 5, front);
    for (const x of [4, 8, 12]) img.rect(x, 11, 1, 4, gap);
    img.rect(0, 11, T, 1, hex("#ae7640"));
    img.rect(0, 15, T, 1, hex("#3a2310"));
    return img;
  },
};

// ------------------------------------------------------------------ temple: sandstone slabs, carved pillars, clay pots

const temple: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#d9b878" : "#e2c385");
    const img = fill(base);
    const r = rng(51 + tone);
    for (let i = 0; i < 22; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), r() < 0.5 ? mix(base, hex("#fff0c8"), 0.4) : shade(base, 0.88));
    // grout lines: lit top-left, dark bottom-right
    img.rect(0, 0, T, 1, mix(base, hex("#fff0c8"), 0.35));
    img.rect(0, 0, 1, T, mix(base, hex("#fff0c8"), 0.25));
    img.rect(0, T - 1, T, 1, shade(base, 0.74));
    img.rect(T - 1, 0, 1, T, shade(base, 0.78));
    if (detail) {
      // a crack running across the slab
      let x = 3 + Math.floor(r() * 4);
      for (let y = 3; y < 12; y++) {
        img.set(x, y, shade(base, 0.7));
        if (r() < 0.45) x += r() < 0.5 ? 1 : -1;
      }
    }
    return img;
  },
  hard() {
    const img = new Img(T, T);
    const [top, front, lit] = key("temple").block;
    img.rect(0, 0, T, 11, top);
    const r = rng(61);
    for (let i = 0; i < 14; i++) img.set(Math.floor(r() * T), Math.floor(r() * 11), r() < 0.5 ? hex("#c4954f") : hex("#e2b874"));
    img.rect(0, 0, T, 1, lit);
    img.rect(0, 0, 1, 11, hex("#ecc984"));
    img.rect(T - 1, 0, 1, 11, hex("#a67a3a"));
    // an engraved eye
    const glyph = ["..KKKK..", ".K....K.", "K..KK..K", ".K....K.", "..KKKK.."];
    glyph.forEach((row, y) => [...row].forEach((ch, x) => ch === "K" && img.set(4 + x, 3 + y, hex("#94692f"))));
    img.rect(4, 8, 8, 1, hex("#f0cf8f"));
    // front face with a carved band
    img.rect(0, 11, T, 5, front);
    img.rect(0, 11, T, 1, hex("#bf9150"));
    for (let x = 1; x < T; x += 3) img.set(x, 13, hex("#7f5a28"));
    img.rect(0, 15, T, 1, hex("#5a3d18"));
    return img;
  },
  soft() {
    // a clay pot standing on the slab
    const img = temple.floor(0, false);
    const [body, light, dark, band] = key("temple").brick;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const nx = (x - 7.5) / 6.6;
      const ny = (y - 9.5) / 5.6;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const lit = -nx * 0.6 - ny * 0.8;
      img.set(x, y, d > 0.82 ? hex("#5a2412") : lit > 0.45 ? light : lit < -0.35 ? dark : body);
    }
    img.rect(4, 1, 8, 3, hex("#b65632"));
    img.rect(4, 1, 8, 1, hex("#e48756"));
    img.rect(5, 2, 6, 1, hex("#3b170a"));
    img.rect(3, 0, 10, 1, hex("#5a2412"));
    img.rect(3, 1, 1, 3, hex("#5a2412"));
    img.rect(12, 1, 1, 3, hex("#5a2412"));
    img.rect(3, 9, 10, 1, band); // a painted band
    img.rect(3, 10, 10, 1, hex("#9a6a2a"));
    img.rect(4, 15, 8, 1, shade(hex("#d9b878"), 0.6)); // its shadow
    return img;
  },
};

// ------------------------------------------------------------------ snow: snowfield, frozen pillars, snow bricks

const snow: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#dbe8f5" : "#e8f1fa");
    const img = fill(base);
    const r = rng(71 + tone);
    for (let i = 0; i < 14; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), mix(base, hex("#9fbedb"), 0.35));
    for (let i = 0; i < 5; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), hex("#ffffff"));
    // soft drifts: a darker curve here and there
    for (let i = 0; i < 2; i++) {
      const x = Math.floor(r() * 10);
      const y = 3 + Math.floor(r() * 10);
      img.rect(x, y, 5, 1, mix(base, hex("#a9c6e0"), 0.45));
      img.rect(x + 1, y - 1, 3, 1, hex("#ffffff"));
    }
    if (detail) {
      // footprints crossing the tile
      for (const [x, y] of [[4, 4], [7, 7], [4, 10], [7, 13]]) {
        img.rect(x, y, 2, 2, mix(base, hex("#7d9fbf"), 0.45));
        img.set(x, y, mix(base, hex("#7d9fbf"), 0.25));
      }
    }
    return img;
  },
  hard() {
    const img = new Img(T, T);
    const [ice, deep, snowCap] = key("snow").block;
    img.rect(0, 0, T, 11, ice);
    const r = rng(81);
    for (let i = 0; i < 10; i++) img.set(Math.floor(r() * T), 3 + Math.floor(r() * 8), r() < 0.5 ? hex("#86c2df") : hex("#c4e8f6"));
    // a cap of snow on top, drooping over the edge
    img.rect(0, 0, T, 3, snowCap);
    for (const x of [1, 2, 6, 7, 8, 12, 13]) img.set(x, 3, hex("#f2f8fd"));
    img.rect(0, 2, T, 1, hex("#e3eef8"));
    // a glint across the ice
    for (let i = 0; i < 5; i++) img.set(3 + i, 9 - i, hex("#e6f6fd"));
    img.rect(T - 1, 3, 1, 8, hex("#6aa7c6"));
    // front face: deeper ice with a crack
    img.rect(0, 11, T, 5, deep);
    img.rect(0, 11, T, 1, hex("#7fb9d6"));
    for (const [x, y] of [[4, 12], [5, 13], [5, 14], [11, 12], [12, 13]]) img.set(x, y, hex("#3f7a9c"));
    img.rect(0, 15, T, 1, hex("#2c5a75"));
    return img;
  },
  soft() {
    const img = new Img(T, T);
    // packed snow in blocks, bluer than the snowfield so they stand out from it
    const [brick, lit, dim, mortar] = key("snow").brick;
    img.rect(0, 0, T, T, mortar);
    brickCourses(
      img,
      [
        { y: 0, h: 3, brick, lit, dim, mortar, off: 0 },
        { y: 4, h: 3, brick: hex("#b3cfeb"), lit, dim: hex("#93b4d8"), mortar, off: 4 },
        { y: 8, h: 2, brick: hex("#adcae8"), lit, dim: hex("#8eb0d5"), mortar: hex("#557497"), off: 0 },
        { y: 11, h: 4, brick: hex("#84a8cf"), lit, dim: hex("#6c91ba"), mortar: hex("#43628a"), off: 4 },
      ],
      3,
    );
    img.rect(0, 10, T, 1, hex("#4a6a90"));
    img.rect(0, 0, T, 1, hex("#dcebf8"));
    img.rect(0, 15, T, 1, hex("#3a5676"));
    return img;
  },
};

const SETS: Record<TileTheme, TileSet> = { garden, factory, temple, snow };

export function tileSheet(theme: TileTheme): Img {
  const set = SETS[theme];
  const floorA = set.floor(0, false);
  const floorB = set.floor(1, false);
  const tiles: Record<TileName, Img> = {
    floorA,
    floorB,
    floorADetail: set.floor(0, true),
    floorBDetail: set.floor(1, true),
    shadowA: shadowed(floorA),
    shadowB: shadowed(floorB),
    hard: set.hard(),
    soft: set.soft(),
  };
  const sheet = new Img(T * TILE_SHEET.length, T);
  TILE_SHEET.forEach((name, i) => sheet.blit(tiles[name], i * T, 0));
  return sheet;
}
