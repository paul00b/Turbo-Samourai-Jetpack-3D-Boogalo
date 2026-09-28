/**
 * Règles de level design, pures et partagées : l'éditeur les affiche en direct (avertissements
 * cliquables), `test/levels.test.ts` les exige des cartes officielles.
 *
 * Travaille sur les LIGNES brutes (ce que l'éditeur manipule et ce que level.ts contient), pour voir
 * aussi ce que parseLevel efface : spawn absent ou en double, arrivée manquante.
 */
import { dirFromAngle16, vec2 } from './math';
import { DEFAULT_PARAMS } from './params';
import {
  isSolidTile,
  makeRayHit,
  parseLevel,
  raycastTiles,
  T_AIR,
  T_BOUNCE,
  T_SOLID,
  T_SPIKE,
  TILE_SIZE,
  tileAt,
  type Level,
  type LevelMode,
} from './level';

export type IssueSeverity = 'error' | 'warn';

export interface LevelIssue {
  /** Identifiant stable de la règle (tests, filtres). */
  rule: string;
  severity: IssueSeverity;
  message: string;
  /** Tuile concernée (pour centrer la vue), si la règle en désigne une. */
  x?: number;
  y?: number;
}

/** Caractères connus du format de carte. */
export const TILE_CHARS = '#=^T.SepF';

/** Au plus N occurrences par règle : un sol entier mal fait ne noie pas la liste. */
const MAX_PER_RULE = 6;

/**
 * Vérifie une carte donnée par ses lignes. `error` = la carte ne se joue pas correctement (pas de
 * spawn, pas d'arrivée en course, rien à tuer en arcade) ; `warn` = entorse aux règles de design.
 */
export function validateRows(rows: readonly string[], mode: LevelMode): LevelIssue[] {
  const out: LevelIssue[] = [];
  const counts: Record<string, number> = {};
  const push = (i: LevelIssue): void => {
    counts[i.rule] = (counts[i.rule] ?? 0) + 1;
    if (counts[i.rule] <= MAX_PER_RULE) out.push(i);
  };

  if (rows.length < 8 || rows[0].length < 8) {
    push({ rule: 'size', severity: 'error', message: 'Carte trop petite (8 × 8 minimum).' });
    return out;
  }
  const w = rows[0].length;
  const h = rows.length;
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      push({ rule: 'width', severity: 'error', message: `Ligne ${y} de largeur ${rows[y].length} au lieu de ${w}.`, x: 0, y });
      return out;
    }
    for (let x = 0; x < w; x++) {
      if (!TILE_CHARS.includes(rows[y][x])) push({ rule: 'char', severity: 'error', message: `Caractère inconnu « ${rows[y][x]} ».`, x, y });
    }
  }

  // Spawn : exactement un.
  const spawns: { x: number; y: number }[] = [];
  let goals = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === 'S') spawns.push({ x, y });
      else if (rows[y][x] === 'F') goals++;
    }
  }
  if (spawns.length === 0) push({ rule: 'spawn-missing', severity: 'error', message: 'Aucun spawn (S) : où apparaît le joueur ?' });
  for (const s of spawns.slice(1)) push({ rule: 'spawn-duplicate', severity: 'warn', message: 'Spawn en double : seul le dernier compte.', x: s.x, y: s.y });
  if (mode === 'race' && goals === 0) push({ rule: 'goal-missing', severity: 'error', message: 'Course sans arrivée : pose des tuiles F.' });
  if (mode === 'kills' && goals > 0) push({ rule: 'goal-arcade', severity: 'warn', message: "Arrivée (F) sur une carte arcade : elle n'y sert à rien." });

  let level: Level;
  try {
    level = parseLevel(rows, [], '', '', mode);
  } catch (e) {
    push({ rule: 'parse', severity: 'error', message: (e as Error).message });
    return out;
  }
  if (mode === 'kills' && level.enemies.length === 0) push({ rule: 'no-enemy', severity: 'error', message: 'Arcade sans ennemi : la manche ne peut pas se terminer.' });

  // Bords pleins (haut, gauche, droite).
  for (let x = 0; x < w; x++) if (!isSolidTile(tileAt(level, x, 0))) push({ rule: 'border', severity: 'warn', message: 'Bord du haut ouvert.', x, y: 0 });
  for (let y = 0; y < h; y++) {
    if (!isSolidTile(tileAt(level, 0, y))) push({ rule: 'border', severity: 'warn', message: 'Bord gauche ouvert.', x: 0, y });
    if (!isSolidTile(tileAt(level, w - 1, y))) push({ rule: 'border', severity: 'warn', message: 'Bord droit ouvert.', x: w - 1, y });
  }

  // Bas plat : sol, pics, tremplins, ou gouffre ouvert jusqu'en bas.
  const F = h - 2;
  for (let x = 1; x < w - 1; x++) {
    const top = tileAt(level, x, F);
    const bottom = tileAt(level, x, h - 1);
    if (top === T_AIR) {
      if (bottom !== T_AIR) push({ rule: 'floor', severity: 'warn', message: 'Trou dans le sol fermé en bas : un gouffre doit être ouvert jusqu\'au bord.', x, y: h - 1 });
      continue;
    }
    if (top !== T_SOLID && top !== T_SPIKE && top !== T_BOUNCE) push({ rule: 'floor', severity: 'warn', message: 'Le sol doit être du mur accrochable, des pics, un tremplin ou un gouffre.', x, y: F });
    else if (bottom !== T_SOLID) push({ rule: 'floor', severity: 'warn', message: 'Sous le sol, la dernière rangée doit être pleine.', x, y: h - 1 });
  }

  // Pics et tremplins posés sur du plein ; tremplins avec de l'air au-dessus.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tileAt(level, x, y);
      if (t !== T_SPIKE && t !== T_BOUNCE) continue;
      const name = t === T_SPIKE ? 'Pic' : 'Tremplin';
      if (tileAt(level, x, y + 1) !== T_SOLID) push({ rule: 'support', severity: 'warn', message: `${name} dans le vide : il doit reposer sur du mur accrochable.`, x, y });
      if (t === T_BOUNCE) {
        let clear = true;
        for (let k = 1; k <= 4; k++) if (tileAt(level, x, y - k) !== T_AIR) clear = false;
        if (!clear) push({ rule: 'pad-clearance', severity: 'warn', message: 'Tremplin bouché : garde au moins 4 tuiles d\'air au-dessus.', x, y });
      }
    }
  }

  // Ennemis posés sur du plein.
  for (const e of level.enemies) {
    const tx = Math.floor(e.x / TILE_SIZE);
    const ty = Math.floor(e.y / TILE_SIZE);
    if (!isSolidTile(tileAt(level, tx, ty + 1))) push({ rule: 'enemy-floating', severity: 'warn', message: 'Ennemi dans le vide : pose-le sur une plateforme.', x: tx, y: ty });
  }

  // Spawn : debout sur le sol, loin des pics, un ancrage à portée.
  const sp = spawns[spawns.length - 1];
  if (sp) {
    if (!isSolidTile(tileAt(level, sp.x, sp.y + 1))) push({ rule: 'spawn-floating', severity: 'warn', message: 'Le spawn doit être posé sur du sol.', x: sp.x, y: sp.y });
    let spike = false;
    for (let y = sp.y - 8; y <= sp.y + 1; y++) for (let x = sp.x - 3; x <= sp.x + 3; x++) if (tileAt(level, x, y) === T_SPIKE) spike = true;
    if (spike) push({ rule: 'spawn-spike', severity: 'warn', message: 'Pics trop près du spawn.', x: sp.x, y: sp.y });
    if (!anchorNearSpawn(level)) push({ rule: 'spawn-anchor', severity: 'warn', message: 'Aucun ancrage (#) à portée de grappin depuis le spawn.', x: sp.x, y: sp.y });
  }

  // Course : un chemin d'air mène du spawn à l'arrivée, et il n'est pas un trou de souris.
  if (mode === 'race' && sp && level.goal) {
    const open = passageToGoal(level, 1);
    if (!open.ok) {
      push({ rule: 'goal-unreachable', severity: 'error', message: 'Arrivée inaccessible : aucun passage d\'air ne mène du spawn à l\'arrivée.', x: open.x, y: open.y });
    } else {
      const wide = passageToGoal(level, MIN_PASSAGE);
      if (!wide.ok) push({ rule: 'passage-narrow', severity: 'warn', message: `Passage trop étroit vers l'arrivée : aucun couloir de ${MIN_PASSAGE} tuiles au-delà de ce point.`, x: wide.x, y: wide.y });
    }
  }
  return out;
}

/** Largeur minimale, en tuiles, du couloir d'air qui mène du spawn à l'arrivée d'une course. */
export const MIN_PASSAGE = 3;

/**
 * Le spawn mène-t-il à l'arrivée par l'air, dans un couloir d'au moins `k` tuiles ? On fait glisser
 * un carré de k × k tuiles d'air (ni mur, ni pics, ni tremplin) depuis le spawn. Sinon, rend la
 * case la plus à droite atteinte : c'est là que le chemin se bouche.
 */
export function passageToGoal(level: Level, k: number): { ok: boolean; x: number; y: number } {
  const w = level.width;
  const h = level.height;
  const goal = level.goal;
  const sx = Math.floor(level.spawnX / TILE_SIZE);
  const sy = Math.floor(level.spawnY / TILE_SIZE);
  if (!goal) return { ok: false, x: sx, y: sy };
  const gx0 = goal.x / TILE_SIZE;
  const gy0 = goal.y / TILE_SIZE;
  const gx1 = gx0 + goal.w / TILE_SIZE - 1;
  const gy1 = gy0 + goal.h / TILE_SIZE - 1;
  const fits = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x + k > w || y + k > h) return false;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) if (tileAt(level, x + i, y + j) !== T_AIR) return false;
    return true;
  };
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let y = sy - k + 1; y <= sy; y++) {
    for (let x = sx - k + 1; x <= sx; x++) {
      if (fits(x, y)) {
        seen[y * w + x] = 1;
        queue.push(x, y);
      }
    }
  }
  let bx = sx;
  let by = sy;
  for (let q = 0; q < queue.length; q += 2) {
    const x = queue[q];
    const y = queue[q + 1];
    if (x <= gx1 && x + k - 1 >= gx0 && y <= gy1 && y + k - 1 >= gy0) return { ok: true, x, y };
    if (x > bx) {
      bx = x;
      by = y;
    }
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !fits(nx, ny)) continue;
      seen[ny * w + nx] = 1;
      queue.push(nx, ny);
    }
  }
  return { ok: false, x: bx + k - 1, y: by };
}

/** Un ancrage accrochable dans le cône vers le haut, à portée de grappin depuis le spawn. */
export function anchorNearSpawn(level: Level): boolean {
  const hit = makeRayHit();
  const dir = vec2();
  // Angles u16 : AIM_UP = 49152 ; de -170° à -10° par pas d'environ 2°.
  for (let a = 34588; a <= 63716; a += 364) {
    dirFromAngle16(a, dir);
    raycastTiles(level, level.spawnX, level.spawnY, dir.x, dir.y, DEFAULT_PARAMS.hookMaxLength, hit);
    if (hit.hit && hit.tile === T_SOLID && hit.y < level.spawnY - TILE_SIZE) return true;
  }
  return false;
}

/** Seulement les erreurs bloquantes. */
export function blockingIssues(issues: readonly LevelIssue[]): LevelIssue[] {
  return issues.filter((i) => i.severity === 'error');
}
