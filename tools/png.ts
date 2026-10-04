import { deflateSync } from "node:zlib";

export type RGBA = [number, number, number, number];

export class Img {
  data: Uint8Array;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }

  get(x: number, y: number): RGBA {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  set(x: number, y: number, c: RGBA) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data.set(c, (y * this.w + x) * 4);
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** the w×h piece of this image whose top-left is (x, y) */
  crop(x: number, y: number, w: number, h: number): Img {
    const out = new Img(w, h);
    for (let j = 0; j < h; j++) out.data.set(this.data.subarray(((y + j) * this.w + x) * 4, ((y + j) * this.w + x + w) * 4), j * w * 4);
    return out;
  }

  /** copy `src` onto this image at (dx, dy); transparent pixels are skipped */
  blit(src: Img, dx: number, dy: number) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c[3] !== 0) this.set(dx + x, dy + y, c);
      }
    }
  }
}

/**
 * Paints the ellipse centred on (cx, cy): `paint` gets how far out each pixel is (0 in the middle, 1 on the
 * rim) and its position, and returns its colour, or null to leave it.
 */
export function ellipse(img: Img, cx: number, cy: number, rx: number, ry: number, paint: (d: number, x: number, y: number) => RGBA | null) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const c = d <= 1 ? paint(d, x, y) : null;
      if (c) img.set(x, y, c);
    }
  }
}

/** `img` blown up `k` times, each pixel a k×k block (pixel art stays crisp). */
export function upscale(img: Img, k: number): Img {
  const out = new Img(img.w * k, img.h * k);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) out.rect(x * k, y * k, k, k, img.get(x, y));
  return out;
}

export function hex(h: string, a = 255): RGBA {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** `a` blended `t` of the way towards `b` (alpha kept from `a`). */
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  const m = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return [m(0), m(1), m(2), a[3]];
}
/** Darker (f < 1) or brighter (f > 1), clamped. */
export function shade(c: RGBA, f: number): RGBA {
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return [m(c[0]), m(c[1]), m(c[2]), c[3]];
}
/** `f` of the way towards white. */
export const lighten = (c: RGBA, f: number): RGBA => mix(c, [255, 255, 255, 255], f);

/** Draw an ASCII sprite: `.` is transparent, other chars are looked up in `palette`. */
export function fromAscii(rows: string[], palette: Record<string, RGBA>): Img {
  const img = new Img(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== img.w) throw new Error(`sprite row ${y} has width ${row.length}, expected ${img.w}`);
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const c = palette[ch];
      if (!c) throw new Error(`no palette entry for '${ch}'`);
      img.set(x, y, c);
    });
  });
  return img;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The image data of `img`: unfiltered RGBA rows, deflated. */
function pixels(img: Img): Uint8Array {
  const raw = new Uint8Array((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 4 + 1)] = 0; // filter: none
    raw.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * (img.w * 4 + 1) + 1);
  }
  return deflateSync(raw);
}

/** The signature and the IHDR chunk of a w×h RGBA image. */
function header(w: number, h: number): Uint8Array[] {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
}

export function encodePng(img: Img): Uint8Array {
  return concat([...header(img.w, img.h), chunk("IDAT", pixels(img)), chunk("IEND", new Uint8Array(0))]);
}

/** An animated PNG (APNG) looping over `frames` forever, each shown for `delayMs`. All frames are the first one's size. */
export function encodeApng(frames: Img[], delayMs: number): Uint8Array {
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length); // then 0 plays: loop forever
  const parts = [...header(frames[0].w, frames[0].h), chunk("acTL", actl)];
  let seq = 0;
  frames.forEach((img, i) => {
    const fctl = new Uint8Array(26);
    const v = new DataView(fctl.buffer);
    v.setUint32(0, seq++);
    v.setUint32(4, img.w);
    v.setUint32(8, img.h);
    // no offset; the delay is delayMs/1000 s; dispose and blend 0: each frame replaces the whole picture
    v.setUint16(20, delayMs);
    v.setUint16(22, 1000);
    parts.push(chunk("fcTL", fctl));
    const data = pixels(img);
    if (i === 0) {
      parts.push(chunk("IDAT", data));
      return;
    }
    const fdat = new Uint8Array(4 + data.length);
    new DataView(fdat.buffer).setUint32(0, seq++);
    fdat.set(data, 4);
    parts.push(chunk("fdAT", fdat));
  });
  parts.push(chunk("IEND", new Uint8Array(0)));
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
