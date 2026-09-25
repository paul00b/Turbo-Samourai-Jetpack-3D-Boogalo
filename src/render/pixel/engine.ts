/**
 * Moteur pixel des planches (design/planches/engine.js), porté tel quel : framebuffer 32 bits,
 * primitives entières, tramage Bayer, bruit de valeur, contour automatique.
 *
 * Rendu uniquement, jamais la sim : Math.sin / Math.random y sont autorisés. Aucune dépendance à
 * Pixi ni au DOM, donc tout ce qui est dessiné ici se teste sous Node.
 *
 * Format des couleurs : ABGR little-endian (octets R, G, B, A en mémoire), directement uploadable
 * comme texture RGBA. Un pixel à 0 est transparent.
 */

export type Color = number;

/** '#rrggbb' -> couleur opaque. */
export function C(hex: string): Color {
  const n = parseInt(hex.slice(1), 16);
  return ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0;
}

export const cr = (c: Color): number => c & 255;
export const cg = (c: Color): number => (c >>> 8) & 255;
export const cb = (c: Color): number => (c >>> 16) & 255;
export const ca = (c: Color): number => c >>> 24;

export function pack(r: number, g: number, b: number, a = 255): Color {
  return (((a | 0) << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
}

export function lerpC(a: Color, b: Color, t: number): Color {
  return pack(cr(a) + (cr(b) - cr(a)) * t, cg(a) + (cg(b) - cg(a)) * t, cb(a) + (cb(b) - cb(a)) * t);
}

/** Couleur du moteur -> 0xRRGGBB (tint Pixi, clearColor). */
export function toHex(c: Color): number {
  return (cr(c) << 16) | (cg(c) << 8) | cb(c);
}

/** Luminance relative (0..255) calculée comme le mode Valeurs des planches. */
export function luma(c: Color): number {
  return 0.2126 * cr(c) + 0.7152 * cg(c) + 0.0722 * cb(c);
}

// Sinus tabulé : les boucles par pixel (mer, lave) en font des centaines de milliers par frame.
const LUT_N = 4096;
const LUT = new Float32Array(LUT_N);
for (let i = 0; i < LUT_N; i++) LUT[i] = Math.sin((i / LUT_N) * Math.PI * 2);
const K_LUT = LUT_N / (Math.PI * 2);
export const fsin = (x: number): number => LUT[((x * K_LUT) | 0) & (LUT_N - 1)];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number): number => BAYER[((y & 3) << 2) | (x & 3)];
export const dith = (x: number, y: number, c1: Color, c2: Color, t: number): Color => (t > bayer(x, y) ? c2 : c1);

export class Buf {
  readonly w: number;
  readonly h: number;
  readonly d: Uint32Array;

  constructor(w: number, h: number, data?: Uint32Array) {
    this.w = w;
    this.h = h;
    this.d = data ?? new Uint32Array(w * h);
  }

  clear(c: Color = 0): void {
    this.d.fill(c);
  }

  px(x: number, y: number, c: Color): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = c;
  }

  get(x: number, y: number): Color {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[y * this.w + x];
  }

  /** Mélange opaque (comme les planches, où tout se compose sur un fond plein). */
  mix(x: number, y: number, c: Color, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = y * this.w + x;
    this.d[i] = a >= 1 ? c : lerpC(this.d[i], c, a);
  }

  /**
   * Mélange « over » qui respecte la transparence : sur un pixel vide on pose la couleur avec
   * l'alpha a, sur un pixel plein on mélange. Sert aux calques composés ensuite par le GPU.
   */
  mixA(x: number, y: number, c: Color, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = y * this.w + x;
    if (a >= 1) {
      this.d[i] = c;
      return;
    }
    const dst = this.d[i];
    const da = ca(dst) / 255;
    if (da <= 0) {
      this.d[i] = ((c & 0xffffff) | (Math.round(a * 255) << 24)) >>> 0;
      return;
    }
    const oa = a + da * (1 - a);
    const k = a / oa;
    this.d[i] = pack(cr(dst) + (cr(c) - cr(dst)) * k, cg(dst) + (cg(c) - cg(dst)) * k, cb(dst) + (cb(c) - cb(dst)) * k, Math.round(oa * 255));
  }

  hline(x0: number, x1: number, y: number, c: Color): void {
    y = Math.round(y);
    if (y < 0 || y >= this.h) return;
    x0 = Math.max(0, Math.round(x0));
    x1 = Math.min(this.w - 1, Math.round(x1));
    const o = y * this.w;
    for (let x = x0; x <= x1; x++) this.d[o + x] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < h; j++) this.hline(x, x + w - 1, y + j, c);
  }

  disc(cx: number, cy: number, r: number, c: Color): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      const q = r * r - dy * dy + r * 0.6;
      if (q < 0) continue;
      const dx = Math.floor(Math.sqrt(q));
      this.hline(cx - dx, cx + dx, cy + dy, c);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    for (let dy = -ry; dy <= ry; dy++) {
      const k = 1 - (dy * dy) / (ry * ry + 0.5);
      if (k < 0) continue;
      const dx = Math.round(rx * Math.sqrt(k));
      this.hline(cx - dx, cx + dx, cy + dy, c);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 4000; n++) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Trait épais : carrés de w px le long du segment (membres du perso, cordes épaisses). */
  stroke(x0: number, y0: number, x1: number, y1: number, w: number, c: Color): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len * 2));
    const o = (w - 1) / 2;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.rect(Math.round(x0 + (x1 - x0) * t - o), Math.round(y0 + (y1 - y0) * t - o), w, w, c);
    }
  }

  poly(p: readonly number[], c: Color): void {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 1; i < p.length; i += 2) {
      y0 = Math.min(y0, p[i]);
      y1 = Math.max(y1, p[i]);
    }
    const n = p.length / 2;
    const xs: number[] = [];
    const yStart = Math.max(Math.floor(y0), -1);
    const yEnd = Math.min(Math.ceil(y1), this.h);
    for (let y = yStart; y <= yEnd; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = p[i * 2];
        const ay = p[i * 2 + 1];
        const bx = p[((i + 1) % n) * 2];
        const by = p[((i + 1) % n) * 2 + 1];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) this.hline(Math.round(xs[k]), Math.round(xs[k + 1]) - 1, y, c);
    }
  }

  vgrad(y0: number, y1: number, stops: readonly Color[], x0 = 0, x1 = this.w): void {
    const n = stops.length - 1;
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) {
      const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * n;
      const i = Math.min(n - 1, Math.floor(t));
      const f = t - i;
      const o = y * this.w;
      for (let x = x0; x < x1; x++) this.d[o + x] = dith(x, y, stops[i], stops[i + 1], f);
    }
  }

  /** Halo tramé et quantifié (paliers de 14 %), comme les planches. */
  glow(cx: number, cy: number, r: number, c: Color, s: number): void {
    this.glowWith(cx, cy, r, c, s, false);
  }

  /** Même halo, posé sur un calque transparent (alpha au lieu d'un mélange avec le noir). */
  glowA(cx: number, cy: number, r: number, c: Color, s: number): void {
    this.glowWith(cx, cy, r, c, s, true);
  }

  private glowWith(cx: number, cy: number, r: number, c: Color, s: number, alpha: boolean): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= this.h) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= this.w) continue;
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 >= r * r) continue;
        const k = 1 - Math.sqrt(d2) / r;
        const a = s * k * k;
        const q = Math.floor((a + bayer(x, y) * 0.14) / 0.14) * 0.14;
        if (q > 0) {
          if (alpha) this.mixA(x, y, c, Math.min(0.85, q));
          else this.mix(x, y, c, Math.min(0.85, q));
        }
      }
    }
  }

  blit(src: Buf, ox: number, oy: number): void {
    ox = Math.round(ox);
    oy = Math.round(oy);
    for (let y = Math.max(0, oy); y < Math.min(this.h, oy + src.h); y++) {
      const so = (y - oy) * src.w - ox;
      const o = y * this.w;
      for (let x = Math.max(0, ox); x < Math.min(this.w, ox + src.w); x++) {
        const v = src.d[so + x];
        if (v) this.d[o + x] = v;
      }
    }
  }

  blitWrap(src: Buf, ox: number, oy: number): void {
    ox = Math.round(ox);
    oy = Math.round(oy);
    const sw = src.w;
    for (let y = Math.max(0, oy); y < Math.min(this.h, oy + src.h); y++) {
      const so = (y - oy) * sw;
      const o = y * this.w;
      let sx = ((-ox % sw) + sw) % sw;
      for (let x = 0; x < this.w; x++) {
        const v = src.d[so + sx];
        if (v) this.d[o + x] = v;
        if (++sx === sw) sx = 0;
      }
    }
  }

  /**
   * Blit d'un sprite dessiné à la volée : double contour calculé depuis le masque
   * (1 px plein + 1 px à 45 %). `alpha` : le second contour devient semi-transparent au lieu d'être
   * mélangé au pixel d'en dessous (destination = calque transparent composé par le GPU).
   */
  outlineBlit(src: Buf, ox: number, oy: number, olc: Color, alpha = false): void {
    ox = Math.round(ox);
    oy = Math.round(oy);
    const w = src.w;
    const h = src.h;
    const d = src.d;
    const f = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && d[y * w + x] !== 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[y * w + x]) continue;
        if (f(x + 1, y) || f(x - 1, y) || f(x, y + 1) || f(x, y - 1)) this.px(ox + x, oy + y, olc);
        else if (
          f(x + 2, y) || f(x - 2, y) || f(x, y + 2) || f(x, y - 2) ||
          f(x + 1, y + 1) || f(x - 1, y - 1) || f(x + 1, y - 1) || f(x - 1, y + 1)
        ) {
          if (alpha) this.mixA(ox + x, oy + y, olc, 0.45);
          else this.mix(ox + x, oy + y, olc, 0.45);
        }
      }
    }
    this.blit(src, ox, oy);
  }

  /** Passage en `levels` niveaux de gris (mode Valeurs). */
  gray(levels: number): void {
    const d = this.d;
    for (let i = 0; i < d.length; i++) {
      const c = d[i];
      if (!c) continue;
      const l = luma(c);
      const q = Math.round((l / 255) * (levels - 1)) * (255 / (levels - 1));
      d[i] = pack(q, q, q, ca(c));
    }
  }

  /** Copie d'une région (pour découper un gros calque en tuiles de texture). */
  crop(x0: number, y0: number, w: number, h: number): Buf {
    const out = new Buf(w, h);
    for (let y = 0; y < h; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= this.h) continue;
      const xs = Math.max(0, x0);
      const xe = Math.min(this.w, x0 + w);
      if (xe <= xs) continue;
      out.d.set(this.d.subarray(sy * this.w + xs, sy * this.w + xe), y * w + (xs - x0));
    }
    return out;
  }

  /** Vrai si au moins un pixel est non transparent dans la région. */
  anyIn(x0: number, y0: number, w: number, h: number): boolean {
    const xe = Math.min(this.w, x0 + w);
    const ye = Math.min(this.h, y0 + h);
    for (let y = Math.max(0, y0); y < ye; y++) {
      const o = y * this.w;
      for (let x = Math.max(0, x0); x < xe; x++) if (this.d[o + x] !== 0) return true;
    }
    return false;
  }
}

export interface Sprite {
  w: number;
  h: number;
  px: number[];
}

export function compile(rows: readonly string[], pal: Record<string, Color>): Sprite {
  const h = rows.length;
  const w = rows[0].length;
  const px: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch !== '.' && pal[ch] !== undefined) px.push(x, y, pal[ch]);
    }
  }
  return { w, h, px };
}

export function stamp(buf: Buf, s: Sprite, x: number, y: number, flip = false): void {
  x = Math.round(x);
  y = Math.round(y);
  for (let i = 0; i < s.px.length; i += 3) buf.px(flip ? x + s.w - 1 - s.px[i] : x + s.px[i], y + s.px[i + 1], s.px[i + 2]);
}

export function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x: number, y: number, s: number, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const wx = (i: number): number => (period ? ((i % period) + period) % period : i);
  const a = hash2(wx(xi), yi, s);
  const b = hash2(wx(xi + 1), yi, s);
  const c = hash2(wx(xi), yi + 1, s);
  const d = hash2(wx(xi + 1), yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, s: number, period = 0, oct = 4): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(x * f, y * f, s + o * 17, period ? period * f : 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Particules des planches (pixels ou petits carrés, couleur qui vieillit). */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  colors: readonly Color[];
  grav: number;
  drag: number;
  size: number;
}

export class Particles {
  readonly list: Particle[] = [];
  cap = 900;

  spawn(x: number, y: number, vx: number, vy: number, life: number, colors: readonly Color[], grav = 0, drag = 0, size = 1): void {
    if (this.list.length > this.cap) return;
    this.list.push({ x, y, vx, vy, life, max: life, colors, grav, drag, size });
  }

  burst(x: number, y: number, n: number, speed: number, colors: readonly Color[], life = 0.5, grav = 200, size = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + Math.random() * 0.5), colors, grav, 2, size);
    }
  }

  update(dt: number): void {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) {
        L[i] = L[L.length - 1];
        L.pop();
        continue;
      }
      p.vy += p.grav * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** Couleur courante d'une particule (elle vieillit le long de sa palette). */
  static colorOf(p: Particle): Color {
    const k = 1 - p.life / p.max;
    return p.colors[Math.min(p.colors.length - 1, Math.floor(k * p.colors.length))];
  }

  draw(buf: Buf, ox = 0, oy = 0): void {
    for (const p of this.list) {
      const c = Particles.colorOf(p);
      if (p.size > 1) buf.rect(p.x - ox, p.y - oy, p.size, p.size, c);
      else buf.px(p.x - ox, p.y - oy, c);
    }
  }

  clear(): void {
    this.list.length = 0;
  }
}
