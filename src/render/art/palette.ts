/**
 * Couleurs partagées par tous les thèmes : le samouraï, l'ashigaru, les effets.
 *
 * Règle des planches : chaque joueur a UNE teinte réservée qui n'apparaît que sur lui (écharpe,
 * sangles des tongs, corde pendant le reel). J1 = cyan #4fd1ff (déjà sa couleur dans le proto).
 * J2 = rose néon #ff6ec7 : l'orange du proto se noyait dans la forteresse de braise et dans toutes
 * les lanternes, le rose n'existe dans aucun décor. `test/art.test.ts` vérifie qu'aucun thème ne
 * les reprend.
 */
import { C, type Color } from '../pixel/engine';

export interface HeroPalette {
  helm: Color;
  helmHi: Color;
  gold: Color;
  skin: Color;
  eye: Color;
  armor: Color;
  armorHi: Color;
  armorDk: Color;
  lace: Color;
  sleeve: Color;
  sleeveDk: Color;
  glove: Color;
  pack: Color;
  packHi: Color;
  nozzle: Color;
  hot: Color;
  obi: Color;
  hak: Color;
  hakDk: Color;
  sole: Color;
  strap: Color;
  saya: Color;
  tsA: Color;
  tsB: Color;
  scarf: Color;
  scarfHi: Color;
  scarfDk: Color;
  hemp: Color;
  metal: Color;
  white: Color;
}

const BASE = {
  helm: C('#3a4258'),
  helmHi: C('#8190b2'),
  gold: C('#f0bf55'),
  skin: C('#e8ac80'),
  eye: C('#0b0b12'),
  armor: C('#30447a'),
  armorHi: C('#7098e0'),
  armorDk: C('#222f55'),
  lace: C('#c2452f'),
  sleeve: C('#2a3a66'),
  sleeveDk: C('#1f2a4a'),
  glove: C('#1c2238'),
  pack: C('#7c8391'),
  packHi: C('#c9ced8'),
  nozzle: C('#34373f'),
  hot: C('#ff5a2a'),
  obi: C('#8a6136'),
  hak: C('#2d3b60'),
  hakDk: C('#1f2944'),
  sole: C('#dcc59a'),
  saya: C('#6a1f1f'),
  tsA: C('#e8e0cf'),
  tsB: C('#1a1a22'),
  hemp: C('#d9cfb4'),
  metal: C('#9aa3b2'),
  white: C('#ffffff'),
};

/** Teintes réservées, au format 0xRRGGBB (HUD, cordes, traînée) et au format moteur. */
export const PLAYER_HEX = [0x4fd1ff, 0xff6ec7] as const;

export const HERO_PALETTES: readonly HeroPalette[] = [
  { ...BASE, strap: C('#4fd1ff'), scarf: C('#4fd1ff'), scarfHi: C('#b4f0ff'), scarfDk: C('#2595c8') },
  { ...BASE, strap: C('#ff6ec7'), scarf: C('#ff6ec7'), scarfHi: C('#ffc4ea'), scarfDk: C('#c43d8f') },
];

/** Toutes les couleurs réservées aux joueurs (aucun décor ne doit les employer). */
export const RESERVED_COLORS: readonly Color[] = HERO_PALETTES.flatMap((p) => [p.scarf, p.scarfHi, p.scarfDk]);

export const OUTLINE = C('#06060b');
export const FLAME: readonly Color[] = [C('#fff7d6'), C('#ffd166'), C('#ff9a3c'), C('#e0502a')];
export const SMOKE: readonly Color[] = [C('#8a8f9c'), C('#5f6472'), C('#3d414c')];
export const SPARK: readonly Color[] = [C('#ffffff'), C('#ffe9a8'), C('#ffb347')];
export const EMBER: readonly Color[] = [C('#ffd166'), C('#ff9a3c'), C('#8a3a24')];
export const DULL: readonly Color[] = [C('#9aa3b2'), C('#5f6472'), C('#3d414c')];

/** Ashigaru (ennemi) : masque blanc, armure rouge, jingasa. */
export const ENEMY_ROWS: readonly string[] = [
  '.....rrrrr.....',
  '...rrRRRRRrr...',
  '.rrrrrrrrrrrrr.',
  '.....mmmmm.....',
  '.....mkmkm.....',
  '.....mmmmm.....',
  '.....mmrmm.....',
  '....ddddddd....',
  '...dDDdddDDd...',
  '..dd.ddddd.dd..',
  '..d..dDdDd..d..',
  '..s..ddddd..s..',
  '.....bbbbb.....',
  '.....ddddd.....',
];

export const ENEMY_PAL: Record<string, Color> = {
  r: C('#7e2622'),
  R: C('#b8453a'),
  m: C('#efe6d6'),
  k: C('#0b0b10'),
  d: C('#c74b4b'),
  D: C('#e88a78'),
  s: C('#e8ac80'),
  b: C('#3a1c1c'),
};

export const ENEMY_LEG = C('#3a1c1c');
export const ENEMY_FOOT = C('#0b0b10');
export const ENEMY_SHAFT = C('#6b4a33');
export const ENEMY_BLADE = C('#d8dde6');
/** Débris quand un ashigaru tombe : armure, masque, sang d'encre. */
export const ENEMY_BITS: readonly Color[] = [C('#efe6d6'), C('#e88a78'), C('#c74b4b'), C('#7e2622')];
