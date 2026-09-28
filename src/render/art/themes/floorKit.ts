/**
 * Ce que tous les thèmes peignent pareil, parce que c'est du gameplay avant d'être du décor :
 *
 *  - les TREMPLINS (T) : un plateau vert vif monté sur ressorts, des chevrons qui montent. Le vert
 *    n'appartient à aucun décor ni à aucun joueur : « ça propulse » se lit de loin, dans les trois
 *    ambiances. Peints dans la couche de jeu, strictement dans leurs tuiles.
 *  - les GOUFFRES (colonnes ouvertes en bas de carte) : un abîme qui noircit vers le bord, peint
 *    DEVANT les acteurs (on voit le perso s'y enfoncer), plus une brume froide qui monte du fond.
 *
 * Pur (px d'art monde), testable sous Node.
 */
import { Buf, C, hash2, type Color } from '../../pixel/engine';
import { ART_TILE, type LevelShape } from '../levelShape';

const T = ART_TILE;

export const PAD = {
  plateHi: C('#e4ff8c'),
  plate: C('#9fe04a'),
  plateDk: C('#5c8f26'),
  chevron: C('#b8f25a'),
  spring: C('#aab3c2'),
  springDk: C('#5d6572'),
  case: C('#2b303b'),
  caseHi: C('#434a58'),
  caseDk: C('#171a21'),
  rivet: C('#7c8594'),
} as const;

const ABYSS: Color = C('#040409');
const MIST: Color = C('#3b4660');

/** Tremplins : boîtier sombre, ressorts, plateau vert, chevrons. Chaque pixel reste dans sa tuile T. */
export function paintPads(shape: LevelShape, tiles: Buf): void {
  for (const run of shape.pads) {
    const X0 = run.x0 * T;
    const X1 = (run.x1 + 1) * T - 1;
    const Y = run.y * T;
    // Boîtier (rangées 7..15) : arête haute claire, flanc sombre, rivets.
    for (let y = Y + 7; y < Y + T; y++) {
      for (let x = X0; x <= X1; x++) {
        let c: Color = PAD.case;
        if (y === Y + 7) c = PAD.caseHi;
        else if (y === Y + T - 1 || x === X0 || x === X1) c = PAD.caseDk;
        tiles.px(x, y, c);
      }
    }
    for (let x = X0 + 3; x <= X1 - 2; x += 8) tiles.px(x, Y + T - 3, PAD.rivet);
    // Chevrons qui montent, un par tuile, au centre du boîtier.
    for (let tx = run.x0; tx <= run.x1; tx++) {
      const cx = tx * T + 7;
      for (let k = 0; k < 2; k++) {
        const yy = Y + 9 + k * 3;
        for (let i = 0; i <= 3; i++) {
          tiles.px(cx - i, yy + i, PAD.chevron);
          tiles.px(cx + 1 + i, yy + i, PAD.chevron);
        }
      }
    }
    // Ressorts (rangées 4..6) : zigzags métalliques, le fond reste vide (on voit à travers).
    for (let x = X0 + 2; x <= X1 - 2; x += 5) {
      tiles.px(x, Y + 4, PAD.spring);
      tiles.px(x + 1, Y + 5, PAD.springDk);
      tiles.px(x, Y + 6, PAD.spring);
      tiles.px(x + 2, Y + 4, PAD.springDk);
      tiles.px(x + 2, Y + 6, PAD.springDk);
    }
    // Plateau (rangées 0..3), un pixel en retrait aux deux bouts.
    for (let x = X0 + 1; x <= X1 - 1; x++) {
      tiles.px(x, Y, PAD.plateHi);
      tiles.px(x, Y + 1, PAD.plate);
      tiles.px(x, Y + 2, hash2(x, run.y, 5) > 0.85 ? PAD.plateHi : PAD.plate);
      tiles.px(x, Y + 3, PAD.plateDk);
    }
  }
}

/**
 * Gouffres : de la surface du sol jusqu'au bord de la carte, le noir monte (couche avant), avec
 * quelques volutes de brume. Le bas de la carte est le bord de l'écran : on disparaît dedans.
 */
export function paintAbyss(shape: LevelShape, front: () => Buf): void {
  if (shape.pits.length === 0) return;
  const b = front();
  const yTop = (shape.h - 2) * T - 6;
  const yBot = shape.h * T;
  for (const run of shape.pits) {
    const X0 = run.x0 * T;
    const X1 = (run.x1 + 1) * T - 1;
    for (let y = yTop; y < yBot; y++) {
      const v = (y - yTop) / (yBot - yTop);
      for (let x = X0; x <= X1; x++) {
        // Bords du gouffre un peu moins noirs : la paroi se devine.
        const edge = Math.min(x - X0, X1 - x);
        const a = Math.min(0.96, v * v * 1.15 + (edge < 3 ? -0.08 : 0));
        if (a <= 0.02) continue;
        b.mixA(x, y, ABYSS, a);
      }
    }
    // Brume froide, tramée, dans la moitié haute du gouffre.
    for (let x = X0 + 2; x <= X1 - 2; x++) {
      const hgt = 3 + Math.floor(hash2(x >> 2, run.x0, 31) * 6);
      for (let k = 0; k < hgt; k++) {
        const y = yTop + 14 + k;
        if (hash2(x, y, 32) > 0.72) b.mixA(x, y, MIST, 0.35 * (1 - k / hgt));
      }
    }
  }
}
