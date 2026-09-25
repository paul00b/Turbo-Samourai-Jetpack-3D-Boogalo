/**
 * La corde telle qu'on la voit : une chaîne de points (PBD : positions, vitesses, contraintes de
 * distance) tenue à la main du perso et, selon la phase, au grappin. La sim garde sa corde rigide
 * et déterministe ; celle-ci n'existe qu'à l'écran. Gravité et inertie : le mou pend et se tord
 * quand le perso bouge, une corde molle se pose sur les tuiles, le bout d'une corde lâchée suit la
 * corde qui rentre. Tendue (la sim tire), elle est droite, exactement comme la contrainte de la sim.
 * Pur (aucun Pixi).
 */

/** Segments de la chaîne : ~9 px d'art par segment pour la corde la plus longue. */
export const ROPE_SEGMENTS = 24;
/** Pas de la sous-intégration (s) : 2 pas par frame à 60 Hz, 1 à 144 Hz. */
const SUBSTEP = 1 / 120;
const MAX_SUBSTEPS = 4;
const ITERATIONS = 12;
/** Frottement de l'air (1/s) : le mou se calme sans devenir du caoutchouc. */
const DRAG = 1.4;
/** Vitesse le long d'une tuile gardée à chaque pas de contact (frottement). */
const GRIP = 0.55;
/** Profondeur (px d'art) sous le dessus d'une tuile d'où un point déjà enfoncé remonte se poser. */
const SKIN = 6;
/** Un bout qui saute plus loin que ça (px d'art) est téléporté : pas d'interpolation. */
const JUMP = 96;

/** Tuile pleine sous ce point (px d'art monde). */
export type SolidFn = (x: number, y: number) => boolean;

export interface RopeGround {
  solid: SolidFn;
  /** Côté d'une tuile (px d'art). */
  cell: number;
}

export class RopeChain {
  readonly n = ROPE_SEGMENTS + 1;
  readonly x = new Float64Array(this.n);
  readonly y = new Float64Array(this.n);
  private readonly vx = new Float64Array(this.n);
  private readonly vy = new Float64Array(this.n);
  private readonly ox = new Float64Array(this.n);
  private readonly oy = new Float64Array(this.n);
  /** Longueur de repos (px d'art). */
  length = 0;
  /** Tendue : droite d'un bout à l'autre (dessinée d'un seul trait). */
  taut = true;
  /** Simulée depuis le dernier reset (sinon rien à dessiner). */
  live = false;

  /** Corde droite et immobile de A à B. */
  reset(ax: number, ay: number, bx: number, by: number): void {
    const last = this.n - 1;
    for (let i = 0; i <= last; i++) {
      const s = i / last;
      this.x[i] = ax + (bx - ax) * s;
      this.y[i] = ay + (by - ay) * s;
      this.vx[i] = 0;
      this.vy[i] = 0;
    }
    this.length = Math.hypot(bx - ax, by - ay);
    this.taut = true;
    this.live = true;
  }

  /**
   * Toute la corde dans la main, le grappin sur le départ vers (dx, dy) : elle se déroule derrière
   * lui. Les points sont à peine décalés dans l'axe du tir pour que chaque segment ait une direction.
   */
  gather(ax: number, ay: number, dx: number, dy: number): void {
    const d = Math.hypot(dx, dy) || 1;
    const ux = (dx / d) * 0.01;
    const uy = (dy / d) * 0.01;
    for (let i = 0; i < this.n; i++) {
      this.x[i] = ax + ux * i;
      this.y[i] = ay + uy * i;
      this.vx[i] = 0;
      this.vy[i] = 0;
    }
    this.length = 0;
    this.taut = true;
    this.live = true;
  }

  /**
   * Avance de `dt` secondes. A (la main) est toujours tenu ; B (le grappin) l'est si `bPinned`,
   * sinon il suit la corde. `length` : longueur de repos voulue en fin de pas. Les bouts sont
   * interpolés sur les sous-pas depuis la frame précédente : un bout rapide n'arrache rien.
   */
  step(dt: number, ax: number, ay: number, bx: number, by: number, bPinned: boolean, length: number, gravity: number, ground?: RopeGround): void {
    const n = this.n;
    const last = n - 1;
    if (!this.live) this.reset(ax, ay, bx, by);
    const ax0 = this.x[0];
    const ay0 = this.y[0];
    const jumpA = Math.hypot(ax - ax0, ay - ay0) > JUMP;
    // B qui redevient tenu (nouvelle ancre) part de là où est le bout libre.
    const bx0 = this.x[last];
    const by0 = this.y[last];
    const jumpB = bPinned && Math.hypot(bx - bx0, by - by0) > JUMP;
    const len0 = this.length;
    const len1 = Math.max(0, length);
    if (dt <= 0) {
      // Pause : rien ne bouge, mais les bouts restent sur la main et l'ancre.
      this.x[0] = ax;
      this.y[0] = ay;
      if (bPinned) {
        this.x[last] = bx;
        this.y[last] = by;
      }
      return;
    }
    const sub = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / SUBSTEP - 1e-6)));
    const h = dt / sub;
    const keep = Math.max(0, 1 - DRAG * h);
    const X = this.x;
    const Y = this.y;
    const VX = this.vx;
    const VY = this.vy;
    const OX = this.ox;
    const OY = this.oy;
    for (let s = 1; s <= sub; s++) {
      const k = s / sub;
      const Ax = jumpA ? ax : ax0 + (ax - ax0) * k;
      const Ay = jumpA ? ay : ay0 + (ay - ay0) * k;
      const Bx = jumpB ? bx : bx0 + (bx - bx0) * k;
      const By = jumpB ? by : by0 + (by - by0) * k;
      const L = len0 + (len1 - len0) * k;
      // Intégration des points libres.
      for (let i = 0; i < n; i++) {
        OX[i] = X[i];
        OY[i] = Y[i];
      }
      const freeEnd = bPinned ? last - 1 : last;
      for (let i = 1; i <= freeEnd; i++) {
        VX[i] *= keep;
        VY[i] = VY[i] * keep + gravity * h;
        X[i] += VX[i] * h;
        Y[i] += VY[i] * h;
      }
      X[0] = Ax;
      Y[0] = Ay;
      if (bPinned) {
        X[last] = Bx;
        Y[last] = By;
      }
      const seg = L / last;
      const chord = bPinned ? Math.hypot(Bx - Ax, By - Ay) : 0;
      this.taut = bPinned && chord >= L - 1e-3;
      if (this.taut) {
        // Tendue : la seule forme possible est la droite (la corde de la sim ne plie pas).
        for (let i = 1; i < last; i++) {
          const t = i / last;
          X[i] = Ax + (Bx - Ax) * t;
          Y[i] = Ay + (By - Ay) * t;
        }
      } else {
        for (let it = 0; it < ITERATIONS; it++) {
          // Balayages alternés : la tension se propage dans les deux sens. Une corde ne résiste qu'à
          // l'étirement : comprimée, elle plie ou s'entasse (le mou posé au sol reste à plat).
          const fwd = (it & 1) === 0;
          for (let q = 0; q < last; q++) {
            const j = fwd ? q : last - 1 - q;
            const w0 = j === 0 ? 0 : 1;
            const w1 = j + 1 === last && bPinned ? 0 : 1;
            const w = w0 + w1;
            if (w === 0) continue;
            const dx = X[j + 1] - X[j];
            const dy = Y[j + 1] - Y[j];
            const d = Math.hypot(dx, dy);
            if (d <= seg) continue;
            const c = (d - seg) / (d * w);
            X[j] += dx * c * w0;
            Y[j] += dy * c * w0;
            X[j + 1] -= dx * c * w1;
            Y[j + 1] -= dy * c * w1;
          }
        }
        if (ground) this.collide(ground, freeEnd);
        // Attaches longues (Kim et al. 2012) : aucun point plus loin d'un bout que la corde entre
        // eux. Rend la chaîne inextensible sans itérer davantage.
        for (let i = 1; i <= freeEnd; i++) {
          tether(X, Y, i, Ax, Ay, i * seg);
          if (bPinned) tether(X, Y, i, Bx, By, (last - i) * seg);
        }
      }
      for (let i = 1; i <= freeEnd; i++) {
        VX[i] = (X[i] - OX[i]) / h;
        VY[i] = (Y[i] - OY[i]) / h;
      }
    }
    this.length = len1;
  }

  /**
   * Une corde molle se pose sur les tuiles au lieu de les traverser. Un point qui ENTRE dans une
   * tuile ce pas-ci est repoussé par la face franchie. Un point déjà dedans (la corde tendue de la
   * sim traverse les murs) ressort librement, sans que la chaîne se batte contre le décor, sauf
   * s'il est à fleur du dessus d'un sol : il y remonte (une ancre posée sur le sol, par exemple).
   * Tout se juge sur le pixel où le point est dessiné, (floor(x + 0.5), floor(y + 0.5)) : repoussé,
   * il est dessiné sur le pixel juste hors de la tuile, jamais dans sa première rangée.
   */
  private collide(g: RopeGround, freeEnd: number): void {
    const X = this.x;
    const Y = this.y;
    const eps = 0.01;
    for (let i = 1; i <= freeEnd; i++) {
      const u = X[i] + 0.5;
      const v = Y[i] + 0.5;
      if (!g.solid(u, v)) continue;
      const pu = this.ox[i] + 0.5;
      const pv = this.oy[i] + 0.5;
      const left = Math.floor(u / g.cell) * g.cell;
      const top = Math.floor(v / g.cell) * g.cell;
      const right = left + g.cell;
      const bottom = top + g.cell;
      if (g.solid(pu, pv)) {
        if (v - top <= SKIN && !g.solid(u, top - eps)) {
          Y[i] = top - eps - 0.5;
          X[i] = pu + (u - pu) * GRIP - 0.5;
        }
        continue;
      }
      // Face franchie : parmi celles du côté d'où vient le point, la moins enfoncée.
      let best = Infinity;
      let face = -1;
      if (pv <= top && v - top < best) {
        best = v - top;
        face = 0;
      }
      if (pv >= bottom && bottom - v < best) {
        best = bottom - v;
        face = 1;
      }
      if (pu <= left && u - left < best) {
        best = u - left;
        face = 2;
      }
      if (pu >= right && right - u < best) {
        best = right - u;
        face = 3;
      }
      if (face === 0 || face === 1) {
        Y[i] = (face === 0 ? top - eps : bottom + eps) - 0.5;
        X[i] = pu + (u - pu) * GRIP - 0.5;
      } else if (face >= 2) {
        X[i] = (face === 2 ? left - eps : right + eps) - 0.5;
        Y[i] = pv + (v - pv) * GRIP - 0.5;
      }
    }
  }
}

/**
 * Pixels de la corde, (x, y) à la suite dans `out` (vidé d'abord), de la main au grappin. Tendue :
 * un seul trait de Bresenham. Sinon la chaîne, pixellisée d'un seul tenant (8-connexe) et sans
 * « coins en L » : un pixel coincé entre deux voisins en diagonale est retiré (pixel perfect). Une
 * courbe d'un pixel d'épaisseur, nette à toutes les inclinaisons.
 */
export function ropePixels(c: RopeChain, out: number[]): void {
  out.length = 0;
  const last = c.n - 1;
  if (c.taut) {
    rasterize(out, c.x[0], c.y[0], c.x[last], c.y[last]);
    return;
  }
  for (let k = 0; k < last; k++) rasterize(out, c.x[k], c.y[k], c.x[k + 1], c.y[k + 1]);
  const count = out.length >> 1;
  let w = 1;
  for (let k = 1; k < count; k++) {
    const x = out[2 * k];
    const y = out[2 * k + 1];
    if (k + 1 < count) {
      const px = out[2 * w - 2];
      const py = out[2 * w - 1];
      const nx = out[2 * k + 2];
      const ny = out[2 * k + 3];
      if ((px === x || py === y) && (nx === x || ny === y) && px !== nx && py !== ny) continue;
    }
    out[2 * w] = x;
    out[2 * w + 1] = y;
    w++;
  }
  out.length = 2 * Math.min(w, count);
}

/** Pixels entiers du segment, ajoutés à `out` ; le premier est sauté s'il répète le dernier. */
function rasterize(out: number[], fx0: number, fy0: number, fx1: number, fy1: number): void {
  let x0 = Math.round(fx0);
  let y0 = Math.round(fy0);
  const x1 = Math.round(fx1);
  const y1 = Math.round(fy1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 4000; n++) {
    const len = out.length;
    if (len < 2 || out[len - 2] !== x0 || out[len - 1] !== y0) out.push(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Ramène le point i à au plus `max` de (cx, cy). */
function tether(X: Float64Array, Y: Float64Array, i: number, cx: number, cy: number, max: number): void {
  const dx = X[i] - cx;
  const dy = Y[i] - cy;
  const d = Math.hypot(dx, dy);
  if (d <= max || d < 1e-9) return;
  const k = max / d;
  X[i] = cx + dx * k;
  Y[i] = cy + dy * k;
}
