/**
 * Bindings remappables. Clavier : `KeyboardEvent.code` (touche PHYSIQUE, indépendant de la
 * disposition : 'KeyA' est la touche Q sur AZERTY, A sur QWERTY) ou 'MouseN'.
 * Manette : bouton (index) ou axe (index + signe), sur le mapping "standard" du W3C quand il existe.
 */

export type Action = 'hookL' | 'hookR' | 'reel' | 'jet' | 'grab' | 'left' | 'right' | 'pause';

export const ACTIONS: readonly { id: Action; label: string; hint: string }[] = [
  { id: 'hookL', label: 'Grappin gauche', hint: 'maintenir = accroché et rétraction auto, relâcher = lâcher' },
  { id: 'hookR', label: 'Grappin droit', hint: 'maintenir = accroché et rétraction auto, relâcher = lâcher' },
  { id: 'reel', label: 'Reel (rétracter)', hint: 'rétracte les cordes ; inutile tant que la rétraction auto est active' },
  { id: 'jet', label: 'Jetpack', hint: 'orienté vers le curseur / stick droit' },
  { id: 'grab', label: 'Grab / cut manuel', hint: '' },
  { id: 'left', label: 'Marche / balancier gauche', hint: 'au sol : marche ; suspendu : pompe le balancier' },
  { id: 'right', label: 'Marche / balancier droite', hint: 'au sol : marche ; suspendu : pompe le balancier' },
  { id: 'pause', label: 'Pause', hint: '' },
];

export type KeyboardBindings = Record<Action, string[]>;

export type GamepadControl = { type: 'button'; index: number } | { type: 'axis'; index: number; sign: 1 | -1 };

export type GamepadBindings = Record<Action, GamepadControl[]>;

export const DEFAULT_KEYBOARD: KeyboardBindings = {
  hookL: ['Mouse0'],
  hookR: ['Mouse2'],
  reel: ['KeyW', 'ArrowUp'], // Z sur AZERTY
  jet: ['Space', 'ShiftLeft'],
  grab: ['KeyE'],
  left: ['KeyA'], // Q sur AZERTY
  right: ['KeyD'],
  pause: ['Escape'],
};

/** Mapping "standard" : LB=4 RB=5 LT=6 RT=7 A=0 B=1 X=2 Y=3 Start=9, stick gauche axes 0/1, droit 2/3. */
export const DEFAULT_GAMEPAD: GamepadBindings = {
  hookL: [{ type: 'button', index: 4 }],
  hookR: [{ type: 'button', index: 5 }],
  reel: [{ type: 'axis', index: 1, sign: -1 }, { type: 'button', index: 12 }],
  jet: [{ type: 'button', index: 7 }],
  grab: [{ type: 'button', index: 0 }, { type: 'button', index: 2 }],
  left: [{ type: 'axis', index: 0, sign: -1 }, { type: 'button', index: 14 }],
  right: [{ type: 'axis', index: 0, sign: 1 }, { type: 'button', index: 15 }],
  pause: [{ type: 'button', index: 9 }],
};

/** Navigation menu manette (non remappable) : croix + stick gauche, A valide, B retour. */
export const GAMEPAD_MENU = {
  up: [{ type: 'button', index: 12 }, { type: 'axis', index: 1, sign: -1 }] as GamepadControl[],
  down: [{ type: 'button', index: 13 }, { type: 'axis', index: 1, sign: 1 }] as GamepadControl[],
  left: [{ type: 'button', index: 14 }, { type: 'axis', index: 0, sign: -1 }] as GamepadControl[],
  right: [{ type: 'button', index: 15 }, { type: 'axis', index: 0, sign: 1 }] as GamepadControl[],
  confirm: [{ type: 'button', index: 0 }] as GamepadControl[],
  back: [{ type: 'button', index: 1 }] as GamepadControl[],
  start: [{ type: 'button', index: 9 }] as GamepadControl[],
};

export function cloneKeyboardBindings(b: KeyboardBindings): KeyboardBindings {
  const out = {} as KeyboardBindings;
  for (const a of ACTIONS) out[a.id] = [...(b[a.id] ?? [])];
  return out;
}

export function cloneGamepadBindings(b: GamepadBindings): GamepadBindings {
  const out = {} as GamepadBindings;
  for (const a of ACTIONS) out[a.id] = (b[a.id] ?? []).map((c) => ({ ...c }));
  return out;
}

export function gamepadControlEquals(a: GamepadControl, b: GamepadControl): boolean {
  if (a.type !== b.type || a.index !== b.index) return false;
  return a.type === 'axis' && b.type === 'axis' ? a.sign === b.sign : true;
}

const STANDARD_BUTTON_NAMES: Record<number, string> = {
  0: 'A / ✕',
  1: 'B / ○',
  2: 'X / □',
  3: 'Y / △',
  4: 'LB / L1',
  5: 'RB / R1',
  6: 'LT / L2',
  7: 'RT / R2',
  8: 'Select / Share',
  9: 'Start / Options',
  10: 'L3',
  11: 'R3',
  12: 'Croix ↑',
  13: 'Croix ↓',
  14: 'Croix ←',
  15: 'Croix →',
  16: 'Home',
};

export function gamepadControlLabel(c: GamepadControl, standard = true): string {
  if (c.type === 'button') {
    return standard && STANDARD_BUTTON_NAMES[c.index] ? STANDARD_BUTTON_NAMES[c.index] : `Bouton ${c.index}`;
  }
  const stick = standard ? (c.index < 2 ? 'Stick G' : c.index < 4 ? 'Stick D' : `Axe ${c.index}`) : `Axe ${c.index}`;
  const dir = c.index % 2 === 0 ? (c.sign < 0 ? '←' : '→') : c.sign < 0 ? '↑' : '↓';
  return `${stick} ${dir}`;
}

/** Libellé lisible d'un code clavier/souris. `layoutMap` (navigator.keyboard) donne la vraie légende de la touche si dispo. */
export function keyCodeLabel(code: string, layoutMap?: Map<string, string> | null): string {
  if (code.startsWith('Mouse')) {
    const n = code.slice(5);
    return n === '0' ? 'Clic gauche' : n === '2' ? 'Clic droit' : n === '1' ? 'Clic molette' : `Souris ${n}`;
  }
  const mapped = layoutMap?.get(code);
  if (mapped && mapped.trim().length > 0) return mapped.length === 1 ? mapped.toUpperCase() : mapped;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const table: Record<string, string> = {
    Space: 'Espace',
    ShiftLeft: 'Maj gauche',
    ShiftRight: 'Maj droite',
    ControlLeft: 'Ctrl gauche',
    ControlRight: 'Ctrl droit',
    AltLeft: 'Alt',
    AltRight: 'Alt Gr',
    Escape: 'Échap',
    Enter: 'Entrée',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Tab: 'Tab',
    Backspace: 'Retour',
  };
  return table[code] ?? code;
}
