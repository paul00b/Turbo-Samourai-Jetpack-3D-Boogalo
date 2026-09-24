/**
 * Netcode : délai d'input + prédiction + rollback. La sim étant déterministe, les deux machines
 * rejouent exactement les mêmes ticks à partir des mêmes inputs ; il suffit de s'échanger les inputs.
 *
 *   - On joue son propre input avec INPUT_DELAY ticks de retard (il part au pair pendant ce temps).
 *   - Si l'input distant du tick T manque, on PRÉDIT (on répète le dernier connu) et on avance.
 *   - Quand l'input réel arrive et contredit la prédiction, on ROLLBACK : on repart de l'état du
 *     tick fautif (ring buffer) et on rejoue jusqu'au présent avec les bons inputs.
 *   - Au-delà de MAX_PREDICTION ticks d'avance sans nouvelle du pair, on STALLE plutôt que de
 *     prédire dans le vide (c'est ça qui resynchronise les deux machines au démarrage).
 */
import { makeInput, packInput, paramsFromPartial, unpackInput, type PlayerInput, type SimParams } from '../sim';
import type { NetSession } from './session';

/** Ticks de retard appliqués à l'input local : 3 = 50 ms, absorbe un aller simple typique en LAN. */
export const INPUT_DELAY = 3;
/** Avance maximale autorisée sans input distant confirmé. Au-delà : stall. */
export const MAX_PREDICTION = 10;
/**
 * Marge, en ticks, entre la décision de l'hôte de changer les params et le tick où les deux sims
 * l'appliquent. Doit couvrir un aller simple + le délai d'input, sinon l'invité reçoit l'ordre
 * pour un tick qu'il a déjà simulé (géré quand même : rollback, mais autant l'éviter).
 */
export const PARAM_SYNC_DELAY = 20;
/** Taille des anneaux d'inputs (~17 s). Doit couvrir largement l'historique d'états (180 ticks). */
const RING = 1024;

interface RingSlot {
  tick: number;
  packed: number;
  confirmed: boolean;
}

function makeRing(): RingSlot[] {
  const r: RingSlot[] = [];
  for (let i = 0; i < RING; i++) r.push({ tick: -1, packed: 0, confirmed: false });
  return r;
}

export interface NetStats {
  /** Changements de params synchronisés (émis ou reçus). */
  paramSyncs: number;
  /** Ordre de changement de params arrivé trop tard pour être corrigé (désync possible). */
  paramsTooLate: number;
  rollbacks: number;
  /** Ticks resimulés au total (coût du rollback). */
  resimTicks: number;
  stalls: number;
  /** Profondeur du dernier rollback. */
  lastDepth: number;
  predictedAhead: number;
}

export class NetPlay {
  readonly slot: number;
  readonly remoteSlot: number;
  /** Tick le plus haut pour lequel l'input distant est confirmé (-1 si aucun). */
  lastRemoteTick = -1;
  /** Numéro de manche : incrémenté à chaque "recommencer". Les messages d'une autre manche sont jetés. */
  generation = 0;
  /** Tick à partir duquel il faut resimuler, -1 si rien à corriger. */
  private rollbackFrom = -1;
  private readonly local = makeRing();
  private readonly remote = makeRing();
  private readonly scratch: PlayerInput[] = [makeInput(), makeInput()];
  private readonly outbox: number[] = [];
  private outboxFirst = -1;
  /** Changements de params datés, indexés par tick d'application. */
  private readonly paramsByTick = new Map<number, SimParams>();
  readonly stats: NetStats = { paramSyncs: 0, paramsTooLate: 0, rollbacks: 0, resimTicks: 0, stalls: 0, lastDepth: 0, predictedAhead: 0 };

  constructor(
    private readonly session: NetSession,
    slot: number,
  ) {
    this.slot = slot;
    this.remoteSlot = slot === 0 ? 1 : 0;
  }

  private static slotOf(ring: RingSlot[], tick: number): RingSlot {
    return ring[((tick % RING) + RING) % RING];
  }

  /** Input local du tick `tick` (0 = neutre avant le premier input retardé). */
  private localAt(tick: number): number {
    const s = NetPlay.slotOf(this.local, tick);
    return s.tick === tick ? s.packed : 0;
  }

  /** Input distant : confirmé s'il est arrivé, sinon répétition du dernier connu (prédiction). */
  private remoteAt(tick: number): number {
    const s = NetPlay.slotOf(this.remote, tick);
    if (s.tick === tick && s.confirmed) return s.packed;
    return this.predictedRemote(tick);
  }

  private predictedRemote(tick: number): number {
    for (let t = Math.min(tick, this.lastRemoteTick); t >= 0 && tick - t < RING; t--) {
      const s = NetPlay.slotOf(this.remote, t);
      if (s.tick === t && s.confirmed) return s.packed;
    }
    return 0;
  }

  /**
   * Enregistre l'input local du tick `tick` et le met en file pour le pair.
   * IDEMPOTENT : le premier échantillon d'un tick fait foi. Un tick re-échantillonné (stall, frame
   * qui repasse) ne doit JAMAIS changer de valeur, sinon le pair garderait la première version
   * reçue et les deux sims divergeraient sans jamais se corriger.
   */
  pushLocal(tick: number, input: PlayerInput): void {
    const s = NetPlay.slotOf(this.local, tick);
    if (s.tick === tick) return;
    const packed = packInput(input);
    s.tick = tick;
    s.packed = packed;
    s.confirmed = true;
    if (this.outboxFirst >= 0 && tick === this.outboxFirst + this.outbox.length) {
      this.outbox.push(packed);
      return;
    }
    this.flush(); // trou dans la file : on repart d'un lot propre
    this.outboxFirst = tick;
    this.outbox.push(packed);
  }

  /** Envoie le lot d'inputs accumulé. Appelé une fois par frame : 1 message au lieu de N. */
  flush(): void {
    if (this.outbox.length === 0 || this.outboxFirst < 0) return;
    this.session.sendPeer({ t: 'in', gen: this.generation, first: this.outboxFirst, inputs: [...this.outbox] });
    this.outbox.length = 0;
    this.outboxFirst = -1;
  }

  /** Réception des inputs du pair : marque la correction si on avait prédit autre chose. */
  onRemoteInputs(first: number, packed: readonly number[], currentTick: number, gen = this.generation): void {
    if (gen !== this.generation) return; // reliquat de la manche précédente
    for (let i = 0; i < packed.length; i++) {
      const tick = first + i;
      if (tick < 0) continue;
      const s = NetPlay.slotOf(this.remote, tick);
      if (s.tick === tick && s.confirmed) continue; // déjà connu (doublon)
      const predicted = this.remoteAt(tick);
      s.tick = tick;
      s.packed = packed[i];
      s.confirmed = true;
      if (tick > this.lastRemoteTick) this.lastRemoteTick = tick;
      // On n'a déjà simulé ce tick qu'avec une prédiction fausse -> correction nécessaire.
      if (tick < currentTick && packed[i] !== predicted) {
        this.rollbackFrom = this.rollbackFrom < 0 ? tick : Math.min(this.rollbackFrom, tick);
      }
    }
  }

  /** Tick à partir duquel resimuler, ou -1. Consommé par le Game. */
  takeRollback(): number {
    const t = this.rollbackFrom;
    this.rollbackFrom = -1;
    return t;
  }

  get pendingRollback(): number {
    return this.rollbackFrom;
  }

  get isHost(): boolean {
    return this.slot === 0;
  }

  /** Params à appliquer au début du tick `tick`, ou null. Rejoué tel quel pendant un rollback. */
  paramsAt(tick: number): SimParams | null {
    return this.paramsByTick.get(tick) ?? null;
  }

  private schedule(tick: number, params: SimParams): void {
    this.paramsByTick.set(tick, params);
    this.stats.paramSyncs++;
    // Purge : au-delà de la fenêtre de rollback, un changement passé ne sera plus rejoué.
    for (const t of this.paramsByTick.keys()) if (t < tick - 600) this.paramsByTick.delete(t);
  }

  /** Hôte : planifie le changement des deux côtés et l'envoie. */
  broadcastParams(tick: number, params: Readonly<SimParams>): void {
    const clean = paramsFromPartial({ ...params } as Record<string, unknown>);
    this.schedule(tick, clean);
    const wire: Record<string, number> = {};
    for (const k of Object.keys(clean) as (keyof SimParams)[]) wire[k] = clean[k];
    this.session.sendPeer({ t: 'params', gen: this.generation, tick, params: wire });
  }

  /**
   * Invité : planifie le changement au tick imposé par l'hôte. S'il est déjà passé localement,
   * on force un rollback jusque-là pour rejouer ces ticks avec les bons params.
   */
  onRemoteParams(tick: number, params: Record<string, number>, currentTick: number, historyDepth: number, gen = this.generation): void {
    if (gen !== this.generation) return;
    this.schedule(tick, paramsFromPartial(params));
    if (tick >= currentTick) return;
    if (currentTick - tick > historyDepth) {
      this.stats.paramsTooLate++;
      return;
    }
    this.rollbackFrom = this.rollbackFrom < 0 ? tick : Math.min(this.rollbackFrom, tick);
  }

  /** Peut-on simuler `tick` sans prédire trop loin ? Sinon on attend le pair. */
  canStep(tick: number): boolean {
    const slot = NetPlay.slotOf(this.remote, tick);
    if (slot.tick === tick && slot.confirmed) return true;
    const ahead = tick - this.lastRemoteTick;
    this.stats.predictedAhead = Math.max(0, ahead);
    if (ahead > MAX_PREDICTION) {
      this.stats.stalls++;
      return false;
    }
    return true;
  }

  /** Inputs des deux joueurs pour `tick`, dans l'ordre des slots. */
  inputsFor(tick: number, out: PlayerInput[] = this.scratch): PlayerInput[] {
    unpackInput(this.localAt(tick), out[this.slot]);
    unpackInput(this.remoteAt(tick), out[this.remoteSlot]);
    return out;
  }

  /** Hôte : ordonne une nouvelle manche aux deux machines. Retourne la génération à appliquer. */
  broadcastRestart(seed: number, levelId: number): number {
    const gen = this.generation + 1;
    this.session.sendPeer({ t: 'restart', gen, seed, levelId });
    this.resetForRestart(gen);
    return gen;
  }

  /**
   * Nouvelle manche : les ticks repartent à 0, donc TOUS les tampons indexés par tick doivent être
   * vidés. Sans ça, un input de l'ancienne manche resterait "confirmé" sur le même slot et serait
   * rejoué à la place du vrai, des dizaines de secondes plus tard.
   */
  resetForRestart(gen: number): void {
    this.generation = gen;
    for (const slot of this.local) slot.tick = -1;
    for (const slot of this.remote) slot.tick = -1;
    this.paramsByTick.clear();
    this.outbox.length = 0;
    this.outboxFirst = -1;
    this.lastRemoteTick = -1;
    this.rollbackFrom = -1;
    this.stats.lastDepth = 0;
    this.stats.predictedAhead = 0;
  }

  noteRollback(depth: number): void {
    this.stats.rollbacks++;
    this.stats.resimTicks += depth;
    this.stats.lastDepth = depth;
  }
}
