/**
 * Protocole de session. Le serveur (server/index.mjs) ne relaie que des enveloppes : il ne
 * connaît ni la sim, ni les inputs. Tout ce qui est "jeu" passe dans `relay.d` (PeerMsg).
 */
export const PROTOCOL_VERSION = 1;

/** 6 caractères, alphabet sans ambiguïté visuelle (ni O/0, ni I/1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const c of code) if (!CODE_ALPHABET.includes(c)) return false;
  return true;
}

/** Normalise une saisie utilisateur : majuscules, sans espaces ni tirets. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export type PeerMsg =
  /** Hôte -> invité, à l'arrivée : tout ce dont la sim a besoin pour être identique. */
  | { t: 'config'; version: number; seed: number; levelId: number; params: Record<string, number> }
  /** Invité -> hôte : config appliquée, je démarre. */
  | { t: 'ready' }
  /**
   * Inputs empaquetés (u32) pour les ticks `first`, `first+1`, …
   * `gen` = numéro de manche : après un "recommencer", les ticks repartent à 0, et les inputs de la
   * manche précédente encore en vol doivent être jetés (sinon ils squattent les slots du nouveau run).
   */
  | { t: 'in'; gen: number; first: number; inputs: number[] }
  /** Hôte : nouvelle manche (recommencer ou changement de carte). Remet les deux sims à tick 0. */
  | { t: 'restart'; gen: number; seed: number; levelId: number }
  /**
   * Changement de params décidé par l'hôte, à appliquer EXACTEMENT au tick `tick` des deux côtés.
   * Les params font partie de l'état simulé : un changement non daté désynchroniserait.
   */
  | { t: 'params'; gen: number; tick: number; params: Record<string, number> }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'bye' };

export type ClientMsg =
  | { t: 'host'; version: number }
  | { t: 'join'; version: number; code: string }
  | { t: 'relay'; d: PeerMsg };

export type ServerErrorCode = 'bad-version' | 'no-such-session' | 'session-full' | 'bad-code' | 'bad-message';

export type ServerMsg =
  | { t: 'hosted'; code: string; slot: 0 }
  | { t: 'joined'; code: string; slot: 1 }
  | { t: 'peer-joined' }
  | { t: 'peer-left' }
  | { t: 'relay'; d: PeerMsg }
  | { t: 'error'; reason: ServerErrorCode; detail?: string };

export const SERVER_ERROR_FR: Record<ServerErrorCode, string> = {
  'bad-version': 'Le serveur ne parle pas la même version du protocole.',
  'no-such-session': 'Aucune session avec ce code (elle a peut-être expiré).',
  'session-full': 'Cette session est déjà complète.',
  'bad-code': 'Code invalide : 6 caractères, lettres et chiffres.',
  'bad-message': 'Message refusé par le serveur.',
};
