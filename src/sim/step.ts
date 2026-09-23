/**
 * step(state, inputs) : LA simulation. Pure au sens strict : ne lit que `state` et `inputs`,
 * n'écrit que dans `state` (en place) et `events`. Aucune dépendance au DOM, à Pixi, à l'audio,
 * au temps réel. Voir math.ts pour la liste des opérations autorisées.
 *
 * Structure d'un tick (60 Hz) :
 *   1. contrôles (fronts de boutons, tir/détache/reel des grappins, jetpack + chauffe, marche)
 *   2. `substeps` sous-pas d'intégration, chacun :
 *        forces -> prédiction de position -> vol des projectiles -> reel ->
 *        `constraintIterations` passes Gauss-Seidel sur les contraintes de corde (PBD) ->
 *        vitesse dérivée des positions -> collisions tuiles (mort par vitesse / pics) -> ennemis
 *   3. ennemis (patrouille, respawn), fenêtres de cut manuel, invulnérabilité
 */
import { BTN_GRAB, BTN_HOOK_L, BTN_HOOK_R, BTN_JET, BTN_LEFT, BTN_REEL, BTN_RIGHT, makeInput, type PlayerInput } from './input';
import { approach, dirFromAngle16, length, raySegmentCircle, vec2 } from './math';
import {
  getLevel,
  isSolidTile,
  makeRayHit,
  raycastTiles,
  SPIKE_INSET,
  T_AIR,
  T_SOLID,
  T_SPIKE,
  TILE_SIZE,
  tileAt,
  type Level,
} from './level';
import type { DeathCause, SimEvent, SimEventType } from './events';
import {
  HOOK_ATTACHED,
  HOOK_FLYING,
  HOOK_IDLE,
  MAX_PLAYERS,
  playerSpawnX,
  type GameState,
  type HookState,
  type PlayerState,
} from './state';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

const NEUTRAL = makeInput();

// Scratch transitoire (entièrement réécrit à chaque sous-pas ; jamais porté d'un tick à l'autre).
const px0 = new Float64Array(MAX_PLAYERS);
const py0 = new Float64Array(MAX_PLAYERS);
const reelStep = new Float64Array(MAX_PLAYERS * 2);
const scratchDir = vec2();
const rayHit = makeRayHit();

function emit(
  events: SimEvent[],
  state: GameState,
  type: SimEventType,
  player: number,
  x: number,
  y: number,
  extra?: Partial<SimEvent>,
): void {
  const ev: SimEvent = { type, tick: state.tick, player, x, y };
  if (extra) Object.assign(ev, extra);
  events.push(ev);
}

/** Avance la simulation d'un tick, en place. */
export function step(state: GameState, inputs: readonly PlayerInput[], events: SimEvent[]): void {
  state.tick++;
  const p = state.params;
  const level = getLevel(state.levelId);
  const n = state.playerCount;

  for (let i = 0; i < n; i++) updateControls(state, i, inputs[i] ?? NEUTRAL, events);

  const substeps = Math.max(1, Math.floor(p.substeps));
  const h = DT / substeps;
  const iterations = Math.max(1, Math.floor(p.constraintIterations));
  for (let s = 0; s < substeps; s++) {
    for (let i = 0; i < n; i++) integratePlayer(state, i, h);
    for (let i = 0; i < n; i++) advanceHooks(state, i, h, level, events);
    for (let i = 0; i < n; i++) reelHooks(state, i, h);
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) solveConstraints(state, i);
    }
    for (let i = 0; i < n; i++) updateVelocity(state, i, h);
    for (let i = 0; i < n; i++) collideTiles(state, i, level, events);
    for (let i = 0; i < n; i++) collideEnemies(state, i, events);
  }

  updateEnemies(state, level);
  for (let i = 0; i < n; i++) postTick(state, i, events);
}

// ---------------------------------------------------------------------------------------------
// 1. Contrôles
// ---------------------------------------------------------------------------------------------

function updateControls(state: GameState, i: number, input: PlayerInput, events: SimEvent[]): void {
  const p = state.params;
  const pl = state.players[i];
  const buttons = input.buttons & 0xffff;
  const pressed = buttons & ~pl.prevButtons;
  pl.prevButtons = buttons;

  dirFromAngle16(input.aim, scratchDir);
  pl.aimX = scratchDir.x;
  pl.aimY = scratchDir.y;
  if (pl.aimX > 0.02) pl.facing = 1;
  else if (pl.aimX < -0.02) pl.facing = -1;

  pl.walkDir = ((buttons & BTN_LEFT) !== 0 ? -1 : 0) + ((buttons & BTN_RIGHT) !== 0 ? 1 : 0);

  if (pressed & BTN_GRAB) pl.cutPressTick = state.tick;

  const reelHeld = (buttons & BTN_REEL) !== 0;
  for (let hIdx = 0; hIdx < 2; hIdx++) {
    const bit = hIdx === 0 ? BTN_HOOK_L : BTN_HOOK_R;
    const hook = pl.hooks[hIdx];
    const down = (buttons & bit) !== 0;
    const edge = (pressed & bit) !== 0;
    hook.reelDelta = 0;
    if (p.holdToAttach) {
      // Mode "maintenir = accroché" : relâcher lâche (ou annule le tir en vol). Le reel a sa propre touche.
      if (hook.state === HOOK_IDLE) {
        if (edge) fireHook(state, i, hIdx, events);
      } else if (!down) {
        detachHook(state, i, hIdx, events);
      } else if (hook.state === HOOK_ATTACHED) {
        setReeling(state, i, hIdx, reelHeld, events);
      }
    } else {
      // Mode spec d'origine : maintien = reel, relâcher garde la corde, second appui = lâcher.
      if (hook.state === HOOK_IDLE) {
        if (edge) fireHook(state, i, hIdx, events);
      } else if (hook.state === HOOK_ATTACHED) {
        if (edge) detachHook(state, i, hIdx, events);
        else setReeling(state, i, hIdx, down || reelHeld, events);
      }
      // HOOK_FLYING : on attend l'issue du vol.
    }
  }

  // Jetpack + chauffe
  const wantJet = (buttons & BTN_JET) !== 0;
  let thrust = 0;
  if (pl.overheated && pl.heat <= p.overheatResume) pl.overheated = 0;
  if (wantJet && !pl.overheated) {
    thrust = 1;
    pl.heat += p.heatRate * DT;
    if (pl.heat >= 1) {
      pl.heat = 1;
      pl.overheated = 1;
      thrust = 0;
      emit(events, state, 'overheat', i, pl.x, pl.y);
    }
  }
  if (!thrust) pl.heat = Math.max(0, pl.heat - p.coolRate * DT);
  if (thrust !== pl.jetThrust) emit(events, state, thrust ? 'jetStart' : 'jetStop', i, pl.x, pl.y);
  pl.jetThrust = thrust;
}

function setReeling(state: GameState, i: number, hIdx: number, reeling: boolean, events: SimEvent[]): void {
  const pl = state.players[i];
  const hook = pl.hooks[hIdx];
  const r = reeling ? 1 : 0;
  if (r === hook.reeling) return;
  hook.reeling = r;
  emit(events, state, r ? 'reelStart' : 'reelStop', i, pl.x, pl.y, { hook: hIdx });
}

function anyHookAttached(pl: PlayerState): boolean {
  return pl.hooks[0].state === HOOK_ATTACHED || pl.hooks[1].state === HOOK_ATTACHED;
}

function fireHook(state: GameState, i: number, hIdx: number, events: SimEvent[]): void {
  const pl = state.players[i];
  const hook = pl.hooks[hIdx];
  hook.state = HOOK_FLYING;
  hook.x = pl.x;
  hook.y = pl.y;
  hook.originX = pl.x;
  hook.originY = pl.y;
  hook.dirX = pl.aimX;
  hook.dirY = pl.aimY;
  hook.travelled = 0;
  hook.length = 0;
  hook.target = -1;
  hook.reeling = 0;
  emit(events, state, 'hookFire', i, pl.x, pl.y, { hook: hIdx });
}

function detachHook(state: GameState, i: number, hIdx: number, events: SimEvent[]): void {
  const pl = state.players[i];
  const hook = pl.hooks[hIdx];
  if (hook.state === HOOK_IDLE) return;
  if (hook.reeling) emit(events, state, 'reelStop', i, pl.x, pl.y, { hook: hIdx });
  const wasAttached = hook.state === HOOK_ATTACHED;
  hook.state = HOOK_IDLE;
  hook.reeling = 0;
  hook.target = -1;
  hook.length = 0;
  if (wasAttached) emit(events, state, 'hookDetach', i, pl.x, pl.y, { hook: hIdx });
}

// ---------------------------------------------------------------------------------------------
// 2. Sous-pas physiques
// ---------------------------------------------------------------------------------------------

function integratePlayer(state: GameState, i: number, h: number): void {
  const p = state.params;
  const pl = state.players[i];

  pl.vy += p.gravity * h;

  if (pl.jetThrust) {
    const a = (p.jetForce / p.playerMass) * h;
    pl.vx += pl.aimX * a;
    pl.vy += pl.aimY * a;
  }

  if (pl.grounded) {
    const fr = Math.max(0, 1 - p.groundFriction * h);
    pl.vx *= fr;
    if (pl.walkDir !== 0) pl.vx = approach(pl.vx, pl.walkDir * p.walkSpeed, p.walkAccel * h);
  } else if (pl.walkDir !== 0 && anyHookAttached(pl)) {
    // Pompage du balancier : suspendu, gauche/droite pousse horizontalement.
    pl.vx += pl.walkDir * p.swingForce * h;
  }

  const drag = Math.max(0, 1 - p.airDrag * h);
  pl.vx *= drag;
  pl.vy *= drag;

  clampSpeed(pl, p.maxSpeed);

  px0[i] = pl.x;
  py0[i] = pl.y;
  pl.x += pl.vx * h;
  pl.y += pl.vy * h;
}

function clampSpeed(pl: PlayerState, maxSpeed: number): void {
  const sp = length(pl.vx, pl.vy);
  if (sp > maxSpeed && sp > 0) {
    const k = maxSpeed / sp;
    pl.vx *= k;
    pl.vy *= k;
  }
}

function advanceHooks(state: GameState, i: number, h: number, level: Level, events: SimEvent[]): void {
  const p = state.params;
  const pl = state.players[i];
  for (let hIdx = 0; hIdx < 2; hIdx++) {
    const hook = pl.hooks[hIdx];
    if (hook.state !== HOOK_FLYING) continue;
    const remaining = p.hookMaxLength - hook.travelled;
    if (remaining <= 0) {
      missHook(state, i, hIdx, hook.x, hook.y, events);
      continue;
    }
    const seg = Math.min(p.hookSpeed * h, remaining);
    raycastTiles(level, hook.x, hook.y, hook.dirX, hook.dirY, seg, rayHit);
    let bestT = rayHit.hit ? rayHit.dist : Infinity;
    let bestPlayer = -1;
    for (let j = 0; j < state.playerCount; j++) {
      if (j === i) continue;
      const other = state.players[j];
      const t = raySegmentCircle(hook.x, hook.y, hook.dirX, hook.dirY, seg, other.x, other.y, p.playerRadius);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestPlayer = j;
      }
    }
    if (bestPlayer >= 0) {
      const other = state.players[bestPlayer];
      hook.state = HOOK_ATTACHED;
      hook.target = bestPlayer;
      hook.x = other.x;
      hook.y = other.y;
      hook.length = length(pl.x - other.x, pl.y - other.y);
      hook.travelled += bestT;
      emit(events, state, 'hookHit', i, other.x, other.y, { hook: hIdx, value: 1 });
    } else if (rayHit.hit) {
      if (rayHit.tile === T_SOLID && rayHit.dist > 0) {
        hook.state = HOOK_ATTACHED;
        hook.target = -1;
        hook.x = rayHit.x;
        hook.y = rayHit.y;
        hook.length = length(pl.x - hook.x, pl.y - hook.y);
        hook.travelled += rayHit.dist;
        emit(events, state, 'hookHit', i, hook.x, hook.y, { hook: hIdx, value: 0 });
      } else {
        missHook(state, i, hIdx, rayHit.x, rayHit.y, events);
      }
    } else {
      hook.x += hook.dirX * seg;
      hook.y += hook.dirY * seg;
      hook.travelled += seg;
      if (hook.travelled >= p.hookMaxLength) missHook(state, i, hIdx, hook.x, hook.y, events);
    }
  }
}

function missHook(state: GameState, i: number, hIdx: number, x: number, y: number, events: SimEvent[]): void {
  const hook = state.players[i].hooks[hIdx];
  hook.state = HOOK_IDLE;
  hook.target = -1;
  hook.reeling = 0;
  emit(events, state, 'hookMiss', i, x, y, { hook: hIdx });
}

function anchorX(state: GameState, hook: HookState): number {
  return hook.target >= 0 ? state.players[hook.target].x : hook.x;
}

function anchorY(state: GameState, hook: HookState): number {
  return hook.target >= 0 ? state.players[hook.target].y : hook.y;
}

function reelHooks(state: GameState, i: number, h: number): void {
  const p = state.params;
  const pl = state.players[i];
  for (let hIdx = 0; hIdx < 2; hIdx++) {
    const hook = pl.hooks[hIdx];
    reelStep[i * 2 + hIdx] = 0;
    if (hook.state !== HOOK_ATTACHED || !hook.reeling) continue;
    const d = length(pl.x - anchorX(state, hook), pl.y - anchorY(state, hook));
    const reeled = Math.max(p.minRopeLength, hook.length - p.reelSpeed * h);
    if (d < reeled) {
      // Corde molle : reprise immédiate du mou, sans travail sur le pendule (pas de boost angulaire).
      hook.reelDelta += hook.length - Math.max(p.minRopeLength, d);
      hook.length = Math.max(p.minRopeLength, d);
    } else {
      // Corde tendue : rétraction à vitesse constante.
      const delta = hook.length - reeled;
      hook.length = reeled;
      hook.reelDelta += delta;
      reelStep[i * 2 + hIdx] = delta;
    }
  }
}

/** Une passe Gauss-Seidel sur les contraintes de corde du joueur i (inégalité : la corde ne pousse pas). */
function solveConstraints(state: GameState, i: number): void {
  const p = state.params;
  const pl = state.players[i];
  const stiffness = p.ropeStiffness;
  for (let hIdx = 0; hIdx < 2; hIdx++) {
    const hook = pl.hooks[hIdx];
    if (hook.state !== HOOK_ATTACHED) continue;
    if (hook.target < 0) {
      const dx = pl.x - hook.x;
      const dy = pl.y - hook.y;
      const d = length(dx, dy);
      if (d > hook.length && d > 0) {
        const corr = ((d - hook.length) * stiffness) / d;
        pl.x -= dx * corr;
        pl.y -= dy * corr;
      }
    } else {
      const other = state.players[hook.target];
      const dx = pl.x - other.x;
      const dy = pl.y - other.y;
      const d = length(dx, dy);
      if (d > hook.length && d > 0) {
        const wA = 1 / p.playerMass;
        const wB = 1 / p.playerMass;
        const corr = ((d - hook.length) * stiffness) / d;
        const kA = wA / (wA + wB);
        const kB = wB / (wA + wB);
        pl.x -= dx * corr * kA;
        pl.y -= dy * corr * kA;
        other.x += dx * corr * kB;
        other.y += dy * corr * kB;
      }
    }
  }
}

function updateVelocity(state: GameState, i: number, h: number): void {
  const p = state.params;
  const pl = state.players[i];
  pl.vx = (pl.x - px0[i]) / h;
  pl.vy = (pl.y - py0[i]) / h;

  let attached = false;
  for (let hIdx = 0; hIdx < 2; hIdx++) {
    const hook = pl.hooks[hIdx];
    if (hook.state !== HOOK_ATTACHED) continue;
    attached = true;
    const dL = reelStep[i * 2 + hIdx];
    if (dL > 0 && hook.target < 0 && p.reelAngularBoost > 0) {
      // Conservation (partielle) du moment angulaire : v_t * r = const quand la corde raccourcit.
      const rx = pl.x - hook.x;
      const ry = pl.y - hook.y;
      const r = length(rx, ry);
      if (r > 1e-6) {
        const ux = rx / r;
        const uy = ry / r;
        const vr = pl.vx * ux + pl.vy * uy;
        const vtx = pl.vx - vr * ux;
        const vty = pl.vy - vr * uy;
        const factor = 1 + p.reelAngularBoost * (dL / r);
        pl.vx = vr * ux + vtx * factor;
        pl.vy = vr * uy + vty * factor;
      }
    }
  }
  if (attached) {
    const damp = Math.max(0, 1 - p.ropeDamping * h);
    pl.vx *= damp;
    pl.vy *= damp;
  }
  clampSpeed(pl, p.maxSpeed);
}

function collideTiles(state: GameState, i: number, level: Level, events: SimEvent[]): void {
  const p = state.params;
  const pl = state.players[i];
  const r = p.playerRadius;
  const ts = TILE_SIZE;
  const wasGrounded = pl.grounded;
  pl.grounded = 0;

  // Hors map (ne devrait pas arriver avec la bordure) : mort "void".
  if (pl.x < -ts * 2 || pl.y < -ts * 2 || pl.x > (level.width + 2) * ts || pl.y > (level.height + 2) * ts) {
    killPlayer(state, i, 'void', 0, events);
    return;
  }

  for (let pass = 0; pass < 4; pass++) {
    const minTx = Math.floor((pl.x - r) / ts);
    const maxTx = Math.floor((pl.x + r) / ts);
    const minTy = Math.floor((pl.y - r) / ts);
    const maxTy = Math.floor((pl.y + r) / ts);
    let bestPen = 0;
    let bestNx = 0;
    let bestNy = 0;
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const t = tileAt(level, tx, ty);
        if (t === T_AIR) continue;
        const x0 = tx * ts;
        const y0 = ty * ts;
        if (t === T_SPIKE) {
          const cx = clampNum(pl.x, x0 + SPIKE_INSET, x0 + ts - SPIKE_INSET);
          const cy = clampNum(pl.y, y0 + SPIKE_INSET, y0 + ts - SPIKE_INSET);
          const dx = pl.x - cx;
          const dy = pl.y - cy;
          if (dx * dx + dy * dy < r * r) {
            killPlayer(state, i, 'spike', length(pl.vx, pl.vy), events);
            return;
          }
          continue;
        }
        if (!isSolidTile(t)) continue;
        const cx = clampNum(pl.x, x0, x0 + ts);
        const cy = clampNum(pl.y, y0, y0 + ts);
        const dx = pl.x - cx;
        const dy = pl.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        let pen: number;
        let nx: number;
        let ny: number;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          pen = r - d;
          nx = dx / d;
          ny = dy / d;
        } else {
          // Centre à l'intérieur de la tuile : on sort par la face la plus proche.
          const ox = pl.x - (x0 + ts / 2);
          const oy = pl.y - (y0 + ts / 2);
          const ax = ox < 0 ? -ox : ox;
          const ay = oy < 0 ? -oy : oy;
          if (ax > ay) {
            nx = ox < 0 ? -1 : 1;
            ny = 0;
            pen = ts / 2 - ax + r;
          } else {
            nx = 0;
            ny = oy < 0 ? -1 : 1;
            pen = ts / 2 - ay + r;
          }
        }
        if (pen > bestPen) {
          bestPen = pen;
          bestNx = nx;
          bestNy = ny;
        }
      }
    }
    if (bestPen <= 0) break;

    pl.x += bestNx * bestPen;
    pl.y += bestNy * bestPen;
    const vn = pl.vx * bestNx + pl.vy * bestNy;
    if (vn < 0) {
      const impact = -vn;
      pl.lastImpact = impact;
      if (impact > p.wallDeathSpeed) {
        killPlayer(state, i, 'wall', impact, events);
        return;
      }
      pl.vx -= vn * bestNx;
      pl.vy -= vn * bestNy;
      if (bestNy < -0.7) {
        pl.grounded = 1;
        if (!wasGrounded && impact > 120) emit(events, state, 'land', i, pl.x, pl.y, { value: impact });
      }
    }
  }
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function collideEnemies(state: GameState, i: number, events: SimEvent[]): void {
  const p = state.params;
  if (!p.enemiesEnabled) return;
  const pl = state.players[i];
  if (pl.invuln > 0) return;
  const r = p.playerRadius;
  const enemies = state.enemies;
  for (let ei = 0; ei < enemies.length; ei++) {
    const e = enemies[ei];
    if (!e.alive || pl.pendingCutEnemy === ei) continue;
    const hw = e.w / 2;
    const hh = e.h / 2;
    const cx = clampNum(pl.x, e.x - hw, e.x + hw);
    const cy = clampNum(pl.y, e.y - hh, e.y + hh);
    const dx = pl.x - cx;
    const dy = pl.y - cy;
    if (dx * dx + dy * dy >= r * r) continue;

    const speed = length(pl.vx, pl.vy);
    if (speed >= p.enemyKillSpeed) {
      if (!p.manualCut || state.tick - pl.cutPressTick <= p.cutBufferTicks) {
        killEnemy(state, ei, i, events);
      } else {
        pl.pendingCutEnemy = ei;
        pl.pendingCutTicks = Math.max(1, Math.floor(p.cutWindowTicks));
        emit(events, state, 'cutWindowOpen', i, pl.x, pl.y, { enemy: ei });
      }
    } else {
      hitPlayer(state, i, ei, events);
      if (pl.invuln > 0 || pl.hp <= 0) return;
    }
  }
}

function killEnemy(state: GameState, ei: number, byPlayer: number, events: SimEvent[]): void {
  const e = state.enemies[ei];
  e.alive = 0;
  e.respawnTimer = Math.max(0, Math.floor(state.params.enemyRespawnTicks));
  emit(events, state, 'enemyKill', byPlayer, e.x, e.y, { enemy: ei });
}

function hitPlayer(state: GameState, i: number, ei: number, events: SimEvent[]): void {
  const p = state.params;
  const pl = state.players[i];
  const e = state.enemies[ei];
  if (p.enemyLethal) {
    killPlayer(state, i, 'enemy', length(pl.vx, pl.vy), events);
    return;
  }
  pl.hp -= 1;
  emit(events, state, 'playerHit', i, pl.x, pl.y, { enemy: ei, value: pl.hp });
  if (pl.hp <= 0) {
    killPlayer(state, i, 'enemy', length(pl.vx, pl.vy), events);
    return;
  }
  let dx = pl.x - e.x;
  let dy = pl.y - e.y;
  const d = length(dx, dy);
  if (d < 1e-6) {
    dx = 0;
    dy = -1;
  } else {
    dx /= d;
    dy /= d;
  }
  pl.vx = dx * p.enemyKnockback;
  pl.vy = dy * p.enemyKnockback;
  pl.invuln = Math.max(1, Math.floor(p.invulnTicks));
}

function killPlayer(state: GameState, i: number, cause: DeathCause, impact: number, events: SimEvent[]): void {
  const p = state.params;
  const pl = state.players[i];
  const level = getLevel(state.levelId);
  emit(events, state, 'death', i, pl.x, pl.y, { cause, value: impact });
  pl.deaths++;

  // Les grappins des autres joueurs accrochés à moi lâchent.
  for (let j = 0; j < state.playerCount; j++) {
    if (j === i) continue;
    const other = state.players[j];
    for (let hIdx = 0; hIdx < 2; hIdx++) {
      const hk = other.hooks[hIdx];
      if (hk.state === HOOK_ATTACHED && hk.target === i) detachHook(state, j, hIdx, events);
    }
  }
  for (let hIdx = 0; hIdx < 2; hIdx++) detachHook(state, i, hIdx, events);
  if (pl.jetThrust) emit(events, state, 'jetStop', i, pl.x, pl.y);

  pl.x = playerSpawnX(level.spawnX, i);
  pl.y = level.spawnY;
  pl.vx = 0;
  pl.vy = 0;
  px0[i] = pl.x;
  py0[i] = pl.y;
  pl.heat = 0;
  pl.overheated = 0;
  pl.jetThrust = 0;
  pl.grounded = 0;
  pl.hp = p.maxHp;
  pl.invuln = 0;
  pl.pendingCutEnemy = -1;
  pl.pendingCutTicks = 0;
  pl.lastImpact = 0;
  pl.spawnTick = state.tick;
  pl.teleportSeq++;
  emit(events, state, 'respawn', i, pl.x, pl.y);
}

// ---------------------------------------------------------------------------------------------
// 3. Post-tick
// ---------------------------------------------------------------------------------------------

function updateEnemies(state: GameState, level: Level): void {
  const p = state.params;
  if (!p.enemiesEnabled) return;
  const ts = TILE_SIZE;
  const enemies = state.enemies;
  for (let ei = 0; ei < enemies.length; ei++) {
    const e = enemies[ei];
    if (!e.alive) {
      if (e.respawnTimer > 0) {
        e.respawnTimer--;
        if (e.respawnTimer === 0) {
          e.alive = 1;
          e.x = e.spawnX;
          e.y = e.spawnY;
        }
      }
      continue;
    }
    if (!e.patrol) continue;
    const nx = e.x + e.dir * e.speed * DT;
    const aheadX = nx + e.dir * (e.w / 2 + 1);
    const tx = Math.floor(aheadX / ts);
    const tyMid = Math.floor(e.y / ts);
    const tyFeet = Math.floor((e.y + e.h / 2 + 2) / ts);
    const ahead = tileAt(level, tx, tyMid);
    const ground = tileAt(level, tx, tyFeet);
    if (ahead !== T_AIR || ground === T_AIR || ground === T_SPIKE) e.dir = -e.dir;
    else e.x = nx;
  }
}

function postTick(state: GameState, i: number, events: SimEvent[]): void {
  const pl = state.players[i];
  if (pl.invuln > 0) pl.invuln--;
  if (pl.pendingCutEnemy >= 0) {
    const ei = pl.pendingCutEnemy;
    const e = state.enemies[ei];
    if (!e || !e.alive || !state.params.enemiesEnabled) {
      pl.pendingCutEnemy = -1;
      pl.pendingCutTicks = 0;
    } else if (pl.cutPressTick === state.tick) {
      killEnemy(state, ei, i, events);
      pl.pendingCutEnemy = -1;
      pl.pendingCutTicks = 0;
    } else {
      pl.pendingCutTicks--;
      if (pl.pendingCutTicks <= 0) {
        pl.pendingCutEnemy = -1;
        pl.pendingCutTicks = 0;
        hitPlayer(state, i, ei, events);
      }
    }
  }
}
