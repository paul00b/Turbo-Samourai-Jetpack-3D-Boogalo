/**
 * Enregistre la partie en cours pour le classement : les inputs réellement donnés à la sim, tick
 * par tick depuis le tick 0. Repart de zéro à chaque nouvelle sim (recommencer, changer de carte).
 *
 * Une partie n'est classée que si elle est jouée seul, hors ligne, sur une carte officielle (ou une
 * carte perso qui compte : carte du workshop, ou test de l'éditeur dont le temps sert de preuve pour
 * publier), avec les params par défaut du début à la fin. Sinon elle est marquée hors classement.
 */
import {
  hashLevel,
  getLevel,
  isDefaultParams,
  LEVEL_DEFS,
  MAX_REPLAY_TICKS,
  packInput,
  paramsHash,
  type GameState,
  type PlayerInput,
  type ReplayData,
  type SimParams,
} from '../sim';

export type Unranked = 'params' | 'players' | 'online' | 'custom' | 'long';

export const UNRANKED_LABEL: Record<Unranked, string> = {
  params: 'params modifiés',
  players: 'partie à 2 joueurs',
  online: 'partie en ligne',
  custom: 'carte non officielle',
  long: 'partie de plus de 10 minutes',
};

export class ReplayRecorder {
  private buf = new Uint32Array(4096);
  private n = 0;
  private seed = 0;
  private levelId = 0;
  private levelHash = 0;
  private paramsHash = 0;
  /** null = classable. */
  unranked: Unranked | null = null;

  /** `officialLevels` : les cartes classées (les premières du registre, voir LEVEL_DEFS). */
  constructor(private readonly officialLevels: () => number = () => LEVEL_DEFS.length) {}

  /** `customRanked` : la carte perso en cours compte (workshop, preuve de l'éditeur). */
  reset(state: GameState, online: boolean, customRanked = false): void {
    this.n = 0;
    this.seed = state.seed >>> 0;
    this.levelId = state.levelId;
    this.levelHash = hashLevel(getLevel(state.levelId));
    this.paramsHash = paramsHash(state.params);
    this.unranked = null;
    if (online) this.unranked = 'online';
    else if (state.playerCount !== 1) this.unranked = 'players';
    else if (state.levelId >= this.officialLevels() && !customRanked) this.unranked = 'custom';
    else if (!isDefaultParams(state.params)) this.unranked = 'params';
  }

  /** Input du joueur 1 pour le tick qui va être simulé. */
  record(input: PlayerInput): void {
    if (this.unranked) return;
    if (this.n >= MAX_REPLAY_TICKS) {
      this.unranked = 'long';
      return;
    }
    if (this.n === this.buf.length) {
      const next = new Uint32Array(Math.min(MAX_REPLAY_TICKS, this.buf.length * 2));
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.n++] = packInput(input);
  }

  /** Params changés en cours de partie (panneau de debug, build appliqué). */
  checkParams(p: Readonly<SimParams>): void {
    if (!this.unranked && !isDefaultParams(p)) this.unranked = 'params';
  }

  get ticks(): number {
    return this.n;
  }

  /** Le replay de la manche terminée, ou null si elle n'est pas classable. */
  replay(state: GameState): ReplayData | null {
    if (this.unranked || !state.finished || state.finishTick <= 0 || state.finishTick > this.n) return null;
    return {
      seed: this.seed,
      levelId: this.levelId,
      levelHash: this.levelHash,
      paramsHash: this.paramsHash,
      inputs: this.buf.slice(0, state.finishTick),
    };
  }
}
