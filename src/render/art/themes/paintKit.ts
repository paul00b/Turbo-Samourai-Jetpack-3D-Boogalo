/**
 * Outils de peinture partagés par les thèmes (purs, px d'art monde). Les motifs sont calculés en
 * coordonnées MONDE : un joint de pierre ou un reflet continue d'une tuile à l'autre.
 */
import { T_SLICK, T_SOLID, TILE_SIZE } from '../../../sim';
import { Buf, dith, fbm, hash2, type Color } from '../../pixel/engine';
import { ART_TILE, exposedFaces, nearGameplay, regionAt, solidAt, tileOf, type LevelShape, type Region } from '../levelShape';

export const FACE_TOP = 1;
export const FACE_BOTTOM = 2;
export const FACE_LEFT = 4;
export const FACE_RIGHT = 8;

export interface SolidTile {
  tx: number;
  ty: number;
  /** Coin haut-gauche en px d'art. */
  X: number;
  Y: number;
  type: number;
  region: Region;
  faces: number;
}

/** Parcourt toutes les tuiles pleines (accrochables et lisses). */
export function forEachSolid(shape: LevelShape, fn: (s: SolidTile) => void): void {
  for (let ty = 0; ty < shape.h; ty++) {
    for (let tx = 0; tx < shape.w; tx++) {
      const t = tileOf(shape, tx, ty);
      if (t !== T_SOLID && t !== T_SLICK) continue;
      const region = regionAt(shape, tx, ty);
      if (!region) continue;
      fn({ tx, ty, X: tx * ART_TILE, Y: ty * ART_TILE, type: t, region, faces: exposedFaces(shape, tx, ty) });
    }
  }
}

/** Écrit un pixel seulement s'il tombe dans la tuile pleine (tx, ty) : les motifs ne débordent pas. */
export function clipPx(buf: Buf, s: SolidTile, x: number, y: number, c: Color): void {
  if (x < s.X || y < s.Y || x >= s.X + ART_TILE || y >= s.Y + ART_TILE) return;
  buf.px(x, y, c);
}

export interface StonePalette {
  base: Color;
  dark: Color;
  light: Color;
  mortar: Color;
}

/**
 * Appareil de pierres (joints décalés d'une rangée sur l'autre) dans une tuile, en coordonnées
 * monde. `bw`/`bh` : taille des pierres. Chaque pierre a sa teinte (bruit), plus un grain fin.
 */
export function stoneTile(buf: Buf, s: SolidTile, P: StonePalette, bw = 16, bh = 8, seed = 11): void {
  for (let y = s.Y; y < s.Y + ART_TILE; y++) {
    const row = Math.floor(y / bh);
    const off = row & 1 ? bw >> 1 : 0;
    for (let x = s.X; x < s.X + ART_TILE; x++) {
      const col = Math.floor((x + off) / bw);
      const inRowX = (x + off) % bw;
      const inRowY = y % bh;
      let c: Color;
      if (inRowY === 0 || inRowX === 0) c = P.mortar;
      else {
        const tone = hash2(col, row, seed);
        const grain = fbm(x / 5, y / 4, seed + 3, 0, 2);
        c = tone > 0.72 ? P.light : tone < 0.22 ? P.dark : P.base;
        if (grain > 0.7) c = P.light;
        else if (grain < 0.28) c = P.dark;
        if (inRowY === 1 && hash2(x, y, seed + 5) > 0.5) c = P.light;
      }
      buf.px(x, y, c);
    }
  }
}

/** Grain de roche continu (fbm monde) dans une tuile. */
export function rockTile(buf: Buf, s: SolidTile, P: { rock: Color; dk: Color; lt: Color }, seed = 7): void {
  for (let y = s.Y; y < s.Y + ART_TILE; y++) {
    for (let x = s.X; x < s.X + ART_TILE; x++) {
      const n = fbm(x / 11, y / 7, seed);
      const crk = hash2(x, y, 9);
      buf.px(x, y, n > 0.62 ? P.lt : n < 0.38 ? P.dk : crk > 0.985 ? P.lt : P.rock);
    }
  }
}

export interface SlickPalette {
  base: Color;
  gloss: Color;
  top: Color;
  /** Arête des faces latérales et du dessous. */
  edge: Color;
}

/**
 * Surface lisse (=) des planches (KIT.slick) : reflets obliques froids réguliers, arête claire
 * froide en haut. Diagonales calculées en coordonnées monde : elles filent d'une tuile à l'autre.
 */
export function slickTile(buf: Buf, s: SolidTile, P: SlickPalette): void {
  buf.rect(s.X, s.Y, ART_TILE, ART_TILE, P.base);
  for (let y = s.Y; y < s.Y + ART_TILE; y++) {
    for (let x = s.X; x < s.X + ART_TILE; x++) {
      if ((x + y) % 7 === 0 && hash2(x, y, 3) > 0.3) buf.px(x, y, P.gloss);
    }
  }
  if (s.faces & FACE_TOP) buf.hline(s.X, s.X + ART_TILE - 1, s.Y, P.top);
  if (s.faces & FACE_BOTTOM) buf.hline(s.X, s.X + ART_TILE - 1, s.Y + ART_TILE - 1, P.edge);
  if (s.faces & FACE_LEFT) buf.rect(s.X, s.Y + (s.faces & FACE_TOP ? 1 : 0), 1, ART_TILE - (s.faces & FACE_TOP ? 1 : 0), P.edge);
  if (s.faces & FACE_RIGHT) buf.rect(s.X + ART_TILE - 1, s.Y + (s.faces & FACE_TOP ? 1 : 0), 1, ART_TILE - (s.faces & FACE_TOP ? 1 : 0), P.edge);
}

/** Régions pleines accrochables qui flottent (ancrages de 2 à 8 tuiles, dalles longues). */
export function floatingBlocks(shape: LevelShape, type = T_SOLID): Region[] {
  return shape.regions.filter((r) => r.type === type && (r.kind === 'float' || r.kind === 'slab'));
}

/** Paires de blocs voisins sur une même rangée (guirlandes, cordes tendues entre deux ancrages). */
export function rowPairs(blocks: readonly Region[], maxGap = 12): [Region, Region][] {
  const out: [Region, Region][] = [];
  const sorted = [...blocks].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    let best: Region | null = null;
    for (let j = 0; j < sorted.length; j++) {
      const b = sorted[j];
      if (b === a || b.y0 !== a.y0 || b.x0 <= a.x1) continue;
      const gap = b.x0 - a.x1 - 1;
      if (gap < 2 || gap > maxGap) continue;
      if (!best || b.x0 < best.x0) best = b;
    }
    if (best) out.push([a, best]);
  }
  return out;
}

/**
 * Corde qui monte d'un point et se perd dans le noir (tramage de plus en plus clairsemé).
 * S'arrête sur le premier plein rencontré (le plafond).
 */
export function risingRope(buf: Buf, shape: LevelShape, x: number, y: number, len: number, c: Color, fade: number, seed: number): void {
  for (let k = 0; k < len; k++) {
    const yy = y - k;
    if (yy < 0) break;
    if (solidAt(shape, Math.floor(x / ART_TILE), Math.floor(yy / ART_TILE))) break;
    const f = k < len - fade ? 1 : 1 - (k - (len - fade)) / fade;
    if (f < 1 && hash2(x, yy, seed) > f) continue;
    buf.px(x, yy, c);
  }
}

/** Colonnes (px d'art) où poser un accessoire sur les dessus accrochables à l'air libre. */
export function deckSpots(shape: LevelShape, spacing: number, seed: number, opts: { mainFloorOnly?: boolean; margin?: number } = {}): { x: number; y: number; run: number }[] {
  const out: { x: number; y: number; run: number }[] = [];
  const margin = opts.margin ?? 1;
  shape.tops.forEach((run, ri) => {
    if (run.type !== T_SOLID) return;
    if (opts.mainFloorOnly && run.y !== shape.floorRow) return;
    if (run.y > shape.floorRow) return; // la cave a son propre décor
    const len = run.x1 - run.x0 + 1;
    if (len < margin * 2 + 2) return;
    for (let tx = run.x0 + margin; tx <= run.x1 - margin; tx += spacing) {
      const jitter = Math.floor(hash2(tx, run.y, seed) * Math.max(1, spacing - 2));
      const x = tx + jitter;
      if (x > run.x1 - margin) break;
      if (nearGameplay(shape, x, run.y - 1)) continue;
      // Pas d'accessoire là où un ancrage bas pend juste au-dessus (on s'y balance).
      out.push({ x: x * ART_TILE + Math.floor(hash2(x, run.y, seed + 1) * 8) + 4, y: run.y * ART_TILE, run: ri });
    }
  });
  return out;
}

/** Vrai si la tuile (en px d'art) est dans l'air de la cave (sous le sol principal). */
export function isCaveAir(shape: LevelShape, tx: number, ty: number): boolean {
  if (ty < shape.floorRow) return false;
  return !solidAt(shape, tx, ty);
}

/** Rectangle de l'arrivée en px d'art (ou null). */
export function goalArt(shape: LevelShape): { x: number; y: number; w: number; h: number } | null {
  const g = shape.level.goal;
  if (!g) return null;
  const k = TILE_SIZE / ART_TILE;
  return { x: g.x / k, y: g.y / k, w: g.w / k, h: g.h / k };
}

/** Voile de lumière tramé (arrivée, puits de lumière) : densité qui décroît avec `falloff`. */
export function lightVeil(buf: Buf, x0: number, y0: number, w: number, h: number, c: Color, density: (x: number, y: number) => number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const d = density(x, y);
      if (d <= 0) continue;
      if (dith(x, y, 0, 1, d) === 1) buf.px(x, y, c);
    }
  }
}
