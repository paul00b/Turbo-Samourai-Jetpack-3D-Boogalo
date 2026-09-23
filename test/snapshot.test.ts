import { describe, expect, it } from 'vitest';
import {
  cloneState,
  createInitialState,
  deserializeState,
  hashState,
  makeInput,
  scriptedInputs,
  serializeState,
  StateHistory,
  step,
  type PlayerInput,
  type SimEvent,
} from '../src/sim';

function advance(state: ReturnType<typeof createInitialState>, ticks: number, seed: number, history?: StateHistory) {
  const inputs: PlayerInput[] = [makeInput(), makeInput()];
  const ev: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    scriptedInputs(state.tick, seed, inputs);
    if (history) history.record(state, inputs);
    ev.length = 0;
    step(state, inputs, ev);
  }
}

describe('snapshot', () => {
  it('serialize -> deserialize est une identité structurelle', () => {
    const s = createInitialState(99, 2);
    advance(s, 250, 99);
    const bytes = serializeState(s);
    const back = deserializeState(bytes);
    expect(back).toEqual(s);
    expect(serializeState(back)).toEqual(bytes);
  });

  it('cloneState couvre tous les champs (cohérent avec la sérialisation)', () => {
    const s = createInitialState(5, 2);
    advance(s, 120, 5);
    const c = cloneState(s);
    expect(c).toEqual(s);
    expect(c).not.toBe(s);
    expect(c.players[0].hooks[0]).not.toBe(s.players[0].hooks[0]);
    expect(serializeState(c)).toEqual(serializeState(s));
  });

  it('reprendre la sim depuis un snapshot donne le même futur', () => {
    const seed = 2024;
    const a = createInitialState(seed, 2);
    advance(a, 200, seed);
    const restored = deserializeState(serializeState(a));
    advance(a, 300, seed);
    advance(restored, 300, seed);
    expect(hashState(restored)).toBe(hashState(a));
  });
});

describe('ring buffer + rollback', () => {
  it('rollback de 60 ticks puis re-simulation reproduit exactement l\'état courant', () => {
    const seed = 777;
    const state = createInitialState(seed, 2);
    const history = new StateHistory(120);
    advance(state, 400, seed, history);
    expect(history.newestTick).toBe(399);
    expect(history.oldestTick).toBe(400 - 120);
    const resim = history.resimulate(state.tick - 60, state.tick);
    expect(resim.tick).toBe(state.tick);
    expect(hashState(resim)).toBe(hashState(state));
  });

  it('un input corrigé pendant le rollback change le futur (la re-simulation est effective)', () => {
    const seed = 31337;
    const state = createInitialState(seed, 2);
    const history = new StateHistory(120);
    advance(state, 300, seed, history);
    const resim = history.resimulate(state.tick - 60, state.tick, (tick, inputs) => {
      if (tick === state.tick - 60) return [makeInput(0, 0), makeInput(0, 0)];
      return inputs;
    });
    expect(hashState(resim)).not.toBe(hashState(state));
  });

  it('refuse un tick sorti de la fenêtre', () => {
    const state = createInitialState(1, 1);
    const history = new StateHistory(30);
    advance(state, 100, 1, history);
    expect(() => history.resimulate(10, 100)).toThrow();
  });
});
