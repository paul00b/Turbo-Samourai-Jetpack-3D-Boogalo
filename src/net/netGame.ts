/**
 * Colle entre la session réseau et le jeu : négocie la config (seed, carte, params), crée le
 * netcode, démarre les deux sims sur un état initial identique, et nettoie quand le pair s'en va.
 * L'hôte peut choisir une carte du workshop (hostMap) : elle part dans la config, lignes comprises.
 */
import { clampLevelId, CUSTOM_LEVEL_ID, PARAM_KEYS, type SimParams } from '../sim';
import type { WorkshopMap } from './workshopApi';
import type { Game } from '../app/game';
import type { ParamsStore } from '../io/paramsStore';
import type { SettingsStore } from '../io/settings';
import { NetPlay } from './netPlay';
import { normalizeCode, PROTOCOL_VERSION, type PeerMsg } from './protocol';
import { NetSession, type SessionStatus } from './session';

export interface NetGameDeps {
  game: Game;
  settings: SettingsStore;
  params: ParamsStore;
}

export class NetGame {
  readonly session: NetSession;
  play: NetPlay | null = null;
  /** Dernier message à afficher à l'utilisateur (menu). */
  message = '';
  /** Notifié à chaque changement d'état : le menu se redessine. */
  onChange: (() => void) | null = null;
  /** Carte du workshop que l'hôte fera jouer (null : la carte officielle choisie). */
  hostMap: WorkshopMap | null = null;

  constructor(private readonly deps: NetGameDeps) {
    this.session = new NetSession({
      onStatus: (s) => this.onStatus(s),
      onPeer: (m) => this.onPeer(m),
    });
  }

  get status(): SessionStatus {
    return this.session.status;
  }

  get code(): string {
    return this.session.code;
  }

  get active(): boolean {
    return this.play !== null;
  }

  host(url: string): void {
    this.message = '';
    this.session.host(url);
  }

  join(url: string, rawCode: string): void {
    const code = normalizeCode(rawCode);
    if (code.length !== 6) {
      this.message = 'Code incomplet : 6 caractères attendus.';
      this.onChange?.();
      return;
    }
    this.message = '';
    this.session.join(url, code);
  }

  /** Quitte volontairement : prévient le pair, coupe le netcode, retour au menu. */
  leave(): void {
    this.session.close();
    this.stop('');
  }

  /** Une fois par frame : groupe les inputs du frame en un seul message. */
  frame(): void {
    this.play?.flush();
  }

  private onStatus(s: SessionStatus): void {
    if (s === 'connected' && this.session.isHost && !this.play) {
      // L'hôte fait foi : il envoie sa config, puis démarre. L'invité démarrera en la recevant.
      this.session.sendPeer({ t: 'config', version: PROTOCOL_VERSION, ...this.config() });
      this.begin(0);
    } else if (s === 'error') {
      this.stop(this.session.error);
    } else if ((s === 'waiting' || s === 'closed' || s === 'idle') && this.play) {
      this.stop(s === 'waiting' ? 'Le deuxième joueur a quitté la session.' : 'Session terminée.');
    }
    this.onChange?.();
  }

  private onPeer(msg: PeerMsg): void {
    switch (msg.t) {
      case 'config': {
        if (msg.version !== PROTOCOL_VERSION) {
          this.stop('Version de protocole différente entre les deux joueurs.');
          break;
        }
        const map = msg.levelId === CUSTOM_LEVEL_ID ? (msg.map ?? null) : null;
        if (msg.levelId === CUSTOM_LEVEL_ID && !map) {
          this.stop("L'hôte joue une carte qui n'a pas été transmise.");
          break;
        }
        this.applyConfig(msg.seed, msg.levelId, msg.params);
        if (!this.begin(1, map)) {
          this.session.close();
          this.stop("La carte du workshop reçue de l'hôte est abîmée : partie annulée.");
          break;
        }
        this.session.sendPeer({ t: 'ready' });
        break;
      }
      case 'in':
        this.play?.onRemoteInputs(msg.first, msg.inputs, this.deps.game.state.tick, msg.gen);
        break;
      case 'params':
        // Seul l'hôte émet ; côté hôte on ignore (il a déjà planifié en local).
        if (this.play && !this.play.isHost) this.deps.game.scheduleNetParams(msg.tick, msg.params, msg.gen);
        break;
      case 'restart':
        if (this.play && !this.play.isHost) this.deps.game.netRestart(msg.gen, msg.seed, msg.levelId);
        break;
      default:
        break;
    }
    this.onChange?.();
  }

  private config(): { seed: number; levelId: number; params: Record<string, number>; map?: WorkshopMap } {
    const s = this.deps.settings.get();
    const p = this.deps.params.get();
    const params: Record<string, number> = {};
    for (const k of PARAM_KEYS) params[k] = p[k];
    if (this.hostMap) return { seed: s.seed >>> 0, levelId: CUSTOM_LEVEL_ID, params, map: this.hostMap };
    return { seed: s.seed >>> 0, levelId: clampLevelId(s.levelId), params };
  }

  private applyConfig(seed: number, levelId: number, params: Record<string, number>): void {
    this.deps.params.replace(params as Partial<Record<keyof SimParams, unknown>>);
    this.deps.settings.update((st) => {
      st.seed = seed >>> 0;
      if (levelId !== CUSTOM_LEVEL_ID) st.levelId = clampLevelId(levelId);
      st.playerCount = 2;
    });
  }

  /** Démarre le netcode. Faux si la carte du workshop ne se charge pas (empreinte différente). */
  private begin(slot: number, map: WorkshopMap | null = this.hostMap): boolean {
    this.deps.settings.update((st) => (st.playerCount = 2));
    this.play = new NetPlay(this.session, slot);
    this.deps.game.startNet(this.play, map);
    if (map && this.deps.game.workshopMap?.id !== map.id) {
      this.play = null;
      return false;
    }
    this.message = '';
    this.onChange?.();
    return true;
  }

  private stop(message: string): void {
    this.play = null;
    this.message = message;
    this.deps.game.endNet();
  }
}
