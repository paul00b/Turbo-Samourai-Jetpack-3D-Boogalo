/**
 * Forteresse de braise, runtime d'une vue : le fond vivant de la planche (scene-forge.js) porté en
 * couches Pixi. Ordre de la planche : ciel -> fumée lointaine -> colonne de fumée du cratère -> lueur
 * du cratère -> volcans et coulées -> éruptions -> fumée proche -> oni de basalte -> ville en feu ->
 * château en feu (flammes, bannières, flèches enflammées) -> braises qui montent, cendres qui
 * tombent. Au milieu : la lave des fosses, sous les pics (un effet ne cache jamais un danger).
 * Devant : des braises qui s'écartent de 26 px autour de chaque perso.
 *
 * Les lointains sont des bandes périodiques (WrapStrip) : aucune couture en boucle. Chaque plan a
 * sa parallaxe, horizontale ET verticale, et un aplat sous sa bande pour qu'aucun trou n'apparaisse
 * quand la caméra monte.
 */
import { Container, Filter, GlProgram, Graphics, Rectangle, Sprite, UniformGroup, type Texture } from 'pixi.js';
import { bayer, Buf, fsin, hash2, lerpC, type Color } from '../../../pixel/engine';
import { banner, clouds, rimTop } from '../../../pixel/kit';
import { ART_TILE, solidAt } from '../../levelShape';
import { textureFromBuf } from '../../textures';
import { CpuSprite, glowTexture, PixelBatch, SurfaceQuad, vec3Of, WrapStrip } from '../pixiKit';
import type { ThemeRuntime } from '../runtime';
import { horizonY, parallaxY, type ThemeFrame } from '../types';
import { flameFrames } from './paint';
import { K } from './palette';

const TAU = Math.PI * 2;
/** Horizon de la planche (px) : 45 px au-dessus de son sol (y = 262). */
const PH = 217;

// Profondeurs (parallaxe horizontale de la planche ; la verticale suit, un peu adoucie).
const PX_SM1 = 0.05;
const PX_VOLC = 0.12;
const PX_SM2 = 0.2;
const PX_ONI = 0.25;
const PX_TOWN = 0.35;
const PX_CASTLE = 0.55;
const PX_EMBER = 0.8;
const PX_FRONT = 1.3;
const PY_SKY = 0.03;
const PY_SM1 = 0.05;
const PY_VOLC = 0.1;
const PY_SM2 = 0.15;
const PY_ONI = 0.2;
const PY_TOWN = 0.28;
const PY_CASTLE = 0.42;

const SKY_H = 360;
const SMOKE_P = 1536;
const VOLC_P = 1440;
const VOLC_TOP = 60;
const VOLC_H = 196;
const TOWN_P = 1520;
const TOWN_TOP = 212;
const TOWN_H = 68;
const CASTLE_P = 1680;
const CASTLE_TOP = 92;
const CASTLE_H = 174;
const FLAME_N = 12;

// ------------------------------------------------------------------ lointains (statiques)

interface VolcanoDef {
  poly: number[];
  crater: [number, number] | null;
  flows: [number, number, number, number][];
  /** Disques de la colonne de fumée (0 : pas de fumée). */
  smoke: number;
  /** Décalage de l'éruption (s), null : pas d'éruption. */
  erupt: number | null;
  glowR: number;
}

const VOLCANOES: VolcanoDef[] = [
  { poly: [380, 250, 540, 86, 574, 82, 720, 250], crater: [558, 82], flows: [[552, 88, 1, -0.4], [562, 86, 2, 0.5], [570, 88, 4, 0.9]], smoke: 18, erupt: 0, glowR: 40 },
  { poly: [820, 250, 900, 110, 924, 104, 1020, 250], crater: [912, 106], flows: [[912, 106, 3, -0.3]], smoke: 0, erupt: null, glowR: 16 },
  { poly: [1110, 250, 1236, 98, 1258, 96, 1400, 250], crater: [1247, 97], flows: [[1244, 100, 5, 0.35], [1251, 99, 6, -0.55]], smoke: 11, erupt: 1.55, glowR: 26 },
  { poly: [-150, 250, 50, 158, 90, 152, 300, 250], crater: null, flows: [], smoke: 0, erupt: null, glowR: 0 },
];

interface FlowOverlay {
  x: number;
  y: number;
  frames: Texture[];
}

interface Statics {
  sky: Texture;
  sm1: Texture;
  sm2: Texture;
  volc: Texture;
  flows: FlowOverlay[];
  town: Texture;
  castle: Texture;
  craterGlow: Texture[];
  smallGlow: Texture[];
  discs: Map<number, Texture>;
  townFlame: Texture[];
  castleFlame: Texture[];
  banner: Texture[];
  arrowGlow: Texture;
}

let statics: Statics | null = null;

/** Liseré sous chaque nappe de fumée (la lueur du feu vient d'en bas), comme la planche. */
function smokeBand(seed: number, h: number, thr: number): Buf {
  const s = clouds(seed, SMOKE_P, h, thr, K.smoke, null);
  for (let y = s.h - 2; y >= 0; y--) {
    for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      if (s.d[i] && !s.d[i + s.w]) s.d[i] = K.smokeLit;
    }
  }
  return s;
}

function polyWrap(b: Buf, pts: readonly number[], c: Color, period: number): void {
  for (const off of [-period, 0, period]) b.poly(pts.map((v, i) => (i % 2 === 0 ? v + off : v)), c);
}

function flowPath(sx: number, sy: number, seed: number, drift: number): number[] {
  const path: number[] = [];
  let x = sx;
  let y = sy;
  while (y < 246) {
    path.push(Math.round(x), y);
    y += 1;
    x += (hash2(y, seed, 9) - 0.5) * 2 + drift;
  }
  return path;
}

function volcanoLayer(): { b: Buf; flows: FlowOverlay[] } {
  const b = new Buf(VOLC_P, VOLC_H);
  const local = (pts: readonly number[]): number[] => pts.map((v, i) => (i % 2 === 1 ? v - VOLC_TOP : v));
  for (const v of VOLCANOES) polyWrap(b, local(v.poly), K.volc, VOLC_P);
  // Plaine au pied des volcans (l'aplat du dessous la prolonge).
  b.rect(0, 250 - VOLC_TOP, VOLC_P, VOLC_H - (250 - VOLC_TOP), K.volc);
  rimTop(b, K.volc, K.volcRim);
  // Cratères : bouche rougeoyante.
  for (const v of VOLCANOES) {
    if (!v.crater) continue;
    const [cx, cy] = v.crater;
    for (let x = cx - 12; x <= cx + 12; x++) {
      for (let y = cy - VOLC_TOP; y < cy - VOLC_TOP + 4; y++) {
        const c = b.get(x, y);
        if (c === K.volc || c === K.volcRim) b.px(x, y, (x + y) % 3 === 0 ? K.flow[3] : K.flow[4]);
      }
    }
  }
  const flows: FlowOverlay[] = [];
  VOLCANOES.forEach((v) => {
    if (v.flows.length === 0) return;
    const paths = v.flows.map(([sx, sy, seed, drift]) => flowPath(sx, sy, seed, drift));
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of paths) {
      for (let i = 0; i < p.length; i += 2) {
        x0 = Math.min(x0, p[i]);
        x1 = Math.max(x1, p[i]);
        y0 = Math.min(y0, p[i + 1]);
        y1 = Math.max(y1, p[i + 1]);
      }
    }
    const frames: Texture[] = [];
    for (let q = 0; q < 4; q++) {
      const f = new Buf(x1 - x0 + 1, y1 - y0 + 1);
      paths.forEach((p, fi) => {
        for (let i = 0; i < p.length; i += 2) f.px(p[i] - x0, p[i + 1] - y0, K.flow[((i / 2 - q + fi * 7) & 3) + 1]);
      });
      frames.push(textureFromBuf(f, `forge-flow-${x0}-${q}`));
    }
    flows.push({ x: x0, y: y0 - VOLC_TOP, frames });
  });
  return { b, flows };
}

/** Ville en feu (périodique) : maisons de la planche, fenêtres qui rougeoient, lueur des incendies. */
function townLayer(): Buf {
  const b = new Buf(TOWN_P, TOWN_H);
  const Y = (y: number): number => y - TOWN_TOP;
  // Lueur des incendies derrière les toits (tramée, dans les valeurs sombres).
  for (const fx of TOWN_FLAMES) {
    for (let y = 0; y < TOWN_H; y++) {
      for (let dx = -40; dx <= 40; dx++) {
        const x = (((fx[0] + dx) % TOWN_P) + TOWN_P) % TOWN_P;
        const d = Math.hypot(dx / 1.6, y - Y(fx[1]));
        if (d > 26) continue;
        const k = (1 - d / 26) ** 2 * 0.7;
        if (k > bayer(x, y)) b.px(x, y, K.smokeGlow);
      }
    }
  }
  const house = (x: number): void => {
    const w = 22 + Math.floor(hash2(x, 1, 3) * 16);
    const y = Y(236 + Math.floor(hash2(x, 2, 3) * 10));
    for (const off of [0, -TOWN_P]) {
      b.rect(x + off + 3, y, w - 6, 30, K.town);
      b.poly([x + off, y + 1, x + off + w, y + 1, x + off + w - 6, y - 7, x + off + 6, y - 7], K.town);
    }
  };
  for (let x = 0; x < TOWN_P - 20; x += 26 + Math.floor(hash2(x, 0, 3) * 14)) house(x);
  b.rect(0, Y(256), TOWN_P, TOWN_H - Y(256), K.town);
  rimTop(b, K.town, K.townRim);
  // Fenêtres allumées çà et là (une maison sur trois).
  for (let k = 0; k < 60; k++) {
    const x = Math.floor(hash2(k, 7, 3) * TOWN_P);
    const y = Y(242 + Math.floor(hash2(k, 8, 3) * 12));
    if (b.get(x, y) === K.town && b.get(x + 2, y + 2) === K.town && b.get(x, y - 3) === K.town) b.rect(x, y, 2, 2, hash2(k, 9, 3) > 0.6 ? K.win : K.winDk);
  }
  return b;
}

const TOWN_FLAMES: [number, number][] = [[80, 236], [300, 232], [520, 238], [690, 234], [840, 236], [1060, 233], [1210, 238], [1390, 235]];

/** Donjon à étages de la planche (tower()) : base de pierre, étages, toits, fenêtres, shachi dorés. */
function tower(b: Buf, cx: number, base: number, w: number, tiers: number): void {
  const Y = (y: number): number => y - CASTLE_TOP;
  b.poly([cx - w / 2 - 10, Y(base), cx + w / 2 + 10, Y(base), cx + w / 2 - 2, Y(base - 36), cx - w / 2 + 2, Y(base - 36)], K.castle);
  let y = base - 36;
  let hw = w / 2;
  for (let i = 0; i < tiers; i++) {
    b.rect(cx - hw + 4, Y(y - 18), hw * 2 - 8, 18, K.castle);
    b.poly([cx - hw - 8, Y(y), cx + hw + 8, Y(y), cx + hw - 4, Y(y - 8), cx - hw + 4, Y(y - 8)], K.roof);
    if (i === 1) b.poly([cx - 10, Y(y - 8), cx + 10, Y(y - 8), cx, Y(y - 16)], K.roof);
    for (let x = cx - hw + 9; x < cx + hw - 9; x += 8) b.rect(x, Y(y - 15), 3, 4, hash2(x, y, 5) > 0.3 ? K.win : K.winDk);
    y -= 18;
    hw -= 8;
  }
  b.poly([cx - hw - 8, Y(y), cx + hw + 8, Y(y), cx, Y(y - 11)], K.roof);
  b.px(cx - hw - 6, Y(y - 2), K.gold);
  b.px(cx + hw + 6, Y(y - 2), K.gold);
  b.px(cx - hw - 7, Y(y - 3), K.gold);
  b.px(cx + hw + 7, Y(y - 3), K.gold);
}

/** Pagode à cinq toits (celle de la planche, à l'échelle du lointain). */
function pagoda(b: Buf, cx: number, base: number): void {
  const Y = (y: number): number => y - CASTLE_TOP;
  let top = base;
  for (let i = 0; i < 5; i++) {
    const y = base - i * 21;
    const hw = 16 - i * 2;
    b.rect(cx - hw, Y(y - 17), hw * 2, 17, K.castle);
    b.poly([cx - hw - 10, Y(y - 15), cx + hw + 10, Y(y - 15), cx + hw + 2, Y(y - 21), cx - hw - 2, Y(y - 21)], K.roof);
    for (let x = cx - hw + 3; x < cx + hw - 3; x += 5) b.rect(x, Y(y - 12), 2, 3, K.win);
    top = y - 21;
  }
  b.rect(cx - 1, Y(top - 13), 2, 13, K.gold);
  b.px(cx - 2, Y(top - 8), K.gold);
  b.px(cx + 1, Y(top - 8), K.gold);
}

/** Porte fortifiée (yagura-mon). */
function gatehouse(b: Buf, cx: number): void {
  const Y = (y: number): number => y - CASTLE_TOP;
  b.poly([cx - 62, Y(256), cx + 62, Y(256), cx + 52, Y(236), cx - 52, Y(236)], K.castle);
  b.rect(cx - 14, Y(240), 28, 16, K.roof);
  b.rect(cx - 12, Y(242), 24, 14, K.castleDk);
  b.rect(cx - 44, Y(214), 88, 22, K.castle);
  for (let x = cx - 38; x < cx + 38; x += 9) b.rect(x, Y(222), 3, 4, K.win);
  b.poly([cx - 56, Y(214), cx + 56, Y(214), cx + 42, Y(202), cx - 42, Y(202)], K.roof);
  b.rect(cx - 14, Y(190), 28, 12, K.castle);
  b.rect(cx - 6, Y(194), 3, 4, K.win);
  b.rect(cx + 3, Y(194), 3, 4, K.win);
  b.poly([cx - 24, Y(190), cx + 24, Y(190), cx, Y(180)], K.roof);
}

/** Pin mort, calciné, sur la crête. */
function deadPine(b: Buf, x: number, base: number, h: number, seed: number): void {
  const Y = (y: number): number => y - CASTLE_TOP;
  b.stroke(x, Y(base), x + 2, Y(base - h), 2, K.ridge);
  for (let k = 0; k < 4; k++) {
    const y = base - h * (0.35 + k * 0.17);
    const dir = k % 2 ? 1 : -1;
    const len = 6 + hash2(seed, k, 7) * 8;
    b.stroke(x + 1, Y(y), x + 1 + dir * len, Y(y - 3 - hash2(seed, k, 8) * 3), 1, K.ridge);
  }
}

function castleLayer(): Buf {
  const b = new Buf(CASTLE_P, CASTLE_H);
  const Y = (y: number): number => y - CASTLE_TOP;
  // Crête périodique (planche : 256 + sin(x * 0.07) * 3 + bruit).
  const pts: number[] = [0, CASTLE_H];
  for (let x = 0; x <= CASTLE_P; x += 12) {
    const u = (x / CASTLE_P) * TAU;
    pts.push(x, Y(256 + Math.round(Math.sin(u * 19) * 3 + hash2(x % CASTLE_P, 0, 12) * 4)));
  }
  pts.push(CASTLE_P, CASTLE_H);
  b.poly(pts, K.ridge);
  rimTop(b, K.ridge, K.volcRim);
  deadPine(b, 780, 258, 30, 1);
  deadPine(b, 842, 259, 22, 2);
  deadPine(b, 1600, 258, 34, 3);
  deadPine(b, 1648, 260, 20, 4);
  // Premier enceinte : celle de la planche (donjon à quatre étages entre deux tours).
  b.rect(150, Y(222), 540, 34, K.castle);
  b.rect(146, Y(218), 548, 4, K.roof);
  tower(b, 420, 250, 110, 4);
  tower(b, 150, 250, 60, 2);
  tower(b, 690, 250, 72, 3);
  // Seconde enceinte : pagode, porte fortifiée, deux tours.
  b.rect(930, Y(226), 560, 30, K.castle);
  b.rect(926, Y(222), 568, 4, K.roof);
  pagoda(b, 1020, 250);
  gatehouse(b, 1250);
  tower(b, 1470, 250, 64, 3);
  tower(b, 940, 250, 46, 2);
  // Grain de la pierre (planche), puis dessous des murs et des toits éclairés par le feu.
  for (let y = Y(214); y < Y(256); y += 6) {
    for (let x = 0; x < CASTLE_P; x++) if (b.d[y * CASTLE_P + x] === K.castle && hash2(x, y, 3) > 0.72) b.px(x, y, K.roof);
  }
  rimTop(b, K.castle, K.castle, K.under);
  rimTop(b, K.roof, K.roof, K.under);
  return b;
}

const CASTLE_FLAMES: [number, number][] = [[472, 158], [368, 176], [180, 196], [720, 178], [640, 214], [1022, 150], [1250, 200], [1470, 176], [1110, 222], [1380, 222]];
const CASTLE_BANNERS: number[] = [210, 280, 350, 490, 560, 630, 980, 1080, 1150, 1330, 1400];
const CASTLE_ARROWS: [number, number][] = [[150, 690], [960, 1500]];

function discKey(r: number): number {
  return Math.max(1, Math.round(r * 2)) / 2;
}

function discTexture(S: Map<number, Texture>, r: number): Texture {
  const key = discKey(r);
  let tex = S.get(key);
  if (!tex) {
    const ri = Math.ceil(key);
    const b = new Buf(ri * 2 + 1, ri * 2 + 1);
    b.disc(ri, ri, key, 0xffffffff);
    tex = textureFromBuf(b, `forge-disc-${key}`);
    S.set(key, tex);
  }
  return tex;
}

function getStatics(): Statics {
  if (statics) return statics;
  const sky = new Buf(64, SKY_H);
  sky.vgrad(0, SKY_H, K.sky);
  const vol = volcanoLayer();
  const bannerFrames: Texture[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(10, 40);
    banner(f, 0, 2, 16, ((k / 16) * TAU) / 5, K.cloth, K.clothMark, K.roof);
    bannerFrames.push(textureFromBuf(f, `forge-banner-${k}`));
  }
  const craterGlow: Texture[] = [];
  const smallGlow: Texture[] = [];
  for (let k = 0; k < 4; k++) {
    craterGlow.push(glowTexture(40, K.crater, 0.35 + k * 0.066, `forge-crater-${k}`));
    smallGlow.push(glowTexture(26, K.crater, 0.22 + k * 0.04, `forge-crater-s-${k}`));
  }
  statics = {
    sky: textureFromBuf(sky, 'forge-sky'),
    sm1: textureFromBuf(smokeBand(31, 90, 0.5), 'forge-sm1'),
    sm2: textureFromBuf(smokeBand(47, 70, 0.56), 'forge-sm2'),
    volc: textureFromBuf(vol.b, 'forge-volcanoes'),
    flows: vol.flows,
    town: textureFromBuf(townLayer(), 'forge-town'),
    castle: textureFromBuf(castleLayer(), 'forge-castle'),
    craterGlow,
    smallGlow,
    discs: new Map(),
    townFlame: flameFrames(FLAME_N, 1.3, 14).map((b, i) => textureFromBuf(b, `forge-tflame-${i}`)),
    castleFlame: flameFrames(FLAME_N, 1, 12).map((b, i) => textureFromBuf(b, `forge-cflame-${i}`)),
    banner: bannerFrames,
    arrowGlow: glowTexture(5, K.fire[1], 0.4, 'forge-arrow-glow'),
  };
  // Disques des colonnes de fumée (rayons de 3,5 à 38 px par demi-pixel), créés d'avance.
  for (let r = 3.5; r <= 38.5; r += 0.5) discTexture(statics.discs, r);
  return statics;
}

// ------------------------------------------------------------------ lave des fosses (GPU)

const LAVA = `
uniform float uCamY;
uniform float uSurf;
uniform vec3 uF0;
uniform vec3 uF1;
uniform vec3 uF2;
uniform vec3 uF3;
uniform vec3 uF4;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  vec2 p = pixel();
  float wx = p.x + uCamX;
  float wy = p.y + uCamY;
  float sy = floor(uSurf + sin(wx * 0.08 + uTime * 1.6) * 0.9 + sin(wx * 0.023 - uTime * 0.7) * 0.7 + 0.5);
  float d = wy - sy;
  // Bulles : une par cellule de 26 px, qui gonfle puis éclate en gouttes (planche).
  float cell = floor(wx / 26.0);
  float per = 1.8 + h1(cell) * 1.5;
  float ph = mod(uTime + h1(cell + 7.0) * per, per);
  float bx = cell * 26.0 + 13.0 + (h1(cell + 3.0) - 0.5) * 12.0;
  float by = uSurf + 2.0 + floor(h1(cell + 5.0) * 2.0);
  if (d < 0.0) {
    if (ph > per * 0.7) {
      float q = (ph - per * 0.7) / (per * 0.3);
      for (int k = 0; k < 5; k++) {
        float gx = floor(bx + (float(k) - 2.0) * 4.0 * q + 0.5);
        float gy = floor(by - 1.0 - 11.0 * q + 16.0 * q * q + 0.5);
        if (p.x + uCamX == gx && wy == gy) { finalColor = vec4(q < 0.5 ? uF1 : uF3, 1.0); return; }
      }
    }
    // Lueur tramée au-dessus de la surface (planche : 35 % de flow[2] qui s'éteint en montant),
    // qui frémit de chaleur : la trame glisse d'un pixel, rangée par rangée (le shimmer de la planche).
    float sh = floor(sin(wy * 0.7 + uTime * 6.0) * 0.6 + 0.5);
    float a = 0.42 * (1.0 + d / 7.0);
    if (a > bayer(p + vec2(sh, 0.0)) * 0.8) { finalColor = vec4(uF2 * 0.3, 0.3); return; }
    discard;
  }
  float n = sin(wx * 0.11 + wy * 0.4 - uTime * 2.2) + sin(wx * 0.05 - wy * 0.3 + uTime * 1.3);
  vec3 c = d < 1.0 ? uF0 : n > 1.2 ? uF1 : n > 0.2 ? uF2 : n > -0.9 ? uF3 : uF4;
  if (ph < per * 0.7) {
    float r = (ph / (per * 0.7)) * 2.6;
    vec2 q = vec2(wx - bx, wy - by);
    if (dot(q, q) <= r * r + r * 0.6) c = (q.x == -1.0 && q.y <= -r + 1.5) ? uF0 : uF1;
  }
  finalColor = vec4(c, 1.0);
}`;

function makeLavaQuad(): SurfaceQuad {
  return new SurfaceQuad(
    LAVA,
    {
      uCamY: { value: 0, type: 'f32' },
      uSurf: { value: 0, type: 'f32' },
      uF0: { value: vec3Of(K.flow[0]), type: 'vec3<f32>' },
      uF1: { value: vec3Of(K.flow[1]), type: 'vec3<f32>' },
      uF2: { value: vec3Of(K.flow[2]), type: 'vec3<f32>' },
      uF3: { value: vec3Of(K.flow[3]), type: 'vec3<f32>' },
      uF4: { value: vec3Of(K.flow[4]), type: 'vec3<f32>' },
    },
    'forge-lava',
  );
}

// ------------------------------------------------------------------ brume de chaleur (GPU)

const SHIMMER_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

/**
 * Shimmer de la planche : dans la bande des toits en feu, chaque rangée du FOND glisse d'un pixel
 * au rythme de sin(y * 0.7 + t * 6). Posé sur le seul conteneur de fond du thème : les tuiles, les
 * ennemis et le perso ne sont jamais déformés. Décalages entiers : aucun flou.
 */
const SHIMMER_FRAG = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform float uTime;
uniform float uY0;
uniform float uY1;
void main(void) {
  vec2 px = floor(vTextureCoord * uInputSize.xy);
  float y = px.y + uOutputFrame.y;
  float s = 0.0;
  if (y > uY0 && y < uY1) {
    float k = clamp(min(y - uY0, uY1 - y) / 12.0, 0.0, 1.0);
    s = floor(sin(y * 0.7 + uTime * 6.0) * 0.6 * k + 0.5);
  }
  finalColor = texture(uTexture, (px + vec2(s, 0.0) + 0.5) * uInputSize.zw);
}`;

function makeShimmer(): { filter: Filter; u: { uTime: number; uY0: number; uY1: number } } {
  const group = new UniformGroup({
    uTime: { value: 0, type: 'f32' },
    uY0: { value: 0, type: 'f32' },
    uY1: { value: 0, type: 'f32' },
  });
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: SHIMMER_VERT, fragment: SHIMMER_FRAG, name: 'forge-shimmer' }),
    resources: { shimmerUniforms: group },
  });
  return { filter, u: group.uniforms as { uTime: number; uY0: number; uY1: number } };
}

// ------------------------------------------------------------------ oni de basalte (CPU)

const OW = 216;
const OH = 196;
const OCX = 108;
const OCY = 100;

function veinsGen(): number[] {
  const v: number[] = [];
  for (let k = 0; k < 16; k++) {
    let x = (hash2(k, 1, 4) - 0.5) * 110;
    let y = -28 + hash2(k, 2, 4) * 90;
    for (let s = 0; s < 34; s++) {
      v.push(Math.round(x), Math.round(y), k);
      x += (hash2(k, s, 5) - 0.5) * 3.4;
      y += hash2(k, s, 6) * 1.8 - 0.35;
    }
  }
  return v;
}

class Oni {
  readonly canvas = new CpuSprite(OW, OH, 'forge-oni');
  private readonly veins = veinsGen();
  private readonly veinCols: Color[] = [];

  constructor() {
    for (let i = 0; i <= 16; i++) this.veinCols.push(lerpC(K.veinLo, K.veinHi, (i / 16) * 0.8));
  }

  /** (hx, hy) : centre de la tête à l'écran ; lookX : décalage des pupilles vers le perso. */
  draw(t: number, hx: number, hy: number, lookX: number): void {
    const buf = this.canvas.buf;
    buf.clear();
    const x = OCX;
    const y = OCY;
    // Rugissement lent toutes les 13 s : la mâchoire descend, la gueule rougeoie.
    const rq = (t % 13) / 13;
    const roar = rq > 0.82 ? Math.sin(((rq - 0.82) / 0.18) * Math.PI) : 0;
    const chew = Math.round(fsin(t * 0.8) * 2);
    const open = Math.round(roar * 7);
    const jaw = chew + open;
    buf.poly([x - 50, y - 30, x - 96, y - 92, x - 84, y - 36], K.oniRim);
    buf.poly([x + 50, y - 30, x + 96, y - 92, x + 84, y - 36], K.oniRim);
    // Anneaux des cornes, un ton plus sombre.
    for (const s of [-1, 1]) {
      for (let k = 1; k < 4; k++) {
        const u = k / 4;
        buf.stroke(x + s * (50 + 34 * u), y - 30 - 62 * u + 3, x + s * (84 - 4 * u), y - 36 - 56 * u + 2, 1, K.oni);
      }
    }
    buf.poly([x - 62, y - 36, x + 62, y - 36, x + 72, y + 30, x + 34, y + 84 + jaw, x - 34, y + 84 + jaw, x - 72, y + 30], K.oni);
    buf.hline(x - 61, x + 61, y - 36, K.oniRim);
    const V = this.veins;
    for (let i = 0; i < V.length; i += 3) {
      const k = 0.5 + 0.5 * fsin(t * 1.3 + V[i + 2] * 0.9);
      const col = this.veinCols[Math.min(16, Math.round((k + roar * 0.4 > 1 ? 1 : k + roar * 0.4) * 16))];
      buf.px(x + V[i], y + V[i + 1] + (V[i + 1] > 40 ? jaw : 0), col);
    }
    const pulse = 0.5 + 0.5 * fsin(t * 1.3);
    const blink = t % 6.7 < 0.16;
    for (const s of [-1, 1]) {
      buf.stroke(x + s * 12, y - 20, x + s * 44, y - 30, 3, K.oniRim);
      const ex = x + s * 26;
      const ey = y - 8;
      buf.glowA(ex, ey, 18, K.veinHi, 0.25 + pulse * 0.15 + roar * 0.12);
      if (blink) buf.hline(ex - 9, ex + 9, ey + 1, K.oniEye);
      else {
        buf.poly([ex - 11 * s, ey - 4, ex + 10 * s, ey + 2, ex - 8 * s, ey + 5], K.oniEye);
        buf.px(ex - 2 * s + lookX, ey + 1, K.oni);
        buf.px(ex - 2 * s + lookX, ey, K.oni);
      }
      // Naseaux et fumée qui en sort.
      buf.px(x + s * 9, y + 22, K.fg);
      buf.px(x + s * 10, y + 22, K.fg);
      const age = (t * 0.6 + (s > 0 ? 0.5 : 0)) % 1;
      buf.disc(x + s * 9 + age * 10 * s, y + 24 - age * 30, 1 + age * 4, K.smoke[age < 0.5 ? 2 : 1]);
    }
    // Lèvre du haut (bouge avec la mastication de la planche), lèvre du bas qui s'ouvre au rugissement.
    const upper = y + 46 + chew;
    const lower = upper + open;
    if (open > 0) {
      for (let yy = upper + 1; yy < lower + 1; yy++) {
        const k = (yy - upper) / Math.max(1, open);
        buf.hline(x - 30 + Math.round(k * 3), x + 30 - Math.round(k * 3), yy, k < 0.5 ? K.flow[4] : K.flow[3]);
      }
      for (let dx = -28; dx <= 28; dx++) buf.px(x + dx, lower + Math.round(fsin(dx * 0.4 + 1) * 1.2), K.veinHi);
    }
    for (let dx = -32; dx <= 32; dx++) buf.px(x + dx, upper + Math.round(fsin(dx * 0.4) * 1.5), K.veinHi);
    for (const f of [-24, -10, 10, 24]) buf.poly([x + f - 3, upper, x + f + 3, upper, x + f, upper + 8], K.fang);
    for (const f of [-17, 17]) buf.poly([x + f - 2, lower, x + f + 2, lower, x + f, lower - 6], K.fang);
    this.canvas.commit(hx - OCX, hy - OCY);
  }
}

// ------------------------------------------------------------------ runtime

class SpritePool {
  readonly view = new Container();
  private readonly list: Sprite[] = [];
  private used = 0;

  begin(): void {
    this.used = 0;
  }

  next(tex: Texture): Sprite {
    let s = this.list[this.used];
    if (!s) {
      s = new Sprite(tex);
      this.list.push(s);
      this.view.addChild(s);
    }
    this.used++;
    if (s.texture !== tex) s.texture = tex;
    s.visible = true;
    return s;
  }

  end(): void {
    for (let i = this.used; i < this.list.length; i++) this.list[i].visible = false;
  }
}

/** Positions (écran) des copies visibles d'un motif périodique : x = origine + k * période. */
function copies(offset: number, period: number, x0: number, viewW: number, w: number, fn: (sx: number) => void): void {
  const base = offset + x0;
  const k0 = Math.floor((-w - base) / period);
  for (let k = k0; base + k * period < viewW + w; k++) fn(base + k * period);
}

export function createForgeRuntime(): ThemeRuntime {
  const S = getStatics();
  const back = new Container();
  const mid = new Container();
  const front = new Container();

  const fills = new Graphics();
  const sky = new WrapStrip(S.sky);
  const sm1 = new WrapStrip(S.sm1);
  const craterSmoke = new SpritePool();
  const craterGlows = new SpritePool();
  const volc = new WrapStrip(S.volc);
  const volcFill = new Graphics();
  const flowSprites = new SpritePool();
  const erupt = new PixelBatch();
  const sm2 = new WrapStrip(S.sm2);
  const oni = new Oni();
  const town = new WrapStrip(S.town);
  const townFill = new Graphics();
  const townFlames = new SpritePool();
  const castle = new WrapStrip(S.castle);
  const castleFill = new Graphics();
  const castleFlames = new SpritePool();
  const banners = new SpritePool();
  const arrows = new PixelBatch();
  const arrowGlows = new SpritePool();
  const embers = new PixelBatch();
  back.addChild(
    fills,
    sky.view,
    sm1.view,
    craterSmoke.view,
    craterGlows.view,
    volc.view,
    volcFill,
    flowSprites.view,
    erupt.g,
    sm2.view,
    oni.canvas.sprite,
    town.view,
    townFill,
    townFlames.view,
    castle.view,
    castleFill,
    castleFlames.view,
    banners.view,
    arrows.g,
    arrowGlows.view,
    embers.g,
  );

  const shimmer = makeShimmer();
  const filterArea = new Rectangle(0, 0, 1, 1);
  back.filters = [shimmer.filter];
  back.filterArea = filterArea;

  const lavaQuads: SurfaceQuad[] = [];
  const lava = new Container();
  mid.addChild(lava);

  const sparks = new PixelBatch();
  front.addChild(sparks.g);

  return {
    back,
    mid,
    front,
    update(f: ThemeFrame): void {
      const { t, camX, camY, viewW, viewH, shape } = f;
      const hy0 = horizonY(shape);
      const hz = (py: number): number => Math.round(parallaxY(f, hy0, py));
      const area = Math.min(3, (viewW * viewH) / (640 * 360));

      // Ciel : dégradé de la planche (horizon à 217 px du haut), aplat au-dessus et en dessous.
      const hzSky = hz(PY_SKY);
      const skyTop = hzSky - PH;
      fills.clear();
      if (skyTop > 0) fills.rect(0, 0, viewW, skyTop).fill(0x12070a);
      if (skyTop + SKY_H < viewH) fills.rect(0, skyTop + SKY_H, viewW, viewH - skyTop - SKY_H).fill(0xa8401a);
      sky.place(0, skyTop, viewW);
      sm1.place(-t * 4 - camX * PX_SM1, hz(PY_SM1) - PH + 10, viewW);

      // Volcans : bande périodique, coulées (4 frames à 14 i/s), cratères, fumée, éruptions.
      const hzV = hz(PY_VOLC);
      const volOff = -camX * PX_VOLC;
      const volTop = hzV - PH + VOLC_TOP;
      volc.place(volOff, volTop, viewW);
      volcFill.clear();
      const volBottom = volTop + VOLC_H;
      if (volBottom < viewH) volcFill.rect(0, volBottom, viewW, viewH - volBottom).fill(0x1c0b0b);
      flowSprites.begin();
      const fq = Math.floor(t * 14) & 3;
      for (const fl of S.flows) {
        copies(volOff, VOLC_P, fl.x, viewW, fl.frames[0].width, (sx) => {
          const sp = flowSprites.next(fl.frames[fq]);
          sp.position.set(Math.round(sx), volTop + fl.y);
        });
      }
      flowSprites.end();
      craterSmoke.begin();
      craterGlows.begin();
      erupt.clear();
      for (const v of VOLCANOES) {
        if (!v.crater) continue;
        const [cxs, cys] = v.crater;
        copies(volOff, VOLC_P, cxs, viewW, 200, (crx) => {
          const cry = volTop + cys - VOLC_TOP;
          // Colonne de fumée (disques de la planche, poussés par le vent).
          for (let i = 0; i < v.smoke; i++) {
            const age = (t * 0.12 + i / v.smoke) % 1;
            const big = v.smoke > 12;
            const x = crx + age * (big ? 90 : 60) + fsin(i * 1.7 + t * 0.3) * (big ? 10 : 6);
            const y = cry - 2 - age * (big ? 150 : 100);
            const r = (big ? 8 : 5) + age * (big ? 30 : 18);
            const a = craterSmoke.next(discTexture(S.discs, r));
            a.tint = 0x261211;
            a.position.set(Math.round(x) - Math.ceil(discKey(r)), Math.round(y) - Math.ceil(discKey(r)));
            const r2 = r * 0.7;
            const b2 = craterSmoke.next(discTexture(S.discs, r2));
            b2.tint = age < 0.3 ? 0x45211a : 0x341915;
            b2.position.set(Math.round(x - 2) - Math.ceil(discKey(r2)), Math.round(y - 2) - Math.ceil(discKey(r2)));
          }
          const pulse = 0.5 + 0.5 * fsin(t * 2 + cxs);
          const lvl = Math.min(3, Math.floor(pulse * 4));
          const gl = craterGlows.next(v.glowR >= 40 ? S.craterGlow[lvl] : S.smallGlow[lvl]);
          const gr = v.glowR >= 40 ? 40 : 26;
          gl.visible = v.glowR > 16;
          gl.position.set(Math.round(crx) - gr, cry - gr);
          if (v.erupt === null) return;
          // Éruption toutes les 3,1 s : gerbe de blocs incandescents.
          const tt = t + v.erupt;
          const te = tt % 3.1;
          const n = v.smoke > 12 ? 12 : 7;
          for (let i = 0; i < n; i++) {
            const bvx = (hash2(i, Math.floor(tt / 3.1) + cxs, 3) - 0.5) * 80;
            const bvy = -70 - hash2(i, 5, 3) * 60;
            const x = crx + bvx * te;
            const y = cry + bvy * te + 45 * te * te;
            if (y < volTop + 250 - VOLC_TOP) {
              erupt.rect(x, y, 2, 2, K.flow[1]);
              erupt.px(x - bvx * 0.03, y + 2, K.flow[3]);
            }
          }
        });
      }
      craterSmoke.end();
      craterGlows.end();
      erupt.flush();

      sm2.place(-t * 9 - camX * PX_SM2, hz(PY_SM2) - PH + 70, viewW);

      // Oni : une apparition tous les 1150 px de parallaxe, celle qui est la plus proche.
      const span = 1150;
      const baseO = camX * PX_ONI + viewW / 2;
      const inst = Math.round((baseO - 700) / span);
      const ox = inst * span + 700 - camX * PX_ONI;
      const oy = hz(PY_ONI) - 89 + fsin(t * 0.4) * 2;
      let lookX = 0;
      let best = Infinity;
      for (const h of f.heroes) {
        const sx = h.x - camX;
        if (Math.abs(sx - ox) < best) {
          best = Math.abs(sx - ox);
          lookX = Math.max(-2, Math.min(2, Math.round((sx - ox) / 80)));
        }
      }
      const oniVisible = ox > -OW && ox < viewW + OW;
      oni.canvas.sprite.visible = oniVisible;
      if (oniVisible) oni.draw(t, ox, oy, lookX);

      // Ville en feu.
      const hzT = hz(PY_TOWN);
      const townOff = -camX * PX_TOWN;
      const townTop = hzT - PH + TOWN_TOP;
      town.place(townOff, townTop, viewW);
      townFill.clear();
      if (townTop + TOWN_H < viewH) townFill.rect(0, townTop + TOWN_H, viewW, viewH - townTop - TOWN_H).fill(0x1d0d0c);
      townFlames.begin();
      for (const [fx, fy] of TOWN_FLAMES) {
        copies(townOff, TOWN_P, fx, viewW, 20, (sx) => {
          const fi = Math.floor(((((t * 9 + fx) % TAU) + TAU) % TAU) / TAU * FLAME_N) % FLAME_N;
          const sp = townFlames.next(S.townFlame[fi]);
          sp.position.set(Math.round(sx) - 14, townTop + fy - TOWN_TOP - 17);
        });
      }
      townFlames.end();

      // Château en feu : flammes sur les toits, bannières sur le mur, flèches enflammées.
      const hzC = hz(PY_CASTLE);
      const casOff = -camX * PX_CASTLE;
      const casTop = hzC - PH + CASTLE_TOP;
      castle.place(casOff, casTop, viewW);
      castleFill.clear();
      if (casTop + CASTLE_H < viewH) castleFill.rect(0, casTop + CASTLE_H, viewW, viewH - casTop - CASTLE_H).fill(0x1a0c0b);
      castleFlames.begin();
      for (const [fx, fy] of CASTLE_FLAMES) {
        copies(casOff, CASTLE_P, fx, viewW, 20, (sx) => {
          const fi = Math.floor(((((t * 9 + fx) % TAU) + TAU) % TAU) / TAU * FLAME_N) % FLAME_N;
          const sp = castleFlames.next(S.castleFlame[fi]);
          sp.position.set(Math.round(sx) - 12, casTop + fy - CASTLE_TOP - 15);
        });
      }
      castleFlames.end();
      banners.begin();
      CASTLE_BANNERS.forEach((bx, i) => {
        copies(casOff, CASTLE_P, bx, viewW, 12, (sx) => {
          const fi = Math.floor(((((t + i) * 5 + bx) % TAU) + TAU) % TAU / TAU * 16) % 16;
          const sp = banners.next(S.banner[fi]);
          sp.position.set(Math.round(sx), casTop + 200 - CASTLE_TOP - 2);
        });
      });
      banners.end();
      arrows.clear();
      arrowGlows.begin();
      CASTLE_ARROWS.forEach(([a0, a1], ci) => {
        copies(casOff, CASTLE_P, a0, viewW, a1 - a0 + 40, (sx0) => {
          for (let i = 0; i < 3; i++) {
            const q = (t * 0.35 + i / 3 + ci * 0.17) % 1;
            const pos = (qq: number): [number, number] => [sx0 + qq * (a1 - a0), casTop + 200 - CASTLE_TOP - fsin(qq * Math.PI) * 120];
            for (let k = 1; k < 10; k++) {
              const [xk, yk] = pos(q - k * 0.006);
              arrows.px(xk, yk, K.fire[Math.min(3, k >> 1)]);
            }
            const [x, y] = pos(q);
            arrows.px(x, y, K.fire[0]);
            arrowGlows.next(S.arrowGlow).position.set(Math.round(x) - 5, Math.round(y) - 5);
          }
        });
      });
      arrows.flush();
      arrowGlows.end();

      // Brume de chaleur sur le mur d'enceinte et la crête, juste au-dessus du chemin de ronde
      // (jusqu'au sol, cachée ensuite par la cave). Les fenêtres du donjon restent nettes.
      filterArea.width = viewW;
      filterArea.height = viewH;
      shimmer.u.uTime = t;
      shimmer.u.uY0 = casTop + 204 - CASTLE_TOP;
      shimmer.u.uY1 = Math.min(viewH, casTop + CASTLE_H + 24);

      // Braises qui montent (parallaxe 0,8), cendres qui tombent.
      embers.clear();
      const pw = viewW + 80;
      const ph = viewH + 40;
      const nEmber = Math.round(110 * area);
      for (let i = 0; i < nEmber; i++) {
        const v = 18 + hash2(i, 1, 9) * 30;
        const y = viewH + 20 - ((((t * v + hash2(i, 2, 9) * ph + camY * PX_EMBER) % ph) + ph) % ph);
        const x = ((((hash2(i, 3, 9) * pw - camX * PX_EMBER + fsin(t * 2 + i) * 5) % pw) + pw) % pw) - 40;
        embers.px(x, y, i % 5 === 0 ? K.ash : K.ember[i % 3]);
      }
      const nAsh = Math.round(36 * area);
      for (let i = 0; i < nAsh; i++) {
        const v = 7 + hash2(i, 4, 19) * 9;
        const y = ((((t * v + hash2(i, 5, 19) * ph - camY * 0.7) % ph) + ph) % ph) - 20;
        const x = ((((hash2(i, 6, 19) * pw - camX * 0.7 + fsin(t * 0.9 + i * 1.3) * 9) % pw) + pw) % pw) - 40;
        embers.px(x, y, i % 3 === 0 ? K.smoke[2] : K.ash);
      }
      embers.flush();

      // Milieu : la lave des fosses, sous les pics.
      let li = 0;
      for (const run of shape.spikes) {
        const X0 = run.x0 * ART_TILE - camX;
        const W = (run.x1 - run.x0 + 1) * ART_TILE;
        const Y = run.y * ART_TILE - camY;
        if (X0 > viewW || X0 + W < 0 || Y > viewH || Y + ART_TILE < 0) continue;
        if (!solidAt(shape, run.x0, run.y + 1) && !solidAt(shape, run.x1, run.y + 1)) continue;
        let q = lavaQuads[li];
        if (!q) {
          q = makeLavaQuad();
          lavaQuads.push(q);
          lava.addChild(q.mesh);
        }
        li++;
        q.mesh.visible = true;
        const u = q.u as { uCamY: number; uSurf: number };
        u.uCamY = camY;
        u.uSurf = run.y * ART_TILE + 11;
        q.place(X0, Y, W, ART_TILE, t, camX);
      }
      for (let i = li; i < lavaQuads.length; i++) lavaQuads[i].mesh.visible = false;

      // Devant : braises (parallaxe 1,3) qui s'écartent de 26 px autour de chaque perso.
      sparks.clear();
      const avoid = f.heroes.map((h) => ({ x: h.x - camX, y: h.y - camY - 4 }));
      const nSpark = Math.round(26 * area);
      for (let i = 0; i < nSpark; i++) {
        const v = 40 + hash2(i, 1, 13) * 40;
        const y = viewH + 20 - ((((t * v + hash2(i, 2, 13) * ph + camY * PX_FRONT) % ph) + ph) % ph);
        const x = ((((hash2(i, 3, 13) * pw - camX * PX_FRONT) % pw) + pw) % pw) - 40;
        let skip = false;
        for (const a of avoid) if ((x - a.x) * (x - a.x) + (y - a.y) * (y - a.y) < 26 * 26) skip = true;
        if (!skip) sparks.rect(x, y, 2, 2, K.ember[i % 2]);
      }
      sparks.flush();
    },
    destroy(): void {
      oni.canvas.destroy();
      back.filters = [];
      shimmer.filter.destroy();
      for (const q of lavaQuads) q.mesh.destroy();
      back.destroy({ children: true });
      mid.destroy({ children: true });
      front.destroy({ children: true });
    },
  };
}
