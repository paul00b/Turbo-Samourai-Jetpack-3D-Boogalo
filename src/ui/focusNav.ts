/**
 * Navigation de menu au clavier ET à la manette : actions discrètes (haut/bas/gauche/droite/valider/retour)
 * appliquées aux éléments [data-nav] de l'écran courant.
 */
import { GAMEPAD_MENU } from '../io/input/bindings';
import type { GamepadManager } from '../io/input/gamepad';

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start';

const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.11;

/** Transforme clavier + manettes en actions de menu à front montant (+ répétition sur les directions). */
export class MenuInput {
  private padDown: Record<MenuAction, boolean> = { up: false, down: false, left: false, right: false, confirm: false, back: false, start: false };
  private repeatTimer: Record<string, number> = {};

  constructor(private readonly pads: GamepadManager) {}

  /** Retourne les actions de la frame. `keyCodes` = fronts clavier déjà drainés par l'appelant. */
  poll(keyCodes: string[], dt: number): MenuAction[] {
    const out: MenuAction[] = [];
    for (const code of keyCodes) {
      switch (code) {
        case 'ArrowUp':
        case 'KeyW':
          out.push('up');
          break;
        case 'ArrowDown':
        case 'KeyS':
          out.push('down');
          break;
        case 'ArrowLeft':
          out.push('left');
          break;
        case 'ArrowRight':
          out.push('right');
          break;
        case 'Enter':
        case 'NumpadEnter':
        case 'Space':
          out.push('confirm');
          break;
        case 'Escape':
        case 'Backspace':
          out.push('back');
          break;
        default:
          break;
      }
    }
    const actions: MenuAction[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'start'];
    for (const a of actions) {
      let down = false;
      for (const p of this.pads.connected()) if (this.pads.isDown(p, GAMEPAD_MENU[a])) down = true;
      const was = this.padDown[a];
      this.padDown[a] = down;
      const directional = a === 'up' || a === 'down' || a === 'left' || a === 'right';
      if (down && !was) {
        out.push(a);
        this.repeatTimer[a] = REPEAT_DELAY;
      } else if (down && directional) {
        this.repeatTimer[a] = (this.repeatTimer[a] ?? REPEAT_DELAY) - dt;
        if (this.repeatTimer[a] <= 0) {
          out.push(a);
          this.repeatTimer[a] = REPEAT_RATE;
        }
      }
    }
    return out;
  }
}

export class FocusNav {
  private items: HTMLElement[] = [];
  private index = 0;
  private screen: HTMLElement | null = null;
  onMove: (() => void) | null = null;

  attach(screen: HTMLElement): void {
    this.screen = screen;
    this.refresh();
    this.index = 0;
    this.applyFocus(false);
  }

  detach(): void {
    for (const el of this.items) el.classList.remove('focused');
    this.items = [];
    this.screen = null;
  }

  /** Recalcule la liste (après un changement d'onglet, etc.) en conservant l'élément focus si possible. */
  refresh(): void {
    if (!this.screen) return;
    const prev = this.items[this.index];
    this.items = Array.from(this.screen.querySelectorAll<HTMLElement>('[data-nav]')).filter((el) => !isHidden(el));
    for (const el of this.items) {
      if (!el.dataset.navBound) {
        el.dataset.navBound = '1';
        el.addEventListener('pointerenter', () => {
          const i = this.items.indexOf(el);
          if (i >= 0) {
            this.index = i;
            this.applyFocus(false);
          }
        });
      }
    }
    const i = prev ? this.items.indexOf(prev) : -1;
    this.index = i >= 0 ? i : Math.min(this.index, Math.max(0, this.items.length - 1));
    this.applyFocus(false);
  }

  get current(): HTMLElement | null {
    return this.items[this.index] ?? null;
  }

  handle(action: MenuAction): boolean {
    if (this.items.length === 0) return false;
    switch (action) {
      case 'up':
        this.index = (this.index - 1 + this.items.length) % this.items.length;
        this.applyFocus(true);
        return true;
      case 'down':
        this.index = (this.index + 1) % this.items.length;
        this.applyFocus(true);
        return true;
      case 'left':
      case 'right':
        return this.adjust(action === 'right' ? 1 : -1);
      case 'confirm': {
        const el = this.current;
        if (!el) return false;
        if (el instanceof HTMLInputElement && el.type === 'range') return false;
        el.click();
        return true;
      }
      default:
        return false;
    }
  }

  private adjust(dir: number): boolean {
    const el = this.current;
    if (!el) return false;
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const step = Number(el.step) || 1;
      const v = Number(el.value) + dir * step;
      el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), v)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      const n = el.options.length;
      el.selectedIndex = (el.selectedIndex + dir + n) % n;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    // Groupe de boutons "radio" : gauche/droite change de bouton dans le même groupe
    const group = el.dataset.navGroup;
    if (group) {
      const siblings = this.items.filter((x) => x.dataset.navGroup === group);
      const i = siblings.indexOf(el);
      const next = siblings[(i + dir + siblings.length) % siblings.length];
      if (next) {
        this.index = this.items.indexOf(next);
        this.applyFocus(true);
        next.click();
        return true;
      }
    }
    return false;
  }

  private applyFocus(sound: boolean): void {
    for (let i = 0; i < this.items.length; i++) this.items[i].classList.toggle('focused', i === this.index);
    const el = this.items[this.index];
    if (el) el.scrollIntoView({ block: 'nearest' });
    if (sound && this.onMove) this.onMove();
  }
}

function isHidden(el: HTMLElement): boolean {
  let e: HTMLElement | null = el;
  while (e) {
    if (e.classList.contains('hidden')) return true;
    e = e.parentElement;
  }
  return false;
}
