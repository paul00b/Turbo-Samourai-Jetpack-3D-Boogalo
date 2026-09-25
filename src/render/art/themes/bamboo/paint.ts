/**
 * Bambouseraie maudite, peintre de carte (pur). La planche est une scène composée à la main ; ici la
 * même grammaire habille n'importe quelle carte :
 *   - accrochable (#) = PIERRE MOUSSUE : blocs à joints décalés (stoneBlock de la planche), arête
 *     haute de mousse claire et coulures de mousse. Chaque face exposée porte une arête claire.
 *     Les ancrages flottants sont des linteaux de pierre tenus par des lianes, des poutres liées à un
 *     bambou géant, ou des kasagi de torii dont les piliers se perdent dans la brume.
 *   - lisse (=) = laque noire à reflets obliques lavande.
 *   - mortel (^) = épines pâles à pointe rouge, plantées dans les ronces au fond des ruines.
 * Sous le sol principal : ruines souterraines en arcades, racines, puits de lune sous les trous.
 * Le décor reste dans les valeurs sombres ; seuls les arêtes, le papier et les lueurs montent.
 */
import { T_SLICK, T_SOLID } from '../../../../sim';
import { Buf, dith, fbm, fsin, hash2, type Color } from '../../../pixel/engine';
import { sagPoint } from '../../../pixel/kit';
import { ART_TILE, nearGameplay, regionAt, solidAt, type LevelShape, type Region } from '../../levelShape';
import {
  deckSpots,
  FACE_BOTTOM,
  FACE_LEFT,
  FACE_RIGHT,
  FACE_TOP,
  floatingBlocks,
  forEachSolid,
  goalArt,
  isCaveAir,
  lightVeil,
  rowPairs,
  slickTile,
  type SolidTile,
} from '../paintKit';
import type { LevelCanvases, PropAnim, PropInstance } from '../types';
import { K } from './palette';

const T = ART_TILE;
const TAU = Math.PI * 2;

type FloatStyle = 'stone' | 'wood' | 'torii';

interface Ctx {
  shape: LevelShape;
  /** Rangée du haut de la colonne pleine de chaque tuile (-1 : vide) : les joints suivent la surface. */
  runTop: Int16Array;
  /** Style de chaque ancrage flottant accrochable (id de région). */
  style: Map<number, FloatStyle>;
  /** Abscisses (px d'art, centre) des ligatures de chaque poutre liée à un bambou géant. */
  lash: Map<number, number[]>;
  /** Centres (px d'art) des bambous géants déjà plantés. */
  stalks: number[];
}

function isFloat(r: Region | null): boolean {
  return !!r && (r.kind === 'float' || r.kind === 'slab');
}

function pickStyle(r: Region): FloatStyle {
  const w = r.x1 - r.x0 + 1;
  const v = hash2(r.x0 * 7 + 3, r.y0 * 13 + 1, 77);
  if (w >= 5) return v < 0.62 ? 'torii' : 'wood';
  if (w === 4) return v < 0.4 ? 'torii' : v < 0.72 ? 'wood' : 'stone';
  if (w === 3) return v < 0.2 ? 'torii' : v < 0.62 ? 'wood' : 'stone';
  return v < 0.52 ? 'wood' : 'stone';
}

/** Haut (px d'art) du premier plein « de cadre » au-dessus de (tx, ty) : on traverse les ancrages. */
function frameAbove(shape: LevelShape, tx: number, ty: number): number {
  for (let y = ty; y >= 0; y--) {
    if (!solidAt(shape, tx, y)) continue;
    if (!isFloat(regionAt(shape, tx, y))) return (y + 1) * T;
  }
  return 0;
}

/** Haut (px d'art) du premier plein « de cadre » sous (tx, ty). */
function frameBelow(shape: LevelShape, tx: number, ty: number): number {
  for (let y = ty; y < shape.h; y++) {
    if (!solidAt(shape, tx, y)) continue;
    if (!isFloat(regionAt(shape, tx, y))) return y * T;
  }
  return shape.ph;
}

function makeCtx(shape: LevelShape): Ctx {
  const runTop = new Int16Array(shape.w * shape.h).fill(-1);
  for (let tx = 0; tx < shape.w; tx++) {
    let top = -1;
    for (let ty = 0; ty < shape.h; ty++) {
      if (solidAt(shape, tx, ty)) {
        if (top < 0) top = ty;
        runTop[ty * shape.w + tx] = top;
      } else top = -1;
    }
  }
  const ctx: Ctx = { shape, runTop, style: new Map(), lash: new Map(), stalks: [] };
  const floats = floatingBlocks(shape).sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  for (const r of floats) ctx.style.set(r.id, pickStyle(r));
  // Poutres liées : un bambou géant passe derrière, s'il n'y en a pas déjà un tout près.
  for (const r of floats) {
    if (ctx.style.get(r.id) !== 'wood') continue;
    const X = r.x0 * T;
    const W = (r.x1 - r.x0 + 1) * T;
    const want = W >= 7 * T ? [X + Math.round(W * 0.25), X + Math.round(W * 0.75)] : [X + Math.round(W * (0.3 + hash2(r.x0, r.y0, 78) * 0.4))];
    const got: number[] = [];
    for (const cx of want) {
      if (ctx.stalks.some((s) => Math.abs(s - cx) < 76)) continue;
      ctx.stalks.push(cx);
      got.push(cx);
    }
    if (got.length) ctx.lash.set(r.id, got);
  }
  return ctx;
}

// ------------------------------------------------------------------ pierre moussue (accrochable)

/** Grain de roche de la planche (rockMass) : fbm monde, taches claires et sombres, éclats. */
function grain(x: number, y: number): Color {
  const n = fbm(x / 11, y / 7, 7, 0, 3);
  if (n > 0.62) return K.stone.lt;
  if (n < 0.38) return K.stone.dk;
  return hash2(x, y, 9) > 0.985 ? K.stone.lt : K.stone.rock;
}

/**
 * Bloc de pierre à joints (stoneBlock de la planche) : assises de 9 px comptées depuis la surface,
 * joints verticaux tous les 16 px décalés d'une assise à l'autre, le joint saute les taches sombres.
 */
function stoneTile(b: Buf, s: SolidTile, topRow: number): void {
  const topY = topRow * T;
  for (let y = s.Y; y < s.Y + T; y++) {
    const d = y - topY;
    const q = d + 2;
    const band = Math.floor(q / 9);
    const inBand = q - band * 9;
    const jx = band & 1 ? 7 : 0;
    for (let x = s.X; x < s.X + T; x++) {
      let c = grain(x, y);
      if (d >= 2) {
        if (inBand === 8) {
          if (c !== K.stone.dk) c = K.mortar;
        } else if ((x & 15) === jx) c = K.mortar;
      }
      b.px(x, y, c);
    }
  }
  mossEdges(b, s);
}

/** Arête latérale : mousse claire par touffes de 4 px, pierre claire entre deux, mousse dessous. */
function sideEdge(b: Buf, x: number, inner: number, Y: number, faces: number): void {
  for (let y = Y; y < Y + T; y++) {
    if (faces & FACE_TOP && y < Y + 2) continue;
    b.px(x, y, hash2(x, y >> 2, 13) > 0.18 ? K.stone.top : K.stoneHi);
    if (hash2(inner, y, 14) > 0.5) b.px(inner, y, K.stone.moss);
  }
}

/** Arêtes claires de mousse sur chaque face exposée : c'est la mousse qui dit « on s'accroche ici ». */
function mossEdges(b: Buf, s: SolidTile): void {
  const { X, Y, faces } = s;
  const x1 = X + T - 1;
  const y1 = Y + T - 1;
  if (faces & FACE_LEFT) sideEdge(b, X, X + 1, Y, faces);
  if (faces & FACE_RIGHT) sideEdge(b, x1, x1 - 1, Y, faces);
  if (faces & FACE_BOTTOM) {
    for (let x = X; x < X + T; x++) {
      b.px(x, y1, hash2(x >> 2, y1, 15) > 0.18 ? K.stone.top : K.stoneHi);
      if (hash2(x, y1, 16) > 0.45) b.px(x, y1 - 1, K.stone.moss);
    }
    if (faces & FACE_LEFT) b.px(X, y1, 0);
    if (faces & FACE_RIGHT) b.px(x1, y1, 0);
  }
  if (faces & FACE_TOP) {
    for (let x = X; x < X + T; x++) {
      b.px(x, Y, K.stone.top);
      b.px(x, Y + 1, dith(x, Y + 1, K.stone.rock, K.stone.moss, 0.8));
      if (hash2(x, Y, 5) > 0.7) {
        const len = 1 + Math.floor(hash2(x, Y, 6) * 6);
        for (let j = 0; j < len; j++) b.px(x, Y + 2 + j, K.stone.moss);
      }
    }
    // Coins arrondis d'un pixel, l'arête claire tourne avec eux.
    if (faces & FACE_LEFT) {
      b.px(X, Y, 0);
      b.px(X, Y + 1, K.stone.top);
    }
    if (faces & FACE_RIGHT) {
      b.px(x1, Y, 0);
      b.px(x1, Y + 1, K.stone.top);
    }
  }
}

// ------------------------------------------------------------------ ancrages flottants

/** Poutre de planches liées (le KIT.beam de la planche, épaissi) : ligatures de corde au bambou. */
function woodFloat(b: Buf, r: Region, lashes: readonly number[]): void {
  const X = r.x0 * T;
  const Y = r.y0 * T;
  const W = (r.x1 - r.x0 + 1) * T;
  const H = (r.y1 - r.y0 + 1) * T;
  for (let y = Y; y < Y + H; y++) {
    const j = y - Y;
    const board = Math.floor((j - 1) / 5);
    const k = j - 1 - board * 5;
    for (let x = X; x < X + W; x++) {
      let c: Color;
      if (j === 0) c = K.plankTop;
      else if (j === H - 1) c = K.plankMid;
      else if (k === 0) c = K.plankMid;
      else if (k === 4) c = K.plankDk;
      else {
        c = K.plank;
        if (hash2(x >> 2, y, 21) > 0.87) c = K.ropeDk;
        if (hash2(x, board + Y, 23) > 0.955 && x > X + 3 && x < X + W - 4) c = K.plankDk;
        else if (k === 2 && hash2(x, board + Y, 24) > 0.985) c = K.plankDk;
      }
      b.px(x, y, c);
    }
  }
  // Bouts des planches : bois de bout éclairé, arête claire sur les côtés.
  for (let y = Y + 1; y < Y + H - 1; y++) {
    b.px(X, y, K.plankMid);
    b.px(X + W - 1, y, K.plankMid);
    if ((y - Y - 1) % 5 === 4) {
      b.px(X + 1, y, K.plankDk);
      b.px(X + W - 2, y, K.plankDk);
    }
  }
  // Touffes de mousse sur le dessus (la mousse du thème, l'arête reste claire).
  for (let x = X + 1; x < X + W - 1; x++) {
    if (hash2(x, Y, 31) > 0.86) {
      b.px(x, Y, K.stone.top);
      if (hash2(x, Y, 32) > 0.4) b.px(x, Y + 1, K.stone.moss);
      if (hash2(x, Y, 33) > 0.7) b.px(x, Y + 2, K.stone.moss);
    }
  }
  // Ligatures : corde torsadée qui enserre la poutre à l'endroit du bambou.
  for (const lx of lashes) {
    for (let x = lx - 3; x <= lx + 3; x++) {
      for (let y = Y; y < Y + H; y++) {
        const j = y - Y;
        let c: Color = ((x - lx + j) & 3) === 0 ? K.ropeDk : K.rope;
        if (j === 0 || j === H - 1) c = K.ropeHi;
        if (x === lx - 3 || x === lx + 3) c = j === 0 ? K.ropeHi : K.ropeDk;
        b.px(x, y, c);
      }
    }
  }
}

/** Kasagi de torii en pierre : arête de mousse, face avant éclairée, ombre, shimaki plus court. */
function toriiFloat(b: Buf, r: Region): void {
  const X = r.x0 * T;
  const Y = r.y0 * T;
  const W = (r.x1 - r.x0 + 1) * T;
  const H = (r.y1 - r.y0 + 1) * T;
  for (let y = Y; y < Y + H; y++) {
    const j = y - Y;
    for (let x = X; x < X + W; x++) {
      const i = x - X;
      let c = grain(x, y);
      if (j === 0) c = K.stone.top;
      else if (j === 1) c = dith(x, y, K.stone.rock, K.stone.moss, 0.8);
      else if (j <= 6) {
        if (c === K.stone.dk) c = K.stone.rock;
        else if (c === K.stone.rock && hash2(x, y, 41) > 0.55) c = K.stone.lt;
        if (j === 2 && hash2(x, y, 42) > 0.5) c = K.stoneHi;
      } else if (j === 7) c = K.mortar;
      else if (i < 3 || i >= W - 3) c = j === H - 1 ? K.stone.dk : K.mortar;
      else if (j === 8) c = K.stone.dk;
      else if (H >= 2 * T && j >= 14 && Math.abs(i - W / 2) < 5) c = j === 14 || Math.abs(i - W / 2) >= 4 ? K.mortar : K.stone.dk;
      if (j === H - 1 && i >= 3 && i < W - 3) c = hash2(x >> 2, y, 15) > 0.18 ? K.stone.top : K.stoneHi;
      b.px(x, y, c);
    }
  }
  // Coulures de mousse sous l'arête, côtés éclairés.
  for (let x = X; x < X + W; x++) {
    if (hash2(x, Y, 5) > 0.72) {
      const len = 1 + Math.floor(hash2(x, Y, 6) * 4);
      for (let j = 0; j < len; j++) b.px(x, Y + 2 + j, K.stone.moss);
    }
  }
  for (let y = Y + 1; y < Y + 8; y++) {
    b.px(X, y, K.stone.top);
    b.px(X + W - 1, y, K.stone.top);
  }
  for (let y = Y + 8; y < Y + H - 1; y++) {
    b.px(X + 3, y, hash2(X, y >> 2, 13) > 0.3 ? K.stoneHi : K.stone.top);
    b.px(X + W - 4, y, hash2(X + W, y >> 2, 13) > 0.3 ? K.stoneHi : K.stone.top);
  }
  b.px(X, Y, 0);
  b.px(X + W - 1, Y, 0);
}

// ------------------------------------------------------------------ laque (lisse)

function lacquerTile(b: Buf, s: SolidTile): void {
  slickTile(b, s, { base: K.lacq, gloss: K.gloss, top: K.lacqTop, edge: K.lacqEdge });
  // Second reflet, plus discret, entre les diagonales : la laque a de la profondeur.
  for (let y = s.Y + 1; y < s.Y + T - 1; y++) {
    for (let x = s.X + 1; x < s.X + T - 1; x++) {
      if ((x + y) % 7 === 3 && hash2(x, y, 4) > 0.55 && b.get(x, y) === K.lacq) b.px(x, y, K.glossDim);
    }
  }
  // Piliers laqués : un anneau sombre à reflet tous les 48 px.
  if (s.region.kind === 'pillar') {
    for (let y = s.Y; y < s.Y + T; y++) {
      if (((y % 48) + 48) % 48 !== 20) continue;
      for (let x = s.X; x < s.X + T; x++) {
        b.px(x, y, K.lacqDk);
        b.px(x, y + 1, K.glossDim);
      }
    }
  }
}

function paintSolids(ctx: Ctx, b: Buf): void {
  const done = new Set<number>();
  const w = ctx.shape.w;
  forEachSolid(ctx.shape, (s) => {
    if (s.type === T_SLICK) {
      lacquerTile(b, s);
      return;
    }
    const r = s.region;
    const st = isFloat(r) ? (ctx.style.get(r.id) ?? 'stone') : 'stone';
    if (st === 'stone') {
      stoneTile(b, s, ctx.runTop[s.ty * w + s.tx]);
      return;
    }
    if (done.has(r.id)) return;
    done.add(r.id);
    if (st === 'wood') woodFloat(b, r, ctx.lash.get(r.id) ?? []);
    else toriiFloat(b, r);
  });
}

// ------------------------------------------------------------------ bambous géants, lianes, piliers

/** Bambou géant de la planche (12 px, nœuds tous les 38 px), rameaux feuillus à quelques nœuds. */
function giantStalk(b: Buf, left: number, y0: number, y1: number, seed: number): void {
  if (y1 - y0 < 24) return;
  b.rect(left, y0, 2, y1 - y0, K.stalkLit);
  b.rect(left + 2, y0, 7, y1 - y0, K.stalk);
  b.rect(left + 9, y0, 3, y1 - y0, K.node);
  // Fibres : quelques traits plus sombres dans le fût.
  for (let y = y0; y < y1; y++) if (hash2(seed, y >> 3, 7) > 0.8) b.px(left + 5, y, K.node);
  const off = Math.floor(hash2(seed, 0, 3) * 38);
  const first = y0 + ((((off - y0) % 38) + 38) % 38);
  for (let y = first; y < y1 - 3; y += 38) {
    b.rect(left - 1, y, 14, 3, K.node);
    b.hline(left - 1, left + 12, y, K.stalkLit);
    if (hash2(seed, y, 5) > 0.58 && y > y0 + 12) twig(b, left, y, hash2(seed, y, 6) > 0.5 ? 1 : -1, seed + y);
  }
  // Pied : évasement et radicelles sur le sol.
  b.rect(left - 1, y1 - 3, 14, 3, K.node);
  b.px(left - 2, y1 - 1, K.node);
  b.px(left + 13, y1 - 1, K.node);
  b.px(left - 3, y1 - 1, K.stalk);
  // Liane enroulée autour du fût : les tours passent devant puis derrière le bambou.
  if (hash2(seed, 8, 9) > 0.7) {
    const len = Math.min(y1 - y0 - 8, 60 + Math.floor(hash2(seed, 9, 9) * 90));
    for (let k = 0; k < len; k++) {
      const a = k * 0.16 + seed;
      if (Math.cos(a) < 0) continue;
      const x = left + 6 + Math.round(Math.sin(a) * 7);
      const y = y1 - 3 - k;
      b.px(x, y, k % 6 === 0 ? K.vineLit : K.vine);
      if (k % 13 === 6) {
        b.px(x + 1, y - 1, K.vineLit);
        b.px(x + 2, y - 1, K.vine);
      }
    }
  }
  // Ofuda collé sur le fût, lié d'un tour de corde : la bambouseraie est maudite.
  if (hash2(seed, 10, 9) > 0.72 && y1 - y0 > 90) {
    const y = y1 - 34 - Math.floor(hash2(seed, 11, 9) * 50);
    b.hline(left, left + 11, y - 2, K.ropeDk);
    b.hline(left, left + 11, y - 1, K.rope);
    b.rect(left + 3, y, 5, 9, K.paper);
    b.rect(left + 7, y, 1, 9, K.paperDk);
    b.px(left + 5, y + 2, K.ink);
    b.px(left + 5, y + 3, K.ink);
    b.px(left + 4, y + 5, K.ink);
    b.px(left + 6, y + 6, K.ink);
  }
}

/** Rameau : une tige fine qui monte, trois feuilles qui retombent. */
function twig(b: Buf, left: number, y: number, side: number, seed: number): void {
  const x0 = side > 0 ? left + 12 : left - 1;
  const len = 6 + Math.floor(hash2(seed, 1, 8) * 5);
  const ex = x0 + side * len;
  const ey = y - Math.round(len * 0.6);
  b.line(x0, y + 1, ex, ey, K.stalk);
  for (let l = 0; l < 3; l++) {
    const lx = ex - side * l * 2;
    const ly = ey + l;
    for (let q = 0; q < 6; q++) b.px(lx + side * q, ly + q * 0.55 + l * 0.3, q < 2 ? K.leafLit : K.leaf);
  }
}

/** Liane qui monte d'un point et se perd dans le noir ; s'arrête sur le premier plein. */
function liana(b: Buf, shape: LevelShape, x: number, y: number, len: number, seed: number): void {
  for (let k = 0; k < len; k++) {
    const yy = y - k;
    if (yy < 1) break;
    const xx = x + Math.round(fsin(k * 0.07 + seed) * 1.6);
    if (solidAt(shape, Math.floor(xx / T), Math.floor(yy / T))) break;
    const f = k < len - 40 ? 1 : 1 - (k - (len - 40)) / 40;
    if (f < 1 && hash2(xx, yy, seed) > f) continue;
    b.px(xx, yy, k % 5 === 0 ? K.vineLit : K.vine);
    if (k % 11 === 5 && f > 0.5) {
      const d = Math.floor(k / 11) & 1 ? 1 : -1;
      b.px(xx + d, yy, K.vineLit);
      b.px(xx + 2 * d, yy + 1, K.vine);
      b.px(xx + d, yy + 1, K.vineDk);
    }
  }
}

/** Corde de chanvre qui monte et se perd dans le noir (poutres liées sans bambou). */
function risingRope(b: Buf, shape: LevelShape, x: number, y: number, len: number, seed: number): void {
  for (let k = 0; k < len; k++) {
    const yy = y - k;
    if (yy < 1 || solidAt(shape, Math.floor(x / T), Math.floor(yy / T))) break;
    const f = k < len - 50 ? 1 : 1 - (k - (len - 50)) / 50;
    if (f < 1 && hash2(x, yy, seed) > f) continue;
    b.px(x, yy, k % 4 === 0 ? K.ropeDk : K.rope);
  }
}

/** Pilier de torii fantôme : descend sous le kasagi et se dissout dans la brume, sans arête claire. */
function ghostPillar(b: Buf, shape: LevelShape, x: number, y: number, w: number, maxLen: number): void {
  for (let k = 0; k < maxLen; k++) {
    const yy = y + k;
    if (solidAt(shape, Math.floor((x + w / 2) / T), Math.floor(yy / T))) break;
    const f = k < maxLen - 56 ? 1 : 1 - (k - (maxLen - 56)) / 56;
    for (let i = 0; i < w; i++) {
      if (f < 1 && dith(x + i, yy, 0, 1, f) === 0) continue;
      b.px(x + i, yy, i === 0 ? K.ghostLt : i === w - 1 ? K.underStone : K.ghost);
    }
    if (k % 23 === 11 && f > 0.6) b.hline(x, x + w - 1, yy, K.underStone);
  }
}

interface RopeColors {
  hi: Color;
  mid: Color;
  dk: Color;
}

const HEMP: RopeColors = { hi: K.ropeHi, mid: K.rope, dk: K.ropeDk };

/** Shimenawa : corde torsadée de 3 px en chaînette, touffes de paille qui pendent. */
function shimenawa(b: Buf, ax: number, ay: number, bx: number, by: number, sag: number, tassels: boolean, P: RopeColors = HEMP): void {
  const n = Math.max(8, Math.ceil(Math.abs(bx - ax) * 1.5));
  let lastT = -99;
  for (let i = 0; i <= n; i++) {
    const [x, y] = sagPoint(ax, ay, bx, by, sag, i / n);
    const xr = Math.round(x);
    const yr = Math.round(y);
    for (let j = -1; j <= 1; j++) {
      const dark = ((xr - j * 2) & 3) === 0;
      b.px(xr, yr + j, dark ? P.dk : j < 0 ? P.hi : j > 0 ? P.dk : P.mid);
    }
    if (tassels && xr - lastT >= 22 && i > n * 0.1 && i < n * 0.9) {
      lastT = xr;
      for (let k = 2; k < 6; k++) {
        b.px(xr - 1, yr + k, K.strawDk);
        if (k < 5) b.px(xr + 1, yr + k, K.strawDk);
        b.px(xr, yr + k, K.straw);
      }
    }
  }
}

function paintGrove(ctx: Ctx, b: Buf): void {
  const { shape } = ctx;
  // Bambous derrière les poutres liées : du plafond au sol, la poutre y est attachée.
  for (const [id, xs] of ctx.lash) {
    const r = shape.regions[id];
    for (const cx of xs) {
      const tx = Math.floor(cx / T);
      const y0 = frameAbove(shape, tx, r.y0 - 1);
      const y1 = frameBelow(shape, tx, r.y1 + 1);
      giantStalk(b, cx - 6, y0, y1, cx);
      // Ligature en croix sur le bambou, au-dessus et sous la poutre.
      const Y = r.y0 * T;
      const Yb = (r.y1 + 1) * T;
      for (let k = 0; k < 4; k++) {
        b.px(cx - 6 + k, Y - 4 + k, K.rope);
        b.px(cx + 5 - k, Y - 4 + k, K.ropeDk);
        b.px(cx - 6 + k, Yb + 3 - k, K.ropeDk);
        b.px(cx + 5 - k, Yb + 3 - k, K.rope);
      }
    }
  }
  // Bambous isolés plantés dans le sol principal (loin des autres, loin de l'arrivée).
  const g = goalArt(shape);
  for (const run of shape.tops) {
    if (run.type !== T_SOLID || run.y !== shape.floorRow) continue;
    for (let tx = run.x0 + 2; tx <= run.x1 - 2; tx += 3) {
      if (hash2(tx, run.y, 141) < 0.72) continue;
      const cx = tx * T + 2 + Math.floor(hash2(tx, run.y, 142) * 12);
      if (ctx.stalks.some((s) => Math.abs(s - cx) < 150)) continue;
      if (g && cx > g.x - 90 && cx < g.x + g.w + 90) continue;
      if (Math.abs(tx - shape.spawnTx) < 3) continue;
      ctx.stalks.push(cx);
      giantStalk(b, cx - 6, frameAbove(shape, tx, run.y - 1), run.y * T, cx);
    }
  }
}

function paintSupports(ctx: Ctx, b: Buf, props: PropInstance[]): void {
  const { shape } = ctx;
  for (const r of floatingBlocks(shape)) {
    const st = ctx.style.get(r.id) ?? 'stone';
    const X = r.x0 * T;
    const Y = r.y0 * T;
    const W = (r.x1 - r.x0 + 1) * T;
    const Yb = (r.y1 + 1) * T;
    if (st === 'stone') {
      // Deux lianes montent des coins et se perdent dans le noir.
      for (const [x, s] of [[X + 3, 1], [X + W - 4, 2]] as const) {
        liana(b, shape, x, Y - 1, 110 + Math.floor(hash2(r.x0, r.y0 + s, 151) * 90), r.id * 3 + s);
      }
    } else if (st === 'wood' && !ctx.lash.has(r.id)) {
      for (const [x, s] of [[X + 4, 1], [X + W - 5, 2]] as const) {
        risingRope(b, shape, x, Y - 1, 90 + Math.floor(hash2(r.x0, r.y0 + s, 152) * 70), r.id * 5 + s);
      }
    } else if (st === 'torii') {
      // Piliers qui se perdent dans la brume, shimenawa tendue dessous avec ses shide.
      const pw = W >= 5 * T ? 8 : 7;
      const lx = X + 5;
      const rx = X + W - 5 - pw;
      ghostPillar(b, shape, lx, Yb, pw, 150);
      ghostPillar(b, shape, rx, Yb, pw, 150);
      const ay = Yb + 5;
      shimenawa(b, lx + pw, ay, rx - 1, ay, 5, false);
      const n = Math.max(1, Math.floor((rx - lx - pw) / 22));
      for (let i = 1; i <= n; i++) {
        const [x, y] = sagPoint(lx + pw, ay, rx - 1, ay, 5, i / (n + 1));
        if (nearGameplay(shape, Math.floor(x / T), Math.floor(y / T), 1)) continue;
        props.push({ kind: 'shide', x: Math.round(x), y: Math.round(y) + 1, phase: hash2(r.x0, i, 153) * 3, layer: 'back' });
      }
    }
  }
}

/** Shimenawa entre ancrages voisins d'une même rangée, ofuda et shide qui se balancent. */
function paintRopes(ctx: Ctx, b: Buf, props: PropInstance[]): void {
  const { shape } = ctx;
  for (const [a, c] of rowPairs(floatingBlocks(shape), 12)) {
    const seed = hash2(a.x0, a.y0, 51);
    if (seed < 0.6) continue;
    const ax = (a.x1 + 1) * T;
    const ay = a.y1 * T + 11;
    const bx = c.x0 * T - 1;
    const by = c.y1 * T + 11;
    const gap = bx - ax;
    const sag = 9 + gap * 0.11;
    shimenawa(b, ax, ay, bx, by, sag, true);
    // Papiers clairsemés : le papier est le décor le plus clair, il ne doit pas voler l'œil.
    const n = Math.max(1, Math.floor(gap / 30));
    for (let i = 1; i <= n; i++) {
      const s = i / (n + 1);
      const [x, y] = sagPoint(ax, ay, bx, by, sag, s);
      if (nearGameplay(shape, Math.floor(x / T), Math.floor(y / T), 1)) continue;
      props.push({ kind: i % 2 ? 'ofuda' : 'shide', x: Math.round(x), y: Math.round(y) + 1, phase: hash2(a.x0, i, 52) * 3, layer: 'back' });
    }
  }
}

// ------------------------------------------------------------------ sol principal

function jizo(b: Buf, x: number, y: number, cap: boolean): void {
  b.rect(x - 1, y - 2, 10, 2, K.stone.dk);
  b.rect(x, y - 12, 8, 10, K.jizo);
  b.rect(x + 6, y - 12, 2, 10, K.jizoDk);
  b.disc(x + 4, y - 15, 3.5, K.jizo);
  b.px(x + 6, y - 16, K.jizoDk);
  b.px(x + 7, y - 15, K.jizoDk);
  b.px(x + 6, y - 14, K.jizoDk);
  b.px(x + 2, y - 17, K.jizoHi);
  b.px(x + 3, y - 18, K.jizoHi);
  b.rect(x, y - 10, 8, 4, K.bib);
  b.hline(x, x + 7, y - 10, K.bibHi);
  b.px(x + 3, y - 5, K.jizoDk);
  b.px(x + 4, y - 5, K.jizoDk);
  if (cap) {
    b.hline(x + 1, x + 7, y - 18, K.bib);
    b.hline(x + 2, x + 6, y - 19, K.bib);
    b.px(x + 3, y - 19, K.bibHi);
  } else if (hash2(x, y, 3) > 0.5) b.px(x + 4, y - 19, K.stone.moss);
}

/** Lanterne de pierre (tōrō) : toit à coins relevés, foyer, fût, socle ; la lueur est un accessoire. */
function toro(b: Buf, x: number, y: number): void {
  b.rect(x + 4, y - 24, 2, 2, K.stoneHi);
  b.poly([x - 2, y - 18, x + 12, y - 18, x + 9, y - 22, x + 1, y - 22], K.stone.lt);
  b.hline(x - 2, x + 11, y - 18, K.stoneHi);
  b.px(x - 3, y - 19, K.stoneHi);
  b.px(x + 12, y - 19, K.stoneHi);
  for (let i = 1; i < 9; i++) if (hash2(x + i, y, 4) > 0.55) b.px(x + i, y - 22, K.stone.moss);
  b.rect(x, y - 17, 10, 6, K.stone.rock);
  b.rect(x + 3, y - 16, 4, 4, K.roof);
  b.rect(x + 3, y - 11, 4, 8, K.stone.rock);
  b.rect(x + 3, y - 11, 1, 8, K.stone.lt);
  b.rect(x + 1, y - 6, 8, 2, K.stone.dk);
  b.rect(x, y - 3, 10, 3, K.stone.lt);
  b.hline(x, x + 9, y - 3, K.stoneHi);
}

/** Petit sanctuaire (hokora) : socle, caisse de bois, ofuda, toit débordant moussu. */
function hokora(b: Buf, x: number, y: number): void {
  b.rect(x - 2, y - 3, 16, 3, K.stone.lt);
  b.hline(x - 2, x + 13, y - 3, K.stoneHi);
  b.rect(x, y - 13, 12, 10, K.plank);
  b.rect(x, y - 13, 1, 10, K.plankMid);
  b.rect(x + 3, y - 11, 6, 8, K.plankDk);
  b.rect(x + 5, y - 10, 2, 5, K.paper);
  b.px(x + 5, y - 8, K.ink);
  b.poly([x - 4, y - 13, x + 16, y - 13, x + 12, y - 18, x, y - 18], K.roof);
  b.hline(x - 4, x + 15, y - 13, K.stoneHi);
  b.hline(x + 1, x + 11, y - 18, K.stoneHi);
  for (let i = 0; i < 12; i++) if (hash2(x + i, y, 5) > 0.5) b.px(x + i, y - 17, K.stone.moss);
  b.px(x + 13, y - 4, K.bib);
  b.px(x + 14, y - 4, K.bibHi);
}

/** Sotoba : planchettes de bois à tête crénelée, un peu penchées. */
function sotoba(b: Buf, x: number, y: number, seed: number): void {
  const n = 3 + Math.floor(hash2(seed, 1, 9) * 2);
  for (let i = 0; i < n; i++) {
    const h = 14 + Math.floor(hash2(seed, i, 10) * 8);
    const lean = hash2(seed, i, 11) > 0.6 ? 1 : 0;
    const bx = x + i * 4;
    for (let j = 0; j < h; j++) {
      const xx = bx + (lean && j > h / 2 ? 1 : 0);
      const c = j < 3 ? (j === 1 ? K.plankDk : K.plankMid) : j % 5 === 2 ? K.plankDk : K.plank;
      b.px(xx, y - h + j, c);
      b.px(xx + 1, y - h + j, j < 3 ? K.plankMid : K.plankDk);
    }
  }
  b.rect(x - 1, y - 2, n * 4 + 2, 2, K.stone.dk);
}

/** Pierres moussues, pousses de bambou. */
function stones(b: Buf, x: number, y: number, seed: number): void {
  for (let i = 0; i < 3; i++) {
    const cx = x + i * 6 + Math.floor(hash2(seed, i, 12) * 3);
    const rx = 2 + Math.floor(hash2(seed, i, 13) * 3);
    const ry = 1 + Math.floor(hash2(seed, i, 14) * 2);
    b.ellipse(cx, y - ry, rx, ry, K.stone.dk);
    b.hline(cx - rx + 1, cx + rx - 1, y - ry * 2, K.stone.rock);
    b.px(cx, y - ry * 2 - 1, K.stone.moss);
  }
  for (let i = 0; i < 2; i++) {
    const sx = x + 20 + i * 5;
    const h = 3 + Math.floor(hash2(seed, i, 15) * 4);
    for (let j = 0; j < h; j++) {
      b.px(sx, y - 1 - j, j > h - 2 ? K.leafLit : K.leaf);
      if (j < h / 2) b.px(sx + 1, y - 1 - j, K.node);
    }
  }
}

/** Pin tordu de la planche (tronc en S, branches, touffes d'aiguilles), à l'échelle `s`. */
function pine(b: Buf, x: number, y: number, flip: boolean, s: number): void {
  const X = (dx: number): number => x + (flip ? -dx : dx) * s;
  const Y = (dy: number): number => y + dy * s;
  b.poly([X(-8), Y(0), X(8), Y(0), X(4), Y(-90), X(12), Y(-150), X(2), Y(-180), X(-12), Y(-150), X(-6), Y(-90)], K.pine);
  // Écorce : plaques claires côté lune (à droite), fentes sombres, qui suivent la torsion du tronc.
  const y0 = Math.round(Y(-180));
  const y1 = Math.round(Y(0));
  for (let y = y0; y < y1; y++) {
    let a = -1;
    let e = -1;
    for (let xx = Math.round(x - 20 * s); xx <= Math.round(x + 20 * s); xx++) {
      if (b.get(xx, y) !== K.pine) continue;
      if (a < 0) a = xx;
      e = xx;
    }
    if (a < 0) continue;
    const w = e - a + 1;
    for (let i = 0; i < w; i++) {
      const px = a + i;
      const u = i / Math.max(1, w - 1);
      if (u > 0.68 && hash2(px, y >> 2, 21) > 0.35) b.px(px, y, K.pineHi);
      else if (hash2(px, y >> 3, 22) > 0.8) b.px(px, y, K.rootDk);
    }
  }
  b.stroke(X(-2), Y(-170), X(-92), Y(-190), Math.max(2, 5 * s), K.pine);
  b.stroke(X(-2), Y(-171), X(-92), Y(-191), 1, K.pineHi);
  b.stroke(X(-32), Y(-178), X(-62), Y(-204), Math.max(1, 3 * s), K.pine);
  b.stroke(X(4), Y(-120), X(38), Y(-144), Math.max(1, 3 * s), K.pine);
  const tufts = [[-86, -196, 12], [-56, -210, 12], [-20, -188, 14], [38, -150, 14], [8, -200, 12]];
  for (const [cx0, cy0, r0] of tufts) {
    const cx = X(cx0);
    const cy = Y(cy0);
    const r = r0 * s;
    for (let k = 0; k < 60; k++) {
      const a = hash2(k, cx0, 2) * TAU;
      const d = Math.sqrt(hash2(k, cy0, 3)) * r;
      const px = cx + Math.cos(a) * d * 1.4;
      const py = cy + Math.sin(a) * d * 0.6;
      b.stroke(px - 2, py, px + 2, py - 1, 1, py < cy ? K.needleLit : K.needle);
    }
  }
  // Racines sur le sol.
  b.line(X(-8), Y(0), X(-14), Y(0), K.pine);
  b.line(X(8), Y(-1), X(13), Y(0), K.pine);
}

/** Vrai si la boîte (px d'art) ne touche aucune tuile pleine : le pin a besoin d'air. */
function clearBox(shape: LevelShape, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let ty = Math.floor(y0 / T); ty <= Math.floor(y1 / T); ty++) {
    for (let tx = Math.floor(x0 / T); tx <= Math.floor(x1 / T); tx++) if (solidAt(shape, tx, ty)) return false;
  }
  return true;
}

function paintGround(ctx: Ctx, b: Buf, props: PropInstance[]): void {
  const { shape } = ctx;
  const g = goalArt(shape);
  // Herbes le long des dessus accrochables à l'air libre.
  for (const run of shape.tops) {
    if (run.type !== T_SOLID || run.y > shape.floorRow) continue;
    const y = run.y * T;
    for (let x = run.x0 * T + 1; x < (run.x1 + 1) * T - 1; x++) {
      const h = hash2(x, run.y, 101);
      if (h < 0.8) continue;
      const len = 1 + Math.floor(hash2(x, run.y, 102) * (run.y === shape.floorRow ? 5 : 3));
      for (let j = 1; j <= len; j++) b.px(x + (j > 2 && h > 0.93 ? 1 : 0), y - j, j === len ? K.vineLit : K.vine);
    }
  }
  let lastPine = -1e9;
  const spots = deckSpots(shape, 6, 111, { mainFloorOnly: true, margin: 2 });
  spots.forEach((spot, i) => {
    const { x, y } = spot;
    if (g && x > g.x - 60 && x < g.x + g.w + 60) return;
    const kind = hash2(Math.floor(x / T), i, 112);
    if (kind < 0.2) {
      const n = 1 + Math.floor(hash2(x, 1, 113) * 3);
      for (let k = 0; k < n; k++) jizo(b, x - 4 + k * 10, y, hash2(x, k, 114) > 0.7);
    } else if (kind < 0.38) {
      toro(b, x - 5, y);
      props.push({ kind: 'toro', x, y: y - 14, phase: hash2(x, 2, 115) * 3, layer: 'back' });
    } else if (kind < 0.5) hokora(b, x - 6, y);
    else if (kind < 0.62) sotoba(b, x - 6, y, x);
    else if (kind < 0.8) stones(b, x - 8, y, x);
    else if (x - lastPine > 26 * T) {
      const flip = hash2(x, 3, 116) > 0.5;
      const s = 0.72 + hash2(x, 4, 117) * 0.2;
      const x0 = flip ? x - 50 * s : x - 100 * s;
      const x1 = flip ? x + 100 * s : x + 50 * s;
      if (clearBox(shape, x0, y - 215 * s, x1, y - 1)) {
        pine(b, x, y, flip, s);
        lastPine = x;
      } else stones(b, x - 8, y, x);
    } else stones(b, x - 8, y, x);
    // Hitodama qui flottent au-dessus des ruines, une sur quatre.
    if (i % 4 === 2) {
      const wy = y - 34 - Math.floor(hash2(x, 5, 118) * 36);
      if (!nearGameplay(shape, Math.floor(x / T), Math.floor(wy / T), 2) && clearBox(shape, x - 16, wy - 20, x + 16, wy + 16)) {
        props.push({ kind: 'wisp', x, y: wy, phase: hash2(x, 6, 119) * 8, layer: 'back' });
      }
    }
  });
}

/** Sous les dessous exposés : fils de mousse (cuits) et lianes qui pendent (accessoires). */
function paintUndersides(ctx: Ctx, b: Buf, props: PropInstance[]): void {
  const { shape } = ctx;
  for (const run of shape.bottoms) {
    if (run.type !== T_SOLID) continue;
    if (run.y >= shape.floorRow) continue; // la cave a ses racines
    const yb = (run.y + 1) * T;
    for (let x = run.x0 * T; x < (run.x1 + 1) * T; x++) {
      if (hash2(x, run.y, 161) < 0.83) continue;
      const len = 1 + Math.floor(hash2(x, run.y, 162) * 4);
      for (let j = 0; j < len; j++) b.px(x, yb + j, j === len - 1 ? K.mossDeep : K.stone.moss);
    }
    const r = regionAt(shape, run.x0, run.y);
    const float = isFloat(r);
    for (let tx = run.x0; tx <= run.x1; tx++) {
      const h = hash2(tx, run.y, 171);
      if (h < (float ? 0.55 : 0.72)) continue;
      if (nearGameplay(shape, tx, run.y + 2, 2)) continue;
      const kind = h > 0.93 ? 'vineL' : h > 0.82 ? 'vineM' : 'vineS';
      const need = kind === 'vineL' ? 4 : kind === 'vineM' ? 3 : 2;
      let room = true;
      for (let k = 1; k <= need; k++) if (solidAt(shape, tx, run.y + k)) room = false;
      if (!room) continue;
      props.push({ kind, x: tx * T + 3 + Math.floor(hash2(tx, run.y, 172) * 10), y: yb, phase: hash2(tx, run.y, 173) * 5, layer: 'back' });
      tx += 1;
    }
  }
}

// ------------------------------------------------------------------ ruines souterraines (cave)

function paintCave(ctx: Ctx, b: Buf, props: PropInstance[]): void {
  const { shape } = ctx;
  const holes = new Uint8Array(shape.w);
  for (let tx = 0; tx < shape.w; tx++) {
    if (!solidAt(shape, tx, shape.floorRow) && !solidAt(shape, tx, shape.floorRow + 1)) holes[tx] = 1;
  }
  // Plafond (dessous de la dalle) et fond de la cave, colonne par colonne.
  const ceil = new Int32Array(shape.w);
  const floor = new Int32Array(shape.w);
  const bottoms: number[] = [];
  for (let tx = 0; tx < shape.w; tx++) {
    let y = shape.floorRow;
    while (y < shape.h && solidAt(shape, tx, y)) y++;
    ceil[tx] = y * T;
    let z = y;
    while (z < shape.h && !solidAt(shape, tx, z)) z++;
    floor[tx] = z * T;
    if (z > y) bottoms.push(z * T);
  }
  if (bottoms.length === 0) return;
  bottoms.sort((a, c) => a - c);
  const caveBottom = bottoms[bottoms.length >> 1];
  const caveTop = (shape.floorRow + 2) * T;
  const depth = Math.max(16, caveBottom - caveTop);
  // Arcades : piliers de 14 px tous les 112 px, arc surbaissé qui s'adapte à la hauteur de la cave.
  const BAY = 112;
  const PW = 14;
  const RX = (BAY - PW) / 2;
  const RY = Math.max(10, Math.min(RX, depth - 22));
  const spring = caveBottom - 16;
  // Intrados de l'arc, par colonne de la travée (précalculé : pas de racine par pixel).
  const archAt = new Float32Array(BAY);
  for (let u = 0; u < BAY; u++) {
    const du = u - PW - RX + 0.5;
    archAt[u] = u < PW ? Infinity : spring - RY * Math.sqrt(Math.max(0, 1 - (du * du) / (RX * RX)));
  }
  // Puits de lune : un cône tramé sous chaque trou, penché comme la lumière (la lune est à droite).
  const top = shape.floorRow * T;
  const span = Math.max(1, caveBottom - top);
  const shafts: { a: number; c: number }[] = [];
  const nearShafts: number[][] = Array.from({ length: shape.w }, () => []);
  for (let tx = 0; tx < shape.w; tx++) {
    if (!holes[tx]) continue;
    let e = tx;
    while (e + 1 < shape.w && holes[e + 1]) e++;
    const id = shafts.length;
    shafts.push({ a: tx * T, c: (e + 1) * T });
    const from = Math.max(0, Math.floor((tx * T - span * 0.34 - 8) / T));
    const to = Math.min(shape.w - 1, Math.ceil(((e + 1) * T + span * 0.12 + 8) / T));
    for (let k = from; k <= to; k++) nearShafts[k].push(id);
    tx = e;
  }
  const shaftAt = (tx: number, x: number, y: number): number => {
    const dy = y - top;
    let best = 0;
    for (const id of nearShafts[tx]) {
      const s = shafts[id];
      const cx = (s.a + s.c) / 2 - dy * 0.22;
      const hw = (s.c - s.a) / 2 + dy * 0.12;
      const u = 1 - Math.abs(x - cx) / hw;
      if (u > best) best = u;
    }
    return best > 0 ? Math.sqrt(best) * (1 - (dy / span) * 0.75) : 0;
  };
  for (let ty = shape.floorRow; ty < shape.h; ty++) {
    for (let tx = 0; tx < shape.w; tx++) {
      if (!isCaveAir(shape, tx, ty)) continue;
      const X = tx * T;
      const Y = ty * T;
      const lit = nearShafts[tx].length > 0;
      // Sous un trou, la voûte des ruines s'est effondrée : du vide, pas un mur (le trou se lit ouvert).
      const hole = holes[tx] === 1;
      for (let y = Y; y < Y + T; y++) {
        const broken = hole && y < caveTop + 4 + Math.floor(hash2(tx, y >> 2, 126) * 6);
        for (let x = X; x < X + T; x++) {
          const u = x % BAY;
          const archY = archAt[u];
          const inArch = broken || y > archY;
          let c: Color;
          if (inArch) {
            // Fond de l'arcade : mur lointain, très sombre, grandes pierres à peine lisibles.
            const bx = Math.floor(x / 24);
            const by = Math.floor((y + (bx & 1) * 6) / 12);
            const edge = (y + (bx & 1) * 6) % 12 === 0 || x % 24 === 0;
            c = edge ? K.underMortar : hash2(bx, by, 121) > 0.55 ? K.underStone : K.under;
            if (!broken && y - archY < 1.5) c = K.underArchLt;
          } else {
            // Maçonnerie de l'arcade (piliers et écoinçons) : pierres de 20 x 10.
            const row = Math.floor(y / 10);
            const off = row & 1 ? 10 : 0;
            const col = Math.floor((x + off) / 20);
            const edge = y % 10 === 0 || (x + off) % 20 === 0;
            c = edge ? K.underMortar : hash2(col, row, 122) > 0.5 ? K.underArch : K.underStone;
            if (u === 0 || u === PW - 1) c = u === 0 ? K.underArchLt : K.underMortar;
          }
          // Puits de lune sous les trous du sol : lumière tramée qui s'éteint en descendant.
          if (lit) {
            // Lumière posée en deux tons discrets (la maçonnerie s'éclaire, le vide se voile), plus
            // quelques poussières de lune ; jamais un damier plein.
            const k = shaftAt(tx, x, y);
            if (k > 0) {
              if (c === K.underArch || c === K.underStone) {
                if (dith(x, y, 0, 1, k * 0.7) === 1) c = c === K.underArch ? K.underArchLt : K.underArch;
              } else if (c === K.under && dith(x, y, 0, 1, k * 0.5) === 1) c = K.underStone;
              if (k > 0.25 && dith(x, y, 0, 1, (k - 0.25) * 0.22) === 1 && hash2(x >> 1, y >> 1, 125) > 0.5) c = K.shaft;
              if (k > 0.3 && hash2(x, y, 124) > 0.994) c = K.shaftHi;
            }
          }
          b.px(x, y, c);
        }
      }
    }
  }
  // Racines qui pendent sous la dalle du sol, éclairées d'un côté.
  for (let tx = 0; tx < shape.w; tx++) {
    if (holes[tx] || ceil[tx] >= floor[tx]) continue;
    const y0 = ceil[tx];
    for (let x = tx * T; x < tx * T + T; x++) {
      const h = hash2(x, 3, 131);
      if (h < 0.9) continue;
      const len = 6 + Math.floor(hash2(x, 4, 132) * Math.min(34, floor[tx] - y0 - 20));
      root(b, shape, x, y0, len, x);
    }
  }
  // Éboulis au fond, hitodama dans les ruines.
  for (let tx = 1; tx < shape.w - 1; tx++) {
    const yb = floor[tx];
    if (yb >= shape.ph || ceil[tx] >= yb) continue;
    const ty = yb / T - 1;
    if (ty < 0 || !isCaveAir(shape, tx, ty) || shape.spikes.some((s) => s.y === ty && tx >= s.x0 - 1 && tx <= s.x1 + 1)) continue;
    const h = hash2(tx, ty, 133);
    if (h > 0.55) {
      const cx = tx * T + 3 + Math.floor(hash2(tx, ty, 134) * 10);
      const rx = 2 + Math.floor(hash2(tx, ty, 135) * 4);
      b.ellipse(cx, yb - 2, rx, 2, K.rubble);
      b.hline(cx - rx + 1, cx + rx - 1, yb - 4, K.rubbleLt);
      if (h > 0.85) {
        // Tête de jizo tombée, bavoir délavé.
        b.disc(cx + rx + 4, yb - 4, 3, K.jizoDk);
        b.px(cx + rx + 3, yb - 6, K.jizo);
        b.hline(cx + rx + 2, cx + rx + 6, yb - 1, K.ink);
      }
    }
    if (h < 0.035 && yb - ceil[tx] >= 48) props.push({ kind: 'wisp', x: tx * T + 8, y: yb - 26, phase: hash2(tx, ty, 136) * 8, layer: 'back' });
  }
}

/** Racine qui pend, effilée, avec une radicelle. */
function root(b: Buf, shape: LevelShape, x: number, y0: number, len: number, seed: number): void {
  let xx = x;
  for (let k = 0; k < len; k++) {
    const y = y0 + k;
    if (solidAt(shape, Math.floor(xx / T), Math.floor(y / T))) break;
    if (k > 0 && hash2(seed, k, 137) > 0.8) xx += hash2(seed, k, 138) > 0.5 ? 1 : -1;
    const thick = k < len * 0.45;
    b.px(xx, y, k === len - 1 ? K.rootDk : K.rootLt);
    if (thick) b.px(xx + 1, y, K.root);
    if (k === Math.floor(len * 0.4) && len > 14) {
      const d = hash2(seed, 1, 139) > 0.5 ? 1 : -1;
      for (let q = 1; q < len * 0.35; q++) b.px(xx + d * (1 + Math.floor(q * 0.6)), y + q, q > len * 0.3 ? K.rootDk : K.root);
    }
  }
}

// ------------------------------------------------------------------ dangers : épines

function paintSpikes(shape: LevelShape, b: Buf): void {
  for (const run of shape.spikes) {
    const X0 = run.x0 * T;
    const X1 = (run.x1 + 1) * T - 1;
    const yb = (run.y + 1) * T;
    // Ronces à la base, tramées.
    for (let x = X0; x <= X1; x++) {
      const h = 2 + Math.floor(hash2(x, run.y, 81) * 3);
      for (let j = 1; j <= h; j++) b.px(x, yb - j, dith(x, yb - j, K.bramble, K.brambleLit, 0.35));
    }
    // Épines (KIT.stakes), un peu penchées, pointe rouge de 3 px.
    for (let x = X0; x <= X1 - 6; x += 6) {
      const hh = 12 + Math.floor(hash2(x, yb, 2) * 3);
      const lean = Math.round((hash2(x, yb, 82) - 0.5) * 2.4);
      const tx = x + 3 + lean;
      b.poly([x, yb, tx, yb - hh, x + 6, yb], K.thorn);
      b.line(x + 5, yb - 1, tx + 1, yb - hh + 3, K.thornDk);
      b.line(x + 2, yb - 1, tx, yb - hh + 1, K.thornHi);
      b.px(tx, yb - hh, K.tip);
      b.px(tx, yb - hh + 1, K.tip);
      b.px(tx - 1, yb - hh + 2, K.tip);
      // Barbelure sur la tige.
      if (hash2(x, yb, 83) > 0.5) b.px(x + 1, yb - 5, K.thornHi);
    }
  }
}

// ------------------------------------------------------------------ arrivée : torii de pierre brisé

/**
 * Arrivée : torii de pierre brisé, pâle sous la lune (sans l'arête de mousse claire, réservée à ce
 * qui s'accroche), shimenawa de paille, halo lavande, voile de lune sur toute la zone.
 */
function paintGoal(ctx: Ctx, b: Buf, props: PropInstance[]): void {
  const { shape } = ctx;
  const g = goalArt(shape);
  if (!g) return;
  const cx = Math.round(g.x + g.w / 2);
  let floorY = g.y + g.h;
  for (let ty = Math.floor(floorY / T); ty < shape.h; ty++) {
    if (solidAt(shape, Math.floor(cx / T), ty)) {
      floorY = ty * T;
      break;
    }
  }
  const PW = 8;
  const left = Math.round(g.x - 8);
  const right = Math.round(g.x + g.w);
  const top = floorY - 124;
  // Halo lavande derrière la porte, puis le voile de lune qui déborde un peu de la zone.
  b.glowA(cx, floorY - 66, 74, K.halo, 0.2);
  const vx0 = g.x - 12;
  const vw = g.w + 24;
  lightVeil(b, vx0, g.y, vw, g.h, K.veil, (x, y) => {
    const u = Math.max(0, 1 - Math.abs(x - cx) / (vw / 2));
    const v = (y - g.y) / g.h;
    return 0.04 + 0.36 * Math.pow(u, 1.4) * (0.2 + 0.8 * v * v);
  });
  const lit = (x: number, y: number): Color => {
    const c = grain(x, y);
    return c === K.stone.dk ? K.stone.lt : c === K.stone.rock ? K.stoneHi : hash2(x, y, 44) > 0.5 ? K.jizoHi : K.stoneHi;
  };
  // Piliers (hashira) : pierre pâle, arête de lune à gauche, ombre à droite, mousse sombre, socles.
  for (const px of [left, right]) {
    for (let y = top + 16; y < floorY - 6; y++) {
      for (let i = 0; i < PW; i++) {
        let c = i === 0 ? K.jizoHi : i >= PW - 2 ? (i === PW - 1 ? K.stone.dk : K.stone.rock) : lit(px + i, y);
        if (i > 0 && i < PW - 2 && hash2(px + i, y >> 2, 45) > 0.9) c = K.stone.moss;
        b.px(px + i, y, c);
      }
      if ((y - top) % 22 === 0) b.hline(px + 1, px + PW - 2, y, K.stone.rock);
    }
    b.rect(px - 3, floorY - 6, PW + 6, 6, K.stone.lt);
    b.hline(px - 3, px + PW + 2, floorY - 6, K.jizoHi);
    b.rect(px + PW + 1, floorY - 5, 2, 5, K.stone.dk);
    for (let i = 0; i < PW + 6; i++) if (hash2(px + i, floorY, 7) > 0.55) b.px(px - 3 + i, floorY - 5, K.stone.moss);
  }
  // Nuki (traverse basse), qui dépasse des piliers.
  const nY = top + 30;
  for (let y = nY; y < nY + 6; y++) {
    for (let x = left - 8; x <= right + PW + 7; x++) b.px(x, y, y === nY ? K.jizoHi : y === nY + 5 ? K.stone.rock : lit(x, y));
  }
  // Gakuzuka : plaque sombre à inscription d'or entre le kasagi et le nuki.
  b.rect(cx - 6, top + 12, 12, 18, K.stone.lt);
  b.rect(cx - 5, top + 13, 10, 16, K.roof);
  b.rect(cx - 1, top + 15, 2, 4, K.fin);
  b.rect(cx - 2, top + 21, 4, 1, K.fin);
  b.rect(cx - 1, top + 23, 2, 4, K.fin);
  // Shimaki puis kasagi à coins relevés ; le bout droit est cassé net.
  for (let y = top + 9; y < top + 13; y++) for (let x = left - 6; x <= right + PW + 5; x++) b.px(x, y, y === top + 12 ? K.stone.rock : lit(x, y));
  const kx0 = left - 17;
  const kx1 = right + PW + 16;
  const breakX = kx1 - 19;
  for (let x = kx0; x <= kx1; x++) {
    const e = Math.min(x - kx0, kx1 - x);
    const lift = e < 6 ? Math.round((6 - e) * 0.8) : 0;
    if (x > breakX && x - breakX > 2 + Math.floor(hash2(x, 1, 8) * 4)) continue;
    for (let j = 0; j < 9; j++) {
      if (lift && j > 7) continue;
      const y = top - lift + j;
      let c: Color = j === 0 ? K.jizoHi : j === 8 ? K.mortar : j === 7 ? K.stone.rock : lit(x, y);
      if (j === 1 && hash2(x, y, 46) > 0.7) c = K.stone.moss;
      b.px(x, y, c);
    }
  }
  // Fissure du bout cassé, et le morceau tombé au pied du pilier droit.
  for (let k = 0; k < 6; k++) b.px(breakX - 3 + (k & 1), top + 1 + k, K.mortar);
  const fx = right + PW + 5;
  for (let y = floorY - 9; y < floorY; y++) {
    for (let x = fx; x < fx + 17; x++) {
      const t0 = floorY - 9 + Math.max(0, 3 - (x - fx)) + Math.max(0, x - fx - 13);
      if (y < t0) continue;
      b.px(x, y, y === t0 ? K.jizoHi : y === floorY - 1 ? K.stone.dk : lit(x, y));
    }
  }
  b.px(fx + 6, floorY - 6, K.mortar);
  b.px(fx + 7, floorY - 5, K.mortar);
  // Shimenawa de paille épaisse entre les piliers, touffes, shide et ofuda qui se balancent.
  const sy = nY + 11;
  const straw = { hi: K.straw, mid: K.straw, dk: K.strawDk };
  shimenawa(b, left + PW, sy, right - 1, sy, 7, true, straw);
  shimenawa(b, left + PW, sy + 2, right - 1, sy + 2, 7, false, straw);
  const n = Math.max(3, Math.floor((right - left - PW) / 10));
  for (let i = 1; i <= n; i++) {
    const [x, y] = sagPoint(left + PW, sy + 1, right - 1, sy + 1, 7, i / (n + 1));
    props.push({ kind: i % 2 ? 'shide' : 'ofuda', x: Math.round(x), y: Math.round(y) + 3, phase: i * 0.7, layer: 'back' });
  }
  // Lanternes de pierre, jizo, hitodama qui gardent le passage.
  for (const [x, ph] of [[left - 30, 0.3], [right + PW + 26, 1.1]] as const) {
    toro(b, x, floorY);
    props.push({ kind: 'toro', x: x + 5, y: floorY - 14, phase: ph, layer: 'back' });
  }
  jizo(b, left - 46, floorY, true);
  props.push({ kind: 'wisp', x: left - 20, y: top + 24, phase: 1.3, layer: 'back' });
  props.push({ kind: 'wisp', x: right + PW + 20, y: top + 50, phase: 5.1, layer: 'back' });
  props.push({ kind: 'wisp', x: cx, y: top - 38, phase: 3.2, layer: 'back' });
}

// ------------------------------------------------------------------ assemblage

export function paintBamboo(shape: LevelShape, out: LevelCanvases): PropInstance[] {
  const props: PropInstance[] = [];
  const ctx = makeCtx(shape);
  paintCave(ctx, out.back, props);
  paintGrove(ctx, out.back);
  paintSupports(ctx, out.back, props);
  paintRopes(ctx, out.back, props);
  paintGround(ctx, out.back, props);
  paintUndersides(ctx, out.back, props);
  paintGoal(ctx, out.back, props);
  paintSolids(ctx, out.tiles);
  paintSpikes(shape, out.hazards);
  return props;
}

// ------------------------------------------------------------------ accessoires animés

const ZIGZAG = [0, 0, 1, 2, 2, 1, 0, 0, 1, 2];

function vineAnim(len: number, seed: number): PropAnim {
  const N = 24;
  const ax = 7;
  const frames: Buf[] = [];
  for (let k = 0; k < N; k++) {
    const f = new Buf(15, len + 3);
    const ph = (k / N) * TAU;
    let x = ax;
    for (let j = 0; j < len; j++) {
      x = ax + Math.sin(ph + j * 0.12 + seed) * (j / len) * 4;
      f.px(x, j, j % 5 === 0 ? K.vineLit : K.vine);
      if (j % 6 === 3) f.px(x + 1, j, K.vineLit);
      if (j % 9 === 7) {
        const d = Math.floor(j / 9) & 1 ? 1 : -1;
        f.px(x + d, j + 1, K.vine);
        f.px(x + 2 * d, j + 1, K.vineLit);
        f.px(x + d, j + 2, K.vineDk);
      }
    }
    f.px(x, len, K.vineLit);
    frames.push(f);
  }
  return { frames, fps: N / 4.5, ax, ay: 0 };
}

export function bambooProps(): Record<string, PropAnim> {
  // Shide : papier plié en éclair sous la shimenawa (planche : 1 px, 9 px de haut, 3 rad/s).
  const shide: Buf[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(9, 13);
    const sw = Math.sin((k / 16) * TAU) * 1.6;
    f.px(3, 0, K.ropeDk);
    for (let j = 0; j < ZIGZAG.length; j++) {
      const x = 2 + ZIGZAG[j] + Math.round(sw * (j / ZIGZAG.length));
      f.px(x, 1 + j, j % 3 === 2 ? K.paperDk : K.paper);
      if (j === 2 || j === 7) f.px(x + 1, 1 + j, K.paperDk);
    }
    shide.push(f);
  }
  // Ofuda : talisman de papier à l'encre rouge, pendu à un fil.
  const ofuda: Buf[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(9, 12);
    const sw = Math.sin((k / 16) * TAU + 1.2) * 1.4;
    f.px(4, 0, K.ropeDk);
    f.px(4 + Math.round(sw * 0.2), 1, K.ropeDk);
    for (let j = 0; j < 8; j++) {
      const x = 4 + Math.round(sw * (j / 8));
      f.px(x, 2 + j, j === 2 || j === 5 ? K.ink : K.paper);
      f.px(x + 1, 2 + j, K.paperDk);
    }
    ofuda.push(f);
  }
  // Hitodama : flamme lavande qui flotte, traînée, lueur, pointe qui vacille (boucle de 8 s).
  const WN = 64;
  const wisp: Buf[] = [];
  for (let k = 0; k < WN; k++) {
    const f = new Buf(48, 52);
    const u = k / WN;
    const x = 24 + Math.sin(u * TAU) * 10;
    const y = 20 + Math.sin(u * TAU * 2 + 1) * 6;
    const lean = Math.sin(u * TAU * 3 + 2.2);
    for (let q = 1; q < 8; q++) f.px(x - lean * q * 0.6, y + q * 1.5, q < 3 ? K.wispCore : K.wispTrail);
    f.glowA(x, y, 9, K.wispTrail, 0.4);
    f.disc(x, y, 2, K.wisp);
    f.px(x - 1, y + 1, K.wispCore);
    f.px(x, y - 3 - (Math.sin(u * TAU * 11) > 0 ? 1 : 0), K.wisp);
    wisp.push(f);
  }
  // Lueur des lanternes de pierre (planche : 0,45 +/- 0,05 à 8 rad/s).
  const toroFrames: Buf[] = [];
  for (let k = 0; k < 8; k++) {
    const f = new Buf(27, 27);
    f.glowA(13, 13, 12, K.lanternGlow, 0.45 + Math.sin((k / 8) * TAU) * 0.05);
    f.rect(12, 12, 3, 3, K.lantern);
    if (k % 4 === 1) f.px(13, 12, K.moon);
    toroFrames.push(f);
  }
  return {
    shide: { frames: shide, fps: 16 / 2.1, ax: 3, ay: 0 },
    ofuda: { frames: ofuda, fps: 16 / 2.3, ax: 4, ay: 0 },
    vineS: vineAnim(18, 0.4),
    vineM: vineAnim(30, 1.7),
    vineL: vineAnim(44, 3.1),
    wisp: { frames: wisp, fps: WN / 8, ax: 24, ay: 20 },
    toro: { frames: toroFrames, fps: 8 / 0.785, ax: 13, ay: 13 },
  };
}
