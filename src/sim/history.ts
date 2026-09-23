/**
 * Ring buffer des N derniers états + inputs : base du rollback.
 * Convention : l'entrée du tick T contient l'état AVANT application des inputs de T, et ces inputs.
 * rollback(T) = repartir de l'état de T et rejouer les inputs de T..now (éventuellement corrigés).
 */
import type { PlayerInput } from './input';
import { copyInput, makeInput } from './input';
import { cloneState, type GameState } from './state';
import { step } from './step';
import type { SimEvent } from './events';

export interface HistoryEntry {
  tick: number;
  state: GameState;
  inputs: PlayerInput[];
}

export class StateHistory {
  private entries: (HistoryEntry | null)[];
  private newest = -1;
  private oldest = -1;

  constructor(public readonly capacity: number) {
    this.entries = new Array(capacity).fill(null);
  }

  get newestTick(): number {
    return this.newest;
  }
  get oldestTick(): number {
    return this.oldest;
  }

  clear(): void {
    this.entries.fill(null);
    this.newest = -1;
    this.oldest = -1;
  }

  /** Enregistre l'état `stateBefore` (cloné) et les inputs qui vont être appliqués pour produire le tick suivant. */
  record(stateBefore: GameState, inputs: readonly PlayerInput[]): void {
    const tick = stateBefore.tick;
    const idx = tick % this.capacity;
    const copied: PlayerInput[] = [];
    for (let i = 0; i < inputs.length; i++) copied.push(copyInput(inputs[i], makeInput()));
    this.entries[idx] = { tick, state: cloneState(stateBefore), inputs: copied };
    this.newest = tick;
    if (this.oldest < 0 || tick - this.oldest >= this.capacity) this.oldest = tick - this.capacity + 1;
    if (this.oldest < 0) this.oldest = 0;
    // Si le tick a "sauté en arrière" (rollback), invalide les entrées devenues futures.
    for (let t = tick + 1; t < tick + this.capacity; t++) {
      const e = this.entries[t % this.capacity];
      if (e && e.tick > tick) this.entries[t % this.capacity] = null;
    }
  }

  get(tick: number): HistoryEntry | null {
    const e = this.entries[((tick % this.capacity) + this.capacity) % this.capacity];
    return e && e.tick === tick ? e : null;
  }

  /**
   * Rejoue depuis `fromTick` jusqu'à `toTick` (exclu) avec les inputs enregistrés, en remplaçant
   * ceux que `override` fournit. Retourne un NOUVEL état (les entrées d'historique ne sont pas modifiées).
   * Les événements produits sont poussés dans `events` si fourni (le caller décide s'il les rejoue).
   */
  resimulate(
    fromTick: number,
    toTick: number,
    override?: (tick: number, inputs: PlayerInput[]) => PlayerInput[],
    events?: SimEvent[],
  ): GameState {
    const start = this.get(fromTick);
    if (!start) throw new Error(`Tick ${fromTick} hors de l'historique (${this.oldest}..${this.newest})`);
    const state = cloneState(start.state);
    const sink: SimEvent[] = events ?? [];
    for (let t = fromTick; t < toTick; t++) {
      const entry = this.get(t);
      let inputs = entry ? entry.inputs : [];
      if (override) inputs = override(t, inputs);
      if (!events) sink.length = 0;
      step(state, inputs, sink);
    }
    return state;
  }
}
