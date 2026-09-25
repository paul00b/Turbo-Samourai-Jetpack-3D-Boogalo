/** Forteresse de braise, partie pure : identité du thème et peintre de carte (importable sous Node). */
import { C } from '../../../pixel/engine';
import type { ThemePainter } from '../types';
import { forgeProps, paintForge } from './paint';
import { FLAT, K } from './palette';

export const forgePainter: ThemePainter = {
  id: 'forge',
  name: 'Forteresse de braise',
  hud: 'FORTERESSE DE BRAISE',
  rim: C('#ffb27a'),
  halo: null,
  wind: 50,
  flat: FLAT,
  dust: [K.ash, K.wallLt, K.soot],
  swatches: [
    ['Ciel de braise', '#3d1311'],
    ["Basalte de l'oni", '#1f0c0c'],
    ['Veines', '#ff7a2a'],
    ['Rempart accrochable', '#c79a72'],
    ['Obsidienne lisse (=)', '#6b5a7a'],
    ['Pics sur lave (^)', '#d94848'],
  ],
  paint: paintForge,
  props: forgeProps,
};
