/**
 * Stockage du classement. Un tableau par empreinte de carte : meilleur temps (en ticks) par
 * joueur. Les pseudos sont à part (un pseudo par joueur, le même sur toutes les cartes).
 */

export interface ScoreRow {
  playerId: string;
  ticks: number;
}

export interface ScoreStore {
  /** Garde le meilleur temps du joueur. Retourne l'ancien meilleur (null si aucun). */
  submit(board: string, playerId: string, ticks: number): Promise<number | null>;
  /** Les `n` meilleurs, du plus rapide au plus lent. */
  top(board: string, n: number): Promise<ScoreRow[]>;
  /** Rang (1 = premier) et temps du joueur, null s'il n'est pas classé. */
  rank(board: string, playerId: string): Promise<{ rank: number; ticks: number } | null>;
  count(board: string): Promise<number>;
  setName(playerId: string, name: string): Promise<void>;
  names(playerIds: string[]): Promise<(string | null)[]>;
  /** Compteur de limitation de débit : incrémente la clé et retourne sa valeur sur la fenêtre. */
  hit(key: string, windowSec: number): Promise<number>;
}

/** En mémoire : `npm run dev` et les tests. Perdu au redémarrage. */
export class MemoryStore implements ScoreStore {
  private readonly boards = new Map<string, Map<string, { ticks: number; at: number }>>();
  private readonly nameMap = new Map<string, string>();
  private readonly hits = new Map<string, { n: number; until: number }>();
  private seq = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  private board(b: string): Map<string, { ticks: number; at: number }> {
    let m = this.boards.get(b);
    if (!m) this.boards.set(b, (m = new Map()));
    return m;
  }

  private sorted(b: string): ScoreRow[] {
    return [...this.board(b).entries()]
      .sort((x, y) => x[1].ticks - y[1].ticks || x[1].at - y[1].at)
      .map(([playerId, v]) => ({ playerId, ticks: v.ticks }));
  }

  async submit(board: string, playerId: string, ticks: number): Promise<number | null> {
    const m = this.board(board);
    const prev = m.get(playerId);
    if (!prev || ticks < prev.ticks) m.set(playerId, { ticks, at: this.seq++ });
    return prev ? prev.ticks : null;
  }

  async top(board: string, n: number): Promise<ScoreRow[]> {
    return this.sorted(board).slice(0, n);
  }

  async rank(board: string, playerId: string): Promise<{ rank: number; ticks: number } | null> {
    const i = this.sorted(board).findIndex((r) => r.playerId === playerId);
    return i < 0 ? null : { rank: i + 1, ticks: this.board(board).get(playerId)!.ticks };
  }

  async count(board: string): Promise<number> {
    return this.board(board).size;
  }

  async setName(playerId: string, name: string): Promise<void> {
    this.nameMap.set(playerId, name);
  }

  async names(playerIds: string[]): Promise<(string | null)[]> {
    return playerIds.map((id) => this.nameMap.get(id) ?? null);
  }

  async hit(key: string, windowSec: number): Promise<number> {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.until <= t) {
      this.hits.set(key, { n: 1, until: t + windowSec * 1000 });
      return 1;
    }
    h.n++;
    return h.n;
  }
}
