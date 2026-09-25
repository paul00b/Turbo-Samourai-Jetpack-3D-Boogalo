/**
 * Palette de la Forteresse de braise (design/planches/scene-forge.js), complétée pour le rempart,
 * le cachot de la cave, les fosses de lave et l'arrivée. Tout le niveau est chaud : seul le perso
 * reste froid (l'écharpe cyan est la complémentaire de la palette), l'obsidienne lisse est le seul
 * froid du décor, en violet.
 */
import { C } from '../../../pixel/engine';

export const K = {
  // ---- Planche
  sky: ['#12070a', '#240c0e', '#3d1311', '#5e1d12', '#8a2e14', '#a8401a'].map(C),
  smoke: ['#261211', '#341915', '#45211a'].map(C),
  smokeLit: C('#8a3a1c'),
  volc: C('#1c0b0b'),
  volcRim: C('#3a1410'),
  crater: C('#ff5a1f'),
  flow: ['#fff0a8', '#ffb347', '#ff7a2a', '#d9481f', '#8a2414'].map(C),
  oni: C('#1f0c0c'),
  oniRim: C('#3d1713'),
  veinLo: C('#4a160e'),
  veinHi: C('#ff7a2a'),
  oniEye: C('#ffcf5a'),
  fang: C('#e8d8c0'),
  town: C('#1d0d0c'),
  townRim: C('#4a1c12'),
  castle: C('#2f1a17'),
  roof: C('#1c0f0f'),
  under: C('#7a3018'),
  win: C('#c4561f'),
  gold: C('#b88a36'),
  wall: C('#4a4040'),
  wallLt: C('#5e5250'),
  mortar: C('#2a2222'),
  wallTop: C('#c79a72'),
  obs: C('#1a1418'),
  obsGloss: C('#6b5a7a'),
  obsTop: C('#9a86ad'),
  chain: C('#6d6a70'),
  iron: C('#3a3a42'),
  ironHi: C('#8a8a96'),
  bronze: C('#8a6a3a'),
  bronzeHi: C('#c9a25a'),
  bronzeDk: C('#4a3620'),
  ember: ['#ffd166', '#ff9a3c', '#d9481f'].map(C),
  ash: C('#6b5552'),
  fire: ['#fff3b0', '#ffc44d', '#ff7a2a', '#c93a1a'].map(C),
  cloth: C('#e8d8c0'),
  clothMark: C('#1c0f0f'),
  fg: C('#0a0405'),
  clothDeck: C('#b8a78a'),
  clothDeckMark: C('#6e1f19'),

  // ---- Lointains du jeu (plus larges que la planche)
  ridge: C('#1a0c0b'),
  castleDk: C('#24130f'),
  winDk: C('#7a2c14'),
  smokeGlow: C('#5e1d12'),

  // ---- Rempart (masses accrochables) : pierre de la planche, arêtes chaudes sur chaque face
  wallDk: C('#3f3636'),
  soot: C('#332a29'),
  /** Arête d'une face latérale exposée (on s'y accroche de côté). */
  wallSide: C('#b08868'),
  wallSideDk: C('#6a5448'),
  /** Arête du dessous, éclairée par la braise d'en bas. */
  wallUnder: C('#c8784a'),
  wallUnderDk: C('#7e4630'),
  corbel: C('#342a2a'),
  /** Pierre cuite sous la lave (le dessus d'une fosse : pas une arête, on n'y va pas). */
  crust: C('#3a1a12'),
  crustHot: C('#8a2414'),

  // ---- Obsidienne lisse : reflets obliques violets, faces en violet sombre
  obsBand: C('#211a22'),
  obsDeep: C('#120e12'),
  obsEdge: C('#3e3250'),

  // ---- Bois d'échafaudage calciné, fer des cerclages et des chaînes
  char: C('#2a1a14'),
  charHi: C('#4a2c1c'),
  woodUnder: C('#a8683c'),
  chainDk: C('#3e3b42'),
  rivet: C('#8a8a96'),

  // ---- Cachot de la cave (soubassement du rempart)
  cave: ['#0c0707', '#130b0a', '#1a100e', '#231512'].map(C),
  caveGlow: C('#3e170f'),
  caveGlowHi: C('#5a2012'),
  pier: C('#241816'),
  pierLt: C('#30201c'),
  recess: C('#090505'),
  grate: C('#b84a1c'),
  grateHi: C('#ff8a3a'),
  bone: C('#7c6c60'),
  boneDk: C('#4e4038'),

  // ---- Pics sur lave (^) : fer, pointe rouge
  spike: C('#3a3a42'),
  spikeHi: C('#8a8a96'),
  spikeDk: C('#232329'),
  tip: C('#d94848'),
  tipHot: C('#ff8a6a'),
  spikeHot: C('#5a2420'),

  // ---- Arrivée : torii brûlé, voile de lumière
  torii: C('#1e100d'),
  toriiHi: C('#3a1c14'),
  toriiCrack: C('#ff7a2a'),
  toriiCrackHi: C('#ffc44d'),
  veil: C('#ffe6a8'),
  hemp: C('#b8a890'),
  paper: C('#e8d8c0'),
  stone: C('#4a4040'),
  stoneHi: C('#6e6260'),
  stoneDk: C('#2e2828'),
};

export const FLAT = 0x14100f;
