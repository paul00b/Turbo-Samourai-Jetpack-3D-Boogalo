/**
 * Paramètres de simulation (tunables du panneau de debug).
 * Tous numériques (les toggles valent 0/1) : sérialisation triviale et ordre de champs fixe (PARAM_KEYS).
 * Les params FONT PARTIE de l'état (state.params) : la sim ne dépend que de (state, inputs).
 */

export interface SimParams {
  gravity: number;
  walkSpeed: number;
  walkAccel: number;
  groundFriction: number;
  hookSpeed: number;
  hookMaxLength: number;
  holdToAttach: number;
  swingForce: number;
  reelSpeed: number;
  ropeStiffness: number;
  ropeDamping: number;
  reelAngularBoost: number;
  minRopeLength: number;
  jetForce: number;
  heatRate: number;
  coolRate: number;
  overheatResume: number;
  airDrag: number;
  maxSpeed: number;
  wallDeathSpeed: number;
  enemyKillSpeed: number;
  enemyKnockback: number;
  playerMass: number;
  playerRadius: number;
  constraintIterations: number;
  substeps: number;
  maxHp: number;
  invulnTicks: number;
  cutWindowTicks: number;
  cutBufferTicks: number;
  enemyRespawnTicks: number;
  enemiesEnabled: number;
  enemyLethal: number;
  /** 1 = les ennemis respawnent sans fin (score attack). 0 = stock fini, tuer tout termine le niveau. */
  enemiesUnlimited: number;
  manualCut: number;
}

export const DEFAULT_PARAMS: Readonly<SimParams> = Object.freeze({
  gravity: 1800,
  walkSpeed: 45,
  walkAccel: 300,
  groundFriction: 6,
  hookSpeed: 25000,
  hookMaxLength: 420,
  reelSpeed: 390,
  ropeStiffness: 1,
  ropeDamping: 0.04,
  reelAngularBoost: 0.35,
  minRopeLength: 28,
  jetForce: 3100,
  heatRate: 1.85,
  coolRate: 0.55,
  overheatResume: 0.35,
  airDrag: 0.06,
  maxSpeed: 2600,
  wallDeathSpeed: 2510,
  enemyKillSpeed: 450,
  enemyKnockback: 520,
  playerMass: 1,
  playerRadius: 11,
  constraintIterations: 6,
  substeps: 4,
  maxHp: 3,
  invulnTicks: 45,
  cutWindowTicks: 10,
  cutBufferTicks: 6,
  enemyRespawnTicks: 240,
  enemiesEnabled: 1,
  enemyLethal: 0,
  manualCut: 0,
  holdToAttach: 1,
  swingForce: 700,
  enemiesUnlimited: 0,
});

/** Ordre canonique des champs : utilisé par la sérialisation binaire. NE PAS réordonner sans bump de version. */
export const PARAM_KEYS: readonly (keyof SimParams)[] = Object.freeze(
  Object.keys(DEFAULT_PARAMS) as (keyof SimParams)[],
);

export type ParamGroup = 'Mouvement' | 'Grappin' | 'Jetpack' | 'Mort' | 'Ennemis' | 'Solveur';

export interface ParamMeta {
  key: keyof SimParams;
  label: string;
  min: number;
  max: number;
  step: number;
  group: ParamGroup;
  unit?: string;
  hint?: string;
  integer?: boolean;
}

export const PARAM_META: readonly ParamMeta[] = [
  { key: 'gravity', label: 'Gravité', min: 0, max: 5000, step: 10, group: 'Mouvement', unit: 'px/s²' },
  { key: 'walkSpeed', label: 'Vitesse de marche', min: 0, max: 400, step: 1, group: 'Mouvement', unit: 'px/s', hint: 'Volontairement ridicule (tongs).' },
  { key: 'walkAccel', label: 'Accélération marche', min: 0, max: 3000, step: 10, group: 'Mouvement', unit: 'px/s²' },
  { key: 'groundFriction', label: 'Friction au sol', min: 0, max: 30, step: 0.1, group: 'Mouvement', unit: '/s' },
  { key: 'airDrag', label: 'Friction de l\'air', min: 0, max: 2, step: 0.005, group: 'Mouvement', unit: '/s' },
  { key: 'maxSpeed', label: 'Vitesse max', min: 100, max: 8000, step: 10, group: 'Mouvement', unit: 'px/s' },
  { key: 'playerMass', label: 'Masse du personnage', min: 0.1, max: 10, step: 0.1, group: 'Mouvement', hint: 'Joue sur le partage des tractions joueur-joueur et sur l\'accélération du jetpack.' },
  { key: 'playerRadius', label: 'Rayon du personnage', min: 4, max: 24, step: 0.5, group: 'Mouvement', unit: 'px' },

  { key: 'hookSpeed', label: 'Vitesse du projectile', min: 500, max: 40000, step: 100, group: 'Grappin', unit: 'px/s', hint: '25000 = quasi instantané (~420 px par tick, toute la portée).' },
  { key: 'hookMaxLength', label: 'Longueur max', min: 50, max: 2400, step: 8, group: 'Grappin', unit: 'px', hint: '420 = 13 tuiles : debout au sol, la rangée d\'ancrages du bas (10 tuiles) est atteignable sans sauter.' },
  { key: 'swingForce', label: 'Pompage du balancier (gauche/droite)', min: 0, max: 3000, step: 10, group: 'Grappin', unit: 'px/s²', hint: 'Accélération horizontale quand on est suspendu et qu\'on appuie gauche/droite.' },
  { key: 'reelSpeed', label: 'Vitesse de reel', min: 0, max: 2500, step: 10, group: 'Grappin', unit: 'px/s' },
  { key: 'ropeStiffness', label: 'Raideur de la corde', min: 0.05, max: 1, step: 0.01, group: 'Grappin', hint: '1 = rigide. Fraction de correction par itération.' },
  { key: 'ropeDamping', label: 'Amortissement pendule', min: 0, max: 3, step: 0.01, group: 'Grappin', unit: '/s' },
  { key: 'reelAngularBoost', label: 'Conservation moment angulaire', min: 0, max: 1, step: 0.01, group: 'Grappin', hint: '0 = vitesse tangentielle conservée (PBD brut), 1 = physique réelle (v_t ∝ 1/r).' },
  { key: 'minRopeLength', label: 'Longueur min de corde', min: 8, max: 200, step: 1, group: 'Grappin', unit: 'px' },

  { key: 'jetForce', label: 'Force du jetpack', min: 0, max: 10000, step: 50, group: 'Jetpack', unit: 'N (px/s² à masse 1)' },
  { key: 'heatRate', label: 'Vitesse de chauffe', min: 0, max: 3, step: 0.01, group: 'Jetpack', unit: '/s' },
  { key: 'coolRate', label: 'Vitesse de refroidissement', min: 0, max: 3, step: 0.01, group: 'Jetpack', unit: '/s' },
  { key: 'overheatResume', label: 'Seuil de reprise après surchauffe', min: 0, max: 0.95, step: 0.01, group: 'Jetpack' },

  { key: 'wallDeathSpeed', label: 'Seuil de mort au mur', min: 50, max: 5000, step: 10, group: 'Mort', unit: 'px/s', hint: 'Composante normale de la vitesse à l\'impact. 2510 = chute libre de ~55 tuiles, juste sous la vitesse max (2600) : seuls les impacts presque à fond tuent.' },
  { key: 'maxHp', label: 'Points de vie', min: 1, max: 20, step: 1, group: 'Mort', integer: true },
  { key: 'invulnTicks', label: 'Invulnérabilité après coup', min: 0, max: 300, step: 1, group: 'Mort', unit: 'ticks', integer: true },

  { key: 'enemyKillSpeed', label: 'Seuil de kill d\'ennemi', min: 0, max: 3000, step: 10, group: 'Ennemis', unit: 'px/s' },
  { key: 'enemyKnockback', label: 'Repoussée', min: 0, max: 3000, step: 10, group: 'Ennemis', unit: 'px/s' },
  { key: 'cutWindowTicks', label: 'Fenêtre de cut manuel', min: 1, max: 60, step: 1, group: 'Ennemis', unit: 'ticks', integer: true },
  { key: 'cutBufferTicks', label: 'Buffer d\'appui avant contact', min: 0, max: 60, step: 1, group: 'Ennemis', unit: 'ticks', integer: true },
  { key: 'enemyRespawnTicks', label: 'Respawn ennemi', min: 0, max: 3600, step: 10, group: 'Ennemis', unit: 'ticks', integer: true },

  { key: 'constraintIterations', label: 'Sous-itérations de contrainte', min: 1, max: 40, step: 1, group: 'Solveur', integer: true },
  { key: 'substeps', label: 'Sous-pas d\'intégration par tick', min: 1, max: 16, step: 1, group: 'Solveur', integer: true, hint: 'Le tick reste à 60 Hz ; ceci découpe le tick en interne (CCD + stabilité).' },
];

export interface ToggleMeta {
  key: keyof SimParams;
  label: string;
  hint?: string;
}

/** Toggles qui vivent DANS la sim (les autres, caméra/hitboxes/etc., sont côté IO/rendu). */
export const PARAM_TOGGLES: readonly ToggleMeta[] = [
  { key: 'enemiesEnabled', label: 'Ennemis' },
  { key: 'enemyLethal', label: 'Ennemis létaux (sinon repoussée + dégâts)' },
  { key: 'enemiesUnlimited', label: 'Ennemis illimités', hint: 'Ils respawnent et le compteur monte sans fin. Décoché : stock fini, tuer tout le monde termine le niveau et fige le chrono.' },
  { key: 'manualCut', label: 'Cut manuel (appui requis au contact)' },
  { key: 'holdToAttach', label: 'Grappin : maintenir = accroché + rétraction auto, relâcher = lâcher (sinon : maintenir = reel, second appui = lâcher)' },
];

export function cloneParams(p: Readonly<SimParams>): SimParams {
  return { ...p };
}

/** Assainit une valeur : bornes de la meta, entier si requis, NaN -> défaut. */
export function sanitizeParam(key: keyof SimParams, value: number): number {
  const meta = PARAM_META.find((m) => m.key === key);
  if (!Number.isFinite(value)) return DEFAULT_PARAMS[key];
  if (!meta) return value === 0 ? 0 : 1; // toggle
  let v = value < meta.min ? meta.min : value > meta.max ? meta.max : value;
  if (meta.integer) v = Math.round(v);
  return v;
}

export function paramsFromPartial(partial: Partial<Record<string, unknown>>): SimParams {
  const out = cloneParams(DEFAULT_PARAMS);
  for (const key of PARAM_KEYS) {
    const v = partial[key];
    if (typeof v === 'number') out[key] = sanitizeParam(key, v);
    else if (typeof v === 'boolean') out[key] = v ? 1 : 0;
  }
  return out;
}
