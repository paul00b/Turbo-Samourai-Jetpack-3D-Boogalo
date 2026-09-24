import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  LEVELS,
  LEVEL_INFOS,
  makeRayHit,
  raycastTiles,
  T_SOLID,
  T_SPIKE,
  TILE_SIZE,
  isSolidTile,
  tileAt,
  type Level,
} from '../src/sim';

/**
 * Fraction des positions DEBOUT SUR LE SOL PRINCIPAL (la rangée du spawn) depuis lesquelles un
 * ancrage est atteignable en visant droit en haut. Proxy pessimiste : en jeu on vise en diagonale.
 */
function groundAnchorCoverage(level: Level): number {
  const hit = makeRayHit();
  const ty = Math.floor(level.spawnY / TILE_SIZE);
  let tested = 0;
  let reachable = 0;
  for (let tx = 1; tx < level.width - 1; tx++) {
    if (tileAt(level, tx, ty) !== 0 || !isSolidTile(tileAt(level, tx, ty + 1))) continue; // trou ou mur
    tested++;
    const ox = tx * TILE_SIZE + TILE_SIZE / 2;
    const oy = ty * TILE_SIZE + TILE_SIZE / 2;
    raycastTiles(level, ox, oy, 0, -1, DEFAULT_PARAMS.hookMaxLength, hit);
    if (hit.hit && hit.tile === T_SOLID) reachable++;
  }
  return tested === 0 ? 0 : reachable / tested;
}

describe('level design', () => {
  it('les deux familles sont déclarées dans l\'ordre : éliminations puis chronos', () => {
    expect(LEVELS).toHaveLength(7);
    expect(LEVEL_INFOS.map((i) => i.name)).toEqual([
      'Facile', 'Normale', 'Difficile', 'Horrible', 'Sprint', 'Autoroute', 'Gouffre',
    ]);
    expect(LEVEL_INFOS.map((i) => i.mode)).toEqual([
      'kills', 'kills', 'kills', 'kills', 'race', 'race', 'race',
    ]);
    expect(LEVEL_INFOS.map((i) => i.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('seules les cartes chrono ont une arrivée, et elle est loin devant le spawn', () => {
    for (const level of LEVELS) {
      if (level.mode === 'kills') {
        expect(level.goal, `${level.name} ne devrait pas avoir d'arrivée`).toBeNull();
        continue;
      }
      const goal = level.goal;
      expect(goal, `${level.name} : arrivée manquante`).not.toBeNull();
      // L'arrivée est à droite, et la course fait au moins 200 tuiles.
      expect(goal!.x).toBeGreaterThan(level.spawnX + 200 * TILE_SIZE);
      expect(goal!.x + goal!.w).toBeLessThanOrEqual(level.width * TILE_SIZE);
      expect(goal!.h).toBeGreaterThan(4 * TILE_SIZE); // franchissable sans viser au pixel
    }
  });

  it('les cartes chrono sont nettement plus longues que hautes', () => {
    for (const level of LEVELS) {
      if (level.mode !== 'race') continue;
      expect(level.width / level.height).toBeGreaterThan(8);
    }
  });

  for (const level of LEVELS) {
    describe(level.name, () => {
      it('lignes de largeur constante, bords pleins', () => {
        expect(level.tiles).toHaveLength(level.width * level.height);
        for (let x = 0; x < level.width; x++) expect(isSolidTile(tileAt(level, x, level.height - 1))).toBe(true);
        for (let y = 0; y < level.height; y++) {
          expect(isSolidTile(tileAt(level, 0, y))).toBe(true);
          expect(isSolidTile(tileAt(level, level.width - 1, y))).toBe(true);
        }
      });

      it('le spawn est au sol, dans le vide, loin des pics', () => {
        const tx = Math.floor(level.spawnX / TILE_SIZE);
        const ty = Math.floor(level.spawnY / TILE_SIZE);
        expect(tileAt(level, tx, ty)).toBe(0);
        expect(isSolidTile(tileAt(level, tx, ty + 1))).toBe(true);
        // Aucun pic à moins de 8 tuiles : on ne meurt pas en posant le pied par terre.
        for (let y = ty - 8; y <= ty + 8; y++) {
          for (let x = tx - 8; x <= tx + 8; x++) expect(tileAt(level, x, y)).not.toBe(T_SPIKE);
        }
      });

      it('debout au sol, on trouve un ancrage au-dessus de soi (grappin court)', () => {
        // Rampe de difficulté, mesurée en visant droit en haut depuis le sol principal.
        const min: Record<string, number> = {
          Facile: 0.45, Normale: 0.35, Difficile: 0.2, Horrible: 0.15,
          Sprint: 0.25, Autoroute: 0.18, Gouffre: 0.08,
        };
        expect(min[level.name], `seuil manquant pour ${level.name}`).toBeDefined();
        expect(groundAnchorCoverage(level)).toBeGreaterThan(min[level.name]);
      });

      it('les pics restent au fond, jamais sur la ligne de jeu', () => {
        const spikes: number[] = [];
        for (let y = 0; y < level.height; y++) {
          for (let x = 0; x < level.width; x++) if (tileAt(level, x, y) === T_SPIKE) spikes.push(y);
        }
        if (spikes.length === 0) return; // Facile : zéro pic
        const spawnRow = Math.floor(level.spawnY / TILE_SIZE);
        // Tous les pics sont au moins 5 tuiles sous le sol principal (le niveau du spawn).
        expect(Math.min(...spikes)).toBeGreaterThan(spawnRow + 5);
      });
    });
  }
});
