/**
 * Presets de l'éditeur : les briques des cartes officielles (lanternes, contrepoids, tours,
 * stalactites, slaloms, champs de tremplins…), posables d'un clic. Chaque preset calcule ses
 * écritures à partir du point visé ET de la carte (une tige monte jusqu'au plafond, une tour descend
 * jusqu'au sol, un tronçon de sol se pose toujours en bas). Pur : testé sous Node.
 */
import { floorCells, lineCells, rectCells, type Cell, type EditGrid, type FloorKind } from './grid';

export interface PresetParam {
  key: string;
  label: string;
  min: number;
  max: number;
  def: number;
}

export interface PresetChoice {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  def: string;
}

export type PresetValues = Record<string, number | string>;

export interface Preset {
  id: string;
  label: string;
  /** Une ligne : ce que ça fait et où viser. */
  hint: string;
  params: readonly PresetParam[];
  choices?: readonly PresetChoice[];
  /** Vrai si R (miroir) a un sens. */
  mirror: boolean;
  cells(g: EditGrid, x: number, y: number, v: PresetValues, mirrored: boolean): Cell[];
}

const num = (v: PresetValues, k: string): number => Number(v[k]);
const str = (v: PresetValues, k: string): string => String(v[k]);

/** Première rangée pleine au-dessus de (x, y), ou 0 (le bord du haut). */
function solidAbove(g: EditGrid, x: number, y: number): number {
  for (let yy = y - 1; yy > 0; yy--) if (isSolidChar(g.get(x, yy))) return yy;
  return 0;
}

/** Première rangée pleine sous (x, y), ou la surface du sol. */
function solidBelow(g: EditGrid, x: number, y: number): number {
  for (let yy = y + 1; yy < g.h; yy++) if (isSolidChar(g.get(x, yy))) return yy;
  return g.floorRow;
}

function isSolidChar(c: string): boolean {
  return c === '#' || c === '=' || c === 'T';
}

/** Miroir horizontal autour de la colonne visée. */
function mirrorCells(cells: Cell[], cx: number): Cell[] {
  return cells.map((k) => ({ x: 2 * cx - k.x, y: k.y, c: k.c }));
}

const floorKinds = [
  { value: 'ground', label: 'Sol' },
  { value: 'spike', label: 'Pics' },
  { value: 'void', label: 'Vide (gouffre)' },
  { value: 'bounce', label: 'Tremplins' },
] as const;

export const PRESETS: readonly Preset[] = [
  {
    id: 'lamp',
    label: 'Lanterne',
    hint: 'Barre accrochable avec sa tige. Vise la barre.',
    params: [
      { key: 'w', label: 'Largeur', min: 1, max: 9, def: 3 },
      { key: 'stem', label: 'Tige', min: 0, max: 6, def: 2 },
    ],
    mirror: false,
    cells(_g, x, y, v) {
      const w = num(v, 'w');
      const cx = x + (w >> 1);
      return [...rectCells(x, y, x + w - 1, y, '#'), ...(num(v, 'stem') > 0 ? rectCells(cx, y - num(v, 'stem'), cx, y - 1, '#') : [])];
    },
  },
  {
    id: 'weight',
    label: 'Contrepoids',
    hint: 'Bloc suspendu par une tige qui monte jusqu\'au plafond. Vise le bloc.',
    params: [
      { key: 'w', label: 'Largeur', min: 1, max: 9, def: 3 },
      { key: 'h', label: 'Épaisseur', min: 1, max: 3, def: 1 },
    ],
    mirror: false,
    cells(g, x, y, v) {
      const w = num(v, 'w');
      const cx = x + (w >> 1);
      const top = solidAbove(g, cx, y);
      return [...rectCells(x, y, x + w - 1, y + num(v, 'h') - 1, '#'), ...(top + 1 <= y - 1 ? rectCells(cx, top + 1, cx, y - 1, '#') : [])];
    },
  },
  {
    id: 'platform',
    label: 'Plateforme',
    hint: 'Dalle de 2 d\'épaisseur, dessus accrochable. Vise le coin haut-gauche.',
    params: [
      { key: 'w', label: 'Largeur', min: 2, max: 60, def: 8 },
      { key: 'h', label: 'Épaisseur', min: 1, max: 6, def: 2 },
    ],
    choices: [{ key: 'under', label: 'Dessous', options: [{ value: '#', label: 'Accrochable' }, { value: '=', label: 'Lisse' }], def: '#' }],
    mirror: true,
    cells(_g, x, y, v) {
      const w = num(v, 'w');
      const h = num(v, 'h');
      const out = rectCells(x, y, x + w - 1, y + h - 1, '#');
      if (str(v, 'under') === '=' && h > 1) out.push(...rectCells(x, y + h - 1, x + w - 1, y + h - 1, '='));
      return out;
    },
  },
  {
    id: 'balcony',
    label: 'Balcon mural',
    hint: 'Plateforme accrochée au mur le plus proche, jusqu\'au point visé, avec un merlon au bout.',
    params: [{ key: 'h', label: 'Épaisseur', min: 1, max: 4, def: 2 }],
    mirror: false,
    cells(g, x, y, v) {
      const left = x < g.w / 2;
      const x0 = left ? 1 : x;
      const x1 = left ? x : g.w - 2;
      const out = rectCells(x0, y, x1, y + num(v, 'h') - 1, '#');
      out.push({ x: left ? x1 : x0, y: y - 1, c: '#' });
      return out;
    },
  },
  {
    id: 'tower',
    label: 'Tour crénelée',
    hint: 'Colonne pleine du sol jusqu\'au point visé, créneaux dessus.',
    params: [{ key: 'w', label: 'Largeur', min: 2, max: 12, def: 6 }],
    choices: [{ key: 'face', label: 'Face gauche', options: [{ value: '#', label: 'Accrochable' }, { value: '=', label: 'Lisse' }], def: '#' }],
    mirror: true,
    cells(g, x, y, v) {
      const w = num(v, 'w');
      const bottom = solidBelow(g, x, y) - 1;
      const out = rectCells(x, y, x + w - 1, Math.max(y, bottom), '#');
      if (str(v, 'face') === '=') out.push(...rectCells(x, y + 1, x, Math.max(y, bottom), '='));
      for (let i = x; i < x + w; i += 2) out.push({ x: i, y: y - 1, c: '#' });
      return out;
    },
  },
  {
    id: 'stalactite',
    label: 'Stalactite',
    hint: 'Masse qui pend du plafond jusqu\'au point visé.',
    params: [{ key: 'w', label: 'Largeur', min: 1, max: 12, def: 4 }],
    choices: [{ key: 'side', label: 'Flancs', options: [{ value: '#', label: 'Accrochables' }, { value: '=', label: 'Lisses' }], def: '#' }],
    mirror: false,
    cells(g, x, y, v) {
      const w = num(v, 'w');
      const top = solidAbove(g, x, y) + 1;
      const out = rectCells(x, Math.min(top, y), x + w - 1, y, '#');
      if (str(v, 'side') === '=' && w > 2) {
        out.push(...rectCells(x, Math.min(top, y), x, y - 1, '='));
        out.push(...rectCells(x + w - 1, Math.min(top, y), x + w - 1, y - 1, '='));
      }
      return out;
    },
  },
  {
    id: 'stalagmite',
    label: 'Stalagmite',
    hint: 'Pilier qui monte du sol jusqu\'au point visé, sommet accrochable.',
    params: [{ key: 'w', label: 'Largeur', min: 1, max: 12, def: 3 }],
    choices: [{ key: 'side', label: 'Corps', options: [{ value: '#', label: 'Accrochable' }, { value: '=', label: 'Lisse' }], def: '=' }],
    mirror: false,
    cells(g, x, y, v) {
      const w = num(v, 'w');
      const bottom = Math.max(y, solidBelow(g, x, y) - 1);
      const out = rectCells(x, y, x + w - 1, bottom, str(v, 'side'));
      out.push(...rectCells(x, y, x + w - 1, y, '#'));
      return out;
    },
  },
  {
    id: 'slalom',
    label: 'Dents de slalom',
    hint: 'Stalactites et stalagmites alternées, un crochet au-dessus de chaque stalagmite. Vise le bas de la première stalactite.',
    params: [
      { key: 'n', label: 'Stalactites', min: 2, max: 8, def: 3 },
      { key: 'p', label: 'Période', min: 10, max: 24, def: 16 },
      { key: 'gap', label: 'Chevauchement', min: 0, max: 6, def: 2 },
    ],
    mirror: true,
    cells(g, x, y, v) {
      const n = num(v, 'n');
      const p = num(v, 'p');
      const out: Cell[] = [];
      const bottomTop = y - num(v, 'gap');
      for (let i = 0; i < n; i++) {
        const tx = x + i * p;
        out.push(...rectCells(tx, solidAbove(g, tx, y) + 1, tx + 3, y, '#'));
        if (i === n - 1) break;
        const bx = tx + (p >> 1) + 1;
        out.push(...rectCells(bx, bottomTop, bx + 2, g.floorRow - 1, '='));
        out.push(...rectCells(bx, bottomTop, bx + 2, bottomTop, '#'));
        const ly = Math.max(2, bottomTop - 8);
        out.push(...rectCells(bx, ly, bx + 2, ly, '#'), ...rectCells(bx + 1, ly - 2, bx + 1, ly - 1, '#'));
      }
      return out;
    },
  },
  {
    id: 'pads',
    label: 'Champ de tremplins',
    hint: 'Tremplins de 3 au sol, séparés par du sol, des pics ou du vide. Vise où ça commence.',
    params: [{ key: 'n', label: 'Tremplins', min: 1, max: 10, def: 3 }],
    choices: [{ key: 'gap', label: 'Entre deux', options: floorKinds.filter((k) => k.value !== 'bounce'), def: 'ground' }],
    mirror: true,
    cells(g, x, _y, v) {
      const out: Cell[] = [];
      for (let i = 0; i < num(v, 'n'); i++) {
        out.push(...floorCells(g, x + i * 6, x + i * 6 + 2, 'bounce'));
        if (i < num(v, 'n') - 1) out.push(...floorCells(g, x + i * 6 + 3, x + i * 6 + 5, str(v, 'gap') as FloorKind));
      }
      return out;
    },
  },
  {
    id: 'floor',
    label: 'Tronçon de sol',
    hint: 'Change le bas de la carte sur la largeur choisie : sol, pics, gouffre ou tremplins.',
    params: [{ key: 'w', label: 'Largeur', min: 1, max: 80, def: 6 }],
    choices: [{ key: 'kind', label: 'Nature', options: floorKinds, def: 'spike' }],
    mirror: true,
    cells(g, x, _y, v) {
      return floorCells(g, x, x + num(v, 'w') - 1, str(v, 'kind') as FloorKind);
    },
  },
  {
    id: 'enemy',
    label: 'Ennemi sur plateforme',
    hint: 'Une plateforme et son ennemi au milieu. Vise le coin haut-gauche de la plateforme.',
    params: [{ key: 'w', label: 'Largeur', min: 3, max: 20, def: 7 }],
    choices: [{ key: 'kind', label: 'Ennemi', options: [{ value: 'e', label: 'Statique' }, { value: 'p', label: 'Patrouille' }], def: 'p' }],
    mirror: true,
    cells(_g, x, y, v) {
      const w = num(v, 'w');
      return [...rectCells(x, y, x + w - 1, y + 1, '#'), { x: x + (w >> 1), y: y - 1, c: str(v, 'kind') }];
    },
  },
  {
    id: 'bridge',
    label: 'Pont à deux voies',
    hint: 'Long tablier crénelé : on passe dessous ou dessus. Vise le coin haut-gauche.',
    params: [{ key: 'w', label: 'Longueur', min: 10, max: 120, def: 40 }],
    mirror: true,
    cells(_g, x, y, v) {
      const w = num(v, 'w');
      const out = rectCells(x, y, x + w - 1, y + 2, '#');
      for (let i = x; i < x + w; i += 2) out.push({ x: i, y: y - 1, c: '#' });
      return out;
    },
  },
  {
    id: 'ramp',
    label: 'Rampe',
    hint: 'Escalier plein en diagonale, du point visé vers le bas-droite jusqu\'au sol.',
    params: [],
    mirror: true,
    cells(g, x, y) {
      const out: Cell[] = [];
      const bottom = g.floorRow - 1;
      for (const k of lineCells(x, y, x + (bottom - y), bottom, '#')) out.push(...rectCells(k.x, k.y, k.x, bottom, '#'));
      return out;
    },
  },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function defaultValues(p: Preset): PresetValues {
  const v: PresetValues = {};
  for (const q of p.params) v[q.key] = q.def;
  for (const c of p.choices ?? []) v[c.key] = c.def;
  return v;
}

/** Écritures finales d'un preset : miroir appliqué, hors grille retiré. */
export function presetCells(p: Preset, g: EditGrid, x: number, y: number, v: PresetValues, mirrored = false): Cell[] {
  let cells = p.cells(g, x, y, v, mirrored);
  if (mirrored && p.mirror) cells = mirrorCells(cells, x);
  return cells.filter((k) => g.inside(k.x, k.y));
}
