/**
 * Ce que les vues pixel partagent : l'art cuit du niveau (tuiles de texture), les pantins des
 * joueurs, les particules, la planche de l'ashigaru. Une seule instance par Renderer ; en écran
 * splitté, les deux vues lisent le même monde (le même perso, la même écharpe).
 */
import { Texture } from 'pixi.js';
import { HOOK_ATTACHED, HOOK_FLYING, TILE_SIZE, isSolidTile, tileAt, type GameState, type Level, type SimEvent } from '../../sim';
import { Buf, C, Particles, type Color } from '../pixel/engine';
import type { PlayerPose } from '../interpolate';
import { buildEnemySheet, ENEMY_FH, ENEMY_FW } from './enemySheet';
import { HeroPuppet, HOOK_VIEW_ATTACHED, HOOK_VIEW_FLYING, HOOK_VIEW_IDLE, makeHeroInput } from './hero';
import { analyzeLevel, ART_SCALE, type LevelShape } from './levelShape';
import { DULL, ENEMY_BITS, SMOKE, SPARK } from './palette';
import { chunkTextures, destroyChunks, refreshTexture, subTexture, textureFromBuf, type Chunk } from './textures';
import type { ThemeModule } from './themes/runtime';
import type { PropInstance } from './themes/types';

export interface PropTextures {
  frames: Texture[];
  fps: number;
  ax: number;
  ay: number;
}

export interface LevelArt {
  back: Chunk[];
  tiles: Chunk[];
  hazards: Chunk[];
  front: Chunk[];
  /** Accessoires animés, triés par x (recherche de la tranche visible). */
  props: PropInstance[];
}

const GOLD: readonly Color[] = [C('#fff3c4'), C('#f0bf55'), C('#b88a36')];
const WHITE: readonly Color[] = [C('#ffffff'), C('#dfe9f2')];

export class ArtWorld {
  level: Level | null = null;
  shape: LevelShape | null = null;
  theme: ThemeModule | null = null;
  art: LevelArt | null = null;
  /** Incrémenté à chaque nouvelle cuisson : les vues reconstruisent leurs sprites. */
  version = 0;
  readonly heroes = [new HeroPuppet(0), new HeroPuppet(1)];
  readonly heroTex: Texture[];
  private readonly heroInputs = [makeHeroInput(), makeHeroInput()];
  readonly parts = new Particles();
  readonly enemyFrames: Texture[] = [];
  readonly enemySheet = buildEnemySheet();
  private propTex = new Map<string, PropTextures>();
  private propTheme: ThemeModule | null = null;
  haloTex: Texture | null = null;
  private haloColor: Color | null = null;
  /** Temps ambiant (tourne aussi en pause) et temps de jeu (figé en pause). */
  ambient = 0;
  gameTime = 0;
  /** Durée de la dernière cuisson (ms), pour le panneau. */
  bakeMs = 0;

  constructor() {
    this.heroTex = this.heroes.map((h, i) => textureFromBuf(h.out, `hero-${i}`));
    const sheetTex = textureFromBuf(this.enemySheet.atlas, 'enemy-sheet');
    for (let i = 0; i < this.enemySheet.count; i++) {
      const cx = (i % this.enemySheet.cols) * ENEMY_FW;
      const cy = Math.floor(i / this.enemySheet.cols) * ENEMY_FH;
      this.enemyFrames.push(subTexture(sheetTex, cx, cy, ENEMY_FW, ENEMY_FH));
    }
  }

  /** (Re)cuit l'art si la carte ou le thème a changé. */
  setScene(level: Level, theme: ThemeModule): void {
    if (level === this.level && theme === this.theme && this.art) return;
    const t0 = performance.now();
    this.level = level;
    this.theme = theme;
    const shape = analyzeLevel(level);
    this.shape = shape;
    const back = new Buf(shape.pw, shape.ph);
    const tiles = new Buf(shape.pw, shape.ph);
    const hazards = new Buf(shape.pw, shape.ph);
    let front: Buf | null = null;
    const props = theme.painter.paint(shape, {
      back,
      tiles,
      hazards,
      front: () => (front ??= new Buf(shape.pw, shape.ph)),
    });
    props.sort((a, b) => a.x - b.x);
    if (this.art) this.disposeArt(this.art);
    const frontBuf = front as Buf | null;
    this.art = {
      back: chunkTextures(back, 'lvl-back'),
      tiles: chunkTextures(tiles, 'lvl-tiles'),
      hazards: chunkTextures(hazards, 'lvl-hazards'),
      front: frontBuf ? chunkTextures(frontBuf, 'lvl-front') : [],
      props,
    };
    if (this.propTheme !== theme) {
      for (const p of this.propTex.values()) for (const f of p.frames) f.destroy(true);
      this.propTex.clear();
      for (const [kind, anim] of Object.entries(theme.painter.props())) {
        this.propTex.set(kind, { frames: anim.frames.map((b, i) => textureFromBuf(b, `${kind}-${i}`)), fps: anim.fps, ax: anim.ax, ay: anim.ay });
      }
      this.propTheme = theme;
    }
    const halo = theme.painter.halo;
    if (halo !== this.haloColor) {
      this.haloTex?.destroy(true);
      this.haloTex = null;
      if (halo !== null) {
        const b = new Buf(53, 53);
        b.glowA(26, 26, 26, halo, 0.3);
        this.haloTex = textureFromBuf(b, 'hero-halo');
      }
      this.haloColor = halo;
    }
    this.parts.clear();
    this.version++;
    this.bakeMs = performance.now() - t0;
  }

  propTextures(kind: string): PropTextures | undefined {
    return this.propTex.get(kind);
  }

  private disposeArt(a: LevelArt): void {
    destroyChunks(a.back);
    destroyChunks(a.tiles);
    destroyChunks(a.hazards);
    destroyChunks(a.front);
  }

  /** Effets pixel déclenchés par la sim (positions monde -> px d'art). */
  handleEvents(events: readonly SimEvent[], state: GameState): void {
    const P = this.parts;
    const theme = this.theme?.painter;
    for (const e of events) {
      const x = e.x / ART_SCALE;
      const y = e.y / ART_SCALE;
      const hero = this.heroes[e.player]?.pal;
      switch (e.type) {
        case 'hookHit':
          P.burst(x, y, 9, 140, SPARK, 0.35, 300);
          break;
        case 'hookMiss':
          P.burst(x, y, 5, 60, DULL, 0.25, 200);
          break;
        case 'death':
          if (hero) P.burst(x, y, 22, 170, [hero.scarfHi, hero.scarf, hero.scarfDk], 0.6, 120, 2);
          P.burst(x, y, 8, 110, WHITE, 0.3, 0);
          break;
        case 'respawn':
          if (hero) P.burst(x, y, 12, 70, [hero.scarfHi, hero.scarf], 0.45, 0);
          break;
        case 'enemyKill': {
          P.burst(x, y, 16, 130, ENEMY_BITS, 0.6, 260, 2);
          // Coup de lame : une traînée blanche qui traverse l'ennemi, le temps de trois frames.
          const pl = state.players[e.player];
          const dx = pl ? Math.sign(pl.vx) || 1 : 1;
          for (let k = -9; k <= 9; k++) P.spawn(x + k * dx, y - k * 0.55, 0, 0, 0.07 + Math.abs(k) * 0.004, WHITE, 0, 0, 1);
          break;
        }
        case 'playerHit':
          P.burst(x, y, 10, 120, SPARK, 0.35, 200);
          break;
        case 'land': {
          const n = Math.max(2, Math.min(10, Math.round((e.value ?? 0) / 150)));
          const dust = theme?.dust ?? DULL;
          const r = (state.params.playerRadius ?? 11) / ART_SCALE;
          for (let k = 0; k < n; k++) {
            const s = k % 2 === 0 ? 1 : -1;
            P.spawn(x + s * (1 + Math.random() * 3), y + r, s * (20 + Math.random() * 40), -8 - Math.random() * 18, 0.35 + Math.random() * 0.2, dust, 60, 4, 1);
          }
          break;
        }
        case 'overheat':
          P.burst(x, y, 6, 30, SMOKE, 0.8, -30, 2);
          break;
        case 'levelComplete':
          P.burst(x, y, 30, 160, GOLD, 0.9, 160, 2);
          break;
        default:
          break;
      }
    }
  }

  /** Une frame : pantins (secondaire + dessin) et particules. `dt` = temps de jeu (0 en pause). */
  update(state: GameState, poses: readonly PlayerPose[], dt: number, ambientDt: number): void {
    this.ambient += ambientDt;
    this.gameTime += dt;
    const level = this.level;
    const theme = this.theme?.painter;
    if (!level || !theme) return;
    const r = state.params.playerRadius;
    for (let i = 0; i < state.playerCount; i++) {
      const pl = state.players[i];
      const pose = poses[i];
      const inp = this.heroInputs[i];
      inp.x = pose.x / ART_SCALE;
      inp.y = pose.y / ART_SCALE;
      inp.vx = pl.vx / ART_SCALE;
      inp.vy = pl.vy / ART_SCALE;
      inp.radius = r / ART_SCALE;
      inp.grounded = pl.grounded === 1;
      inp.aimX = pl.aimX;
      inp.aimY = pl.aimY;
      inp.jet = pl.jetThrust === 1;
      inp.heat = pl.heat;
      inp.overheated = pl.overheated === 1;
      inp.invuln = pl.invuln > 0;
      inp.teleportSeq = pl.teleportSeq;
      for (let h = 0; h < 2; h++) {
        const hk = pl.hooks[h];
        const v = inp.hooks[h];
        if (hk.state === HOOK_FLYING) {
          v.state = HOOK_VIEW_FLYING;
          v.x = pose.hookX[h] / ART_SCALE;
          v.y = pose.hookY[h] / ART_SCALE;
          v.reeling = false;
          v.slack = 0;
        } else if (hk.state === HOOK_ATTACHED) {
          const ax = hk.target >= 0 ? poses[hk.target].x : hk.x;
          const ay = hk.target >= 0 ? poses[hk.target].y : hk.y;
          v.state = HOOK_VIEW_ATTACHED;
          v.x = ax / ART_SCALE;
          v.y = ay / ART_SCALE;
          v.reeling = hk.reeling === 1;
          v.slack = Math.max(0, hk.length - Math.hypot(pose.x - ax, pose.y - ay)) / ART_SCALE;
        } else {
          v.state = HOOK_VIEW_IDLE;
        }
      }
      inp.floorGap = floorGap(level, pose.x, pose.y, r) / ART_SCALE;
      inp.ceilGap = ceilGap(level, pose.x, pose.y, r) / ART_SCALE;
      inp.showAim = true;
      const hero = this.heroes[i];
      hero.update(dt, inp, theme.wind, this.parts);
      hero.draw(theme.rim, this.gameTime);
      refreshTexture(this.heroTex[i]);
    }
    this.updateParticles(level, dt);
  }

  /**
   * Particules des planches, plus un sol : ce qui tombe (débris, braises, poussière) rebondit à
   * peine puis se couche sur la tuile pleine au lieu de traverser le décor.
   */
  private updateParticles(level: Level, dt: number): void {
    if (dt <= 0) return;
    const list = this.parts.list;
    const ts = TILE_SIZE / ART_SCALE;
    for (const p of list) {
      if (p.grav <= 0) continue;
      const tx = Math.floor((p.x + p.vx * dt) / ts);
      const ty = Math.floor((p.y + p.vy * dt) / ts);
      if (!isSolidTile(tileAt(level, tx, ty))) continue;
      // Contact : on reste au-dessus de la tuile, on perd presque toute la vitesse.
      const floorY = ty * ts - 0.01;
      if (p.vy > 0 && p.y <= floorY + 0.5) {
        p.y = Math.min(p.y, floorY);
        p.vy = Math.abs(p.vy) > 60 ? -p.vy * 0.25 : 0;
        p.vx *= 0.5;
        if (p.vy === 0) p.grav = 0;
      } else {
        p.vx = 0;
        p.vy = 0;
        p.grav = 0;
      }
    }
    this.parts.update(dt);
  }
}

/** Distance (px monde) du bas de la hitbox au premier sol plein, sur trois colonnes (bords de corniche). */
function floorGap(level: Level, x: number, y: number, r: number): number {
  const ts = TILE_SIZE;
  const bottom = y + r;
  let best = Infinity;
  for (const cx of [x - r * 0.8, x, x + r * 0.8]) {
    const tx = Math.floor(cx / ts);
    for (let ty = Math.floor(bottom / ts); ty <= Math.floor((bottom + ts * 2.5) / ts); ty++) {
      if (isSolidTile(tileAt(level, tx, ty))) {
        best = Math.min(best, Math.max(0, ty * ts - bottom));
        break;
      }
    }
  }
  return best;
}

/** Distance (px monde) du centre de la hitbox au premier plafond plein. */
function ceilGap(level: Level, x: number, y: number, r: number): number {
  const ts = TILE_SIZE;
  const tx = Math.floor(x / ts);
  for (let ty = Math.floor((y - r) / ts); ty >= Math.floor((y - r - ts * 2) / ts); ty--) {
    if (isSolidTile(tileAt(level, tx, ty))) return Math.max(0, y - (ty + 1) * ts);
  }
  return Infinity;
}
