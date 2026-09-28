import { afterEach, describe, expect, it } from 'vitest';
import {
  createInitialState,
  CUSTOM_LEVEL_ID,
  getLevel,
  makeInput,
  parseLevel,
  setCustomLevel,
  step,
  validateRows,
  type SimEvent,
} from '../src/sim';
import {
  applyCells,
  clipCells,
  copyRect,
  EditGrid,
  floodCells,
  History,
  lineCells,
  paint,
  rectCells,
  resized,
  templateGrid,
} from '../src/editor/grid';
import { defaultValues, presetCells, PRESETS } from '../src/editor/presets';
import { constName, exportMap, importMap } from '../src/editor/format';
import { themeIdFor, setCustomTheme } from '../src/render/art/themes/painters';

const rules = (rows: readonly string[], mode: 'kills' | 'race'): string[] => validateRows(rows, mode).map((i) => i.rule);

describe('grille de l\'éditeur', () => {
  it('rectangle, ligne et remplissage', () => {
    const g = new EditGrid(10, 8);
    expect(applyCells(g, rectCells(4, 5, 2, 3, '#'))).toBe(true);
    expect(g.rows().slice(3, 6)).toEqual(['..###.....', '..###.....', '..###.....']);
    const line = lineCells(0, 0, 3, 2, '=');
    expect(line[0]).toEqual({ x: 0, y: 0, c: '=' });
    expect(line[line.length - 1]).toEqual({ x: 3, y: 2, c: '=' });
    expect(line).toHaveLength(4);
    // Le remplissage s'arrête aux murs : l'intérieur du cadre seulement.
    const f = EditGrid.fromRows(['#####', '#...#', '#.#.#', '#####']);
    const cells = floodCells(f, 1, 1, '^');
    expect(cells).toHaveLength(5);
    applyCells(f, cells);
    expect(f.rows()).toEqual(['#####', '#^^^#', '#^#^#', '#####']);
    expect(floodCells(f, 1, 1, '^')).toHaveLength(0);
  });

  it('un seul spawn : en poser un efface l\'ancien', () => {
    const g = new EditGrid(6, 4);
    paint(g, 1, 1, 'S');
    paint(g, 4, 2, 'S');
    expect(g.cells.filter((c) => c === 'S')).toHaveLength(1);
    expect(g.get(4, 2)).toBe('S');
  });

  it('annuler / refaire', () => {
    const g = new EditGrid(5, 5);
    const h = new History(3);
    let cur = g;
    for (let i = 0; i < 5; i++) {
      h.push(cur);
      cur = cur.clone();
      cur.set(i, 0, '#');
    }
    expect(cur.rows()[0]).toBe('#####');
    const u1 = h.undo(cur)!;
    expect(u1.rows()[0]).toBe('####.');
    const u2 = h.undo(u1)!;
    const u3 = h.undo(u2)!;
    expect(u3.rows()[0]).toBe('##...');
    expect(h.undo(u3)).toBeNull(); // limite de 3 niveaux
    const r = h.redo(u3)!;
    expect(r.rows()[0]).toBe('###..');
  });

  it('copier / coller une zone', () => {
    const g = EditGrid.fromRows(['.#.', '#^#', '...']);
    const clip = copyRect(g, 0, 0, 2, 1);
    expect(clip).toMatchObject({ w: 3, h: 2 });
    const dst = new EditGrid(5, 4);
    applyCells(dst, clipCells(clip, 2, 2));
    expect(dst.rows()).toEqual(['.....', '.....', '...#.', '..#^#']);
  });

  it('redimensionner garde le sol en bas et recrée les bords', () => {
    const g = templateGrid('kills', 40, 24);
    const bigger = resized(g, 50, 30);
    expect(bigger.w).toBe(50);
    expect(bigger.h).toBe(30);
    // Le spawn a suivi le sol.
    const sy = bigger.rows().findIndex((r) => r.includes('S'));
    expect(sy).toBe(bigger.floorRow - 1);
    expect(bigger.rows()[bigger.h - 2].slice(1, -1)).toMatch(/^#+$/);
    expect(bigger.rows()[0]).toMatch(/^#+$/);
    for (const r of bigger.rows()) expect(r[0] + r[r.length - 1]).toBe('##');
    // L'ancien bord droit est devenu de l'air.
    expect(bigger.get(39, 10)).toBe('.');
    const smaller = resized(bigger, 30, 20);
    expect(smaller.rows()[smaller.h - 2].slice(1, -1)).toMatch(/^[#^T.]+$/);
    expect(validateRows(smaller.rows(), 'kills').filter((i) => i.rule === 'border' || i.rule === 'floor')).toEqual([]);
  });

  it('les gabarits de nouvelle carte sont jouables et propres', () => {
    for (const mode of ['kills', 'race'] as const) {
      const g = templateGrid(mode);
      expect(validateRows(g.rows(), mode), mode).toEqual([]);
    }
  });
});

describe('presets', () => {
  const g = templateGrid('race', 120, 40);
  for (const p of PRESETS) {
    it(`${p.label} : pose des tuiles valides, dans la grille, miroir compris`, () => {
      const v = defaultValues(p);
      for (const mirrored of [false, true]) {
        for (const [x, y] of [[20, 20], [2, 2], [118, 38], [60, 30]]) {
          const cells = presetCells(p, g, x, y, v, mirrored);
          for (const c of cells) {
            expect(g.inside(c.x, c.y)).toBe(true);
            expect('#=^T.SepF').toContain(c.c);
          }
        }
      }
      expect(presetCells(p, g, 40, 20, v).length).toBeGreaterThan(0);
    });
  }

  it('la lanterne a la largeur demandée et sa tige au milieu', () => {
    const p = PRESETS.find((q) => q.id === 'lamp')!;
    const cells = presetCells(p, new EditGrid(20, 20), 5, 10, { w: 5, stem: 3 });
    expect(cells.filter((c) => c.y === 10).map((c) => c.x)).toEqual([5, 6, 7, 8, 9]);
    expect(cells.filter((c) => c.y < 10).map((c) => c.x)).toEqual([7, 7, 7]);
  });

  it('le contrepoids monte jusqu\'au plafond, la tour descend jusqu\'au sol', () => {
    const grid = templateGrid('kills', 40, 30);
    const w = presetCells(PRESETS.find((q) => q.id === 'weight')!, grid, 10, 12, { w: 3, h: 1 });
    expect(Math.min(...w.map((c) => c.y))).toBe(1);
    const t = presetCells(PRESETS.find((q) => q.id === 'tower')!, grid, 25, 10, { w: 4, face: '#' });
    expect(Math.max(...t.map((c) => c.y))).toBe(grid.floorRow - 1);
  });

  it('le tronçon de sol et le champ de tremplins restent en bas, gabarit valide', () => {
    const grid = templateGrid('race', 120, 40);
    applyCells(grid, presetCells(PRESETS.find((q) => q.id === 'floor')!, grid, 40, 5, { w: 6, kind: 'void' }));
    applyCells(grid, presetCells(PRESETS.find((q) => q.id === 'pads')!, grid, 60, 5, { n: 3, gap: 'spike' }));
    expect(grid.rows()[grid.h - 2].slice(40, 46)).toBe('......');
    expect(grid.rows()[grid.h - 1].slice(40, 46)).toBe('......');
    expect(grid.rows()[grid.h - 2].slice(60, 75)).toBe('TTT^^^TTT^^^TTT');
    expect(rules(grid.rows(), 'race').filter((r) => r === 'floor' || r === 'support')).toEqual([]);
  });
});

describe('export / import', () => {
  const rows = templateGrid('race', 60, 24).rows();

  it('aller-retour sans perte, métadonnées comprises', () => {
    const text = exportMap({ name: "L'Échelle d'or", mode: 'race', theme: 'bamboo', rows });
    expect(text).toContain("const MAP_L_ECHELLE_D_OR: readonly string[] = [");
    const r = importMap(text, { name: 'x', mode: 'kills', theme: 'port' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc).toEqual({ name: "L'Échelle d'or", mode: 'race', theme: 'bamboo', rows });
  });

  it('importe un bloc de level.ts et des lignes brutes', () => {
    const block = `const MAP_TRUC: readonly string[] = [\n${rows.map((r) => `  '${r}',`).join('\n')}\n];`;
    const a = importMap(block, { name: 'Importée', mode: 'kills', theme: 'forge' });
    expect(a.ok && a.doc.rows).toEqual(rows);
    expect(a.ok && a.doc.mode).toBe('race'); // deviné : il y a une arrivée
    expect(a.ok && a.doc.theme).toBe('forge');
    const b = importMap(rows.join('\n'), { name: 'Brute', mode: 'kills', theme: 'port' });
    expect(b.ok && b.doc.rows).toEqual(rows);
  });

  it('refuse le texte qui n\'est pas une carte, ou une carte bancale', () => {
    expect(importMap('bonjour', { name: 'x', mode: 'kills', theme: 'port' }).ok).toBe(false);
    const bad = importMap(['#####', '#...#', '#..#', '#####'].join('\n'), { name: 'x', mode: 'kills', theme: 'port' });
    expect(bad.ok).toBe(false);
  });

  it('nom de constante propre', () => {
    expect(constName('  ')).toBe('MAP_PERSO');
    expect(constName('Tour 2 — l’abîme')).toBe('MAP_TOUR_2_L_ABIME');
  });
});

describe('règles de validation', () => {
  it('signale ce qui empêche de jouer, et les entorses au design', () => {
    const g = templateGrid('kills', 40, 24);
    const noSpawn = g.clone();
    noSpawn.cells.forEach((c, i) => c === 'S' && (noSpawn.cells[i] = '.'));
    expect(rules(noSpawn.rows(), 'kills')).toContain('spawn-missing');
    expect(rules(g.rows(), 'race')).toContain('goal-missing');
    const noEnemy = g.clone();
    noEnemy.cells.forEach((c, i) => c === 'e' && (noEnemy.cells[i] = '.'));
    expect(rules(noEnemy.rows(), 'kills')).toContain('no-enemy');
    const floating = g.clone();
    floating.set(20, 5, '^');
    floating.set(0, 5, '.');
    floating.set(10, floating.h - 1, '.'); // socle retiré sous du sol
    const r = rules(floating.rows(), 'kills');
    expect(r).toContain('support');
    expect(r).toContain('border');
    expect(r).toContain('floor');
    const issue = validateRows(floating.rows(), 'kills').find((i) => i.rule === 'support')!;
    expect([issue.x, issue.y]).toEqual([20, 5]);
    const noAnchor = templateGrid('kills', 40, 24);
    for (let y = 1; y < noAnchor.floorRow - 1; y++) for (let x = 1; x < 30; x++) if (noAnchor.get(x, y) === '#') noAnchor.set(x, y, '.');
    for (let y = 0; y < noAnchor.floorRow; y++) noAnchor.set(0, y, '='); // le mur gauche aussi est un ancrage
    expect(rules(noAnchor.rows(), 'kills')).toContain('spawn-anchor');
  });

  it('course : un passage d\'au moins 3 tuiles mène du spawn à l\'arrivée', () => {
    const g = templateGrid('race');
    const F = g.floorRow;
    expect(rules(g.rows(), 'race')).not.toContain('goal-unreachable');
    // Un mur du plafond au sol entre le spawn et l'arrivée : la course ne se termine pas.
    const sealed = g.clone();
    for (let y = 1; y < F; y++) sealed.set(80, y, '#');
    expect(rules(sealed.rows(), 'race')).toContain('goal-unreachable');
    const issue = validateRows(sealed.rows(), 'race').find((i) => i.rule === 'goal-unreachable')!;
    expect(issue.severity).toBe('error');
    expect(issue.x).toBe(79);
    // Une fente de 2 tuiles : jouable, mais signalée ; à 3 tuiles, plus rien à dire.
    const slit = sealed.clone();
    for (const y of [F - 6, F - 5]) slit.set(80, y, '.');
    expect(rules(slit.rows(), 'race')).not.toContain('goal-unreachable');
    expect(rules(slit.rows(), 'race')).toContain('passage-narrow');
    slit.set(80, F - 4, '.');
    expect(rules(slit.rows(), 'race')).not.toContain('passage-narrow');
    // Les pics ne sont pas un passage.
    const spiked = sealed.clone();
    for (const y of [F - 6, F - 5, F - 4]) spiked.set(80, y, '^');
    expect(rules(spiked.rows(), 'race')).toContain('goal-unreachable');
  });
});

describe('carte perso dans la sim', () => {
  afterEach(() => setCustomLevel(null));

  it('se joue sur CUSTOM_LEVEL_ID, et getLevel retombe sur la carte 0 sans elle', () => {
    const rows = templateGrid('race', 60, 24).rows();
    const level = parseLevel(rows, [], 'Test', '', 'race');
    expect(getLevel(CUSTOM_LEVEL_ID)).toBe(getLevel(0));
    setCustomLevel(level);
    expect(getLevel(CUSTOM_LEVEL_ID)).toBe(level);
    const s = createInitialState(1, 1, undefined, CUSTOM_LEVEL_ID);
    expect(s.levelId).toBe(CUSTOM_LEVEL_ID);
    expect(s.players[0].x).toBeCloseTo(level.spawnX);
    const ev: SimEvent[] = [];
    for (let t = 0; t < 120; t++) step(s, [makeInput()], ev);
    expect(s.players[0].deaths).toBe(0);
    expect(s.players[0].grounded).toBe(1);
    // L'arrivée de la carte perso termine la manche.
    s.players[0].x = level.goal!.x + level.goal!.w / 2;
    s.players[0].y = level.goal!.y + level.goal!.h / 2;
    step(s, [makeInput()], ev);
    expect(s.finished).toBe(1);
  });

  it('le thème auto de la carte perso est celui choisi dans l\'éditeur', () => {
    setCustomTheme('forge');
    expect(themeIdFor('auto', CUSTOM_LEVEL_ID)).toBe('forge');
    expect(themeIdFor('bamboo', CUSTOM_LEVEL_ID)).toBe('bamboo');
    setCustomTheme('port');
  });
});
