/**
 * Boucle à pas fixe : accumulateur + rendu découplé (alpha d'interpolation).
 * La pause gèle l'accumulation sans la corrompre : à la reprise, la première frame a dt = 0,
 * donc aucun rattrapage ni bond.
 */
import { DT } from '../sim';

const MAX_FRAME_DT = 0.25; // s : au-delà (onglet en arrière-plan), on ne rattrape pas
const MAX_TICKS_PER_FRAME = 8;

export class GameLoop {
  private acc = 0;
  private last = -1;
  private _paused = false;
  /** Ticks exécutés cette seconde (mesure TPS). */
  private tickCounter = 0;
  private tickWindowStart = 0;
  tps = 0;
  private frameCounter = 0;
  private frameWindowStart = 0;
  fps = 0;
  /** Durée réelle de la dernière frame (s), 0 pendant la pause. */
  dtReal = 0;

  get paused(): boolean {
    return this._paused;
  }

  get alpha(): number {
    return this.acc / DT;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    this.last = -1;
  }

  reset(): void {
    this.acc = 0;
    this.last = -1;
  }

  /** Avance : exécute 0..N ticks via `tick`, retourne le nombre de ticks exécutés. */
  advance(nowMs: number, tick: () => void): number {
    this.frameCounter++;
    if (nowMs - this.frameWindowStart >= 1000) {
      this.fps = this.frameCounter;
      this.frameCounter = 0;
      this.frameWindowStart = nowMs;
    }
    if (this.last < 0) {
      this.last = nowMs;
      this.dtReal = 0;
      return 0;
    }
    let dt = (nowMs - this.last) / 1000;
    this.last = nowMs;
    if (this._paused) {
      this.dtReal = 0;
      return 0;
    }
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    this.dtReal = dt;
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < MAX_TICKS_PER_FRAME) {
      tick();
      this.acc -= DT;
      n++;
    }
    if (n >= MAX_TICKS_PER_FRAME && this.acc >= DT) this.acc = 0; // spirale de la mort : on lâche le retard
    this.tickCounter += n;
    if (nowMs - this.tickWindowStart >= 1000) {
      this.tps = this.tickCounter;
      this.tickCounter = 0;
      this.tickWindowStart = nowMs;
    }
    return n;
  }
}
