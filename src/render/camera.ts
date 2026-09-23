/** Caméra 2D lissée, bornée au niveau. Le lissage utilise le temps réel : c'est du rendu, pas de la sim. */
export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LevelBounds {
  w: number;
  h: number;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  private initialized = false;

  snap(x: number, y: number, zoom: number): void {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.initialized = true;
  }

  reset(): void {
    this.initialized = false;
  }

  follow(tx: number, ty: number, tzoom: number, dt: number, smoothing: number, vp: Viewport, bounds: LevelBounds): void {
    if (!this.initialized) {
      this.snap(tx, ty, tzoom);
    } else {
      const k = 1 - Math.exp(-dt * smoothing);
      this.zoom += (tzoom - this.zoom) * k;
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    // Bornes : on ne montre pas l'extérieur du niveau si la vue est plus petite que lui.
    const halfW = vp.w / (2 * this.zoom);
    const halfH = vp.h / (2 * this.zoom);
    this.x = halfW * 2 >= bounds.w ? bounds.w / 2 : clamp(this.x, halfW, bounds.w - halfW);
    this.y = halfH * 2 >= bounds.h ? bounds.h / 2 : clamp(this.y, halfH, bounds.h - halfH);
  }

  screenToWorld(sx: number, sy: number, vp: Viewport, out: { x: number; y: number }): void {
    out.x = this.x + (sx - (vp.x + vp.w / 2)) / this.zoom;
    out.y = this.y + (sy - (vp.y + vp.h / 2)) / this.zoom;
  }
}

export function fitZoom(bw: number, bh: number, vp: Viewport, margin: number, zoomMin: number, zoomMax: number): number {
  const zx = vp.w / Math.max(1, bw + margin * 2);
  const zy = vp.h / Math.max(1, bh + margin * 2);
  return clamp(Math.min(zx, zy), zoomMin, zoomMax);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
