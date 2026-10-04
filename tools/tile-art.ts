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

// ------------------------------------------------------------------ assembly: steel deck, machines, cardboard boxes

const assembly: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#474c58" : "#4f5562");
    const img = fill(base);
    const r = rng(91 + tone);
    // diamond plate: little raised dashes, staggered
    for (let y = 2; y < T; y += 4) {
      for (let x = y % 8 === 2 ? 1 : 3; x < T - 1; x += 4) {
        img.set(x, y, mix(base, hex("#9aa2b4"), 0.4));
        img.set(x + 1, y, shade(base, 0.75));
      }
    }
    for (let i = 0; i < 8; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), shade(base, 0.85));
    img.rect(0, 0, T, 1, mix(base, hex("#a0a8ba"), 0.3));
    img.rect(0, T - 1, T, 1, shade(base, 0.7));
    if (detail) for (let x = 0; x < T; x++) img.set(x, 7, Math.floor(x / 3) % 2 ? hex("#f2c230") : hex("#2b2a33")); // a safety line
    return img;
  },
  hard() {
    // a machine: grey casing with a grille and a warning light, hazard band in front
    const img = new Img(T, T);
    const [top, front, light] = key("assembly").block;
    img.rect(0, 0, T, 11, top);
    img.rect(0, 0, T, 1, hex("#8a92a2"));
    img.rect(0, 0, 1, 11, hex("#7a8292"));
    img.rect(T - 1, 0, 1, 11, hex("#3a3e4a"));
    for (let y = 4; y < 10; y += 2) img.rect(3, y, 10, 1, hex("#2c3038"));
    img.rect(6, 1, 4, 2, light);
    img.set(6, 1, hex("#ffe0a0"));
    img.rect(0, 11, T, 5, front);
    for (let y = 12; y < 15; y++) for (let x = 0; x < T; x++) if (Math.floor((x + y) / 2) % 2) img.set(x, y, hex("#f2c230"));
    img.rect(0, 11, T, 1, hex("#6a707e"));
    img.rect(0, 15, T, 1, hex("#1c1e24"));
    return img;
  },
  soft() {
    // a cardboard box, taped shut
    const img = new Img(T, T);
    const [box, lit, dim, edge] = key("assembly").brick;
    img.rect(0, 0, T, 11, box);
    img.rect(0, 0, T, 1, lit);
    img.rect(0, 0, 1, 11, lit);
    img.rect(T - 1, 0, 1, 11, dim);
    img.rect(6, 0, 4, 11, hex("#e0cf9a"));
    img.rect(6, 0, 1, 11, hex("#f2e4b8"));
    img.rect(0, 11, T, 5, dim);
    img.rect(6, 11, 4, 4, hex("#b8a676"));
    img.rect(0, 11, T, 1, hex("#b8874a"));
    for (const x of [2, 12]) img.rect(x, 12, 1, 2, edge); // printed marks
    img.rect(0, 15, T, 1, edge);
    return img;
  },
};

// ------------------------------------------------------------------ space: starry deck, hull blocks, crystals

const space: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#1c1d3a" : "#22244a");
    const img = fill(base);
    const r = rng(101 + tone);
    for (let i = 0; i < 7; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), r() < 0.6 ? hex("#c8ccff") : hex("#9a7cff"));
    // panel seams
    img.rect(0, 0, T, 1, mix(base, hex("#5a5ea8"), 0.5));
    img.rect(0, 0, 1, T, mix(base, hex("#5a5ea8"), 0.35));
    img.rect(0, T - 1, T, 1, shade(base, 0.6));
    img.rect(T - 1, 0, 1, T, shade(base, 0.65));
    if (detail) {
      // a bright star, twinkling
      const x = 4 + Math.floor(r() * 8);
      const y = 4 + Math.floor(r() * 8);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) img.set(x + dx, y + dy, hex("#8f9cff"));
      img.set(x, y, hex("#ffffff"));
    }
    return img;
  },
  hard() {
    // a hull block: brushed metal and rivets, a glowing strip in front
    const img = new Img(T, T);
    const [top, front, glow] = key("space").block;
    img.rect(0, 0, T, 11, top);
    for (let y = 2; y < 11; y += 2) img.rect(1, y, T - 2, 1, mix(top, hex("#ffffff"), 0.12));
    img.rect(0, 0, T, 1, hex("#c4cae6"));
    img.rect(0, 0, 1, 11, hex("#b0b6d8"));
    img.rect(T - 1, 0, 1, 11, hex("#4a5078"));
    for (const [x, y] of [[2, 2], [13, 2], [2, 8], [13, 8]]) img.set(x, y, hex("#3a3f60"));
    img.rect(0, 11, T, 5, front);
    img.rect(2, 13, 12, 1, glow);
    img.rect(0, 11, T, 1, hex("#7a82aa"));
    img.rect(0, 15, T, 1, hex("#262a48"));
    return img;
  },
  soft() {
    // crystals growing out of the deck: lit on the left, dark on the right
    const img = space.floor(0, false);
    const [body, light, dark, edge] = key("space").brick;
    for (const [cx, w, h] of [[6, 7, 12], [11, 5, 8], [3, 4, 6]]) {
      const apex = 14 - h;
      for (let y = apex; y <= 14; y++) {
        const half = (w / 2) * ((y - apex) / h);
        for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
          const rim = x < cx - half + 1 || x > cx + half - 1 || y === 14;
          img.set(x, y, rim ? edge : x < cx ? light : x > cx ? dark : body);
        }
      }
    }
    img.rect(2, 15, 12, 1, shade(hex("#22244a"), 0.6));
    return img;
  },
};

// ------------------------------------------------------------------ ice: frosted bank, snowy boulders, snowmen

const ice: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#d5dbec" : "#e1e6f4");
    const img = fill(base);
    const r = rng(111 + tone);
    for (let i = 0; i < 12; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), mix(base, hex("#9aa6cc"), 0.35));
    for (let i = 0; i < 4; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), hex("#ffffff"));
    if (detail) {
      // a frozen tuft of grass poking through
      const x = 5 + Math.floor(r() * 6);
      const y = 7 + Math.floor(r() * 5);
      for (const [dx, dy] of [[0, 0], [0, -1], [-1, -1], [1, -2], [1, -1]]) img.set(x + dx, y + dy, hex("#7a9a8e"));
      img.set(x + 1, y - 2, hex("#ffffff"));
    }
    return img;
  },
  hard() {
    // a boulder with snow on top
    const img = new Img(T, T);
    const [rock, deep, cap] = key("ice").block;
    img.rect(0, 0, T, 11, rock);
    const r = rng(121);
    for (let i = 0; i < 16; i++) img.set(Math.floor(r() * T), 3 + Math.floor(r() * 8), r() < 0.5 ? hex("#7a8194") : hex("#a3aabb"));
    img.rect(0, 0, T, 3, cap);
    for (const x of [2, 3, 7, 11, 12]) img.set(x, 3, hex("#eef2fb"));
    img.rect(0, 2, T, 1, hex("#dfe5f2"));
    img.rect(T - 1, 3, 1, 8, hex("#4e5466"));
    img.rect(0, 11, T, 5, deep);
    img.rect(0, 11, T, 1, hex("#767d90"));
    for (const [x, y] of [[3, 13], [9, 12], [12, 14]]) img.set(x, y, hex("#3e4354"));
    img.rect(0, 15, T, 1, hex("#33374a"));
    return img;
  },
  soft() {
    // a snowman: two snowballs, coal eyes and buttons, a carrot nose
    const img = ice.floor(0, false);
    const [snowball, lit, dim, outline] = key("ice").brick;
    for (const [cx, cy, rad] of [[7.5, 10.5, 5], [7.5, 4.5, 3.4]]) {
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > rad) continue;
          const light = (cx - x) * 0.6 + (cy - y) * 0.8;
          img.set(x, y, d > rad - 1 ? outline : light > 1.5 ? lit : light < -1.5 ? dim : snowball);
        }
      }
    }
    for (const [x, y] of [[6, 4], [9, 4], [7, 9], [7, 11]]) img.set(x, y, hex("#2a2a35"));
    img.rect(8, 5, 2, 1, hex("#ff8a1e"));
    img.rect(4, 15, 8, 1, shade(hex("#e1e6f4"), 0.75));
    return img;
  },
};

// ------------------------------------------------------------------ warehouse: plank floor, concrete pillars, sacks

const warehouse: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#a87a4c" : "#b48656");
    const img = fill(base);
    const r = rng(131 + tone);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (r() < 0.08) img.set(x, y, mix(base, hex("#7a522c"), 0.4)); // grain
    for (const y of [0, 5, 10]) img.rect(0, y, T, 1, shade(base, 0.7)); // seams between planks
    for (const [x, y] of [[5, 1], [11, 6], [3, 11]]) img.rect(x, y, 1, 4, shade(base, 0.72)); // plank ends
    if (detail) {
      // nail heads
      for (const [x, y] of [[2, 3], [13, 8], [8, 13]]) {
        img.set(x, y, hex("#d8d0c0"));
        img.set(x + 1, y + 1, shade(base, 0.6));
      }
    }
    return img;
  },
  hard() {
    // a concrete pillar with a band of yellow paint round it
    const img = new Img(T, T);
    const [top, front, paint] = key("warehouse").block;
    img.rect(0, 0, T, 11, top);
    const r = rng(141);
    for (let i = 0; i < 18; i++) img.set(Math.floor(r() * T), Math.floor(r() * 11), r() < 0.5 ? hex("#8a909a") : hex("#b0b6c0"));
    img.rect(0, 0, T, 1, hex("#c6ccd4"));
    img.rect(0, 0, 1, 11, hex("#b8bec8"));
    img.rect(T - 1, 0, 1, 11, hex("#62686f"));
    img.rect(0, 11, T, 5, front);
    img.rect(0, 12, T, 2, paint);
    img.rect(0, 11, T, 1, hex("#8a909a"));
    img.rect(0, 15, T, 1, hex("#3e434a"));
    return img;
  },
  soft() {
    // a pile of sacks: two below, one on top
    const img = warehouse.floor(0, false);
    const [sack, lit, dim, tie] = key("warehouse").brick;
    for (const [cx, cy, rx, ry] of [[4.5, 11, 4, 3.5], [11, 11, 4, 3.5], [7.5, 5.5, 4.5, 3.6]]) {
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          if (d > 1) continue;
          img.set(x, y, d > 0.82 ? tie : y < cy - 1 ? lit : y > cy + 1 ? dim : sack);
        }
      }
      img.set(Math.round(cx), Math.round(cy - ry) + 1, tie); // the tied neck
    }
    img.rect(2, 15, 12, 1, shade(hex("#b48656"), 0.6));
    return img;
  },
};

// ------------------------------------------------------------------ volcano: basalt, obsidian, cooling lava rock

const volcano: TileSet = {
  floor(tone, detail) {
    const base = hex(tone ? "#3a3134" : "#433a3d");
    const img = fill(base);
    const r = rng(151 + tone);
    for (let i = 0; i < 16; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), r() < 0.5 ? shade(base, 0.8) : mix(base, hex("#7a6a6e"), 0.4));
    for (let i = 0; i < 2; i++) img.set(Math.floor(r() * T), Math.floor(r() * T), r() < 0.5 ? hex("#ff7a1a") : hex("#ffb347")); // embers
    img.rect(0, 0, T, 1, mix(base, hex("#7a6a6e"), 0.35));
    img.rect(0, T - 1, T, 1, shade(base, 0.65));
    img.rect(T - 1, 0, 1, T, shade(base, 0.7));
    if (detail) {
      // a crack with a glow at the bottom
      let x = 4 + Math.floor(r() * 6);
      for (let y = 3; y < 13; y++) {
        img.set(x, y, y % 3 === 0 ? hex("#ff5a1a") : hex("#1e1618"));
        if (r() < 0.45) x += r() < 0.5 ? 1 : -1;
      }
    }
    return img;
  },
  hard() {
    // obsidian: glassy black-violet with a sharp glint
    const img = new Img(T, T);
    const [top, front, glint] = key("volcano").block;
    img.rect(0, 0, T, 11, top);
    for (let i = 0; i < 6; i++) img.set(3 + i, 8 - i, glint);
    img.set(4, 8, hex("#ffffff"));
    img.rect(0, 0, T, 1, hex("#6a5a7a"));
    img.rect(0, 0, 1, 11, hex("#54466a"));
    img.rect(T - 1, 0, 1, 11, hex("#140e1a"));
    img.rect(0, 11, T, 5, front);
    for (const [x, y] of [[4, 12], [10, 13], [13, 12]]) img.set(x, y, hex("#4a3a5a"));
    img.rect(0, 11, T, 1, hex("#2c2236"));
    img.rect(0, 15, T, 1, hex("#0c080f"));
    return img;
  },
  soft() {
    // lumps of lava rock that haven't quite cooled: glowing seams between them
    const img = new Img(T, T);
    const [rock, lit, dark, glow] = key("volcano").brick;
    img.rect(0, 0, T, T, glow);
    brickCourses(
      img,
      [
        { y: 0, h: 4, brick: rock, lit, dim: dark, mortar: glow, off: 0 },
        { y: 5, h: 4, brick: hex("#6e3424"), lit, dim: dark, mortar: hex("#ff5a1a"), off: 4 },
        { y: 10, h: 5, brick: hex("#5a2a1e"), lit: hex("#8a4a32"), dim: hex("#3a1a12"), mortar: glow, off: 0 },
      ],
      6,
      rng(161),
    );
    img.rect(0, 15, T, 1, hex("#2a120c"));
    return img;
  },
};

const SETS: Record<TileTheme, TileSet> = { garden, factory, temple, snow, assembly, space, ice, warehouse, volcano };

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
