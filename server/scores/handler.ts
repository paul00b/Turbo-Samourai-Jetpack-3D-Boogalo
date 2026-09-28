/**
 * `/api/scores` : le classement global, indépendant de l'hébergeur (fonction Vercel en prod,
 * middleware Vite en dev, tests). Toute la logique est ici ; les adaptateurs ne font que traduire
 * la requête et la réponse.
 *
 *   GET  ?level=<id>[&playerId=<uuid>]  -> top 10 de la carte (+ ta place)
 *   POST { playerId, name, replay }     -> rejoue la partie, garde ton meilleur temps
 *   POST { action: 'rename', playerId, name }
 *
 * Anti-triche : le serveur ne croit jamais le temps du client. Il rejoue les inputs avec la vraie
 * sim et les params par défaut (verifyReplay) et retient `finishTick` qu'il a calculé lui-même.
 */
import { decodeReplay, hashToHex, levelHash, LEVEL_DEFS, MAX_REPLAY_TICKS, verifyReplay } from '../../src/sim';
import { isPlayerId, sanitizeName, TOP_N, type BoardView, type ErrorResult, type SubmitResult } from '../../src/net/scoresApi';
import type { ScoreStore } from './store';

/** Un replay de 10 min où la visée change à chaque tick tient en ~450 Ko de base64. */
export const MAX_BODY_CHARS = 600_000;
/** Requêtes par IP et par minute (lectures comprises), soumissions à part. */
export const RATE_READS_PER_MIN = 120;
export const RATE_SUBMITS_PER_MIN = 12;

export interface ScoresDeps {
  store: ScoreStore;
  /** Nombre de cartes classées (les cartes officielles ; injectable pour les tests). */
  levelCount?: () => number;
}

export interface ScoresRequest {
  method: string;
  query: URLSearchParams;
  body: string | null;
  ip: string;
}

export interface ScoresResponse {
  status: number;
  body: unknown;
}

/** Clé du tableau d'une carte : son empreinte (une carte modifiée repart de zéro). */
export function boardKey(levelId: number): string {
  return `lb:v1:${hashToHex(levelHash(levelId))}`;
}

const fail = (status: number, error: string): ScoresResponse => ({ status, body: { ok: false, error } satisfies ErrorResult });

async function view(store: ScoreStore, levelId: number, playerId: string | null): Promise<BoardView> {
  const key = boardKey(levelId);
  const [rows, total, me] = await Promise.all([store.top(key, TOP_N), store.count(key), playerId ? store.rank(key, playerId) : Promise.resolve(null)]);
  const names = await store.names(rows.map((r) => r.playerId));
  return {
    level: levelId,
    total,
    top: rows.map((r, i) => ({ rank: i + 1, name: names[i] ?? 'Anonyme', ticks: r.ticks })),
    me,
  };
}

export async function handleScores(req: ScoresRequest, deps: ScoresDeps): Promise<ScoresResponse> {
  const { store } = deps;
  const levelCount = (deps.levelCount ?? (() => LEVEL_DEFS.length))();
  try {
    if ((await store.hit(`lb:rl:${req.ip}`, 60)) > RATE_READS_PER_MIN) return fail(429, 'trop de requêtes, réessaie dans une minute');

    if (req.method === 'GET') {
      const level = Number(req.query.get('level'));
      if (!Number.isInteger(level) || level < 0 || level >= levelCount) return fail(400, 'carte inconnue');
      const pid = req.query.get('playerId');
      return { status: 200, body: { ok: true, ...(await view(store, level, isPlayerId(pid) ? pid : null)) } };
    }

    if (req.method !== 'POST') return fail(405, 'méthode non autorisée');
    if (!req.body || req.body.length > MAX_BODY_CHARS) return fail(413, 'requête trop grosse');
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return fail(400, 'JSON invalide');
    }
    if (!body || typeof body !== 'object') return fail(400, 'JSON invalide');
    if (!isPlayerId(body.playerId)) return fail(400, 'identifiant de joueur invalide');
    const name = sanitizeName(body.name);
    if (!name) return fail(400, 'pseudo invalide (3 à 16 caractères : lettres, chiffres, espace, - _ .)');

    if (body.action === 'rename') {
      await store.setName(body.playerId, name);
      return { status: 200, body: { ok: true } };
    }

    if ((await store.hit(`lb:rs:${req.ip}`, 60)) > RATE_SUBMITS_PER_MIN) return fail(429, 'trop de parties envoyées, réessaie dans une minute');
    if (typeof body.replay !== 'string') return fail(400, 'replay manquant');
    const replay = decodeReplay(body.replay, MAX_REPLAY_TICKS);
    if (!replay) return fail(400, 'replay illisible');
    const verdict = verifyReplay(replay, levelCount);
    if (!verdict.ok) return fail(422, `partie refusée : ${verdict.reason}`);

    const key = boardKey(replay.levelId);
    const previous = await store.submit(key, body.playerId, verdict.finishTick);
    await store.setName(body.playerId, name);
    const v = await view(store, replay.levelId, body.playerId);
    const result: SubmitResult = {
      ok: true,
      ...v,
      ticks: verdict.finishTick,
      previous,
      improved: previous === null || verdict.finishTick < previous,
    };
    return { status: 200, body: result };
  } catch (e) {
    return fail(503, `classement indisponible (${e instanceof Error ? e.message : 'erreur'})`);
  }
}
