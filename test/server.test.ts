import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { CODE_LENGTH, isValidCode, PROTOCOL_VERSION, type ServerMsg } from '../src/net/protocol';

const PORT = 8899;
const URL = `ws://127.0.0.1:${PORT}`;
let proc: ChildProcess;

/** Ouvre une socket et attend qu'elle soit prête. */
async function connect(): Promise<WebSocket> {
  const ws = new WebSocket(URL);
  await once(ws, 'open');
  return ws;
}

/** Prochain message serveur reçu sur cette socket. */
function next(ws: WebSocket): Promise<ServerMsg> {
  return new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()) as ServerMsg)));
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

beforeAll(async () => {
  proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  // Le serveur logue une ligne quand il écoute.
  await Promise.race([once(proc.stdout!, 'data'), new Promise((r) => setTimeout(r, 3000))]);
});

afterAll(() => {
  proc.kill();
});

describe('relais de sessions', () => {
  it('héberger donne un code valide, rejoindre apparie les deux joueurs', async () => {
    const host = await connect();
    send(host, { t: 'host', version: PROTOCOL_VERSION });
    const hosted = await next(host);
    expect(hosted.t).toBe('hosted');
    const code = (hosted as { code: string }).code;
    expect(code).toHaveLength(CODE_LENGTH);
    expect(isValidCode(code)).toBe(true);
    expect((hosted as { slot: number }).slot).toBe(0);

    const guest = await connect();
    const hostSeesJoin = next(host);
    send(guest, { t: 'join', version: PROTOCOL_VERSION, code });
    const joined = await next(guest);
    expect(joined.t).toBe('joined');
    expect((joined as { slot: number }).slot).toBe(1);
    expect((await hostSeesJoin).t).toBe('peer-joined');

    // Relais : ce que l'un envoie, l'autre le reçoit tel quel.
    const gotByGuest = next(guest);
    send(host, { t: 'relay', d: { t: 'in', first: 7, inputs: [1, 2, 3] } });
    const relayed = await gotByGuest;
    expect(relayed).toEqual({ t: 'relay', d: { t: 'in', first: 7, inputs: [1, 2, 3] } });

    // Départ d'un pair : l'autre est prévenu.
    const hostSeesLeave = next(host);
    guest.close();
    expect((await hostSeesLeave).t).toBe('peer-left');
    host.close();
  });

  it('un code inconnu est refusé, une session pleine aussi', async () => {
    const a = await connect();
    send(a, { t: 'join', version: PROTOCOL_VERSION, code: 'ZZZZZZ' });
    const err = await next(a);
    expect(err).toMatchObject({ t: 'error', reason: 'no-such-session' });

    send(a, { t: 'host', version: PROTOCOL_VERSION });
    const code = (await next(a) as { code: string }).code;
    const b = await connect();
    send(b, { t: 'join', version: PROTOCOL_VERSION, code });
    await next(b);
    await next(a); // peer-joined
    const c = await connect();
    send(c, { t: 'join', version: PROTOCOL_VERSION, code });
    expect(await next(c)).toMatchObject({ t: 'error', reason: 'session-full' });
    for (const ws of [a, b, c]) ws.close();
  });

  it('répond en HTTP sur / (contrôle de santé des hébergeurs), 404 ailleurs', async () => {
    const ok = await fetch(`http://127.0.0.1:${PORT}/`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('OK');
    const missing = await fetch(`http://127.0.0.1:${PORT}/nope`);
    expect(missing.status).toBe(404);
  });

  it('une version de protocole différente est refusée', async () => {
    const ws = await connect();
    send(ws, { t: 'host', version: PROTOCOL_VERSION + 99 });
    expect(await next(ws)).toMatchObject({ t: 'error', reason: 'bad-version' });
    ws.close();
  });
});
