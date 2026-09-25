/**
 * Direction artistique : les règles des planches (design/planches/index.html, « Ce qui garde le
 * perso lisible ») vérifiées sur les 7 cartes et pour chaque thème. Tout ce qui est testé ici est
 * pur (aucun Pixi) : moteur pixel, analyse de carte, peintres, pantin, planche de l'ashigaru.
 */
import { describe, expect, it, vi } from 'vitest';

// Cuisson de cartes jusqu'à 6720 px d'art de large : on laisse le temps aux tests lourds.
vi.setConfig({ testTimeout: 30000 });
import { LEVELS, T_SLICK, T_SOLID, T_SPIKE, TILE_SIZE } from '../src/sim';
import { Buf, C, ca, cb, cr, luma, Particles } from '../src/render/pixel/engine';
import { analyzeLevel, ART_TILE, exposedFaces, type LevelShape } from '../src/render/art/levelShape';
import { LEVEL_THEMES, PAINTERS, THEME_IDS, themeIdFor } from '../src/render/art/themes/painters';
import type { LevelCanvases, ThemePainter } from '../src/render/art/themes/types';
import { ENEMY_PAL, HERO_PALETTES, OUTLINE, RESERVED_COLORS } from '../src/render/art/palette';
import { HERO_BUF, HeroPuppet, HOOK_VIEW_ATTACHED, makeHeroInput } from '../src/render/art/hero';
import { buildEnemySheet } from '../src/render/art/enemySheet';

const RESERVED = new Set<number>(RESERVED_COLORS.map((c) => c & 0xffffff));

interface Painted {
  shape: LevelShape;
  canvases: { back: Buf; tiles: Buf; hazards: Buf; front: Buf | null };
  props: ReturnType<ThemePainter['paint']>;
}

const cache = new Map<string, Painted>();

function paint(painter: ThemePainter, levelId: number): Painted {
  const key = `${painter.id}:${levelId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const shape = analyzeLevel(LEVELS[levelId]);
  let front: Buf | null = null;
  const canvases: LevelCanvases = {
    back: new Buf(shape.pw, shape.ph),
    tiles: new Buf(shape.pw, shape.ph),
    hazards: new Buf(shape.pw, shape.ph),
    front: () => (front ??= new Buf(shape.pw, shape.ph)),
  };
  const props = painter.paint(shape, canvases);
  const out: Painted = { shape, canvases: { back: canvases.back, tiles: canvases.tiles, hazards: canvases.hazards, front }, props };
  cache.set(key, out);
  return out;
}

function tileAtPx(shape: LevelShape, x: number, y: number): number {
  return shape.level.tiles[Math.floor(y / ART_TILE) * shape.w + Math.floor(x / ART_TILE)];
}

/** Thèmes distincts (les thèmes provisoires qui reprennent un autre peintre ne sont testés qu'une fois). */
const PAINTER_LIST: ThemePainter[] = THEME_IDS.map((id) => PAINTERS[id]).filter((p, i, all) => all.findIndex((q) => q.paint === p.paint) === i);

describe('moteur pixel', () => {
  it('les couleurs sont en ABGR little-endian (uploadables telles quelles en RGBA)', () => {
    const b = new Buf(1, 1);
    b.px(0, 0, C('#4fd1ff'));
    expect([...new Uint8Array(b.d.buffer)]).toEqual([0x4f, 0xd1, 0xff, 0xff]);
  });

  it('mixA pose un alpha partiel sur un calque vide et mélange sur un pixel plein', () => {
    const b = new Buf(2, 1);
    b.mixA(0, 0, C('#ffffff'), 0.45);
    expect(ca(b.d[0])).toBe(Math.round(0.45 * 255));
    b.px(1, 0, C('#000000'));
    b.mixA(1, 0, C('#ffffff'), 0.5);
    expect(ca(b.d[1])).toBe(255);
    expect(cr(b.d[1])).toBeGreaterThan(120);
    expect(cr(b.d[1])).toBeLessThan(135);
  });

  it('outlineBlit en mode calque : contour plein puis second contour à 45 %', () => {
    const src = new Buf(9, 9);
    src.px(4, 4, C('#ffffff'));
    const dst = new Buf(9, 9);
    dst.outlineBlit(src, 0, 0, OUTLINE, true);
    expect(dst.d[4 * 9 + 5]).toBe(OUTLINE);
    expect(ca(dst.d[4 * 9 + 6])).toBe(Math.round(0.45 * 255));
    expect(dst.d[0]).toBe(0);
  });

  it('les particules vieillissent le long de leur palette puis disparaissent', () => {
    const p = new Particles();
    p.spawn(0, 0, 10, 0, 1, [C('#ffffff'), C('#000000')]);
    expect(Particles.colorOf(p.list[0])).toBe(C('#ffffff'));
    p.update(0.6);
    expect(Particles.colorOf(p.list[0])).toBe(C('#000000'));
    p.update(0.5);
    expect(p.list).toHaveLength(0);
  });
});

describe('attribution des thèmes', () => {
  it('chaque carte a un thème connu, et le réglage manuel l\'emporte', () => {
    expect(LEVEL_THEMES).toHaveLength(LEVELS.length);
    for (let i = 0; i < LEVELS.length; i++) {
      expect(THEME_IDS).toContain(LEVEL_THEMES[i]);
      expect(themeIdFor('auto', i)).toBe(LEVEL_THEMES[i]);
      expect(themeIdFor('bamboo', i)).toBe('bamboo');
    }
    // Les trois niveaux des planches sont joués.
    for (const id of THEME_IDS) expect(LEVEL_THEMES).toContain(id);
  });

  it('aucun thème ne reprend une teinte réservée aux joueurs (rim, halo, poussière)', () => {
    for (const p of Object.values(PAINTERS)) {
      for (const c of [p.rim, p.halo ?? 0, ...p.dust]) expect(RESERVED.has(c & 0xffffff), `${p.id} ${c.toString(16)}`).toBe(false);
    }
  });
});

describe('analyse des cartes', () => {
  for (const level of LEVELS) {
    it(`${level.name} : sol principal sous le spawn, régions complètes, tronçons du sol classés en sol`, () => {
      const shape = analyzeLevel(level);
      expect(shape.floorRow).toBe(Math.floor(level.spawnY / TILE_SIZE) + 1);
      let solids = 0;
      for (let i = 0; i < level.tiles.length; i++) {
        const t = level.tiles[i];
        if (t !== T_SOLID && t !== T_SLICK) {
          expect(shape.regionOf[i]).toBe(-1);
          continue;
        }
        solids++;
        const r = shape.regions[shape.regionOf[i]];
        expect(r.type).toBe(t);
      }
      expect(shape.regions.reduce((n, r) => n + r.count, 0)).toBe(solids);
      for (const r of shape.regions) {
        if (r.y0 <= shape.floorRow + 1 && r.y1 >= shape.floorRow && r.x1 - r.x0 >= 2) expect(r.kind, `${level.name} région ${r.id}`).toBe('frame');
      }
      const spikes = level.tiles.reduce((n, t) => n + (t === T_SPIKE ? 1 : 0), 0);
      expect(shape.spikes.reduce((n, s) => n + s.x1 - s.x0 + 1, 0)).toBe(spikes);
    });
  }
});

for (const painter of PAINTER_LIST) {
  describe(`thème ${painter.name}`, () => {
    for (const [id, level] of LEVELS.entries()) {
      describe(level.name, () => {
        it('la couche de jeu colle aux collisions : rien hors des tuiles pleines, chaque tuile pleine est peinte', () => {
          const { shape, canvases } = paint(painter, id);
          const tiles = canvases.tiles;
          let outside = 0;
          for (let y = 0; y < tiles.h; y++) {
            for (let x = 0; x < tiles.w; x++) {
              if (tiles.d[y * tiles.w + x] === 0) continue;
              const t = tileAtPx(shape, x, y);
              if (t !== T_SOLID && t !== T_SLICK) outside++;
            }
          }
          expect(outside, 'pixels de tuiles hors des tuiles pleines').toBe(0);
          for (let ty = 0; ty < shape.h; ty++) {
            for (let tx = 0; tx < shape.w; tx++) {
              const t = shape.level.tiles[ty * shape.w + tx];
              if (t !== T_SOLID && t !== T_SLICK) continue;
              let filled = 0;
              for (let y = ty * ART_TILE; y < (ty + 1) * ART_TILE; y++) {
                for (let x = tx * ART_TILE; x < (tx + 1) * ART_TILE; x++) if (ca(tiles.d[y * tiles.w + x]) === 255) filled++;
              }
              expect(filled, `tuile (${tx},${ty}) peu peinte`).toBeGreaterThan(ART_TILE * ART_TILE * 0.9);
            }
          }
        });

        it('les dangers restent dans leurs tuiles, pointes rouges visibles', () => {
          const { shape, canvases } = paint(painter, id);
          const hz = canvases.hazards;
          let outside = 0;
          let red = 0;
          for (let y = 0; y < hz.h; y++) {
            for (let x = 0; x < hz.w; x++) {
              const c = hz.d[y * hz.w + x];
              if (c === 0) continue;
              if (tileAtPx(shape, x, y) !== T_SPIKE) outside++;
              if (cr(c) > 180 && cr(c) - Math.max(cb(c), (c >>> 8) & 255) > 90) red++;
            }
          }
          expect(outside).toBe(0);
          if (shape.spikes.length > 0) expect(red, 'pointes rouges').toBeGreaterThan(shape.spikes.length * 3);
        });

        it('arête claire : le haut d\'une tuile accrochable exposée est plus clair que son cœur', () => {
          const { shape, canvases } = paint(painter, id);
          const tiles = canvases.tiles;
          let checked = 0;
          let fails = 0;
          for (let ty = 1; ty < shape.h - 1; ty++) {
            for (let tx = 1; tx < shape.w - 1; tx++) {
              if (shape.level.tiles[ty * shape.w + tx] !== T_SOLID) continue;
              if ((exposedFaces(shape, tx, ty) & 1) === 0) continue;
              let top = 0;
              let core = 0;
              for (let x = tx * ART_TILE; x < (tx + 1) * ART_TILE; x++) {
                top += luma(tiles.d[ty * ART_TILE * tiles.w + x]);
                for (let y = ty * ART_TILE + 7; y < (ty + 1) * ART_TILE; y++) core += luma(tiles.d[y * tiles.w + x]);
              }
              top /= ART_TILE;
              core /= ART_TILE * (ART_TILE - 7);
              checked++;
              if (top < core + 20) fails++;
            }
          }
          expect(checked).toBeGreaterThan(0);
          expect(fails, `${fails} / ${checked} arêtes pas assez claires`).toBe(0);
        });

        it('lisse : des reflets froids (plus bleus que rouges) sur chaque tuile lisse', () => {
          const { shape, canvases } = paint(painter, id);
          const tiles = canvases.tiles;
          for (let ty = 0; ty < shape.h; ty++) {
            for (let tx = 0; tx < shape.w; tx++) {
              if (shape.level.tiles[ty * shape.w + tx] !== T_SLICK) continue;
              let cold = 0;
              for (let y = ty * ART_TILE; y < (ty + 1) * ART_TILE; y++) {
                for (let x = tx * ART_TILE; x < (tx + 1) * ART_TILE; x++) {
                  const c = tiles.d[y * tiles.w + x];
                  if (cb(c) > cr(c) + 12 && luma(c) > 60) cold++;
                }
              }
              expect(cold, `tuile lisse (${tx},${ty})`).toBeGreaterThan(2);
            }
          }
        });

        it('aucun décor n\'emploie une teinte réservée aux joueurs, le fond reste sombre', () => {
          const { canvases } = paint(painter, id);
          const lumas: number[] = [];
          const hits: string[] = [];
          for (const [name, b] of Object.entries(canvases)) {
            if (!b) continue;
            for (let i = 0; i < b.d.length; i++) {
              const c = b.d[i];
              if (c === 0) continue;
              if (RESERVED.has(c & 0xffffff) && hits.length < 5) hits.push(`${name} ${(c & 0xffffff).toString(16)}`);
              if (name === 'back' && ca(c) === 255 && (i & 7) === 0) lumas.push(luma(c));
            }
          }
          expect(hits).toEqual([]);
          lumas.sort((a, b) => a - b);
          const median = lumas.length ? lumas[lumas.length >> 1] : 0;
          expect(median, 'luminance médiane du décor arrière').toBeLessThan(70);
        });

        it('les accessoires animés sont dans la carte et connus du thème', () => {
          const { shape, props } = paint(painter, id);
          const anims = painter.props();
          for (const p of props) {
            expect(anims[p.kind], p.kind).toBeDefined();
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(shape.pw);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(shape.ph);
          }
        });
      });
    }

    it('les frames d\'accessoires n\'emploient aucune teinte réservée', () => {
      for (const [kind, anim] of Object.entries(painter.props())) {
        expect(anim.frames.length, kind).toBeGreaterThan(0);
        let hits = 0;
        for (const f of anim.frames) for (const c of f.d) if (c && RESERVED.has(c & 0xffffff)) hits++;
        expect(hits, kind).toBe(0);
      }
    });
  });
}

describe('le samouraï', () => {
  const standing = (index: number): HeroPuppet => {
    const hero = new HeroPuppet(index);
    const inp = makeHeroInput();
    inp.x = 100;
    inp.y = 100;
    inp.grounded = true;
    inp.floorGap = 0;
    inp.radius = 5.5;
    const parts = new Particles();
    for (let i = 0; i < 30; i++) hero.update(1 / 60, inp, 30, parts);
    hero.draw(C('#a9c2ee'), 1);
    return hero;
  };

  it('pieds posés : au sol, le bas du perso touche le bas de la hitbox', () => {
    const hero = standing(0);
    const out = hero.out;
    // Plus bas pixel du corps (hors contour noir et second contour semi-transparent).
    let lowest = -1;
    for (let y = 0; y < HERO_BUF; y++) {
      for (let x = 0; x < HERO_BUF; x++) {
        const c = out.d[y * HERO_BUF + x];
        if (c !== 0 && c !== OUTLINE && ca(c) === 255) lowest = Math.max(lowest, y);
      }
    }
    const ground = 100 + 5.5 - hero.drawY;
    expect(Math.abs(lowest + 1 - ground), `sol à ${ground}, pied à ${lowest}`).toBeLessThanOrEqual(1.5);
  });

  it('chaque joueur porte sa teinte réservée, et pas celle de l\'autre', () => {
    for (const i of [0, 1]) {
      const hero = standing(i);
      const colors = new Set([...hero.out.d].map((c) => c & 0xffffff));
      expect(colors.has(HERO_PALETTES[i].scarf & 0xffffff)).toBe(true);
      expect(colors.has(HERO_PALETTES[1 - i].scarf & 0xffffff)).toBe(false);
      expect(colors.has(OUTLINE & 0xffffff)).toBe(true);
    }
  });

  it('accroché à deux ancres, chaque main tient sa corde', () => {
    const hero = new HeroPuppet(0);
    const inp = makeHeroInput();
    inp.x = 200;
    inp.y = 200;
    inp.hooks[0].state = HOOK_VIEW_ATTACHED;
    inp.hooks[0].x = 160;
    inp.hooks[0].y = 140;
    inp.hooks[1].state = HOOK_VIEW_ATTACHED;
    inp.hooks[1].x = 250;
    inp.hooks[1].y = 150;
    const parts = new Particles();
    for (let i = 0; i < 20; i++) hero.update(1 / 60, inp, 30, parts);
    hero.draw(C('#a9c2ee'), 1);
    const a = hero.handFor(0);
    const b = hero.handFor(1);
    expect(a[0]).toBeLessThan(b[0]);
    for (const p of [a, b]) {
      expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
      expect(Math.hypot(p[0] - 200, p[1] - 200)).toBeLessThan(20);
    }
  });
});

describe('l\'ashigaru', () => {
  it('la planche de sprites est complète : masque blanc, aucune teinte réservée', () => {
    const sheet = buildEnemySheet();
    expect(sheet.count).toBe(16 * 5 * 2 + 2 * 5 * 2);
    const colors = new Set<number>();
    for (const c of sheet.atlas.d) if (c) colors.add(c & 0xffffff);
    expect(colors.has(ENEMY_PAL.m & 0xffffff)).toBe(true);
    expect([...colors].filter((c) => RESERVED.has(c))).toEqual([]);
    // Les frames de marche diffèrent (les jambes bougent).
    expect(sheet.frame(true, 0, 0, false)).not.toBe(sheet.frame(true, Math.PI, 0, false));
  });
});

