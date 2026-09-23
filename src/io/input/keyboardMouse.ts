/**
 * Périphérique clavier + souris. Garde l'état "enfoncé" + un latch "pressé depuis le dernier
 * échantillonnage" pour ne jamais perdre un tap plus court qu'un tick.
 */
export class KeyboardMouse {
  readonly down = new Set<string>();
  private readonly latch = new Set<string>();
  /** Codes pressés (front) depuis le dernier drain — pour les menus et le remapping. */
  private readonly pressedQueue: string[] = [];
  mouseX = 0;
  mouseY = 0;
  /** Souris vue au moins une fois. */
  mouseSeen = false;
  lastActivity = 0;
  /** Empêche les raccourcis navigateur (espace = scroll, etc.) quand vrai. */
  captureKeys = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (this.captureKeys && this.shouldPrevent(e.code)) e.preventDefault();
      return;
    }
    this.down.add(e.code);
    this.latch.add(e.code);
    this.enqueue(e.code);
    this.lastActivity = performance.now();
    if (this.captureKeys && this.shouldPrevent(e.code)) e.preventDefault();
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    this.down.add(code);
    this.latch.add(code);
    this.enqueue(code);
    this.lastActivity = performance.now();
    this.updateMouse(e);
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    this.updateMouse(e);
  };
  private readonly onContextMenu = (e: Event): void => {
    if (this.captureKeys) e.preventDefault();
  };
  private readonly onBlur = (): void => {
    this.down.clear();
  };

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
  }

  private enqueue(code: string): void {
    this.pressedQueue.push(code);
    if (this.pressedQueue.length > 64) this.pressedQueue.splice(0, this.pressedQueue.length - 64);
  }

  private shouldPrevent(code: string): boolean {
    return (
      code === 'Space' ||
      code === 'Tab' ||
      code.startsWith('Arrow') ||
      code === 'Backspace' ||
      code === 'Slash' ||
      code === 'Quote' ||
      code === 'F1' ||
      code === 'F2' ||
      code === 'F3' ||
      code === 'F4' ||
      code === 'F6'
    );
  }

  private updateMouse(e: MouseEvent): void {
    const r = this.surface.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    this.mouseSeen = true;
  }

  /** Vrai si un des codes est enfoncé OU a été pressé depuis le dernier `endSample()`. */
  isActive(codes: readonly string[]): boolean {
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (this.down.has(c) || this.latch.has(c)) return true;
    }
    return false;
  }

  isDown(codes: readonly string[]): boolean {
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i])) return true;
    return false;
  }

  /** À appeler après avoir construit les inputs d'un tick : vide le latch. */
  endSample(): void {
    this.latch.clear();
  }

  /** Oublie les appuis en attente (reprise après pause, démarrage) pour ne pas tirer un grappin sur un clic de menu. */
  clearLatch(): void {
    this.latch.clear();
  }

  /** Draine les fronts (pour les menus / le remapping). */
  drainPressed(): string[] {
    const out = this.pressedQueue.slice();
    this.pressedQueue.length = 0;
    return out;
  }
}
