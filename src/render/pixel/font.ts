/**
 * Police pixel 5 × 7 (majuscules, chiffres, accents français, flèches, ponctuation), pour écrire
 * dans l'art cuit : les panneaux du tutoriel. Proportionnelle (un I est plus étroit qu'un M), avec
 * deux rangées au-dessus pour les accents et deux en dessous pour la cédille et la virgule.
 *
 * Pur (aucun Pixi, aucun DOM) : se teste sous Node. Le texte est passé en majuscules ; les
 * caractères inconnus deviennent un espace. Entre accolades, le texte est dans la couleur
 * d'accent (les touches : « MAINTIENS {ESPACE} »).
 */
import type { Buf, Color } from './engine';

/** Hauteur d'une ligne à l'échelle 1 : 2 rangées d'accent, 7 de lettre, 2 de descente. */
export const FONT_LINE = 11;
/** Rangée du haut des lettres dans la ligne (sous les accents). */
const CAP = 2;
const SPACE_W = 3;
const GAP = 1;

type Rows = readonly string[];

const G: Record<string, Rows> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '..#..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.#.#.', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '/': ['.....', '....#', '...#.', '..#..', '.#...', '#....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  '«': ['.....', '..#.#', '.#.#.', '#.#..', '.#.#.', '..#.#', '.....'],
  '»': ['.....', '#.#..', '.#.#.', '..#.#', '.#.#.', '#.#..', '.....'],
  '·': ['.....', '.....', '.....', '..#..', '.....', '.....', '.....'],
  '→': ['.....', '..#..', '...#.', '#####', '...#.', '..#..', '.....'],
  '←': ['.....', '..#..', '.#...', '#####', '.#...', '..#..', '.....'],
  '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '..#..'],
  '↓': ['..#..', '..#..', '..#..', '..#..', '#.#.#', '.###.', '..#..'],
  '♥': ['.....', '.#.#.', '#####', '#####', '.###.', '..#..', '.....'],
  // Boutons de manette PlayStation (libellés des touches).
  '✕': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  '○': ['.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....'],
  '□': ['.....', '#####', '#...#', '#...#', '#...#', '#####', '.....'],
  '△': ['.....', '..#..', '..#..', '.#.#.', '.#.#.', '#####', '.....'],
};

/** Accents (2 rangées au-dessus de la lettre) et cédille (2 rangées en dessous). */
const MARK: Record<string, Rows> = {
  acute: ['...#.', '..#..'],
  grave: ['.#...', '..#..'],
  circ: ['..#..', '.#.#.'],
  diaer: ['.....', '.#.#.'],
  cedilla: ['..#..', '.#...'],
};

const COMPOSED: Record<string, [string, keyof typeof MARK]> = {
  É: ['E', 'acute'],
  È: ['E', 'grave'],
  Ê: ['E', 'circ'],
  Ë: ['E', 'diaer'],
  À: ['A', 'grave'],
  Â: ['A', 'circ'],
  Ä: ['A', 'diaer'],
  Î: ['I', 'circ'],
  Ï: ['I', 'diaer'],
  Ô: ['O', 'circ'],
  Ö: ['O', 'diaer'],
  Û: ['U', 'circ'],
  Ù: ['U', 'grave'],
  Ü: ['U', 'diaer'],
  Ç: ['C', 'cedilla'],
};

interface Glyph {
  /** Pixels allumés, relatifs au coin haut-gauche de la ligne (accents compris). */
  px: readonly (readonly [number, number])[];
  w: number;
}

const cache = new Map<string, Glyph | null>();

function build(ch: string): Glyph | null {
  let base = ch;
  let mark: Rows | null = null;
  let below = false;
  const comp = COMPOSED[ch];
  if (comp) {
    base = comp[0];
    mark = MARK[comp[1]];
    below = comp[1] === 'cedilla';
  }
  const rows = G[base];
  if (!rows) return null;
  const px: [number, number][] = [];
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < 5; x++) if (rows[y][x] === '#') px.push([x, CAP + y]);
  if (mark) {
    const y0 = below ? CAP + 7 : 0;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 5; x++) if (mark[y][x] === '#') px.push([x, y0 + y]);
  }
  let min = 5;
  let max = -1;
  for (const [x] of px) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { px: px.map(([x, y]) => [x - min, y] as const), w: max - min + 1 };
}

function glyph(ch: string): Glyph | null {
  let g = cache.get(ch);
  if (g === undefined) {
    g = build(ch);
    cache.set(ch, g);
  }
  return g;
}

/** Le texte tel que la police l'écrit : majuscules, ’ -> ', Œ -> OE. */
export function normalizeText(text: string): string {
  return text.toUpperCase().replace(/[’`]/g, "'").replace(/Œ/g, 'OE').replace(/Æ/g, 'AE');
}

/** Vrai si la police sait écrire ce caractère (espace et accolades compris). */
export function hasGlyph(ch: string): boolean {
  return ch === ' ' || ch === '{' || ch === '}' || glyph(ch) !== null;
}

/** Largeur en px d'art d'une ligne (sans les accolades, qui ne s'écrivent pas). */
export function textWidth(text: string, scale = 1): number {
  let w = 0;
  let first = true;
  for (const ch of normalizeText(text)) {
    if (ch === '{' || ch === '}') continue;
    const cw = ch === ' ' ? SPACE_W : (glyph(ch)?.w ?? SPACE_W);
    w += (first ? 0 : GAP) + cw;
    first = false;
  }
  return w * scale;
}

export interface TextStyle {
  color: Color;
  /** Couleur du texte entre accolades. */
  accent?: Color;
  /** Contour sombre d'un pixel autour des lettres (lisible sur n'importe quel fond). */
  outline?: Color;
  scale?: number;
}

/** Écrit une ligne dans `buf`, coin haut-gauche de la ligne en (x, y). Rend la largeur écrite. */
export function drawText(buf: Buf, x: number, y: number, text: string, style: TextStyle): number {
  const s = Math.max(1, Math.round(style.scale ?? 1));
  const cells: { gx: number; g: Glyph; c: Color }[] = [];
  let cx = 0;
  let first = true;
  let accent = false;
  for (const ch of normalizeText(text)) {
    if (ch === '{') {
      accent = true;
      continue;
    }
    if (ch === '}') {
      accent = false;
      continue;
    }
    if (!first) cx += GAP;
    first = false;
    const g = ch === ' ' ? null : glyph(ch);
    if (g) cells.push({ gx: cx, g, c: accent && style.accent !== undefined ? style.accent : style.color });
    cx += g ? g.w : SPACE_W;
  }
  if (style.outline !== undefined) {
    const o = style.outline;
    for (const { gx, g } of cells) {
      for (const [px, py] of g.px) {
        const bx = x + (gx + px) * s;
        const by = y + py * s;
        for (let dy = -1; dy <= s; dy++) for (let dx = -1; dx <= s; dx++) buf.px(bx + dx, by + dy, o);
      }
    }
  }
  for (const { gx, g, c } of cells) {
    for (const [px, py] of g.px) buf.rect(x + (gx + px) * s, y + py * s, s, s, c);
  }
  return cx * s;
}
