/** Port d'Umibozu, partie pure : identité du thème et peintre de carte (importable sous Node). */
import { C } from '../../../pixel/engine';
import type { ThemePainter } from '../types';
import { paintPort, portProps } from './paint';
import { FLAT, K } from './palette';

export const portPainter: ThemePainter = {
  id: 'port',
  name: "Port d'Umibozu",
  hud: "PORT D'UMIBOZU",
  rim: C('#a9c2ee'),
  halo: C('#3a5478'),
  wind: 30,
  flat: FLAT,
  dust: [K.hemp, K.stake, K.rig],
  swatches: [
    ["Ciel d'orage", '#142037'],
    ['Umibozu', '#0d1320'],
    ['Écume', '#9db5cc'],
    ['Bois accrochable', '#c48a54'],
    ['Pierre lisse (=)', '#4a6d91'],
    ['Pieux mortels', '#d94848'],
  ],
  paint: paintPort,
  props: portProps,
};
