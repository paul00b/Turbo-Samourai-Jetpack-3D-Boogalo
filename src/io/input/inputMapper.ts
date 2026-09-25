/**
 * Couche d'assignation joueur -> périphérique. Produit les PlayerInput (bitfield + angle 16 bits)
 * à partir des bindings. La sim ne voit jamais un périphérique.
 */
import {
  angle16FromRadians,
  BTN_GRAB,
  BTN_HOOK_L,
  BTN_HOOK_R,
  BTN_JET,
  BTN_LEFT,
  BTN_REEL,
  BTN_RIGHT,
  makeInput,
  type GameState,
  type PlayerInput,
} from '../../sim';
import type { Settings } from '../settings';
import { GAMEPAD_MENU } from './bindings';
import { GamepadManager, type PadSnapshot } from './gamepad';
import type { KeyboardMouse } from './keyboardMouse';

/** Ce que le mapper a besoin de savoir du rendu : convertir un point écran en point monde pour un joueur. */
export interface WorldPicker {
  screenToWorld(sx: number, sy: number, playerIndex: number, out: { x: number; y: number }): boolean;
}

export type DeviceStatus = 'ok' | 'waiting-gamepad';

const RIGHT_STICK_X = 2;
const RIGHT_STICK_Y = 3;

export class InputMapper {
  private readonly inputs: PlayerInput[] = [makeInput(), makeInput()];
  private readonly lastAim = [0, 0];
  private readonly stick = { x: 0, y: 0 };
  private readonly world = { x: 0, y: 0 };
  private pauseWasDown = false;
  private restartWasDown = false;

  constructor(
    private readonly kbm: KeyboardMouse,
    private readonly pads: GamepadManager,
    private readonly settings: () => Settings,
  ) {}

  /** Manette effectivement assignée au joueur i (null si aucune). */
  padFor(playerIndex: number): PadSnapshot | null {
    const s = this.settings();
    const dev = s.devices[playerIndex];
    if (!dev || dev.kind !== 'gamepad') return null;
    if (dev.gamepadIndex >= 0) return this.pads.get(dev.gamepadIndex);
    // -1 : première manette non prise par un autre joueur avec un index explicite
    const taken = new Set<number>();
    for (let j = 0; j < s.devices.length; j++) {
      if (j !== playerIndex && s.devices[j].kind === 'gamepad' && s.devices[j].gamepadIndex >= 0) taken.add(s.devices[j].gamepadIndex);
    }
    const connected = this.pads.connected();
    // Si deux joueurs sont en "-1", le premier prend la première manette, le second la deuxième.
    let skip = 0;
    for (let j = 0; j < playerIndex; j++) {
      if (s.devices[j].kind === 'gamepad' && s.devices[j].gamepadIndex < 0) skip++;
    }
    const free = connected.filter((p) => !taken.has(p.index));
    return free[skip] ?? null;
  }

  status(playerIndex: number): DeviceStatus {
    const dev = this.settings().devices[playerIndex];
    if (dev.kind === 'gamepad' && !this.padFor(playerIndex)) return 'waiting-gamepad';
    return 'ok';
  }

  /** Construit les inputs de tous les joueurs actifs pour le tick à venir. */
  sample(state: GameState, picker: WorldPicker): PlayerInput[] {
    const s = this.settings();
    for (let i = 0; i < state.playerCount; i++) {
      const dev = s.devices[i];
      const inp = this.inputs[i];
      inp.buttons = 0;
      if (dev.kind === 'kbm') this.sampleKbm(state, i, inp, picker, s);
      else this.samplePad(i, inp, s);
    }
    this.kbm.endSample();
    this.pads.endSample();
    return this.inputs;
  }

  /**
   * Net : un seul joueur est local. Les boutons viennent du périphérique du joueur 1 de CETTE
   * machine, la visée du viewport du slot réseau (0 = hôte, 1 = invité).
   */
  sampleNet(state: GameState, picker: WorldPicker, slot: number): PlayerInput {
    const s = this.settings();
    const inp = this.inputs[slot];
    inp.buttons = 0;
    if (s.devices[0].kind === 'kbm') this.sampleKbm(state, slot, inp, picker, s);
    else this.samplePad(slot, inp, s, 0);
    this.kbm.endSample();
    this.pads.endSample();
    return inp;
  }

  private sampleKbm(state: GameState, i: number, inp: PlayerInput, picker: WorldPicker, s: Settings): void {
    const kb = s.keyboard;
    const k = this.kbm;
    let b = 0;
    if (k.isActive(kb.hookL)) b |= BTN_HOOK_L;
    if (k.isActive(kb.hookR)) b |= BTN_HOOK_R;
    if (k.isActive(kb.reel)) b |= BTN_REEL;
    if (k.isActive(kb.jet)) b |= BTN_JET;
    if (k.isActive(kb.grab)) b |= BTN_GRAB;
    if (k.isDown(kb.left)) b |= BTN_LEFT;
    if (k.isDown(kb.right)) b |= BTN_RIGHT;
    inp.buttons = b;
    if (k.mouseSeen && picker.screenToWorld(k.mouseX, k.mouseY, i, this.world)) {
      const pl = state.players[i];
      const dx = this.world.x - pl.x;
      const dy = this.world.y - pl.y;
      if (dx * dx + dy * dy > 4) this.lastAim[i] = angle16FromRadians(Math.atan2(dy, dx));
    }
    inp.aim = this.lastAim[i];
  }

  private samplePad(i: number, inp: PlayerInput, s: Settings, deviceIndex = i): void {
    const pad = this.padFor(deviceIndex);
    if (!pad) {
      inp.aim = this.lastAim[i];
      return;
    }
    const gb = s.gamepad;
    const g = this.pads;
    let b = 0;
    if (g.isActive(pad, gb.hookL)) b |= BTN_HOOK_L;
    if (g.isActive(pad, gb.hookR)) b |= BTN_HOOK_R;
    if (g.isDown(pad, gb.reel)) b |= BTN_REEL;
    if (g.isActive(pad, gb.jet)) b |= BTN_JET;
    if (g.isActive(pad, gb.grab)) b |= BTN_GRAB;
    if (g.isDown(pad, gb.left)) b |= BTN_LEFT;
    if (g.isDown(pad, gb.right)) b |= BTN_RIGHT;
    inp.buttons = b;
    const mag = g.stick(pad, RIGHT_STICK_X, RIGHT_STICK_Y, this.stick);
    if (mag > 0.35) this.lastAim[i] = angle16FromRadians(Math.atan2(this.stick.y, this.stick.x));
    inp.aim = this.lastAim[i];
  }

  /**
   * Front montant de "pause" (clavier ou Start de toute manette). Utilise le latch "pressé depuis le
   * dernier tick" pour ne pas rater un tap plus court qu'une frame.
   */
  pausePressed(): boolean {
    const s = this.settings();
    let down = this.kbm.isActive(s.keyboard.pause);
    for (const p of this.pads.connected()) {
      if (this.pads.isActive(p, s.gamepad.pause) || this.pads.isActive(p, GAMEPAD_MENU.start)) down = true;
    }
    const edge = down && !this.pauseWasDown;
    this.pauseWasDown = down;
    return edge;
  }

  /** Front montant de "recommencer" (clavier ou manette), même latch que la pause. */
  restartPressed(): boolean {
    const s = this.settings();
    let down = this.kbm.isActive(s.keyboard.restart);
    for (const p of this.pads.connected()) if (this.pads.isActive(p, s.gamepad.restart)) down = true;
    const edge = down && !this.restartWasDown;
    this.restartWasDown = down;
    return edge;
  }

  /**
   * Le bouton pause vient d'être consommé par le menu (reprise) : l'appui physique en cours ne doit pas
   * produire un second front. Un tap ultérieur (latch) reste détecté.
   */
  suppressPauseEdge(): void {
    const s = this.settings();
    let down = this.kbm.isDown(s.keyboard.pause);
    for (const p of this.pads.connected()) {
      if (this.pads.isDown(p, s.gamepad.pause) || this.pads.isDown(p, GAMEPAD_MENU.start)) down = true;
    }
    this.pauseWasDown = down;
  }

  /** Purge les appuis latents (clics de menu, touche de validation) avant de reprendre la sim. */
  flush(): void {
    this.kbm.clearLatch();
    this.pads.endSample();
  }

  /** Visée actuelle (pour le HUD / le curseur virtuel du joueur manette). */
  aimOf(i: number): number {
    return this.lastAim[i];
  }
}
