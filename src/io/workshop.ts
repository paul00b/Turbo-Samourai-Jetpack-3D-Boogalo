/**
 * Workshop, côté client : les appels à `/api/workshop`. L'identité (uuid + pseudo) est celle du
 * classement : c'est elle qui fait de toi l'auteur de tes cartes, sur ce navigateur.
 */
import { encodeReplay, type ReplayData } from '../sim';
import type { ErrorResult, SubmitResult } from '../net/scoresApi';
import type {
  PublishResult,
  WorkshopBoardResult,
  WorkshopDoc,
  WorkshopGetResult,
  WorkshopListResult,
  WorkshopModeFilter,
  WorkshopSort,
} from '../net/workshopApi';
import type { LeaderboardClient } from './leaderboard';

/** Adresse de l'API : même site par défaut, surchargée par VITE_WORKSHOP_URL au build. */
export function workshopUrl(): string {
  const fromBuild = (import.meta.env?.VITE_WORKSHOP_URL as string | undefined) ?? '';
  return fromBuild.trim() || 'api/workshop';
}

export type Result<T> = T | ErrorResult;

export class WorkshopClient {
  constructor(
    readonly identity: LeaderboardClient,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly url: string = workshopUrl(),
  ) {}

  private get playerId(): string {
    return this.identity.identity.id;
  }

  private async call<T>(init: RequestInit, query = ''): Promise<Result<T>> {
    try {
      const res = await this.fetchImpl(`${this.url}${query}`, init);
      return (await res.json()) as Result<T>;
    } catch {
      return { ok: false, error: 'hors ligne' };
    }
  }

  private postJson<T>(body: Record<string, unknown>): Promise<Result<T>> {
    return this.call<T>({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: this.playerId, ...body }) });
  }

  list(sort: WorkshopSort, mode: WorkshopModeFilter, offset = 0): Promise<Result<WorkshopListResult>> {
    return this.call<WorkshopListResult>({ method: 'GET' }, `?list=${sort}&mode=${mode}&offset=${offset}&playerId=${encodeURIComponent(this.playerId)}`);
  }

  get(id: string): Promise<Result<WorkshopGetResult>> {
    return this.call<WorkshopGetResult>({ method: 'GET' }, `?id=${encodeURIComponent(id)}&playerId=${encodeURIComponent(this.playerId)}`);
  }

  board(id: string): Promise<Result<WorkshopBoardResult>> {
    return this.call<WorkshopBoardResult>({ method: 'GET' }, `?board=${encodeURIComponent(id)}&playerId=${encodeURIComponent(this.playerId)}`);
  }

  /** Publie (ou republie `id`) avec la preuve de fin. Le pseudo doit être choisi. */
  publish(map: WorkshopDoc, proof: string, opts: { id?: string; parentId?: string } = {}): Promise<Result<PublishResult>> {
    const name = this.identity.identity.name;
    if (!name) return Promise.resolve({ ok: false, error: 'pseudo manquant' });
    return this.postJson<PublishResult>({ action: 'publish', name, map, replay: proof, ...opts });
  }

  /** Temps sur une carte du workshop (rejoué par le serveur). */
  score(id: string, replay: ReplayData): Promise<Result<SubmitResult & { id: string }>> {
    const name = this.identity.identity.name;
    if (!name) return Promise.resolve({ ok: false, error: 'pseudo manquant' });
    return this.postJson<SubmitResult & { id: string }>({ action: 'score', name, id, replay: encodeReplay(replay) });
  }

  play(id: string): Promise<Result<{ ok: true; plays: number }>> {
    return this.postJson({ action: 'play', id });
  }

  report(id: string): Promise<Result<{ ok: true }>> {
    return this.postJson({ action: 'report', id });
  }

  remove(id: string): Promise<Result<{ ok: true }>> {
    return this.postJson({ action: 'delete', id });
  }
}
