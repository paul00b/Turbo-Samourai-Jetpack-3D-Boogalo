import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  getLevel,
  LEVEL_INFOS,
  deserializeState,
  DEFAULT_PARAMS,
  makeInput,
  serializeState,
  step,
  type GameState,
  type SimEvent,
} from '../src/sim';
import { objectiveText } from '../src/ui/hud';

/** Tue l'ennemi `ei` comme le ferait un joueur lancé à pleine vitesse dessus. */
function slay(s: GameState, ei: number, player = 0): SimEvent[] {
  const e = s.enemies[ei];
  const p = s.players[player];
  p.x = e.x - 60;
  p.y = e.y;
  p.vx = s.params.enemyKillSpeed + 200;
  p.vy = 0;
  const ev: SimEvent[] = [];
  for (let t = 0; t < 12 && e.alive; t++) step(s, [makeInput(), makeInput()], ev);
  // On stoppe net : sinon, en gravité nulle, le joueur continue tout droit et fauche les suivants.
  p.vx = 0;
  p.vy = 0;
  return ev;
}

const HOME = { x: 0, y: 0 };

function freshState(unlimited: number): GameState {
  const s = createInitialState(1, 1, { ...DEFAULT_PARAMS, gravity: 0, enemiesUnlimited: unlimited });
  HOME.x = s.players[0].x;
  HOME.y = s.players[0].y;
  return s;
}

/**
 * Ramène le joueur à son spawn, loin des ennemis : sinon il reste collé à sa dernière victime et,
 * quand elle respawn, le contact le repousse à 520 px/s (au-dessus du seuil de kill) : cascade.
 */
function park(s: GameState): void {
  const p = s.players[0];
  p.x = HOME.x;
  p.y = HOME.y;
  p.vx = 0;
  p.vy = 0;
}

/** Premier niveau chrono (Sprint). */
const RACE_ID = LEVEL_INFOS.findIndex((i) => i.mode === 'race');

describe('cartes chrono : arrivée', () => {
  it('toucher l\'arrivée termine la manche et fige le chrono', () => {
    const s = createInitialState(1, 1, { ...DEFAULT_PARAMS, gravity: 0 }, RACE_ID);
    const level = getLevel(RACE_ID);
    const goal = level.goal!;
    const ev: SimEvent[] = [];
    for (let t = 0; t < 30; t++) step(s, [makeInput()], ev);
    expect(s.finished).toBe(0);

    // Téléportation au centre de l'arrivée : on teste la condition, pas le trajet.
    s.players[0].x = goal.x + goal.w / 2;
    s.players[0].y = goal.y + goal.h / 2;
    step(s, [makeInput()], ev);
    expect(s.finished).toBe(1);
    expect(s.finishTick).toBe(s.tick);
    const done = ev.find((e) => e.type === 'levelComplete');
    expect(done).toBeDefined();
    expect(done?.player).toBe(0);

    const frozen = s.finishTick;
    for (let t = 0; t < 120; t++) step(s, [makeInput()], ev);
    expect(s.finishTick).toBe(frozen);
    expect(s.tick).toBeGreaterThan(frozen + 100);
    expect(ev.filter((e) => e.type === 'levelComplete')).toHaveLength(1);
  });

  it('juste à côté de l\'arrivée, ça ne compte pas', () => {
    const s = createInitialState(1, 1, { ...DEFAULT_PARAMS, gravity: 0 }, RACE_ID);
    const goal = getLevel(RACE_ID).goal!;
    s.players[0].x = goal.x - DEFAULT_PARAMS.playerRadius - 4;
    s.players[0].y = goal.y + goal.h / 2;
    const ev: SimEvent[] = [];
    step(s, [makeInput()], ev);
    expect(s.finished).toBe(0);
  });

  it('sur une carte chrono, tuer les ennemis ne termine rien', () => {
    const s = createInitialState(1, 1, { ...DEFAULT_PARAMS, gravity: 0 }, RACE_ID);
    for (const e of s.enemies) e.alive = 0;
    const ev: SimEvent[] = [];
    for (let t = 0; t < 30; t++) step(s, [makeInput()], ev);
    expect(s.finished).toBe(0);
  });

  it('sur une carte élimination, il n\'y a pas d\'arrivée à franchir', () => {
    expect(getLevel(0).goal).toBeNull();
    expect(getLevel(0).mode).toBe('kills');
  });

  it('le texte d\'objectif d\'une course affiche la progression', () => {
    const s = createInitialState(1, 1, { ...DEFAULT_PARAMS, gravity: 0 }, RACE_ID);
    expect(objectiveText(s)).toMatch(/^🏁 0 % · \d+ tuiles restantes$/);
    const goal = getLevel(RACE_ID).goal!;
    s.players[0].x = goal.x + goal.w / 2;
    s.players[0].y = goal.y + goal.h / 2;
    step(s, [makeInput()], []);
    expect(objectiveText(s)).toBe('🏁 arrivée franchie');
  });
});

describe('compteur d\'ennemis et fin de niveau', () => {
  it('par défaut le stock est fini (pas de respawn)', () => {
    expect(DEFAULT_PARAMS.enemiesUnlimited).toBe(0);
  });

  it('tuer incrémente le compteur global et celui du joueur', () => {
    const s = freshState(0);
    expect(s.kills).toBe(0);
    const ev = slay(s, 0);
    expect(s.enemies[0].alive).toBe(0);
    expect(s.kills).toBe(1);
    expect(s.players[0].kills).toBe(1);
    expect(ev.find((e) => e.type === 'enemyKill')?.value).toBe(1);
  });

  it('stock fini : pas de respawn, et tuer tout le monde termine le niveau et fige le chrono', () => {
    const s = freshState(0);
    const total = s.enemies.length;
    expect(total).toBeGreaterThan(1);
    for (let ei = 0; ei < total; ei++) slay(s, ei);
    expect(s.kills).toBe(total);
    expect(s.finished).toBe(1);
    expect(s.finishTick).toBe(s.tick);

    // Le tick continue d'avancer, mais finishTick (le chrono affiché) reste figé.
    const frozen = s.finishTick;
    park(s);
    const ev: SimEvent[] = [];
    for (let t = 0; t < 600; t++) step(s, [makeInput()], ev);
    expect(s.finishTick).toBe(frozen);
    expect(s.tick).toBeGreaterThan(frozen + 500);
    expect(s.enemies.every((e) => !e.alive)).toBe(true); // aucun respawn
    expect(ev.filter((e) => e.type === 'levelComplete')).toHaveLength(0); // émis une seule fois
  });

  it('l\'événement levelComplete est émis pile au tick de la dernière mise à mort', () => {
    const s = freshState(0);
    for (let ei = 0; ei < s.enemies.length - 1; ei++) slay(s, ei);
    expect(s.finished).toBe(0);
    const ev = slay(s, s.enemies.length - 1);
    const done = ev.find((e) => e.type === 'levelComplete');
    expect(done).toBeDefined();
    expect(done?.tick).toBe(s.finishTick);
    expect(done?.value).toBe(s.enemies.length);
  });

  it('illimités : les ennemis respawnent, le compteur monte, le niveau ne se termine jamais', () => {
    const s = freshState(1);
    const total = s.enemies.length;
    for (let ei = 0; ei < total; ei++) slay(s, ei);
    expect(s.kills).toBe(total);
    expect(s.finished).toBe(0);
    // Après le délai de respawn, tout le monde est revenu et on peut retuer.
    const ev: SimEvent[] = [];
    park(s);
    for (let t = 0; t < DEFAULT_PARAMS.enemyRespawnTicks + 5; t++) step(s, [makeInput()], ev);
    expect(s.enemies.every((e) => e.alive === 1)).toBe(true);
    slay(s, 0);
    expect(s.kills).toBe(total + 1);
    expect(s.finished).toBe(0);
  });

  it('activer "illimités" après coup fait revenir les morts', () => {
    const s = freshState(0);
    slay(s, 0);
    const ev: SimEvent[] = [];
    park(s);
    for (let t = 0; t < 300; t++) step(s, [makeInput()], ev);
    expect(s.enemies[0].alive).toBe(0); // stock fini : toujours mort
    expect(s.finished).toBe(0);
    s.params.enemiesUnlimited = 1;
    for (let t = 0; t < DEFAULT_PARAMS.enemyRespawnTicks + 5; t++) step(s, [makeInput()], ev);
    expect(s.enemies[0].alive).toBe(1);
  });

  it('un niveau terminé ne ressuscite pas ses ennemis si on coche illimités', () => {
    const s = freshState(0);
    for (let ei = 0; ei < s.enemies.length; ei++) slay(s, ei);
    expect(s.finished).toBe(1);
    park(s);
    s.params.enemiesUnlimited = 1;
    const ev: SimEvent[] = [];
    for (let t = 0; t < DEFAULT_PARAMS.enemyRespawnTicks + 60; t++) step(s, [makeInput()], ev);
    expect(s.enemies.every((e) => !e.alive)).toBe(true);
  });

  it('les compteurs survivent à la sérialisation', () => {
    const s = freshState(0);
    slay(s, 0);
    slay(s, 1);
    const back = deserializeState(serializeState(s));
    expect(back.kills).toBe(s.kills);
    expect(back.finished).toBe(s.finished);
    expect(back.finishTick).toBe(s.finishTick);
    expect(back.players[0].kills).toBe(s.players[0].kills);
    expect(serializeState(back)).toEqual(serializeState(s));
  });

  it('le texte d\'objectif dit l\'état du niveau', () => {
    const fini = freshState(0);
    const total = fini.enemies.length;
    expect(objectiveText(fini)).toBe(`⚔ 0 / ${total} · ${total} restants`);
    for (let ei = 0; ei < total; ei++) slay(fini, ei);
    expect(objectiveText(fini)).toBe(`⚔ ${total} / ${total} · terminé`);

    const illimite = freshState(1);
    slay(illimite, 0);
    expect(objectiveText(illimite)).toBe('⚔ 1 · ennemis illimités');

    illimite.params.enemiesEnabled = 0;
    expect(objectiveText(illimite)).toBe('Ennemis désactivés');
  });
});
