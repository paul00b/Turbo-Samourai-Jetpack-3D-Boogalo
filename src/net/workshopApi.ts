/**
 * Contrat du workshop, partagé par le client et le serveur (`/api/workshop`) : forme des cartes
 * publiées, des requêtes et des réponses, contrôle d'une carte envoyée, nom de carte, aperçu réduit.
 * Pur, sans DOM.
 *
 *   GET  ?list=recent|popular|mine[&mode=all|race|kills][&offset=n][&playerId=…]
 *   GET  ?id=<id>[&playerId=…]            -> la carte complète (lignes et panneaux compris)
 *   GET  ?board=<id>[&playerId=…]         -> top 10 de la carte
 *   POST { action: 'publish', … }         -> publie (ou republie) avec la preuve de fin
 *   POST { action: 'score', … }           -> temps sur une carte du workshop (rejoué)
 *   POST { action: 'play' | 'report' | 'delete', id, playerId[, adminKey] }
 */
import { sanitizeSigns, TILE_CHARS, validateRows, type LevelMode, type LevelSign } from '../sim';
import type { BoardView } from './scoresApi';

export type WorkshopTheme = 'port' | 'bamboo' | 'forge';
export const WORKSHOP_THEMES: readonly WorkshopTheme[] = ['port', 'bamboo', 'forge'];
export type WorkshopSort = 'recent' | 'popular' | 'mine';
export type WorkshopModeFilter = 'all' | LevelMode;

/** Cartes par page de liste. */
export const WS_PAGE = 20;
export const WS_NAME_MIN = 3;
export const WS_NAME_MAX = 32;
/** Mêmes bornes que l'éditeur. */
export const WS_MIN_W = 24;
export const WS_MAX_W = 600;
export const WS_MIN_H = 16;
export const WS_MAX_H = 160;
/** Cartes publiées au plus par joueur. */
export const WS_MAX_PER_AUTHOR = 30;
/** Signalements (de joueurs différents) qui retirent une carte des listes. */
export const WS_REPORTS_TO_HIDE = 3;
/** Aperçu : au plus tant de colonnes et de rangées. */
export const THUMB_MAX_W = 96;
export const THUMB_MAX_H = 24;

/** Ce qu'on envoie : la carte telle que l'éditeur la garde. */
export interface WorkshopDoc {
  name: string;
  mode: LevelMode;
  theme: WorkshopTheme;
  rows: string[];
  /** Panneaux de texte du décor (facultatifs) : rendu seulement, hors empreinte. */
  signs?: LevelSign[];
}

/** La carte d'origine, pour une copie modifiée puis republiée. */
export interface WorkshopParent {
  id: string;
  name: string;
  author: string;
}

/** Une carte dans les listes (sans ses lignes : l'aperçu suffit). */
export interface WorkshopSummary {
  id: string;
  name: string;
  mode: LevelMode;
  theme: WorkshopTheme;
  width: number;
  height: number;
  /** Pseudo de l'auteur (suit ses changements de pseudo). */
  author: string;
  /** Vrai si c'est ta carte (tu peux la republier ou la supprimer). */
  mine: boolean;
  created: number;
  updated: number;
  /** 1 à la publication, +1 à chaque republication. */
  version: number;
  plays: number;
  /** Temps de l'auteur sur cette version : la preuve que la carte se termine. */
  authorTicks: number;
  /** Empreinte de la géométrie (hex) : la même que celle des replays. */
  hash: string;
  parent: WorkshopParent | null;
  /** Aperçu réduit, une chaîne par rangée (voir makeThumb). */
  thumb: string[];
}

export interface WorkshopMap extends WorkshopSummary {
  rows: string[];
  /** Absent des cartes publiées avant les panneaux. */
  signs?: LevelSign[];
}

export interface WorkshopListResult {
  ok: true;
  items: WorkshopSummary[];
  total: number;
  offset: number;
}

export interface WorkshopGetResult {
  ok: true;
  map: WorkshopMap;
}

export interface WorkshopBoardResult extends BoardView {
  ok: true;
  id: string;
}

export interface PublishBody {
  action: 'publish';
  playerId: string;
  /** Pseudo de l'auteur (le même que celui du classement). */
  name: string;
  map: WorkshopDoc;
  /** Replay encodé de l'auteur qui termine la carte : sans lui, pas de publication. */
  replay: string;
  /** Republier : l'id de ta carte déjà publiée. */
  id?: string;
  /** Copie d'une carte du workshop : son id. */
  parentId?: string;
}

export interface PublishResult {
  ok: true;
  map: WorkshopSummary;
  created: boolean;
}

/** Identifiant de carte publiée : 10 caractères, alphabet sans ambiguïté. */
export const WS_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const WS_ID_LENGTH = 10;

export function isWorkshopId(v: unknown): v is string {
  if (typeof v !== 'string' || v.length !== WS_ID_LENGTH) return false;
  for (const c of v) if (!WS_ID_ALPHABET.includes(c)) return false;
  return true;
}

/**
 * Nom de carte nettoyé : lettres (accents compris), chiffres, espace et . _ - ' ! ? ( ) , ;
 * espaces resserrés. null s'il fait moins de 3 ou plus de 32 caractères après nettoyage.
 */
export function sanitizeMapName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFC')
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N} ._\-'!?(),]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const len = [...s].length;
  return len >= WS_NAME_MIN && len <= WS_NAME_MAX ? s : null;
}

export type DocCheck = { ok: true; doc: WorkshopDoc } | { ok: false; error: string };

/**
 * Contrôle d'une carte envoyée : forme, tailles, caractères, nom, mode, thème, panneaux (remis en
 * forme, jamais refusés), et les règles
 * bloquantes de l'éditeur (spawn, arrivée accessible, ennemis en arcade…). Les conseils de design
 * (avertissements) ne bloquent pas : la preuve de fin dit le reste.
 */
export function checkDoc(raw: unknown): DocCheck {
  const o = raw as Partial<WorkshopDoc> | null;
  if (!o || typeof o !== 'object') return { ok: false, error: 'carte manquante' };
  const name = sanitizeMapName(o.name);
  if (!name) return { ok: false, error: `nom de carte invalide (${WS_NAME_MIN} à ${WS_NAME_MAX} caractères)` };
  if (o.mode !== 'race' && o.mode !== 'kills') return { ok: false, error: 'mode inconnu' };
  if (!WORKSHOP_THEMES.includes(o.theme as WorkshopTheme)) return { ok: false, error: 'thème inconnu' };
  const rows = o.rows;
  if (!Array.isArray(rows) || rows.length < WS_MIN_H || rows.length > WS_MAX_H) return { ok: false, error: `hauteur hors bornes (${WS_MIN_H} à ${WS_MAX_H})` };
  const w = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (w < WS_MIN_W || w > WS_MAX_W) return { ok: false, error: `largeur hors bornes (${WS_MIN_W} à ${WS_MAX_W})` };
  for (const r of rows) {
    if (typeof r !== 'string' || r.length !== w) return { ok: false, error: 'lignes de largeurs différentes' };
    for (let i = 0; i < r.length; i++) if (!TILE_CHARS.includes(r[i])) return { ok: false, error: `caractère inconnu « ${r[i]} »` };
  }
  const blocking = validateRows(rows, o.mode).find((i) => i.severity === 'error');
  if (blocking) return { ok: false, error: blocking.message };
  const signs = sanitizeSigns(o.signs, w, rows.length);
  return { ok: true, doc: { name, mode: o.mode, theme: o.theme as WorkshopTheme, rows: rows.slice(), signs } };
}

/**
 * Aperçu réduit : la carte en blocs de k × k tuiles (k choisi pour tenir dans 96 × 24). Chaque bloc
 * garde ce qui compte pour lire la carte : l'arrivée, le spawn, le danger, puis plein ou vide.
 */
export function makeThumb(rows: readonly string[]): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const k = Math.max(1, Math.ceil(w / THUMB_MAX_W), Math.ceil(h / THUMB_MAX_H));
  const out: string[] = [];
  for (let by = 0; by < h; by += k) {
    let line = '';
    for (let bx = 0; bx < w; bx += k) {
      let solid = 0;
      let slick = 0;
      let cells = 0;
      let goal = false;
      let spawn = false;
      let spike = false;
      let pad = false;
      for (let y = by; y < Math.min(h, by + k); y++) {
        for (let x = bx; x < Math.min(w, bx + k); x++) {
          const c = rows[y][x];
          cells++;
          if (c === '#') solid++;
          else if (c === '=') slick++;
          else if (c === 'F') goal = true;
          else if (c === 'S') spawn = true;
          else if (c === '^') spike = true;
          else if (c === 'T') pad = true;
        }
      }
      if (spawn) line += 'S';
      else if (goal) line += 'F';
      else if (spike) line += '^';
      else if ((solid + slick) * 2 >= cells) line += slick > solid ? '=' : '#';
      else if (pad) line += 'T';
      else line += '.';
    }
    out.push(line);
  }
  return out;
}
