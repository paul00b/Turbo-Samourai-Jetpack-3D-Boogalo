import { describe, expect, it } from 'vitest';
import {
  AIM_UP,
  BTN_HOOK_L,
  BTN_JET,
  BTN_LEFT,
  BTN_RIGHT,
  hashState,
  hashToHex,
  makeInput,
  type PlayerInput,
} from '../src/sim';
import { Game } from '../src/app/game';
import { INPUT_DELAY, NetPlay, PARAM_SYNC_DELAY } from '../src/net/netPlay';
import { isValidCode, normalizeCode } from '../src/net/protocol';
import type { NetSession } from '../src/net/session';
import { makeStubGame } from './stubGame';

/** Input scripté déterministe : chaque joueur a son propre motif, avec des maintiens réalistes. */
function scriptFor(slot: number, tick: number, out: PlayerInput): PlayerInput {
  const block = Math.floor(tick / 7) + slot * 3;
  let b = 0;
  if (block % 2 === 0) b |= BTN_HOOK_L;
  if (block % 5 === 0) b |= BTN_JET;
  if (block % 3 === 0) b |= BTN_LEFT;
  else if (block % 3 === 1) b |= BTN_RIGHT;
  out.buttons = b;
  out.aim = (AIM_UP + ((tick * 613 + slot * 7919) % 8000) - 4000) & 0xffff;
  return out;
}

/** Deux Game complets, reliés par un lien simulé : latence en ticks + gigue déterministe. */
type Wire = { t: string; gen?: number; first?: number; inputs?: number[]; tick?: number; params?: Record<string, number>; seed?: number; levelId?: number };

class Link {
  private readonly queue: { at: number; to: number; msg: Wire }[] = [];
  private frame = 0;
  readonly games: Game[] = [];
  readonly plays: NetPlay[] = [];

  constructor(
    private readonly latency: number,
    private readonly jitter: number,
  ) {
    for (let slot = 0; slot < 2; slot++) {
      const session = {
        sendPeer: (msg: Wire) => {
          if (msg.t !== 'in' && msg.t !== 'params' && msg.t !== 'restart') return;
          const delay = this.latency + (this.jitter > 0 ? ((this.frame * 7 + slot * 13) % (this.jitter + 1)) : 0);
          this.queue.push({ at: this.frame + delay, to: slot === 0 ? 1 : 0, msg: JSON.parse(JSON.stringify(msg)) as Wire });
        },
      } as unknown as NetSession;
      const game = makeGame(slot);
      const play = new NetPlay(session, slot);
      game.startNet(play);
      this.games.push(game);
      this.plays.push(play);
    }
  }

  /** Une frame : chaque machine tente un tick, puis les messages arrivés sont distribués. */
  step(): void {
    this.frame++;
    for (let slot = 0; slot < 2; slot++) {
      const g = this.games[slot];
      currentTick[slot] = g.state.tick;
      // Reproduit une frame de la boucle : un tick au plus, qui peut refuser d'avancer (stall).
      (g as unknown as { tick: () => boolean }).tick();
      this.plays[slot].flush();
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const m = this.queue[i];
      if (m.at > this.frame) continue;
      this.queue.splice(i, 1);
      if (m.msg.t === 'in') {
        this.plays[m.to].onRemoteInputs(m.msg.first!, m.msg.inputs!, this.games[m.to].state.tick, m.msg.gen);
      } else if (m.msg.t === 'params' && !this.plays[m.to].isHost) {
        this.games[m.to].scheduleNetParams(m.msg.tick!, m.msg.params!, m.msg.gen);
      } else if (m.msg.t === 'restart' && !this.plays[m.to].isHost) {
        this.games[m.to].netRestart(m.msg.gen!, m.msg.seed!, m.msg.levelId!);
      }
    }
  }
}

function makeGame(slot: number): Game {
  return makeStubGame({ sampleNet: (_state, s2, scratch) => scriptFor(s2, currentTick[slot], scratch[s2]) }).game;
}

/** Tick courant de chaque machine, lu par le sampler scripté (les inputs dépendent du tick). */
const currentTick = [0, 0];

function hashOf(g: Game): string {
  return hashToHex(hashState(g.state));
}

/**
 * L'invariant du rollback n'est PAS "les deux écrans montrent la même chose à l'instant t" : l'état
 * courant est spéculatif tant que l'input distant n'est pas arrivé. Ce qui doit être identique,
 * c'est l'état à un tick dont les DEUX machines ont tous les inputs confirmés.
 */
function expectSameConfirmedState(link: Link): void {
  // Les inputs partent avec INPUT_DELAY d'avance : lastRemoteTick peut dépasser le tick courant.
  // On borne donc aussi par le dernier tick réellement simulé de chaque côté.
  const t = Math.min(
    link.plays[0].lastRemoteTick,
    link.plays[1].lastRemoteTick,
    link.games[0].state.tick - 1,
    link.games[1].state.tick - 1,
  );
  expect(t).toBeGreaterThan(0);
  const a = link.games[0].history.get(t);
  const b = link.games[1].history.get(t);
  expect(a, `tick ${t} absent de l'historique de l'hôte`).not.toBeNull();
  expect(b, `tick ${t} absent de l'historique de l'invité`).not.toBeNull();
  expect(hashToHex(hashState(a!.state))).toBe(hashToHex(hashState(b!.state)));
}

describe('netcode : rollback sur lien retardé', () => {
  it('le code de session est normalisé et validé', () => {
    expect(normalizeCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeCode('abcdefghij')).toBe('ABCDEF');
    expect(isValidCode('ABC234')).toBe(true);
    expect(isValidCode('ABC23')).toBe(false);
    expect(isValidCode('ABC2I4')).toBe(false); // I exclu de l'alphabet
  });

  it('deux sims convergent malgré la latence, et le rollback se déclenche vraiment', () => {
    const link = new Link(4, 0); // 4 ticks d'aller simple > INPUT_DELAY : prédiction obligatoire
    for (let f = 0; f < 600; f++) link.step();
    expect(Math.min(link.games[0].state.tick, link.games[1].state.tick)).toBeGreaterThan(400);
    expectSameConfirmedState(link);
    expect(link.plays[0].stats.rollbacks + link.plays[1].stats.rollbacks).toBeGreaterThan(0);
  });

  it('avec une latence sous le délai d\'input, aucun rollback n\'est nécessaire', () => {
    const link = new Link(1, 0); // 1 tick < INPUT_DELAY (3) : l'input arrive avant d'être joué
    for (let f = 0; f < 300; f++) link.step();
    expect(link.plays[0].stats.rollbacks + link.plays[1].stats.rollbacks).toBe(0);
    expectSameConfirmedState(link);
    // Latence sous le délai : les états COURANTS eux-mêmes sont identiques, rien n'est spéculatif.
    expect(hashOf(link.games[0])).toBe(hashOf(link.games[1]));
  });

  it('gigue forte : ça converge quand même', () => {
    const link = new Link(3, 6);
    for (let f = 0; f < 600; f++) link.step();
    expect(Math.min(link.games[0].state.tick, link.games[1].state.tick)).toBeGreaterThan(300);
    expectSameConfirmedState(link);
  });

  it('l\'input local est figé dès le premier échantillon d\'un tick', () => {
    const sent: number[] = [];
    const session = { sendPeer: (m: { t: string; inputs?: number[] }) => m.t === 'in' && sent.push(...(m.inputs ?? [])) } as unknown as NetSession;
    const play = new NetPlay(session, 0);
    play.pushLocal(10, makeInput(BTN_JET, AIM_UP));
    play.pushLocal(10, makeInput(BTN_HOOK_L, AIM_UP)); // re-échantillon : ignoré
    play.flush();
    expect(sent).toHaveLength(1);
    const out = play.inputsFor(10);
    expect(out[0].buttons).toBe(BTN_JET);
  });

  it('l\'hôte change les params : les deux sims les appliquent au MÊME tick', () => {
    const link = new Link(4, 0);
    for (let f = 0; f < 100; f++) link.step();
    const host = link.games[0];
    const guest = link.games[1];
    expect(guest.state.params.gravity).toBe(host.state.params.gravity);

    const next = { ...host.state.params, gravity: 900, jetForce: 5000 };
    host.applyParams(next); // ce que fait le ParamsStore quand on bouge un slider ou applique un build
    const applyAt = host.state.tick + PARAM_SYNC_DELAY;
    // Avant l'échéance, rien n'a bougé nulle part.
    expect(host.state.params.gravity).not.toBe(900);

    for (let f = 0; f < 200; f++) link.step();
    expect(host.state.tick).toBeGreaterThan(applyAt);
    expect(host.state.params.gravity).toBe(900);
    expect(guest.state.params.gravity).toBe(900);
    expect(guest.state.params.jetForce).toBe(5000);
    // Et la sim n'a pas divergé au passage.
    expectSameConfirmedState(link);
    expect(link.plays[0].stats.paramSyncs).toBeGreaterThan(0);
    expect(link.plays[1].stats.paramSyncs).toBeGreaterThan(0);
    expect(link.plays[1].stats.paramsTooLate).toBe(0);
  });

  it('un ordre de params arrivé en retard est rattrapé par un rollback', () => {
    const link = new Link(4, 0);
    for (let f = 0; f < 60; f++) link.step();
    const host = link.games[0];
    const guest = link.games[1];
    // Ordre daté dans le PASSÉ de l'invité : il doit rejouer ces ticks avec les bons params.
    const pastTick = guest.state.tick - 5;
    const before = link.plays[1].stats.rollbacks;
    guest.scheduleNetParams(pastTick, { ...host.state.params, gravity: 700 });
    for (let f = 0; f < 40; f++) link.step();
    expect(link.plays[1].stats.rollbacks).toBeGreaterThan(before);
    expect(guest.state.params.gravity).toBe(700);
    expect(link.plays[1].stats.paramsTooLate).toBe(0);
  });

  it('l\'invité ne peut pas changer les params de son côté', () => {
    const link = new Link(2, 0);
    for (let f = 0; f < 40; f++) link.step();
    const guest = link.games[1];
    const before = guest.state.params.gravity;
    guest.applyParams({ ...guest.state.params, gravity: 123 });
    for (let f = 0; f < 60; f++) link.step();
    expect(guest.state.params.gravity).toBe(before);
    expect(link.games[0].state.params.gravity).toBe(before);
  });

  it('l\'hôte relance la manche : les deux repartent à zéro et les inputs de l\'ancienne sont jetés', () => {
    const link = new Link(4, 0);
    for (let f = 0; f < 200; f++) link.step();
    const host = link.games[0];
    const guest = link.games[1];
    const tickBefore = host.state.tick;
    expect(tickBefore).toBeGreaterThan(100);

    host.restart(); // "Recommencer le niveau" côté hôte
    expect(host.state.tick).toBe(0);
    expect(link.plays[0].generation).toBe(1);
    // L'invité tourne encore sur l'ancienne manche le temps que l'ordre arrive.
    expect(link.plays[1].generation).toBe(0);

    for (let f = 0; f < 200; f++) link.step();
    expect(link.plays[1].generation).toBe(1);
    expect(guest.state.tick).toBeLessThan(tickBefore);
    expect(guest.state.tick).toBeGreaterThan(100);
    // Et surtout : la nouvelle manche converge (aucun reliquat de l'ancienne dans les tampons).
    expectSameConfirmedState(link);
  });

  it('l\'invité ne peut pas relancer la manche tout seul', () => {
    const link = new Link(2, 0);
    for (let f = 0; f < 80; f++) link.step();
    const guestTick = link.games[1].state.tick;
    link.games[1].restart();
    expect(link.games[1].state.tick).toBe(guestTick); // ignoré
    expect(link.plays[1].generation).toBe(0);
  });

  it('INPUT_DELAY reste dans l\'historique de rollback', () => {
    expect(INPUT_DELAY).toBeGreaterThan(0);
    expect(INPUT_DELAY).toBeLessThan(60);
  });
});
