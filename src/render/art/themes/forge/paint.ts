/**
 * Forteresse de braise, peintre de carte (pur). La planche est une scène composée à la main ; ici la
 * même grammaire habille n'importe quelle carte :
 *   - accrochable (#) = REMPART de pierre (stoneWall de la planche) pour les masses : sol, murs,
 *     bordures. Chaque face exposée porte une arête chaude : dessus #c79a72 comme la planche, côtés
 *     en pierre d'angle claire, dessous éclairé par la braise d'en bas. Les ancrages flottants sont en
 *     bois d'échafaudage ou en poutres cerclées de fer, pendus à des chaînes.
 *   - lisse (=) = obsidienne à reflets obliques violets (le seul froid du décor).
 *   - mortel (^) = pics de fer à pointe rouge plantés dans une fosse de lave. La lave vit UNIQUEMENT
 *     sous les pics : un sol de cave sans pics reste de la pierre sombre, des braises, une lueur.
 * La cave est le cachot du rempart : voûtes, piliers, soupiraux rougeoyants, chaînes et fers.
 */
import { T_SLICK, T_SOLID, T_SPIKE } from '../../../../sim';
import { Buf, dith, fbm, fsin, hash2, lerpC, type Color } from '../../../pixel/engine';
import { banner, sagPoint, WOOD } from '../../../pixel/kit';
import { ART_TILE, nearGameplay, solidAt, tileOf, type LevelShape, type Region } from '../../levelShape';
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
  type SolidTile,
} from '../paintKit';
import type { LevelCanvases, PropAnim, PropInstance } from '../types';
import { K } from './palette';

const T = ART_TILE;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ rempart (masses accrochables)

/**
 * Pierre du rempart en coordonnées monde (stoneWall de la planche) : assises de 8 px (joint à
 * y % 8 = 4, comme le premier joint 4 px sous l'arête), joints verticaux tous les 14 px décalés de 6
 * une assise sur deux, taches claires au milieu des assises. En plus de la planche : une teinte par
 * pierre, une ombre sous chaque pierre et des traînées de suie.
 */
function stoneAt(x: number, y: number): Color {
  const yy = y - 4;
  const course = Math.floor(yy / 8);
  const inY = yy - course * 8;
  const xx = x - (course & 1 ? 6 : 0);
  const stone = Math.floor(xx / 14);
  const inX = xx - stone * 14;
  if (inY === 0 || inX === 0) return K.mortar;
  const tone = hash2(stone, course, 21);
  let c: Color = tone > 0.86 ? K.wallLt : tone < 0.22 ? K.wallDk : K.wall;
  if (inY === 4 && hash2(x, y + 4, 8) > 0.82) c = K.wallLt;
  else if (inY === 7 && hash2(stone, course, 22) > 0.35) c = tone < 0.22 ? K.soot : K.wallDk;
  else if (hash2(x, y, 23) > 0.975) c = K.wallDk;
  // Suie : de grandes plages sombres (bruit étiré en largeur) qui cassent la régularité du mur.
  const s = fbm(x / 26, y / 12, 5, 0, 2);
  if (s > 0.64) c = c === K.wallLt ? K.wall : c === K.wall ? K.wallDk : K.soot;
  return c;
}

/** Dessus du chemin de ronde : l'arête claire de la planche (#c79a72) puis la ligne #5e5250. */
function walkTop(b: Buf, s: SolidTile): void {
  for (let x = s.X; x < s.X + T; x++) {
    b.px(x, s.Y, K.wallTop);
    b.px(x, s.Y + 1, K.wallLt);
    // Dalles du chemin de ronde : un joint discret tous les 16 px, décalé du joint des pierres.
    if (x % 16 === 9) b.px(x, s.Y + 1, K.mortar);
  }
}

/** Dessus d'une pierre sous une fosse de lave : croûte cuite, pas une arête (on n'y va pas). */
function crustTop(b: Buf, s: SolidTile): void {
  for (let x = s.X; x < s.X + T; x++) {
    b.px(x, s.Y, dith(x, s.Y, K.crustHot, K.flow[3], 0.35));
    b.px(x, s.Y + 1, K.crustHot);
    b.px(x, s.Y + 2, dith(x, s.Y + 2, K.crust, K.crustHot, 0.4));
    b.px(x, s.Y + 3, dith(x, s.Y + 3, K.wallDk, K.crust, 0.5));
  }
}

/** Face latérale exposée : pierre d'angle claire et chaude, joints marqués d'un cran. */
function sideEdge(b: Buf, s: SolidTile, right: boolean): void {
  const xo = right ? s.X + T - 1 : s.X;
  const xi = right ? s.X + T - 2 : s.X + 1;
  const y0 = s.faces & FACE_TOP ? s.Y + 2 : s.Y;
  const y1 = s.faces & FACE_BOTTOM ? s.Y + T - 2 : s.Y + T;
  for (let y = y0; y < y1; y++) {
    const joint = (((y - 4) % 8) + 8) % 8 === 0;
    b.px(xo, y, joint ? K.wallSideDk : K.wallSide);
    b.px(xi, y, joint ? K.mortar : right ? K.wallDk : K.wallLt);
  }
  if (s.faces & FACE_TOP) {
    b.px(xo, s.Y, K.wallTop);
    b.px(xo, s.Y + 1, K.wallTop);
  }
}

/** Dessous exposé (plafond, voûte de la cave) : arête éclairée par la braise d'en bas, corbeaux. */
function underEdge(b: Buf, s: SolidTile): void {
  const y = s.Y + T - 1;
  for (let x = s.X; x < s.X + T; x++) {
    b.px(x, y, K.wallUnder);
    const cb = ((x % 16) + 16) % 16;
    // Corbeaux : petits blocs saillants tous les 16 px, dont le bas prend la lueur.
    if (cb >= 5 && cb <= 10) {
      b.px(x, y - 1, cb === 5 ? K.wallUnderDk : K.corbel);
      b.px(x, y - 2, cb === 5 || cb === 10 ? K.mortar : K.corbel);
    } else b.px(x, y - 1, K.wallUnderDk);
  }
  if (s.faces & FACE_LEFT) b.px(s.X, y, K.wallSide);
  if (s.faces & FACE_RIGHT) b.px(s.X + T - 1, y, K.wallSide);
}

function rampartTile(b: Buf, shape: LevelShape, s: SolidTile): void {
  const w = b.w;
  for (let y = s.Y; y < s.Y + T; y++) {
    const o = y * w;
    for (let x = s.X; x < s.X + T; x++) b.d[o + x] = stoneAt(x, y);
  }
  if (s.faces & FACE_LEFT) sideEdge(b, s, false);
  if (s.faces & FACE_RIGHT) sideEdge(b, s, true);
  if (s.faces & FACE_BOTTOM) underEdge(b, s);
  if (s.faces & FACE_TOP) {
    if (tileOf(shape, s.tx, s.ty - 1) === T_SPIKE) crustTop(b, s);
    else walkTop(b, s);
  }
}

// ------------------------------------------------------------------ obsidienne (lisse)

/**
 * Obsidienne (KIT.slick de la planche) : reflets obliques violets tous les 7 px en coordonnées
 * monde, arête haute #9a86ad. En plus : des pans de verre plus ou moins profonds et, de loin en loin,
 * un long reflet plus clair qui file en diagonale.
 */
function obsidianTile(b: Buf, s: SolidTile): void {
  for (let y = s.Y; y < s.Y + T; y++) {
    for (let x = s.X; x < s.X + T; x++) {
      const pane = hash2(Math.floor((x - y * 0.5) / 11), Math.floor(y / 24), 31);
      let c: Color = pane > 0.72 ? K.obsBand : pane < 0.16 ? K.obsDeep : K.obs;
      if ((x + y) % 7 === 0 && hash2(x, y, 3) > 0.3) c = K.obsGloss;
      else if ((x + y) % 7 === 1 && pane > 0.72 && hash2(x, y, 4) > 0.55) c = K.obsEdge;
      if ((x + y) % 31 === 0 && hash2(Math.floor((x - y) / 12), 0, 13) > 0.6) c = K.obsTop;
      b.px(x, y, c);
    }
  }
  const f = s.faces;
  if (f & FACE_BOTTOM) b.hline(s.X, s.X + T - 1, s.Y + T - 1, K.obsEdge);
  if (f & FACE_LEFT) b.rect(s.X, s.Y, 1, T, K.obsEdge);
  if (f & FACE_RIGHT) b.rect(s.X + T - 1, s.Y, 1, T, K.obsEdge);
  if (f & FACE_TOP) {
    b.hline(s.X, s.X + T - 1, s.Y, K.obsTop);
    b.hline(s.X, s.X + T - 1, s.Y + 1, K.obsGloss);
  }
}

// ------------------------------------------------------------------ ancrages flottants (bois)

/** Poutre cerclée de fer : fil du bois, frettes rivetées, dessous éclairé par la braise. */
function hoopedBeam(b: Buf, X: number, Y: number, W: number, H: number): void {
  for (let y = Y; y < Y + H; y++) {
    const j = y - Y;
    for (let x = X; x < X + W; x++) {
      let c: Color = WOOD.body;
      if (j === 0) c = WOOD.top;
      else if (j === 1) c = WOOD.mid;
      else if (j === H - 1) c = K.woodUnder;
      else if (j === H - 2) c = WOOD.dark;
      else if ((j + 2) % 5 === 0 && hash2(x >> 2, y, 5) > 0.25) c = WOOD.seam;
      else if (hash2(x, y, 6) > 0.975) c = WOOD.knot;
      else if (j >= H - 5 && fbm(x / 7, y / 3, 9, 0, 2) > 0.62) c = K.char;
      b.px(x, y, c);
    }
  }
  // Bois de bout aux deux extrémités (on s'y accroche aussi de côté).
  for (let y = Y + 1; y < Y + H - 1; y++) {
    b.px(X, y, WOOD.mid);
    b.px(X + 1, y, y % 3 === 0 ? WOOD.seam : WOOD.body);
    b.px(X + W - 1, y, WOOD.mid);
  }
  const hoops: number[] = [X + 4, X + W - 7];
  for (let hx = X + 26; hx < X + W - 24; hx += 24) hoops.push(hx);
  for (const hx of hoops) {
    for (let y = Y; y < Y + H; y++) {
      const top = y === Y;
      b.px(hx, y, top ? K.ironHi : K.iron);
      b.px(hx + 1, y, top ? K.ironHi : y === Y + H - 1 ? K.chainDk : K.iron);
      b.px(hx + 2, y, top ? K.ironHi : K.spikeDk);
    }
    b.px(hx + 1, Y + 4, K.rivet);
    b.px(hx + 1, Y + H - 5, K.rivet);
  }
}

/** Échafaudage : planches du dessus (KIT.planks), poutre porteuse et croix de bois dessous. */
function scaffold(b: Buf, X: number, Y: number, W: number, H: number): void {
  for (let y = Y; y < Y + H; y++) {
    const j = y - Y;
    for (let x = X; x < X + W; x++) {
      let c: Color;
      if (j === 0) c = WOOD.top;
      else if (j === 1) c = WOOD.mid;
      else if (j < 5) c = (x - X) % 11 === 5 ? WOOD.seam : WOOD.body;
      else if (j === 5) c = WOOD.dark;
      else if (j === H - 1) c = K.woodUnder;
      else c = WOOD.post;
      b.px(x, y, c);
    }
  }
  for (let s = X + 5; s < X + W; s += 11) if (hash2(s, Y, 3) > 0.6 && s + 4 < X + W) b.px(s + 4, Y + 3, WOOD.knot);
  // Croix de Saint-André entre deux montants, comme la tour de guet de la planche.
  const y0 = Y + 6;
  const y1 = Y + H - 2;
  const bay = 16;
  for (let x0 = X; x0 < X + W; x0 += bay) {
    const x1 = Math.min(X + W - 1, x0 + bay - 1);
    b.line(x0 + 1, y0, x1 - 1, y1, WOOD.seam);
    b.line(x1 - 1, y0, x0 + 1, y1, WOOD.seam);
    b.rect(x0, y0, 1, y1 - y0 + 1, WOOD.postHi);
  }
  b.rect(X + W - 1, Y + 1, 1, H - 2, WOOD.mid);
  b.rect(X, Y + 1, 1, H - 2, WOOD.mid);
  b.hline(X, X + W - 1, Y + H - 2, WOOD.dark);
}

function paintFloat(b: Buf, r: Region): void {
  const X = r.x0 * T;
  const Y = r.y0 * T;
  const W = (r.x1 - r.x0 + 1) * T;
  const H = (r.y1 - r.y0 + 1) * T;
  if (hash2(r.x0, r.y0, 77) < 0.55) hoopedBeam(b, X, Y, W, H);
  else scaffold(b, X, Y, W, H);
}

function paintSolids(shape: LevelShape, b: Buf): void {
  const done = new Set<number>();
  forEachSolid(shape, (s) => {
    if (s.type === T_SLICK) {
      obsidianTile(b, s);
      return;
    }
    const r = s.region;
    if (r.kind === 'float' || r.kind === 'slab') {
      if (!done.has(r.id)) {
        done.add(r.id);
        paintFloat(b, r);
      }
      return;
    }
    // Sol, murs, bordures et piliers accrochables : le même rempart, arêtes chaudes sur chaque face.
    rampartTile(b, shape, s);
  });
}

// ------------------------------------------------------------------ chaînes

/** Un maillon de chaîne vu de profil (anneau, barreau) : `i` = rang le long de la chaîne. */
function chainLink(b: Buf, x: number, y: number, i: number): void {
  const k = ((i % 6) + 6) % 6;
  if (k === 1) {
    b.px(x - 1, y, K.chain);
    b.px(x + 1, y, K.chainDk);
  } else if (k === 0 || k === 2) b.px(x, y, K.chain);
  else b.px(x, y, k === 4 ? K.chain : K.chainDk);
}

/** Chaîne qui monte et se perd dans la fumée ; s'arrête au premier plein (le plafond). */
function risingChain(b: Buf, shape: LevelShape, x: number, y: number, len: number, fade: number, seed: number): void {
  for (let i = 0; i < len; i++) {
    const yy = y - i;
    if (yy < 1) break;
    if (solidAt(shape, Math.floor(x / T), Math.floor(yy / T))) {
      // Platine de fer au plafond.
      b.hline(x - 2, x + 2, yy + 1, K.iron);
      b.px(x, yy + 2, K.chain);
      break;
    }
    const f = i < len - fade ? 1 : 1 - (i - (len - fade)) / fade;
    if (f < 1 && hash2(x, yy, seed) > f) continue;
    chainLink(b, x, yy, i);
  }
}

/** Chaîne en chaînette entre deux points (maillons clairs et sombres en alternance). */
function sagChain(b: Buf, ax: number, ay: number, bx: number, by: number, sag: number): void {
  const n = Math.max(8, Math.round(Math.abs(bx - ax) * 1.2));
  let lx = NaN;
  let ly = NaN;
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const [fx, fy] = sagPoint(ax, ay, bx, by, sag, i / n);
    const x = Math.round(fx);
    const y = Math.round(fy);
    if (x === lx && y === ly) continue;
    b.px(x, y, (k >> 1) % 2 ? K.chain : K.chainDk);
    lx = x;
    ly = y;
    k++;
  }
}

/** Ancrages suspendus : deux chaînes par bloc (une par tronçon de 4 tuiles pour les longs). */
function paintSupports(shape: LevelShape, b: Buf): void {
  const blocks = [...floatingBlocks(shape), ...floatingBlocks(shape, T_SLICK)];
  for (const r of blocks) {
    // Les dalles collées au plafond n'ont pas besoin de chaînes.
    if (solidAt(shape, Math.floor((r.x0 + r.x1) / 2), r.y0 - 1)) continue;
    const X = r.x0 * T;
    const Y = r.y0 * T;
    const W = (r.x1 - r.x0 + 1) * T;
    const n = Math.max(2, Math.round(W / (4 * T)) + 1);
    for (let k = 0; k < n; k++) {
      const x = Math.round(X + 5 + ((W - 11) * k) / (n - 1));
      // Anneau d'attache sur le dessus du bloc.
      b.px(x - 1, Y - 1, K.iron);
      b.px(x + 1, Y - 1, K.iron);
      b.px(x, Y - 2, K.chain);
      const len = 64 + Math.floor(hash2(r.x0 + k, r.y0, 92) * 50);
      risingChain(b, shape, x, Y - 3, len, 40, r.id * 7 + k);
    }
  }
}

// ------------------------------------------------------------------ guirlandes de chaînes

function paintGarlands(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  const blocks = floatingBlocks(shape);
  for (const [a, c] of rowPairs(blocks, 12)) {
    const seed = hash2(a.x0, a.y0, 51);
    if (seed < 0.45) continue;
    const ax = (a.x1 + 1) * T - 3;
    const ay = a.y1 * T + T;
    const bx = c.x0 * T + 2;
    const by = c.y1 * T + T;
    const gap = bx - ax;
    const sag = 10 + gap * 0.12;
    sagChain(b, ax, ay, bx, by, sag);
    const low = a.y0 >= shape.floorRow - 12;
    // Paniers de feu sur les rangées basses, fers et plaques sur les autres.
    const n = Math.max(1, Math.min(2, Math.floor(gap / 40)));
    for (let i = 1; i <= n; i++) {
      const [x, y] = sagPoint(ax, ay, bx, by, sag, i / (n + 1));
      if (low || seed > 0.8) props.push({ kind: 'basket', x: Math.round(x), y: Math.round(y), phase: hash2(a.x0, i, 52) * 4, layer: 'back' });
      else {
        // Plaque de fer gravée (ema de fer) qui pend à la chaîne.
        const px = Math.round(x);
        const py = Math.round(y);
        b.px(px, py + 1, K.chain);
        b.px(px, py + 2, K.chainDk);
        b.rect(px - 2, py + 3, 5, 4, K.iron);
        b.hline(px - 2, px + 2, py + 3, K.ironHi);
        b.px(px, py + 5, K.bronze);
      }
    }
  }
}

// ------------------------------------------------------------------ cachot de la cave

const PIER_P = 96;
const PIER_W = 12;

interface CaveColumn {
  /** Haut de l'air de la cave dans cette colonne (px), -1 si pas de cave. */
  top: number;
  /** Sol de la cave (px). */
  floor: number;
  /** Trou du sol principal au-dessus (on voit le ciel). */
  hole: boolean;
}

function caveColumns(shape: LevelShape): CaveColumn[] {
  const out: CaveColumn[] = [];
  const fr = shape.floorRow;
  for (let tx = 0; tx < shape.w; tx++) {
    let ty = fr;
    const hole = !solidAt(shape, tx, fr) && !solidAt(shape, tx, fr + 1);
    while (ty < shape.h && solidAt(shape, tx, ty)) ty++;
    if (ty >= shape.h) {
      out.push({ top: -1, floor: -1, hole });
      continue;
    }
    let tb = ty;
    while (tb < shape.h && !solidAt(shape, tx, tb)) tb++;
    out.push({ top: ty * T, floor: tb * T, hole });
  }
  return out;
}

/** Intensité (0..1) de la lueur des fosses de lave en (x, y) : forte au ras des pics, nulle à 44 px. */
function lavaLight(shape: LevelShape, x: number, y: number): number {
  let best = 0;
  for (const run of shape.spikes) {
    const x0 = run.x0 * T;
    const x1 = (run.x1 + 1) * T;
    const ys = run.y * T + 10;
    const dy = ys - y;
    if (dy < -8 || dy > 44) continue;
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    if (dx > 24) continue;
    const k = Math.max(0, 1 - Math.hypot(dx * 1.4, Math.max(0, dy)) / 44);
    if (k > best) best = k;
  }
  return best;
}

function paintCave(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  const cols = caveColumns(shape);
  const fr = shape.floorRow;
  const nearSpikes = (tx: number, ty: number): boolean => {
    for (const run of shape.spikes) if (tx >= run.x0 - 4 && tx <= run.x1 + 4 && ty >= run.y - 5 && ty <= run.y) return true;
    return false;
  };
  for (let ty = fr; ty < shape.h; ty++) {
    for (let tx = 0; tx < shape.w; tx++) {
      if (!isCaveAir(shape, tx, ty)) continue;
      const col = cols[tx];
      const X = tx * T;
      const Y = ty * T;
      const lit = nearSpikes(tx, ty);
      for (let y = Y; y < Y + T; y++) {
        const o = y * b.w;
        for (let x = X; x < X + T; x++) {
          b.d[o + x] = caveAt(shape, cols, col, x, y, lit);
        }
      }
    }
  }
  paintCaveDecor(shape, b, cols, props);
}

/** Un pixel du fond du cachot : moellons, piliers, voûtes, lueur de braise au ras du sol. */
function caveAt(shape: LevelShape, cols: CaveColumn[], col: CaveColumn, x: number, y: number, lit: boolean): Color {
  const fr = shape.floorRow * T;
  // Moellons du fond : assises de 12 px, pierres de 22 px.
  const course = Math.floor(y / 12);
  const inY = y - course * 12;
  const xx = x + (course & 1 ? 11 : 0);
  const st = Math.floor(xx / 22);
  const inX = xx - st * 22;
  const tone = hash2(st, course, 61);
  let c: Color = inY === 0 || inX === 0 ? K.cave[0] : tone > 0.8 ? K.cave[2] : tone < 0.3 ? K.cave[0] : K.cave[1];
  if (inY === 1 && inX > 0 && tone > 0.5) c = K.cave[2];

  const px = ((x % PIER_P) + PIER_P) % PIER_P;
  const bay = Math.floor(x / PIER_P);
  const top = col.top;
  let recess = false;
  if (top >= 0 && !col.hole) {
    const caveH = col.floor - top;
    if (px < PIER_W) {
      // Pilier : pierres plus claires, arête gauche qui prend la lueur.
      const pc = Math.floor((y - top) / 10);
      const pin = (y - top) - pc * 10;
      c = pin === 0 ? K.cave[0] : px === 0 ? K.pierLt : px === PIER_W - 1 ? K.cave[0] : hash2(bay, pc, 62) > 0.6 ? K.pierLt : K.pier;
      if (pin === 1 && px > 0 && px < PIER_W - 1) c = K.pierLt;
    } else if (caveH >= 40) {
      // Voûte en arc surbaissé entre deux piliers, sous le plafond.
      const span = PIER_P - PIER_W;
      const u = (px - PIER_W - span / 2) / (span / 2);
      const rise = Math.min(22, caveH * 0.32);
      const spring = top + 8 + rise;
      const yi = spring - rise * Math.sqrt(Math.max(0, 1 - u * u));
      if (y < yi - 5) {
        // Écoinçon : pierre de taille du pilier.
        const pc = Math.floor((y - top) / 10);
        c = (y - top) % 10 === 0 ? K.cave[0] : hash2(bay * 7 + Math.floor(px / 16), pc, 63) > 0.7 ? K.pierLt : K.pier;
      } else if (y < yi) {
        // Claveaux : joints rayonnants, intrados éclairé par en dessous.
        const ang = Math.atan2(y - spring, px - PIER_W - span / 2);
        const vk = Math.floor(ang * 7);
        const vjoint = Math.floor((ang - 0.02) * 7) !== vk;
        c = vjoint ? K.cave[0] : y >= yi - 1 ? K.caveGlowHi : K.pierLt;
      } else {
        recess = true;
      }
    }
  }
  if (recess || col.hole) {
    // Fond de la travée, plus profond.
    c = c === K.cave[2] ? K.cave[1] : c === K.cave[1] ? K.cave[0] : K.recess;
  }
  // Lueur de braise au ras du sol de la cave : un fondu doux, un peu de grain tout en bas.
  if (col.floor > 0) {
    const d = col.floor - y;
    if (d >= 0 && d < 30) {
      const k = (1 - d / 30) ** 2;
      c = lerpC(c, K.caveGlow, k * 0.55);
      if (d < 8 && dith(x, y, 0, 1, (1 - d / 8) * 0.35) === 1) c = lerpC(c, K.caveGlowHi, 0.7);
    }
  }
  // Près des fosses, la lave rougit le mur (fondu, jamais de damier au-dessus du sol sûr).
  if (lit) {
    const k = lavaLight(shape, x, y);
    if (k > 0) {
      c = lerpC(c, K.flow[4], k * k * 0.42);
      if (k > 0.7 && dith(x, y, 0, 1, (k - 0.7) * 1.3) === 1) c = lerpC(c, K.flow[3], 0.3);
    }
  }
  // Trou du sol principal : un peu de la lumière rouge du ciel tombe dans le cachot.
  if (col.hole || (top >= 0 && neighborsHole(cols, x))) {
    const depth = Math.max(0, y - fr) / 72;
    const k = Math.max(0, 1 - depth) * (col.hole ? 1 : 0.4);
    c = lerpC(c, K.smokeGlow, k * 0.22);
    if (dith(x, y, 0, 1, k * 0.14) === 1) c = lerpC(c, K.smokeGlow, 0.35);
  }
  return c;
}

function neighborsHole(cols: CaveColumn[], x: number): boolean {
  const tx = Math.floor(x / T);
  return (cols[tx - 1]?.hole ?? false) || (cols[tx + 1]?.hole ?? false);
}

/** Longueurs des chaînes animées qui pendent des voûtes (frames pré-calculées par longueur). */
const HOOK_LENS = [12, 20, 28] as const;
const CAGE_LEN = 10;

/** Soupiraux rougeoyants, chaînes et cages qui se balancent sous les voûtes, fers au mur. */
function paintCaveDecor(shape: LevelShape, b: Buf, cols: CaveColumn[], props: PropInstance[]): void {
  for (let bx = 0; bx * PIER_P < shape.pw; bx++) {
    const x0 = bx * PIER_P + PIER_W;
    const cx = x0 + Math.floor((PIER_P - PIER_W) / 2);
    const tx = Math.floor(cx / T);
    const col = cols[tx];
    if (!col || col.top < 0 || col.hole) continue;
    // La travée doit avoir un plafond sur toute sa largeur.
    let closed = true;
    for (let k = Math.floor(x0 / T); k <= Math.floor((x0 + PIER_P - PIER_W - 1) / T); k++) {
      const c = cols[k];
      if (!c || c.hole || c.top !== col.top) closed = false;
    }
    const caveH = col.floor - col.top;
    const hs = hash2(bx, 0, 71);
    if (closed && caveH >= 40) {
      const rise = Math.min(22, caveH * 0.32);
      const crown = col.top + 8;
      // Chaîne qui pend de la clef de voûte et se balance : un crochet au bout, ou une cage de fer.
      if (hs > 0.45) {
        const phase = hash2(bx, 3, 71) * 5;
        if (hs > 0.78 && caveH >= 60) props.push({ kind: 'cage', x: cx, y: crown, phase, layer: 'back' });
        else {
          const room = 10 + Math.floor(hash2(bx, 1, 71) * Math.min(26, caveH - rise - 20));
          let len: number = HOOK_LENS[0];
          for (const l of HOOK_LENS) if (l <= room) len = l;
          props.push({ kind: `hook${len}`, x: cx, y: crown, phase, layer: 'back' });
        }
      }
    }
    // Soupirail : ouverture à barreaux, lueur de forge derrière.
    if (caveH >= 44 && hs < 0.4 && !nearSpike(shape, tx)) {
      const gx = cx - 7 + Math.floor(hash2(bx, 2, 71) * 6) - 3;
      const gy = col.floor - 24;
      b.rect(gx - 1, gy - 1, 16, 11, K.cave[0]);
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 14; x++) {
          const k = 1 - Math.abs(x - 6.5) / 8 - y / 14;
          b.px(gx + x, gy + y, dith(gx + x, gy + y, K.caveGlowHi, k > 0.45 ? K.grateHi : K.grate, Math.max(0, k * 1.4)));
        }
      }
      for (let x = 1; x < 14; x += 3) b.rect(gx + x, gy, 1, 9, K.spikeDk);
      b.hline(gx, gx + 13, gy + 4, K.spikeDk);
      // Halo tramé autour du soupirail.
      for (let y = gy - 8; y < gy + 16; y++) {
        for (let x = gx - 10; x < gx + 24; x++) {
          const d = Math.hypot((x - gx - 7) / 1.4, y - gy - 4);
          if (d < 7 || d > 16) continue;
          if (dith(x, y, 0, 1, (1 - d / 16) * 0.55) === 1) {
            const c = b.get(x, y);
            if (c !== 0 && c !== K.spikeDk) b.px(x, y, lerpC(c, K.grate, 0.35));
          }
        }
      }
    } else if (caveH >= 36 && hs > 0.82) {
      // Fers scellés au mur : deux anneaux et une chaîne molle.
      const wx = cx - 10;
      const wy = col.floor - 26;
      for (const ax of [wx, wx + 20]) {
        b.rect(ax - 1, wy - 1, 3, 1, K.iron);
        b.px(ax - 1, wy, K.iron);
        b.px(ax + 1, wy, K.iron);
        b.px(ax, wy + 1, K.chainDk);
      }
      sagChain(b, wx, wy + 1, wx + 20, wy + 1, 9);
    }
  }
}

function nearSpike(shape: LevelShape, tx: number): boolean {
  for (const run of shape.spikes) if (tx >= run.x0 - 3 && tx <= run.x1 + 3) return true;
  return false;
}

/** Sol de la cave (hors fosses) : braseros, tas de braises, os. */
function paintCaveFloor(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  shape.tops.forEach((run, ri) => {
    if (run.type !== T_SOLID || run.y <= shape.floorRow + 1) return;
    for (let tx = run.x0 + 1; tx <= run.x1 - 1; tx += 3) {
      if (nearSpike(shape, tx) || nearGameplay(shape, tx, run.y - 1)) continue;
      // Il faut un peu d'air au-dessus.
      if (solidAt(shape, tx, run.y - 2)) continue;
      const h = hash2(tx, run.y, 81 + ri);
      const x = tx * T + 3 + Math.floor(hash2(tx, run.y, 82) * 10);
      const y = run.y * T;
      if (h < 0.18) {
        brazier(b, x, y);
        props.push({ kind: 'brazier', x, y: y - 16, phase: hash2(tx, 1, 83) * 3, layer: 'back' });
      } else if (h < 0.42) {
        // Tas de braises au sol.
        coalPile(b, x, y);
        props.push({ kind: 'coals', x, y: y - 2, phase: hash2(tx, 2, 83) * 2, layer: 'back' });
      } else if (h < 0.52) {
        // Os et crâne.
        b.hline(x - 5, x + 1, y - 1, K.bone);
        b.px(x - 6, y - 2, K.bone);
        b.px(x + 2, y - 2, K.bone);
        b.rect(x + 4, y - 4, 4, 3, K.bone);
        b.px(x + 5, y - 3, K.boneDk);
        b.px(x + 7, y - 3, K.boneDk);
        b.hline(x + 4, x + 7, y - 1, K.boneDk);
      }
    }
  });
}

function coalPile(b: Buf, x: number, y: number): void {
  b.ellipse(x, y - 1, 6, 2, K.char);
  for (let k = 0; k < 10; k++) {
    const dx = Math.round((hash2(x, k, 84) - 0.5) * 10);
    const dy = Math.round(hash2(x, k, 85) * 2);
    b.px(x + dx, y - 1 - dy, k % 3 === 0 ? K.ember[2] : K.crust);
  }
}

// ------------------------------------------------------------------ pics sur lave

/**
 * Pics de fer à pointe rouge (grammaire : pointe rouge = mortel), la pointe marque le haut de la
 * tuile mortelle. La lave animée est posée dessous par le runtime (calque du milieu), jamais
 * ailleurs que dans ces fosses.
 */
function paintSpikes(shape: LevelShape, b: Buf): void {
  for (const run of shape.spikes) {
    const X0 = run.x0 * T;
    const X1 = (run.x1 + 1) * T - 1;
    const Y = run.y * T;
    const yb = Y + 11;
    let n = 0;
    for (let x = X0 + 1; x <= X1 - 4; x += 5, n++) {
      const tall = n % 2 === 0;
      const hh = (tall ? 10 : 7) + Math.floor(hash2(x, run.y, 2) * 2);
      const top = yb - hh;
      b.poly([x, yb, x + 2.5, top, x + 5, yb], K.spike);
      b.line(x + 1, yb - 1, x + 2, top + 2, K.spikeHi);
      b.line(x + 4, yb - 1, x + 3, top + 3, K.spikeDk);
      // Fer chauffé au ras de la lave.
      b.hline(x + 1, x + 3, yb - 1, K.spikeHot);
      // Pointe rouge : on recolore la silhouette du fer sur ses 4 premiers pixels.
      b.px(x + 2, top, tall ? K.tipHot : K.tip);
      for (let y = top + 1; y <= top + 3; y++) {
        for (let xx = x; xx <= x + 5; xx++) {
          const c = b.get(xx, y);
          if (c === K.spike || c === K.spikeHi || c === K.spikeDk) b.px(xx, y, K.tip);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ chemin de ronde

function brazier(b: Buf, x: number, y: number): void {
  for (let i = -1; i <= 1; i++) b.stroke(x + i * 5, y - 1, x + i * 2, y - 12, 1, K.iron);
  b.hline(x - 4, x + 4, y - 8, K.iron);
  b.rect(x - 6, y - 16, 13, 4, K.iron);
  b.hline(x - 6, x + 6, y - 16, K.ironHi);
  b.hline(x - 5, x + 5, y - 13, K.spikeDk);
  b.px(x - 6, y - 13, K.iron);
  b.px(x + 6, y - 13, K.iron);
}

function toro(b: Buf, x: number, y: number): void {
  const bx = x - 5;
  b.rect(bx - 1, y - 20, 12, 3, K.stoneHi);
  b.px(bx - 2, y - 18, K.stoneHi);
  b.px(bx + 11, y - 18, K.stoneHi);
  b.rect(bx, y - 17, 10, 3, K.stone);
  b.rect(bx + 2, y - 14, 6, 5, K.stoneDk);
  b.rect(bx + 3, y - 13, 4, 3, K.fire[2]);
  b.rect(bx + 4, y - 13, 2, 2, K.fire[1]);
  b.rect(bx + 3, y - 9, 4, 6, K.stone);
  b.rect(bx, y - 3, 10, 3, K.stone);
  b.hline(bx, bx + 9, y - 3, K.stoneHi);
}

/** Tate : grands pavois de bois calés sur une béquille, marqués du mon du clan. */
function tate(b: Buf, x: number, y: number): void {
  for (let k = 0; k < 2; k++) {
    const sx = x - 9 + k * 10;
    const top = y - 18 + k * 2;
    b.rect(sx, top, 8, y - top, WOOD.body);
    b.rect(sx, top, 1, y - top, WOOD.mid);
    b.hline(sx, sx + 7, top, WOOD.mid);
    b.rect(sx + 7, top + 1, 1, y - top - 1, WOOD.dark);
    for (let yy = top + 5; yy < y; yy += 6) b.hline(sx + 1, sx + 6, yy, WOOD.seam);
    b.rect(sx + 3, top + 3, 2, 2, k ? K.clothMark : K.char);
    b.line(sx + 7, top + 4, sx + 11, y - 1, WOOD.post);
  }
}

/** Tawara : balles de riz empilées, cordées. */
function tawara(b: Buf, x: number, y: number): void {
  const straw = lerpC(K.bronzeDk, K.bronze, 0.45);
  const strawHi = K.bronze;
  const bales: [number, number][] = [[x - 6, y - 4], [x + 5, y - 4], [x, y - 11]];
  for (const [bx, by] of bales) {
    b.ellipse(bx, by, 6, 4, straw);
    b.hline(bx - 4, bx + 4, by - 3, strawHi);
    b.rect(bx - 3, by - 3, 1, 7, K.char);
    b.rect(bx + 3, by - 3, 1, 7, K.char);
  }
}

/** Taiko de guerre sur son chevalet. */
function taiko(b: Buf, x: number, y: number): void {
  b.line(x - 7, y - 1, x - 3, y - 8, WOOD.post);
  b.line(x + 7, y - 1, x + 3, y - 8, WOOD.post);
  b.ellipse(x, y - 13, 8, 6, K.castle);
  b.rect(x - 8, y - 15, 17, 4, K.under);
  b.hline(x - 8, x + 8, y - 15, K.gold);
  b.hline(x - 8, x + 8, y - 11, K.gold);
  b.ellipse(x, y - 13, 3, 5, K.cloth);
  b.ellipse(x, y - 13, 2, 4, lerpC(K.cloth, K.bronzeDk, 0.35));
}

/** Shōrō : petit beffroi (deux poteaux, toit), la cloche est un accessoire animé. */
function shoro(b: Buf, x: number, y: number): void {
  for (const px of [x - 16, x + 13]) {
    b.rect(px, y - 44, 3, 44, WOOD.post);
    b.rect(px, y - 44, 1, 44, WOOD.postHi);
  }
  b.rect(x - 18, y - 46, 37, 3, WOOD.post);
  b.hline(x - 18, x + 18, y - 46, WOOD.mid);
  b.poly([x - 24, y - 46, x + 25, y - 46, x + 16, y - 56, x - 15, y - 56], K.roof);
  b.hline(x - 24, x + 24, y - 46, K.under);
  b.poly([x - 6, y - 56, x + 7, y - 56, x, y - 61], K.roof);
  b.px(x - 23, y - 47, K.gold);
  b.px(x + 23, y - 47, K.gold);
  b.rect(x - 18, y - 4, 37, 4, K.stoneDk);
  b.hline(x - 18, x + 18, y - 4, K.stone);
}

/** Poutre calcinée tombée en travers, braises dans les fentes. */
function burntBeam(b: Buf, x: number, y: number, flip: boolean): void {
  const s = flip ? -1 : 1;
  b.stroke(x - 10 * s, y - 2, x + 9 * s, y - 7, 3, K.char);
  b.line(x - 10 * s, y - 3, x + 9 * s, y - 8, K.charHi);
  for (let k = -8; k <= 7; k += 3) {
    const px = x + k * s;
    const py = Math.round(y - 4.5 - (k + 10) * 0.25);
    if (hash2(px, y, 66) > 0.4) b.px(px, py, k % 2 ? K.ember[2] : K.crustHot);
  }
  b.rect(x - 13, y - 2, 4, 2, K.char);
  b.px(x + 12, y - 1, K.charHi);
}

function airAbove(shape: LevelShape, px: number, y: number, rows: number, half = 1): boolean {
  const ty = Math.floor(y / T);
  const tx = Math.floor(px / T);
  for (let k = 1; k <= rows; k++) for (let dx = -half; dx <= half; dx++) if (tileOf(shape, tx + dx, ty - k) !== 0) return false;
  return true;
}

function paintDeck(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  const spots = deckSpots(shape, 5, 61, { mainFloorOnly: true, margin: 2 });
  spots.forEach((spot, i) => {
    const { x, y } = spot;
    if (!airAbove(shape, x, y, 2)) return;
    const kind = hash2(Math.floor(x / T), i, 62);
    if (i % 3 === 0 && airAbove(shape, x, y, 3, 0)) {
      props.push({ kind: 'nobori', x, y, phase: hash2(x, 1, 63) * 2, layer: 'back' });
      return;
    }
    if (kind < 0.26) {
      brazier(b, x, y);
      props.push({ kind: 'brazier', x, y: y - 16, phase: hash2(x, 2, 64) * 3, layer: 'back' });
    } else if (kind < 0.4) {
      toro(b, x, y);
      props.push({ kind: 'toro', x, y: y - 12, phase: hash2(x, 3, 64) * 3, layer: 'back' });
    } else if (kind < 0.53) tate(b, x, y);
    else if (kind < 0.65) tawara(b, x, y);
    else if (kind < 0.76) taiko(b, x, y);
    else if (kind < 0.88) {
      // Poutre tombée d'un toit, qui brûle encore.
      burntBeam(b, x, y, hash2(x, 5, 64) > 0.5);
      props.push({ kind: 'smallfire', x: x + 3, y: y - 5, phase: hash2(x, 6, 64) * 2, layer: 'back' });
    } else if (airAbove(shape, x, y, 4, 2)) {
      shoro(b, x, y);
      props.push({ kind: 'bell', x, y: y - 43, phase: hash2(x, 4, 64) * 4, layer: 'back' });
    } else tawara(b, x, y);
  });
}

// ------------------------------------------------------------------ murs : torches

function paintWallTorches(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  for (const r of shape.regions) {
    if (r.type !== T_SOLID || r.kind !== 'frame') continue;
    for (let tx = r.x0; tx <= r.x1; tx++) {
      for (let ty = Math.max(2, r.y0); ty < Math.min(shape.floorRow - 2, r.y1); ty += 1) {
        if (!solidAt(shape, tx, ty)) continue;
        for (const dir of [-1, 1]) {
          const ax = tx + dir;
          if (solidAt(shape, ax, ty) || tileOf(shape, ax, ty) !== 0) continue;
          // Mur continu sur 3 tuiles, torche toutes les 7 rangées, loin du jeu.
          if (!solidAt(shape, tx, ty - 1) || !solidAt(shape, tx, ty + 1)) continue;
          if ((ty + tx) % 7 !== 3 || nearGameplay(shape, ax, ty)) continue;
          const wx = dir > 0 ? (tx + 1) * T : tx * T - 1;
          const wy = ty * T + 8;
          // Applique de fer.
          b.hline(wx, wx + dir * 4, wy + 3, K.iron);
          b.px(wx + dir * 4, wy + 2, K.iron);
          b.rect(Math.min(wx + dir * 3, wx + dir * 6), wy - 1, 4, 3, K.iron);
          b.hline(Math.min(wx + dir * 3, wx + dir * 6), Math.max(wx + dir * 3, wx + dir * 6), wy - 1, K.ironHi);
          props.push({ kind: 'torch', x: wx + dir * 5, y: wy - 1, phase: hash2(tx, ty, 65) * 2, layer: 'back' });
        }
      }
    }
  }
}

// ------------------------------------------------------------------ arrivée : torii brûlé

function paintGoal(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  const g = goalArt(shape);
  if (!g) return;
  const cx = g.x + g.w / 2;
  // Voile de lumière pâle : la zone d'arrivée entière se lit de loin, plus dense au pied du torii.
  lightVeil(b, g.x, g.y, g.w, g.h, K.veil, (x, y) => {
    const u = 1 - Math.abs(x - cx) / (g.w / 2);
    const v = (y - g.y) / g.h;
    return Math.max(0, 0.08 + 0.32 * u * (0.25 + 0.75 * v));
  });
  let floorY = g.y + g.h;
  for (let ty = Math.floor(floorY / T); ty < shape.h; ty++) {
    if (solidAt(shape, Math.floor(cx / T), ty)) {
      floorY = ty * T;
      break;
    }
  }
  const left = Math.round(g.x - 4);
  const right = Math.round(g.x + g.w - 1);
  const top = floorY - 86;
  // Contre-jour : un halo pâle derrière le linteau détache le torii noir, on le voit de loin.
  const hx = Math.round(cx);
  const hy = top + 12;
  for (let y = hy - 40; y < Math.min(floorY, hy + 40); y++) {
    for (let x = hx - 52; x < hx + 52; x++) {
      const d = Math.hypot((x - hx) / 1.3, y - hy) / 40;
      if (d >= 1) continue;
      const k = (1 - d) ** 1.8 * 0.5;
      if (dith(x, y, 0, 1, k) === 1 && !solidAt(shape, Math.floor(x / T), Math.floor(y / T))) b.px(x, y, K.veil);
    }
  }
  // Hashira calcinés, fendus de braise.
  for (const x of [left, right]) {
    b.rect(x, top + 10, 5, floorY - top - 10, K.torii);
    b.rect(x, top + 10, 1, floorY - top - 10, K.toriiHi);
    for (let y = top + 14; y < floorY - 4; y++) {
      const k = hash2(x, Math.floor(y / 6), 91);
      if (k > 0.55 && (y + Math.floor(k * 9)) % 6 < 3) b.px(x + 2 + (k > 0.8 ? 1 : 0), y, (y & 3) === 0 ? K.toriiCrackHi : K.toriiCrack);
    }
    b.rect(x - 1, floorY - 5, 7, 5, K.stoneDk);
    b.hline(x - 1, x + 5, floorY - 5, K.stone);
  }
  // Kasagi aux bouts relevés, shimaki, nuki, gakuzuka doré.
  b.rect(left - 10, top + 1, right - left + 25, 4, K.torii);
  b.hline(left - 10, right + 14, top + 1, K.toriiHi);
  b.rect(left - 13, top - 1, 4, 3, K.torii);
  b.rect(right + 14, top - 1, 4, 3, K.torii);
  b.px(left - 13, top - 2, K.toriiHi);
  b.px(right + 17, top - 2, K.toriiHi);
  b.rect(left - 6, top + 5, right - left + 17, 4, K.toriiHi);
  b.hline(left - 6, right + 10, top + 8, K.torii);
  b.rect(left - 3, top + 17, right - left + 11, 3, K.torii);
  b.hline(left - 3, right + 7, top + 17, K.toriiHi);
  b.rect(Math.round(cx) - 4, top + 8, 8, 9, K.torii);
  b.rect(Math.round(cx) - 3, top + 9, 6, 7, K.gold);
  b.rect(Math.round(cx) - 2, top + 10, 4, 5, K.torii);
  // Le torii brûle encore : liseré de braise sur ses arêtes hautes et gauches (relevé, puis posé).
  const wood = (c: Color): boolean => c === K.torii || c === K.toriiHi || c === K.gold || c === K.toriiCrack || c === K.toriiCrackHi;
  const rim: number[] = [];
  for (let y = top - 3; y < floorY - 5; y++) {
    for (let x = left - 14; x < right + 19; x++) {
      const c = b.get(x, y);
      if (c !== K.torii && c !== K.toriiHi) continue;
      if ((!wood(b.get(x, y - 1)) || !wood(b.get(x - 1, y))) && hash2(x, y, 94) > 0.18) rim.push(x, y);
    }
  }
  for (let i = 0; i < rim.length; i += 2) b.px(rim[i], rim[i + 1], hash2(rim[i], rim[i + 1], 95) > 0.75 ? K.toriiCrackHi : K.toriiCrack);
  // Shimenawa roussie et ses shide de papier.
  b.stroke(left + 3, top + 23, right + 2, top + 23, 2, K.hemp);
  for (let x = left + 7; x < right; x += 7) {
    b.px(x, top + 25, K.paper);
    b.px(x + 1, top + 26, K.paper);
    b.px(x, top + 27, K.paper);
    b.px(x + 1, top + 28, K.paper);
  }
  for (const [fx, ph] of [[left - 6, 0.2], [Math.round(cx), 0.9], [right + 10, 1.6]] as const) {
    props.push({ kind: 'toriifire', x: fx, y: top + 1, phase: ph, layer: 'back' });
  }
  // Deux braseros montent la garde.
  for (const [x, ph] of [[left - 16, 0.4], [right + 20, 1.3]] as const) {
    brazier(b, x, floorY);
    props.push({ kind: 'brazier', x, y: floorY - 16, phase: ph, layer: 'back' });
  }
}

// ------------------------------------------------------------------ fosses : lueur animée

function paintPitLights(shape: LevelShape, props: PropInstance[]): void {
  for (const run of shape.spikes) {
    const X0 = run.x0 * T;
    const X1 = (run.x1 + 1) * T;
    for (let x = X0 + 10; x < X1 - 4; x += 22) {
      props.push({ kind: 'lavaglow', x, y: run.y * T + 6, phase: hash2(x, run.y, 93) * 3, layer: 'back' });
    }
  }
}

export function paintForge(shape: LevelShape, out: LevelCanvases): PropInstance[] {
  const props: PropInstance[] = [];
  paintCave(shape, out.back, props);
  paintCaveFloor(shape, out.back, props);
  paintSupports(shape, out.back);
  paintGarlands(shape, out.back, props);
  paintDeck(shape, out.back, props);
  paintWallTorches(shape, out.back, props);
  paintGoal(shape, out.back, props);
  paintPitLights(shape, props);
  paintSolids(shape, out.tiles);
  paintSpikes(shape, out.hazards);
  return props;
}

// ------------------------------------------------------------------ accessoires animés

/** Flammes de la planche (colonnes qui ondulent), à la phase `ph` au lieu du temps. */
export function flames(buf: Buf, x: number, y: number, ph: number, s: number, glowR: number, glow = 0.3): void {
  for (let k = -3; k <= 3; k++) {
    const hgt = Math.round((4 + (fsin(ph + k * 1.7) * 0.5 + 0.5) * 7 - Math.abs(k)) * s);
    for (let j = 0; j < hgt; j++) buf.px(x + k, y - j, K.fire[Math.min(3, Math.floor((j / Math.max(1, hgt)) * 4))]);
  }
  if (glowR > 0) buf.glowA(x, y - 3, glowR, K.fire[2], glow);
}

/**
 * Frames d'une flamme sur une période complète (sin(t * 9) de la planche). Le halo est centré
 * 3 px au-dessus du pied de la flamme : la frame fait 2R+1 de côté, le pied est en (R, R + 3).
 */
export function flameFrames(n: number, s: number, glowR: number, glow = 0.3, sparks = 0): Buf[] {
  const out: Buf[] = [];
  const size = glowR * 2 + 1;
  for (let k = 0; k < n; k++) {
    const f = new Buf(size, size);
    flames(f, glowR, glowR + 3, (k / n) * TAU, s, glowR, glow);
    // Étincelles qui s'échappent de la flamme et montent en s'éteignant.
    for (let i = 0; i < sparks; i++) {
      const q = (k / n + i / sparks) % 1;
      if (q > 0.85) continue;
      const sx = glowR + Math.round(Math.sin(i * 2.1 + q * 4) * (2 + q * 3));
      const sy = glowR + 3 - Math.round(6 * s + q * (glowR - 2));
      f.px(sx, sy, q < 0.35 ? K.ember[0] : q < 0.6 ? K.ember[1] : K.ember[2]);
    }
    out.push(f);
  }
  return out;
}

/** Cloche de temple qui se balance au bout de sa corde (planche : ±0,25 rad, 1,6 rad/s). */
function bellFrame(f: Buf, px: number, py: number, a: number): void {
  const bx = px + Math.sin(a) * 18;
  const by = py + Math.cos(a) * 18;
  f.line(px, py, bx, by, WOOD.knot);
  f.poly([bx - 5, by, bx + 5, by, bx + 8, by + 14, bx - 8, by + 14], K.bronze);
  f.rect(bx - 2, by - 2, 4, 2, K.bronzeDk);
  f.stroke(bx - 3, by + 2, bx - 5, by + 12, 1, K.bronzeHi);
  for (let k = -1; k <= 1; k++) f.px(bx + k * 3, by + 5, K.bronzeDk);
  f.hline(bx - 8, bx + 8, by + 14, K.bronzeDk);
  f.hline(bx - 7, bx + 7, by + 11, K.bronzeDk);
}

/** Panier de feu en fer suspendu à une chaîne, qui se balance. */
function basketFrame(f: Buf, ax: number, ay: number, swing: number, ph: number): void {
  const lx = Math.round(ax + swing);
  const ly = ay + 9;
  f.glowA(lx, ly - 1, 12, K.fire[2], 0.34);
  f.line(ax, ay, lx, ly - 2, K.chainDk);
  f.px(lx - 3, ly - 1, K.chain);
  f.px(lx + 3, ly - 1, K.chain);
  // Flammes au-dessus du panier.
  for (let k = -2; k <= 2; k++) {
    const hgt = Math.round(3 + (fsin(ph + k * 1.9) * 0.5 + 0.5) * 4 - Math.abs(k) * 0.8);
    for (let j = 0; j < hgt; j++) f.px(lx + k, ly - j, K.fire[Math.min(3, Math.floor((j / Math.max(1, hgt)) * 4))]);
  }
  // Corbeille de fer (barreaux) et braises dedans.
  f.hline(lx - 4, lx + 4, ly + 1, K.iron);
  for (let k = -3; k <= 3; k += 2) f.rect(lx + k, ly + 1, 1, 4, K.iron);
  f.hline(lx - 3, lx + 3, ly + 5, K.iron);
  f.px(lx, ly + 6, K.iron);
  f.hline(lx - 2, lx + 2, ly + 2, K.ember[1]);
  f.px(lx - 1, ly + 3, K.ember[2]);
  f.px(lx + 1, ly + 3, K.ember[0]);
}

/** Chaîne qui pend d'une clef de voûte et se balance à peine (angle `a`), crochet ou cage au bout. */
function hangingFrame(f: Buf, px: number, py: number, len: number, a: number, cage: boolean): void {
  for (let i = 0; i < len; i++) chainLink(f, Math.round(px + Math.sin(a) * i), Math.round(py + Math.cos(a) * i), i);
  const cx = Math.round(px + Math.sin(a) * len);
  const cy = Math.round(py + Math.cos(a) * len);
  if (!cage) {
    f.px(cx, cy, K.iron);
    f.px(cx + 1, cy + 1, K.iron);
    f.px(cx + 1, cy + 2, K.ironHi);
    f.px(cx - 1, cy + 1, K.iron);
    return;
  }
  f.hline(cx - 2, cx + 2, cy, K.iron);
  f.hline(cx - 4, cx + 4, cy + 1, K.iron);
  for (let y = cy + 2; y < cy + 15; y++) {
    for (let x = cx - 5; x <= cx + 5; x += 2) f.px(x, y, x === cx - 5 ? K.chain : K.iron);
  }
  f.hline(cx - 5, cx + 5, cy + 8, K.chainDk);
  f.hline(cx - 5, cx + 5, cy + 15, K.iron);
  f.hline(cx - 4, cx + 4, cy + 16, K.chainDk);
  // Ce qu'il reste du prisonnier.
  f.px(cx - 1, cy + 13, K.boneDk);
  f.px(cx, cy + 13, K.bone);
  f.px(cx + 1, cy + 14, K.boneDk);
  f.px(cx, cy + 12, K.bone);
}

export function forgeProps(): Record<string, PropAnim> {
  const FL = 12;
  const flameFps = FL / (TAU / 9);
  const brazierFrames = flameFrames(FL * 2, 1.2, 16, 0.3, 3);
  const torchFrames = flameFrames(FL, 0.8, 11, 0.32);
  const toriiFrames = flameFrames(FL, 0.9, 10, 0.25, 2);
  const smallFrames = flameFrames(FL, 0.55, 8, 0.22);

  // Nobori du chemin de ronde : toile un ton plus sourde que celle des lointains (le perso passe
  // devant), mon rouge sombre du clan.
  const noboriFrames: Buf[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(11, 52);
    banner(f, 1, 3, 26, ((k / 16) * TAU) / 5, K.clothDeck, K.clothDeckMark, WOOD.post);
    noboriFrames.push(f);
  }

  const bellFrames: Buf[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(48, 40);
    bellFrame(f, 24, 2, fsin((k / 16) * TAU) * 0.25);
    bellFrames.push(f);
  }

  const basketFramesL: Buf[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(34, 25);
    basketFrame(f, 17, 4, fsin((k / 16) * TAU) * 2, (k / 16) * TAU * 3);
    basketFramesL.push(f);
  }

  const toroFrames: Buf[] = [];
  for (let k = 0; k < 6; k++) {
    const f = new Buf(25, 25);
    f.glowA(12, 12, 12, K.fire[2], 0.28 + (k % 3) * 0.04);
    f.rect(11, 11, 3, 2, K.fire[1]);
    if (k % 2) f.px(12, 10, K.fire[0]);
    toroFrames.push(f);
  }

  const lavaGlow: Buf[] = [];
  for (let k = 0; k < 8; k++) {
    const f = new Buf(49, 49);
    f.glowA(24, 24, 24, K.flow[3], 0.14 + 0.08 * (0.5 + 0.5 * Math.sin((k / 8) * TAU)));
    lavaGlow.push(f);
  }

  const coals: Buf[] = [];
  for (let k = 0; k < 8; k++) {
    const f = new Buf(21, 16);
    f.glowA(10, 9, 8, K.fire[3], 0.22 + 0.06 * Math.sin((k / 8) * TAU));
    for (let i = 0; i < 6; i++) {
      const on = hash2(i, k, 86) > 0.45;
      f.px(10 + Math.round((hash2(i, 0, 87) - 0.5) * 9), 10 - Math.round(hash2(i, 1, 87) * 1.5), on ? K.ember[i % 2] : K.ember[2]);
    }
    coals.push(f);
  }

  // Chaînes et cages du cachot : pendules lents (4,6 s), 16 frames.
  const hanging: Record<string, PropAnim> = {};
  for (const len of HOOK_LENS) {
    const frames: Buf[] = [];
    for (let k = 0; k < 16; k++) {
      const f = new Buf(25, len + 5);
      hangingFrame(f, 12, 0, len, Math.sin((k / 16) * TAU) * 0.07, false);
      frames.push(f);
    }
    hanging[`hook${len}`] = { frames, fps: 16 / 4.6, ax: 12, ay: 0 };
  }
  const cageFrames: Buf[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(25, CAGE_LEN + 19);
    hangingFrame(f, 12, 0, CAGE_LEN, Math.sin((k / 16) * TAU) * 0.09, true);
    cageFrames.push(f);
  }
  hanging.cage = { frames: cageFrames, fps: 16 / 5.2, ax: 12, ay: 0 };

  return {
    ...hanging,
    brazier: { frames: brazierFrames, fps: flameFps * 2, ax: 16, ay: 19 },
    smallfire: { frames: smallFrames, fps: flameFps * 1.2, ax: 8, ay: 11 },
    torch: { frames: torchFrames, fps: flameFps * 1.1, ax: 11, ay: 14 },
    toriifire: { frames: toriiFrames, fps: flameFps * 0.9, ax: 10, ay: 13 },
    nobori: { frames: noboriFrames, fps: 12.7, ax: 1, ay: 49 },
    bell: { frames: bellFrames, fps: 16 / (TAU / 1.6), ax: 24, ay: 2 },
    basket: { frames: basketFramesL, fps: 16 / 3.7, ax: 17, ay: 4 },
    toro: { frames: toroFrames, fps: 7, ax: 12, ay: 12 },
    lavaglow: { frames: lavaGlow, fps: 3, ax: 24, ay: 24 },
    coals: { frames: coals, fps: 5, ax: 10, ay: 11 },
  };
}
