/**
 * Stockage Upstash Redis, par son API REST (un simple `fetch`, aucune dépendance) :
 *   - `lb:v1:<empreinte>` : sorted set, membre = playerId, score = meilleur temps en ticks ;
 *   - `lb:names` : hash playerId -> pseudo ;
 *   - `lb:rl:<ip>` : compteur de limitation de débit, avec expiration.
 * Variables d'environnement : UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
 */
import type { ScoreRow, ScoreStore } from './store';

type Cmd = (string | number)[];

export class UpstashStore implements ScoreStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Store configuré par l'environnement, ou null si les variables manquent. */
  static fromEnv(env: Record<string, string | undefined>): UpstashStore | null {
    const url = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? new UpstashStore(url.replace(/\/+$/, ''), token) : null;
  }

  private async pipeline(cmds: Cmd[]): Promise<unknown[]> {
    const res = await this.fetchImpl(`${this.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    return out.map((r) => {
      if (r.error) throw new Error(`Upstash : ${r.error}`);
      return r.result;
    });
  }

  async submit(board: string, playerId: string, ticks: number): Promise<number | null> {
    // LT : n'écrase que par un meilleur temps (et ajoute un nouveau joueur).
    const [prev] = await this.pipeline([
      ['ZSCORE', board, playerId],
      ['ZADD', board, 'LT', ticks, playerId],
    ]);
    return prev === null || prev === undefined ? null : Number(prev);
  }

  async top(board: string, n: number): Promise<ScoreRow[]> {
    const [flat] = (await this.pipeline([['ZRANGE', board, 0, n - 1, 'WITHSCORES']])) as string[][];
    const rows: ScoreRow[] = [];
    for (let i = 0; i + 1 < (flat ?? []).length; i += 2) rows.push({ playerId: flat[i], ticks: Number(flat[i + 1]) });
    return rows;
  }

  async rank(board: string, playerId: string): Promise<{ rank: number; ticks: number } | null> {
    const [r, s] = await this.pipeline([
      ['ZRANK', board, playerId],
      ['ZSCORE', board, playerId],
    ]);
    if (r === null || r === undefined || s === null || s === undefined) return null;
    return { rank: Number(r) + 1, ticks: Number(s) };
  }

  async count(board: string): Promise<number> {
    const [n] = await this.pipeline([['ZCARD', board]]);
    return Number(n ?? 0);
  }

  async setName(playerId: string, name: string): Promise<void> {
    await this.pipeline([['HSET', 'lb:names', playerId, name]]);
  }

  async names(playerIds: string[]): Promise<(string | null)[]> {
    if (playerIds.length === 0) return [];
    const [vals] = (await this.pipeline([['HMGET', 'lb:names', ...playerIds]])) as (string | null)[][];
    return playerIds.map((_, i) => vals?.[i] ?? null);
  }

  async hit(key: string, windowSec: number): Promise<number> {
    const [n] = await this.pipeline([['INCR', key]]);
    const count = Number(n);
    if (count === 1) await this.pipeline([['EXPIRE', key, windowSec]]);
    return count;
  }
}
