import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou statique : la simulation ne doit contenir aucune fonction "implementation-approximated"
 * de la spec ECMAScript, ni source de non-déterminisme (random, Date, performance, itération Map/Set).
 */
const FORBIDDEN = [
  /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|pow|exp|expm1|log|log2|log10|log1p|hypot|cbrt|random)\b/,
  /\*\*/, // opérateur exponentiation (== Math.pow)
  /\bDate\b/,
  /\bperformance\b/,
  /\bnew\s+(Map|Set|WeakMap|WeakSet)\b/,
  /\bfor\s*\(\s*(const|let)\s+[^;]*\bof\b[^)]*\.(keys|values|entries)\(\)/,
  /\brequestAnimationFrame\b/,
  /\bdocument\b|\bwindow\b|\bnavigator\b/,
];

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('src/sim : aucune opération non déterministe', () => {
  const files = listTs(join(process.cwd(), 'src', 'sim'));
  it('trouve les fichiers de la sim', () => {
    expect(files.length).toBeGreaterThan(5);
  });
  for (const file of files) {
    it(`${file.replace(process.cwd(), '')} est propre`, () => {
      const src = readFileSync(file, 'utf8')
        // retire commentaires ligne et bloc pour ne pas matcher la doc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const re of FORBIDDEN) {
        const m = src.match(re);
        expect(m, `${file} contient ${m?.[0]}`).toBeNull();
      }
    });
  }
});
