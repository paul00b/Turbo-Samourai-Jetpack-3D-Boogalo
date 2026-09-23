/**
 * Sons synthétisés (oscillateurs, bruit filtré, enveloppes). Aucun fichier audio.
 * - one-shots déclenchés par les événements de la sim (handleEvents)
 * - boucles (reel, jetpack) dont l'activation vient des événements et la modulation de l'état
 */
import type { GameState, SimEvent } from '../../sim';
import type { AudioEngine } from './audioEngine';

interface Loop {
  gain: GainNode;
  filter: BiquadFilterNode;
  osc?: OscillatorNode;
  osc2?: OscillatorNode;
  noise?: AudioBufferSourceNode;
  active: boolean;
  level: number;
}

export class Sfx {
  private reelLoops: (Loop | null)[] = [null, null];
  private jetLoops: (Loop | null)[] = [null, null];
  private lastOverheatBeep = 0;

  constructor(private readonly engine: AudioEngine) {}

  private get ctx(): AudioContext | null {
    return this.engine.unlocked ? this.engine.ctx : null;
  }

  private out(): AudioNode | null {
    return this.engine.sfx;
  }

  // ------------------------------------------------------------------ primitives

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    opts: { attack?: number; filter?: number; delay?: number; detune?: number } = {},
  ): void {
    const ctx = this.ctx;
    const out = this.out();
    if (!ctx || !out) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = osc;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.filter;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noiseBurst(
    dur: number,
    gain: number,
    opts: { type?: BiquadFilterType; f0?: number; f1?: number; q?: number; attack?: number; delay?: number } = {},
  ): void {
    const ctx = this.ctx;
    const out = this.out();
    const buf = this.engine.noiseBuffer();
    if (!ctx || !out || !buf) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.Q.value = opts.q ?? 0.8;
    f.frequency.setValueAtTime(opts.f0 ?? 1000, t0);
    if (opts.f1 && opts.f1 !== opts.f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + (opts.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------------ one-shots

  hookFire(): void {
    this.noiseBurst(0.07, 0.25, { type: 'bandpass', f0: 2500, f1: 900, q: 1.2 });
    this.tone('square', 1100, 320, 0.09, 0.08);
  }

  hookHit(onPlayer: boolean): void {
    if (onPlayer) {
      this.tone('triangle', 620, 520, 0.14, 0.2);
      this.tone('sine', 930, 930, 0.12, 0.1, { delay: 0.02 });
    } else {
      this.tone('triangle', 1900, 1750, 0.16, 0.18);
      this.tone('sine', 2850, 2700, 0.09, 0.08);
      this.noiseBurst(0.03, 0.15, { type: 'highpass', f0: 3000 });
    }
  }

  hookMiss(): void {
    this.tone('sine', 260, 120, 0.13, 0.12);
    this.noiseBurst(0.05, 0.06, { type: 'lowpass', f0: 600 });
  }

  hookDetach(): void {
    this.tone('square', 500, 380, 0.05, 0.05, { filter: 1500 });
  }

  overheat(): void {
    for (let i = 0; i < 3; i++) this.tone('square', 880, 880, 0.06, 0.12, { delay: i * 0.1, filter: 3000 });
  }

  death(cause: string): void {
    this.noiseBurst(0.45, 0.5, { type: 'lowpass', f0: 900, f1: 120, q: 0.5 });
    this.tone('sine', 110, 28, 0.4, 0.5);
    if (cause === 'spike') this.tone('sawtooth', 700, 200, 0.12, 0.1, { filter: 2500 });
  }

  respawn(): void {
    const notes = [440, 660, 880];
    for (let i = 0; i < notes.length; i++) this.tone('sine', notes[i], notes[i], 0.09, 0.12, { delay: i * 0.055 });
  }

  enemyKill(): void {
    this.noiseBurst(0.13, 0.35, { type: 'bandpass', f0: 3200, f1: 500, q: 1.5 });
    this.tone('sine', 1400, 1900, 0.1, 0.12, { delay: 0.02 });
  }

  playerHit(): void {
    this.tone('square', 160, 90, 0.12, 0.18, { filter: 900 });
    this.noiseBurst(0.08, 0.15, { type: 'lowpass', f0: 500 });
  }

  land(intensity: number): void {
    const k = Math.min(1, intensity / 900);
    this.noiseBurst(0.06 + 0.06 * k, 0.05 + 0.2 * k, { type: 'lowpass', f0: 300 + 500 * k });
  }

  cutWindow(): void {
    this.tone('square', 1500, 1500, 0.04, 0.1, { filter: 4000 });
  }

  menuMove(): void {
    this.tone('square', 640, 640, 0.035, 0.05, { filter: 2500 });
  }

  menuConfirm(): void {
    this.tone('square', 520, 520, 0.06, 0.07, { filter: 2500 });
    this.tone('square', 780, 780, 0.09, 0.07, { delay: 0.06, filter: 2500 });
  }

  menuBack(): void {
    this.tone('square', 420, 300, 0.1, 0.06, { filter: 2000 });
  }

  // ------------------------------------------------------------------ boucles

  private ensureReel(i: number): Loop | null {
    const ctx = this.ctx;
    const out = this.out();
    if (!ctx || !out) return null;
    let loop = this.reelLoops[i];
    if (loop) return loop;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 120;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 30; // "cliquet"
    const ring = ctx.createGain();
    ring.gain.value = 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(ring);
    ring.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start();
    osc2.start();
    loop = { gain, filter, osc, osc2, active: false, level: 0 };
    this.reelLoops[i] = loop;
    return loop;
  }

  private ensureJet(i: number): Loop | null {
    const ctx = this.ctx;
    const out = this.out();
    const buf = this.engine.noiseBuffer();
    if (!ctx || !out || !buf) return null;
    let loop = this.jetLoops[i];
    if (loop) return loop;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 52;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    noise.connect(filter);
    filter.connect(gain);
    osc.connect(gain);
    gain.connect(out);
    noise.start(0, i * 0.7);
    osc.start();
    loop = { gain, filter, osc, noise, active: false, level: 0 };
    this.jetLoops[i] = loop;
    return loop;
  }

  /** Événements d'un tick simulé pour la première fois (jamais ceux d'une re-simulation). */
  handleEvents(events: readonly SimEvent[]): void {
    if (!this.ctx) return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'hookFire':
          this.hookFire();
          break;
        case 'hookHit':
          this.hookHit(e.value === 1);
          break;
        case 'hookMiss':
          this.hookMiss();
          break;
        case 'hookDetach':
          this.hookDetach();
          break;
        case 'reelStart': {
          const l = this.ensureReel(e.player);
          if (l) l.active = true;
          break;
        }
        case 'reelStop': {
          const l = this.reelLoops[e.player];
          if (l) l.active = false;
          break;
        }
        case 'jetStart': {
          const l = this.ensureJet(e.player);
          if (l) l.active = true;
          break;
        }
        case 'jetStop': {
          const l = this.jetLoops[e.player];
          if (l) l.active = false;
          break;
        }
        case 'overheat':
          this.overheat();
          break;
        case 'death':
          this.death(e.cause ?? 'wall');
          break;
        case 'respawn':
          this.respawn();
          break;
        case 'enemyKill':
          this.enemyKill();
          break;
        case 'playerHit':
          this.playerHit();
          break;
        case 'land':
          this.land(e.value ?? 0);
          break;
        case 'cutWindowOpen':
          this.cutWindow();
          break;
        default:
          break;
      }
    }
  }

  /** Modulation continue des boucles depuis l'état courant (lecture seule). Appelé chaque frame. */
  update(state: GameState, dtReal: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = state.params;
    for (let i = 0; i < state.playerCount; i++) {
      const pl = state.players[i];
      const reel = this.reelLoops[i];
      if (reel) {
        // Vitesse de rétraction réelle du tick (0 si la corde est bloquée en longueur mini / contre un mur).
        let rate = 0;
        let anyReeling = false;
        for (let h = 0; h < 2; h++) {
          const hk = pl.hooks[h];
          if (hk.reeling) {
            anyReeling = true;
            rate = Math.max(rate, hk.reelDelta * 60);
          }
        }
        const target = reel.active && anyReeling ? 0.12 : 0;
        reel.level += (target - reel.level) * Math.min(1, dtReal * 18);
        reel.gain.gain.setTargetAtTime(reel.level, t, 0.02);
        const norm = Math.min(1.5, rate / Math.max(1, p.reelSpeed));
        const f = 90 + 220 * norm;
        reel.osc?.frequency.setTargetAtTime(f, t, 0.03);
        reel.osc2?.frequency.setTargetAtTime(18 + 40 * norm, t, 0.03);
        reel.filter.frequency.setTargetAtTime(500 + 1400 * norm, t, 0.03);
      }
      const jet = this.jetLoops[i];
      if (jet) {
        const target = jet.active && pl.jetThrust ? 1 : 0;
        jet.level += (target - jet.level) * Math.min(1, dtReal * (target ? 14 : 8));
        const heatK = 0.6 + 0.4 * pl.heat;
        jet.gain.gain.setTargetAtTime(0.28 * jet.level, t, 0.02);
        jet.filter.frequency.setTargetAtTime(350 + 2600 * jet.level * heatK, t, 0.03);
        jet.osc?.frequency.setTargetAtTime(48 + 30 * pl.heat, t, 0.05);
      }
      if (pl.overheated && t - this.lastOverheatBeep > 0.6 && pl.prevButtons & 4) {
        // Le joueur insiste sur le jet en surchauffe : petit rappel.
        this.lastOverheatBeep = t;
        this.tone('square', 660, 660, 0.04, 0.05, { filter: 2500 });
      }
    }
  }

  /** Coupe toutes les boucles (pause, retour menu). */
  silenceLoops(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const l of [...this.reelLoops, ...this.jetLoops]) {
      if (!l) continue;
      l.active = false;
      l.level = 0;
      l.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    }
  }
}
