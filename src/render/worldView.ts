/**
 * Une vue du monde (une par viewport). Lit l'état, ne le modifie jamais.
 * Les tuiles sont dessinées une fois ; le reste est redessiné chaque frame (grey-box : c'est bon marché).
 */
import { Container, Graphics, Text } from 'pixi.js';
import {
  getLevel,
  HOOK_ATTACHED,
  HOOK_FLYING,
  SPIKE_INSET,
  T_SLICK,
  T_SOLID,
  T_SPIKE,
  TILE_SIZE,
  type GameState,
  type Level,
} from '../sim';
import type { Fx } from './fx';
import { PLAYER_COLORS } from './fx';
import type { PlayerPose } from './interpolate';
import type { TrailBuffer } from './trail';

export interface DrawOptions {
  showHitboxes: boolean;
  showVelocity: boolean;
  showTrail: boolean;
  /** Angle 16 bits de visée par joueur (pour le curseur virtuel du joueur manette). */
  time: number;
}

const COLOR_BG_GRID = 0x141920;
const COLOR_SOLID = 0x3e4757;
const COLOR_SOLID_EDGE = 0x5a6578;
const COLOR_SLICK = 0x274a70;
const COLOR_SLICK_EDGE = 0x4f8fd1;
const COLOR_SPIKE_BASE = 0x2a1d22;
const COLOR_SPIKE = 0xd94848;
const COLOR_ENEMY = 0xc74b4b;
const COLOR_ROPE = 0xdde3ea;
const COLOR_GOAL = 0x5ae08a;

export class WorldView {
  readonly root = new Container();
  private readonly tiles = new Graphics();
  private readonly labels = new Container();
  private readonly trail = new Graphics();
  private readonly enemies = new Graphics();
  private readonly ropes = new Graphics();
  private readonly players = new Graphics();
  private readonly fxG = new Graphics();
  private readonly debug = new Graphics();

  /**
   * `overlay` : vue réduite aux aides de debug (hitboxes, vecteurs, notes de level design), posée
   * par-dessus le rendu pixel. Sinon, le grey-box complet du proto.
   */
  constructor(
    level: Level,
    private readonly overlay = false,
  ) {
    if (overlay) this.root.addChild(this.labels, this.debug);
    else this.root.addChild(this.tiles, this.labels, this.trail, this.enemies, this.ropes, this.players, this.fxG, this.debug);
    this.setLevel(level);
  }

  /** Tuiles et libellés : dessinés une fois par carte (grey-box statique). */
  setLevel(level: Level): void {
    if (!this.overlay) {
      this.drawTiles(level);
      this.drawGoal(level);
    }
    this.labels.removeChildren().forEach((c) => c.destroy());
    for (const l of level.labels) {
      const t = new Text({
        text: l.name,
        style: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 15, fill: 0x8b95a7, fontWeight: '600' },
      });
      t.position.set(l.x * TILE_SIZE, l.y * TILE_SIZE);
      this.labels.addChild(t);
    }
  }

  /** Zone d'arrivée : damier vert translucide + montants pleins, lisible de loin. */
  private drawGoal(level: Level): void {
    const g = this.tiles;
    const goal = level.goal;
    if (!goal) return;
    g.rect(goal.x, goal.y, goal.w, goal.h).fill({ color: COLOR_GOAL, alpha: 0.14 });
    const cell = TILE_SIZE / 2;
    const cols = Math.ceil(goal.w / cell);
    const rows = Math.ceil(goal.h / cell);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r + c) % 2 !== 0) continue;
        const w = Math.min(cell, goal.x + goal.w - (goal.x + c * cell));
        const h = Math.min(cell, goal.y + goal.h - (goal.y + r * cell));
        g.rect(goal.x + c * cell, goal.y + r * cell, w, h).fill({ color: COLOR_GOAL, alpha: 0.3 });
      }
    }
    g.rect(goal.x - 3, goal.y, 3, goal.h).fill(COLOR_GOAL);
    g.rect(goal.x + goal.w, goal.y, 3, goal.h).fill(COLOR_GOAL);
  }

  private drawTiles(level: Level): void {
    const g = this.tiles;
    const ts = TILE_SIZE;
    g.clear();
    g.rect(0, 0, level.width * ts, level.height * ts).fill(COLOR_BG_GRID);
    // Grille discrète toutes les 4 tuiles pour lire les distances.
    for (let x = 0; x <= level.width; x += 4) g.moveTo(x * ts, 0).lineTo(x * ts, level.height * ts);
    for (let y = 0; y <= level.height; y += 4) g.moveTo(0, y * ts).lineTo(level.width * ts, y * ts);
    g.stroke({ width: 1, color: 0x1c232d, alpha: 1 });

    for (let y = 0; y < level.height; y++) {
      let x = 0;
      while (x < level.width) {
        const t = level.tiles[y * level.width + x];
        if (t === 0) {
          x++;
          continue;
        }
        let run = 1;
        while (x + run < level.width && level.tiles[y * level.width + x + run] === t) run++;
        const px = x * ts;
        const py = y * ts;
        const w = run * ts;
        if (t === T_SOLID) {
          g.rect(px, py, w, ts).fill(COLOR_SOLID).stroke({ width: 1, color: COLOR_SOLID_EDGE, alpha: 0.7 });
        } else if (t === T_SLICK) {
          g.rect(px, py, w, ts).fill(COLOR_SLICK).stroke({ width: 1, color: COLOR_SLICK_EDGE, alpha: 0.8 });
          for (let i = 0; i < run; i++) {
            const bx = px + i * ts;
            g.moveTo(bx + 4, py + ts - 4).lineTo(bx + ts - 4, py + 4);
          }
          g.stroke({ width: 1.5, color: COLOR_SLICK_EDGE, alpha: 0.5 });
        } else if (t === T_SPIKE) {
          g.rect(px, py, w, ts).fill(COLOR_SPIKE_BASE);
          for (let i = 0; i < run; i++) {
            const bx = px + i * ts;
            g.poly([bx, py + ts, bx + ts / 4, py + 2, bx + ts / 2, py + ts]).fill(COLOR_SPIKE);
            g.poly([bx + ts / 2, py + ts, bx + (3 * ts) / 4, py + 2, bx + ts, py + ts]).fill(COLOR_SPIKE);
          }
        }
        x += run;
      }
    }
  }

  setCamera(cx: number, cy: number, zoom: number, vpX: number, vpY: number, vpW: number, vpH: number): void {
    this.root.scale.set(zoom);
    this.root.position.set(vpX + vpW / 2 - cx * zoom, vpY + vpH / 2 - cy * zoom);
  }

  draw(state: GameState, poses: PlayerPose[], opts: DrawOptions, trails: TrailBuffer[], fx: Fx, zoom: number): void {
    if (this.overlay) {
      // Sur le rendu pixel, les notes de level design ne s'affichent qu'avec les hitboxes (F3).
      this.labels.visible = opts.showHitboxes;
      this.drawDebug(state, poses, opts);
      return;
    }
    this.drawTrails(state, trails, opts);
    this.drawEnemies(state, opts);
    this.drawRopes(state, poses);
    this.drawPlayers(state, poses, opts, zoom);
    this.drawFx(fx);
    this.drawDebug(state, poses, opts);
  }

  private drawTrails(state: GameState, trails: TrailBuffer[], opts: DrawOptions): void {
    const g = this.trail;
    g.clear();
    if (!opts.showTrail) return;
    for (let i = 0; i < state.playerCount; i++) {
      const tr = trails[i];
      if (!tr || tr.length < 2) continue;
      const color = PLAYER_COLORS[i];
      const n = tr.length;
      // Segments par tranche d'alpha pour un fondu (8 tranches).
      const slices = 8;
      for (let s = 0; s < slices; s++) {
        const from = Math.floor((n - 1) * (s / slices));
        const to = Math.floor((n - 1) * ((s + 1) / slices));
        if (to <= from) continue;
        g.moveTo(tr.x(from), tr.y(from));
        for (let k = from + 1; k <= to; k++) g.lineTo(tr.x(k), tr.y(k));
        g.stroke({ width: 2, color, alpha: 0.08 + 0.5 * ((s + 1) / slices) });
      }
    }
  }

  private drawEnemies(state: GameState, opts: DrawOptions): void {
    const g = this.enemies;
    g.clear();
    if (!state.params.enemiesEnabled) return;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      const x = e.x - e.w / 2;
      const y = e.y - e.h / 2;
      if (!e.alive) {
        if (e.respawnTimer > 0) g.rect(x, y, e.w, e.h).stroke({ width: 1, color: COLOR_ENEMY, alpha: 0.25 });
        continue;
      }
      g.rect(x, y, e.w, e.h).fill(COLOR_ENEMY).stroke({ width: 1.5, color: 0x7a2727 });
      // yeux
      const eyeDir = e.patrol ? e.dir : 0;
      g.rect(e.x - 6 + eyeDir * 3, e.y - 8, 4, 4).fill(0x1a0d0d);
      g.rect(e.x + 2 + eyeDir * 3, e.y - 8, 4, 4).fill(0x1a0d0d);
      if (e.patrol) {
        const blink = Math.sin(opts.time * 6) > 0;
        if (blink) g.rect(e.x - 3, y - 6, 6, 3).fill(0xffd166);
      }
    }
  }

  private drawRopes(state: GameState, poses: PlayerPose[]): void {
    const g = this.ropes;
    g.clear();
    for (let i = 0; i < state.playerCount; i++) {
      const pl = state.players[i];
      const pose = poses[i];
      for (let h = 0; h < 2; h++) {
        const hk = pl.hooks[h];
        if (hk.state === HOOK_FLYING) {
          const hx = pose.hookX[h];
          const hy = pose.hookY[h];
          g.moveTo(pose.x, pose.y).lineTo(hx, hy).stroke({ width: 1.5, color: COLOR_ROPE, alpha: 0.6 });
          g.rect(hx - 3, hy - 3, 6, 6).fill(0xffffff);
        } else if (hk.state === HOOK_ATTACHED) {
          const ax = hk.target >= 0 ? poses[hk.target].x : hk.x;
          const ay = hk.target >= 0 ? poses[hk.target].y : hk.y;
          const taut = Math.hypot(pose.x - ax, pose.y - ay) >= hk.length - 0.5;
          g.moveTo(pose.x, pose.y)
            .lineTo(ax, ay)
            .stroke({ width: hk.reeling ? 3 : 2, color: hk.reeling ? PLAYER_COLORS[i] : COLOR_ROPE, alpha: taut ? 0.95 : 0.5 });
          g.rect(ax - 4, ay - 4, 8, 8).fill(hk.reeling ? PLAYER_COLORS[i] : 0xffffff);
        }
      }
    }
  }

  private drawPlayers(state: GameState, poses: PlayerPose[], opts: DrawOptions, zoom: number): void {
    const g = this.players;
    g.clear();
    const r = state.params.playerRadius;
    for (let i = 0; i < state.playerCount; i++) {
      const pl = state.players[i];
      const pose = poses[i];
      const color = PLAYER_COLORS[i];
      const blink = pl.invuln > 0 && Math.floor(opts.time * 20) % 2 === 0;

      // Flamme du jetpack : opposée à la poussée, avec un peu de flicker.
      if (pl.jetThrust) {
        const fl = 22 + Math.random() * 14;
        const bx = pose.x - pl.aimX * r;
        const by = pose.y - pl.aimY * r;
        const px = -pl.aimY;
        const py = pl.aimX;
        g.poly([bx + px * 6, by + py * 6, bx - px * 6, by - py * 6, bx - pl.aimX * fl, by - pl.aimY * fl]).fill({
          color: 0xffa640,
          alpha: 0.9,
        });
        g.poly([bx + px * 3, by + py * 3, bx - px * 3, by - py * 3, bx - pl.aimX * fl * 0.6, by - pl.aimY * fl * 0.6]).fill({
          color: 0xfff1b0,
          alpha: 0.95,
        });
      }

      // Corps
      g.circle(pose.x, pose.y, r).fill(blink ? 0xffffff : color).stroke({ width: 1.5, color: 0x0b0e12, alpha: 0.9 });
      // "Tongs" : deux petits traits sous le corps quand au sol
      if (pl.grounded) {
        g.rect(pose.x - r + 1, pose.y + r - 2, 6, 3).fill(0x2a1a0a);
        g.rect(pose.x + r - 7, pose.y + r - 2, 6, 3).fill(0x2a1a0a);
      }
      // Œil vers la visée
      g.circle(pose.x + pl.aimX * r * 0.45, pose.y + pl.aimY * r * 0.45, r * 0.28).fill(0x0b0e12);

      // Indicateur de visée (segment) + curseur virtuel
      const aimLen = r + 14;
      g.moveTo(pose.x + pl.aimX * (r + 3), pose.y + pl.aimY * (r + 3))
        .lineTo(pose.x + pl.aimX * aimLen, pose.y + pl.aimY * aimLen)
        .stroke({ width: 2 / Math.max(0.5, zoom), color, alpha: 0.7 });

      // Anneau de chauffe autour du joueur
      if (pl.heat > 0.02) {
        const start = -Math.PI / 2;
        const end = start + pl.heat * Math.PI * 2;
        const rr = r + 5;
        g.moveTo(pose.x + Math.cos(start) * rr, pose.y + Math.sin(start) * rr)
          .arc(pose.x, pose.y, rr, start, end)
          .stroke({ width: 3, color: pl.overheated ? 0xff3b3b : pl.heat > 0.75 ? 0xffb347 : 0xffe28a, alpha: 0.9 });
      }

      // Fenêtre de cut manuel ouverte : anneau jaune pulsant
      if (pl.pendingCutEnemy >= 0) {
        const pulse = 1 + 0.15 * Math.sin(opts.time * 40);
        g.circle(pose.x, pose.y, (r + 12) * pulse).stroke({ width: 3, color: 0xffe14d, alpha: 0.95 });
      }
    }
  }

  private drawFx(fx: Fx): void {
    const g = this.fxG;
    g.clear();
    for (const p of fx.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      g.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size).fill({ color: p.color, alpha: a });
    }
  }

  private drawDebug(state: GameState, poses: PlayerPose[], opts: DrawOptions): void {
    const g = this.debug;
    g.clear();
    if (!opts.showHitboxes && !opts.showVelocity) return;
    const r = state.params.playerRadius;
    for (let i = 0; i < state.playerCount; i++) {
      const pl = state.players[i];
      const pose = poses[i];
      if (opts.showHitboxes) {
        g.circle(pl.x, pl.y, r).stroke({ width: 1, color: 0x00ff88, alpha: 0.9 });
        for (let h = 0; h < 2; h++) {
          const hk = pl.hooks[h];
          if (hk.state === HOOK_ATTACHED && hk.target < 0) g.circle(hk.x, hk.y, hk.length).stroke({ width: 1, color: 0x00ff88, alpha: 0.25 });
        }
      }
      if (opts.showVelocity) {
        const k = 0.15; // 150 ms d'avance
        g.moveTo(pose.x, pose.y).lineTo(pose.x + pl.vx * k, pose.y + pl.vy * k).stroke({ width: 2, color: 0xff4fd8, alpha: 0.9 });
        g.moveTo(pose.x, pose.y)
          .lineTo(pose.x + pl.aimX * 40, pose.y + pl.aimY * 40)
          .stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
      }
    }
    if (opts.showHitboxes) {
      if (state.params.enemiesEnabled) {
        for (const e of state.enemies) {
          if (!e.alive) continue;
          g.rect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h).stroke({ width: 1, color: 0x00ff88, alpha: 0.9 });
        }
      }
      // Hitbox réduite des pics autour des joueurs (zone proche uniquement)
      const level = getLevel(state.levelId);
      {
        for (let i = 0; i < state.playerCount; i++) {
          const pl = state.players[i];
          const tx0 = Math.floor(pl.x / TILE_SIZE) - 6;
          const ty0 = Math.floor(pl.y / TILE_SIZE) - 4;
          for (let ty = ty0; ty < ty0 + 9; ty++) {
            for (let tx = tx0; tx < tx0 + 13; tx++) {
              if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) continue;
              if (level.tiles[ty * level.width + tx] !== T_SPIKE) continue;
              g.rect(tx * TILE_SIZE + SPIKE_INSET, ty * TILE_SIZE + SPIKE_INSET, TILE_SIZE - 2 * SPIKE_INSET, TILE_SIZE - 2 * SPIKE_INSET).stroke({
                width: 1,
                color: 0xff5555,
                alpha: 0.8,
              });
            }
          }
        }
      }
    }
  }
}
