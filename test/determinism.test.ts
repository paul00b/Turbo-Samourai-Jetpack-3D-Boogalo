import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  DEFAULT_PARAMS,
  hashState,
  makeInput,
  runDeterminismSelfTest,
  scriptedInputs,
  serializeState,
  step,
  type PlayerInput,
  type SimEvent,
} from '../src/sim';

describe('déterminisme de la simulation', () => {
  it('1000 ticks rejoués deux fois donnent exactement le même état', () => {
    const a = runDeterminismSelfTest(1000, 42);
    const b = runDeterminismSelfTest(1000, 42);
    expect(a.hash).toBe(b.hash);
    expect(serializeState(a.finalState)).toEqual(serializeState(b.finalState));
    // Le scénario doit réellement exercer la sim : mouvement, accroches, morts.
    expect(a.events).toBeGreaterThan(50);
    expect(a.finalState.players[0].x).not.toBe(createInitialState(42, 2).players[0].x);
  });

  it('une seed différente donne un état différent (le PRNG et le script sont branchés)', () => {
    const a = runDeterminismSelfTest(300, 1);
    const b = runDeterminismSelfTest(300, 2);
    expect(a.hash).not.toBe(b.hash);
  });

  it('les ticks sont indépendants du découpage temporel réel : stepper 1 par 1 == stepper en boucle', () => {
    const s1 = createInitialState(7, 2);
    const s2 = createInitialState(7, 2);
    const inputs: PlayerInput[] = [makeInput(), makeInput()];
    const ev: SimEvent[] = [];
    for (let t = 0; t < 500; t++) {
      scriptedInputs(s1.tick, 7, inputs);
      step(s1, inputs, ev);
    }
    // Deuxième run : mêmes inputs mais avec des "frames" de longueur variable (le loop réel fait ça).
    let t = 0;
    while (t < 500) {
      const burst = 1 + (t % 4);
      for (let k = 0; k < burst && t < 500; k++, t++) {
        scriptedInputs(s2.tick, 7, inputs);
        step(s2, inputs, ev);
      }
    }
    expect(hashState(s1)).toBe(hashState(s2));
  });

  it('coût d\'un tick (info : marge pour la re-simulation en rollback)', () => {
    const t0 = performance.now();
    const r = runDeterminismSelfTest(3000, 99);
    const us = ((performance.now() - t0) * 1000) / r.ticks;
    // eslint-disable-next-line no-console
    console.log(`sim : ${us.toFixed(1)} µs/tick (2 joueurs, ${r.finalState.params.substeps} sous-pas × ${r.finalState.params.constraintIterations} itérations)`);
    expect(us).toBeLessThan(2000);
  });

  it('empreinte de référence (à mettre à jour volontairement si la physique change)', () => {
    const r = runDeterminismSelfTest(1000, 1234, DEFAULT_PARAMS, 2);
    // Si ce test casse alors que tu n'as pas touché à la physique : c'est un problème de déterminisme.
    // Si tu as changé la physique : remplace la valeur ci-dessous (et documente-le dans le commit).
    expect(r.hashHex).toBe(GOLDEN_HASH);
  });
});

export const GOLDEN_HASH = '8026d6f9';
