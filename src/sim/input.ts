/**
 * Input compact et sérialisable : 16 bits de boutons + angle de visée quantifié sur 16 bits.
 * La simulation ne voit JAMAIS de coordonnées souris ni de valeurs de stick en float.
 */

export const BTN_HOOK_L = 1 << 0;
export const BTN_HOOK_R = 1 << 1;
export const BTN_JET = 1 << 2;
export const BTN_GRAB = 1 << 3;
export const BTN_LEFT = 1 << 4;
export const BTN_RIGHT = 1 << 5;
export const BTN_REEL = 1 << 6;

export interface PlayerInput {
  /** Bitfield u16 (BTN_*). */
  buttons: number;
  /** Angle de visée u16 : 0..65535 -> 0..2π, sens horaire en repère écran (y vers le bas). */
  aim: number;
}

export const AIM_RIGHT = 0;
export const AIM_UP = 49152; // 3π/2 en repère y-bas = vers le haut de l'écran

export function makeInput(buttons = 0, aim = AIM_RIGHT): PlayerInput {
  return { buttons: buttons & 0xffff, aim: aim & 0xffff };
}

export function copyInput(src: PlayerInput, dst: PlayerInput): PlayerInput {
  dst.buttons = src.buttons;
  dst.aim = src.aim;
  return dst;
}

export function inputsEqual(a: PlayerInput, b: PlayerInput): boolean {
  return a.buttons === b.buttons && a.aim === b.aim;
}

/** Sérialisation sur un u32 : aim dans les 16 bits hauts, boutons dans les 16 bits bas. */
export function packInput(i: PlayerInput): number {
  return (((i.aim & 0xffff) << 16) | (i.buttons & 0xffff)) >>> 0;
}

export function unpackInput(packed: number, out: PlayerInput = makeInput()): PlayerInput {
  out.buttons = packed & 0xffff;
  out.aim = (packed >>> 16) & 0xffff;
  return out;
}

/** Utilitaire pour la couche IO : radians (atan2 côté IO, autorisé là-bas) -> angle 16 bits. */
export function angle16FromRadians(rad: number): number {
  const turns = rad / 6.283185307179586;
  const a = Math.round(turns * 65536);
  return ((a % 65536) + 65536) % 65536;
}
