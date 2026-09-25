/** Partie Pixi d'un thème : les couches animées de fond, de milieu et de premier plan d'UNE vue. */
import type { Container } from 'pixi.js';
import type { ThemeFrame, ThemePainter } from './types';

export interface ThemeRuntime {
  /** Fond (ciel, lointains, créature, mer ou lave…), en coordonnées de la vue. */
  readonly back: Container;
  /** Entre les tuiles et les dangers : brumes, reflets. */
  readonly mid: Container;
  /** Au-dessus de tout : pluie, braises, bambous de premier plan. S'écarte du perso. */
  readonly front: Container;
  update(f: ThemeFrame): void;
  destroy(): void;
}

export interface ThemeModule {
  painter: ThemePainter;
  createRuntime(): ThemeRuntime;
}
