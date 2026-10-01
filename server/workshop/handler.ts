/**
 * `/api/workshop` : les cartes que les joueurs publient, indépendant de l'hébergeur (fonction Vercel
 * en prod, middleware Vite en dev, tests). Contrat : src/net/workshopApi.ts.
 *
 * Publier demande la preuve que la carte se termine : le replay de l'auteur, rejoué ici avec la
 * vraie sim sur la carte envoyée (verifyCustomReplay). Une carte que personne n'a su finir n'entre
 * pas. Même principe pour les temps du classement d'une carte du workshop : on ne croit que le rejeu.
 *
 * L'auteur est reconnu par son identifiant de joueur (le même que celui du classement, jamais
 * renvoyé aux autres). Modération : signalements (la carte quitte les listes au bout de quelques
 * joueurs), suppression par l'auteur, et par l'admin avec WORKSHOP_ADMIN_KEY.
 */
import { CUSTOM_LEVEL_ID, decodeReplay, hashLevel, hashToHex, MAX_REPLAY_TICKS, parseLevel, verifyCustomReplay, type Level } from '../../src/sim';
import { isPlayerId, sanitizeName, TOP_N, type BoardView, type ErrorResult, type SubmitResult } from '../../src/net/scoresApi';
import {
  checkDoc,
  isWorkshopId,
  makeThumb,
  WS_ID_ALPHABET,
  WS_ID_LENGTH,
  WS_MAX_PER_AUTHOR,
  WS_PAGE,
  WS_REPORTS_TO_HIDE,
  type PublishResult,
  type WorkshopBoardResult,
  type WorkshopGetResult,
  type WorkshopListResult,
  type WorkshopModeFilter,
  type WorkshopParent,
  type WorkshopSummary,
} from '../../src/net/workshopApi';
import type { ScoreStore } from '../scores/store';
import type { WorkshopRecord, WorkshopStore } from './store';

/** Une carte de 600 × 160 et un replay de 10 min tiennent largement dedans. */
export const WS_MAX_BODY_CHARS = 800_000;
export const WS_RATE_READS_PER_MIN = 120;
export const WS_RATE_PUBLISH_PER_MIN = 6;
export const WS_RATE_SUBMITS_PER_MIN = 12;
/** Au-delà, une liste ne va pas plus loin (on ne pagine pas à l'infini). */
export const WS_MAX_OFFSET = 2000;

export interface WorkshopDeps {
  ws: WorkshopStore;
  /** Pseudos, classements et limitation de débit : le store du classement. */
  scores: ScoreStore;
  /** Clé d'admin (variable WORKSHOP_ADMIN_KEY) : supprime n'importe quelle carte. Vide = aucune. */
  adminKey?: string;
  now?: () => number;
  newId?: () => string;
}

export interface WorkshopRequest {
  method: string;
  query: URLSearchParams;
  body: string | null;
  ip: string;
}

export interface WorkshopResponse {
  status: number;
  body: unknown;
}

const fail = (status: number, error: string): WorkshopResponse => ({ status, body: { ok: false, error } satisfies ErrorResult });

/** Tableau du classement d'une carte du workshop : un par version de la géométrie. */
export function workshopBoardKey(id: string, hash: string): string {
  return `lb:ws:${id}:${hash}`;
}

function randomId(): string {
  const b = new Uint8Array(WS_ID_LENGTH);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < WS_ID_LENGTH; i++) s += WS_ID_ALPHABET[b[i] % WS_ID_ALPHABET.length];
  return s;
}

/** Comparaison à temps constant (la clé d'admin ne se devine pas au chronomètre). */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function toSummary(rec: WorkshopRecord, plays: number, author: string | null, viewer: string | null): WorkshopSummary {
  return {
    id: rec.id,
    name: rec.name,
    mode: rec.mode,
    theme: rec.theme,
    width: rec.width,
    height: rec.height,
    author: author ?? 'Anonyme',
    mine: viewer !== null && viewer === rec.authorId,
    created: rec.created,
    updated: rec.updated,
    version: rec.version,
    plays,
    authorTicks: rec.authorTicks,
    hash: rec.hash,
    parent: rec.parent,
    thumb: rec.thumb,
  };
}

async function summaries(deps: WorkshopDeps, recs: WorkshopRecord[], viewer: string | null): Promise<WorkshopSummary[]> {
  const [plays, names] = await Promise.all([deps.ws.plays(recs.map((r) => r.id)), deps.scores.names(recs.map((r) => r.authorId))]);
  return recs.map((r, i) => toSummary(r, plays[i] ?? 0, names[i], viewer));
}

/** La carte telle que la sim la lit (les lignes du store ont été contrôlées à la publication). */
function levelOf(rec: WorkshopRecord, rows: string[]): Level {
  return parseLevel(rows, [], rec.name, 'Workshop', rec.mode);
}

async function boardView(deps: WorkshopDeps, rec: WorkshopRecord, playerId: string | null): Promise<BoardView> {
  const key = workshopBoardKey(rec.id, rec.hash);
  const { scores } = deps;
  const [rows, total, me] = await Promise.all([scores.top(key, TOP_N), scores.count(key), playerId ? scores.rank(key, playerId) : Promise.resolve(null)]);
  const names = await scores.names(rows.map((r) => r.playerId));
  return {
    level: CUSTOM_LEVEL_ID,
    total,
    top: rows.map((r, i) => ({ rank: i + 1, name: names[i] ?? 'Anonyme', ticks: r.ticks })),
    me,
  };
}

/** Une carte visible pour ce joueur : cachée = seulement pour son auteur. */
async function visible(deps: WorkshopDeps, id: unknown, viewer: string | null): Promise<WorkshopRecord | null> {
  if (!isWorkshopId(id)) return null;
  const rec = await deps.ws.meta(id);
  if (!rec) return null;
  if (rec.hidden && rec.authorId !== viewer) return null;
  return rec;
}

export async function handleWorkshop(req: WorkshopRequest, deps: WorkshopDeps): Promise<WorkshopResponse> {
  const { ws, scores } = deps;
  const now = deps.now ?? (() => Date.now());
  try {
    if ((await scores.hit(`ws:rl:${req.ip}`, 60)) > WS_RATE_READS_PER_MIN) return fail(429, 'trop de requêtes, réessaie dans une minute');

    if (req.method === 'GET') {
      const q = req.query;
      const pid = q.get('playerId');
      const viewer = isPlayerId(pid) ? pid : null;

      if (q.has('id')) {
        const rec = await visible(deps, q.get('id'), viewer);
        if (!rec) return fail(404, 'carte introuvable (supprimée ?)');
        const [rows, signs] = await Promise.all([ws.rows(rec.id), ws.signs(rec.id)]);
        if (!rows) return fail(404, 'carte introuvable (supprimée ?)');
        const [summary] = await summaries(deps, [rec], viewer);
        return { status: 200, body: { ok: true, map: { ...summary, rows, ...(signs.length ? { signs } : {}) } } satisfies WorkshopGetResult };
      }

      if (q.has('board')) {
        const rec = await visible(deps, q.get('board'), viewer);
        if (!rec) return fail(404, 'carte introuvable (supprimée ?)');
        return { status: 200, body: { ok: true, id: rec.id, ...(await boardView(deps, rec, viewer)) } satisfies WorkshopBoardResult };
      }

      const sort = q.get('list') ?? 'recent';
      const mode = (q.get('mode') ?? 'all') as WorkshopModeFilter;
      if (mode !== 'all' && mode !== 'race' && mode !== 'kills') return fail(400, 'mode inconnu');
      const offset = Math.floor(Number(q.get('offset') ?? 0));
      if (!Number.isFinite(offset) || offset < 0 || offset > WS_MAX_OFFSET) return fail(400, 'page invalide');

      if (sort === 'mine') {
        if (!viewer) return fail(400, 'identifiant de joueur invalide');
        const recs = (await ws.metas(await ws.byAuthor(viewer))).filter((r): r is WorkshopRecord => r !== null && (mode === 'all' || r.mode === mode));
        recs.sort((a, b) => b.updated - a.updated);
        const page = recs.slice(offset, offset + WS_PAGE);
        return { status: 200, body: { ok: true, items: await summaries(deps, page, viewer), total: recs.length, offset } satisfies WorkshopListResult };
      }
      if (sort !== 'recent' && sort !== 'popular') return fail(400, 'liste inconnue');
      const { ids, total } = await ws.list(sort, mode, offset, WS_PAGE);
      const recs = (await ws.metas(ids)).filter((r): r is WorkshopRecord => r !== null && !r.hidden);
      return { status: 200, body: { ok: true, items: await summaries(deps, recs, viewer), total, offset } satisfies WorkshopListResult };
    }

    if (req.method !== 'POST') return fail(405, 'méthode non autorisée');
    if (!req.body || req.body.length > WS_MAX_BODY_CHARS) return fail(413, 'requête trop grosse');
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return fail(400, 'JSON invalide');
    }
    if (!body || typeof body !== 'object') return fail(400, 'JSON invalide');

    // Admin : suppression sans être l'auteur.
    if (body.action === 'delete' && typeof body.adminKey === 'string' && deps.adminKey && sameKey(body.adminKey, deps.adminKey)) {
      if (!isWorkshopId(body.id)) return fail(400, 'carte inconnue');
      const rec = await ws.meta(body.id);
      if (!rec) return fail(404, 'carte introuvable');
      await ws.remove(rec);
      await scores.drop(workshopBoardKey(rec.id, rec.hash));
      return { status: 200, body: { ok: true } };
    }

    if (!isPlayerId(body.playerId)) return fail(400, 'identifiant de joueur invalide');
    const playerId = body.playerId;

    switch (body.action) {
      case 'publish':
        return await publish(deps, body, playerId, req.ip, now());
      case 'score':
        return await score(deps, body, playerId, req.ip);
      case 'play': {
        const rec = await visible(deps, body.id, playerId);
        if (!rec) return fail(404, 'carte introuvable');
        return { status: 200, body: { ok: true, plays: await ws.addPlay(rec, playerId) } };
      }
      case 'report': {
        const rec = await visible(deps, body.id, playerId);
        if (!rec) return fail(404, 'carte introuvable');
        if (rec.authorId === playerId) return fail(400, 'tu ne peux pas signaler ta propre carte');
        const n = await ws.report(rec.id, playerId);
        if (n >= WS_REPORTS_TO_HIDE && !rec.hidden) await ws.hide(rec);
        return { status: 200, body: { ok: true } };
      }
      case 'delete': {
        if (!isWorkshopId(body.id)) return fail(400, 'carte inconnue');
        const rec = await ws.meta(body.id);
        if (!rec) return fail(404, 'carte introuvable');
        if (rec.authorId !== playerId) return fail(403, 'seul son auteur peut supprimer cette carte');
        await ws.remove(rec);
        await scores.drop(workshopBoardKey(rec.id, rec.hash));
        return { status: 200, body: { ok: true } };
      }
      default:
        return fail(400, 'action inconnue');
    }
  } catch (e) {
    return fail(503, `workshop indisponible (${e instanceof Error ? e.message : 'erreur'})`);
  }
}

async function publish(deps: WorkshopDeps, body: Record<string, unknown>, playerId: string, ip: string, now: number): Promise<WorkshopResponse> {
  const { ws, scores } = deps;
  if ((await scores.hit(`ws:rp:${ip}`, 60)) > WS_RATE_PUBLISH_PER_MIN) return fail(429, 'trop de publications, réessaie dans une minute');
  const author = sanitizeName(body.name);
  if (!author) return fail(400, 'pseudo invalide (3 à 16 caractères : lettres, chiffres, espace, - _ .)');
  const checked = checkDoc(body.map);
  if (!checked.ok) return fail(400, `carte refusée : ${checked.error}`);
  const doc = checked.doc;
  let level: Level;
  try {
    level = parseLevel(doc.rows, [], doc.name, 'Workshop', doc.mode);
  } catch (e) {
    return fail(400, `carte refusée : ${e instanceof Error ? e.message : 'illisible'}`);
  }
  if (typeof body.replay !== 'string') return fail(400, 'preuve manquante : termine ta carte en test avant de la publier');
  const replay = decodeReplay(body.replay, MAX_REPLAY_TICKS);
  if (!replay) return fail(400, 'preuve illisible');
  const verdict = verifyCustomReplay(replay, level);
  if (!verdict.ok) return fail(422, `preuve refusée : ${verdict.reason}`);
  const hash = hashToHex(hashLevel(level));

  let prev: WorkshopRecord | null = null;
  if (body.id !== undefined) {
    if (!isWorkshopId(body.id)) return fail(400, 'carte inconnue');
    prev = await ws.meta(body.id);
    if (!prev) return fail(404, 'carte introuvable (supprimée ?) : publie-la comme une nouvelle carte');
    if (prev.authorId !== playerId) return fail(403, 'seul son auteur peut republier cette carte');
  } else if ((await ws.byAuthor(playerId)).length >= WS_MAX_PER_AUTHOR) {
    return fail(409, `tu as déjà ${WS_MAX_PER_AUTHOR} cartes publiées : supprimes-en une avant d'en publier une autre`);
  }

  let parent: WorkshopParent | null = prev?.parent ?? null;
  if (!prev && isWorkshopId(body.parentId)) {
    const p = await ws.meta(body.parentId);
    if (p && !p.hidden) {
      const [name] = await scores.names([p.authorId]);
      parent = { id: p.id, name: p.name, author: name ?? 'Anonyme' };
    }
  }

  let id = prev?.id ?? '';
  if (!prev) {
    const make = deps.newId ?? randomId;
    for (let i = 0; i < 8 && (!id || (await ws.meta(id))); i++) id = make();
    if (!isWorkshopId(id) || (await ws.meta(id))) return fail(503, 'impossible de créer la carte, réessaie');
  }
  const rec: WorkshopRecord = {
    id,
    name: doc.name,
    mode: doc.mode,
    theme: doc.theme,
    width: doc.rows[0].length,
    height: doc.rows.length,
    authorId: playerId,
    created: prev?.created ?? now,
    updated: now,
    version: (prev?.version ?? 0) + 1,
    authorTicks: verdict.finishTick,
    hash,
    parent,
    thumb: makeThumb(doc.rows),
    hidden: prev?.hidden ?? false,
  };
  await ws.save(rec, doc.rows, doc.signs);
  // Géométrie changée : l'ancien classement ne vaut plus rien.
  if (prev && prev.hash !== hash) await scores.drop(workshopBoardKey(prev.id, prev.hash));
  // Le temps de l'auteur ouvre le classement de sa carte.
  await scores.setName(playerId, author);
  await scores.submit(workshopBoardKey(id, hash), playerId, verdict.finishTick);
  const [summary] = await summaries(deps, [rec], playerId);
  return { status: 200, body: { ok: true, map: summary, created: !prev } satisfies PublishResult };
}

async function score(deps: WorkshopDeps, body: Record<string, unknown>, playerId: string, ip: string): Promise<WorkshopResponse> {
  const { ws, scores } = deps;
  if ((await scores.hit(`ws:rs:${ip}`, 60)) > WS_RATE_SUBMITS_PER_MIN) return fail(429, 'trop de parties envoyées, réessaie dans une minute');
  const name = sanitizeName(body.name);
  if (!name) return fail(400, 'pseudo invalide (3 à 16 caractères : lettres, chiffres, espace, - _ .)');
  const rec = await visible(deps, body.id, playerId);
  if (!rec) return fail(404, 'carte introuvable (supprimée ?)');
  const rows = await ws.rows(rec.id);
  if (!rows) return fail(404, 'carte introuvable (supprimée ?)');
  if (typeof body.replay !== 'string') return fail(400, 'replay manquant');
  const replay = decodeReplay(body.replay, MAX_REPLAY_TICKS);
  if (!replay) return fail(400, 'replay illisible');
  const verdict = verifyCustomReplay(replay, levelOf(rec, rows));
  if (!verdict.ok) return fail(422, `partie refusée : ${verdict.reason}`);
  const key = workshopBoardKey(rec.id, rec.hash);
  const previous = await scores.submit(key, playerId, verdict.finishTick);
  await scores.setName(playerId, name);
  const v = await boardView(deps, rec, playerId);
  const result: SubmitResult & { id: string } = {
    ok: true,
    id: rec.id,
    ...v,
    ticks: verdict.finishTick,
    previous,
    improved: previous === null || verdict.finishTick < previous,
  };
  return { status: 200, body: result };
}
