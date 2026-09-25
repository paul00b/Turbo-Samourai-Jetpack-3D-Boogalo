/**
 * Forteresse de braise (provisoire) : tant que le thème n'est pas peint, il reprend le port.
 * À remplacer par palette.ts / paint.ts / runtime.ts sur le modèle de themes/port.
 */
import type { ThemeModule } from '../runtime';
import { portPainter } from '../port';
import { createPortRuntime } from '../port/runtime';

export const forgeTheme: ThemeModule = {
  painter: { ...portPainter, id: 'forge', name: 'Forteresse de braise', hud: 'FORTERESSE DE BRAISE' },
  createRuntime: createPortRuntime,
};
