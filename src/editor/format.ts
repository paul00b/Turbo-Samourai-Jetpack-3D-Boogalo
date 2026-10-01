/**
 * Export / import texte des cartes perso, au format de src/sim/level.ts : on colle l'export tel
 * quel dans level.ts (constante MAP_… + entrée de LEVEL_DEFS) pour en faire une carte officielle.
 * L'import accepte cet export, un bloc de level.ts, ou les lignes brutes de la carte. Pur.
 */
import type { ThemeId } from '../render/art/themes/types';
import { sanitizeSigns, type LevelSign } from '../sim';
import type { MapMode } from './grid';

export interface MapDoc {
  name: string;
  mode: MapMode;
  theme: ThemeId;
  rows: string[];
  /** Panneaux de texte posés dans le décor (absents des anciennes cartes). */
  signs?: LevelSign[];
}

const THEMES: readonly ThemeId[] = ['port', 'bamboo', 'forge'];

/** MAP_MA_CARTE : majuscules sans accents, chiffres et soulignés. */
export function constName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `MAP_${slug || 'PERSO'}`;
}

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function exportMap(doc: MapDoc): string {
  const c = constName(doc.name);
  return [
    `// Carte perso « ${doc.name} » · ${doc.mode === 'race' ? 'course' : 'arcade'} · thème ${doc.theme} · ${doc.rows[0]?.length ?? 0} × ${doc.rows.length}`,
    `const ${c}: readonly string[] = [`,
    ...doc.rows.map((r) => `  '${r}',`),
    '];',
    '',
    '// Entrée de LEVEL_DEFS :',
    `// { name: ${quote(doc.name)}, mode: '${doc.mode}', subtitle: '', rows: ${c}, labels: [] },`,
    `// thème : ${doc.theme}`,
    ...(doc.signs?.length ? [`// panneaux : ${JSON.stringify(doc.signs)}`] : []),
    '',
  ].join('\n');
}

export type ImportResult = { ok: true; doc: MapDoc } | { ok: false; error: string };

const ROW_RE = /^[#=^T.SepF]+$/;

/**
 * Lit un export, un bloc de level.ts ou des lignes brutes. Les métadonnées absentes prennent les
 * valeurs de `fallback` (le mode est deviné : une arrivée F = course).
 */
export function importMap(text: string, fallback: Omit<MapDoc, 'rows'>): ImportResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const quoted: string[] = [];
  const raw: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^'([^']*)',?$/);
    if (m) quoted.push(m[1]);
    else if (ROW_RE.test(t)) raw.push(t);
  }
  const rows = quoted.length >= 4 ? quoted : raw;
  if (rows.length < 4) return { ok: false, error: 'Aucune carte reconnue : colle un export, un bloc de level.ts ou les lignes de la carte.' };
  const w = rows[0].length;
  const bad = rows.findIndex((r) => r.length !== w);
  if (bad >= 0) return { ok: false, error: `La ligne ${bad + 1} fait ${rows[bad].length} de large au lieu de ${w}.` };
  const unknown = rows.join('').match(/[^#=^T.SepF]/);
  if (unknown) return { ok: false, error: `Caractère inconnu « ${unknown[0]} ».` };

  const all = lines.join('\n');
  const name = all.match(/Carte perso « ([^»]+) »/)?.[1] ?? all.match(/name:\s*'((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\'/g, "'") ?? fallback.name;
  let mode: MapMode = fallback.mode;
  const modeMatch = all.match(/mode:\s*'(kills|race)'/) ?? all.match(/·\s*(course|arcade)\s*·/);
  if (modeMatch) mode = modeMatch[1] === 'race' || modeMatch[1] === 'course' ? 'race' : 'kills';
  else mode = rows.some((r) => r.includes('F')) ? 'race' : 'kills';
  const themeMatch = all.match(/thème\s*:?\s*(port|bamboo|forge)/);
  const theme = themeMatch && THEMES.includes(themeMatch[1] as ThemeId) ? (themeMatch[1] as ThemeId) : fallback.theme;
  let signs: LevelSign[] = [];
  const signsMatch = all.match(/^\s*\/\/\s*panneaux\s*:\s*(\[.*\])\s*$/m);
  if (signsMatch) {
    try {
      signs = sanitizeSigns(JSON.parse(signsMatch[1]), w, rows.length);
    } catch {
      /* panneaux illisibles : la carte s'importe sans eux */
    }
  }
  return { ok: true, doc: { name, mode, theme, rows, signs } };
}
