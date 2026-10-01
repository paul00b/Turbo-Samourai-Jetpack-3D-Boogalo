/**
 * Grille éditable : les caractères du format de carte (voir src/sim/level.ts) et les panneaux de
 * texte posés dessus, plus les outils purs (rectangle, ligne, remplissage, redimensionnement,
 * gabarits) et l'historique annuler/refaire. Aucune dépendance au DOM : testé sous Node.
 */
import type { LevelSign } from '../sim';

/** Un caractère de tuile : # = ^ T . S e p F */
export type TileChar = string;

export interface Cell {
  x: number;
  y: number;
  c: TileChar;
}

export class EditGrid {
  readonly cells: string[];
  /** Panneaux de texte (coin haut-gauche en tuiles) : suivent l'historique comme les tuiles. */
  signs: LevelSign[] = [];

  constructor(
    readonly w: number,
    readonly h: number,
    fill: TileChar = '.',
  ) {
    this.cells = new Array<string>(w * h).fill(fill);
  }

  static fromRows(rows: readonly string[], signs: readonly LevelSign[] = []): EditGrid {
    const h = rows.length;
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const g = new EditGrid(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.cells[y * w + x] = rows[y][x] ?? '.';
    g.signs = cloneSigns(signs);
    return g;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): TileChar {
    return this.inside(x, y) ? this.cells[y * this.w + x] : '#';
  }

  /** Écrit une tuile (hors grille : ignoré). Renvoie vrai si quelque chose a changé. */
  set(x: number, y: number, c: TileChar): boolean {
    if (!this.inside(x, y)) return false;
    const i = y * this.w + x;
    if (this.cells[i] === c) return false;
    this.cells[i] = c;
    return true;
  }

  clone(): EditGrid {
    const g = new EditGrid(this.w, this.h);
    for (let i = 0; i < this.cells.length; i++) g.cells[i] = this.cells[i];
    g.signs = cloneSigns(this.signs);
    return g;
  }

  rows(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) out.push(this.cells.slice(y * this.w, (y + 1) * this.w).join(''));
    return out;
  }

  /** Surface du sol (rangée H-2) : k = hauteur au-dessus d'elle. */
  get floorRow(): number {
    return this.h - 2;
  }

  kOf(y: number): number {
    return this.floorRow - y;
  }
}

/** Pose une tuile en respectant les tuiles uniques : un seul spawn par carte. */
export function paint(g: EditGrid, x: number, y: number, c: TileChar): boolean {
  if (!g.inside(x, y)) return false;
  if (c === 'S') {
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === 'S') g.cells[i] = '.';
  }
  return g.set(x, y, c);
}

/** Applique une liste d'écritures (presets, coller). */
export function applyCells(g: EditGrid, cells: readonly Cell[]): boolean {
  let changed = false;
  for (const k of cells) changed = paint(g, k.x, k.y, k.c) || changed;
  return changed;
}

export function rectCells(x0: number, y0: number, x1: number, y1: number, c: TileChar): Cell[] {
  const out: Cell[] = [];
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) out.push({ x, y, c });
  return out;
}

/** Segment de Bresenham, extrémités incluses. */
export function lineCells(x0: number, y0: number, x1: number, y1: number, c: TileChar): Cell[] {
  const out: Cell[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push({ x, y, c });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Remplissage 4-connexe de la zone de même tuile que (x, y). */
export function floodCells(g: EditGrid, x: number, y: number, c: TileChar): Cell[] {
  if (!g.inside(x, y)) return [];
  const from = g.get(x, y);
  if (from === c) return [];
  const seen = new Uint8Array(g.w * g.h);
  const out: Cell[] = [];
  const stack = [y * g.w + x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop() as number;
    const cx = i % g.w;
    const cy = (i - cx) / g.w;
    out.push({ x: cx, y: cy, c });
    const nb = [cx > 0 ? i - 1 : -1, cx < g.w - 1 ? i + 1 : -1, cy > 0 ? i - g.w : -1, cy < g.h - 1 ? i + g.w : -1];
    for (const j of nb) {
      if (j < 0 || seen[j] || g.cells[j] !== from) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return out;
}

/** Sol plat en bas : rangée H-2 = surface, H-1 = socle. */
export function floorCells(g: EditGrid, x0: number, x1: number, kind: FloorKind): Cell[] {
  const out: Cell[] = [];
  const F = g.floorRow;
  const B = g.h - 1;
  const top: Record<FloorKind, TileChar> = { ground: '#', spike: '^', void: '.', bounce: 'T' };
  for (let x = Math.max(1, x0); x <= Math.min(g.w - 2, x1); x++) {
    out.push({ x, y: F, c: top[kind] });
    out.push({ x, y: B, c: kind === 'void' ? '.' : '#' });
  }
  return out;
}

export type FloorKind = 'ground' | 'spike' | 'void' | 'bounce';

/** Bords pleins : haut, gauche, droite (le bas est le sol, géré à part). */
export function borderCells(g: EditGrid): Cell[] {
  const out: Cell[] = [];
  for (let x = 0; x < g.w; x++) out.push({ x, y: 0, c: '#' });
  for (let y = 0; y < g.h; y++) {
    out.push({ x: 0, y, c: '#' });
    out.push({ x: g.w - 1, y, c: '#' });
  }
  return out;
}

/**
 * Redimensionne en gardant le contenu calé en BAS À GAUCHE (le sol reste le sol), puis recrée les
 * bords et prolonge le sol sur les colonnes ajoutées.
 */
export function resized(g: EditGrid, w: number, h: number): EditGrid {
  const out = new EditGrid(w, h);
  const dy = h - g.h;
  for (let y = 0; y < g.h; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let x = 0; x < Math.min(g.w, w); x++) out.cells[ny * w + x] = g.cells[y * g.w + x];
  }
  // Colonnes ajoutées à droite : sol plein. L'ancien bord droit redevient du vide au-dessus du sol.
  if (w > g.w) {
    for (let y = 1; y < h - 2; y++) out.set(g.w - 1, y, '.');
    for (const c of floorCells(out, g.w - 1, w - 2, 'ground')) out.set(c.x, c.y, c.c);
  }
  // Rangées ajoutées en haut : vide.
  for (const c of borderCells(out)) out.set(c.x, c.y, c.c);
  // Les panneaux suivent le contenu (calé en bas à gauche) ; ceux qui sortent de la carte disparaissent.
  out.signs = cloneSigns(g.signs)
    .map((sg) => ({ ...sg, y: sg.y + dy }))
    .filter((sg) => out.inside(sg.x, sg.y));
  return out;
}

export function cloneSigns(signs: readonly LevelSign[]): LevelSign[] {
  return signs.map((sg) => ({ x: sg.x, y: sg.y, title: sg.title, lines: sg.lines.slice() }));
}

export type MapMode = 'kills' | 'race';

/** Gabarit d'une nouvelle carte, déjà jouable : bords, sol plat, spawn, crochets, arrivée ou ennemi. */
export function templateGrid(mode: MapMode, w = mode === 'race' ? 160 : 72, h = mode === 'race' ? 40 : 44): EditGrid {
  const g = new EditGrid(w, h);
  applyCells(g, borderCells(g));
  applyCells(g, floorCells(g, 1, w - 2, 'ground'));
  const F = g.floorRow;
  paint(g, 4, F - 1, 'S');
  // Premiers crochets à portée du spawn (k = 10, barre de 4 et tige de 2).
  for (const x of [8, 18]) {
    applyCells(g, rectCells(x, F - 10, x + 3, F - 10, '#'));
    applyCells(g, rectCells(x + 1, F - 12, x + 1, F - 11, '#'));
  }
  if (mode === 'race') {
    for (let y = 1; y < F; y++) for (let x = w - 9; x <= w - 6; x++) g.set(x, y, 'F');
  } else {
    const x0 = Math.floor(w / 2) - 4;
    applyCells(g, rectCells(x0, F - 14, x0 + 8, F - 13, '#'));
    paint(g, x0 + 4, F - 15, 'e');
  }
  return g;
}

/** Historique : instantanés des cellules (les cartes font au plus quelques dizaines de milliers de tuiles). */
export class History {
  private readonly undoStack: EditGrid[] = [];
  private readonly redoStack: EditGrid[] = [];

  constructor(private readonly limit = 200) {}

  /** À appeler AVANT une modification, avec l'état courant. */
  push(before: EditGrid): void {
    this.undoStack.push(before.clone());
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(current: EditGrid): EditGrid | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current.clone());
    return prev;
  }

  redo(current: EditGrid): EditGrid | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current.clone());
    return next;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/** Zone copiée : tuiles relatives au coin haut-gauche. */
export interface Clip {
  w: number;
  h: number;
  cells: TileChar[];
}

export function copyRect(g: EditGrid, x0: number, y0: number, x1: number, y1: number): Clip {
  const ax = Math.max(0, Math.min(x0, x1));
  const ay = Math.max(0, Math.min(y0, y1));
  const bx = Math.min(g.w - 1, Math.max(x0, x1));
  const by = Math.min(g.h - 1, Math.max(y0, y1));
  const clip: Clip = { w: bx - ax + 1, h: by - ay + 1, cells: [] };
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) clip.cells.push(g.get(x, y));
  return clip;
}

/** Écritures d'un collage en (x, y) = coin haut-gauche. */
export function clipCells(clip: Clip, x: number, y: number): Cell[] {
  const out: Cell[] = [];
  for (let j = 0; j < clip.h; j++) for (let i = 0; i < clip.w; i++) out.push({ x: x + i, y: y + j, c: clip.cells[j * clip.w + i] });
  return out;
}
