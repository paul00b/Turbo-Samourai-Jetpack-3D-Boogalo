/**
 * Animation des cordes, d'après les planches (design/planches/hero.js) :
 *   - le grappin VOLE de la main jusqu'à l'ancre (HOOK_V = 1700 px d'art/s), pointe blanche et pixel
 *     de traîne, et fait des étincelles en arrivant ;
 *   - accrochée, la corde est en chanvre, passe au cyan (la teinte du joueur) pendant qu'elle se
 *     rétracte vraiment, et pend quand elle est molle ;
 * plus deux gestes absents des planches : un raté file jusqu'au point touché puis revient, et une
 * corde lâchée rentre dans la main.
 *
 * La forme de la corde est une vraie petite physique (ropeChain.ts) : droite derrière le grappin qui
 * la tire et quand la sim la tend, elle pend et se tord quand elle a du mou, se pose sur les tuiles,
 * et son bout libre suit la corde qui rentre.
 *
 * Dans la sim le projectile arrive quasi instantanément (hookSpeed) et la physique est accrochée dès
 * ce tick : l'envol est une animation de rendu de quelques centièmes de seconde. Pur (aucun Pixi).
 */
import { HOOK_ATTACHED, type GameState, type HookState, type SimEvent } from '../../sim';
import { RopeChain, type RopeGround } from './ropeChain';

export type RopePhase = 'none' | 'throw' | 'hold' | 'retract' | 'miss';

/** Vitesse du grappin à l'écran, celle des planches (px d'art/s). */
export const THROW_SPEED = 1700;
/** Corde lâchée : vitesse à laquelle la main la ravale (px d'art/s). */
export const RETRACT_SPEED = 2000;
/** Retour d'un raté vers la main (s). */
export const MISS_BACK = 0.1;
/**
 * Mou de la sim ignoré à l'écran (px d'art) : l'interpolation entre deux ticks rapproche un peu le
 * perso de l'ancre en plein swing, la corde ne doit pas trembler pour autant.
 */
export const TAUT_TOLERANCE = 0.75;

export interface RopeFx {
  phase: RopePhase;
  /** Temps écoulé dans la phase (s). */
  t: number;
  /** Durée du vol (throw, miss) ou du retour (retract). */
  dur: number;
  /** Cible du vol : ancre ou point raté (px d'art monde). */
  tx: number;
  ty: number;
  /** Joueur visé (ancre mobile), -1 pour le décor. */
  target: number;
  /** Point d'où la corde rentre (dernière ancre tenue, ou point raté). */
  fromX: number;
  fromY: number;
  /** Étincelles déjà tirées pour ce vol. */
  landed: boolean;
  /** La forme de la corde. */
  readonly chain: RopeChain;
  /** Longueur de corde au début du retour (px d'art). */
  len0: number;
  /** Nouveau tir : la corde repart de la main. */
  restart: boolean;
}

function makeFx(): RopeFx {
  return { phase: 'none', t: 0, dur: 0, tx: 0, ty: 0, target: -1, fromX: 0, fromY: 0, landed: false, chain: new RopeChain(), len0: 0, restart: false };
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Durée du vol pour une distance main -> cible en px d'art (bornée : lisible de près, vif de loin). */
export function throwDuration(artDist: number): number {
  return clamp(artDist / THROW_SPEED, 0.035, 0.14);
}

export function retractDuration(artDist: number): number {
  return clamp(artDist / RETRACT_SPEED, 0.06, 0.14);
}

/** Point courant d'un segment parcouru à vitesse constante (le grappin des planches est linéaire). */
export function along(x0: number, y0: number, x1: number, y1: number, p: number): [number, number] {
  const k = clamp(p, 0, 1);
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
}

export type LandFn = (x: number, y: number, miss: boolean) => void;

/** Ce que la corde voit du monde. Sans lui (tests), elle part du centre du perso, sans sol. */
export interface RopeContext {
  /** Main qui tient la corde de ce grappin (px d'art monde). */
  hand(player: number, hook: number): readonly [number, number];
  /** Gravité (px d'art/s²). */
  gravity: number;
  ground?: RopeGround;
}

export class RopeBank {
  /** [joueur][grappin] */
  readonly fx: RopeFx[][] = [
    [makeFx(), makeFx()],
    [makeFx(), makeFx()],
  ];

  /**
   * Événements de la sim (positions en px monde, `scale` px monde par px d'art). `fromX/fromY` : le
   * perso qui tire (px d'art), pour la durée du vol.
   */
  handleEvent(e: SimEvent, fromX: number, fromY: number, scale: number): void {
    if (e.player < 0 || e.player > 1) return;
    if (e.type === 'respawn' || e.type === 'death') {
      // Téléporté : aucune corde ne doit traverser la carte jusqu'au spawn.
      for (const r of this.fx[e.player]) this.stop(r);
      return;
    }
    if (e.hook !== 0 && e.hook !== 1) return;
    const r = this.fx[e.player][e.hook];
    const x = e.x / scale;
    const y = e.y / scale;
    switch (e.type) {
      case 'hookHit':
      case 'hookMiss':
        r.phase = e.type === 'hookHit' ? 'throw' : 'miss';
        r.t = 0;
        r.tx = x;
        r.ty = y;
        r.target = e.type === 'hookHit' && e.value === 1 ? 1 - e.player : -1;
        r.dur = throwDuration(Math.hypot(x - fromX, y - fromY));
        r.landed = false;
        r.fromX = x;
        r.fromY = y;
        r.restart = true;
        break;
      case 'hookDetach':
        if (r.phase === 'hold' || r.phase === 'throw') this.retract(r, fromX, fromY);
        break;
      default:
        break;
    }
  }

  private retract(r: RopeFx, handX: number, handY: number): void {
    r.phase = 'retract';
    r.t = 0;
    r.dur = retractDuration(Math.hypot(r.fromX - handX, r.fromY - handY));
    r.len0 = r.chain.live ? r.chain.length : Math.hypot(r.fromX - handX, r.fromY - handY);
  }

  private stop(r: RopeFx): void {
    r.phase = 'none';
    r.chain.live = false;
  }

  /**
   * Avance les animations et les recale sur l'état de la sim (un rollback peut accrocher ou lâcher
   * sans événement), puis la forme des cordes. `dt` = temps de jeu (0 en pause). `onLand` : le
   * grappin touche (étincelles).
   */
  update(dt: number, state: GameState, poses: readonly { x: number; y: number }[], scale: number, onLand: LandFn, ctx?: RopeContext): void {
    for (let i = 0; i < 2; i++) {
      const active = i < state.playerCount;
      for (let h = 0; h < 2; h++) {
        const r = this.fx[i][h];
        if (!active) {
          this.stop(r);
          continue;
        }
        const hk = state.players[i].hooks[h];
        const attached = hk.state === HOOK_ATTACHED;
        if (attached) {
          const ax = (hk.target >= 0 ? poses[hk.target].x : hk.x) / scale;
          const ay = (hk.target >= 0 ? poses[hk.target].y : hk.y) / scale;
          r.fromX = ax;
          r.fromY = ay;
          // Ancre mobile (l'autre joueur) : le grappin le suit pendant son vol.
          if (r.phase === 'throw') {
            r.tx = ax;
            r.ty = ay;
          }
        }
        r.t += dt;
        switch (r.phase) {
          case 'throw':
            if (r.t >= r.dur) {
              if (!r.landed) {
                r.landed = true;
                onLand(r.tx, r.ty, false);
              }
              r.phase = attached ? 'hold' : 'none';
            }
            break;
          case 'miss':
            if (!r.landed && r.t >= r.dur) {
              r.landed = true;
              r.len0 = r.chain.live ? r.chain.length : 0;
              onLand(r.tx, r.ty, true);
            }
            if (r.t >= r.dur + MISS_BACK) r.phase = 'none';
            break;
          case 'retract':
            if (r.t >= r.dur) r.phase = 'none';
            break;
          default:
            break;
        }
        const [hx, hy] = ctx ? ctx.hand(i, h) : [poses[i].x / scale, poses[i].y / scale];
        // Recalage : accroché sans vol en cours -> tenu ; tenu alors que la sim a lâché -> retour.
        if (attached && r.phase !== 'throw' && r.phase !== 'hold') r.phase = 'hold';
        else if (!attached && r.phase === 'hold') this.retract(r, hx, hy);
        this.shape(r, hk, dt, hx, hy, poses[i], scale, poses, ctx);
      }
    }
  }

  /** La forme de la corde pour la phase courante : quels bouts sont tenus, quelle longueur. */
  private shape(
    r: RopeFx,
    hk: HookState,
    dt: number,
    hx: number,
    hy: number,
    body: { x: number; y: number },
    scale: number,
    poses: readonly { x: number; y: number }[],
    ctx?: RopeContext,
  ): void {
    const c = r.chain;
    const g = ctx?.gravity ?? 900;
    const ground = ctx?.ground;
    if (r.phase === 'none') {
      c.live = false;
      return;
    }
    if (r.restart) {
      r.restart = false;
      c.gather(hx, hy, r.tx - hx, r.ty - hy);
    }
    const flying = r.phase === 'throw' || (r.phase === 'miss' && r.t < r.dur);
    if (flying) {
      // Le grappin tire la corde hors de la main : elle file droit derrière lui (planches).
      const [bx, by] = along(hx, hy, r.tx, r.ty, r.t / r.dur);
      c.step(dt, hx, hy, bx, by, true, Math.hypot(bx - hx, by - hy), g, ground);
      return;
    }
    if (r.phase === 'hold') {
      const ax = hk.target >= 0 ? poses[hk.target].x / scale : hk.x / scale;
      const ay = hk.target >= 0 ? poses[hk.target].y / scale : hk.y / scale;
      if (!c.live) c.reset(hx, hy, ax, ay);
      // Le mou vient de la sim (sa corde part du centre du perso) : la main, plus près ou plus loin
      // de l'ancre selon le bras, ne doit pas en inventer. Tendue dans la sim, droite à l'écran.
      const slack = (hk.length - Math.hypot(body.x - ax * scale, body.y - ay * scale)) / scale - TAUT_TOLERANCE;
      c.step(dt, hx, hy, ax, ay, true, Math.hypot(ax - hx, ay - hy) + Math.max(0, slack), g, ground);
      return;
    }
    // Retour (lâchée, ou raté qui revient) : le bout est libre et suit la corde que la main ravale.
    const back = clamp(r.phase === 'retract' ? r.t / r.dur : (r.t - r.dur) / MISS_BACK, 0, 1);
    const left = r.len0 * (1 - back);
    if (!c.live) c.reset(hx, hy, r.fromX, r.fromY);
    c.step(dt, hx, hy, 0, 0, false, left, g, ground);
  }

  clear(): void {
    for (const row of this.fx) for (const r of row) this.stop(r);
  }
}
