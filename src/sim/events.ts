/**
 * Événements émis par la simulation pendant un tick. La sim ne fait RIEN d'autre que les pousser
 * dans un tableau : c'est la couche IO (audio, particules, HUD) qui les consomme.
 * En rollback, l'app ne rejoue que les événements des ticks simulés pour la première fois.
 */

export type SimEventType =
  | 'hookFire'
  | 'hookHit'
  | 'hookMiss'
  | 'hookDetach'
  | 'reelStart'
  | 'reelStop'
  | 'jetStart'
  | 'jetStop'
  | 'overheat'
  | 'land'
  | 'death'
  | 'respawn'
  | 'enemyKill'
  | 'playerHit'
  | 'cutWindowOpen';

export type DeathCause = 'wall' | 'spike' | 'enemy' | 'void';

export interface SimEvent {
  type: SimEventType;
  tick: number;
  player: number;
  x: number;
  y: number;
  /** Index du grappin (0 gauche, 1 droit) si pertinent. */
  hook?: number;
  cause?: DeathCause;
  enemy?: number;
  /** Valeur scalaire contextuelle (vitesse d'impact, etc.). */
  value?: number;
}
