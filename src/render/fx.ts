/** Particules cosmétiques (rendu uniquement : Math.random autorisé ici). */
import type { SimEvent } from '../sim';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

export const PLAYER_COLORS = [0x4fd1ff, 0xffab4f];

export class Fx {
  readonly particles: Particle[] = [];

  burst(x: number, y: number, n: number, speed: number, color: number, life = 0.6, size = 3): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * (0.5 + Math.random() * 0.5),
        maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color,
      });
    }
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'death':
          this.burst(e.x, e.y, 28, 520, PLAYER_COLORS[e.player] ?? 0xffffff, 0.7, 4);
          this.burst(e.x, e.y, 10, 200, 0xffffff, 0.3, 2);
          break;
        case 'enemyKill':
          this.burst(e.x, e.y, 18, 380, 0xff5a5a, 0.5, 4);
          break;
        case 'hookHit':
          this.burst(e.x, e.y, 6, 160, 0xffffff, 0.25, 2);
          break;
        case 'hookMiss':
          this.burst(e.x, e.y, 3, 80, 0x8899aa, 0.2, 2);
          break;
        case 'playerHit':
          this.burst(e.x, e.y, 10, 260, 0xffd166, 0.35, 3);
          break;
        case 'respawn':
          this.burst(e.x, e.y, 14, 120, PLAYER_COLORS[e.player] ?? 0xffffff, 0.4, 2);
          break;
        default:
          break;
      }
    }
  }

  update(dt: number): void {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      p.vy += 900 * dt;
      p.vx *= 1 - 2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  clear(): void {
    this.particles.length = 0;
  }
}
