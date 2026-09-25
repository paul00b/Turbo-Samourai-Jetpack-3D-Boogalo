/**
 * Outils Pixi communs aux runtimes de thème. Tout est dessiné dans la RenderTexture de la vue, en
 * px d'art : un rect de 1x1 est un pixel, exactement comme dans le framebuffer des planches.
 */
import { Container, GlProgram, Graphics, Mesh, MeshGeometry, Shader, Sprite, UniformGroup, type Texture } from 'pixi.js';
import { Buf, toHex, type Color } from '../../pixel/engine';
import { refreshTexture, textureFromBuf } from '../textures';

/**
 * Pixels exacts via une Graphics : on accumule des rectangles par couleur et on les pousse en une
 * seule passe (un chemin et un fill par couleur). Les lignes sont tracées en Bresenham, comme
 * `Buf.line`, pour garder le même crénelage que les planches.
 */
export class PixelBatch {
  readonly g = new Graphics();
  private readonly byColor = new Map<number, number[]>();
  private readonly alphaRects: { x: number; y: number; w: number; h: number; c: number; a: number }[] = [];

  clear(): void {
    for (const v of this.byColor.values()) v.length = 0;
    this.alphaRects.length = 0;
  }

  /** Couleur du moteur (ABGR) ; alpha optionnel pour les voiles et reflets. */
  rect(x: number, y: number, w: number, h: number, c: Color, a = 1): void {
    if (w <= 0 || h <= 0) return;
    const hex = toHex(c);
    if (a < 1) {
      this.alphaRects.push({ x: Math.round(x), y: Math.round(y), w, h, c: hex, a });
      return;
    }
    let list = this.byColor.get(hex);
    if (!list) {
      list = [];
      this.byColor.set(hex, list);
    }
    list.push(Math.round(x), Math.round(y), w, h);
  }

  px(x: number, y: number, c: Color, a = 1): void {
    this.rect(x, y, 1, 1, c, a);
  }

  hline(x0: number, x1: number, y: number, c: Color, a = 1): void {
    const a0 = Math.round(Math.min(x0, x1));
    const a1 = Math.round(Math.max(x0, x1));
    this.rect(a0, y, a1 - a0 + 1, 1, c, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color, a = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      this.px(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Disque des planches (même arrondi que `Buf.disc`). */
  disc(cx: number, cy: number, r: number, c: Color, a = 1): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      const q = r * r - dy * dy + r * 0.6;
      if (q < 0) continue;
      const dx = Math.floor(Math.sqrt(q));
      this.rect(cx - dx, cy + dy, dx * 2 + 1, 1, c, a);
    }
  }

  /** Remplissage de polygone par balayage (même règle que `Buf.poly`). */
  poly(p: readonly number[], c: Color, a = 1): void {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 1; i < p.length; i += 2) {
      y0 = Math.min(y0, p[i]);
      y1 = Math.max(y1, p[i]);
    }
    const n = p.length / 2;
    const xs: number[] = [];
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = p[i * 2];
        const ay = p[i * 2 + 1];
        const bx = p[((i + 1) % n) * 2];
        const by = p[((i + 1) % n) * 2 + 1];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.round(xs[k]);
        const xb = Math.round(xs[k + 1]) - 1;
        if (xb >= xa) this.rect(xa, y, xb - xa + 1, 1, c, a);
      }
    }
  }

  flush(): void {
    const g = this.g;
    g.clear();
    for (const [hex, list] of this.byColor) {
      if (list.length === 0) continue;
      for (let i = 0; i < list.length; i += 4) g.rect(list[i], list[i + 1], list[i + 2], list[i + 3]);
      g.fill(hex);
    }
    for (const r of this.alphaRects) g.rect(r.x, r.y, r.w, r.h).fill({ color: r.c, alpha: r.a });
  }
}

/** Bande périodique (nuages, lointains) répétée pour couvrir la vue, décalée au pixel entier. */
export class WrapStrip {
  readonly view = new Container();
  private readonly sprites: Sprite[] = [];
  private texture: Texture;
  readonly period: number;

  constructor(texture: Texture) {
    this.texture = texture;
    this.period = texture.width;
  }

  setTexture(tex: Texture): void {
    if (tex === this.texture) return;
    this.texture = tex;
    for (const s of this.sprites) s.texture = tex;
  }

  /** `offset` : position de l'origine du motif à l'écran (px d'art), `y` : haut de la bande. */
  place(offset: number, y: number, viewW: number): void {
    const p = this.period;
    let x = (((Math.round(offset) % p) + p) % p) - p;
    let i = 0;
    while (x < viewW) {
      let s = this.sprites[i];
      if (!s) {
        s = new Sprite(this.texture);
        this.sprites.push(s);
        this.view.addChild(s);
      }
      s.visible = true;
      s.position.set(x, Math.round(y));
      x += p;
      i++;
    }
    for (; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }
}

/** Sprite dont on redessine le Buf au CPU chaque frame (créatures des planches). */
export class CpuSprite {
  readonly buf: Buf;
  readonly texture: Texture;
  readonly sprite: Sprite;

  constructor(w: number, h: number, label: string) {
    this.buf = new Buf(w, h);
    this.texture = textureFromBuf(this.buf, label);
    this.sprite = new Sprite(this.texture);
  }

  commit(x: number, y: number): void {
    refreshTexture(this.texture);
    this.sprite.position.set(Math.round(x), Math.round(y));
  }

  destroy(): void {
    this.sprite.destroy();
    this.texture.destroy(true);
  }
}

const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

/** En-tête commun des surfaces procédurales : pixel courant, Bayer 4x4, palette. */
export const SURFACE_HEADER = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform float uTime;
uniform float uCamX;
const float BAYER[16] = float[16](0.03125, 0.53125, 0.15625, 0.65625, 0.78125, 0.28125, 0.90625, 0.40625, 0.21875, 0.71875, 0.09375, 0.59375, 0.96875, 0.46875, 0.84375, 0.34375);
float bayer(vec2 p) {
  int ix = int(mod(p.x, 4.0));
  int iy = int(mod(p.y, 4.0));
  return BAYER[iy * 4 + ix];
}
vec2 pixel() {
  return floor(uOrigin + vUV * uSize);
}
`;

export type SurfaceUniforms = Record<string, { value: number | Float32Array; type: string }>;

/**
 * Surface calculée par pixel sur le GPU (mer, lave) : le shader reçoit la position du pixel en px
 * d'art de la vue et renvoie une couleur de palette, comme les boucles par pixel des planches.
 */
export class SurfaceQuad {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  readonly uniforms: UniformGroup;

  constructor(fragment: string, extra: SurfaceUniforms, name: string) {
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.uniforms = new UniformGroup({
      uOrigin: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
      uSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uTime: { value: 0, type: 'f32' },
      uCamX: { value: 0, type: 'f32' },
      ...extra,
    } as ConstructorParameters<typeof UniformGroup>[0]);
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: QUAD_VERTEX, fragment: SURFACE_HEADER + fragment, name }),
      resources: { surfaceUniforms: this.uniforms },
    });
    this.mesh = new Mesh({ geometry, shader });
  }

  get u(): Record<string, number | Float32Array> {
    return this.uniforms.uniforms as Record<string, number | Float32Array>;
  }

  place(x: number, y: number, w: number, h: number, time: number, camX: number): void {
    const u = this.uniforms.uniforms as { uOrigin: Float32Array; uSize: Float32Array; uTime: number; uCamX: number };
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rw = Math.max(0, Math.round(w));
    const rh = Math.max(0, Math.round(h));
    u.uOrigin[0] = rx;
    u.uOrigin[1] = ry;
    u.uSize[0] = Math.max(1, rw);
    u.uSize[1] = Math.max(1, rh);
    u.uTime = time;
    u.uCamX = camX;
    this.mesh.position.set(rx, ry);
    this.mesh.scale.set(Math.max(1, rw), Math.max(1, rh));
    this.mesh.visible = rw > 0 && rh > 0;
  }
}

/** Couleur du moteur -> vec3 GLSL (composantes 0..1). */
export function vec3Of(c: Color): Float32Array {
  const hex = toHex(c);
  return new Float32Array([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);
}

/** Halo pré-calculé (lueur tramée des planches) en texture, pour un sprite. */
export function glowTexture(r: number, c: Color, s: number, label: string): Texture {
  const b = new Buf(r * 2 + 1, r * 2 + 1);
  b.glowA(r, r, r, c, s);
  return textureFromBuf(b, label);
}
