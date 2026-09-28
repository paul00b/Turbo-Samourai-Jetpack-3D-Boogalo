import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  DEFAULT_PARAMS,
  DIFFICULTY_NAMES,
  levelsIn,
  LEVEL_DEFS,
  LEVELS,
  LEVEL_INFOS,
  makeRayHit,
  raycastTiles,
  T_AIR,
  T_BOUNCE,
  T_SOLID,
  T_SPIKE,
  TILE_SIZE,
  isSolidTile,
  tileAt,
  validateRows,
  type Level,
} from '../src/sim';

/**
 * Fraction des positions DEBOUT SUR LE SOL (la rangée du spawn) depuis lesquelles un ancrage est
 * atteignable en visant droit en haut. Proxy pessimiste : en jeu on vise en diagonale.
 */
function groundAnchorCoverage(level: Level): number {
  const hit = makeRayHit();
  const ty = Math.floor(level.spawnY / TILE_SIZE);
  let tested = 0;
  let reachable = 0;
  for (let tx = 1; tx < level.width - 1; tx++) {
    if (tileAt(level, tx, ty) !== T_AIR || !isSolidTile(tileAt(level, tx, ty + 1))) continue; // trou ou mur
    tested++;
    const ox = tx * TILE_SIZE + TILE_SIZE / 2;
    const oy = ty * TILE_SIZE + TILE_SIZE / 2;
    raycastTiles(level, ox, oy, 0, -1, DEFAULT_PARAMS.hookMaxLength, hit);
    if (hit.hit && hit.tile === T_SOLID) reachable++;
  }
  return tested === 0 ? 0 : reachable / tested;
}

/** Surface du sol (rangée H-2). */
const floorRow = (level: Level): number => level.height - 2;

/** Part du sol qui tue (pics ou gouffre). */
function deadlyFloor(level: Level): number {
  let n = 0;
  for (let x = 1; x < level.width - 1; x++) {
    const t = tileAt(level, x, floorRow(level));
    if (t === T_SPIKE || t === T_AIR) n++;
  }
  return n / (level.width - 2);
}

const byMode = (mode: 'kills' | 'race'): Level[] => LEVELS.filter((l) => l.mode === mode);

describe('level design', () => {
  it('les ids publiés ne bougent pas : arcade 0-2, premières courses 3-5, puis les courses ajoutées', () => {
    expect(LEVELS).toHaveLength(12);
    expect(LEVEL_INFOS.map((i) => i.id)).toEqual(LEVEL_INFOS.map((_, k) => k));
    const firstSix = LEVEL_INFOS.slice(0, 6).map((i) => `${i.mode}:${i.biome}:${i.name}`);
    expect(firstSix).toEqual([
      'kills:port:Facile', 'kills:bamboo:Difficile', 'kills:forge:Horrible',
      'race:port:Facile', 'race:bamboo:Difficile', 'race:forge:Horrible',
    ]);
    for (const i of LEVEL_INFOS) expect(i.name).toBe(DIFFICULTY_NAMES[i.difficulty]);
  });

  it('chaque biome a une arène et ses trois courses, Facile, Difficile et Horrible', () => {
    expect(BIOMES.map((b) => b.id)).toEqual(['port', 'bamboo', 'forge']);
    for (const b of BIOMES) {
      expect(levelsIn('kills', b.id)).toHaveLength(1);
      expect(levelsIn('race', b.id).map((i) => i.difficulty)).toEqual([0, 1, 2]);
    }
  });

  it('seules les cartes course ont une arrivée, et elle est loin devant le spawn', () => {
    for (const level of LEVELS) {
      if (level.mode === 'kills') {
        expect(level.goal, `${level.name} ne devrait pas avoir d'arrivée`).toBeNull();
        continue;
      }
      const goal = level.goal;
      expect(goal, `${level.name} : arrivée manquante`).not.toBeNull();
      expect(goal!.x).toBeGreaterThan(level.spawnX + 200 * TILE_SIZE);
      expect(goal!.x + goal!.w).toBeLessThanOrEqual(level.width * TILE_SIZE);
      // L'arrivée barre toute la hauteur jouable : on la franchit par n'importe quelle voie.
      expect(goal!.h).toBeGreaterThan(level.height * TILE_SIZE * 0.6);
    }
  });

  it('les cartes course sont longues, mais pas des couloirs : plus verticales qu\'avant', () => {
    for (const level of byMode('race')) {
      expect(level.width / level.height).toBeGreaterThan(5);
      expect(level.height).toBeGreaterThanOrEqual(44);
    }
    for (const level of byMode('kills')) expect(level.height).toBeGreaterThanOrEqual(56);
  });

  it('la difficulté monte avec la part de sol mortel', () => {
    // Arcade : une arène par biome, de la plus facile à la plus dure.
    const [f, d, h] = byMode('kills').map(deadlyFloor);
    expect(f).toBeLessThan(0.12);
    expect(d).toBeGreaterThan(f);
    expect(h).toBeGreaterThan(d);
    expect(h).toBeGreaterThan(0.35);
    // Course : dans chaque biome, et au même palier d'un biome à l'autre.
    for (const b of BIOMES) {
      const [cf, cd, ch] = levelsIn('race', b.id).map((i) => deadlyFloor(LEVELS[i.id]));
      expect(cf, `${b.name} Facile`).toBeLessThan(0.12);
      expect(cd, `${b.name} Difficile`).toBeGreaterThan(Math.max(cf, 0.2));
      expect(cd, `${b.name} Difficile`).toBeLessThan(0.35);
      expect(ch, `${b.name} Horrible`).toBeGreaterThan(Math.max(cd, 0.35));
    }
  });

  for (const [id, level] of LEVELS.entries()) {
    describe(`${level.mode === 'race' ? 'Course' : 'Arcade'} ${LEVEL_INFOS[id].title}`, () => {
      it('respecte les règles de level design (celles que l\'éditeur affiche)', () => {
        // Bords pleins, bas plat (sol, pics, tremplins ou gouffre ouvert), pics et tremplins posés,
        // ennemis posés, spawn unique et au sol, ancrage à portée du spawn, arrivée en course.
        expect(validateRows(LEVEL_DEFS[id].rows, level.mode)).toEqual([]);
        // Sous la carte, c'est le vide (et pas un mur invisible).
        expect(tileAt(level, 5, level.height)).toBe(T_AIR);
        if (level.name === 'Horrible') {
          let gaps = 0;
          for (let x = 1; x < level.width - 1; x++) if (tileAt(level, x, floorRow(level)) === T_AIR) gaps++;
          expect(gaps).toBeGreaterThan(10);
        }
      });

      it('le spawn est debout sur le sol, loin des pics et des gouffres', () => {
        const tx = Math.floor(level.spawnX / TILE_SIZE);
        const ty = Math.floor(level.spawnY / TILE_SIZE);
        expect(ty).toBe(floorRow(level) - 1);
        expect(tileAt(level, tx, ty)).toBe(T_AIR);
        expect(tileAt(level, tx, ty + 1)).toBe(T_SOLID);
        for (let y = ty - 8; y <= ty + 1; y++) {
          for (let x = tx - 3; x <= tx + 3; x++) {
            expect(tileAt(level, x, y)).not.toBe(T_SPIKE);
            if (y === ty + 1 && x > 0 && x < level.width - 1) expect(tileAt(level, x, y), `sol en ${x}`).toBe(T_SOLID);
          }
        }
      });

      it('debout au sol, on trouve un ancrage au-dessus de soi (grappin court)', () => {
        // Rampe de difficulté, mesurée en visant droit en haut depuis le sol.
        const min: Record<string, number> = { Facile: 0.4, Difficile: 0.25, Horrible: 0.1 };
        expect(groundAnchorCoverage(level)).toBeGreaterThan(min[level.name]);
      });

      it('les tremplins ont de la place : 6 tuiles d\'air au-dessus', () => {
        for (let y = 0; y < level.height; y++) {
          for (let x = 0; x < level.width; x++) {
            if (tileAt(level, x, y) !== T_BOUNCE) continue;
            for (let k = 1; k <= 6; k++) expect(tileAt(level, x, y - k), `air au-dessus du tremplin (${x}, ${y})`).toBe(T_AIR);
          }
        }
      });

      if (level.mode === 'kills') {
        it('assez d\'ennemis pour une arène', () => {
          expect(level.enemies.length).toBeGreaterThanOrEqual(6);
        });
      }
    });
  }
});
