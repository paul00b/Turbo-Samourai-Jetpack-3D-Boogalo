/**
 * Stockage du workshop. Une carte = sa fiche (WorkshopRecord) et ses lignes, rangées à part : les
 * listes ne lisent que les fiches. Listes : récentes (date de mise à jour) et populaires (parties),
 * pour tous les modes et par mode. Les pseudos et les classements vivent dans le ScoreStore.
 */
import type { WorkshopModeFilter, WorkshopParent, WorkshopTheme } from '../../src/net/workshopApi';
import type { LevelMode } from '../../src/sim';

/** La fiche d'une carte publiée, telle que le serveur la garde (authorId ne sort jamais). */
export interface WorkshopRecord {
  id: string;
  name: string;
  mode: LevelMode;
  theme: WorkshopTheme;
  width: number;
  height: number;
  authorId: string;
  created: number;
  updated: number;
  version: number;
  authorTicks: number;
  hash: string;
  parent: WorkshopParent | null;
  thumb: string[];
  /** Retirée des listes (signalements) : seul son auteur la voit encore. */
  hidden: boolean;
}

export type ListSort = 'recent' | 'popular';

export interface WorkshopStore {
  /** Crée ou remplace une carte, et la range dans les listes (sauf si elle est cachée). */
  save(rec: WorkshopRecord, rows: string[]): Promise<void>;
  meta(id: string): Promise<WorkshopRecord | null>;
  metas(ids: string[]): Promise<(WorkshopRecord | null)[]>;
  rows(id: string): Promise<string[] | null>;
  /** Supprime la carte, ses lignes, ses compteurs et sa place dans les listes. */
  remove(rec: WorkshopRecord): Promise<void>;
  /** Une page d'ids (plus récents ou plus joués d'abord) et le total de la liste. */
  list(sort: ListSort, mode: WorkshopModeFilter, offset: number, count: number): Promise<{ ids: string[]; total: number }>;
  /** Les cartes d'un auteur (tous états confondus). */
  byAuthor(authorId: string): Promise<string[]>;
  plays(ids: string[]): Promise<number[]>;
  /** Une partie de plus, comptée une fois par joueur et par heure. Retourne le total. */
  addPlay(rec: WorkshopRecord, playerId: string): Promise<number>;
  /** Signalement (un par joueur). Retourne le nombre de joueurs qui ont signalé la carte. */
  report(id: string, playerId: string): Promise<number>;
  /** Retire la carte des listes et la marque cachée. */
  hide(rec: WorkshopRecord): Promise<void>;
}

/** Fenêtre pendant laquelle un même joueur ne compte qu'une partie sur une carte. */
export const PLAY_DEDUPE_SEC = 3600;

/** En mémoire : `npm run dev` et les tests. Perdu au redémarrage. */
export class MemoryWorkshopStore implements WorkshopStore {
  private readonly recs = new Map<string, WorkshopRecord>();
  private readonly rowMap = new Map<string, string[]>();
  private readonly playCount = new Map<string, number>();
  private readonly played = new Map<string, number>();
  private readonly reports = new Map<string, Set<string>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async save(rec: WorkshopRecord, rows: string[]): Promise<void> {
    this.recs.set(rec.id, { ...rec, thumb: rec.thumb.slice(), parent: rec.parent ? { ...rec.parent } : null });
    this.rowMap.set(rec.id, rows.slice());
    if (!this.playCount.has(rec.id)) this.playCount.set(rec.id, 0);
  }

  async meta(id: string): Promise<WorkshopRecord | null> {
    const r = this.recs.get(id);
    return r ? { ...r, thumb: r.thumb.slice(), parent: r.parent ? { ...r.parent } : null } : null;
  }

  async metas(ids: string[]): Promise<(WorkshopRecord | null)[]> {
    return Promise.all(ids.map((id) => this.meta(id)));
  }

  async rows(id: string): Promise<string[] | null> {
    return this.rowMap.get(id)?.slice() ?? null;
  }

  async remove(rec: WorkshopRecord): Promise<void> {
    this.recs.delete(rec.id);
    this.rowMap.delete(rec.id);
    this.playCount.delete(rec.id);
    this.reports.delete(rec.id);
  }

  async list(sort: ListSort, mode: WorkshopModeFilter, offset: number, count: number): Promise<{ ids: string[]; total: number }> {
    const all = [...this.recs.values()].filter((r) => !r.hidden && (mode === 'all' || r.mode === mode));
    const key = (r: WorkshopRecord): number => (sort === 'recent' ? r.updated : (this.playCount.get(r.id) ?? 0));
    // Même ordre que ZREVRANGE : score décroissant, puis membre décroissant.
    all.sort((a, b) => key(b) - key(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return { ids: all.slice(offset, offset + count).map((r) => r.id), total: all.length };
  }

  async byAuthor(authorId: string): Promise<string[]> {
    return [...this.recs.values()].filter((r) => r.authorId === authorId).map((r) => r.id);
  }

  async plays(ids: string[]): Promise<number[]> {
    return ids.map((id) => this.playCount.get(id) ?? 0);
  }

  async addPlay(rec: WorkshopRecord, playerId: string): Promise<number> {
    const key = `${rec.id}:${playerId}`;
    const t = this.now();
    const until = this.played.get(key);
    if (until === undefined || until <= t) {
      this.played.set(key, t + PLAY_DEDUPE_SEC * 1000);
      this.playCount.set(rec.id, (this.playCount.get(rec.id) ?? 0) + 1);
    }
    return this.playCount.get(rec.id) ?? 0;
  }

  async report(id: string, playerId: string): Promise<number> {
    let s = this.reports.get(id);
    if (!s) this.reports.set(id, (s = new Set()));
    s.add(playerId);
    return s.size;
  }

  async hide(rec: WorkshopRecord): Promise<void> {
    const r = this.recs.get(rec.id);
    if (r) r.hidden = true;
  }
}
