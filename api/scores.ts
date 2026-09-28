/**
 * Fonction Vercel `/api/scores` : adaptateur Request/Response autour de handleScores.
 * Runtime Edge : Vercel la bundle (esbuild) avec la sim, et Upstash se parle en `fetch`.
 * Variables d'environnement du projet Vercel : UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
 */
import { handleScores } from '../server/scores/handler';
import { UpstashStore } from '../server/scores/upstash';

export const config = { runtime: 'edge' };

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function scores(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  const store = UpstashStore.fromEnv(process.env);
  if (!store) {
    return new Response(JSON.stringify({ ok: false, error: 'classement non configuré (variables Upstash manquantes)' }), { status: 503, headers: HEADERS });
  }
  const url = new URL(req.url);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'inconnu';
  const res = await handleScores(
    { method: req.method, query: url.searchParams, body: req.method === 'POST' ? await req.text() : null, ip },
    { store },
  );
  return new Response(JSON.stringify(res.body), { status: res.status, headers: HEADERS });
}
