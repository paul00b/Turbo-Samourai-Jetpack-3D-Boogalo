/**
 * Panneaux du décor (le tutoriel) : un cartouche sombre bordé d'or, un titre en grand, des lignes
 * de texte, les touches en bleu. Peints une fois, à la cuisson de la carte, dans un calque posé
 * entre le décor arrière et les tuiles : derrière le joueur, devant le fond. Pur (Node).
 */
import type { LevelSign } from '../../sim';
import { C, type Buf } from '../pixel/engine';
import { drawText, FONT_LINE, textWidth } from '../pixel/font';
import { ART_TILE } from './levelShape';

const PANEL = C('#0a0d15');
const BORDER = C('#e0b35a');
const TITLE = C('#f0bf55');
const TEXT = C('#f1ece2');
const KEY = C('#4fd1ff');
const OUTLINE = C('#05070b');

const PAD = 5;
const TITLE_SCALE = 2;
const TITLE_GAP = 3;

export interface SignBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Le cadre du panneau en px d'art (pour le peindre, et pour vérifier qu'il ne mord pas les tuiles). */
export function signBox(sign: LevelSign): SignBox {
  const titleW = sign.title ? textWidth(sign.title, TITLE_SCALE) : 0;
  const bodyW = Math.max(0, ...sign.lines.map((l) => textWidth(l)));
  const titleH = sign.title ? FONT_LINE * TITLE_SCALE + TITLE_GAP : 0;
  return {
    x: sign.x * ART_TILE,
    y: sign.y * ART_TILE,
    w: Math.max(titleW, bodyW) + PAD * 2,
    h: titleH + sign.lines.length * FONT_LINE + PAD * 2 - 2,
  };
}

export function paintSigns(buf: Buf, signs: readonly LevelSign[]): void {
  for (const sign of signs) {
    const b = signBox(sign);
    // Cartouche : fond translucide, bord d'or, coins cassés.
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const edge = x === 0 || y === 0 || x === b.w - 1 || y === b.h - 1;
        const corner = (x === 0 || x === b.w - 1) && (y === 0 || y === b.h - 1);
        if (corner) continue;
        buf.mixA(b.x + x, b.y + y, edge ? BORDER : PANEL, edge ? 0.55 : 0.62);
      }
    }
    let y = b.y + PAD - 1;
    if (sign.title) {
      drawText(buf, b.x + PAD, y, sign.title, { color: TITLE, accent: KEY, outline: OUTLINE, scale: TITLE_SCALE });
      y += FONT_LINE * TITLE_SCALE + TITLE_GAP;
    }
    for (const line of sign.lines) {
      drawText(buf, b.x + PAD, y, line, { color: TEXT, accent: KEY, outline: OUTLINE });
      y += FONT_LINE;
    }
  }
}
