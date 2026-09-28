/**
 * Classement global, côté client : ton identité (un uuid + ton pseudo, gardés dans le navigateur)
 * et les appels à `/api/scores`. Le serveur rejoue chaque partie envoyée : ce module ne transmet
 * que le replay, jamais un temps.
 */
import { encodeReplay, type ReplayData } from '../sim';
import { isPlayerId, sanitizeName, type BoardView, type ErrorResult, type SubmitResult } from '../net/scoresApi';

const STORAGE_KEY = 'tsj.leaderboard.v1';

export interface PlayerIdentity {
  id: string;
  /** null tant que le joueur ne l'a pas choisi (demandé à la fin de sa première partie classée). */
  name: string | null;
}

function uuid(): string {
  // randomUUID n'existe qu'en contexte sécurisé (https, localhost) : en LAN sur http, on le refait.
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Adresse de l'API : même site par défaut, surchargée par VITE_SCORES_URL au build. */
export function scoresUrl(): string {
  const fromBuild = (import.meta.env?.VITE_SCORES_URL as string | undefined) ?? '';
  return fromBuild.trim() || 'api/scores';
}

export class LeaderboardClient {
  identity: PlayerIdentity;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly url: string = scoresUrl(),
  ) {
    this.identity = this.load();
  }

  private load(): PlayerIdentity {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<PlayerIdentity>;
        if (isPlayerId(p.id)) return { id: p.id, name: sanitizeName(p.name) };
      }
    } catch {
      // stockage indisponible ou corrompu : nouvelle identité
    }
    const id: PlayerIdentity = { id: uuid(), name: null };
    this.save(id);
    return id;
  }

  private save(id: PlayerIdentity): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(id));
    } catch {
      // navigation privée stricte : l'identité vit le temps de la session
    }
  }

  /** Enregistre le pseudo (nettoyé). Retourne false s'il est invalide. */
  setName(raw: string): boolean {
    const name = sanitizeName(raw);
    if (!name) return false;
    this.identity = { ...this.identity, name };
    this.save(this.identity);
    return true;
  }

  /** Pseudo proposé par défaut (validable tel quel à la manette). */
  suggestedName(): string {
    return this.identity.name ?? `Samouraï ${this.identity.id.slice(0, 4).toUpperCase()}`;
  }

  private async call<T>(init: RequestInit, query = ''): Promise<T | ErrorResult> {
    try {
      const res = await this.fetchImpl(`${this.url}${query}`, init);
      const body = (await res.json()) as T | ErrorResult;
      return body;
    } catch {
      return { ok: false, error: 'hors ligne' };
    }
  }

  board(levelId: number): Promise<(BoardView & { ok: true }) | ErrorResult> {
    const q = `?level=${levelId}&playerId=${encodeURIComponent(this.identity.id)}`;
    return this.call<BoardView & { ok: true }>({ method: 'GET' }, q);
  }

  submit(replay: ReplayData): Promise<SubmitResult | ErrorResult> {
    const name = this.identity.name;
    if (!name) return Promise.resolve({ ok: false, error: 'pseudo manquant' });
    return this.call<SubmitResult>({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: this.identity.id, name, replay: encodeReplay(replay) }),
    });
  }

  /** Propage un nouveau pseudo au serveur (affiché sur toutes tes cartes). */
  rename(): Promise<{ ok: true } | ErrorResult> {
    const name = this.identity.name;
    if (!name) return Promise.resolve({ ok: false, error: 'pseudo manquant' });
    return this.call<{ ok: true }>({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', playerId: this.identity.id, name }),
    });
  }
}
