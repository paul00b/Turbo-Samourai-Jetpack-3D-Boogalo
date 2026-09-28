/**
 * Contrat du classement, partagé par le client et le serveur (`/api/scores`) : forme des
 * requêtes et réponses, règles des pseudos et des identifiants. Pur, sans DOM.
 */

export const TOP_N = 10;
export const NAME_MIN = 3;
export const NAME_MAX = 16;

export interface BoardEntry {
  rank: number;
  name: string;
  ticks: number;
}

export interface BoardView {
  level: number;
  total: number;
  top: BoardEntry[];
  /** Ta place, si tu es classé sur cette carte. */
  me: { rank: number; ticks: number } | null;
}

export interface SubmitBody {
  action?: 'submit';
  playerId: string;
  name: string;
  /** Replay encodé (encodeReplay). Le temps est recalculé par le serveur. */
  replay: string;
}

export interface RenameBody {
  action: 'rename';
  playerId: string;
  name: string;
}

export interface SubmitResult extends BoardView {
  ok: true;
  /** Temps de CETTE partie, recalculé par le serveur. */
  ticks: number;
  /** Ancien meilleur temps (null : première partie classée sur cette carte). */
  previous: number | null;
  improved: boolean;
}

export interface ErrorResult {
  ok: false;
  error: string;
}

/**
 * Pseudo nettoyé : lettres (accents compris), chiffres, espace, - _ . ; espaces resserrés.
 * null s'il fait moins de 3 ou plus de 16 caractères après nettoyage.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const len = [...s].length;
  return len >= NAME_MIN && len <= NAME_MAX ? s : null;
}

/** Identifiant de joueur : un uuid v4 généré côté client, jamais affiché. */
export function isPlayerId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
