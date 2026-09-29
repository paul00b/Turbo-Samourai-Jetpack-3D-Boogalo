/**
 * Replays pour le classement : ce que le client envoie, ce que le serveur rejoue.
 *
 * Un replay = la seed, la carte (id + empreinte), l'empreinte des params et les inputs du joueur 1
 * à chaque tick depuis le tick 0. La sim étant déterministe, rejouer ces inputs redonne exactement
 * la même partie : le serveur recalcule le temps lui-même, il ne croit jamais celui du client.
 *
 * Format binaire (little endian), puis base64 :
 *   'TSJ1' | u32 seed | u8 levelId | u32 levelHash | u32 paramsHash | u32 ticks | u32 runs |
 *   runs x (u32 input packé, varint longueur)
 * Les inputs identiques d'un tick à l'autre sont regroupés (RLE) : tenir une direction ou un
 * grappin sans bouger la visée ne coûte presque rien.
 */
import { DEFAULT_PARAMS, PARAM_KEYS, type SimParams } from './params';
import { CUSTOM_LEVEL_ID, getCustomLevel, getLevel, LEVELS, setCustomLevel, type Level } from './level';
import { makeInput, unpackInput, type PlayerInput } from './input';
import { createInitialState } from './state';
import { step } from './step';
import type { SimEvent } from './events';

export const REPLAY_MAGIC = 0x314a5354; // "TSJ1" lu en little endian
/** 10 minutes à 60 Hz : au-delà, une partie ne compte pas au classement. */
export const MAX_REPLAY_TICKS = 36000;

export interface ReplayData {
  seed: number;
  levelId: number;
  levelHash: number;
  paramsHash: number;
  /** Inputs packés (packInput) du joueur 1, un par tick simulé. */
  inputs: Uint32Array;
}

// ------------------------------------------------------------------ empreintes

function fnvStep(h: number, byte: number): number {
  return Math.imul(h ^ (byte & 0xff), 0x01000193) >>> 0;
}

function fnvU32(h: number, v: number): number {
  h = fnvStep(h, v);
  h = fnvStep(h, v >>> 8);
  h = fnvStep(h, v >>> 16);
  return fnvStep(h, v >>> 24);
}

/**
 * Empreinte d'une carte parsée : tout ce qui compte pour la sim (mode, tuiles, spawn, ennemis,
 * arrivée). Si une carte change, son empreinte change et son classement repart de zéro.
 */
export function hashLevel(level: Level): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < level.mode.length; i++) h = fnvStep(h, level.mode.charCodeAt(i));
  h = fnvU32(h, level.width);
  h = fnvU32(h, level.height);
  for (let i = 0; i < level.tiles.length; i++) h = fnvStep(h, level.tiles[i]);
  h = fnvU32(h, Math.round(level.spawnX));
  h = fnvU32(h, Math.round(level.spawnY));
  for (const e of level.enemies) {
    h = fnvU32(h, Math.round(e.x));
    h = fnvU32(h, Math.round(e.y));
    h = fnvStep(h, e.patrol ? 1 : 0);
  }
  const g = level.goal;
  if (g) {
    h = fnvU32(h, Math.round(g.x));
    h = fnvU32(h, Math.round(g.y));
    h = fnvU32(h, Math.round(g.w));
    h = fnvU32(h, Math.round(g.h));
  }
  return h >>> 0;
}

/** Empreinte de la carte `id` du registre. */
export function levelHash(id: number): number {
  return hashLevel(getLevel(id));
}

const f64 = new Float64Array(1);
const f64Words = new Uint32Array(f64.buffer);

/** Empreinte des params (valeurs exactes, dans l'ordre canonique PARAM_KEYS). */
export function paramsHash(p: Readonly<SimParams>): number {
  let h = 0x811c9dc5;
  for (const k of PARAM_KEYS) {
    f64[0] = p[k];
    h = fnvU32(h, f64Words[0]);
    h = fnvU32(h, f64Words[1]);
  }
  return h >>> 0;
}

/** Params strictement égaux aux défauts (seule configuration classée). */
export function isDefaultParams(p: Readonly<SimParams>): boolean {
  for (const k of PARAM_KEYS) if (p[k] !== DEFAULT_PARAMS[k]) return false;
  return true;
}

// ------------------------------------------------------------------ base64 (pur, sans DOM)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

/** null si la chaîne n'est pas du base64 valide. */
export function base64ToBytes(s: string): Uint8Array | null {
  if (s.length % 4 !== 0) return null;
  let pad = 0;
  if (s.endsWith('==')) pad = 2;
  else if (s.endsWith('=')) pad = 1;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const ch = s.charCodeAt(i + k);
      let v: number;
      if (ch === 61 && i + k >= s.length - pad) v = 0; // '='
      else {
        v = ch < 128 ? B64_INDEX[ch] : -1;
        if (v < 0) return null;
      }
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ------------------------------------------------------------------ encodage

export function encodeReplay(r: ReplayData): string {
  const n = r.inputs.length;
  // Pire cas : un run par tick, 4 octets + varint de 1 octet.
  const buf = new Uint8Array(25 + n * 9);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, REPLAY_MAGIC, true);
  dv.setUint32(4, r.seed >>> 0, true);
  dv.setUint8(8, r.levelId & 0xff);
  dv.setUint32(9, r.levelHash >>> 0, true);
  dv.setUint32(13, r.paramsHash >>> 0, true);
  dv.setUint32(17, n, true);
  let o = 25;
  let runs = 0;
  let i = 0;
  while (i < n) {
    const v = r.inputs[i];
    let len = 1;
    while (i + len < n && r.inputs[i + len] === v) len++;
    dv.setUint32(o, v >>> 0, true);
    o += 4;
    let l = len;
    while (l >= 0x80) {
      buf[o++] = (l & 0x7f) | 0x80;
      l >>>= 7;
    }
    buf[o++] = l;
    runs++;
    i += len;
  }
  dv.setUint32(21, runs, true);
  return bytesToBase64(buf.subarray(0, o));
}

/** Décode et valide la structure (pas la partie elle-même : voir verifyReplay). null si invalide. */
export function decodeReplay(s: string, maxTicks = MAX_REPLAY_TICKS): ReplayData | null {
  if (typeof s !== 'string' || s.length === 0 || s.length > 4 * Math.ceil((25 + maxTicks * 9) / 3)) return null;
  const buf = base64ToBytes(s);
  if (!buf || buf.length < 25) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== REPLAY_MAGIC) return null;
  const ticks = dv.getUint32(17, true);
  const runs = dv.getUint32(21, true);
  if (ticks === 0 || ticks > maxTicks || runs === 0 || runs > ticks) return null;
  const inputs = new Uint32Array(ticks);
  let o = 25;
  let t = 0;
  for (let r = 0; r < runs; r++) {
    if (o + 5 > buf.length) return null;
    const v = dv.getUint32(o, true);
    o += 4;
    let len = 0;
    let shift = 0;
    for (;;) {
      if (o >= buf.length || shift > 21) return null;
      const b = buf[o++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    if (len === 0 || t + len > ticks) return null;
    inputs.fill(v, t, t + len);
    t += len;
  }
  if (t !== ticks || o !== buf.length) return null;
  return {
    seed: dv.getUint32(4, true),
    levelId: dv.getUint8(8),
    levelHash: dv.getUint32(9, true),
    paramsHash: dv.getUint32(13, true),
    inputs,
  };
}

// ------------------------------------------------------------------ vérification

export type ReplayVerdict = { ok: true; finishTick: number } | { ok: false; reason: string };

/**
 * Rejoue la partie avec la vraie sim et les params par défaut. Valide seulement si la carte est
 * celle du registre (même empreinte), si les params étaient ceux par défaut, et si la manche se
 * termine EXACTEMENT au dernier input (ni avant : inputs rajoutés, ni jamais : inputs coupés).
 * Le temps retenu est `finishTick`, calculé ici.
 */
export function verifyReplay(r: ReplayData, levelCount = LEVELS.length): ReplayVerdict {
  if (r.levelId < 0 || r.levelId >= levelCount || r.levelId >= LEVELS.length) return { ok: false, reason: 'carte inconnue' };
  if (hashLevel(getLevel(r.levelId)) !== r.levelHash) return { ok: false, reason: 'carte différente de celle du serveur' };
  return replayToFinish(r);
}

/**
 * Pareil sur une carte hors registre (le workshop) : le replay doit viser l'emplacement de la carte
 * perso, avec l'empreinte de `level`. La carte est posée le temps du rejeu, qui est synchrone, puis
 * celle d'avant est remise : rien d'autre ne peut s'intercaler, même dans un serveur partagé.
 */
export function verifyCustomReplay(r: ReplayData, level: Level): ReplayVerdict {
  if (r.levelId !== CUSTOM_LEVEL_ID) return { ok: false, reason: 'carte inconnue' };
  if (hashLevel(level) !== r.levelHash) return { ok: false, reason: 'carte différente de celle du serveur' };
  const before = getCustomLevel();
  setCustomLevel(level);
  try {
    return replayToFinish(r);
  } finally {
    setCustomLevel(before);
  }
}

function replayToFinish(r: ReplayData): ReplayVerdict {
  if (r.paramsHash !== paramsHash(DEFAULT_PARAMS)) return { ok: false, reason: 'params modifiés' };
  const state = createInitialState(r.seed, 1, DEFAULT_PARAMS, r.levelId);
  const inp: PlayerInput = makeInput();
  const inputs = [inp];
  const events: SimEvent[] = [];
  const n = r.inputs.length;
  for (let i = 0; i < n; i++) {
    unpackInput(r.inputs[i], inp);
    events.length = 0;
    step(state, inputs, events);
    if (state.finished) {
      if (i + 1 !== n) return { ok: false, reason: 'inputs après l\'arrivée' };
      return { ok: true, finishTick: state.finishTick };
    }
  }
  return { ok: false, reason: 'manche non terminée' };
}
