/**
 * Session réseau : une WebSocket vers le relais, un code, deux slots. Ne connaît pas la sim.
 * Tout ce qui concerne le jeu passe par `sendPeer` / l'événement 'peer'.
 */
import {
  PROTOCOL_VERSION,
  SERVER_ERROR_FR,
  type PeerMsg,
  type ServerMsg,
} from './protocol';

export type SessionStatus =
  | 'idle'
  | 'connecting'
  /** Hôte connecté, code obtenu, en attente de l'autre joueur. */
  | 'waiting'
  /** Les deux joueurs sont là. */
  | 'connected'
  | 'error'
  | 'closed';

export interface SessionEvents {
  onStatus?: (status: SessionStatus, session: NetSession) => void;
  onPeer?: (msg: PeerMsg) => void;
}

export class NetSession {
  status: SessionStatus = 'idle';
  code = '';
  /** 0 = hôte, 1 = invité, -1 = pas encore attribué. */
  slot = -1;
  error = '';
  /** Aller-retour mesuré avec le pair (ms), -1 si inconnu. */
  rttMs = -1;
  private ws: WebSocket | null = null;
  private pingTimer = 0;

  constructor(private readonly events: SessionEvents = {}) {}

  get isHost(): boolean {
    return this.slot === 0;
  }

  host(url: string): void {
    this.open(url, '');
  }

  join(url: string, code: string): void {
    this.open(url, code);
  }

  private open(url: string, joinCode: string): void {
    this.close(false);
    this.error = '';
    this.code = '';
    this.slot = -1;
    this.rttMs = -1;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.fail(`URL de serveur invalide : ${(e as Error).message}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (joinCode) ws.send(JSON.stringify({ t: 'join', version: PROTOCOL_VERSION, code: joinCode }));
      else ws.send(JSON.stringify({ t: 'host', version: PROTOCOL_VERSION }));
    };
    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onerror = () => {
      // onerror ne dit rien d'exploitable dans le navigateur : le message utile est l'URL.
      if (this.status === 'connecting') this.fail(`Connexion impossible à ${url}. Le relais tourne-t-il (npm run server) ?`);
    };
    ws.onclose = () => {
      this.stopPing();
      if (this.status !== 'error') this.setStatus('closed');
    };
  }

  private handle(data: unknown): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(String(data)) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'hosted':
        this.code = msg.code;
        this.slot = 0;
        this.setStatus('waiting');
        break;
      case 'joined':
        this.code = msg.code;
        this.slot = 1;
        this.setStatus('connected');
        this.startPing();
        break;
      case 'peer-joined':
        this.setStatus('connected');
        this.startPing();
        break;
      case 'peer-left':
        this.rttMs = -1;
        this.setStatus(this.isHost ? 'waiting' : 'closed');
        break;
      case 'relay':
        this.onPeerMsg(msg.d);
        break;
      case 'error':
        this.fail(SERVER_ERROR_FR[msg.reason] ?? msg.reason);
        break;
    }
  }

  private onPeerMsg(d: PeerMsg): void {
    if (d.t === 'ping') {
      this.sendPeer({ t: 'pong', ts: d.ts });
      return;
    }
    if (d.t === 'pong') {
      this.rttMs = Math.max(0, Math.round(performance.now() - d.ts));
      return;
    }
    if (d.t === 'bye') {
      this.setStatus(this.isHost ? 'waiting' : 'closed');
      return;
    }
    this.events.onPeer?.(d);
  }

  sendPeer(d: PeerMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'relay', d }));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => this.sendPeer({ t: 'ping', ts: performance.now() }), 1000);
  }

  private stopPing(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }

  private fail(message: string): void {
    this.error = message;
    this.setStatus('error');
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  close(notify = true): void {
    this.stopPing();
    if (this.ws) {
      if (notify) this.sendPeer({ t: 'bye' });
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.code = '';
    this.slot = -1;
    this.rttMs = -1;
    if (this.status !== 'idle') this.setStatus('idle');
  }

  private setStatus(s: SessionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.events.onStatus?.(s, this);
  }
}
