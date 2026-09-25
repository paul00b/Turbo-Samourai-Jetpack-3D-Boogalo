/**
 * Une vue pixel (une par viewport). La scène est rendue dans une RenderTexture à la résolution de
 * l'art (1 texel = 1 px d'art = 2 px monde), caméra calée au pixel d'art comme dans les planches,
 * puis le PixelQuad l'agrandit à l'écran avec le reste sous-pixel de la caméra.
 *
 * Ordre des couches (du fond vers l'avant) :
 *   fond du thème -> décor arrière cuit -> accessoires arrière -> tuiles -> milieu du thème (brumes)
 *   -> dangers -> traînée -> ennemis -> halo -> cordes -> joueurs -> particules -> décor avant
 *   -> premier plan du thème (pluie, braises : s'écarte du perso).
 */
import { Container, Graphics, RenderTexture, Sprite, type Renderer as PixiRenderer } from 'pixi.js';
import { HOOK_ATTACHED, HOOK_FLYING, type GameState } from '../../sim';
import type { Viewport } from '../camera';
import type { PlayerPose } from '../interpolate';
import type { TrailBuffer } from '../trail';
import { Particles, toHex } from '../pixel/engine';
import type { ArtWorld } from './artWorld';
import { ENEMY_FOOT_X, ENEMY_FOOT_Y } from './enemySheet';
import { ART_SCALE } from './levelShape';
import { PLAYER_HEX } from './palette';
import { PixelQuad } from './pixelQuad';
import type { Chunk } from './textures';
import type { ThemeModule, ThemeRuntime } from './themes/runtime';
import type { ThemeFrame } from './themes/types';

export type ArtMode = 'art' | 'values' | 'play';

export interface ArtViewOptions {
  mode: ArtMode;
  showTrail: boolean;
  time: number;
}

const HEMP = 0xd9cfb4;
const METAL = 0x9aa3b2;
const MAX_RT = 4096;

function roundUp(v: number, step: number): number {
  return Math.ceil(v / step) * step;
}

export class ArtView {
  /** Ce que le Renderer place dans le viewport (le quad agrandi). */
  readonly display = new Container();
  private rt: RenderTexture;
  private rtW = 0;
  private rtH = 0;
  private readonly quad: PixelQuad;
  private readonly root = new Container();
  private readonly worldBack = new Container();
  private readonly worldFront = new Container();
  private readonly backChunks = new Container();
  private readonly propsBack = new Container();
  private readonly tileChunks = new Container();
  private readonly hazardChunks = new Container();
  private readonly trail = new Graphics();
  private readonly enemies = new Container();
  private readonly halos = new Container();
  private readonly ropes = new Graphics();
  private readonly heroes = new Container();
  private readonly particles = new Graphics();
  private readonly frontChunks = new Container();
  private readonly propsFront = new Container();
  private readonly overlay = new Graphics();
  private runtime: ThemeRuntime | null = null;
  private runtimeTheme: ThemeModule | null = null;
  private version = -1;
  private chunkSprites: { sprite: Sprite; chunk: Chunk }[] = [];
  private readonly enemySprites: Sprite[] = [];
  private readonly propSprites: { back: Sprite[]; front: Sprite[] } = { back: [], front: [] };
  private readonly heroSprites: Sprite[] = [];
  private readonly haloSprites: Sprite[] = [];
  /** Coin haut-gauche de la vue en px d'art monde (dernière frame). */
  camX = 0;
  camY = 0;
  scale = 1;

  /** Zoom en dessous duquel la vue dépasserait la taille max d'une texture. */
  static minZoom(vp: Viewport): number {
    return Math.max(vp.w, vp.h) / ((MAX_RT - 4) * ART_SCALE);
  }

  constructor() {
    this.rt = RenderTexture.create({ width: 64, height: 64, resolution: 1, scaleMode: 'linear', antialias: false });
    this.quad = new PixelQuad(this.rt);
    this.display.addChild(this.quad.mesh);
    this.worldBack.addChild(this.backChunks, this.propsBack, this.tileChunks);
    this.worldFront.addChild(this.hazardChunks, this.trail, this.enemies, this.halos, this.ropes, this.heroes, this.particles, this.frontChunks, this.propsFront, this.overlay);
  }

  private ensureRuntime(theme: ThemeModule): void {
    if (this.runtimeTheme === theme && this.runtime) return;
    if (this.runtime) {
      this.root.removeChildren();
      this.runtime.destroy();
    }
    this.runtime = theme.createRuntime();
    this.runtimeTheme = theme;
    this.root.removeChildren();
    this.root.addChild(this.runtime.back, this.worldBack, this.runtime.mid, this.worldFront, this.runtime.front);
  }

  private rebuild(world: ArtWorld): void {
    this.version = world.version;
    for (const c of [this.backChunks, this.tileChunks, this.hazardChunks, this.frontChunks]) c.removeChildren();
    this.chunkSprites = [];
    const art = world.art;
    if (!art) return;
    const add = (list: readonly Chunk[], into: Container): void => {
      for (const chunk of list) {
        const sprite = new Sprite(chunk.texture);
        sprite.position.set(chunk.x, chunk.y);
        into.addChild(sprite);
        this.chunkSprites.push({ sprite, chunk });
      }
    };
    add(art.back, this.backChunks);
    add(art.tiles, this.tileChunks);
    add(art.hazards, this.hazardChunks);
    add(art.front, this.frontChunks);
  }

  private ensureTarget(w: number, h: number): void {
    if (w <= this.rtW && h <= this.rtH) return;
    const nw = Math.min(MAX_RT, roundUp(Math.max(w, this.rtW), 128));
    const nh = Math.min(MAX_RT, roundUp(Math.max(h, this.rtH), 128));
    this.rt.resize(nw, nh);
    this.rtW = nw;
    this.rtH = nh;
  }

  /**
   * Dessine la vue. `camX/camY` : centre de la caméra en px monde, `zoom` : px CSS par px monde.
   */
  render(
    pixi: PixiRenderer,
    world: ArtWorld,
    cam: { x: number; y: number; zoom: number },
    vp: Viewport,
    state: GameState,
    poses: readonly PlayerPose[],
    trails: readonly TrailBuffer[],
    opts: ArtViewOptions,
    ambientDt: number,
  ): void {
    const theme = world.theme;
    const shape = world.shape;
    if (!theme || !shape) return;
    this.ensureRuntime(theme);
    if (this.version !== world.version) this.rebuild(world);

    // Caméra en px d'art, calée à l'entier ; le reste sous-pixel passe au quad.
    let s = cam.zoom * ART_SCALE;
    const minS = Math.max(vp.w, vp.h) / (MAX_RT - 4);
    if (s < minS) s = minS;
    this.scale = s;
    const viewW = vp.w / s;
    const viewH = vp.h / s;
    const L = cam.x / ART_SCALE - viewW / 2;
    const T = cam.y / ART_SCALE - viewH / 2;
    const L0 = Math.floor(L);
    const T0 = Math.floor(T);
    const fx = L - L0;
    const fy = T - T0;
    const usedW = Math.min(MAX_RT, Math.ceil(viewW + fx) + 1);
    const usedH = Math.min(MAX_RT, Math.ceil(viewH + fy) + 1);
    this.ensureTarget(usedW, usedH);
    this.camX = L0;
    this.camY = T0;
    this.worldBack.position.set(-L0, -T0);
    this.worldFront.position.set(-L0, -T0);

    const play = opts.mode === 'play';
    const rt = this.runtime as ThemeRuntime;
    rt.back.visible = !play;
    rt.mid.visible = !play;
    rt.front.visible = !play;
    this.backChunks.visible = !play;
    this.propsBack.visible = !play;
    this.frontChunks.visible = !play;
    this.propsFront.visible = !play;

    const heroesArt: { x: number; y: number }[] = [];
    for (let i = 0; i < state.playerCount; i++) heroesArt.push({ x: poses[i].x / ART_SCALE, y: poses[i].y / ART_SCALE });
    // Parallaxe verticale : référence = la vue centrée sur le spawn.
    const homeY = Math.max(0, Math.min(Math.max(0, shape.ph - viewH), shape.level.spawnY / ART_SCALE - viewH / 2));
    const frame: ThemeFrame = {
      t: world.ambient,
      dt: ambientDt,
      camX: L0,
      camY: T0,
      viewW: usedW,
      viewH: usedH,
      homeY: Math.floor(homeY),
      shape,
      heroes: heroesArt,
      mode: opts.mode,
    };
    if (!play) rt.update(frame);

    this.cullChunks(L0, T0, usedW, usedH);
    if (!play) this.updateProps(world, L0, T0, usedW, usedH);
    this.drawTrails(state, trails, opts);
    this.updateEnemies(world, state, heroesArt);
    this.updateHeroes(world, state);
    this.drawRopes(world, state, poses);
    this.drawParticles(world.parts, L0, T0, usedW, usedH);
    this.drawOverlay(state, poses, opts);

    pixi.render({
      container: this.root,
      target: this.rt,
      clear: true,
      clearColor: play ? theme.painter.flat : 0x000000,
    });
    this.quad.set(this.rt, this.rtW, this.rtH, usedW, usedH, vp.x - fx * s, vp.y - fy * s, s, opts.mode === 'values');
  }

  private cullChunks(x: number, y: number, w: number, h: number): void {
    for (const { sprite, chunk } of this.chunkSprites) {
      sprite.visible = chunk.x < x + w && chunk.x + chunk.w > x && chunk.y < y + h && chunk.y + chunk.h > y;
    }
  }

  private updateProps(world: ArtWorld, x: number, y: number, w: number, h: number): void {
    const art = world.art;
    if (!art) return;
    const used = { back: 0, front: 0 };
    const props = art.props;
    const margin = 48;
    // Recherche dichotomique du premier accessoire visible (tri par x).
    let lo = 0;
    let hi = props.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (props[mid].x < x - margin) lo = mid + 1;
      else hi = mid;
    }
    const t = world.ambient;
    for (let i = lo; i < props.length; i++) {
      const p = props[i];
      if (p.x > x + w + margin) break;
      if (p.y < y - margin * 2 || p.y > y + h + margin * 2) continue;
      const anim = world.propTextures(p.kind);
      if (!anim || anim.frames.length === 0) continue;
      const pool = this.propSprites[p.layer];
      const into = p.layer === 'back' ? this.propsBack : this.propsFront;
      let sp = pool[used[p.layer]];
      if (!sp) {
        sp = new Sprite(anim.frames[0]);
        pool.push(sp);
        into.addChild(sp);
      }
      used[p.layer]++;
      const fi = Math.floor((t + p.phase) * anim.fps) % anim.frames.length;
      sp.texture = anim.frames[(fi + anim.frames.length) % anim.frames.length];
      sp.position.set(Math.round(p.x - anim.ax), Math.round(p.y - anim.ay));
      sp.visible = true;
    }
    for (const layer of ['back', 'front'] as const) {
      const pool = this.propSprites[layer];
      for (let i = used[layer]; i < pool.length; i++) pool[i].visible = false;
    }
  }

  private drawTrails(state: GameState, trails: readonly TrailBuffer[], opts: ArtViewOptions): void {
    const g = this.trail;
    g.clear();
    if (!opts.showTrail) return;
    for (let i = 0; i < state.playerCount; i++) {
      const tr = trails[i];
      if (!tr || tr.length < 2) continue;
      const n = tr.length;
      const slices = 6;
      for (let sI = 0; sI < slices; sI++) {
        const from = Math.floor((n - 1) * (sI / slices));
        const to = Math.floor((n - 1) * ((sI + 1) / slices));
        if (to <= from) continue;
        g.moveTo(Math.round(tr.x(from) / ART_SCALE) + 0.5, Math.round(tr.y(from) / ART_SCALE) + 0.5);
        for (let k = from + 1; k <= to; k++) g.lineTo(Math.round(tr.x(k) / ART_SCALE) + 0.5, Math.round(tr.y(k) / ART_SCALE) + 0.5);
        g.stroke({ width: 1, color: PLAYER_HEX[i], alpha: 0.06 + 0.3 * ((sI + 1) / slices) });
      }
    }
  }

  private updateEnemies(world: ArtWorld, state: GameState, heroes: readonly { x: number; y: number }[]): void {
    let used = 0;
    const t = world.gameTime;
    if (state.params.enemiesEnabled) {
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        let alpha = 1;
        if (!e.alive) {
          // Illimités : le retour se devine, une silhouette pâle dans la dernière seconde.
          if (e.respawnTimer <= 0 || e.respawnTimer > 60) continue;
          alpha = 0.18 + 0.5 * (1 - e.respawnTimer / 60);
        }
        const ex = (e.alive ? e.x : e.spawnX) / ART_SCALE;
        const feet = ((e.alive ? e.y : e.spawnY) + e.h / 2) / ART_SCALE;
        const walking = e.patrol === 1 && e.alive === 1;
        let flip: boolean;
        if (walking) flip = e.dir < 0;
        else {
          let best = Infinity;
          flip = false;
          for (const h of heroes) {
            const d = Math.abs(h.x - ex);
            if (d < best) {
              best = d;
              flip = h.x < ex;
            }
          }
        }
        const phase = walking ? t * 10 + i * 1.7 : Math.sin(t * 2.2 + i) > 0.6 ? 1 : 0;
        const sway = Math.sin(t * 2 + i * 0.9) * 1.2;
        const tex = world.enemyFrames[world.enemySheet.frame(walking, phase, sway, flip)];
        let sp = this.enemySprites[used];
        if (!sp) {
          sp = new Sprite(tex);
          this.enemySprites.push(sp);
          this.enemies.addChild(sp);
        }
        used++;
        sp.texture = tex;
        sp.alpha = alpha;
        sp.visible = true;
        sp.position.set(Math.round(ex) - ENEMY_FOOT_X, Math.round(feet) - ENEMY_FOOT_Y);
      }
    }
    for (let i = used; i < this.enemySprites.length; i++) this.enemySprites[i].visible = false;
  }

  private updateHeroes(world: ArtWorld, state: GameState): void {
    for (let i = 0; i < 2; i++) {
      let sp = this.heroSprites[i];
      if (!sp) {
        sp = new Sprite(world.heroTex[i]);
        this.heroSprites.push(sp);
        this.heroes.addChild(sp);
      }
      let halo = this.haloSprites[i];
      if (!halo) {
        halo = new Sprite();
        this.haloSprites.push(halo);
        this.halos.addChild(halo);
      }
      const active = i < state.playerCount;
      sp.visible = active;
      const hero = world.heroes[i];
      if (active) sp.position.set(hero.drawX, hero.drawY);
      const haloTex = world.haloTex;
      halo.visible = active && haloTex !== null;
      if (haloTex && active) {
        if (halo.texture !== haloTex) halo.texture = haloTex;
        halo.position.set(Math.round(hero.cx) - 26, Math.round(hero.cy + hero.offY) - 4 - 26);
      }
    }
  }

  private drawRopes(world: ArtWorld, state: GameState, poses: readonly PlayerPose[]): void {
    const g = this.ropes;
    g.clear();
    const blink = Math.sin(world.gameTime * 6) > 0.5;
    for (let i = 0; i < state.playerCount; i++) {
      const pl = state.players[i];
      const hero = world.heroes[i];
      for (let h = 0; h < 2; h++) {
        const hk = pl.hooks[h];
        if (hk.state !== HOOK_FLYING && hk.state !== HOOK_ATTACHED) continue;
        const [hx, hy] = hero.handFor(h);
        let ax: number;
        let ay: number;
        if (hk.state === HOOK_FLYING) {
          ax = poses[i].hookX[h] / ART_SCALE;
          ay = poses[i].hookY[h] / ART_SCALE;
        } else if (hk.target >= 0) {
          ax = poses[hk.target].x / ART_SCALE;
          ay = poses[hk.target].y / ART_SCALE;
        } else {
          ax = hk.x / ART_SCALE;
          ay = hk.y / ART_SCALE;
        }
        const reeling = hk.state === HOOK_ATTACHED && hk.reeling === 1;
        const color = reeling ? PLAYER_HEX[i] : HEMP;
        const x0 = Math.round(hx) + 0.5;
        const y0 = Math.round(hy) + 0.5;
        const x1 = Math.round(ax) + 0.5;
        const y1 = Math.round(ay) + 0.5;
        let slack = 0;
        if (hk.state === HOOK_ATTACHED) {
          const anchorX = hk.target >= 0 ? poses[hk.target].x : hk.x;
          const anchorY = hk.target >= 0 ? poses[hk.target].y : hk.y;
          slack = Math.max(0, hk.length - Math.hypot(poses[i].x - anchorX, poses[i].y - anchorY)) / ART_SCALE;
        }
        g.moveTo(x0, y0);
        if (slack > 1.5) {
          for (let k = 1; k <= 16; k++) {
            const u = k / 16;
            g.lineTo(Math.round(x0 + (x1 - x0) * u) + 0, Math.round(y0 + (y1 - y0) * u + slack * 0.6 * 4 * u * (1 - u)) + 0.5);
          }
        } else g.lineTo(x1, y1);
        g.stroke({ width: 1, color, alpha: 1, cap: 'square' });
        // Tête du grappin : croix de métal, point blanc qui clignote (fixe en vol).
        const px = Math.round(ax);
        const py = Math.round(ay);
        g.rect(px - 1, py, 1, 1).rect(px + 1, py, 1, 1).rect(px, py - 1, 1, 1).rect(px, py + 1, 1, 1).fill(METAL);
        if (blink || hk.state === HOOK_FLYING) g.rect(px, py, 1, 1).fill(0xffffff);
      }
    }
  }

  private drawParticles(parts: Particles, x: number, y: number, w: number, h: number): void {
    const g = this.particles;
    g.clear();
    for (const p of parts.list) {
      if (p.x < x - 4 || p.y < y - 4 || p.x > x + w + 4 || p.y > y + h + 4) continue;
      const c = Particles.colorOf(p);
      g.rect(Math.round(p.x), Math.round(p.y), p.size, p.size).fill(toHex(c));
    }
  }

  /** Aides de jeu dessinées en pixels : fenêtre de cut manuel. */
  private drawOverlay(state: GameState, poses: readonly PlayerPose[], opts: ArtViewOptions): void {
    const g = this.overlay;
    g.clear();
    for (let i = 0; i < state.playerCount; i++) {
      const pl = state.players[i];
      if (pl.pendingCutEnemy < 0) continue;
      const pulse = 1 + 0.15 * Math.sin(opts.time * 40);
      const r = Math.round(((state.params.playerRadius + 12) * pulse) / ART_SCALE);
      g.circle(Math.round(poses[i].x / ART_SCALE) + 0.5, Math.round(poses[i].y / ART_SCALE) + 0.5, r).stroke({ width: 1, color: 0xffe14d });
    }
  }

  destroy(): void {
    this.runtime?.destroy();
    this.rt.destroy(true);
    this.display.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}

