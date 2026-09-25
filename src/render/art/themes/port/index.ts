/** Port d'Umibozu : un port de pêcheurs pris dans l'orage, Umibozu sort de l'eau derrière les pontons. */
import type { ThemeModule } from '../runtime';
import { portPainter } from './painter';
import { createPortRuntime } from './runtime';

export { portPainter };

export const portTheme: ThemeModule = { painter: portPainter, createRuntime: createPortRuntime };
