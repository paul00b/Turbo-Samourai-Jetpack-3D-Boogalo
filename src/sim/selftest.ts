/**
 * Scénario d'inputs scripté + hash final : sert au test Vitest ET au bouton "auto-test déterminisme"
 * du panneau de debug (à lancer dans Chrome, Firefox et Safari : le hash doit être identique).
 */
import { AIM_UP, BTN_GRAB, BTN_HOOK_L, BTN_HOOK_R, BTN_JET, BTN_LEFT, BTN_REEL, BTN_RIGHT, makeInput, type PlayerInput } from './input';
import { mulberry32Next, mulberry32Value } from './rng';
import { createInitialState, type GameState } from './state';
import { step } from './step';
import { hashState, hashToHex } from './snapshot';
import type { SimEvent } from './events';
import { DEFAULT_PARAMS, type SimParams } from './params';

/** Inputs pseudo-aléatoires mais déterministes pour 2 joueurs (mulberry32 dédié, indépendant de la sim). */
export function scriptedInputs(tick: number, seed: number, out: PlayerInput[]): PlayerInput[] {
  let s = (seed ^ Math.imul(tick + 1, 0x9e3779b1)) | 0;
  for (let p = 0; p < 2; p++) {
    s = mulberry32Next(s);
    const r1 = mulberry32Value(s);
    s = mulberry32Next(s);
    const r2 = mulberry32Value(s);
    // Segments de 20 ticks : les boutons changent par bloc pour avoir des maintiens réalistes.
    const block = Math.floor(tick / 20) + p * 7;
    let b = 0;
    if ((block & 1) !== 0) b |= BTN_HOOK_L;
    if ((block & 2) !== 0 && r1 > 0.2) b |= BTN_HOOK_R;
    if ((block & 4) !== 0 || r2 > 0.85) b |= BTN_JET;
    if ((block % 5) === 0) b |= BTN_GRAB;
    if ((block & 8) !== 0) b |= BTN_REEL;
    if ((block % 3) === 0) b |= BTN_LEFT;
    if ((block % 3) === 1) b |= BTN_RIGHT;
    // Visée : balayage lent + bruit, principalement vers le haut.
    const aim = (AIM_UP + Math.floor(r1 * 24000) - 12000 + (tick * 37) % 6000) & 0xffff;
    out[p] = out[p] ? out[p] : makeInput();
    out[p].buttons = b;
    out[p].aim = aim;
  }
  return out;
}

export interface SelfTestResult {
  ticks: number;
  hash: number;
  hashHex: string;
  deaths: number;
  events: number;
  finalState: GameState;
}

export function runDeterminismSelfTest(
  ticks = 1000,
  seed = 1234,
  params: Readonly<SimParams> = DEFAULT_PARAMS,
  playerCount = 2,
): SelfTestResult {
  const state = createInitialState(seed, playerCount, params);
  const inputs: PlayerInput[] = [makeInput(), makeInput()];
  const events: SimEvent[] = [];
  let eventCount = 0;
  for (let t = 0; t < ticks; t++) {
    scriptedInputs(state.tick, seed, inputs);
    events.length = 0;
    step(state, inputs, events);
    eventCount += events.length;
  }
  const hash = hashState(state);
  return {
    ticks,
    hash,
    hashHex: hashToHex(hash),
    deaths: state.players[0].deaths + state.players[1].deaths,
    events: eventCount,
    finalState: state,
  };
}
