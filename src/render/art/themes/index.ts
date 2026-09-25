/** Registre des thèmes et attribution par défaut aux cartes. */
import type { ThemeModule } from './runtime';
import type { ThemeId } from './types';
import { bambooTheme } from './bamboo';
import { forgeTheme } from './forge';
import { portTheme } from './port';

export type ThemeSetting = 'auto' | ThemeId;

export const THEME_IDS: readonly ThemeId[] = ['port', 'forge', 'bamboo'];

const THEMES: Record<ThemeId, ThemeModule> = {
  port: portTheme,
  forge: forgeTheme,
  bamboo: bambooTheme,
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

export function getTheme(id: ThemeId): ThemeModule {
  return THEMES[id] ?? portTheme;
}

