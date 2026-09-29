/**
 * `/api/scores` et `/api/workshop` pendant `npm run dev` et `npm run preview` : les mêmes handlers
 * que les fonctions Vercel, sur des stores en mémoire (perdus au redémarrage). Si les variables
 * Upstash sont définies dans l'environnement du shell, c'est Upstash qui sert, comme en prod.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { handleScores } from './handler';
import { MemoryStore, type ScoreStore } from './store';
import { UpstashStore } from './upstash';
import { handleWorkshop, WS_MAX_BODY_CHARS } from '../workshop/handler';
import { MemoryWorkshopStore, type WorkshopStore } from '../workshop/store';
import { UpstashWorkshopStore } from '../workshop/upstash';

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => resolve(size > limit ? 'x'.repeat(limit + 1) : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

export function scoresMiddleware(store: ScoreStore): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/scores' && !url.pathname.endsWith('/api/scores')) return next();
    void (async () => {
      const body = req.method === 'POST' ? await readBody(req, 700_000) : null;
      const out = await handleScores({ method: req.method ?? 'GET', query: url.searchParams, body, ip: req.socket.remoteAddress ?? 'local' }, { store });
      res.statusCode = out.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(out.body));
    })();
  };
}

export function workshopMiddleware(ws: WorkshopStore, scores: ScoreStore, adminKey = ''): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/workshop' && !url.pathname.endsWith('/api/workshop')) return next();
    void (async () => {
      const body = req.method === 'POST' ? await readBody(req, WS_MAX_BODY_CHARS) : null;
      const out = await handleWorkshop({ method: req.method ?? 'GET', query: url.searchParams, body, ip: req.socket.remoteAddress ?? 'local' }, { ws, scores, adminKey });
      res.statusCode = out.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(out.body));
    })();
  };
}

export function scoresDevPlugin(): Plugin {
  const upstash = UpstashStore.fromEnv(process.env);
  const store: ScoreStore = upstash ?? new MemoryStore();
  const ws: WorkshopStore = upstash ? new UpstashWorkshopStore((cmds) => upstash.pipeline(cmds)) : new MemoryWorkshopStore();
  const adminKey = process.env.WORKSHOP_ADMIN_KEY ?? '';
  return {
    name: 'tsj-scores',
    configureServer(server) {
      server.middlewares.use(scoresMiddleware(store));
      server.middlewares.use(workshopMiddleware(ws, store, adminKey));
    },
    configurePreviewServer(server) {
      server.middlewares.use(scoresMiddleware(store));
      server.middlewares.use(workshopMiddleware(ws, store, adminKey));
    },
  };
}
