/**
 * Bambouseraie maudite, runtime d'une vue : le fond vivant de la planche (scene-bamboo.js) porté en
 * couches Pixi. Ordre de la planche : ciel -> étoiles -> étoile filante -> halo et lune -> nuages ->
 * ryū -> lointains (montagnes, pagodes, bambous lointains) -> cascades -> bambous qui ploient (0,7)
 * -> brume B -> lucioles -> feuilles qui tombent. Au milieu (sur les tuiles, sous les épines) : la
 * brume A, qui ne vit que dans l'air des trous et des ruines. Devant : les bambous de premier plan,
 * qui s'effacent autour du perso et des épines.
 *
 * Repère vertical : le sol de la planche (y = 262) est calé sur le sol principal de la carte, chaque
 * plan suit la caméra verticale avec sa propre parallaxe (parallaxY).
 */
import { Container, GlProgram, Graphics, Mesh, MeshGeometry, MeshSimple, Shader, Sprite, UniformGroup, type Texture } from 'pixi.js';
import { Buf, dith, fbm, fsin, hash2, toHex, type Color } from '../../../pixel/engine';
import { clouds, rimTop } from '../../../pixel/kit';
import { ART_TILE, solidAt, type LevelShape } from '../../levelShape';
import { textureFromBuf } from '../../textures';
import { CpuSprite, glowTexture, PixelBatch, WrapStrip } from '../pixiKit';
import type { ThemeRuntime } from '../runtime';
import { parallaxY, type ThemeFrame } from '../types';
import { K } from './palette';

const TAU = Math.PI * 2;
/** y du sol dans la planche : repère des lointains. */
const PLANCHE_FLOOR = 262;
const SKY_H = 300;
const FAR_P = 1440;
const FAR_Y0 = 60;
const FAR_H = 380;
/** Pied des cascades (y planche) : elles s'arrêtent sur le flanc, dans leurs embruns. */
const FALL_BOTTOM = 214;
const CLOUD_P = 768;
const FOG_P = 800;
const FOG_A_H = 112;
const FOG_B_H = 70;
const BAMBOO_P = 900;
const BAMBOO_N = 16;
const BAMBOO_BOTTOM = 400;
const STALK_NV = 26;
const STAR_P = 640;

interface Statics {
  sky: Texture;
  moon: Texture;
  moonHalo: Texture;
  clouds: Texture;
  far: Texture;
  falls: { x: number; y0: number }[];
  fogB: Texture;
  fogA: Texture;
  firefly: Texture;
  /** Atlas des 16 bambous à 0,7 (4 px de large, 5 px de pas). */
  stalks: Texture;
  stalkTop: number[];
}

let statics: Statics | null = null;

/**
 * Brume de la planche (fogStrip), période exacte : fbm périodique en x, densité qui monte vers le
 * bas (`ramp` : gain de densité du haut au bas de la bande, `lift` : décalage au sommet).
 */
function fogStrip(seed: number, w: number, h: number, ramp = 0.5, lift = -0.25): Buf {
  const b = new Buf(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / 40, y / 13, seed, w / 40) + (y / h) * ramp + lift;
      if (n > 0.72) b.d[y * w + x] = K.fog[2];
      else if (n > 0.6) b.d[y * w + x] = K.fog[1];
      else if (n > 0.5) b.d[y * w + x] = dith(x, y, 0, K.fog[0], (n - 0.5) * 8);
    }
  }
  return b;
}

/**
 * Lointains périodiques : crête faite de sinusoïdes à nombre entier de périodes (aucune couture),
 * deux pagodes, bambous lointains, falaises sombres derrière les cascades.
 */
function farLayer(): { buf: Buf; falls: { x: number; y0: number }[] } {
  const b = new Buf(FAR_P, FAR_H);
  const ridge = new Float32Array(FAR_P);
  for (let x = 0; x < FAR_P; x++) {
    const u = (x / FAR_P) * TAU;
    const h = 142 + 16 * Math.sin(u * 3 + 0.7) + 10 * Math.sin(u * 7 + 2.1) + 5 * Math.sin(u * 17 + 0.4) + (fbm(x / 30, 0.5, 5, FAR_P / 30) - 0.5) * 26;
    ridge[x] = h;
    // La montagne descend jusqu'au bas du calque : quand la caméra monte, aucun pied n'apparaît.
    for (let y = Math.max(0, Math.round(h) - FAR_Y0); y < FAR_H; y++) b.d[y * FAR_P + x] = K.mount;
  }
  const pagoda = (px: number): void => {
    const base = Math.round(ridge[px]) - FAR_Y0 + 4;
    for (let i = 0; i < 3; i++) {
      const y = base - 16 + i * 7;
      const hw = 7 + i * 3;
      b.poly([px - hw, y + 5, px + hw, y + 5, px + hw - 3, y, px - hw + 3, y], K.mount);
      b.rect(px - hw + 4, y + 5, hw * 2 - 8, 2, K.mount);
    }
    b.rect(px - 1, base - 22, 2, 6, K.mount);
    b.rect(px - 6, base, 12, 10, K.mount);
  };
  pagoda(Math.round(FAR_P * 0.36));
  pagoda(Math.round(FAR_P * 0.83));
  rimTop(b, K.mount, K.mountRim);
  // Brume de vallée : quelques nappes tramées au pied des montagnes (planche : lueur basse du ciel).
  for (let y = 190 - FAR_Y0; y < FAR_H; y++) {
    const k = Math.min(1, (y + FAR_Y0 - 190) / 90);
    for (let x = 0; x < FAR_P; x++) {
      if (b.d[y * FAR_P + x] !== K.mount) continue;
      const n = fbm(x / 48, y / 9, 13, FAR_P / 48, 3);
      if (n > 0.66 - k * 0.14 && dith(x, y, 0, 1, 0.55) === 1) b.d[y * FAR_P + x] = K.cloud[0];
    }
  }
  // Cascades : sur l'épaule la plus haute de deux fenêtres, falaise plus sombre derrière.
  const falls: { x: number; y0: number }[] = [];
  for (const [a, c] of [[200, 340], [880, 1020]]) {
    let best = a;
    for (let x = a; x < c; x++) if (ridge[x] < ridge[best]) best = x;
    const y0 = Math.round(ridge[best]) + 4;
    falls.push({ x: best - 1, y0 });
    for (let y = y0 - FAR_Y0 - 2; y < FALL_BOTTOM + 6 - FAR_Y0; y++) {
      for (let k = -3; k < 6; k++) {
        const x = best - 1 + k;
        if (b.get(x, y) !== K.mount) continue;
        if (Math.abs(k - 1) < 4 || hash2(x, y, 4) > 0.5) b.px(x, y, K.mountDk);
      }
    }
  }
  // Bambous lointains (planche : 40 pour 720 px), nœuds sombres.
  for (let i = 0; i < 80; i++) {
    const x = Math.floor(hash2(i, 0, 21) * FAR_P);
    const top = Math.round(60 + hash2(i, 1, 21) * 80) - FAR_Y0;
    for (let y = top; y < FAR_H; y++) {
      b.d[y * FAR_P + x] = K.bFar;
      b.d[y * FAR_P + ((x + 1) % FAR_P)] = K.bFar;
    }
    for (let y = top + 16; y < FAR_H; y += 18 + (i % 4)) {
      for (let k = -1; k <= 2; k++) b.d[y * FAR_P + ((x + k + FAR_P) % FAR_P)] = K.bFarNode;
    }
  }
  return { buf: b, falls };
}

function getStatics(): Statics {
  if (statics) return statics;
  const sky = new Buf(64, SKY_H);
  sky.vgrad(0, SKY_H, K.sky);
  // Lune en croissant de la planche : disque de 22 px moins un disque décalé, ombre à droite.
  const moon = new Buf(45, 45);
  for (let y = -22; y <= 22; y++) {
    for (let x = -22; x <= 22; x++) {
      if (x * x + y * y > 484) continue;
      if ((x + 9) * (x + 9) + (y + 6) * (y + 6) < 380) continue;
      moon.px(22 + x, 22 + y, x > 10 ? K.moonShade : K.moon);
    }
  }
  const far = farLayer();
  const stalkTop: number[] = [];
  const atlas = new Buf(BAMBOO_N * 5, BAMBOO_BOTTOM);
  for (let i = 0; i < BAMBOO_N; i++) {
    const top = Math.floor(10 + hash2(i, 1, 31) * 60);
    stalkTop.push(top);
    for (let r = 0; r < BAMBOO_BOTTOM - top; r++) {
      const node = r % 22 === 0;
      atlas.px(i * 5, r, node ? K.node : K.stalkLit);
      for (let k = 1; k < 4; k++) atlas.px(i * 5 + k, r, node ? K.node : K.stalk);
    }
  }
  statics = {
    sky: textureFromBuf(sky, 'bamboo-sky'),
    moon: textureFromBuf(moon, 'bamboo-moon'),
    moonHalo: glowTexture(50, K.halo, 0.26, 'bamboo-moon-halo'),
    clouds: textureFromBuf(clouds(51, CLOUD_P, 50, 0.52, K.cloud, K.cloudLit), 'bamboo-clouds'),
    far: textureFromBuf(far.buf, 'bamboo-far'),
    falls: far.falls,
    fogB: textureFromBuf(fogStrip(67, FOG_P, FOG_B_H), 'bamboo-fog-b'),
    // La cave se parcourt : brume clairsemée en haut, qui s'épaissit au ras des épines.
    fogA: textureFromBuf(fogStrip(61, FOG_P, FOG_A_H, 0.5, -0.4), 'bamboo-fog-a'),
    firefly: glowTexture(5, K.firefly, 0.5, 'bamboo-firefly'),
    stalks: textureFromBuf(atlas, 'bamboo-stalks'),
    stalkTop,
  };
  return statics;
}

// ------------------------------------------------------------------ ryū de jade

const RW = 372;
const RH = 100;
const RDX = 340;
const RDY = 52;

/** Le ryū de la planche : 62 segments, pattes, ventre d'or, crinière, bois, gueule qui s'ouvre. */
class Ryu {
  readonly canvas = new CpuSprite(RW, RH, 'bamboo-ryu');
  private readonly seg = new Float32Array(62 * 3);

  /** (hx, hy) : tête à l'écran, hy = ligne du corps (y 104 de la planche). */
  draw(t: number, hx: number, hy: number): void {
    const buf = this.canvas.buf;
    buf.clear();
    const seg = this.seg;
    for (let s = 0; s < 62; s++) {
      seg[s * 3] = RDX - s * 5.2;
      seg[s * 3 + 1] = RDY + fsin(t * 1.2 - s * 0.24) * 14 + fsin(s * 0.1 + t * 0.3) * 5;
      seg[s * 3 + 2] = s < 3 ? 7 : 6.5 * (1 - s / 70) + 1.3;
    }
    // Nuées qui s'échappent sous la queue.
    for (let i = 0; i < 6; i++) {
      const s = 40 + i * 4;
      const age = (t * 0.8 + i * 0.17) % 1;
      buf.disc(seg[s * 3] - age * 20, seg[s * 3 + 1] + 6, 2 + age * 5, K.cloud[1]);
    }
    // Pattes griffues.
    for (const s of [12, 20, 38, 46]) {
      const x = seg[s * 3];
      const y = seg[s * 3 + 1];
      const sw = fsin(t * 4 + s) * 3;
      buf.stroke(x, y + 4, x - 3 + sw, y + 11, 2, K.dragonDk);
      buf.px(x - 4 + sw, y + 12, K.antler);
      buf.px(x - 2 + sw, y + 12, K.antler);
    }
    for (let i = seg.length - 3; i >= 0; i -= 3) buf.disc(seg[i], seg[i + 1] + 2, seg[i + 2] * 0.8, K.belly);
    for (let i = seg.length - 3; i >= 0; i -= 3) {
      const s = i / 3;
      buf.disc(seg[i], seg[i + 1] - 0.5, seg[i + 2], K.dragon);
      buf.px(seg[i], seg[i + 1] - seg[i + 2], K.dragonLit);
      if (s % 2 === 0) buf.px(seg[i] - 1, seg[i + 1] - 1, K.dragonDk);
      if (s % 3 === 1) {
        buf.px(seg[i], seg[i + 1] - seg[i + 2] - 1, K.fin);
        buf.px(seg[i] - 1, seg[i + 1] - seg[i + 2] - 2, K.fin);
      }
    }
    const tx = seg[seg.length - 3];
    const ty = seg[seg.length - 2];
    for (let k = 0; k < 6; k++) buf.px(tx - 2 - k, ty + fsin(t * 5 + k) * 2 - k * 0.3, K.fin);
    // Tête : museau, mâchoire qui s'ouvre, bois, crinière, œil, moustaches.
    const x = seg[0];
    const y = seg[1];
    const jaw = (fsin(t * 1.7) + 1) * 1.5;
    buf.ellipse(x + 5, y - 2, 8, 5, K.dragon);
    buf.poly([x + 8, y - 4, x + 18, y - 3, x + 17, y + 1, x + 8, y + 1], K.dragon);
    buf.poly([x + 8, y + 2 + jaw * 0.3, x + 16, y + 2 + jaw, x + 8, y + 5 + jaw * 0.5], K.dragonDk);
    buf.hline(x + 1, x + 16, y - 6, K.dragonLit);
    buf.px(x + 18, y - 2, K.antler);
    buf.px(x + 16, y + 2 + jaw, K.antler);
    buf.stroke(x + 2, y - 6, x - 6, y - 16, 1, K.antler);
    buf.stroke(x - 3, y - 11, x - 1, y - 16, 1, K.antler);
    buf.stroke(x + 5, y - 6, x, y - 17, 1, K.antler);
    for (let k = 0; k < 8; k++) buf.stroke(x - 1 - k * 2, y - 4 + fsin(t * 3 + k) * 1.5, x - 3 - k * 2, y - 8 - fsin(t * 4 + k) * 2, 1, K.fin);
    buf.px(x + 8, y - 3, K.dEye);
    buf.glowA(x + 8, y - 3, 6, K.dEye, 0.4);
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < 20; k++) buf.px(x + 16 - k, y + 1 + side * 2 + fsin(t * 3 + k * 0.4 + side) * 2.5 + k * 0.25, K.antler);
    }
    this.canvas.commit(hx - RDX, hy - RDY);
  }
}

// ------------------------------------------------------------------ brume A (masquée par les tuiles)

const FOG_VERTEX = `#version 300 es
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

/**
 * La brume A de la planche, calculée par pixel : motif périodique (texture) qui dérive, posé
 * seulement dans l'air (masque des tuiles), à 2 px des faces pleines pour garder les arêtes nettes,
 * et jamais au-dessus du sol principal. Les épines sont dessinées par-dessus.
 */
const FOG_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uCam;
uniform vec4 uBand;
uniform vec2 uMaskSize;
uniform float uPeriod;
uniform sampler2D uFog;
uniform sampler2D uMask;
float air(ivec2 t) {
  if (t.x < 0 || t.y < 0 || t.x >= int(uMaskSize.x) || t.y >= int(uMaskSize.y)) return 0.0;
  return texelFetch(uMask, t, 0).r;
}
void main() {
  vec2 w = floor(uOrigin + vUV * uSize) + uCam;
  float fy = w.y - uBand.y;
  if (fy < 0.0 || fy >= uBand.z || w.y < uBand.w) discard;
  ivec2 t = ivec2(floor(w / 16.0));
  if (air(t) < 0.5) discard;
  vec2 f = w - vec2(t) * 16.0;
  if (f.x < 2.0 && air(t + ivec2(-1, 0)) < 0.5) discard;
  if (f.x > 13.0 && air(t + ivec2(1, 0)) < 0.5) discard;
  if (f.y < 2.0 && air(t + ivec2(0, -1)) < 0.5) discard;
  if (f.y > 13.0 && air(t + ivec2(0, 1)) < 0.5) discard;
  float fx = mod(w.x + uBand.x, uPeriod);
  vec4 c = texelFetch(uFog, ivec2(int(fx), int(fy)), 0);
  if (c.a < 0.5) discard;
  finalColor = c;
}`;

class MaskedFog {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly uniforms: UniformGroup;
  private readonly shader: Shader;
  private shape: LevelShape | null = null;
  private maskTex: Texture | null = null;
  /** Haut de la bande (monde) et sol principal, pour la carte courante. */
  private bandTop = 0;
  private minY = 0;
  private enabled = false;

  constructor(fog: Texture) {
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.uniforms = new UniformGroup({
      uOrigin: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
      uSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uCam: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
      uBand: { value: new Float32Array([0, 0, FOG_A_H, 0]), type: 'vec4<f32>' },
      uMaskSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uPeriod: { value: FOG_P, type: 'f32' },
    });
    const blank = textureFromBuf(new Buf(1, 1), 'bamboo-fog-mask-blank');
    this.maskTex = blank;
    this.shader = new Shader({
      glProgram: GlProgram.from({ vertex: FOG_VERTEX, fragment: FOG_FRAGMENT, name: 'bamboo-fog-a' }),
      resources: { fogUniforms: this.uniforms, uFog: fog.source, uMask: blank.source },
    });
    this.mesh = new Mesh({ geometry, shader: this.shader });
  }

  /** Masque d'air de la carte (1 texel par tuile) et bande de la brume : au fond des ruines. */
  private setShape(shape: LevelShape): void {
    this.shape = shape;
    const m = new Buf(shape.w, shape.h);
    for (let ty = 0; ty < shape.h; ty++) for (let tx = 0; tx < shape.w; tx++) if (!solidAt(shape, tx, ty)) m.d[ty * shape.w + tx] = 0xffffffff;
    const old = this.maskTex;
    this.maskTex = textureFromBuf(m, 'bamboo-fog-mask');
    this.shader.resources.uMask = this.maskTex.source;
    old?.destroy(true);
    const u = this.uniforms.uniforms as { uMaskSize: Float32Array };
    u.uMaskSize[0] = shape.w;
    u.uMaskSize[1] = shape.h;
    // Fond de la cave : médiane du premier plein sous le plafond de la cave.
    const bottoms: number[] = [];
    for (let tx = 0; tx < shape.w; tx++) {
      let y = shape.floorRow;
      while (y < shape.h && solidAt(shape, tx, y)) y++;
      let z = y;
      while (z < shape.h && !solidAt(shape, tx, z)) z++;
      if (z > y && z < shape.h) bottoms.push(z * ART_TILE);
    }
    this.enabled = bottoms.length > 0;
    if (!this.enabled) return;
    bottoms.sort((a, b) => a - b);
    this.bandTop = bottoms[bottoms.length >> 1] - FOG_A_H;
    this.minY = shape.floorRow * ART_TILE + 2;
  }

  update(f: ThemeFrame): void {
    if (f.shape !== this.shape) this.setShape(f.shape);
    const y0 = Math.max(0, this.bandTop - f.camY);
    const y1 = Math.min(f.viewH, this.bandTop + FOG_A_H - f.camY);
    this.mesh.visible = this.enabled && y1 > y0;
    if (!this.mesh.visible) return;
    const u = this.uniforms.uniforms as { uOrigin: Float32Array; uSize: Float32Array; uCam: Float32Array; uBand: Float32Array };
    u.uOrigin[0] = 0;
    u.uOrigin[1] = y0;
    u.uSize[0] = f.viewW;
    u.uSize[1] = y1 - y0;
    u.uCam[0] = f.camX;
    u.uCam[1] = f.camY;
    // Planche : blitWrap(fogA, -t * 9 - cx) ; le motif dérive de 9 px/s.
    u.uBand[0] = (f.t * 9) % FOG_P;
    u.uBand[1] = this.bandTop;
    u.uBand[2] = FOG_A_H;
    u.uBand[3] = this.minY;
    this.mesh.position.set(0, y0);
    this.mesh.scale.set(f.viewW, y1 - y0);
  }

  destroy(): void {
    this.maskTex?.destroy(true);
    this.maskTex = null;
  }
}

// ------------------------------------------------------------------ bambous à 0,7

/** Bambous qui ploient (planche : 16 pour 900 px) : bandes de sommets déplacées chaque frame. */
class BambooLayer {
  readonly view = new Container();
  private readonly meshes: MeshSimple[] = [];
  private readonly uvs: Float32Array[] = [];
  /** Bambou de l'atlas actuellement porté par chaque bande (-1 : aucun). */
  private readonly stalkOf: number[] = [];

  private mesh(n: number, i: number): MeshSimple {
    const S = getStatics();
    let m = this.meshes[n];
    if (!m) {
      const uvs = new Float32Array(STALK_NV * 4);
      const indices = new Uint32Array((STALK_NV - 1) * 6);
      for (let j = 0; j < STALK_NV - 1; j++) {
        const o = j * 6;
        indices[o] = j * 2;
        indices[o + 1] = j * 2 + 1;
        indices[o + 2] = j * 2 + 2;
        indices[o + 3] = j * 2 + 1;
        indices[o + 4] = j * 2 + 3;
        indices[o + 5] = j * 2 + 2;
      }
      m = new MeshSimple({ texture: S.stalks, vertices: new Float32Array(STALK_NV * 4), uvs, indices });
      this.meshes[n] = m;
      this.uvs[n] = uvs;
      this.stalkOf[n] = -1;
      this.view.addChild(m);
    }
    // Coordonnées de texture du bambou i dans l'atlas.
    if (this.stalkOf[n] !== i) {
      this.stalkOf[n] = i;
      const uvs = this.uvs[n];
      const aw = BAMBOO_N * 5;
      const len = BAMBOO_BOTTOM - S.stalkTop[i];
      for (let j = 0; j < STALK_NV; j++) {
        const v = ((len * j) / (STALK_NV - 1)) / BAMBOO_BOTTOM;
        uvs[j * 4] = (i * 5) / aw;
        uvs[j * 4 + 1] = v;
        uvs[j * 4 + 2] = (i * 5 + 4) / aw;
        uvs[j * 4 + 3] = v;
      }
      m.geometry.getBuffer('aUV').update();
    }
    m.visible = true;
    return m;
  }

  update(t: number, camX: number, viewW: number, yOf: (yp: number) => number, leaves: PixelBatch): void {
    const S = getStatics();
    let n = 0;
    for (let i = 0; i < BAMBOO_N; i++) {
      const bx = hash2(i, 0, 31) * BAMBOO_P - camX * 0.7;
      const base = (((bx % BAMBOO_P) + BAMBOO_P) % BAMBOO_P) - 60;
      const top = S.stalkTop[i];
      const len = BAMBOO_BOTTOM - top;
      const ph = t * 0.9 + i * 1.3;
      const a = fsin(ph) * 9;
      const c = fsin(ph * 2.3) * 1.5;
      const y0 = yOf(top);
      for (let x0 = base; x0 < viewW + 20; x0 += BAMBOO_P) {
        if (x0 < -30) continue;
        const m = this.mesh(n++, i);
        const v = m.vertices;
        for (let j = 0; j < STALK_NV; j++) {
          const r = (len * j) / (STALK_NV - 1);
          const k = Math.max(0, (360 - (top + r)) / 360);
          const x = x0 + a * k * k + c * k;
          v[j * 4] = x;
          v[j * 4 + 1] = y0 + r;
          v[j * 4 + 2] = x + 4;
          v[j * 4 + 3] = y0 + r;
        }
        // Feuillage de la planche : 9 feuilles qui frémissent au sommet.
        const kt = Math.max(0, (360 - top) / 360);
        const lxBase = x0 + a * kt * kt + c * kt;
        for (let l = 0; l < 9; l++) {
          const lx = lxBase + (l - 4) * 3;
          const ly = y0 + 5 + (l % 3) * 4;
          const d = l < 4 ? -1 : 1;
          const fl = fsin(t * 3 + l + i) * 0.6;
          const slope = 0.55 + fl * 0.1;
          let runX = Math.round(lx);
          let runY = Math.round(ly);
          let runN = 0;
          let runC: Color = K.leafLit;
          for (let q = 0; q < 8; q++) {
            const px = Math.round(lx + d * q);
            const py = Math.round(ly + q * slope);
            const col = q < 3 ? K.leafLit : K.leaf;
            if (runN > 0 && py === runY && col === runC && px === runX + d * runN) {
              runN++;
              continue;
            }
            if (runN > 0) leaves.rect(d > 0 ? runX : runX - runN + 1, runY, runN, 1, runC);
            runX = px;
            runY = py;
            runN = 1;
            runC = col;
          }
          if (runN > 0) leaves.rect(d > 0 ? runX : runX - runN + 1, runY, runN, 1, runC);
        }
      }
    }
    for (let i = n; i < this.meshes.length; i++) this.meshes[i].visible = false;
  }
}

// ------------------------------------------------------------------ bambous de premier plan

const FRONT_W = 7;
const FRONT_PAD = 12;
/** Rayon de la découpe autour du perso (px d'art) : la hitbox, l'écharpe et la flamme y tiennent. */
const CUT_R = 22;

/**
 * Deux bambous de premier plan (planche : 7 px, presque noirs) qui cadrent la vue, rameaux tournés
 * vers l'intérieur ; découpés autour du perso et devant les épines.
 */
class FrontStalks {
  readonly view = new Container();
  private readonly pool: CpuSprite[] = [];
  private h = 0;

  private sprite(n: number, h: number): CpuSprite {
    if (h > this.h) {
      for (const s of this.pool) {
        this.view.removeChild(s.sprite);
        s.destroy();
      }
      this.pool.length = 0;
      this.h = Math.ceil(h / 64) * 64;
    }
    let s = this.pool[n];
    if (!s) {
      s = new CpuSprite(FRONT_W + FRONT_PAD * 2, this.h, `bamboo-front-${n}`);
      this.pool.push(s);
      this.view.addChild(s.sprite);
    }
    s.sprite.visible = true;
    return s;
  }

  update(f: ThemeFrame): void {
    const { t, camX, camY, viewW, viewH } = f;
    const holes = f.heroes.map((h) => ({ x: h.x - camX, y: h.y - camY - 4 }));
    // Les épines restent visibles : le premier plan s'efface aussi devant elles.
    const spikes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const r of f.shape.spikes) {
      const x0 = r.x0 * ART_TILE - camX - 2;
      const x1 = (r.x1 + 1) * ART_TILE - camX + 2;
      const y1 = (r.y + 1) * ART_TILE - camY;
      if (x1 < 0 || x0 > viewW || y1 < 0 || y1 - 20 > viewH) continue;
      spikes.push({ x0, x1, y0: y1 - 18, y1 });
    }
    let n = 0;
    for (let i = 0; i < 2; i++) {
      // Planche : x0 = 6 et 622 sur 640 px. Ils cadrent la vue aux deux bords : en dérivant au
      // centre, ils masqueraient des ancrages. Ils ploient au vent, leurs nœuds suivent la caméra.
      const sx = i === 0 ? 6 : viewW - 18;
      const cs = this.sprite(n++, viewH);
      const buf = cs.buf;
      buf.clear();
      const ph = t * 0.9 + i * 1.3;
      const a = fsin(ph) * 9;
      const c = fsin(ph * 2.3) * 1.5;
      const ox = Math.round(sx) - FRONT_PAD;
      // Découpe franche autour du perso, bordée d'un liseré : le bambou s'écarte, on voit à travers.
      // Les épines ne sont jamais couvertes.
      const plot = (x: number, y: number, col: Color): void => {
        if (x < 0 || x >= buf.w || y < 0 || y >= viewH) return;
        const X = ox + x;
        for (const h of holes) {
          const dy = y - h.y;
          if (dy > CUT_R + 2 || dy < -CUT_R - 2) continue;
          const d = Math.hypot(X - h.x, dy);
          if (d < CUT_R) return;
          if (d < CUT_R + 1.5) col = K.fgNodeHi;
        }
        for (const s of spikes) if (y >= s.y0 && y < s.y1 && X >= s.x0 && X <= s.x1) return;
        buf.d[y * buf.w + x] = col;
      };
      const vy = Math.round(camY * 0.3) + 400;
      const lxAt = (y: number): number => {
        const k = (viewH - y) / viewH;
        return Math.round(FRONT_PAD + (a * k * k + c * k) * 0.9);
      };
      const d = buf.d;
      for (let y = 0; y < viewH; y++) {
        const lx = lxAt(y);
        const nd = (((y + vy) % 34) + 34) % 34 < 2;
        const body = nd ? K.fgNode : K.fg;
        const edge = nd ? K.fgNodeHi : K.fgEdge;
        // Chemin rapide : loin du perso et des épines, la rangée s'écrit d'un bloc.
        let near = false;
        for (const h of holes) if (y - h.y <= CUT_R + 2 && h.y - y <= CUT_R + 2) near = true;
        for (const s of spikes) if (y >= s.y0 && y < s.y1) near = true;
        if (near) {
          for (let q = 0; q < FRONT_W; q++) plot(lx + q, y, q === FRONT_W - 1 ? edge : body);
          continue;
        }
        const o = y * buf.w + lx;
        d.fill(body, o, o + FRONT_W - 1);
        d[o + FRONT_W - 1] = edge;
      }
      // Rameaux à quelques nœuds : une tige qui monte, trois feuilles qui retombent, en silhouette.
      for (let y0 = -(((vy % 34) + 34) % 34) + 34; y0 < viewH; y0 += 34) {
        const node = Math.floor((y0 + vy) / 34);
        if (hash2(i, node, 5) < 0.62) continue;
        const side = i === 0 ? 1 : -1;
        const x0 = lxAt(y0) + (side > 0 ? FRONT_W : -1);
        for (let q = 0; q < 5; q++) plot(x0 + side * q, y0 - Math.round(q * 0.8), K.fg);
        const ex = x0 + side * 4;
        const ey = y0 - 4;
        for (let l = 0; l < 3; l++) {
          for (let q = 0; q < 7; q++) plot(ex + side * (q - l * 2), ey + l + Math.round(q * 0.6), q === 0 ? K.fgEdge : K.fg);
        }
      }
      cs.commit(ox, 0);
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].sprite.visible = false;
  }

  destroy(): void {
    for (const s of this.pool) s.destroy();
    this.pool.length = 0;
  }
}

// ------------------------------------------------------------------ runtime

export function createBambooRuntime(): ThemeRuntime {
  const S = getStatics();
  const back = new Container();
  const mid = new Container();
  const front = new Container();

  const skyFill = new Graphics();
  const sky = new WrapStrip(S.sky);
  const stars = new PixelBatch();
  const moonHalo = new Sprite(S.moonHalo);
  const moon = new Sprite(S.moon);
  const cloudStrip = new WrapStrip(S.clouds);
  const ryu = new Ryu();
  const far = new WrapStrip(S.far);
  const falls = new PixelBatch();
  const bamboo = new BambooLayer();
  const leaves = new PixelBatch();
  const fogB = new WrapStrip(S.fogB);
  const glows = new Container();
  const glowSprites: Sprite[] = [];
  const motes = new PixelBatch();
  back.addChild(skyFill, sky.view, stars.g, moonHalo, moon, cloudStrip.view, ryu.canvas.sprite, far.view, falls.g, bamboo.view, leaves.g, fogB.view, glows, motes.g);

  const fogA = new MaskedFog(S.fogA);
  mid.addChild(fogA.mesh);

  const fronts = new FrontStalks();
  front.addChild(fronts.view);

  const glow = (i: number): Sprite => {
    let s = glowSprites[i];
    if (!s) {
      s = new Sprite(S.firefly);
      glowSprites.push(s);
      glows.addChild(s);
    }
    s.visible = true;
    return s;
  };

  return {
    back,
    mid,
    front,
    update(f: ThemeFrame): void {
      const { t, camX, viewW, viewH } = f;
      const floorW = f.shape.floorRow * ART_TILE;
      const Y = (yp: number, p: number): number => Math.round(parallaxY(f, floorW + (yp - PLANCHE_FLOOR), p));

      // Ciel : dégradé de la planche, nuit pure au-dessus, lueur basse en dessous.
      const skyTop = Y(0, 0.1);
      const farTop = Y(FAR_Y0, 0.12);
      skyFill.clear();
      if (skyTop > 0) skyFill.rect(0, 0, viewW, skyTop).fill(toHex(K.sky[0]));
      if (skyTop + SKY_H < viewH) skyFill.rect(0, skyTop + SKY_H, viewW, viewH - skyTop - SKY_H).fill(toHex(K.sky[4]));
      if (farTop + FAR_H < viewH) skyFill.rect(0, farTop + FAR_H, viewW, viewH - farTop - FAR_H).fill(toHex(K.mount));
      sky.place(0, skyTop, viewW);

      // Étoiles qui scintillent (une sur neuf couleur de lune), deux bandes pour les vues hautes.
      stars.clear();
      const sox = -((camX * 0.02) % STAR_P);
      for (const [seed, yp] of [[71, 0], [72, -210]] as const) {
        const top = Y(yp, 0.05);
        if (top + 210 < 0 || top > viewH) continue;
        for (let i = 0; i < 170; i++) {
          const y = top + Math.floor(hash2(i, 1, seed) * (seed === 71 ? 200 : 210));
          if (y < 0 || y >= viewH) continue;
          if (fsin(t * (1 + hash2(i, 2, seed) * 3) + i) <= -0.3) continue;
          const c = i % 9 === 0 ? K.moon : K.star;
          let x = hash2(i, 0, seed) * STAR_P + sox;
          x = ((x % STAR_P) + STAR_P) % STAR_P;
          for (; x < viewW; x += STAR_P) stars.px(x, y, c);
        }
      }
      // Étoile filante toutes les 11 s.
      const sq = (t % 11) / 11;
      if (sq < 0.08) {
        const q = sq / 0.08;
        const bx = Math.round(viewW * 0.19);
        const by = Y(30, 0.05);
        for (let k = 0; k < 12; k++) stars.px(bx + q * 180 - k * 2, by + q * 50 - k * 0.55, k < 3 ? K.moon : K.star);
      }
      stars.flush();

      // Lune et son halo.
      const mx = Math.round(viewW * 0.72 - camX * 0.03);
      const my = Y(60, 0.05);
      moonHalo.position.set(mx - 50, my - 50);
      moon.position.set(mx - 22, my - 22);

      cloudStrip.place(-t * 5 - camX * 0.08, Y(70, 0.08), viewW);

      // Ryū : traverse le ciel devant la lune, cycle calé sur la largeur de la vue.
      const cycle = viewW + 460;
      const hx = ((((t * 18 + 420 - camX * 0.2) % cycle) + cycle) % cycle) - 250;
      const ryuVisible = hx > -40 && hx - RDX < viewW + 20;
      ryu.canvas.sprite.visible = ryuVisible;
      if (ryuVisible) ryu.draw(t, hx, Y(104, 0.15));

      // Lointains et cascades (mêmes copies périodiques).
      const farX = -camX * 0.12;
      far.place(farX, farTop, viewW);
      falls.clear();
      for (const fall of S.falls) {
        const yTop = Y(fall.y0, 0.12);
        const yBot = Y(FALL_BOTTOM, 0.12);
        let fx = (((fall.x + farX) % FAR_P) + FAR_P) % FAR_P;
        for (; fx < viewW + 4; fx += FAR_P) {
          if (fx < -4) continue;
          for (let k = 0; k < 3; k++) {
            let run = -1;
            for (let y = yTop; y <= yBot; y++) {
              const on = y < yBot && fsin((y - yTop + fall.y0) * 0.5 - t * 9 + k * 2) > 0.1;
              if (on && run < 0) run = y;
              else if (!on && run >= 0) {
                falls.rect(fx + k, run, 1, y - run, k === 1 ? K.fallHi : K.fall);
                run = -1;
              }
            }
          }
          // Embruns au pied de la chute : un petit nuage qui bouillonne.
          for (let m = 0; m < 14; m++) {
            if (fsin(t * 4 + m * 1.7) < -0.2) continue;
            const ex = fx + 1 + fsin(m * 2.3) * (3 + (m % 4)) + fsin(t * 2 + m) * 1.2;
            const ey = yBot - 1 - (m % 4) + fsin(t * 3 + m * 0.9) * 1.2;
            falls.px(ex, ey, m % 5 === 0 ? K.fall : K.fallMist);
          }
        }
      }
      falls.flush();

      // Bambous qui ploient, parallaxe 0,7.
      leaves.clear();
      bamboo.update(t, camX, viewW, (yp) => Y(yp, 0.7), leaves);
      leaves.flush();

      fogB.place(t * 6 - camX * 0.6, Y(236, 0.6), viewW);

      // Lucioles (planche : 40 pour 700 px) et feuilles qui tombent.
      motes.clear();
      let gi = 0;
      for (let i = 0; i < 40; i++) {
        if (fsin(t * 2.3 + i * 1.7) <= 0.2) continue;
        const y = Y(110 + hash2(i, 1, 81) * 190 + fsin(t * 1.1 + i * 2) * 8, 0.8);
        if (y < -6 || y > viewH + 6) continue;
        let x = ((((hash2(i, 0, 81) * 700 - camX * 0.8) % 700) + 700) % 700) - 30 + fsin(t * 0.7 + i) * 18;
        for (; x < viewW + 6; x += 700) {
          const s = glow(gi++);
          s.position.set(Math.round(x) - 5, y - 5);
          motes.px(x, y, K.firefly);
        }
      }
      for (let i = gi; i < glowSprites.length; i++) glowSprites[i].visible = false;
      const leafN = Math.round(36 * Math.max(1, (viewW * viewH) / (640 * 360)));
      const fallH = viewH + 40;
      for (let i = 0; i < leafN; i++) {
        const v = 14 + hash2(i, 1, 91) * 14;
        const y = ((t * v + hash2(i, 2, 91) * fallH) % fallH) - 20;
        const x = ((((hash2(i, 3, 91) * (viewW + 80) - camX * 0.9 + fsin(t * 1.3 + i) * 14 + t * 8) % (viewW + 80)) + viewW + 80) % (viewW + 80)) - 40;
        const flip = fsin(t * 4 + i) > 0 ? 1 : -1;
        motes.px(x, y, K.leafLit);
        motes.px(x + flip, y + 1, K.leaf);
        motes.px(x + flip * 2, y + 1, K.leaf);
      }
      motes.flush();

      fogA.update(f);
      fronts.update(f);
    },
    destroy(): void {
      ryu.canvas.destroy();
      fogA.destroy();
      fronts.destroy();
      back.destroy({ children: true });
      mid.destroy({ children: true });
      front.destroy({ children: true });
    },
  };
}
