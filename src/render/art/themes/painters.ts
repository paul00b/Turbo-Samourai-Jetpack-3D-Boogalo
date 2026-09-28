/**
 * Registre PUR des peintres et attribution des thèmes aux cartes (aucun import de Pixi) : ce que
 * les tests et les outils sous Node peuvent charger. Le registre complet, avec les runtimes, est
 * dans ./index.ts.
 */
import { CUSTOM_LEVEL_ID, LEVEL_DEFS, type BiomeId } from '../../../sim/level';
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

/** Chaque biome de la sim a son thème (même identifiant). */
const BIOME_THEME: Record<BiomeId, ThemeId> = { port: 'port', bamboo: 'bamboo', forge: 'forge' };

/** Un thème par carte, dans l'ordre de LEVEL_DEFS : celui de son biome. */
export const LEVEL_THEMES: readonly ThemeId[] = LEVEL_DEFS.map((d) => BIOME_THEME[d.biome]);

/** Thème de la carte perso (choisi dans l'éditeur). */
let customTheme: ThemeId = 'port';

export function setCustomTheme(id: ThemeId): void {
  customTheme = id;
}

export function themeIdFor(setting: ThemeSetting, levelId: number): ThemeId {
  if (setting !== 'auto') return setting;
  if (levelId === CUSTOM_LEVEL_ID) return customTheme;
  return LEVEL_THEMES[levelId] ?? 'port';
}
