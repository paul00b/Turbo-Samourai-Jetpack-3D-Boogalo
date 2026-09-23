/**
 * Gestion des manettes via la Gamepad API : polling, deadzones radiales, latch des fronts,
 * capture pour le remapping. Rappel : Chrome/Firefox ne listent une manette qu'après un premier
 * appui de bouton -> l'UI doit afficher "appuie sur un bouton".
 */
import type { GamepadControl } from './bindings';

export interface PadSnapshot {
  index: number;
  id: string;
  standard: boolean;
  buttons: number[];
  axes: number[];
  /** Boutons passés à "pressé" depuis le dernier endSample(). */
  latch: boolean[];
  lastActivity: number;
}

export const AXIS_THRESHOLD = 0.5;
export const BUTTON_THRESHOLD = 0.5;

export class GamepadManager {
  readonly pads: (PadSnapshot | null)[] = [];
  deadzone = 0.18;
  /** Quantité de manettes vues au moins une fois. */
  private seenAny = false;

  constructor() {
    window.addEventListener('gamepadconnected', (e) => {
      this.seenAny = true;
      this.ensure((e as GamepadEvent).gamepad);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      const idx = (e as GamepadEvent).gamepad.index;
      this.pads[idx] = null;
    });
  }

  get anySeen(): boolean {
    return this.seenAny;
  }

  private ensure(gp: Gamepad): PadSnapshot {
    let snap = this.pads[gp.index];
    if (!snap) {
      snap = {
        index: gp.index,
        id: gp.id,
        standard: gp.mapping === 'standard',
        buttons: new Array(gp.buttons.length).fill(0),
        axes: new Array(gp.axes.length).fill(0),
        latch: new Array(gp.buttons.length).fill(false),
        lastActivity: 0,
      };
      this.pads[gp.index] = snap;
    }
    return snap;
  }

  /** À appeler une fois par frame AVANT d'échantillonner les inputs. */
  poll(now: number): void {
    const list = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const seen = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      this.seenAny = true;
      const snap = this.ensure(gp);
      snap.id = gp.id;
      snap.standard = gp.mapping === 'standard';
      if (snap.buttons.length !== gp.buttons.length) {
        snap.buttons = new Array(gp.buttons.length).fill(0);
        snap.latch = new Array(gp.buttons.length).fill(false);
      }
      if (snap.axes.length !== gp.axes.length) snap.axes = new Array(gp.axes.length).fill(0);
      for (let b = 0; b < gp.buttons.length; b++) {
        const v = gp.buttons[b].value ?? (gp.buttons[b].pressed ? 1 : 0);
        const wasDown = snap.buttons[b] >= BUTTON_THRESHOLD;
        const isDown = v >= BUTTON_THRESHOLD || gp.buttons[b].pressed;
        if (isDown && !wasDown) {
          snap.latch[b] = true;
          snap.lastActivity = now;
        }
        snap.buttons[b] = isDown ? Math.max(v, BUTTON_THRESHOLD) : v;
      }
      for (let a = 0; a < gp.axes.length; a++) {
        const v = gp.axes[a];
        if (Math.abs(v) > 0.6 && Math.abs(snap.axes[a]) <= 0.6) snap.lastActivity = now;
        snap.axes[a] = v;
      }
    }
    for (let i = 0; i < this.pads.length; i++) {
      if (this.pads[i] && !seen.has(i)) this.pads[i] = null;
    }
  }

  endSample(): void {
    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i];
      if (p) p.latch.fill(false);
    }
  }

  connected(): PadSnapshot[] {
    const out: PadSnapshot[] = [];
    for (let i = 0; i < this.pads.length; i++) if (this.pads[i]) out.push(this.pads[i] as PadSnapshot);
    return out;
  }

  get(index: number): PadSnapshot | null {
    return this.pads[index] ?? null;
  }

  /** Valeur 0..1 d'un contrôle (bouton analogique ou demi-axe). */
  controlValue(pad: PadSnapshot, c: GamepadControl): number {
    if (c.type === 'button') return pad.buttons[c.index] ?? 0;
    const v = (pad.axes[c.index] ?? 0) * c.sign;
    return v > this.deadzone ? (v - this.deadzone) / (1 - this.deadzone) : 0;
  }

  /** Actif si enfoncé maintenant OU pressé depuis le dernier endSample (boutons seulement pour le latch). */
  isActive(pad: PadSnapshot, controls: readonly GamepadControl[]): boolean {
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (c.type === 'button') {
        if ((pad.buttons[c.index] ?? 0) >= BUTTON_THRESHOLD || pad.latch[c.index]) return true;
      } else if (this.controlValue(pad, c) >= AXIS_THRESHOLD) {
        return true;
      }
    }
    return false;
  }

  isDown(pad: PadSnapshot, controls: readonly GamepadControl[]): boolean {
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (c.type === 'button') {
        if ((pad.buttons[c.index] ?? 0) >= BUTTON_THRESHOLD) return true;
      } else if (this.controlValue(pad, c) >= AXIS_THRESHOLD) {
        return true;
      }
    }
    return false;
  }

  /** Stick avec deadzone radiale + remise à l'échelle. Retourne la magnitude (0 si dans la deadzone). */
  stick(pad: PadSnapshot, axisX: number, axisY: number, out: { x: number; y: number }): number {
    const x = pad.axes[axisX] ?? 0;
    const y = pad.axes[axisY] ?? 0;
    const mag = Math.hypot(x, y);
    if (mag <= this.deadzone) {
      out.x = 0;
      out.y = 0;
      return 0;
    }
    const scaled = Math.min(1, (mag - this.deadzone) / (1 - this.deadzone));
    out.x = (x / mag) * scaled;
    out.y = (y / mag) * scaled;
    return scaled;
  }
}

/**
 * Capture du prochain contrôle activé (remapping). On prend une photo de départ pour ignorer
 * ce qui est déjà enfoncé (ex : le bouton qui a servi à valider l'entrée en mode capture).
 */
export class GamepadCapture {
  private baseline = new Map<number, { buttons: number[]; axes: number[] }>();

  constructor(private readonly pads: GamepadManager) {
    for (const p of pads.connected()) this.baseline.set(p.index, { buttons: p.buttons.slice(), axes: p.axes.slice() });
  }

  /** Retourne le premier contrôle nouvellement activé, ou null. */
  poll(): { padIndex: number; control: GamepadControl } | null {
    for (const p of this.pads.connected()) {
      const base = this.baseline.get(p.index);
      for (let b = 0; b < p.buttons.length; b++) {
        const was = base ? (base.buttons[b] ?? 0) >= BUTTON_THRESHOLD : false;
        if (p.buttons[b] >= BUTTON_THRESHOLD && !was) return { padIndex: p.index, control: { type: 'button', index: b } };
        if (base && p.buttons[b] < BUTTON_THRESHOLD) base.buttons[b] = 0;
      }
      for (let a = 0; a < p.axes.length; a++) {
        const v = p.axes[a];
        const wasV = base ? base.axes[a] ?? 0 : 0;
        if (Math.abs(v) > 0.6 && Math.abs(wasV) <= 0.6) {
          return { padIndex: p.index, control: { type: 'axis', index: a, sign: v < 0 ? -1 : 1 } };
        }
        if (base && Math.abs(v) <= 0.6) base.axes[a] = 0;
      }
    }
    return null;
  }
}
