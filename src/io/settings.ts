/**
 * Réglages persistés (localStorage). Tout ce qui est côté IO/rendu et pas dans la sim :
 * volumes, caméra, périphériques par joueur, bindings, options de debug visuel.
 */
import { clampLevelId } from '../sim';
import {
  cloneGamepadBindings,
  cloneKeyboardBindings,
  DEFAULT_GAMEPAD,
  DEFAULT_KEYBOARD,
  type GamepadBindings,
  type KeyboardBindings,
} from './input/bindings';

export type CameraMode = 'single' | 'split';
export type DeviceKind = 'kbm' | 'gamepad';

export interface PlayerDevice {
  kind: DeviceKind;
  /** Index Gamepad API, ou -1 = première manette libre. */
  gamepadIndex: number;
}

export interface DebugVisuals {
  showHitboxes: boolean;
  showVelocity: boolean;
  showTrail: boolean;
  trailSeconds: number;
  panelOpen: boolean;
  /** Onglet latéral ouvert ('debug' | 'cartes' | 'réseau'). */
  panelTab: string;
}

export interface CameraSettings {
  zoomMin: number;
  zoomMax: number;
  soloZoom: number;
  splitZoom: number;
  margin: number;
  smoothing: number;
}

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  cameraMode: CameraMode;
  fullscreen: boolean;
  playerCount: 1 | 2;
  devices: [PlayerDevice, PlayerDevice];
  keyboard: KeyboardBindings;
  gamepad: GamepadBindings;
  debug: DebugVisuals;
  camera: CameraSettings;
  seed: number;
  /** Carte sélectionnée (index dans LEVELS, 0 = facile). */
  levelId: number;
  /** Relais de sessions (npm run server). */
  netUrl: string;
  /** Dernier code saisi, pour ne pas le retaper. */
  netLastCode: string;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.8,
  cameraMode: 'single',
  fullscreen: false,
  playerCount: 1,
  devices: [
    { kind: 'kbm', gamepadIndex: -1 },
    { kind: 'gamepad', gamepadIndex: -1 },
  ],
  keyboard: cloneKeyboardBindings(DEFAULT_KEYBOARD),
  gamepad: cloneGamepadBindings(DEFAULT_GAMEPAD),
  debug: { showHitboxes: false, showVelocity: false, showTrail: true, trailSeconds: 3, panelOpen: true, panelTab: 'debug' },
  camera: { zoomMin: 0.3, zoomMax: 0.9, soloZoom: 1.25, splitZoom: 0.8, margin: 260, smoothing: 7 },
  seed: 1234,
  levelId: 0,
  netUrl: defaultNetUrl(),
  netLastCode: '',
};

/** Même hôte que la page, port du relais : marche tel quel en LAN comme en local. */
function defaultNetUrl(): string {
  const host = typeof location !== 'undefined' && location.hostname ? location.hostname : 'localhost';
  const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}:8787`;
}

const STORAGE_KEY = 'tsj.settings.v1';

type Listener = (s: Settings) => void;

export class SettingsStore {
  private value: Settings;
  private listeners: Listener[] = [];

  constructor() {
    this.value = SettingsStore.load();
  }

  get(): Settings {
    return this.value;
  }

  /** Mutation in place puis notification + sauvegarde. */
  update(fn: (s: Settings) => void): void {
    fn(this.value);
    this.save();
    for (const l of this.listeners) l(this.value);
  }

  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  resetBindings(): void {
    this.update((s) => {
      s.keyboard = cloneKeyboardBindings(DEFAULT_KEYBOARD);
      s.gamepad = cloneGamepadBindings(DEFAULT_GAMEPAD);
    });
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      /* stockage indisponible : on vit sans */
    }
  }

  private static load(): Settings {
    const base = structuredClone(DEFAULT_SETTINGS);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return mergeSettings(base, parsed);
    } catch {
      return base;
    }
  }
}

function mergeSettings(base: Settings, parsed: Partial<Settings>): Settings {
  const out = base;
  if (typeof parsed.masterVolume === 'number') out.masterVolume = clamp01(parsed.masterVolume);
  if (typeof parsed.sfxVolume === 'number') out.sfxVolume = clamp01(parsed.sfxVolume);
  if (parsed.cameraMode === 'single' || parsed.cameraMode === 'split') out.cameraMode = parsed.cameraMode;
  if (typeof parsed.fullscreen === 'boolean') out.fullscreen = parsed.fullscreen;
  if (parsed.playerCount === 1 || parsed.playerCount === 2) out.playerCount = parsed.playerCount;
  if (Array.isArray(parsed.devices) && parsed.devices.length === 2) {
    for (let i = 0; i < 2; i++) {
      const d = parsed.devices[i];
      if (d && (d.kind === 'kbm' || d.kind === 'gamepad')) {
        out.devices[i] = { kind: d.kind, gamepadIndex: typeof d.gamepadIndex === 'number' ? d.gamepadIndex : -1 };
      }
    }
  }
  if (parsed.keyboard && typeof parsed.keyboard === 'object') {
    for (const k of Object.keys(out.keyboard) as (keyof KeyboardBindings)[]) {
      const v = (parsed.keyboard as Record<string, unknown>)[k];
      if (Array.isArray(v)) out.keyboard[k] = v.filter((x): x is string => typeof x === 'string');
    }
  }
  if (parsed.gamepad && typeof parsed.gamepad === 'object') {
    for (const k of Object.keys(out.gamepad) as (keyof GamepadBindings)[]) {
      const v = (parsed.gamepad as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        out.gamepad[k] = v.filter(
          (c): c is GamepadBindings[keyof GamepadBindings][number] =>
            !!c && typeof c === 'object' && typeof (c as { index: unknown }).index === 'number',
        );
      }
    }
  }
  if (parsed.debug && typeof parsed.debug === 'object') {
    Object.assign(out.debug, pickBooleansAndNumbers(parsed.debug));
    const tab = (parsed.debug as { panelTab?: unknown }).panelTab;
    if (typeof tab === 'string') out.debug.panelTab = tab;
  }
  if (parsed.camera && typeof parsed.camera === 'object') Object.assign(out.camera, pickBooleansAndNumbers(parsed.camera));
  if (typeof parsed.seed === 'number' && Number.isFinite(parsed.seed)) out.seed = parsed.seed >>> 0;
  if (typeof parsed.levelId === 'number') out.levelId = clampLevelId(parsed.levelId);
  if (typeof parsed.netUrl === 'string' && parsed.netUrl.startsWith('ws')) out.netUrl = parsed.netUrl;
  if (typeof parsed.netLastCode === 'string') out.netLastCode = parsed.netLastCode.slice(0, 6);
  return out;
}

function pickBooleansAndNumbers(o: object): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
