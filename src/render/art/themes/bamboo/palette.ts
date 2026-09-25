/**
 * Palette de la Bambouseraie maudite (design/planches/scene-bamboo.js), complétée pour les ruines
 * souterraines, les racines, les poutres liées et l'arrivée. Rien n'est cyan ni rose : le jade du
 * ryū, la lavande des hitodama et la mousse restent loin des teintes réservées aux joueurs.
 */
import { C } from '../../../pixel/engine';

export const K = {
  // Ciel, étoiles, lune (planche).
  sky: ['#070a1f', '#0c1230', '#121b44', '#1b2656', '#26306a'].map(C),
  star: C('#cfd6ff'),
  moon: C('#f1e7c8'),
  moonShade: C('#cbbf9e'),
  halo: C('#b9b4e6'),
  cloud: ['#182050', '#222b60', '#2a3470'].map(C),
  cloudLit: C('#4a538a'),
  // Lointains : montagnes, cascade, bambous lointains.
  mount: C('#141a3a'),
  mountRim: C('#262e5e'),
  mountDk: C('#10152f'),
  fall: C('#6a78b0'),
  fallHi: C('#a8b4e0'),
  fallMist: C('#3a4478'),
  bFar: C('#10162f'),
  bFarNode: C('#0a0f22'),
  // Bambous (plan à 0,7 et bambous géants de la couche de jeu).
  stalk: C('#1b3136'),
  stalkLit: C('#3a6461'),
  node: C('#0f1f22'),
  leaf: C('#1f3d3a'),
  leafLit: C('#2f5a50'),
  // Ryū de jade et d'or.
  dragon: C('#2f6b58'),
  dragonLit: C('#4a9178'),
  dragonDk: C('#1e4a3d'),
  belly: C('#a8893f'),
  fin: C('#c9a24a'),
  antler: C('#d9c89a'),
  dEye: C('#ffe38a'),
  // Pierre moussue (accrochable) : arête haute claire, coulures de mousse.
  stone: { rock: C('#3a4052'), dk: C('#2a2f3e'), lt: C('#4c5468'), top: C('#6f9a55'), moss: C('#3d5e36') },
  mortar: C('#1e2230'),
  stoneHi: C('#5a6378'),
  mossDeep: C('#2c4429'),
  // Laque noire à reflets (lisse).
  lacq: C('#141220'),
  lacqDk: C('#0c0a16'),
  gloss: C('#5a5a96'),
  glossDim: C('#2c2b4c'),
  lacqTop: C('#8a8ac4'),
  lacqEdge: C('#3c3c70'),
  // Bois, corde, papier.
  rope: C('#8a6a45'),
  ropeHi: C('#b08c5c'),
  ropeDk: C('#5e4630'),
  straw: C('#c2a468'),
  strawDk: C('#8f7444'),
  plank: C('#5a4128'),
  plankMid: C('#7a5a38'),
  plankTop: C('#a07a4a'),
  plankDk: C('#2e2014'),
  paper: C('#e8e0cf'),
  paperDk: C('#b9b09c'),
  ink: C('#a8342a'),
  // Lanternes de pierre, jizo.
  lantern: C('#ffd98a'),
  lanternGlow: C('#ffb347'),
  jizo: C('#6a6f80'),
  jizoHi: C('#8a90a2'),
  jizoDk: C('#4a4f5e'),
  bib: C('#a8342a'),
  bibHi: C('#d9574a'),
  roof: C('#1c1a28'),
  // Dangers : épines à pointe rouge.
  thorn: C('#9fb58a'),
  thornHi: C('#d2e2b8'),
  thornDk: C('#5f7552'),
  tip: C('#d94848'),
  bramble: C('#1f2a1c'),
  brambleLit: C('#34462c'),
  // Pin tordu.
  pine: C('#2a2420'),
  pineHi: C('#4a3e34'),
  needle: C('#1d3a30'),
  needleLit: C('#32584a'),
  // Lianes, hitodama, brume, lucioles, premier plan.
  vine: C('#2f5a3a'),
  vineLit: C('#4f8a4a'),
  vineDk: C('#1f3a26'),
  wisp: C('#efe4ff'),
  wispTrail: C('#9a7ad0'),
  wispCore: C('#c9b8f0'),
  fog: ['#2a1745', '#3f2266', '#5a3288'].map(C),
  firefly: C('#e8f59a'),
  fg: C('#04050d'),
  fgNode: C('#141c30'),
  fgNodeHi: C('#1f2a44'),
  fgEdge: C('#101829'),
  // Ruines souterraines (cave) : très sombres, racines, puits de lune.
  under: C('#06070f'),
  underStone: C('#0b0d1a'),
  underStoneLt: C('#10132a'),
  underMortar: C('#040509'),
  underArch: C('#141831'),
  underArchLt: C('#1b2040'),
  root: C('#241c16'),
  rootLt: C('#3a2e22'),
  rootDk: C('#16110d'),
  shaft: C('#232a58'),
  shaftHi: C('#343d78'),
  rubble: C('#1a1e30'),
  rubbleLt: C('#262b42'),
  // Supports fantômes (piliers de torii qui se perdent dans le noir).
  ghost: C('#171a28'),
  ghostLt: C('#1f2334'),
  // Voile de l'arrivée (clair de lune).
  veil: C('#f1e7c8'),
};

/** Fond uni du mode « Couche de jeu ». */
export const FLAT = 0x0f1120;
