import { describe, expect, it } from 'vitest';
import { angle16FromRadians, dirFromAngle16, raySegmentCircle, vec2 } from '../src/sim';

describe('dirFromAngle16', () => {
  it('colle à Math.cos/sin à 1e-9 sur tout le cercle (référence côté test uniquement)', () => {
    const v = vec2();
    let maxErr = 0;
    for (let a = 0; a < 65536; a += 1) {
      dirFromAngle16(a, v);
      const rad = (a / 65536) * Math.PI * 2;
      maxErr = Math.max(maxErr, Math.abs(v.x - Math.cos(rad)), Math.abs(v.y - Math.sin(rad)));
      const len = Math.hypot(v.x, v.y);
      expect(Math.abs(len - 1)).toBeLessThan(1e-9);
    }
    expect(maxErr).toBeLessThan(1e-9);
  });

  it('directions cardinales exactes', () => {
    const v = vec2();
    // Math.abs pour ne pas distinguer -0 de +0 (les deux sont des résultats IEEE déterministes).
    dirFromAngle16(0, v);
    expect(v.x).toBe(1);
    expect(Math.abs(v.y)).toBe(0);
    dirFromAngle16(16384, v);
    expect(Math.abs(v.x)).toBe(0);
    expect(v.y).toBe(1);
    dirFromAngle16(32768, v);
    expect(v.x).toBe(-1);
    expect(Math.abs(v.y)).toBe(0);
    dirFromAngle16(49152, v);
    expect(Math.abs(v.x)).toBe(0);
    expect(v.y).toBe(-1);
  });

  it('angle16FromRadians est l\'inverse (à la quantification près)', () => {
    for (let i = 0; i < 100; i++) {
      const rad = (i / 100) * Math.PI * 2 - Math.PI;
      const a = angle16FromRadians(rad);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(65536);
      const v = vec2();
      dirFromAngle16(a, v);
      expect(v.x).toBeCloseTo(Math.cos(rad), 3);
      expect(v.y).toBeCloseTo(Math.sin(rad), 3);
    }
  });
});

describe('raySegmentCircle', () => {
  it('touche un cercle devant, rate un cercle derrière ou trop loin', () => {
    expect(raySegmentCircle(0, 0, 1, 0, 100, 50, 0, 10)).toBeCloseTo(40);
    expect(raySegmentCircle(0, 0, 1, 0, 100, -50, 0, 10)).toBe(-1);
    expect(raySegmentCircle(0, 0, 1, 0, 30, 50, 0, 10)).toBe(-1);
    expect(raySegmentCircle(0, 0, 1, 0, 100, 50, 30, 10)).toBe(-1);
  });
});
