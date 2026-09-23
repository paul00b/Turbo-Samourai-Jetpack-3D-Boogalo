/**
 * PRNG mulberry32, état sur 32 bits stocké dans le GameState (donc snapshoté / rollbackable).
 * Toutes les opérations sont entières (Math.imul, décalages) : déterministes partout.
 */

export function mulberry32Next(state: number): number {
  return (state + 0x6d2b79f5) | 0;
}

/** Valeur dans [0, 1) dérivée de l'état *après* avancement. */
export function mulberry32Value(state: number): number {
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Hash d'une seed quelconque (nombre) vers un état 32 bits non nul. */
export function seedToState(seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0 || 1;
}
