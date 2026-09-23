/**
 * Orchestrateur : sim + boucle + IO + rendu. C'est ici (et seulement ici) que les trois couches se touchent.
 */
import {
  cloneState,
  createInitialState,
  hashState,
  hashToHex,
  StateHistory,
  step,
  TICK_RATE,
  type GameState,
  type SimEvent,
  type SimParams,
} from '../sim';
import type { InputMapper } from '../io/input/inputMapper';
import type { KeyboardMouse } from '../io/input/keyboardMouse';
import type { Sfx } from '../io/audio/sfx';
import type { SettingsStore } from '../io/settings';
import type { ParamsStore } from '../io/paramsStore';
import type { Renderer } from '../render/renderer';
import { Fx } from '../render/fx';
import { TrailBuffer } from '../render/trail';
import { GameLoop } from './gameLoop';

export type Phase = 'menu' | 'playing' | 'paused';

/** 3 s d'historique : assez pour un rollback réseau (~200 ms) avec une marge confortable. */
export const HISTORY_TICKS = 180;

export interface GameDeps {
  renderer: Renderer;
  mapper: InputMapper;
  kbm: KeyboardMouse;
  sfx: Sfx;
  settings: SettingsStore;
  params: ParamsStore;
}

export interface RollbackTestResult {
  ok: boolean;
  depth: number;
  hashLive: string;
  hashResim: string;
  ms: number;
}

export class Game {
  phase: Phase = 'menu';
  state: GameState;
  prev: GameState;
  readonly history = new StateHistory(HISTORY_TICKS);
  readonly loop = new GameLoop();
  readonly fx = new Fx();
  readonly trails: TrailBuffer[] = [];
  private readonly events: SimEvent[] = [];
  onPhase: ((phase: Phase) => void) | null = null;

  constructor(private readonly deps: GameDeps) {
    const s = deps.settings.get();
    for (let i = 0; i < 2; i++) this.trails.push(new TrailBuffer(Math.round(s.debug.trailSeconds * TICK_RATE)));
    this.state = createInitialState(s.seed, s.playerCount, deps.params.get());
    this.prev = cloneState(this.state);
    // Les params du panneau de debug sont recopiés en live dans l'état.
    deps.params.subscribe((p) => this.applyParams(p));
    deps.settings.subscribe((st) => {
      const cap = Math.round(st.debug.trailSeconds * TICK_RATE);
      for (const t of this.trails) t.setCapacity(cap);
    });
  }

  newSim(playerCount: number): void {
    const s = this.deps.settings.get();
    this.state = createInitialState(s.seed, playerCount, this.deps.params.get());
    this.prev = cloneState(this.state);
    this.history.clear();
    for (const t of this.trails) t.clear();
    this.fx.clear();
    this.deps.renderer.resetCameras();
    this.loop.reset();
    this.deps.sfx.silenceLoops();
  }

  start(playerCount: number): void {
    this.newSim(playerCount);
    this.deps.mapper.flush();
    this.deps.mapper.suppressPauseEdge();
    this.setPhase('playing');
    this.loop.resume();
  }

  restart(): void {
    this.start(this.state.playerCount);
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.loop.pause();
    this.deps.sfx.silenceLoops();
    this.setPhase('paused');
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.deps.mapper.flush();
    this.deps.mapper.suppressPauseEdge();
    this.loop.resume();
    this.setPhase('playing');
  }

  togglePause(): void {
    if (this.phase === 'playing') this.pause();
    else if (this.phase === 'paused') this.resume();
  }

  quitToMenu(): void {
    this.loop.pause();
    this.deps.sfx.silenceLoops();
    this.newSim(this.state.playerCount);
    this.setPhase('menu');
  }

  /** Changement 1J/2J : nouvelle sim (la répartition des joueurs change), on reste dans la même phase. */
  setPlayerCount(n: number): void {
    if (n === this.state.playerCount) return;
    if (this.phase === 'playing' || this.phase === 'paused') this.start(n);
    else this.newSim(n);
  }

  private setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.deps.kbm.captureKeys = p !== 'menu';
    if (this.onPhase) this.onPhase(p);
  }

  applyParams(p: Readonly<SimParams>): void {
    Object.assign(this.state.params, p);
    Object.assign(this.prev.params, p);
  }

  private readonly tick = (): void => {
    const inputs = this.deps.mapper.sample(this.state, this.deps.renderer);
    this.history.record(this.state, inputs);
    this.prev = cloneState(this.state);
    this.events.length = 0;
    step(this.state, inputs, this.events);
    // Ces événements sont ceux d'un tick simulé pour la première fois : on les consomme.
    this.deps.sfx.handleEvents(this.events);
    this.fx.handleEvents(this.events);
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.type === 'respawn') this.trails[e.player]?.clear();
    }
    for (let i = 0; i < this.state.playerCount; i++) {
      const pl = this.state.players[i];
      this.trails[i].push(pl.x, pl.y);
    }
  };

  /** Une frame d'affichage. */
  frame(nowMs: number): void {
    if (this.phase === 'playing' && this.deps.mapper.pausePressed()) this.pause();
    else if (this.phase !== 'playing') this.deps.mapper.pausePressed(); // garde le front à jour
    this.loop.advance(nowMs, this.tick);
    const dt = this.loop.dtReal;
    this.fx.update(dt);
    const s = this.deps.settings.get();
    this.deps.renderer.render(this.prev, this.state, this.loop.alpha, dt, s.cameraMode, s.camera, s.debug, this.trails, this.fx);
    this.deps.sfx.update(this.state, dt);
  }

  stateHashHex(): string {
    return hashToHex(hashState(this.state));
  }

  /** Rollback de `depth` ticks + re-simulation : l'état recalculé doit être identique au live. */
  rollbackTest(depth = 60): RollbackTestResult {
    const from = this.state.tick - depth;
    const t0 = performance.now();
    if (from < 0 || !this.history.get(from)) {
      return { ok: false, depth, hashLive: this.stateHashHex(), hashResim: 'historique insuffisant', ms: 0 };
    }
    const resim = this.history.resimulate(from, this.state.tick);
    const ms = performance.now() - t0;
    const hashLive = this.stateHashHex();
    const hashResim = hashToHex(hashState(resim));
    return { ok: hashLive === hashResim, depth, hashLive, hashResim, ms };
  }
}
