/**
 * Vignettes des biomes pour le sélecteur de course : un petit diorama peint par le PEINTRE du thème
 * (ses bois, pierres ou mousses, ses pics, son tremplin, ses accessoires), sous le ciel du thème et
 * avec sa silhouette signature (les yeux d'Umibozu, la lueur du volcan, la lune). Tout est pur et
 * calculé une fois par biome : aucun Pixi, un canvas 2D.
 */
import { parseLevel, type BiomeId } from '../sim';
import { analyzeLevel, ART_TILE } from '../render/art/levelShape';
import { PAINTERS } from '../render/art/themes/painters';
import { K as PORT } from '../render/art/themes/port/palette';
import { K as FORGE } from '../render/art/themes/forge/palette';
import { K as BAMBOO } from '../render/art/themes/bamboo/palette';
import { Buf, ca, type Color } from '../render/pixel/engine';

/** Le diorama : un ancrage pendu, un bloc lisse, des pics, un tremplin, le sol. Bords rognés à l'affichage. */
const ROWS: readonly string[] = [
  '##################',
  '#................#',
  '#.####......#....#',
  '#..#........#....#',
  '#..#.....==.###..#',
  '#.......===......#',
  '#.......===......#',
  '#.S..........^^T.#',
  '##################',
  '##################',
];

const SKY: Record<BiomeId, readonly Color[]> = { port: PORT.sky, forge: FORGE.sky, bamboo: BAMBOO.sky };

const cache = new Map<BiomeId, HTMLCanvasElement>();

/** Taille de la vignette en px d'art (16 tuiles sur 8 rangées). */
export const VIGNETTE_W = (ROWS[0].length - 2) * ART_TILE;
export const VIGNETTE_H = (ROWS.length - 2) * ART_TILE;

/** Pose `src` sur `dst` en respectant son alpha. */
function over(dst: Buf, src: Buf, ox = 0, oy = 0): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const c = src.d[y * src.w + x];
      const a = ca(c);
      if (a === 0) continue;
      dst.mixA(x + ox, y + oy, c | 0xff000000, a / 255);
    }
  }
}

/** La silhouette qui dit le biome au premier coup d'œil, dans le ciel. */
function signature(b: Buf, id: BiomeId): void {
  if (id === 'port') {
    // Umibozu à l'horizon : un dôme, deux yeux pâles.
    b.ellipse(200, 70, 34, 26, PORT.uBody);
    for (const s of [-1, 1]) {
      b.glowA(200 + s * 12, 64, 9, PORT.eyeGlow, 0.35);
      b.ellipse(200 + s * 12, 64, 3, 2, PORT.eye);
    }
  } else if (id === 'forge') {
    // Le volcan et sa lueur.
    b.glowA(190, 34, 34, FORGE.crater, 0.45);
    b.poly([130, 110, 182, 36, 200, 34, 256, 110], FORGE.volc);
    b.hline(183, 199, 35, FORGE.volcRim);
    for (let y = 38; y < 100; y += 1) b.px(191 + Math.round(Math.sin(y * 0.3) * 2 + (y - 38) * 0.12), y, FORGE.crater);
  } else {
    // Croissant de lune et quelques étoiles.
    for (let y = -12; y <= 12; y++) {
      for (let x = -12; x <= 12; x++) {
        if (x * x + y * y > 144 || (x + 5) * (x + 5) + (y + 3) * (y + 3) < 110) continue;
        b.px(210 + x, 30 + y, x > 6 ? BAMBOO.moonShade : BAMBOO.moon);
      }
    }
    for (const [x, y] of [[40, 14], [96, 30], [150, 12], [176, 44], [236, 60], [60, 52], [124, 58]]) b.px(x, y, BAMBOO.star);
  }
}

function paintVignette(id: BiomeId): Buf {
  const level = parseLevel(ROWS, [], 'vignette', '', 'kills');
  const shape = analyzeLevel(level);
  const back = new Buf(shape.pw, shape.ph);
  const tiles = new Buf(shape.pw, shape.ph);
  const hazards = new Buf(shape.pw, shape.ph);
  let front: Buf | null = null;
  const painter = PAINTERS[id];
  const props = painter.paint(shape, { back, tiles, hazards, front: () => (front ??= new Buf(shape.pw, shape.ph)) });
  const anims = painter.props();

  const full = new Buf(shape.pw, shape.ph);
  full.vgrad(0, shape.ph, SKY[id]);
  signature(full, id);
  over(full, back);
  for (const p of props) {
    const a = anims[p.kind];
    if (a && p.layer === 'back') over(full, a.frames[0], Math.round(p.x - a.ax), Math.round(p.y - a.ay));
  }
  over(full, tiles);
  over(full, hazards);
  for (const p of props) {
    const a = anims[p.kind];
    if (a && p.layer === 'front') over(full, a.frames[0], Math.round(p.x - a.ax), Math.round(p.y - a.ay));
  }
  if (front) over(full, front);
  // On rogne le cadre : ni mur de gauche, ni mur de droite, ni plafond, mais on garde le sol.
  return full.crop(ART_TILE, ART_TILE, VIGNETTE_W, VIGNETTE_H);
}

/** Canvas du biome (une copie à chaque appel : un même élément DOM ne va pas à deux endroits). */
export function biomeVignette(id: BiomeId): HTMLCanvasElement {
  let src = cache.get(id);
  if (!src) {
    const buf = paintVignette(id);
    src = document.createElement('canvas');
    src.width = buf.w;
    src.height = buf.h;
    const ctx = src.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(buf.w, buf.h);
      img.data.set(new Uint8ClampedArray(buf.d.buffer, buf.d.byteOffset, buf.d.byteLength));
      ctx.putImageData(img, 0, 0);
    }
    cache.set(id, src);
  }
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.className = 'biome-art';
  out.getContext('2d')?.drawImage(src, 0, 0);
  return out;
}
