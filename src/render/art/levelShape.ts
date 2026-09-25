/**
 * Lecture d'une carte pour l'habiller : régions de tuiles, faces exposées, sol principal, cave,
 * blocs flottants, pics, arrivée. Pur (aucune dépendance au rendu), donc testable sous Node.
 *
 * Les planches sont des scènes composées à la main ; le jeu, lui, a 7 cartes en tuiles. Chaque
 * thème peint donc à partir de cette analyse, avec la grammaire commune :
 * arête claire = accrochable (#), reflets obliques froids = lisse (=), pointe rouge = mortel (^).
 */
import { T_AIR, T_SLICK, T_SOLID, T_SPIKE, TILE_SIZE, type Level } from '../../sim';

/** Taille d'une tuile en pixels d'art (1 px d'art = 2 px monde). */
export const ART_TILE = 16;
export const ART_SCALE = TILE_SIZE / ART_TILE;

export type RegionKind = 'frame' | 'float' | 'pillar' | 'slab' | 'block';

export interface Region {
  id: number;
  /** T_SOLID (accrochable) ou T_SLICK (lisse). */
  type: number;
  kind: RegionKind;
  /** Boîte englobante en tuiles, bornes incluses. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
}

/** Suite horizontale de tuiles dont une face donne sur le vide (dessus ou dessous). */
export interface Run {
  x0: number;
  x1: number;
  y: number;
  type: number;
  region: number;
}

export interface LevelShape {
  level: Level;
  /** Largeur / hauteur en tuiles. */
  w: number;
  h: number;
  /** Largeur / hauteur en px d'art. */
  pw: number;
  ph: number;
  /** Première rangée du sol principal (celle sous le spawn). */
  floorRow: number;
  spawnTx: number;
  spawnTy: number;
  regions: Region[];
  /** Tuile -> index de région (-1 pour le vide et les pics). */
  regionOf: Int32Array;
  /** Dessus exposés (on peut s'y poser, y poser un accessoire). */
  tops: Run[];
  /** Dessous exposés (on s'y accroche, on y suspend lanternes et lianes). */
  bottoms: Run[];
  /** Suites de pics, par rangée. */
  spikes: Run[];
  /** Tuiles d'ennemis (colonne, rangée) pour éviter d'y poser des accessoires. */
  enemyTiles: { tx: number; ty: number }[];
}

export function tileOf(shape: LevelShape, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= shape.w || ty >= shape.h) return T_SOLID;
  return shape.level.tiles[ty * shape.w + tx];
}

export function isSolid(t: number): boolean {
  return t === T_SOLID || t === T_SLICK;
}

/** Plein (accrochable ou lisse) ; le hors-carte compte comme plein. */
export function solidAt(shape: LevelShape, tx: number, ty: number): boolean {
  return isSolid(tileOf(shape, tx, ty));
}

/** Vide au sens du décor : ni plein, ni pic (l'arrivée est du vide). */
export function airAt(shape: LevelShape, tx: number, ty: number): boolean {
  const t = tileOf(shape, tx, ty);
  return t === T_AIR;
}

/** Vrai si la tuile est dans la cave (sous le sol principal) et vide. */
export function inCave(shape: LevelShape, tx: number, ty: number): boolean {
  return ty > shape.floorRow + 1 && !solidAt(shape, tx, ty);
}

export function analyzeLevel(level: Level): LevelShape {
  const w = level.width;
  const h = level.height;
  const tiles = level.tiles;
  const regionOf = new Int32Array(w * h).fill(-1);
  // Sol principal d'abord : ses tronçons (séparés par les trous) sont du sol, pas des dalles.
  const spawnTx = Math.floor(level.spawnX / TILE_SIZE);
  const spawnTy = Math.floor(level.spawnY / TILE_SIZE);
  let floorRow = spawnTy + 1;
  while (floorRow < h - 1 && !isSolid(tiles[floorRow * w + spawnTx])) floorRow++;
  const regions: Region[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const t = tiles[i];
    if (!isSolid(t) || regionOf[i] >= 0) continue;
    const id = regions.length;
    const r: Region = { id, type: t, kind: 'block', x0: w, y0: h, x1: -1, y1: -1, count: 0 };
    let touchesBorder = false;
    stack.length = 0;
    stack.push(i);
    regionOf[i] = id;
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % w;
      const y = (j - x) / w;
      r.count++;
      if (x < r.x0) r.x0 = x;
      if (x > r.x1) r.x1 = x;
      if (y < r.y0) r.y0 = y;
      if (y > r.y1) r.y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1];
      for (const k of nb) {
        if (k < 0 || regionOf[k] >= 0 || tiles[k] !== t) continue;
        regionOf[k] = id;
        stack.push(k);
      }
    }
    const rw = r.x1 - r.x0 + 1;
    const rh = r.y1 - r.y0 + 1;
    const onFloor = r.y0 <= floorRow + 1 && r.y1 >= floorRow && rw >= 3;
    if (touchesBorder || onFloor) r.kind = 'frame';
    else if (rh >= 3 && rw <= 3) r.kind = 'pillar';
    else if (rh <= 2 && rw <= 8) r.kind = 'float';
    else if (rh <= 2) r.kind = 'slab';
    else r.kind = 'block';
    regions.push(r);
  }

  const shapeBase = { level, w, h, pw: w * ART_TILE, ph: h * ART_TILE };
  const tAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? T_SOLID : tiles[y * w + x]);

  const tops: Run[] = [];
  const bottoms: Run[] = [];
  const spikes: Run[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const t = tAt(x, y);
      if (isSolid(t) && !isSolid(tAt(x, y - 1)) && tAt(x, y - 1) !== T_SPIKE) {
        let x1 = x;
        while (x1 + 1 < w && tAt(x1 + 1, y) === t && !isSolid(tAt(x1 + 1, y - 1)) && tAt(x1 + 1, y - 1) !== T_SPIKE) x1++;
        tops.push({ x0: x, x1, y, type: t, region: regionOf[y * w + x] });
        x = x1 + 1;
        continue;
      }
      x++;
    }
    x = 0;
    while (x < w) {
      const t = tAt(x, y);
      if (isSolid(t) && !isSolid(tAt(x, y + 1))) {
        let x1 = x;
        while (x1 + 1 < w && tAt(x1 + 1, y) === t && !isSolid(tAt(x1 + 1, y + 1))) x1++;
        bottoms.push({ x0: x, x1, y, type: t, region: regionOf[y * w + x] });
        x = x1 + 1;
        continue;
      }
      x++;
    }
    x = 0;
    while (x < w) {
      if (tAt(x, y) === T_SPIKE) {
        let x1 = x;
        while (x1 + 1 < w && tAt(x1 + 1, y) === T_SPIKE) x1++;
        spikes.push({ x0: x, x1, y, type: T_SPIKE, region: -1 });
        x = x1 + 1;
        continue;
      }
      x++;
    }
  }

  const enemyTiles = level.enemies.map((e) => ({ tx: Math.floor(e.x / TILE_SIZE), ty: Math.floor(e.y / TILE_SIZE) }));
  return { ...shapeBase, floorRow, spawnTx, spawnTy, regions, regionOf, tops, bottoms, spikes, enemyTiles };
}

/** Région de la tuile (ou null). */
export function regionAt(shape: LevelShape, tx: number, ty: number): Region | null {
  if (tx < 0 || ty < 0 || tx >= shape.w || ty >= shape.h) return null;
  const id = shape.regionOf[ty * shape.w + tx];
  return id >= 0 ? shape.regions[id] : null;
}

/** Faces exposées d'une tuile pleine : bits 1 = haut, 2 = bas, 4 = gauche, 8 = droite. */
export function exposedFaces(shape: LevelShape, tx: number, ty: number): number {
  let m = 0;
  if (!solidAt(shape, tx, ty - 1)) m |= 1;
  if (!solidAt(shape, tx, ty + 1)) m |= 2;
  if (!solidAt(shape, tx - 1, ty)) m |= 4;
  if (!solidAt(shape, tx + 1, ty)) m |= 8;
  return m;
}

/** Le spawn, les ennemis et l'arrivée gardent un peu d'air : pas d'accessoire dessus. */
export function nearGameplay(shape: LevelShape, tx: number, ty: number, radius = 2): boolean {
  if (Math.abs(tx - shape.spawnTx) <= radius + 1 && Math.abs(ty - shape.spawnTy) <= radius) return true;
  for (const e of shape.enemyTiles) if (Math.abs(tx - e.tx) <= radius && Math.abs(ty - e.ty) <= radius) return true;
  const g = shape.level.goal;
  if (g) {
    const gx0 = Math.floor(g.x / TILE_SIZE) - 1;
    const gx1 = Math.floor((g.x + g.w) / TILE_SIZE) + 1;
    if (tx >= gx0 && tx <= gx1) return true;
  }
  return false;
}
