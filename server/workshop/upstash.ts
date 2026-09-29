/**
 * Workshop sur Upstash Redis (même base et même API REST que le classement) :
 *   - `ws:m:<id>` : la fiche (JSON) ; `ws:r:<id>` : les lignes, jointes par des retours à la ligne ;
 *   - `ws:recent:<all|race|kills>` : sorted sets, score = date de mise à jour ;
 *   - `ws:pop:<all|race|kills>` : sorted sets, score = parties ; `ws:plays` : hash id -> parties ;
 *   - `ws:by:<playerId>` : set des cartes d'un auteur ; `ws:rep:<id>` : set des joueurs qui ont signalé ;
 *   - `ws:pl:<id>:<playerId>` : « déjà compté », avec expiration.
 */
import type { WorkshopModeFilter } from '../../src/net/workshopApi';
import { PLAY_DEDUPE_SEC, type ListSort, type WorkshopRecord, type WorkshopStore } from './store';

type Cmd = (string | number)[];
export type Pipeline = (cmds: Cmd[]) => Promise<unknown[]>;

const MODES = ['all', 'race', 'kills'] as const;
const recentKey = (m: WorkshopModeFilter): string => `ws:recent:${m}`;
const popKey = (m: WorkshopModeFilter): string => `ws:pop:${m}`;
const unlist = (id: string): Cmd[] => MODES.flatMap((m) => [['ZREM', recentKey(m), id], ['ZREM', popKey(m), id]]);

function parseRecord(v: unknown): WorkshopRecord | null {
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as WorkshopRecord;
  } catch {
    return null;
  }
}

export class UpstashWorkshopStore implements WorkshopStore {
  constructor(private readonly exec: Pipeline) {}

  async save(rec: WorkshopRecord, rows: string[]): Promise<void> {
    const [prev] = await this.exec([['HGET', 'ws:plays', rec.id]]);
    const plays = Number(prev ?? 0) || 0;
    const cmds: Cmd[] = [
      ['SET', `ws:m:${rec.id}`, JSON.stringify(rec)],
      ['SET', `ws:r:${rec.id}`, rows.join('\n')],
      ['SADD', `ws:by:${rec.authorId}`, rec.id],
      ['HSETNX', 'ws:plays', rec.id, 0],
      ...unlist(rec.id),
    ];
    if (!rec.hidden) {
      cmds.push(['ZADD', recentKey('all'), rec.updated, rec.id], ['ZADD', recentKey(rec.mode), rec.updated, rec.id]);
      cmds.push(['ZADD', popKey('all'), plays, rec.id], ['ZADD', popKey(rec.mode), plays, rec.id]);
    }
    await this.exec(cmds);
  }

  async meta(id: string): Promise<WorkshopRecord | null> {
    const [v] = await this.exec([['GET', `ws:m:${id}`]]);
    return parseRecord(v);
  }

  async metas(ids: string[]): Promise<(WorkshopRecord | null)[]> {
    if (ids.length === 0) return [];
    const [vals] = (await this.exec([['MGET', ...ids.map((id) => `ws:m:${id}`)]])) as unknown[][];
    return ids.map((_, i) => parseRecord(vals?.[i]));
  }

  async rows(id: string): Promise<string[] | null> {
    const [v] = await this.exec([['GET', `ws:r:${id}`]]);
    return typeof v === 'string' && v.length > 0 ? v.split('\n') : null;
  }

  async remove(rec: WorkshopRecord): Promise<void> {
    await this.exec([
      ['DEL', `ws:m:${rec.id}`, `ws:r:${rec.id}`, `ws:rep:${rec.id}`],
      ['HDEL', 'ws:plays', rec.id],
      ['SREM', `ws:by:${rec.authorId}`, rec.id],
      ...unlist(rec.id),
    ]);
  }

  async list(sort: ListSort, mode: WorkshopModeFilter, offset: number, count: number): Promise<{ ids: string[]; total: number }> {
    const key = sort === 'recent' ? recentKey(mode) : popKey(mode);
    const [ids, total] = await this.exec([
      ['ZREVRANGE', key, offset, offset + count - 1],
      ['ZCARD', key],
    ]);
    return { ids: Array.isArray(ids) ? (ids as string[]) : [], total: Number(total ?? 0) };
  }

  async byAuthor(authorId: string): Promise<string[]> {
    const [ids] = await this.exec([['SMEMBERS', `ws:by:${authorId}`]]);
    return Array.isArray(ids) ? (ids as string[]) : [];
  }

  async plays(ids: string[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const [vals] = (await this.exec([['HMGET', 'ws:plays', ...ids]])) as unknown[][];
    return ids.map((_, i) => Number(vals?.[i] ?? 0) || 0);
  }

  async addPlay(rec: WorkshopRecord, playerId: string): Promise<number> {
    const [fresh] = await this.exec([['SET', `ws:pl:${rec.id}:${playerId}`, 1, 'NX', 'EX', PLAY_DEDUPE_SEC]]);
    if (fresh === 'OK') {
      const cmds: Cmd[] = [['HINCRBY', 'ws:plays', rec.id, 1]];
      if (!rec.hidden) cmds.push(['ZINCRBY', popKey('all'), 1, rec.id], ['ZINCRBY', popKey(rec.mode), 1, rec.id]);
      const [n] = await this.exec(cmds);
      return Number(n ?? 0);
    }
    const [n] = await this.exec([['HGET', 'ws:plays', rec.id]]);
    return Number(n ?? 0);
  }

  async report(id: string, playerId: string): Promise<number> {
    const [, n] = await this.exec([
      ['SADD', `ws:rep:${id}`, playerId],
      ['SCARD', `ws:rep:${id}`],
    ]);
    return Number(n ?? 0);
  }

  async hide(rec: WorkshopRecord): Promise<void> {
    await this.exec([['SET', `ws:m:${rec.id}`, JSON.stringify({ ...rec, hidden: true })], ...unlist(rec.id)]);
  }
}
