/** Registre des thèmes (peintre + runtime Pixi). L'attribution aux cartes vit dans ./painters.ts. */
import type { ThemeModule } from './runtime';
import type { ThemeId } from './types';
import { bambooTheme } from './bamboo';
import { forgeTheme } from './forge';
import { portTheme } from './port';

export { LEVEL_THEMES, THEME_IDS, themeIdFor, type ThemeSetting } from './painters';

const THEMES: Record<ThemeId, ThemeModule> = {
  port: portTheme,
  forge: forgeTheme,
  bamboo: bambooTheme,
};

export function getTheme(id: ThemeId): ThemeModule {
  return THEMES[id] ?? portTheme;
}
