/**
 * Bambouseraie maudite : une forêt de bambous la nuit, des ruines couvertes de mousse et un ryū de
 * jade qui traverse le ciel devant la lune.
 */
import type { ThemeModule } from '../runtime';
import { bambooPainter } from './painter';
import { createBambooRuntime } from './runtime';

export { bambooPainter };

export const bambooTheme: ThemeModule = { painter: bambooPainter, createRuntime: createBambooRuntime };
