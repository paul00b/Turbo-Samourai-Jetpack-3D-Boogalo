/**
 * Persistance des paramètres de sim + seed (localStorage) et import/export JSON pour les partager.
 */
import { cloneParams, DEFAULT_PARAMS, PARAM_KEYS, paramsFromPartial, sanitizeParam, type SimParams } from '../sim';
import type { CameraSettings, DebugVisuals } from './settings';

const STORAGE_KEY = 'tsj.params.v1';

export interface ExportedConfig {
  format: 'tsj-config';
  version: 1;
  exportedAt: string;
  seed: number;
  params: SimParams;
  debug?: Partial<DebugVisuals>;
  camera?: Partial<CameraSettings>;
  cameraMode?: 'single' | 'split';
  playerCount?: 1 | 2;
}

type Listener = (params: SimParams, changedKey: keyof SimParams | null) => void;

export class ParamsStore {
  private params: SimParams;
  private listeners: Listener[] = [];

  constructor() {
    this.params = ParamsStore.load();
  }

  get(): Readonly<SimParams> {
    return this.params;
  }

  set(key: keyof SimParams, value: number): void {
    const v = sanitizeParam(key, value);
    if (this.params[key] === v) return;
    this.params[key] = v;
    this.save();
    for (const l of this.listeners) l(this.params, key);
  }

  replace(params: Partial<Record<string, unknown>>): void {
    this.params = paramsFromPartial(params);
    this.save();
    for (const l of this.listeners) l(this.params, null);
  }

  resetDefaults(): void {
    this.replace({ ...cloneParams(DEFAULT_PARAMS) } as Record<string, unknown>);
  }

  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.params));
    } catch {
      /* ignore */
    }
  }

  private static load(): SimParams {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return cloneParams(DEFAULT_PARAMS);
      return paramsFromPartial(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return cloneParams(DEFAULT_PARAMS);
    }
  }
}

export function exportConfig(input: Omit<ExportedConfig, 'format' | 'version' | 'exportedAt'>): string {
  const ordered = {} as SimParams;
  for (const k of PARAM_KEYS) ordered[k] = input.params[k];
  const out: ExportedConfig = {
    format: 'tsj-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    seed: input.seed,
    params: ordered,
    debug: input.debug,
    camera: input.camera,
    cameraMode: input.cameraMode,
    playerCount: input.playerCount,
  };
  return JSON.stringify(out, null, 2);
}

export function parseConfig(text: string): ExportedConfig {
  const raw = JSON.parse(text) as Partial<ExportedConfig> & { params?: unknown };
  if (!raw || typeof raw !== 'object') throw new Error('JSON invalide');
  // Tolérant : accepte aussi un objet de params brut.
  const paramsSrc = (raw.params && typeof raw.params === 'object' ? raw.params : raw) as Record<string, unknown>;
  const params = paramsFromPartial(paramsSrc);
  return {
    format: 'tsj-config',
    version: 1,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    seed: typeof raw.seed === 'number' ? raw.seed >>> 0 : 1234,
    params,
    debug: raw.debug && typeof raw.debug === 'object' ? raw.debug : undefined,
    camera: raw.camera && typeof raw.camera === 'object' ? raw.camera : undefined,
    cameraMode: raw.cameraMode === 'split' ? 'split' : raw.cameraMode === 'single' ? 'single' : undefined,
    playerCount: raw.playerCount === 2 ? 2 : raw.playerCount === 1 ? 1 : undefined,
  };
}
