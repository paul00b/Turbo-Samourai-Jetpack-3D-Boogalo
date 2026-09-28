/**
 * `/api/scores` pendant `npm run dev` et `npm run preview` : le même handler que la fonction
 * Vercel, sur un store en mémoire (perdu au redémarrage). Si les variables Upstash sont définies
 * dans l'environnement du shell, c'est Upstash qui sert, comme en prod.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { handleScores } from './handler';
import { MemoryStore, type ScoreStore } from './store';
import { UpstashStore } from './upstash';

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

export function scoresDevPlugin(): Plugin {
  const store: ScoreStore = UpstashStore.fromEnv(process.env) ?? new MemoryStore();
  return {
    name: 'tsj-scores',
    configureServer(server) {
      server.middlewares.use(scoresMiddleware(store));
    },
    configurePreviewServer(server) {
      server.middlewares.use(scoresMiddleware(store));
    },
  };
}
