import { describe, expect, it } from 'vitest';
import {
  BTN_HOOK_L,
  BTN_JET,
  BTN_REEL,
  BTN_RIGHT,
  AIM_UP,
  createInitialState,
  DEFAULT_PARAMS,
  getLevel,
  HOOK_ATTACHED,
  makeInput,
  step,
  T_SOLID,
  TILE_SIZE,
  tileAt,
  type PlayerInput,
  type SimEvent,
} from '../src/sim';

function run(state: ReturnType<typeof createInitialState>, inputs: PlayerInput[], ticks: number, events: SimEvent[] = []) {
  for (let t = 0; t < ticks; t++) step(state, inputs, events);
  return events;
}

/** Place le joueur au centre d'une tuile (coordonnées en tuiles). */
function place(state: ReturnType<typeof createInitialState>, tx: number, ty: number) {
  const p = state.players[0];
  p.x = tx * TILE_SIZE + TILE_SIZE / 2;
  p.y = ty * TILE_SIZE + TILE_SIZE / 2;
  p.vx = 0;
  p.vy = 0;
}

// Map 0 (facile) : ancrage en (41..43, 20), sol en 30. Debout en (42, 29), on a 9 tuiles de vide au-dessus.
const UNDER_ANCHOR = { tx: 42, ty: 29 };
const ANCHOR_ROW = 20;

describe('physique de base', () => {
  it('le joueur spawn sur du sol et tombe/se pose sans mourir', () => {
    const s = createInitialState(1, 1);
    const level = getLevel(0);
    const below = tileAt(level, Math.floor(s.players[0].x / TILE_SIZE), Math.floor(s.players[0].y / TILE_SIZE) + 1);
    expect(below).toBe(T_SOLID);
    const ev = run(s, [makeInput()], 60);
    expect(s.players[0].deaths).toBe(0);
    expect(s.players[0].grounded).toBe(1);
    expect(ev.filter((e) => e.type === 'death')).toHaveLength(0);
  });

  it('le grappin s\'accroche à l\'ancrage, la corde ne s\'allonge jamais au-delà de sa longueur', () => {
    const s = createInitialState(1, 1);
    const p = s.players[0];
    place(s, UNDER_ANCHOR.tx, UNDER_ANCHOR.ty);
    expect(tileAt(getLevel(0), UNDER_ANCHOR.tx, ANCHOR_ROW)).toBe(T_SOLID);
    const ev: SimEvent[] = [];
    const before = { x: p.x, y: p.y };
    run(s, [makeInput(BTN_HOOK_L, AIM_UP)], 1, ev);
    // Mode par défaut : on reste accroché tant que le bouton est maintenu.
    expect(ev.some((e) => e.type === 'hookFire')).toBe(true);
    expect(ev.some((e) => e.type === 'hookHit')).toBe(true);
    const hook = p.hooks[0];
    expect(hook.state).toBe(HOOK_ATTACHED);
    expect(hook.y).toBeLessThan(before.y);
    const L = hook.length;
    // Maintien : la corde se rétracte jusqu'à minRopeLength puis on pendule. Contrainte vérifiée pendant 3 s.
    const inputs = [makeInput(BTN_HOOK_L, AIM_UP)];
    for (let t = 0; t < 180; t++) {
      step(s, inputs, ev);
      const d = Math.hypot(p.x - hook.x, p.y - hook.y);
      expect(d).toBeLessThanOrEqual(L + 0.5);
    }
    expect(hook.state).toBe(HOOK_ATTACHED);
  });

  it('mode par défaut : maintenir rétracte automatiquement, relâcher lâche le grappin', () => {
    const s = createInitialState(1, 1);
    const p = s.players[0];
    place(s, UNDER_ANCHOR.tx, UNDER_ANCHOR.ty);
    const ev: SimEvent[] = [];
    run(s, [makeInput(BTN_HOOK_L, AIM_UP)], 1, ev);
    expect(p.hooks[0].state).toBe(HOOK_ATTACHED);
    const L0 = p.hooks[0].length;
    run(s, [makeInput(BTN_HOOK_L, AIM_UP)], 15, ev); // maintien seul : reel auto pendant 0.25 s
    expect(ev.some((e) => e.type === 'reelStart')).toBe(true);
    expect(L0 - p.hooks[0].length).toBeCloseTo(DEFAULT_PARAMS.reelSpeed * 0.25, 0);
    // La touche reel dédiée ne change rien de plus dans ce mode.
    const L1 = p.hooks[0].length;
    run(s, [makeInput(BTN_HOOK_L | BTN_REEL, AIM_UP)], 6, ev);
    expect(L1 - p.hooks[0].length).toBeCloseTo(DEFAULT_PARAMS.reelSpeed * 0.1, 0);
    run(s, [makeInput(0, AIM_UP)], 1, ev); // relâche : lâche
    expect(p.hooks[0].state).not.toBe(HOOK_ATTACHED);
    expect(ev.some((e) => e.type === 'hookDetach')).toBe(true);
  });

  it('suspendu, gauche/droite pompe le balancier (au sol, ça marche à peine)', () => {
    const s = createInitialState(1, 1);
    s.params.reelSpeed = 0; // pendule à longueur fixe : on mesure swingForce, pas la rétraction auto
    const p = s.players[0];
    place(s, UNDER_ANCHOR.tx, UNDER_ANCHOR.ty);
    run(s, [makeInput(BTN_HOOK_L, AIM_UP)], 1);
    run(s, [makeInput(BTN_HOOK_L | BTN_RIGHT, AIM_UP)], 30);
    expect(p.vx).toBeGreaterThan(150);
    const grounded = createInitialState(1, 1);
    run(grounded, [makeInput(BTN_RIGHT)], 60);
    expect(grounded.players[0].vx).toBeLessThanOrEqual(DEFAULT_PARAMS.walkSpeed + 1);
  });

  it('mode spec d\'origine (holdToAttach=0) : maintenir = reel, relâcher stoppe, second appui détache', () => {
    const s = createInitialState(1, 1);
    s.params.holdToAttach = 0;
    const p = s.players[0];
    place(s, UNDER_ANCHOR.tx, UNDER_ANCHOR.ty);
    const ev: SimEvent[] = [];
    run(s, [makeInput(BTN_HOOK_L, AIM_UP)], 1, ev); // tir (front)
    const L0 = p.hooks[0].length;
    run(s, [makeInput(BTN_HOOK_L, AIM_UP)], 15, ev); // maintien -> reel pendant 0.25 s
    expect(ev.some((e) => e.type === 'reelStart')).toBe(true);
    const L1 = p.hooks[0].length;
    expect(L1).toBeGreaterThan(DEFAULT_PARAMS.minRopeLength);
    expect(L0 - L1).toBeCloseTo(DEFAULT_PARAMS.reelSpeed * 0.25, 0);
    run(s, [makeInput(0, AIM_UP)], 10, ev); // relâche : stop reel, reste accroché
    expect(ev.some((e) => e.type === 'reelStop')).toBe(true);
    expect(p.hooks[0].state).toBe(HOOK_ATTACHED);
    expect(p.hooks[0].length).toBeCloseTo(L1, 6);
    run(s, [makeInput(BTN_HOOK_L, AIM_UP)], 1, ev); // second appui : détache
    expect(p.hooks[0].state).not.toBe(HOOK_ATTACHED);
    expect(ev.some((e) => e.type === 'hookDetach')).toBe(true);
  });

  it('le jetpack chauffe, coupe à 100 % puis reprend sous le seuil', () => {
    const s = createInitialState(1, 1);
    s.params.jetForce = s.params.gravity; // hover : on teste la chauffe, pas le plafond
    const p = s.players[0];
    const ev: SimEvent[] = [];
    const ticksToOverheat = Math.ceil(1 / (DEFAULT_PARAMS.heatRate / 60)) + 2;
    run(s, [makeInput(BTN_JET, AIM_UP)], ticksToOverheat, ev);
    expect(ev.some((e) => e.type === 'overheat')).toBe(true);
    expect(p.overheated).toBe(1);
    expect(p.jetThrust).toBe(0);
    // On maintient : ça refroidit malgré le bouton (0.65 / 0.55 par s = 71 ticks), puis reprise.
    const ticksToResume = Math.ceil((1 - DEFAULT_PARAMS.overheatResume) / (DEFAULT_PARAMS.coolRate / 60)) + 8;
    run(s, [makeInput(BTN_JET, AIM_UP)], ticksToResume, ev);
    expect(p.overheated).toBe(0);
    expect(p.jetThrust).toBe(1);
  });

  it('un impact au mur au-dessus du seuil tue et respawn instantanément', () => {
    const s = createInitialState(1, 1);
    s.params.gravity = 0;
    const p = s.players[0];
    p.y -= 200;
    p.vx = -DEFAULT_PARAMS.wallDeathSpeed * 1.5; // vers le mur gauche
    const ev = run(s, [makeInput()], 60);
    const death = ev.find((e) => e.type === 'death');
    expect(death?.cause).toBe('wall');
    expect(ev.some((e) => e.type === 'respawn')).toBe(true);
    expect(p.deaths).toBe(1);
    expect(p.x).toBeCloseTo(getLevel(0).spawnX);
  });

  it('un impact sous le seuil ne tue pas', () => {
    const s = createInitialState(1, 1);
    s.params.gravity = 0;
    const p = s.players[0];
    p.y -= 200;
    p.vx = -DEFAULT_PARAMS.wallDeathSpeed * 0.5;
    const ev = run(s, [makeInput()], 60);
    expect(ev.find((e) => e.type === 'death')).toBeUndefined();
    expect(p.deaths).toBe(0);
    expect(Math.abs(p.vx)).toBeLessThan(1);
  });

  it('un ennemi percuté au-dessus du seuil meurt, en dessous il repousse et blesse', () => {
    const s = createInitialState(1, 1);
    s.params.gravity = 0;
    const p = s.players[0];
    const e = s.enemies[0];
    e.patrol = 0; // on teste le seuil de kill, pas la patrouille
    e.speed = 0;
    p.x = e.x - 60;
    p.y = e.y;
    p.vx = DEFAULT_PARAMS.enemyKillSpeed + 200;
    const ev = run(s, [makeInput()], 10);
    expect(ev.some((x) => x.type === 'enemyKill')).toBe(true);
    expect(e.alive).toBe(0);
    expect(p.vx).toBeGreaterThan(DEFAULT_PARAMS.enemyKillSpeed); // traverse sans perdre de vitesse

    const s2 = createInitialState(1, 1);
    s2.params.gravity = 0;
    const p2 = s2.players[0];
    const e2 = s2.enemies[0];
    e2.patrol = 0;
    e2.speed = 0;
    p2.x = e2.x - 60;
    p2.y = e2.y;
    p2.vx = 100;
    const ev2 = run(s2, [makeInput()], 30);
    expect(ev2.some((x) => x.type === 'playerHit')).toBe(true);
    expect(e2.alive).toBe(1);
    expect(p2.hp).toBe(DEFAULT_PARAMS.maxHp - 1);
    expect(p2.vx).toBeLessThan(0); // repoussé
  });
});
