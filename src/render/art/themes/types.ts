/**
 * Contrat d'un thème (un niveau des planches) :
 *
 *  - un PEINTRE pur, qui habille n'importe quelle carte en tuiles : il reçoit l'analyse de la carte
 *    et remplit des calques en px d'art (décor arrière, tuiles de jeu, décor avant) + une liste
 *    d'accessoires animés. Aucune dépendance à Pixi : testable sous Node.
 *  - un RUNTIME Pixi par vue (fond, parallaxe, créature, météo), créé par `createRuntime`.
 *
 * Grammaire commune à tous les thèmes (planches, « Ce qui garde le perso lisible ») :
 *   arête claire = accrochable (#), reflets obliques froids = lisse (=), pointe rouge = mortel (^),
 *   masque blanc = ennemi. Le décor reste dans les valeurs sombres ; seuls le perso, les arêtes
 *   accrochables et les dangers touchent les extrêmes. Aucun décor n'emploie une teinte de joueur.
 */
import type { Buf, Color } from '../../pixel/engine';
import type { LevelShape } from '../levelShape';

export type ThemeId = 'port' | 'forge' | 'bamboo';

export interface LevelCanvases {
  /** Décor derrière les tuiles : supports, fond de cave, bâtiments. px d'art monde. */
  back: Buf;
  /** Les tuiles de jeu habillées (la « couche de jeu » des planches). */
  tiles: Buf;
  /**
   * Les dangers (pics), dessinés AU-DESSUS des brumes du thème : un effet ne cache jamais un danger.
   */
  hazards: Buf;
  /** Décor devant les acteurs, créé à la demande (rarement utile : il ne doit rien masquer). */
  front(): Buf;
}

/** Accessoire animé posé par le peintre (lanterne, bannière, flamme…). */
export interface PropInstance {
  kind: string;
  /** Point d'ancrage, px d'art monde. */
  x: number;
  y: number;
  /** Décalage d'animation (s). */
  phase: number;
  layer: 'back' | 'front';
}

/** Animation pré-calculée d'un accessoire (frames en px d'art). */
export interface PropAnim {
  frames: Buf[];
  fps: number;
  /** Position de l'ancrage dans la frame. */
  ax: number;
  ay: number;
}

export interface ThemeStatic {
  id: ThemeId;
  /** Nom affiché (menus, panneau). */
  name: string;
  /** Nom du HUD, en capitales. */
  hud: string;
  /** Liseré de lumière du perso (couleur de la lumière du niveau). */
  rim: Color;
  /** Faible lueur qui suit le perso la nuit (null : pas de lueur). */
  halo: Color | null;
  /** Vent sur l'écharpe (px d'art/s², signe = sens). */
  wind: number;
  /** Fond uni du mode « Couche de jeu » (0xRRGGBB). */
  flat: number;
  /** Poussière à l'atterrissage et en glissade. */
  dust: readonly Color[];
  /** Couleurs du panneau (nom, hex). */
  swatches: readonly (readonly [string, string])[];
}

export interface ThemePainter extends ThemeStatic {
  /** Habille la carte. Retourne les accessoires animés à poser par-dessus. */
  paint(shape: LevelShape, out: LevelCanvases): PropInstance[];
  /** Animations des accessoires, par `kind` (calculées une fois). */
  props(): Record<string, PropAnim>;
}

/** Ce que le runtime sait de la frame à dessiner. */
export interface ThemeFrame {
  /** Temps ambiant (s), qui tourne aussi en pause : le décor vit derrière les menus. */
  t: number;
  dt: number;
  /** Coin haut-gauche de la vue, px d'art monde (entiers). */
  camX: number;
  camY: number;
  /** Taille de la vue en px d'art. */
  viewW: number;
  viewH: number;
  /** camY de la vue « à la maison » (centrée sur le spawn) : référence de la parallaxe verticale. */
  homeY: number;
  shape: LevelShape;
  /** Centres des joueurs actifs, px d'art monde (les effets de premier plan s'en écartent). */
  heroes: readonly { x: number; y: number }[];
  mode: 'art' | 'values' | 'play';
}

/** Parallaxe verticale : position écran d'un élément ancré à `worldY` pour un facteur `py`. */
export function parallaxY(f: ThemeFrame, worldY: number, py: number): number {
  return worldY - f.camY + (f.camY - f.homeY) * (1 - py);
}

/** Horizon des fonds (px d'art monde) : 45 px au-dessus du sol principal, comme les planches. */
export function horizonY(shape: LevelShape): number {
  return shape.floorRow * 16 - 45;
}
