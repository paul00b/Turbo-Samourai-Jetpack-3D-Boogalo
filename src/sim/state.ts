import { type SimParams, DEFAULT_PARAMS, cloneParams } from './params';
import { getLevel } from './level';
import { seedToState } from './rng';

export const HOOK_IDLE = 0;
export const HOOK_FLYING = 1;
export const HOOK_ATTACHED = 2;

export interface HookState {
  state: number; // HOOK_*
  /** Tête du projectile (en vol) ou point d'ancrage (attaché à un tile). */
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  travelled: number;
  originX: number;
  originY: number;
  length: number;
  /** -1 = ancré dans le décor, sinon index du joueur accroché. */
  target: number;
  reeling: number; // 0/1
  /** Longueur réduite pendant ce tick (pour le boost angulaire et l'audio). */
  reelDelta: number;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevButtons: number;
  aimX: number;
  aimY: number;
  grounded: number;
  heat: number;
  overheated: number;
  jetThrust: number; // 0/1 poussée active ce tick
  walkDir: number; // -1/0/1
  facing: number; // -1/1
  hp: number;
  deaths: number;
  spawnTick: number;
  /** Incrémenté à chaque téléportation (respawn) : le rendu saute l'interpolation. */
  teleportSeq: number;
  cutPressTick: number;
  invuln: number;
  pendingCutEnemy: number;
  pendingCutTicks: number;
  /** Vitesse d'impact normale du dernier contact mur (debug/HUD). */
  lastImpact: number;
  hooks: [HookState, HookState];
}

export interface EnemyState {
  x: number;
  y: number;
  w: number;
  h: number;
  spawnX: number;
  spawnY: number;
  alive: number;
  patrol: number;
  dir: number;
  speed: number;
  respawnTimer: number;
}

export interface GameState {
  tick: number;
  seed: number;
  rng: number;
  levelId: number;
  playerCount: number;
  params: SimParams;
  players: PlayerState[]; // toujours 2 entrées ; seules les `playerCount` premières sont simulées
  enemies: EnemyState[];
}

export const MAX_PLAYERS = 2;

export function makeHook(): HookState {
  return {
    state: HOOK_IDLE,
    x: 0,
    y: 0,
    dirX: 1,
    dirY: 0,
    travelled: 0,
    originX: 0,
    originY: 0,
    length: 0,
    target: -1,
    reeling: 0,
    reelDelta: 0,
  };
}

export function makePlayer(x: number, y: number, hp: number): PlayerState {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    prevButtons: 0,
    aimX: 1,
    aimY: 0,
    grounded: 0,
    heat: 0,
    overheated: 0,
    jetThrust: 0,
    walkDir: 0,
    facing: 1,
    hp,
    deaths: 0,
    spawnTick: 0,
    teleportSeq: 0,
    cutPressTick: -1000,
    invuln: 0,
    pendingCutEnemy: -1,
    pendingCutTicks: 0,
    lastImpact: 0,
    hooks: [makeHook(), makeHook()],
  };
}

export function playerSpawnX(levelSpawnX: number, playerIndex: number): number {
  return levelSpawnX + playerIndex * 48;
}

export function createInitialState(
  seed: number,
  playerCount: number,
  params: Readonly<SimParams> = DEFAULT_PARAMS,
  levelId = 0,
): GameState {
  const level = getLevel(levelId);
  const p = cloneParams(params);
  const players: PlayerState[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    players.push(makePlayer(playerSpawnX(level.spawnX, i), level.spawnY, p.maxHp));
  }
  const enemies: EnemyState[] = level.enemies.map((e) => ({
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
    spawnX: e.x,
    spawnY: e.y,
    alive: 1,
    patrol: e.patrol ? 1 : 0,
    dir: 1,
    speed: e.patrol ? 40 : 0,
    respawnTimer: 0,
  }));
  return {
    tick: 0,
    seed: seed >>> 0,
    rng: seedToState(seed),
    levelId,
    playerCount: playerCount === 2 ? 2 : 1,
    params: p,
    players,
    enemies,
  };
}

export function cloneHook(h: HookState): HookState {
  return { ...h };
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p, hooks: [cloneHook(p.hooks[0]), cloneHook(p.hooks[1])] };
}

export function cloneEnemy(e: EnemyState): EnemyState {
  return { ...e };
}

/** Copie profonde complète (utilisée par le ring buffer et l'interpolation de rendu). */
export function cloneState(s: GameState): GameState {
  return {
    tick: s.tick,
    seed: s.seed,
    rng: s.rng,
    levelId: s.levelId,
    playerCount: s.playerCount,
    params: cloneParams(s.params),
    players: s.players.map(clonePlayer),
    enemies: s.enemies.map(cloneEnemy),
  };
}
