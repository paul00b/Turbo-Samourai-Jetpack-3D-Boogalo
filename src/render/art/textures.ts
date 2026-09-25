/**
 * Pont moteur pixel -> Pixi : un Buf devient une texture (échantillonnage au plus proche), un gros
 * calque de niveau est découpé en tuiles de texture (les cartes chrono font 6720 px d'art de large,
 * au-delà de la taille max d'une texture sur certains GPU).
 */
import { BufferImageSource, Rectangle, Texture } from 'pixi.js';
import type { Buf } from '../pixel/engine';

export function textureFromBuf(buf: Buf, label = 'pixel-buf'): Texture {
  const source = new BufferImageSource({
    resource: new Uint8Array(buf.d.buffer, buf.d.byteOffset, buf.d.byteLength),
    width: buf.w,
    height: buf.h,
    scaleMode: 'nearest',
    alphaMode: 'premultiply-alpha-on-upload',
    autoGenerateMipmaps: false,
    label,
  });
  return new Texture({ source, label });
}

/** Ré-upload d'un Buf déjà lié à une texture (même taille) : texSubImage2D côté GL. */
export function refreshTexture(tex: Texture): void {
  tex.source.update();
}

/** Sous-texture (frame d'une planche de sprites). */
export function subTexture(base: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: base.source, frame: new Rectangle(x, y, w, h) });
}

export interface Chunk {
  x: number;
  y: number;
  w: number;
  h: number;
  texture: Texture;
}

export const CHUNK = 512;

/** Découpe un calque en tuiles de CHUNK px, en sautant les tuiles entièrement transparentes. */
export function chunkTextures(buf: Buf, label: string, size = CHUNK): Chunk[] {
  const out: Chunk[] = [];
  for (let y = 0; y < buf.h; y += size) {
    for (let x = 0; x < buf.w; x += size) {
      const w = Math.min(size, buf.w - x);
      const h = Math.min(size, buf.h - y);
      if (!buf.anyIn(x, y, w, h)) continue;
      out.push({ x, y, w, h, texture: textureFromBuf(buf.crop(x, y, w, h), `${label}-${x}-${y}`) });
    }
  }
  return out;
}

export function destroyChunks(chunks: readonly Chunk[]): void {
  for (const c of chunks) c.texture.destroy(true);
}
