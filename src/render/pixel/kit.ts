/**
 * Accessoires communs aux niveaux (design/planches/kit.js) : bois, pierre, surfaces lisses, pieux,
 * bannières, lanternes, pluie, nuages. Même grammaire de surfaces dans tous les thèmes :
 * arête claire = accrochable, reflets obliques froids = lisse, pointe rouge = mortel.
 */
import { Buf, C, dith, fbm, fsin, hash2, type Color } from './engine';

export interface WoodPalette {
  body: Color;
  top: Color;
  mid: Color;
  seam: Color;
  dark: Color;
  post: Color;
  postHi: Color;
  knot: Color;
}

export const WOOD: WoodPalette = {
  body: C('#4a2f1c'),
  top: C('#c48a54'),
  mid: C('#8a5a34'),
  seam: C('#2e1c11'),
  dark: C('#24160d'),
  post: C('#3a2517'),
  postHi: C('#5a3a22'),
  knot: C('#6b4428'),
};

export function planks(b: Buf, x: number, y: number, w: number, h: number, P: WoodPalette = WOOD): void {
  b.rect(x, y, w, h, P.body);
  b.hline(x, x + w - 1, y, P.top);
  b.hline(x, x + w - 1, y + 1, P.mid);
  b.hline(x, x + w - 1, y + h - 1, P.dark);
  for (let s = x + 5; s < x + w; s += 11) {
    b.rect(s, y + 2, 1, h - 3, P.seam);
    if (hash2(s, y, 3) > 0.6) b.px(s + 4, y + 3 + ((s * 7) % Math.max(1, h - 4)), P.knot);
  }
}

export function post(b: Buf, x: number, y0: number, y1: number, w = 4, P: WoodPalette = WOOD): void {
  b.rect(x, y0, w, y1 - y0, P.post);
  b.rect(x, y0, 1, y1 - y0, P.postHi);
  for (let y = y0 + 6; y < y1; y += 14) b.hline(x, x + w - 1, y, P.seam);
}

export function beam(b: Buf, x0: number, x1: number, y: number, h = 4, P: Pick<WoodPalette, 'post' | 'top' | 'dark'> = WOOD): void {
  b.rect(x0, y, x1 - x0, h, P.post);
  b.hline(x0, x1 - 1, y, P.top);
  b.hline(x0, x1 - 1, y + h - 1, P.dark);
}

/** Surface lisse (=) : reflets obliques froids, arête haute claire. Même grammaire dans tous les niveaux. */
export function slick(b: Buf, x: number, y: number, w: number, h: number, base: Color, gloss: Color, top: Color): void {
  b.rect(x, y, w, h, base);
  b.hline(x, x + w - 1, y, top);
  for (let j = 1; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if ((i + j) % 7 === 0 && hash2(x + i, y + j, 3) > 0.3) b.px(x + i, y + j, gloss);
    }
  }
}

/** Pieux mortels (^) : pointe rouge. */
export function stakes(b: Buf, x0: number, x1: number, yb: number, body: Color, hi: Color, tip: Color = C('#d94848'), hgt = 12): void {
  for (let x = x0; x <= x1; x += 6) {
    const hh = hgt + Math.floor(hash2(x, yb, 2) * 4);
    b.poly([x, yb, x + 3, yb - hh, x + 6, yb], body);
    b.line(x + 2, yb - 1, x + 3, yb - hh + 1, hi);
    b.px(x + 3, yb - hh, tip);
    b.px(x + 3, yb - hh + 1, tip);
    b.px(x + 2, yb - hh + 2, tip);
  }
}

export interface RockPalette {
  rock: Color;
  dk: Color;
  lt: Color;
  top: Color;
  moss?: Color;
}

/**
 * Masse rocheuse texturée : arête haute claire, mousse, grain au bruit. `bbox` borne le balayage
 * (les planches parcourent tout le calque, trop cher sur un niveau de 6720 px de large).
 */
export function rockMass(b: Buf, pts: readonly number[], P: RockPalette, seed = 7): void {
  b.poly(pts, P.rock);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  texturizeRock(b, Math.floor(x0), Math.floor(y0), Math.ceil(x1) + 1, Math.ceil(y1) + 1, P, seed);
}

/** Grain de roche sur tous les pixels `P.rock` d'une région (arête haute claire incluse). */
export function texturizeRock(b: Buf, x0: number, y0: number, x1: number, y1: number, P: RockPalette, seed = 7): void {
  const xs = Math.max(0, x0);
  const xe = Math.min(b.w, x1);
  const ys = Math.max(1, y0);
  const ye = Math.min(b.h, y1);
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      const i = y * b.w + x;
      if (b.d[i] !== P.rock) continue;
      if (b.d[i - b.w] === 0) b.d[i] = P.top;
      else if (y > 2 && b.d[i - 2 * b.w] === 0 && P.moss) b.d[i] = dith(x, y, P.rock, P.moss, 0.8);
      else {
        const n = fbm(x / 11, y / 7, seed);
        const crk = hash2(x, y, 9);
        b.d[i] = n > 0.62 ? P.lt : n < 0.38 ? P.dk : crk > 0.985 ? P.lt : P.rock;
      }
    }
  }
}

/** Bannière nobori : mât + tissu qui ondule sous le vent (colonne par colonne). */
export function banner(buf: Buf, x: number, y: number, h: number, t: number, cloth: Color, mark: Color, pole: Color): void {
  buf.rect(x, y - 2, 1, h + 22, pole);
  buf.hline(x, x + 6, y - 1, pole);
  for (let j = 0; j < h; j++) {
    const off = Math.round(fsin(t * 5 + j * 0.35 + x) * (j / h) * 1.6);
    for (let i = 1; i <= 6; i++) buf.px(x + i + off, y + j, j > 3 && j < h - 3 && i > 2 && i < 5 && j % 5 < 3 ? mark : cloth);
  }
}

export interface LanternPalette {
  rope: Color;
  glow: Color;
  cap: Color;
  body: Color;
  core: Color;
  rib: Color;
}

/** Point d'une chaînette (parabole) entre A et B avec une flèche `sag`. */
export function sagPoint(ax: number, ay: number, bx: number, by: number, sag: number, s: number): [number, number] {
  return [ax + (bx - ax) * s, ay + (by - ay) * s + sag * 4 * s * (1 - s)];
}

/** Corde de la guirlande seule (statique, cuite dans le décor). */
export function sagRope(buf: Buf, ax: number, ay: number, bx: number, by: number, sag: number, color: Color, steps = 40): void {
  let [px, py] = sagPoint(ax, ay, bx, by, sag, 0);
  for (let i = 1; i <= steps; i++) {
    const [x, y] = sagPoint(ax, ay, bx, by, sag, i / steps);
    buf.line(px, py, x, y, color);
    px = x;
    py = y;
  }
}

/**
 * Une lanterne suspendue (sans sa corde porteuse) : le point d'attache est (x, y), la lanterne se
 * balance de `swing` px. `alpha` : halo posé en semi-transparence (calque composé par le GPU).
 */
export function lantern(buf: Buf, x: number, y: number, swing: number, P: LanternPalette, alpha = false): void {
  const lx = x + swing;
  const ly = y + 3;
  if (alpha) buf.glowA(lx, ly + 3, 12, P.glow, 0.42);
  else buf.glow(lx, ly + 3, 12, P.glow, 0.42);
  buf.line(x, y, lx, ly, P.rope);
  buf.rect(lx - 2, ly, 4, 1, P.cap);
  buf.rect(lx - 2, ly + 1, 4, 5, P.body);
  buf.rect(lx - 1, ly + 2, 2, 3, P.core);
  buf.px(lx - 2, ly + 3, P.rib);
  buf.px(lx + 1, ly + 3, P.rib);
  buf.rect(lx - 2, ly + 6, 4, 1, P.cap);
  buf.px(lx, ly + 7, P.cap);
}

/** Guirlande de lanternes en chaînette, chaque lanterne se balance (version des planches). */
export function lanternString(buf: Buf, ax: number, ay: number, bx: number, by: number, sag: number, n: number, t: number, P: LanternPalette): void {
  sagRope(buf, ax, ay, bx, by, sag, P.rope);
  for (let i = 1; i <= n; i++) {
    const [x, y] = sagPoint(ax, ay, bx, by, sag, i / (n + 1));
    lantern(buf, x, y, fsin(t * 1.7 + i * 1.3) * 2, P);
  }
}

/** Nuages en bande périodique (`w` px) : trois tons, liseré optionnel sur le haut. */
export function clouds(seed: number, w: number, h: number, thr: number, tones: readonly Color[], lit: Color | null): Buf {
  const b = new Buf(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fall = Math.abs(y - h / 2) / (h / 2);
      const n = fbm(x / 64, y / 22, seed, w / 64) - fall * 0.38;
      if (n > thr + 0.13) b.d[y * w + x] = tones[2];
      else if (n > thr + 0.06) b.d[y * w + x] = tones[1];
      else if (n > thr) b.d[y * w + x] = dith(x, y, 0, tones[0], 0.75);
    }
  }
  if (lit) {
    for (let y = 1; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (b.d[i] && !b.d[i - w] && hash2(x, y, 4) > 0.2) b.d[i] = lit;
      }
    }
  }
  return b;
}

/** Remplace le haut de chaque silhouette `body` par `rim` (liseré de lumière d'un pixel). */
export function rimTop(b: Buf, body: Color, rim: Color, below: Color | null = null): void {
  for (let y = 1; y < b.h - 1; y++) {
    for (let x = 0; x < b.w; x++) {
      const i = y * b.w + x;
      if (b.d[i] !== body) continue;
      if (b.d[i - b.w] === 0) b.d[i] = rim;
      else if (below !== null && b.d[i + b.w] === 0) b.d[i] = below;
    }
  }
}

/**
 * Dessin périodique : appelle `draw(ox)` pour chaque copie visible d'un motif de période `period`
 * afin qu'un élément à cheval sur la couture apparaisse des deux côtés.
 */
export function wrapDraw(period: number, draw: (ox: number) => void): void {
  draw(0);
  draw(-period);
  draw(period);
}
