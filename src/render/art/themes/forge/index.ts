/** Forteresse de braise : un château en flammes au pied de deux volcans, gardé par un oni de basalte. */
import type { ThemeModule } from '../runtime';
import { forgePainter } from './painter';
import { createForgeRuntime } from './runtime';

export { forgePainter };

export const forgeTheme: ThemeModule = { painter: forgePainter, createRuntime: createForgeRuntime };
