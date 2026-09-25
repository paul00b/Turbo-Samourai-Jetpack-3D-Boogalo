/**
 * Ashigaru des planches (drawEnemy de design/planches/hero.js), pré-calculé en une planche de
 * sprites : 16 phases de marche et 2 d'attente, 5 positions du yari, deux sens. Même dessin que
 * les planches, pixel pour pixel, mais une seule fois au chargement au lieu d'à chaque frame.
 */
import { Buf, compile, stamp } from '../pixel/engine';
import { ENEMY_BLADE, ENEMY_FOOT, ENEMY_LEG, ENEMY_PAL, ENEMY_ROWS, ENEMY_SHAFT, OUTLINE } from './palette';

export const ENEMY_FW = 40;
export const ENEMY_FH = 44;
/** Décalage du coin haut-gauche d'une frame par rapport aux pieds, centrés (px d'art). */
export const ENEMY_FOOT_X = 19;
export const ENEMY_FOOT_Y = 31;

export const WALK_PHASES = 16;
export const SWAY_STEPS = 5;

export interface EnemySheet {
  atlas: Buf;
  cols: number;
  /** Index de frame -> (colonne, rangée) dans l'atlas. */
  frame(walking: boolean, phase: number, sway: number, flip: boolean): number;
  count: number;
}

const SPR = compile(ENEMY_ROWS, ENEMY_PAL);

function drawFrame(o: Buf, walking: boolean, phase: number, sway: number, flip: boolean): void {
  o.clear();
  const bob = walking ? (Math.sin(phase) > 0 ? 1 : 0) : phase > 0.5 ? 1 : 0;
  stamp(o, SPR, 12, 10 + bob, flip);
  const st = walking ? Math.sin(phase) * 2.2 : 0;
  o.stroke(18, 24 + bob, 18 + st, 30, 2, ENEMY_LEG);
  o.stroke(21, 24 + bob, 21 - st, 30, 2, ENEMY_LEG);
  o.rect(17 + st, 30, 3, 1, ENEMY_FOOT);
  o.rect(20 - st, 30, 3, 1, ENEMY_FOOT);
  const hx = flip ? 14 : 24;
  o.line(hx, 22 + bob, hx + sway, 2 + bob, ENEMY_SHAFT);
  o.poly([hx + sway - 1, 3 + bob, hx + sway + 1, 3 + bob, hx + sway, bob - 1], ENEMY_BLADE);
}

export function buildEnemySheet(): EnemySheet {
  const walkFrames = WALK_PHASES * SWAY_STEPS * 2;
  const idleFrames = 2 * SWAY_STEPS * 2;
  const count = walkFrames + idleFrames;
  const cols = 16;
  const rows = Math.ceil(count / cols);
  const atlas = new Buf(cols * ENEMY_FW, rows * ENEMY_FH);
  const tmp = new Buf(ENEMY_FW, ENEMY_FH);
  const cell = new Buf(ENEMY_FW, ENEMY_FH);
  const index = (walking: boolean, p: number, s: number, flip: boolean): number =>
    walking ? ((p * SWAY_STEPS + s) * 2 + (flip ? 1 : 0)) : walkFrames + ((p * SWAY_STEPS + s) * 2 + (flip ? 1 : 0));
  const put = (i: number): void => {
    const cx = (i % cols) * ENEMY_FW;
    const cy = Math.floor(i / cols) * ENEMY_FH;
    atlas.blit(cell, cx, cy);
  };
  for (let s = 0; s < SWAY_STEPS; s++) {
    const sway = -1.2 + (2.4 * s) / (SWAY_STEPS - 1);
    for (const flip of [false, true]) {
      for (let p = 0; p < WALK_PHASES; p++) {
        drawFrame(tmp, true, (p / WALK_PHASES) * Math.PI * 2, sway, flip);
        cell.clear();
        cell.outlineBlit(tmp, 0, 0, OUTLINE, true);
        put(index(true, p, s, flip));
      }
      for (let p = 0; p < 2; p++) {
        drawFrame(tmp, false, p, sway, flip);
        cell.clear();
        cell.outlineBlit(tmp, 0, 0, OUTLINE, true);
        put(index(false, p, s, flip));
      }
    }
  }
  return {
    atlas,
    cols,
    count,
    frame(walking, phase, sway, flip) {
      const s = Math.max(0, Math.min(SWAY_STEPS - 1, Math.round(((sway + 1.2) / 2.4) * (SWAY_STEPS - 1))));
      if (walking) {
        const p = ((Math.floor((phase / (Math.PI * 2)) * WALK_PHASES) % WALK_PHASES) + WALK_PHASES) % WALK_PHASES;
        return index(true, p, s, flip);
      }
      return index(false, phase > 0.5 ? 1 : 0, s, flip);
    },
  };
}
