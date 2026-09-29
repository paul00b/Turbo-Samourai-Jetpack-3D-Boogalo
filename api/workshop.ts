/**
 * Fonction Vercel `/api/workshop` : adaptateur Request/Response autour de handleWorkshop.
 * Même base Upstash que le classement (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN).
 * WORKSHOP_ADMIN_KEY (facultative) : la clé qui permet de supprimer n'importe quelle carte.
 */
import { handleWorkshop } from '../server/workshop/handler';
import { UpstashWorkshopStore } from '../server/workshop/upstash';
import { UpstashStore } from '../server/scores/upstash';

export const config = { runtime: 'edge' };

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function workshop(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  const scores = UpstashStore.fromEnv(process.env);
  if (!scores) {
    return new Response(JSON.stringify({ ok: false, error: 'workshop non configuré (variables Upstash manquantes)' }), { status: 503, headers: HEADERS });
  }
  const url = new URL(req.url);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'inconnu';
  const res = await handleWorkshop(
    { method: req.method, query: url.searchParams, body: req.method === 'POST' ? await req.text() : null, ip },
    { ws: new UpstashWorkshopStore((cmds) => scores.pipeline(cmds)), scores, adminKey: process.env.WORKSHOP_ADMIN_KEY ?? '' },
  );
  return new Response(JSON.stringify(res.body), { status: res.status, headers: HEADERS });
}
