/**
 * Maths déterministes pour la simulation.
 *
 * RÈGLE : uniquement + - * / et Math.sqrt (correctement arrondis par IEEE 754, donc identiques
 * sur V8, SpiderMonkey et JavaScriptCore), plus floor/abs/min/max/trunc (exacts).
 * INTERDIT ici : Math.sin/cos/tan/atan2/pow/exp/log/hypot/random (implementation-approximated).
 * Un test statique (test/no-forbidden-math.test.ts) vérifie que src/sim n'en contient aucun.
 */

export const PI = 3.141592653589793;
export const HALF_PI = 1.5707963267948966;
export const TWO_PI = 6.283185307179586;

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function lengthSq(x: number, y: number): number {
  return x * x + y * y;
}

/** Approche `current` vers `target` d'au plus `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (d > maxDelta) return current + maxDelta;
  if (d < -maxDelta) return current - maxDelta;
  return target;
}

/**
 * Vecteur unitaire depuis un angle quantifié sur 16 bits (0..65535 -> 0..2π, repère écran y vers le bas).
 * Implémentation : réduction par quadrant/octant puis polynômes de Taylor (degré 11/12) sur [0, π/4].
 * Erreur max ~1e-11, largement suffisante ; surtout, 100 % déterministe (seulement + - * /).
 */
export function dirFromAngle16(angle16: number, out: Vec2): Vec2 {
  const a = angle16 & 0xffff;
  const quadrant = a >>> 14; // 0..3
  let r = a & 0x3fff; // 0..16383 à l'intérieur du quadrant
  let swap = false;
  if (r > 8192) {
    r = 16384 - r;
    swap = true;
  }
  const t = r * (HALF_PI / 16384); // [0, π/4]
  const t2 = t * t;
  let s =
    t *
    (1 +
      t2 *
        (-1 / 6 +
          t2 * (1 / 120 + t2 * (-1 / 5040 + t2 * (1 / 362880 + t2 * (-1 / 39916800))))));
  let c =
    1 +
    t2 *
      (-1 / 2 +
        t2 *
          (1 / 24 +
            t2 *
              (-1 / 720 +
                t2 * (1 / 40320 + t2 * (-1 / 3628800 + t2 * (1 / 479001600))))));
  if (swap) {
    const tmp = s;
    s = c;
    c = tmp;
  }
  switch (quadrant) {
    case 0:
      out.x = c;
      out.y = s;
      break;
    case 1:
      out.x = -s;
      out.y = c;
      break;
    case 2:
      out.x = -c;
      out.y = -s;
      break;
    default:
      out.x = s;
      out.y = -c;
      break;
  }
  return out;
}

/**
 * Intersection segment [p, p + d*maxT] / cercle (c, r). Retourne la distance t du premier point
 * d'entrée (0..maxT) ou -1. `d` doit être unitaire.
 */
export function raySegmentCircle(
  px: number,
  py: number,
  dx: number,
  dy: number,
  maxT: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const fx = px - cx;
  const fy = py - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // départ déjà dans le cercle
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return -1;
  return t;
}
