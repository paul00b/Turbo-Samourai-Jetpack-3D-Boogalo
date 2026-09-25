/** Bambouseraie maudite, partie pure : identité du thème et peintre de carte (importable sous Node). */
import { C } from '../../../pixel/engine';
import type { ThemePainter } from '../types';
import { bambooProps, paintBamboo } from './paint';
import { FLAT, K } from './palette';

export const bambooPainter: ThemePainter = {
  id: 'bamboo',
  name: 'Bambouseraie maudite',
  hud: 'BAMBOUSERAIE MAUDITE',
  rim: C('#c9c3f0'),
  halo: C('#34407a'),
  wind: 20,
  flat: FLAT,
  dust: [K.stone.top, K.stone.moss, K.leafLit],
  swatches: [
    ['Nuit', '#121b44'],
    ['Ryū de jade', '#2f6b58'],
    ['Brume maudite', '#3f2266'],
    ['Mousse accrochable', '#6f9a55'],
    ['Laque lisse (=)', '#5a5a96'],
    ['Épines mortelles', '#9fb58a'],
  ],
  paint: paintBamboo,
  props: bambooProps,
};
