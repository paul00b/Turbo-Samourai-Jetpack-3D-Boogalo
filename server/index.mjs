/**
 * Relais de sessions : le serveur crée un code, apparie deux joueurs, et relaie les enveloppes
 * entre eux. Il ne simule rien et ne lit jamais le contenu de `relay.d` : le netcode est côté client.
 *
 *   npm run server            # port 8787
 *   PORT=9000 npm run server
 *
 * Pour jouer à deux machines sur le même réseau : lancer `npm run dev -- --host`, et pointer le
 * champ "Serveur" du menu sur ws://<ip-de-la-machine-hote>:8787.
 */
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const PROTOCOL_VERSION = 1;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
/** Une session vide (créée mais jamais rejointe) est ramassée au bout de ça. */
const EMPTY_SESSION_TTL_MS = 15 * 60 * 1000;

/** code -> { code, peers: [ws|null, ws|null], createdAt } */
const sessions = new Map();

function makeCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!sessions.has(code)) return code;
  }
  throw new Error('Impossible de générer un code libre');
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function peerOf(ws) {
  const s = ws.session;
  if (!s) return null;
  return s.peers[ws.slot === 0 ? 1 : 0];
}

function leave(ws) {
  const s = ws.session;
  if (!s) return;
  s.peers[ws.slot] = null;
  ws.session = null;
  const other = s.peers[0] ?? s.peers[1];
  if (other) send(other, { t: 'peer-left' });
  else sessions.delete(s.code);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.session = null;
  ws.slot = -1;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { t: 'error', reason: 'bad-message', detail: 'JSON invalide' });
      return;
    }
    switch (msg?.t) {
      case 'host': {
        if (msg.version !== PROTOCOL_VERSION) return send(ws, { t: 'error', reason: 'bad-version' });
        leave(ws);
        const code = makeCode();
        const session = { code, peers: [ws, null], createdAt: Date.now() };
        sessions.set(code, session);
        ws.session = session;
        ws.slot = 0;
        send(ws, { t: 'hosted', code, slot: 0 });
        break;
      }
      case 'join': {
        if (msg.version !== PROTOCOL_VERSION) return send(ws, { t: 'error', reason: 'bad-version' });
        const code = String(msg.code ?? '').toUpperCase();
        if (code.length !== CODE_LENGTH) return send(ws, { t: 'error', reason: 'bad-code' });
        const session = sessions.get(code);
        if (!session) return send(ws, { t: 'error', reason: 'no-such-session' });
        if (session.peers[1]) return send(ws, { t: 'error', reason: 'session-full' });
        leave(ws);
        session.peers[1] = ws;
        ws.session = session;
        ws.slot = 1;
        send(ws, { t: 'joined', code, slot: 1 });
        send(session.peers[0], { t: 'peer-joined' });
        break;
      }
      case 'relay': {
        const other = peerOf(ws);
        if (other) send(other, { t: 'relay', d: msg.d });
        break;
      }
      default:
        send(ws, { t: 'error', reason: 'bad-message', detail: `type inconnu : ${msg?.t}` });
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// Ping applicatif : coupe les sockets zombies (NAT, veille) et les sessions vides oubliées.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, s] of sessions) {
    if (!s.peers[1] && now - s.createdAt > EMPTY_SESSION_TTL_MS) {
      if (s.peers[0]) s.peers[0].session = null;
      sessions.delete(code);
    }
  }
}, 15000);
wss.on('close', () => clearInterval(heartbeat));

console.log(`[tsj] relais de sessions sur ws://localhost:${PORT} (protocole v${PROTOCOL_VERSION})`);
