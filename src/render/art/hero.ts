/**
 * Le samouraï : pantin pixel articulé des planches (design/planches/hero.js), redessiné pixel par
 * pixel à chaque frame depuis un squelette. Ici il ne se pilote plus tout seul : il LIT l'état de
 * la sim (position, vitesse, grappins, chauffe, sol, visée). Tout ce qui est secondaire (écharpe,
 * retard des jambes, genoux, clignements, tongs) vit côté rendu : le déterminisme n'est pas touché.
 *
 * Unités : pixels d'art (1 px d'art = 2 px monde, une tuile = 16 px d'art), comme les planches.
 */
import { Buf, C, lerpC, Particles, type Color } from '../pixel/engine';
import { EMBER, FLAME, HERO_PALETTES, OUTLINE, SMOKE, type HeroPalette } from './palette';

/** Taille du calque du perso et position de son origine (le centre de la hitbox) dans ce calque. */
export const HERO_BUF = 96;
export const OX = 48;
export const OY = 54;

export const HOOK_VIEW_IDLE = 0;
export const HOOK_VIEW_FLYING = 1;
export const HOOK_VIEW_ATTACHED = 2;

export interface HeroHook {
  state: number;
  /** Ancre (accroché) ou tête du projectile (en vol), px d'art monde. */
  x: number;
  y: number;
  reeling: boolean;
  /** Mou de la corde (longueur - distance), px d'art, >= 0. */
  slack: number;
}

export interface HeroInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rayon de la hitbox en px d'art. */
  radius: number;
  grounded: boolean;
  aimX: number;
  aimY: number;
  jet: boolean;
  heat: number;
  overheated: boolean;
  hooks: [HeroHook, HeroHook];
  invuln: boolean;
  teleportSeq: number;
  /** Distance du bas de la hitbox au premier sol plein en dessous (px d'art, Infinity si loin). */
  floorGap: number;
  /** Distance du centre de la hitbox au premier plafond plein au-dessus (px d'art, Infinity si loin). */
  ceilGap: number;
  /** Points de visée dans la teinte du joueur (quand un grappin est disponible). */
  showAim: boolean;
}

export function makeHeroInput(): HeroInput {
  const hook = (): HeroHook => ({ state: HOOK_VIEW_IDLE, x: 0, y: 0, reeling: false, slack: 0 });
  return {
    x: 0, y: 0, vx: 0, vy: 0, radius: 5.5, grounded: false, aimX: 1, aimY: 0, jet: false, heat: 0,
    overheated: false, hooks: [hook(), hook()], invuln: false, teleportSeq: 0, floorGap: Infinity,
    ceilGap: Infinity, showAim: true,
  };
}

type P2 = [number, number];

interface Leg {
  hip: P2;
  k: P2;
  a: P2;
  fd: P2;
  flap: number;
}

interface Joints {
  T: (lx: number, ly: number) => P2;
  f: number;
  legF: Leg;
  legB: Leg;
  shF: P2;
  shB: P2;
  elbF: P2;
  hand: P2;
  elbB: P2;
  handB: P2;
  nozzles: [P2, P2];
}

interface ScarfPt {
  x: number;
  y: number;
  px: number;
  py: number;
}

type Mode = 'att' | 'free' | 'ground' | 'slide';

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const SCARF_N = 11;
const SCARF_SEG = 1.9;
const FIXED = 1 / 120;
/** Au-delà de cette vitesse au sol (px d'art/s) on ne marche plus, on glisse sur les tongs. */
const SLIDE_SPEED = 50;
const DUST: readonly Color[] = [C('#b9c2cc'), C('#8a939e'), C('#5a616b')];

export class HeroPuppet {
  /** Squelette dessiné (sans contour). */
  private readonly bodyBuf = new Buf(HERO_BUF, HERO_BUF);
  /** Calque final : flamme et halo du jet, corps et son double contour, points de visée. */
  readonly out = new Buf(HERO_BUF, HERO_BUF);
  readonly pal: HeroPalette;

  private t = Math.random() * 10;
  private face = 1;
  private beta = 0;
  private lag = 0;
  private lagV = 0;
  private tuck = 0.35;
  private speed = 0;
  private vx = 0;
  private flash = 0;
  private walkPhase = 0;
  private land = 0;
  private groundT = 0;
  private wasGrounded = false;
  private lastVy = 0;
  private seq = -1;
  private acc = 0;
  private scarf: ScarfPt[] = [];
  private mode: Mode = 'free';
  private jet = false;
  private heat = 0;
  private overheated = false;
  private invuln = false;
  private showAim = true;
  private aimX = 1;
  private aimY = 0;
  /** Grappin tenu par la main avant / arrière (-1 : main libre). */
  private front = -1;
  private back = -1;
  private hooks: [HeroHook, HeroHook] | null = null;
  private J: Joints | null = null;
  /** Décalage vertical du dessin (pieds posés au sol, tête sous les plafonds), px d'art. */
  offY = 0;
  /** Centre de la hitbox, px d'art monde. */
  cx = 0;
  cy = 0;
  /** Origine du squelette, arrondie au pixel (px d'art monde). */
  private ox0 = 0;
  private oy0 = 0;

  constructor(index: number) {
    this.pal = HERO_PALETTES[index] ?? HERO_PALETTES[0];
  }

  /** Coin haut-gauche du calque `out`, px d'art monde. */
  get drawX(): number {
    return this.ox0 - OX;
  }
  get drawY(): number {
    return this.oy0 - OY;
  }

  /**
   * Main qui tient le grappin h, en px d'art monde (départ de la corde). Un grappin déjà libre dans
   * la sim (corde qui rentre, raté qui revient) rejoint la main restée libre.
   */
  handFor(h: number): P2 {
    const J = this.J;
    if (!J) return [this.cx, this.cy];
    let p: P2;
    if (h === this.front) p = J.hand;
    else if (h === this.back) p = J.handB;
    else p = this.front >= 0 ? J.handB : J.hand;
    return [this.ox0 - OX + p[0], this.oy0 - OY + p[1]];
  }

  private resetScarf(x: number, y: number): void {
    this.scarf = [];
    for (let i = 0; i < SCARF_N; i++) this.scarf.push({ x: x - 1, y: y - 8 + i * 1.8, px: x - 1, py: y - 8 + i * 1.8 });
  }

  update(dt: number, inp: HeroInput, wind: number, parts: Particles): void {
    const first = this.seq < 0;
    if (inp.teleportSeq !== this.seq) {
      if (!first) this.flash = 0.3;
      this.seq = inp.teleportSeq;
      this.resetScarf(inp.x, inp.y);
      this.beta = 0;
      this.lag = 0;
      this.lagV = 0;
      this.offY = 0;
      this.wasGrounded = inp.grounded;
      this.groundT = 0;
    }
    this.cx = inp.x;
    this.cy = inp.y;
    this.hooks = inp.hooks;
    this.jet = inp.jet;
    this.heat = inp.heat;
    this.overheated = inp.overheated;
    this.invuln = inp.invuln;
    this.showAim = inp.showAim;
    this.aimX = inp.aimX;
    this.aimY = inp.aimY;
    this.vx = inp.vx;
    this.assignHands(inp);

    const attached = inp.hooks[0].state === HOOK_VIEW_ATTACHED || inp.hooks[1].state === HOOK_VIEW_ATTACHED;
    this.groundT = inp.grounded ? this.groundT + dt : 0;
    // Accroché, on ne repasse au sol qu'après un vrai contact (un frôlement du sol en swing ne
    // doit pas faire sauter les jambes d'une pose à l'autre).
    const onGround = inp.grounded && (!attached || this.groundT > 0.08);
    this.mode = onGround ? (Math.abs(inp.vx) > SLIDE_SPEED ? 'slide' : 'ground') : attached ? 'att' : 'free';
    const v = Math.hypot(inp.vx, inp.vy);
    this.speed = v;

    if (dt > 0) {
      this.t += dt;
      this.flash = Math.max(0, this.flash - dt);
      if (inp.grounded && !this.wasGrounded) this.land = clamp(Math.abs(this.lastVy) / 650, 0.25, 1);
      this.wasGrounded = inp.grounded;
      this.lastVy = inp.vy;
      this.land = Math.max(0, this.land - dt * 3.5);

      // Orientation : on regarde où l'on va, sauf à l'arrêt où l'on regarde où l'on vise.
      if (this.mode === 'ground' || v < 70) {
        if (Math.abs(inp.aimX) > 0.08) this.face = inp.aimX > 0 ? 1 : -1;
      } else if (Math.abs(inp.vx) > 25) this.face = inp.vx > 0 ? 1 : -1;

      let bt: number;
      let lagT: number;
      let tuckT: number;
      if (this.mode === 'att') {
        let sx = 0;
        let sy = 0;
        let om = 0;
        for (const hk of inp.hooks) {
          if (hk.state !== HOOK_VIEW_ATTACHED) continue;
          const rx = inp.x - hk.x;
          const ry = inp.y - hk.y;
          const d = Math.hypot(rx, ry) || 1;
          sx -= rx / d;
          sy -= ry / d;
          om += (rx * inp.vy - ry * inp.vx) / Math.max(1, rx * rx + ry * ry);
        }
        bt = Math.atan2(sx, -sy);
        lagT = clamp(-om * 0.35, -0.9, 0.9);
        tuckT = 0.15 + 0.75 * (1 - clamp(v / 300, 0, 1));
      } else if (this.mode === 'ground') {
        bt = clamp(inp.vx / 900, -0.08, 0.08);
        lagT = 0;
        tuckT = 0.04 + this.land * 0.75;
      } else if (this.mode === 'slide') {
        // Surf sur les tongs : on se penche en arrière, genoux fléchis.
        bt = -Math.sign(inp.vx) * clamp(Math.abs(inp.vx) / 1400, 0.08, 0.28);
        lagT = 0;
        tuckT = 0.45 + this.land * 0.4;
      } else {
        bt = clamp(inp.vx / 800, -0.45, 0.45) + (inp.jet ? inp.aimX * 0.3 : 0);
        lagT = clamp(-inp.vx / 700, -0.7, 0.7);
        tuckT = inp.jet ? 0.55 : 0.35;
      }
      // Pas fixe : le ressort des jambes reste stable quel que soit le framerate.
      this.acc = Math.min(this.acc + dt, 0.1);
      while (this.acc >= FIXED) {
        this.acc -= FIXED;
        this.beta += (bt - this.beta) * Math.min(1, FIXED * (this.mode === 'att' ? 18 : 8));
        this.lagV += ((lagT - this.lag) * 70 - this.lagV * 9) * FIXED;
        this.lag += this.lagV * FIXED;
        this.tuck += (tuckT - this.tuck) * Math.min(1, FIXED * 14);
      }
      if (this.mode === 'ground' && Math.abs(inp.vx) > 3) this.walkPhase += Math.abs(inp.vx) * dt * (Math.PI / 5.5);
    }

    const J = this.pose();
    this.placeVertically(J, inp, dt);
    this.ox0 = Math.round(this.cx);
    this.oy0 = Math.round(this.cy + this.offY);

    if (dt > 0) {
      this.updateScarf(dt, wind);
      this.emit(J, parts);
    }
  }

  /** Répartit les grappins actifs entre la main avant et la main arrière (stable d'une frame à l'autre). */
  private assignHands(inp: HeroInput): void {
    const a = inp.hooks[0].state !== HOOK_VIEW_IDLE;
    const b = inp.hooks[1].state !== HOOK_VIEW_IDLE;
    if (a && b) {
      if (this.front >= 0 && this.back >= 0 && this.front !== this.back) return;
      const fa = (inp.hooks[0].x - inp.x) * this.face;
      const fb = (inp.hooks[1].x - inp.x) * this.face;
      this.front = fa >= fb ? 0 : 1;
      this.back = 1 - this.front;
    } else if (a || b) {
      this.front = a ? 0 : 1;
      this.back = -1;
    } else {
      this.front = -1;
      this.back = -1;
    }
  }

  /**
   * Pieds posés : le dessin remonte dès que le sol approche (continu, sans à-coup) et redescend en
   * douceur quand il s'éloigne. En l'air sous un plafond, la tête passe avant les pieds.
   */
  private placeVertically(J: Joints, inp: HeroInput, dt: number): void {
    let foot = -Infinity;
    for (const L of [J.legF, J.legB]) foot = Math.max(foot, L.a[1] - OY + 1.5);
    const head = J.T(0, -14.6)[1] - OY;
    let target = 0;
    if (Number.isFinite(inp.floorGap)) target = Math.min(0, inp.floorGap + inp.radius - foot);
    if (Number.isFinite(inp.ceilGap) && this.mode === 'free') {
      const minOff = -inp.ceilGap - head;
      if (target < minOff) target = Math.min(0, minOff);
    }
    if (target < this.offY || dt <= 0) this.offY = target;
    else this.offY = Math.min(target, this.offY + dt * 70);
  }

  private updateScarf(dt: number, levelWind: number): void {
    const sc = this.scarf;
    if (sc.length === 0) this.resetScarf(this.cx, this.cy);
    // Le vent du niveau fait flotter l'écharpe DERRIÈRE le perso (à l'arrêt, elle ne doit pas lui
    // passer devant le torse) ; en vitesse, c'est la traînée de la chaîne qui domine de toute façon.
    const wind = -this.face * Math.abs(levelWind) + levelWind * 0.25;
    const nx = this.cx + 7.5 * Math.sin(this.beta) - this.face * 0.8 * Math.cos(this.beta);
    const ny = this.cy + this.offY - 7.5 * Math.cos(this.beta);
    const ax0 = sc[0].x;
    const ay0 = sc[0].y;
    // Sous-pas quand l'ancre file : l'écharpe traîne derrière au lieu de s'étirer.
    const move = Math.hypot(nx - ax0, ny - ay0);
    const n = Math.min(8, Math.max(1, Math.ceil(move / 3), Math.ceil(dt * 60 - 0.01)));
    const h = dt / n;
    const damp = Math.pow(0.92, h * 60);
    for (let s = 1; s <= n; s++) {
      sc[0].x = ax0 + ((nx - ax0) * s) / n;
      sc[0].y = ay0 + ((ny - ay0) * s) / n;
      sc[0].px = sc[0].x;
      sc[0].py = sc[0].y;
      for (let i = 1; i < sc.length; i++) {
        const p = sc[i];
        const vx = (p.x - p.px) * damp;
        const vy = (p.y - p.py) * damp;
        p.px = p.x;
        p.py = p.y;
        p.x += vx + (wind + Math.sin(this.t * 7 + i) * 18) * 4 * h * h;
        p.y += vy + 180 * h * h;
      }
      for (let it = 0; it < 4; it++) {
        for (let i = 1; i < sc.length; i++) {
          const a = sc[i - 1];
          const b = sc[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const k = (d - SCARF_SEG) / d;
          if (i === 1) {
            b.x -= dx * k;
            b.y -= dy * k;
          } else {
            a.x += dx * k * 0.5;
            a.y += dy * k * 0.5;
            b.x -= dx * k * 0.5;
            b.y -= dy * k * 0.5;
          }
        }
      }
    }
  }

  private emit(J: Joints, parts: Particles): void {
    const wx = (p: P2): P2 => [this.ox0 - OX + p[0], this.oy0 - OY + p[1]];
    if (this.jet) {
      for (const nz of J.nozzles) {
        const [x, y] = wx(nz);
        parts.spawn(x, y, -this.aimX * 90 + (Math.random() - 0.5) * 40, -this.aimY * 90 + (Math.random() - 0.5) * 40, 0.4, EMBER, 80, 1);
        if (Math.random() < 0.4) parts.spawn(x, y, -this.aimX * 40, -this.aimY * 40 - 10, 0.8, SMOKE, -30, 1.5, 2);
      }
    }
    if (this.overheated && Math.random() < 0.3) {
      const [x, y] = wx(J.nozzles[0]);
      parts.spawn(x, y, (Math.random() - 0.5) * 20, -30, 0.9, SMOKE, -20, 1, 2);
    }
    if (this.mode === 'slide' && Math.random() < 0.6) {
      const L = Math.random() < 0.5 ? J.legF : J.legB;
      const [x, y] = wx(L.a);
      parts.spawn(x, y + 1, -this.vx * 0.15 + (Math.random() - 0.5) * 20, -10 - Math.random() * 25, 0.35, DUST, 120, 3, 1);
    }
  }

  // ------------------------------------------------------------------ pantin

  private pose(): Joints {
    const f = this.face;
    const b = this.beta;
    const cB = Math.cos(b);
    const sB = Math.sin(b);
    const t = this.t;
    const T = (lx: number, ly: number): P2 => {
      const x = lx * f;
      return [OX + x * cB - ly * sB, OY + x * sB + ly * cB];
    };
    const rot = (ang: number): P2 => [Math.sin(b + ang * f), Math.cos(b + ang * f)];
    const leg = (hip: P2, phi: number, kappa: number, flap: number): Leg => {
      const d1 = rot(phi);
      const k: P2 = [hip[0] + d1[0] * 4.6, hip[1] + d1[1] * 4.6];
      const d2 = rot(phi - kappa);
      const a: P2 = [k[0] + d2[0] * 4.6, k[1] + d2[1] * 4.6];
      const fd = rot(phi - kappa + Math.PI / 2);
      return { hip, k, a, fd, flap };
    };
    const tuck = this.tuck;
    const lag = this.lag * f;
    const flapAir = 0.2 + Math.sin(t * 11) * clamp(this.speed / 350, 0, 1) * 0.6;
    let legF: Leg;
    let legB: Leg;
    if (this.mode === 'ground') {
      // Deux pieds sous les hanches ; en marche, pas traînant et tongs qui claquent au lever du pied.
      const walking = this.speed > 3;
      const w = this.walkPhase;
      const amp = walking ? 0.3 : 0;
      const sw = Math.sin(w);
      const cw = Math.cos(w);
      const liftF = walking ? Math.max(0, cw) : 0;
      const liftB = walking ? Math.max(0, -cw) : 0;
      legF = leg(T(1, 1.5), 0.06 + sw * amp + tuck * 0.9, 0.08 + tuck * 1.5 + liftF * 0.7, 0.05 + liftF * 0.7);
      legB = leg(T(-1, 1.5), -0.1 - sw * amp + tuck * 0.35, 0.12 + tuck * 1.1 + liftB * 0.7, 0.05 + liftB * 0.7);
    } else if (this.mode === 'slide') {
      // Jambe avant tendue dans le sens de la glisse, jambe arrière repliée.
      const s = Math.sin(t * 30) * 0.03;
      const dir = Math.sign(this.vx) * f;
      legF = leg(T(1, 1.5), 0.55 * dir + s + tuck * 0.3, 0.15 + tuck * 0.5, 0.05);
      legB = leg(T(-1, 1.5), -0.35 * dir - s + tuck * 0.3, 0.3 + tuck * 1.3, 0.05);
    } else {
      const pedal = this.mode === 'free' && !this.jet ? Math.sin(t * 14) * 0.45 : 0;
      legF = leg(T(1, 1.5), 0.25 + lag + tuck * 0.9 + pedal, tuck * 1.5, flapAir);
      legB = leg(T(-1, 1.5), -0.2 + lag * 0.7 + tuck * 0.35 - pedal, 0.3 + tuck * 1.1, flapAir);
    }
    const shF = T(1.6, -6.4);
    const shB = T(-1.6, -6.4);
    const hooks = this.hooks;
    const target = (h: number): P2 | null => {
      if (!hooks || h < 0) return null;
      const hk = hooks[h];
      if (hk.state === HOOK_VIEW_IDLE) return null;
      return [hk.x - (this.ox0 - OX), hk.y - (this.oy0 - OY)];
    };
    const aimPoint = (sh: P2): P2 => [sh[0] + this.aimX * 12, sh[1] + this.aimY * 12];
    const ik = (sh: P2, aim: P2, reachMax: number, seg: number, side: number): [P2, P2] => {
      const dx = aim[0] - sh[0];
      const dy = aim[1] - sh[1];
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(d, reachMax);
      const ux = dx / d;
      const uy = dy / d;
      const hand: P2 = [sh[0] + ux * reach, sh[1] + uy * reach];
      const bend = Math.sqrt(Math.max(0, seg * seg - (reach / 2) * (reach / 2)));
      const elb: P2 = [(sh[0] + hand[0]) / 2 - uy * bend * side, (sh[1] + hand[1]) / 2 + ux * bend * side];
      return [elb, hand];
    };
    // Main avant : sur sa corde, sinon elle vise. Main arrière : sur sa corde, elle vise si la main
    // avant est prise et qu'un grappin reste libre, sinon elle pend comme dans les planches.
    const tf = target(this.front);
    const [elbF, hand] = ik(shF, tf ?? aimPoint(shF), 7.4, 3.7, f);
    let elbB: P2;
    let handB: P2;
    const tb = target(this.back);
    if (tb || (this.front >= 0 && this.oneHookFree())) {
      [elbB, handB] = ik(shB, tb ?? aimPoint(shB), 7, 3.5, f);
    } else {
      const idle = this.mode === 'ground' || this.mode === 'slide';
      const hang = this.mode === 'att' ? -this.lag * 0.8 - f * 0.35 : -f * 0.9 + Math.sin(t * 9) * (idle ? 0.05 : 0.25);
      const bd: P2 = [Math.sin(hang), Math.cos(hang)];
      elbB = [shB[0] + bd[0] * 3.6, shB[1] + bd[1] * 3.6];
      handB = [elbB[0] + Math.sin(hang - f * 0.5) * 3.4, elbB[1] + Math.cos(hang - f * 0.5) * 3.4];
    }
    const J: Joints = { T, f, legF, legB, shF, shB, elbF, hand, elbB, handB, nozzles: [T(-6, 1.2), T(-4, 1.2)] };
    this.J = J;
    return J;
  }

  private oneHookFree(): boolean {
    const hooks = this.hooks;
    if (!hooks) return false;
    return hooks[0].state === HOOK_VIEW_IDLE || hooks[1].state === HOOK_VIEW_IDLE;
  }

  private drawBody(o: Buf, J: Joints, rim: Color | null, dx: number, dy: number): void {
    const P = this.pal;
    const c = (col: Color): Color => (rim === null ? col : rim);
    const T = (lx: number, ly: number): P2 => {
      const p = J.T(lx, ly);
      return [p[0] + dx, p[1] + dy];
    };
    const S = (p: P2): P2 => [p[0] + dx, p[1] + dy];
    const poly = (pts: readonly P2[], col: Color): void => o.poly(pts.flatMap(([x, y]) => T(x, y)), c(col));
    const drawLeg = (L: Leg, thigh: Color, shin: Color): void => {
      const h = S(L.hip);
      const k = S(L.k);
      const a = S(L.a);
      o.stroke(h[0], h[1], k[0], k[1], 3, c(thigh));
      o.stroke(k[0], k[1], a[0], a[1], 2, c(shin));
      const toe: P2 = [a[0] + L.fd[0] * 2.2, a[1] + L.fd[1] * 2.2];
      o.stroke(a[0], a[1], toe[0], toe[1], 1, c(P.skin));
      const fl = -L.flap * J.f;
      const cs = Math.cos(fl);
      const sn = Math.sin(fl);
      const sx = L.fd[0] * cs - L.fd[1] * sn;
      const sy = L.fd[0] * sn + L.fd[1] * cs;
      o.stroke(toe[0] + 0.5, toe[1] + 1, toe[0] - sx * 4 + 0.5, toe[1] - sy * 4 + 1, 1, c(P.sole));
      o.px(a[0] + L.fd[0], a[1] + L.fd[1], c(P.strap));
    };
    const ox = this.ox0 - OX;
    const oy = this.oy0 - OY;
    const scarf = this.scarf;
    for (let i = 1; i < scarf.length; i++) {
      const p0: P2 = [scarf[i - 1].x - ox + dx, scarf[i - 1].y - oy + dy];
      const p1: P2 = [scarf[i].x - ox + dx, scarf[i].y - oy + dy];
      o.stroke(p0[0], p0[1], p1[0], p1[1], i < 7 ? 2 : 1, c(i < 7 ? P.scarf : P.scarfDk));
      if (i < 5 && rim === null) o.px(p0[0], p0[1] - 1, P.scarfHi);
    }
    const eB = S(J.elbB);
    const hB = S(J.handB);
    const sB = S(J.shB);
    o.stroke(sB[0], sB[1], eB[0], eB[1], 2, c(P.sleeveDk));
    o.stroke(eB[0], eB[1], hB[0], hB[1], 2, c(P.glove));
    drawLeg(J.legB, P.hakDk, P.hakDk);
    const ts = [T(-5.8, -13.2), T(-4.2, -10)];
    for (let i = 0; i <= 4; i++) o.px(ts[0][0] + ((ts[1][0] - ts[0][0]) * i) / 4, ts[0][1] + ((ts[1][1] - ts[0][1]) * i) / 4, c(i & 1 ? P.tsB : P.tsA));
    const sa = [T(-3.8, -9.4), T(2.8, 3.2)];
    o.stroke(sa[0][0], sa[0][1], sa[1][0], sa[1][1], 1, c(P.saya));
    const tb = T(-4, -9.7);
    o.px(tb[0], tb[1], c(P.gold));
    const heat = this.heat;
    const blink = this.overheated && Math.sin(this.t * 20) > 0;
    const packC = blink ? P.hot : lerpC(P.pack, P.hot, heat * heat * 0.7);
    poly([[-7.2, -7.6], [-3, -7.6], [-3, 0.2], [-7, 0.2]], packC);
    if (rim === null) {
      const hi = [T(-6.6, -7), T(-6.6, -1)];
      o.stroke(hi[0][0], hi[0][1], hi[1][0], hi[1][1], 1, P.packHi);
      for (const nz of J.nozzles) o.rect(nz[0] + dx - 0.5, nz[1] + dy - 0.5, 2, 2, P.nozzle);
    }
    poly([[-3, -7.6], [3, -7.6], [2.6, 0.2], [-2.6, 0.2]], P.armor);
    poly([[-4.2, -8], [-1.4, -8], [-1.4, -4], [-4.6, -4.6]], P.armorDk);
    if (rim === null) {
      for (const ly of [-5.6, -3.6, -1.6]) {
        for (let lx = -2; lx <= 2; lx++) {
          if (((lx + 3) & 1) === 0) {
            const p = T(lx, ly);
            o.px(p[0], p[1], P.lace);
          }
        }
      }
      const e = [T(2, -6.8), T(2.2, -1)];
      o.stroke(e[0][0], e[0][1], e[1][0], e[1][1], 1, P.armorHi);
    }
    const ob = [T(-2.8, 0.6), T(2.8, 0.6)];
    o.stroke(ob[0][0], ob[0][1], ob[1][0], ob[1][1], 2, c(P.obi));
    poly([[-3.2, 1.6], [3.2, 1.6], [4, 4.6], [-4, 4.6]], P.armor);
    if (rim === null) {
      for (const lx of [-1.2, 1.2]) {
        const a = T(lx, 1.9);
        const bb = T(lx * 1.2, 4.3);
        o.stroke(a[0], a[1], bb[0], bb[1], 1, P.armorDk);
      }
    }
    poly([[-4.8, -10.2], [-1, -10.2], [-1.6, -7.4], [-5.6, -8]], P.helm);
    poly([[0.4, -10.2], [3.3, -10.2], [3.1, -7.6], [0.4, -7.6]], P.skin);
    poly([[-3.6, -10], [-3.1, -13.2], [-1.1, -14.6], [1.6, -14.6], [3.3, -13.1], [3.6, -10.4]], P.helm);
    const br = [T(-4.6, -10.2), T(4.1, -10.2)];
    o.stroke(br[0][0], br[0][1], br[1][0], br[1][1], 1, c(P.helmHi));
    const crest = [T(0.8, -14.3), T(3.6, -17.8), T(-1.9, -17.4)];
    o.stroke(crest[0][0], crest[0][1], crest[1][0], crest[1][1], 1, c(P.gold));
    o.stroke(crest[0][0], crest[0][1], crest[2][0], crest[2][1], 1, c(P.gold));
    if (rim === null) {
      const blinkEye = this.t % 3.3 < 0.11;
      const ey = T(2.3, -9.2);
      o.px(ey[0], ey[1], blinkEye ? P.skin : P.eye);
      const m = [T(1.2, -8.2), T(3, -8.2)];
      o.stroke(m[0][0], m[0][1], m[1][0], m[1][1], 1, P.lace);
      const kn = T(0.6, -7.2);
      o.px(kn[0], kn[1], P.scarf);
      o.px(kn[0] + 1, kn[1], P.scarfHi);
    }
    drawLeg(J.legF, P.hak, P.hak);
    const sF = S(J.shF);
    const eF = S(J.elbF);
    const hF = S(J.hand);
    o.stroke(sF[0], sF[1], eF[0], eF[1], 2, c(P.sleeve));
    o.stroke(eF[0], eF[1], hF[0], hF[1], 2, c(P.glove));
    poly([[0.2, -8.2], [3.8, -8.2], [4, -5], [0.6, -5]], P.armor);
    if (rim === null) {
      const s1 = T(1, -7);
      const s2 = T(3, -7);
      o.px(s1[0], s1[1], P.lace);
      o.px(s2[0], s2[1], P.lace);
    }
  }

  /** Dessine le perso dans `out` : flamme et halo du jet derrière, corps contouré, visée devant. */
  draw(rim: Color, time: number): void {
    const J = this.J ?? this.pose();
    const out = this.out;
    out.clear();
    if (this.jet) {
      const fx = -this.aimX;
      const fy = -this.aimY;
      for (const nz of J.nozzles) {
        const nx = nz[0];
        const ny = nz[1];
        out.glowA(nx, ny + 2, 12, FLAME[2], 0.4);
        const len = 6 + Math.floor((Math.sin(this.t * 47 + nx) * 0.5 + 0.5) * 5);
        for (let k = 0; k <= len; k++) {
          const q = k / len;
          const ci = q < 0.2 ? 0 : q < 0.45 ? 1 : q < 0.8 ? 2 : 3;
          const px = nx + fx * k;
          const py = ny + fy * k;
          out.px(px, py, FLAME[ci]);
          if (q < 0.55) out.px(px - fy, py + fx, FLAME[Math.min(3, ci + 1)]);
        }
      }
    }
    const o = this.bodyBuf;
    o.clear();
    this.drawBody(o, J, rim, -1, -1);
    this.drawBody(o, J, null, 0, 0);
    const white = this.pal.white;
    const flashing = (this.flash > 0 && Math.sin(this.flash * 60) > 0) || (this.invuln && Math.floor(time * 20) % 2 === 0);
    if (flashing) for (let i = 0; i < o.d.length; i++) if (o.d[i]) o.d[i] = white;
    out.outlineBlit(o, 0, 0, OUTLINE, true);
    if (this.showAim && this.oneHookFree()) this.drawAim(J);
  }

  /** Trois points de visée dans la teinte du joueur, chacun avec une ombre d'un pixel. */
  private drawAim(J: Joints): void {
    const out = this.out;
    const from = this.front >= 0 ? J.handB : J.hand;
    for (const d of [6, 10, 14]) {
      const x = Math.round(from[0] + this.aimX * d);
      const y = Math.round(from[1] + this.aimY * d);
      out.px(x + 1, y + 1, OUTLINE);
      out.px(x, y, d === 6 ? this.pal.scarfHi : this.pal.scarf);
    }
  }
}
