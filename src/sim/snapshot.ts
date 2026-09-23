/**
 * Snapshot binaire complet de l'état (base du rollback / des replays / du debug cross-navigateur).
 * Format : little-endian, champs dans un ordre fixe. Bump SNAPSHOT_VERSION à tout changement de layout.
 */
import { PARAM_KEYS, type SimParams, DEFAULT_PARAMS } from './params';
import { MAX_PLAYERS, makeHook, makePlayer, type EnemyState, type GameState, type HookState, type PlayerState } from './state';

export const SNAPSHOT_MAGIC = 0x54534a42; // "TSJB"
export const SNAPSHOT_VERSION = 1;

class Writer {
  private buf = new ArrayBuffer(1024);
  private view = new DataView(this.buf);
  private pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb);
  }
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }
  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v | 0, true);
    this.pos += 4;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v & 0xffff, true);
    this.pos += 2;
  }
  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, v & 0xff);
    this.pos += 1;
  }
  i8(v: number): void {
    this.ensure(1);
    this.view.setInt8(this.pos, v);
    this.pos += 1;
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.buf.slice(0, this.pos));
  }
}

class Reader {
  private view: DataView;
  private pos = 0;
  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  i8(): number {
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }
}

function writeHook(w: Writer, h: HookState): void {
  w.u8(h.state);
  w.f64(h.x);
  w.f64(h.y);
  w.f64(h.dirX);
  w.f64(h.dirY);
  w.f64(h.travelled);
  w.f64(h.originX);
  w.f64(h.originY);
  w.f64(h.length);
  w.i8(h.target);
  w.u8(h.reeling);
  w.f64(h.reelDelta);
}

function readHook(r: Reader): HookState {
  const h = makeHook();
  h.state = r.u8();
  h.x = r.f64();
  h.y = r.f64();
  h.dirX = r.f64();
  h.dirY = r.f64();
  h.travelled = r.f64();
  h.originX = r.f64();
  h.originY = r.f64();
  h.length = r.f64();
  h.target = r.i8();
  h.reeling = r.u8();
  h.reelDelta = r.f64();
  return h;
}

function writePlayer(w: Writer, p: PlayerState): void {
  w.f64(p.x);
  w.f64(p.y);
  w.f64(p.vx);
  w.f64(p.vy);
  w.u16(p.prevButtons);
  w.f64(p.aimX);
  w.f64(p.aimY);
  w.u8(p.grounded);
  w.f64(p.heat);
  w.u8(p.overheated);
  w.u8(p.jetThrust);
  w.i8(p.walkDir);
  w.i8(p.facing);
  w.i32(p.hp);
  w.u32(p.deaths);
  w.u32(p.spawnTick);
  w.u32(p.teleportSeq);
  w.i32(p.cutPressTick);
  w.i32(p.invuln);
  w.i32(p.pendingCutEnemy);
  w.i32(p.pendingCutTicks);
  w.f64(p.lastImpact);
  writeHook(w, p.hooks[0]);
  writeHook(w, p.hooks[1]);
}

function readPlayer(r: Reader): PlayerState {
  const p = makePlayer(0, 0, 0);
  p.x = r.f64();
  p.y = r.f64();
  p.vx = r.f64();
  p.vy = r.f64();
  p.prevButtons = r.u16();
  p.aimX = r.f64();
  p.aimY = r.f64();
  p.grounded = r.u8();
  p.heat = r.f64();
  p.overheated = r.u8();
  p.jetThrust = r.u8();
  p.walkDir = r.i8();
  p.facing = r.i8();
  p.hp = r.i32();
  p.deaths = r.u32();
  p.spawnTick = r.u32();
  p.teleportSeq = r.u32();
  p.cutPressTick = r.i32();
  p.invuln = r.i32();
  p.pendingCutEnemy = r.i32();
  p.pendingCutTicks = r.i32();
  p.lastImpact = r.f64();
  p.hooks = [readHook(r), readHook(r)];
  return p;
}

function writeEnemy(w: Writer, e: EnemyState): void {
  w.f64(e.x);
  w.f64(e.y);
  w.f64(e.w);
  w.f64(e.h);
  w.f64(e.spawnX);
  w.f64(e.spawnY);
  w.u8(e.alive);
  w.u8(e.patrol);
  w.i8(e.dir);
  w.f64(e.speed);
  w.i32(e.respawnTimer);
}

function readEnemy(r: Reader): EnemyState {
  return {
    x: r.f64(),
    y: r.f64(),
    w: r.f64(),
    h: r.f64(),
    spawnX: r.f64(),
    spawnY: r.f64(),
    alive: r.u8(),
    patrol: r.u8(),
    dir: r.i8(),
    speed: r.f64(),
    respawnTimer: r.i32(),
  };
}

export function serializeState(s: GameState): Uint8Array {
  const w = new Writer();
  w.u32(SNAPSHOT_MAGIC);
  w.u16(SNAPSHOT_VERSION);
  w.u8(s.playerCount);
  w.u8(s.levelId);
  w.u32(s.tick);
  w.u32(s.seed);
  w.i32(s.rng);
  w.u16(PARAM_KEYS.length);
  for (let i = 0; i < PARAM_KEYS.length; i++) w.f64(s.params[PARAM_KEYS[i]]);
  w.u8(s.players.length);
  for (let i = 0; i < s.players.length; i++) writePlayer(w, s.players[i]);
  w.u16(s.enemies.length);
  for (let i = 0; i < s.enemies.length; i++) writeEnemy(w, s.enemies[i]);
  return w.bytes();
}

export function deserializeState(bytes: Uint8Array): GameState {
  const r = new Reader(bytes);
  if (r.u32() !== SNAPSHOT_MAGIC) throw new Error('Snapshot invalide (magic)');
  const version = r.u16();
  if (version !== SNAPSHOT_VERSION) throw new Error(`Version de snapshot ${version} non supportée`);
  const playerCount = r.u8();
  const levelId = r.u8();
  const tick = r.u32();
  const seed = r.u32();
  const rng = r.i32();
  const nParams = r.u16();
  const params = { ...DEFAULT_PARAMS } as SimParams;
  for (let i = 0; i < nParams; i++) {
    const v = r.f64();
    if (i < PARAM_KEYS.length) params[PARAM_KEYS[i]] = v;
  }
  const nPlayers = r.u8();
  const players: PlayerState[] = [];
  for (let i = 0; i < nPlayers; i++) players.push(readPlayer(r));
  while (players.length < MAX_PLAYERS) players.push(makePlayer(0, 0, params.maxHp));
  const nEnemies = r.u16();
  const enemies: EnemyState[] = [];
  for (let i = 0; i < nEnemies; i++) enemies.push(readEnemy(r));
  return { tick, seed, rng, levelId, playerCount, params, players, enemies };
}

/** FNV-1a 32 bits sur le snapshot : empreinte compacte de l'état, comparable entre navigateurs. */
export function hashBytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashState(s: GameState): number {
  return hashBytes(serializeState(s));
}

export function hashToHex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
