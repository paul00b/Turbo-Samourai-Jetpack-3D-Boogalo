/**
 * Port d'Umibozu, runtime d'une vue : le fond vivant de la planche (scene-port.js) porté en couches
 * Pixi. Ordre de la planche : ciel -> nuages lointains -> éclair -> nuages proches -> lointains ->
 * mouettes -> jonques -> pluie lointaine -> Umibozu -> mer -> écume ; devant : pluie proche qui
 * s'écarte du perso, éclaboussures sur les pontons, gouttes sous les poutres.
 * L'éclair n'éclaire que le décor : rien ne clignote sous le joueur.
 */
import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { T_SOLID } from '../../../../sim';
import { Buf, C, fbm, fsin, hash2, Particles, type Color } from '../../../pixel/engine';
import { clouds, rimTop } from '../../../pixel/kit';
import { ART_TILE, solidAt } from '../../levelShape';
import { textureFromBuf } from '../../textures';
import { CpuSprite, glowTexture, PixelBatch, SurfaceQuad, vec3Of, WrapStrip } from '../pixiKit';
import type { ThemeRuntime } from '../runtime';
import { horizonY, parallaxY, type ThemeFrame } from '../types';
import { K } from './palette';

const FAR_P = 1440;
const FAR_H = 260;
const SKY_H = 212;
const BOLT_A = C('#e8f3ff');
const BOLT_B = C('#8fb3d9');

interface Statics {
  sky: Texture;
  skyF: Texture;
  cloudFar: Texture;
  cloudNear: Texture;
  far: Texture;
  farF: Texture;
  boatGlow: Texture;
  eyeGlow: Texture;
  /** Deux motifs de pluie lointaine qui se répètent (256 px), à des vitesses différentes. */
  rainA: Texture;
  rainB: Texture;
}

/** Motif de pluie périodique : des gouttes de 3 px inclinées comme KIT.rain, raccordées sur les bords. */
function rainTile(seed: number, drops: number, color: Color): Buf {
  const S = 256;
  const b = new Buf(S, S);
  for (let i = 0; i < drops; i++) {
    const x = Math.floor(hash2(i, 1, seed) * S);
    const y = Math.floor(hash2(i, 2, seed) * S);
    for (let k = 0; k < 3; k++) {
      const px = (((Math.round(x - k * 0.35) % S) + S) % S);
      const py = (((y - k) % S) + S) % S;
      b.d[py * S + px] = color;
    }
  }
  return b;
}

let statics: Statics | null = null;

/** Lointains périodiques : collines, deux pagodes, maisons aux fenêtres allumées. */
function farLayer(body: Color, rim: Color): Buf {
  const b = new Buf(FAR_P, FAR_H);
  const ridge = new Float32Array(FAR_P);
  for (let x = 0; x < FAR_P; x++) {
    const u = (x / FAR_P) * Math.PI * 2;
    const h = 64 + 38 * Math.sin(u * 2 + 1.3) + 22 * Math.sin(u * 5 + 0.4) + 9 * Math.sin(u * 13 + 2.2) + (fbm(x / 36, 0.5, 5, FAR_P / 36) - 0.5) * 40 - 30;
    ridge[x] = h;
    if (h > 0) b.rect(x, FAR_H - Math.round(h), 1, Math.round(h), body);
  }
  const pagoda = (px: number): void => {
    const base = FAR_H - Math.round(ridge[px]);
    const top = base - 48;
    for (let i = 0; i < 4; i++) {
      const y = top + 10 + i * 10;
      const hw = 12 + i * 4;
      b.poly([px - hw, y + 7, px + hw, y + 7, px + hw - 5, y, px - hw + 5, y], body);
      b.rect(px - 6 - i, y + 7, 12 + i * 2, 3, body);
    }
    b.rect(px - 1, top, 2, 10, body);
    b.rect(px - 8, top + 50, 16, base - top - 49, body);
  };
  pagoda(Math.round(FAR_P * 0.27));
  pagoda(Math.round(FAR_P * 0.74));
  for (let k = 0; k < 16; k++) {
    const px = Math.floor(hash2(k, 0, 33) * FAR_P);
    if (ridge[px] < 12) continue;
    const w = 10 + Math.floor(hash2(k, 1, 33) * 12);
    const base = FAR_H - Math.round(ridge[px]) + 4;
    b.rect(px - w / 2, base - 9, w, 12, body);
    b.poly([px - w / 2 - 3, base - 8, px + w / 2 + 3, base - 8, px + w / 2 - 2, base - 13, px - w / 2 + 2, base - 13], body);
  }
  rimTop(b, body, rim);
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(hash2(k, 5, 34) * FAR_P);
    const h = ridge[x];
    if (h < 18) continue;
    const y = FAR_H - Math.round(h) + 6 + Math.floor(hash2(k, 6, 34) * Math.min(30, h - 10));
    if (b.get(x, y) === body && b.get(x + 1, y + 1) === body) b.rect(x, y, 2, 2, K.window);
  }
  return b;
}

function getStatics(): Statics {
  if (statics) return statics;
  const sky = new Buf(64, SKY_H);
  sky.vgrad(0, SKY_H, K.sky);
  const skyF = new Buf(64, SKY_H);
  skyF.vgrad(0, SKY_H, K.skyF);
  statics = {
    sky: textureFromBuf(sky, 'port-sky'),
    skyF: textureFromBuf(skyF, 'port-skyF'),
    cloudFar: textureFromBuf(clouds(11, 768, 80, 0.5, K.cloud, null), 'port-cloud-far'),
    cloudNear: textureFromBuf(clouds(23, 768, 90, 0.55, K.cloud, K.cloudLit), 'port-cloud-near'),
    far: textureFromBuf(farLayer(K.far, K.farRim), 'port-far'),
    farF: textureFromBuf(farLayer(K.farF, K.farFRim), 'port-farF'),
    boatGlow: glowTexture(6, K.lantern.glow, 0.4, 'port-boat-glow'),
    eyeGlow: glowTexture(16, K.eyeGlow, 0.32, 'port-eye-glow'),
    rainA: textureFromBuf(rainTile(1, 26, K.rainFar), 'port-rain-a'),
    rainB: textureFromBuf(rainTile(3, 26, K.rainFar), 'port-rain-b'),
  };
  return statics;
}

const SEA = `
uniform float uY0;
uniform vec3 uSea0;
uniform vec3 uSea1;
uniform vec3 uSea2;
uniform vec3 uSea3;
uniform vec3 uFoam;
void main() {
  vec2 p = pixel();
  float y = p.y;
  if (y <= uY0) { finalColor = vec4(uSea3, 1.0); return; }
  float k = clamp((y - uY0) / 155.0, 0.0, 1.0);
  float fr = 0.11 - k * 0.07;
  float sp = 1.1 + k * 1.6;
  float par = 0.35 + k * 0.45;
  float wx = p.x + uCamX * par;
  float yy = y - uY0 + 205.0;
  float v = sin(wx * fr + uTime * sp + yy * 0.55) + 0.7 * sin(wx * fr * 0.37 - uTime * 0.9 + yy * 0.23) + 0.35 * sin(wx * 0.21 + yy * 1.7 - uTime * 2.0);
  vec3 c = v > 1.7 ? uFoam : v > 1.3 ? uSea3 : v > 0.55 ? uSea2 : ((1.0 - k) > bayer(p) ? uSea1 : uSea0);
  finalColor = vec4(c, 1.0);
}`;

// Umibozu dessiné au CPU (disques, ellipse, yeux) comme dans la planche, dans son propre calque.
const UW = 520;
const UH = 300;
const UCX = 260;
const UCY = 170;

class Umibozu {
  readonly canvas = new CpuSprite(UW, UH, 'umibozu');
  private readonly fx = new Particles();
  private lastSlam = -1;
  private lastDraw = -1;
  private lastFlash = false;
  private acc = 0;

  /** (hx, hy) : centre du corps à l'écran ; heroX : perso le plus proche, à l'écran. */
  draw(t: number, dt: number, hx: number, hy: number, flash: boolean, heroX: number): void {
    this.acc += dt;
    // Redessin à 30 Hz au plus (mouvement lent), immédiat au changement d'éclair.
    if (this.lastDraw >= 0 && this.acc < 1 / 30 && flash === this.lastFlash && Math.abs(t - this.lastDraw) < 0.5) {
      this.canvas.sprite.position.set(Math.round(hx - UCX), Math.round(hy - UCY));
      return;
    }
    const step = this.acc;
    this.acc = 0;
    this.lastDraw = t;
    this.lastFlash = flash;
    const buf = this.canvas.buf;
    buf.clear();
    const body = flash ? K.uF : K.uBody;
    const offs = [-104, -78, -52, 50, 76, 102];
    const tilt = [-0.8, -0.45, -0.15, 0.15, 0.45, 0.8];
    const segs: number[] = [];
    const baseY = UCY + 66;
    for (let i = 0; i < 6; i++) {
      let x = UCX + offs[i];
      let y = baseY;
      let a = -Math.PI / 2 + tilt[i];
      for (let s = 0; s < 22; s++) {
        a += (i < 3 ? -0.045 : 0.045) + 0.06 * fsin(t * 0.8 + i * 1.9 + s * 0.35);
        x += Math.cos(a) * 4.2;
        y += Math.sin(a) * 4.2;
        segs.push(x, y, 9 * (1 - s / 22) + 1.2, a, i < 3 ? 1 : -1);
      }
    }
    // Tentacule qui se lève puis frappe l'eau (cycle de 9 s).
    const q = (t % 9) / 9;
    if (q < 0.72) {
      const lift = q < 0.45 ? q / 0.45 : q < 0.62 ? 1 : 1 - ((q - 0.62) / 0.1) * 1.6;
      let x = UCX + 150;
      let y = UCY + 68;
      let a = -Math.PI / 2 - 0.2 - lift * 0.3;
      for (let s = 0; s < 26; s++) {
        a += -0.04 * lift + 0.08 * fsin(t * 1.6 + s * 0.4) + (1 - lift) * 0.09;
        x += Math.cos(a) * 4.4;
        y += Math.sin(a) * 4.4;
        segs.push(x, y, 8 * (1 - s / 26) + 1.4, a, -1);
      }
    }
    if (q >= 0.7 && this.lastSlam !== Math.floor(t / 9)) {
      this.lastSlam = Math.floor(t / 9);
      for (let k = 0; k < 46; k++) {
        this.fx.spawn(UCX + 60 + Math.random() * 60, UCY + 56, (Math.random() - 0.5) * 120, -80 - Math.random() * 140, 1.1, [K.foamHi, K.foam, K.sea[3]], 260, 0.4);
      }
    }
    for (let i = 0; i < segs.length; i += 5) buf.disc(segs[i] - 1, segs[i + 1] - 1, segs[i + 2], K.uRim);
    buf.ellipse(UCX - 1, UCY - 1, 64, 56, K.uRim);
    for (let i = 0; i < segs.length; i += 5) buf.disc(segs[i], segs[i + 1], segs[i + 2], body);
    buf.ellipse(UCX, UCY, 64, 56, body);
    if (!flash) {
      for (let k = 0; k < 18; k++) {
        const sx = UCX + (hash2(k, 0, 3) - 0.5) * 90;
        const sy = UCY - 40 + hash2(k, 1, 3) * 40;
        buf.disc(sx, sy, 1 + hash2(k, 2, 3) * 2.5, K.uSpot);
      }
    }
    for (let i = 0; i < segs.length; i += 10) {
      const a = segs[i + 3];
      const side = segs[i + 4];
      const r = segs[i + 2];
      buf.px(segs[i] + Math.cos(a + (side * Math.PI) / 2) * r * 0.6, segs[i + 1] + Math.sin(a + (side * Math.PI) / 2) * r * 0.6, K.sucker);
    }
    const blink = t % 5.1 < 0.14;
    const look = Math.max(-3, Math.min(3, (heroX - hx) / 60));
    for (const s of [-1, 1]) {
      const ex = UCX + s * 22;
      const ey = UCY - 6;
      buf.glow(ex, ey, 16, K.eyeGlow, 0.32);
      if (blink) buf.hline(ex - 6, ex + 6, ey, K.eye);
      else {
        buf.ellipse(ex, ey, 6, 4, K.eye);
        buf.rect(ex + look - 0.5, ey - 3, 2, 7, K.uBody);
      }
    }
    this.fx.update(step);
    this.fx.draw(buf);
    this.canvas.commit(hx - UCX, hy - UCY);
  }
}

export function createPortRuntime(): ThemeRuntime {
  const S = getStatics();
  const back = new Container();
  const mid = new Container();
  const front = new Container();

  const skyTop = new Graphics();
  const sky = new WrapStrip(S.sky);
  const cloudFar = new WrapStrip(S.cloudFar);
  const bolt = new PixelBatch();
  const cloudNear = new WrapStrip(S.cloudNear);
  const far = new WrapStrip(S.far);
  const ambient = new PixelBatch();
  const rainFarA = new TilingSprite({ texture: S.rainA, width: 16, height: 16 });
  const rainFarB = new TilingSprite({ texture: S.rainB, width: 16, height: 16 });
  const glows = new Container();
  const glowSprites: Sprite[] = [];
  const umi = new Umibozu();
  const sea = new SurfaceQuad(
    SEA,
    {
      uY0: { value: 0, type: 'f32' },
      uSea0: { value: vec3Of(K.sea[0]), type: 'vec3<f32>' },
      uSea1: { value: vec3Of(K.sea[1]), type: 'vec3<f32>' },
      uSea2: { value: vec3Of(K.sea[2]), type: 'vec3<f32>' },
      uSea3: { value: vec3Of(K.sea[3]), type: 'vec3<f32>' },
      uFoam: { value: vec3Of(K.foam), type: 'vec3<f32>' },
    },
    'port-sea',
  );
  const foam = new PixelBatch();
  back.addChild(skyTop, sky.view, cloudFar.view, bolt.g, cloudNear.view, far.view, ambient.g, glows, rainFarA, rainFarB, umi.canvas.sprite, sea.mesh, foam.g);

  const rain = new PixelBatch();
  front.addChild(rain.g);

  const glow = (i: number): Sprite => {
    let s = glowSprites[i];
    if (!s) {
      s = new Sprite(S.boatGlow);
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
      const { t, camX, camY, viewW, viewH } = f;
      const ph = t % 7.3;
      const flash = ph < 0.09 || (ph > 0.17 && ph < 0.24);
      const hz = Math.round(parallaxY(f, horizonY(f.shape), 0.2));
      const gradTop = hz + 7 - SKY_H;

      skyTop.clear();
      if (gradTop > 0) skyTop.rect(0, 0, viewW, gradTop).fill(flash ? 0x1b2740 : 0x070b16);
      sky.setTexture(flash ? S.skyF : S.sky);
      sky.place(0, gradTop, viewW);
      cloudFar.place(-t * 4 - camX * 0.05, gradTop + 6, viewW);
      cloudNear.place(-t * 10 - camX * 0.12, gradTop + 54, viewW);
      far.setTexture(flash ? S.farF : S.far);
      far.place(-camX * 0.2, hz + 5 - FAR_H, viewW);

      bolt.clear();
      if (flash) {
        const s = Math.floor(t / 7.3);
        let x = 500 - camX * 0.2 + hash2(s, 0, 5) * 80;
        x = ((x % (viewW + 200)) + viewW + 200) % (viewW + 200) - 100;
        let y = gradTop - 30;
        while (y < gradTop + 180) {
          const nx = x + (hash2(s, Math.round(y), 6) - 0.5) * 16;
          const ny = y + 7 + hash2(s, Math.round(y), 7) * 8;
          bolt.line(x, y, nx, ny, BOLT_A);
          bolt.line(x + 1, y, nx + 1, ny, BOLT_B);
          if (hash2(s, Math.round(y), 8) > 0.8) bolt.line(nx, ny, nx + 14, ny + 12, BOLT_B);
          x = nx;
          y = ny;
        }
      }
      bolt.flush();

      // Mouettes, jonques et leurs fanaux, pluie lointaine.
      ambient.clear();
      for (let i = 0; i < 4; i++) {
        const x = ((((i * 230 - t * (16 + i * 3) - camX * 0.45) % (viewW + 160)) + viewW + 160) % (viewW + 160)) - 80;
        const y = gradTop + 80 + i * 24 + fsin(t * 0.9 + i) * 6;
        const up = fsin(t * 8 + i * 2) > 0;
        ambient.px(x, y, K.gull);
        if (up) {
          ambient.line(x - 4, y - 2, x - 1, y, K.gull);
          ambient.line(x + 1, y, x + 4, y - 2, K.gull);
        } else {
          ambient.line(x - 4, y + 1, x - 1, y, K.gull);
          ambient.line(x + 1, y, x + 4, y + 1, K.gull);
        }
      }
      let gi = 0;
      const boatPeriod = Math.max(750, Math.ceil(viewW / 150) * 150 + 150);
      for (let i = 0; i < boatPeriod / 150; i++) {
        const x = ((((60 + i * 150 + hash2(i % 5, 0, 2) * 40 - camX * 0.3) % boatPeriod) + boatPeriod) % boatPeriod) - 60;
        const y = hz - 5 + fsin(t * 1.3 + i * 2) * 1.2;
        ambient.poly([x - 10, y, x + 10, y, x + 7, y + 3, x - 7, y + 3], K.boat);
        ambient.line(x, y, x, y - 13, K.boat);
        ambient.rect(x + 1, y - 12, 7, 10, K.sail);
        for (let j = y - 10; j < y - 2; j += 3) ambient.hline(x + 1, x + 7, j, K.sailLine);
        const g = glow(gi++);
        g.position.set(Math.round(x - 8) - 6, Math.round(y - 2) - 6);
        ambient.px(x - 8, y - 2, K.lantern.core);
      }
      for (let i = gi; i < glowSprites.length; i++) glowSprites[i].visible = false;
      const area = (viewW * viewH) / (640 * 360);
      // Pluie lointaine : deux motifs périodiques qui défilent (vitesses 165 et 205 px/s, pente 0,35).
      for (const [layer, v] of [[rainFarA, 165], [rainFarB, 205]] as const) {
        layer.width = viewW;
        layer.height = viewH;
        layer.tilePosition.set(Math.round(-t * v * 0.35 - camX * 0.5), Math.round(t * v - camY * 0.5));
      }
      ambient.flush();

      // Umibozu : une apparition tous les 1400 px de parallaxe, celle qui est la plus proche.
      const span = 1400;
      const base = camX * 0.3 + viewW / 2;
      const inst = Math.round((base - 700) / span);
      const hx = inst * span + 700 - camX * 0.3;
      const hy = hz - 55 + fsin(t * 0.5) * 3;
      let heroX = viewW / 2;
      let best = Infinity;
      for (const h of f.heroes) {
        const sx = h.x - camX;
        if (Math.abs(sx - hx) < best) {
          best = Math.abs(sx - hx);
          heroX = sx;
        }
      }
      const umiVisible = hx > -UW && hx < viewW + UW;
      umi.canvas.sprite.visible = umiVisible;
      if (umiVisible) umi.draw(t, f.dt, hx, hy, flash, heroX);

      sea.u.uY0 = hz;
      sea.place(0, hz, viewW, viewH - hz, t, camX);

      foam.clear();
      if (umiVisible) {
        for (let i = 0; i < 30; i++) {
          const x = hx + (i - 15) * 7 + fsin(t * 1.7 + i * 2.3) * 5;
          const r = (fsin(t * 2.6 + i * 1.7) + 1) * 1.3;
          if (r > 0.6) foam.hline(x - r * 2, x + r * 2, hz + 2 + Math.round(fsin(i * 2.1) * 1.5), K.foam);
        }
      }
      foam.flush();

      // Devant : pluie proche (s'écarte de 24 px autour de chaque perso), éclaboussures, gouttes.
      rain.clear();
      const avoid = f.heroes.map((h) => ({ x: h.x - camX, y: h.y - camY - 4 }));
      drawRain(rain, t, Math.round(70 * area), 6, 280, K.rainNear, 2, camX * 1.3, camY * 1.3, viewW, viewH, avoid);
      drawSplashes(rain, f);
      rain.flush();
    },
    destroy(): void {
      umi.canvas.destroy();
      back.destroy({ children: true });
      mid.destroy({ children: true });
      front.destroy({ children: true });
    },
  };
}

/** Pluie sans état (KIT.rain des planches), ancrée au monde avec une parallaxe. */
function drawRain(
  out: PixelBatch,
  t: number,
  n: number,
  len: number,
  speed: number,
  color: Color,
  seed: number,
  offX: number,
  offY: number,
  W: number,
  H: number,
  avoid: { x: number; y: number }[] | null,
  slant = 0.35,
): void {
  const pw = W + 80;
  const ph = H + 60;
  for (let i = 0; i < n; i++) {
    const x0 = hash2(i, 1, seed) * pw;
    const y0 = hash2(i, 2, seed) * ph;
    const v = speed * (0.8 + hash2(i, 3, seed) * 0.4);
    const y = ((((y0 + t * v - offY) % ph) + ph) % ph) - 30;
    const x = ((((x0 - t * v * slant - offX) % pw) + pw) % pw) - 40;
    if (avoid) {
      let skip = false;
      for (const a of avoid) if ((x - a.x) * (x - a.x) + (y - a.y) * (y - a.y) < 24 * 24) skip = true;
      if (skip) continue;
    }
    for (let k = 0; k < len; k++) out.px(x - k * slant, y - k, color);
  }
}

/** Éclaboussures de pluie sur les dessus à l'air libre, gouttes sous les poutres. */
function drawSplashes(out: PixelBatch, f: ThemeFrame): void {
  const { shape, t, camX, camY, viewW, viewH } = f;
  const x0 = camX;
  const x1 = camX + viewW;
  for (let ri = 0; ri < shape.tops.length; ri++) {
    const run = shape.tops[ri];
    if (run.y > shape.floorRow) continue;
    const rx0 = run.x0 * ART_TILE;
    const rx1 = (run.x1 + 1) * ART_TILE;
    if (rx1 < x0 || rx0 > x1) continue;
    const y = run.y * ART_TILE - camY;
    if (y < -4 || y > viewH + 4) continue;
    const slots = Math.max(1, Math.round((rx1 - rx0) / 40));
    for (let i = 0; i < slots; i++) {
      const phase = (t * 1.4 + hash2(ri, i, 7)) % 1;
      if (phase > 0.14) continue;
      const cycle = Math.floor(t * 1.4 + hash2(ri, i, 7));
      const x = rx0 + hash2(ri * 131 + i, cycle, 8) * (rx1 - rx0) - camX;
      out.px(x - 1, y - 2, K.rainNear);
      out.px(x + 1, y - 2, K.rainNear);
      out.px(x, y - 1, K.foamHi);
    }
  }
  for (let ri = 0; ri < shape.bottoms.length; ri++) {
    const run = shape.bottoms[ri];
    if (run.y >= shape.floorRow || run.type !== T_SOLID) continue;
    const rx0 = run.x0 * ART_TILE;
    const rx1 = (run.x1 + 1) * ART_TILE;
    if (rx1 < x0 || rx0 > x1) continue;
    const yTop = (run.y + 1) * ART_TILE;
    for (let i = 0; i < Math.max(1, Math.round((rx1 - rx0) / 26)); i++) {
      const dx = rx0 + 4 + Math.floor(hash2(ri, i, 11) * (rx1 - rx0 - 8));
      // Chute bornée par le premier plein en dessous.
      let fall = 190;
      for (let k = 1; k < 13; k++) {
        if (solidAt(shape, Math.floor(dx / ART_TILE), run.y + k)) {
          fall = Math.min(fall, (k - 1) * ART_TILE);
          break;
        }
      }
      const ph = (t * 0.8 + hash2(ri, i, 12)) % 1;
      const y = yTop + ph * fall - camY;
      if (y < 0 || y > viewH) continue;
      out.px(dx - camX, y, K.rainNear);
    }
  }
}
