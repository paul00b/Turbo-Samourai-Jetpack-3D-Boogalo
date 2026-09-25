/**
 * Orchestrateur : sim + boucle + IO + rendu. C'est ici (et seulement ici) que les trois couches se touchent.
 */
import {
  clampLevelId,
  cloneState,
  createInitialState,
  getLevel,
  hashState,
  hashToHex,
  makeInput,
  StateHistory,
  step,
  TICK_RATE,
  type GameState,
  type PlayerInput,
  type SimEvent,
  type SimParams,
} from '../sim';
import { INPUT_DELAY, PARAM_SYNC_DELAY, type NetPlay } from '../net/netPlay';
import type { InputMapper } from '../io/input/inputMapper';
import type { KeyboardMouse } from '../io/input/keyboardMouse';
import type { Sfx } from '../io/audio/sfx';
import type { SettingsStore } from '../io/settings';
import type { ParamsStore } from '../io/paramsStore';
import type { Renderer } from '../render/renderer';
import { Fx } from '../render/fx';
import { TrailBuffer } from '../render/trail';
import { GameLoop } from './gameLoop';

export type Phase = 'menu' | 'playing' | 'paused' | 'complete';

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
  /** Netcode actif (partie en ligne) ou null (partie locale). */
  net: NetPlay | null = null;
  private readonly netInputs: PlayerInput[] = [makeInput(), makeInput()];
  private readonly resimEvents: SimEvent[] = [];
  /** Vrai pendant l'application d'un changement venu du réseau : coupe l'écho vers le pair. */
  private applyingFromNet = false;
  /** L'écran de fin n'est proposé qu'une fois par manche (sinon « Continuer à jouer » le rouvre). */
  private completeShown = false;
  onPhase: ((phase: Phase) => void) | null = null;

  constructor(private readonly deps: GameDeps) {
    const s = deps.settings.get();
    for (let i = 0; i < 2; i++) this.trails.push(new TrailBuffer(Math.round(s.debug.trailSeconds * TICK_RATE)));
    this.state = createInitialState(s.seed, s.playerCount, deps.params.get(), clampLevelId(s.levelId));
    this.prev = cloneState(this.state);
    deps.renderer.setLevel(getLevel(this.state.levelId));
    // Les params du panneau de debug sont recopiés en live dans l'état.
    deps.params.subscribe((p) => this.applyParams(p));
    deps.settings.subscribe((st) => {
      const cap = Math.round(st.debug.trailSeconds * TICK_RATE);
      for (const t of this.trails) t.setCapacity(cap);
    });
  }

  newSim(playerCount: number): void {
    const s = this.deps.settings.get();
    this.completeShown = false;
    const levelId = clampLevelId(s.levelId);
    this.state = createInitialState(s.seed, playerCount, this.deps.params.get(), levelId);
    this.prev = cloneState(this.state);
    this.deps.renderer.setLevel(getLevel(levelId));
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

  /** Recommencer : en ligne, seul l'hôte décide, et les deux sims repartent ensemble au tick 0. */
  restart(): void {
    if (this.net) {
      if (!this.net.isHost) return;
      this.net.broadcastRestart(this.deps.settings.get().seed, clampLevelId(this.deps.settings.get().levelId));
    }
    this.start(this.state.playerCount);
  }

  /** Invité : nouvelle manche ordonnée par l'hôte. */
  netRestart(gen: number, seed: number, levelId: number): void {
    if (!this.net) return;
    this.net.resetForRestart(gen);
    this.deps.settings.update((st) => {
      st.seed = seed >>> 0;
      st.levelId = clampLevelId(levelId);
    });
    this.start(2);
  }

  /**
   * Démarre une partie en ligne. La config (seed, carte, params) a déjà été alignée sur celle de
   * l'hôte par NetGame : les deux machines créent donc le MÊME état initial.
   */
  startNet(net: NetPlay): void {
    this.net = net;
    this.start(2);
  }

  /** Fin de partie en ligne (pair parti, session fermée) : on retombe en local. */
  endNet(): void {
    if (!this.net) return;
    this.net = null;
    this.quitToMenu();
  }

  /**
   * Fin de niveau : `state.finished` vient de la sim, donc les deux machines l'atteignent au MÊME
   * tick. On gèle la boucle et on passe la main au menu de fin.
   */
  private enterComplete(): void {
    this.completeShown = true;
    this.loop.pause();
    this.deps.sfx.silenceLoops();
    this.setPhase('complete');
  }

  /** Quitter l'écran de fin sans recommencer : on reprend la main sur le niveau terminé. */
  resumeAfterComplete(): void {
    if (this.phase !== 'complete') return;
    this.deps.mapper.flush();
    this.deps.mapper.suppressPauseEdge();
    this.loop.resume();
    this.setPhase('playing');
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

  /** Changement de carte : nouvelle sim (la géométrie change), on reste dans la même phase. */
  setLevel(id: number): void {
    const levelId = clampLevelId(id);
    if (this.net && !this.net.isHost) return; // en ligne, la carte est celle de l'hôte
    if (levelId === this.state.levelId && this.phase !== 'complete') return;
    this.deps.settings.update((st) => (st.levelId = levelId));
    if (this.net) {
      this.net.broadcastRestart(this.deps.settings.get().seed, levelId);
      this.start(2);
    } else if (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'complete') {
      this.start(this.state.playerCount);
    } else {
      this.newSim(this.state.playerCount);
    }
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

  /**
   * Les params FONT PARTIE de l'état : les appliquer à des ticks différents désynchroniserait les
   * deux sims. En ligne, seul l'hôte décide, et le changement est DATÉ : il prend effet au même
   * tick des deux côtés (voir NetPlay.broadcastParams).
   */
  applyParams(p: Readonly<SimParams>): void {
    if (this.net) {
      if (this.applyingFromNet) return; // écho de la synchro réseau : déjà planifié
      if (!this.net.isHost) return; // l'invité subit les params de l'hôte
      this.pendingParamTick = this.state.tick + PARAM_SYNC_DELAY;
      this.net.broadcastParams(this.pendingParamTick, p);
      return;
    }
    Object.assign(this.state.params, p);
    Object.assign(this.prev.params, p);
  }

  /** Tick auquel le prochain changement de params prendra effet (HUD/panneau), -1 si aucun. */
  get paramSyncTick(): number {
    return this.pendingParamTick;
  }

  private pendingParamTick = -1;

  /** Invité : ordre reçu de l'hôte. Le ParamsStore local suit pour que l'UI dise la vérité. */
  scheduleNetParams(tick: number, params: Record<string, number>, gen?: number): void {
    if (!this.net) return;
    this.net.onRemoteParams(tick, params, this.state.tick, HISTORY_TICKS, gen);
    this.pendingParamTick = tick;
    this.applyingFromNet = true;
    this.deps.params.replace(params as Record<string, unknown>);
    this.applyingFromNet = false;
  }

  /** Changement de params planifié pour ce tick : appliqué à l'identique en live et en rollback. */
  private applyScheduledParams(state: GameState, tick: number, net: NetPlay): void {
    const p = net.paramsAt(tick);
    if (!p) return;
    Object.assign(state.params, p);
    if (this.pendingParamTick === tick) this.pendingParamTick = -1;
  }

  private readonly tick = (): boolean => {
    if (this.net) return this.netTick(this.net);
    const inputs = this.deps.mapper.sample(this.state, this.deps.renderer);
    this.advanceOneTick(inputs);
    return true;
  };

  /**
   * Un tick en ligne : on applique d'abord les corrections reçues (rollback), on échantillonne
   * son input pour `tick + INPUT_DELAY`, puis on avance — ou on stalle si le pair est trop en retard.
   */
  private netTick(net: NetPlay): boolean {
    const correction = net.takeRollback();
    if (correction >= 0) this.rollbackTo(correction, net);
    const t = this.state.tick;
    net.pushLocal(t + INPUT_DELAY, this.deps.mapper.sampleNet(this.state, this.deps.renderer, net.slot));
    if (!net.canStep(t)) return false;
    this.applyScheduledParams(this.state, t, net);
    this.advanceOneTick(net.inputsFor(t, this.netInputs));
    return true;
  }

  private advanceOneTick(inputs: PlayerInput[]): void {
    this.history.record(this.state, inputs);
    this.prev = cloneState(this.state);
    this.events.length = 0;
    step(this.state, inputs, this.events);
    // Ces événements sont ceux d'un tick simulé pour la première fois : on les consomme.
    this.deps.sfx.handleEvents(this.events, this.state);
    this.fx.handleEvents(this.events);
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.type === 'respawn') this.trails[e.player]?.clear();
    }
    for (let i = 0; i < this.state.playerCount; i++) {
      const pl = this.state.players[i];
      this.trails[i].push(pl.x, pl.y);
    }
  }

  /**
   * Rollback : on repart de l'état enregistré du tick fautif et on rejoue jusqu'au présent avec
   * les inputs corrigés, en RÉENREGISTRANT l'historique au passage (sinon un rollback suivant
   * repartirait d'un état faux). Les événements de re-simulation ne sont pas rejoués vers l'audio.
   */
  private rollbackTo(fromTick: number, net: NetPlay): void {
    const entry = this.history.get(fromTick);
    if (!entry) return; // correction plus vieille que l'historique : on la laisse tomber
    const target = this.state.tick;
    const st = cloneState(entry.state);
    for (let t = fromTick; t < target; t++) {
      // Même ordre qu'en live : les params datés reprennent effet au bon tick de la re-simulation.
      this.applyScheduledParams(st, t, net);
      const inputs = net.inputsFor(t, this.netInputs);
      this.history.record(st, inputs);
      this.resimEvents.length = 0;
      step(st, inputs, this.resimEvents);
    }
    this.state = st;
    this.prev = cloneState(st);
    net.noteRollback(target - fromTick);
  }

  /** Une frame d'affichage. */
  frame(nowMs: number): void {
    if (this.phase === 'playing' && this.deps.mapper.pausePressed()) this.pause();
    else if (this.phase !== 'playing') this.deps.mapper.pausePressed(); // garde le front à jour
    this.loop.advance(nowMs, this.tick);
    // Fin de niveau constatée dans les ticks qu'on vient de jouer : on bascule tout de suite, mais
    // on rend quand même la frame (le joueur doit voir l'état final derrière l'écran de fin).
    if (this.phase === 'playing' && this.state.finished && !this.completeShown) this.enterComplete();
    const dt = this.loop.dtReal;
    this.fx.update(dt);
    const s = this.deps.settings.get();
    this.deps.renderer.render(this.prev, this.state, this.loop.alpha, dt, s.cameraMode, s.camera, s.debug, this.trails, this.fx, s.render);
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
