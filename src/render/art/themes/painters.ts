/**
 * Registre PUR des peintres et attribution des thèmes aux cartes (aucun import de Pixi) : ce que
 * les tests et les outils sous Node peuvent charger. Le registre complet, avec les runtimes, est
 * dans ./index.ts.
 */
import type { ThemeId, ThemePainter } from './types';
import { bambooPainter } from './bamboo/painter';
import { forgePainter } from './forge/painter';
import { portPainter } from './port/painter';

export type ThemeSetting = 'auto' | ThemeId;

export const THEME_IDS: readonly ThemeId[] = ['port', 'forge', 'bamboo'];

export const PAINTERS: Record<ThemeId, ThemePainter> = {
  port: portPainter,
  forge: forgePainter,
  bamboo: bambooPainter,
};

/**
 * Un thème par carte, dans l'ordre de LEVEL_DEFS : le port pour les deux cartes d'entrée, la
 * forteresse pour les plus dures, la bambouseraie entre les deux et pour le gouffre.
 */
export const LEVEL_THEMES: readonly ThemeId[] = ['port', 'bamboo', 'forge', 'forge', 'port', 'forge', 'bamboo'];

export function themeIdFor(setting: ThemeSetting, levelId: number): ThemeId {
  if (setting !== 'auto') return setting;
  return LEVEL_THEMES[levelId] ?? 'port';
}
