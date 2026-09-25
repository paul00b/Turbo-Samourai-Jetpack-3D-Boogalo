/**
 * Renderer Pixi (WebGL) : 1 ou 2 vues (split), caméras, masques, séparateur.
 * Deux rendus au choix (réglage `render.mode`) : le pixel art des planches (ArtView, par défaut)
 * et le grey-box vectoriel du proto (WorldView). Les aides de debug se posent par-dessus les deux.
 * Implémente WorldPicker pour que la couche IO convertisse la souris en point monde.
 */
import { Application, Container, Graphics } from 'pixi.js';
import { TILE_SIZE, getLevel, type GameState, type Level } from '../sim';
import type { WorldPicker } from '../io/input/inputMapper';
import type { CameraMode, CameraSettings, DebugVisuals, RenderSettings } from '../io/settings';
import { ArtView } from './art/artView';
import { ArtWorld } from './art/artWorld';
import { ART_SCALE } from './art/levelShape';
import { getTheme, themeIdFor } from './art/themes';
import type { ThemeId } from './art/themes/types';
import { Camera, fitZoom, type Viewport } from './camera';
import type { Fx } from './fx';
import { interpolatePoses, makePose, type PlayerPose } from './interpolate';
import type { TrailBuffer } from './trail';
import { WorldView } from './worldView';

const DEFAULT_RENDER: RenderSettings = { mode: 'art', theme: 'auto', pixelSnap: true };

export class Renderer implements WorldPicker {
  readonly app: Application;
  private readonly views: WorldView[];
  private readonly overlays: WorldView[];
  private readonly artViews: ArtView[];
  readonly artWorld = new ArtWorld();
  private readonly holders: Container[] = [];
  private readonly masks: Graphics[];
  private readonly divider = new Graphics();
  private readonly cameras = [new Camera(), new Camera(), new Camera()];
  private readonly poses: PlayerPose[] = [makePose(), makePose()];
  private level: Level;
  private mode: CameraMode = 'single';
  private playerCount = 1;
  private camSettings: CameraSettings | null = null;
  private time = 0;
  private lastNow = -1;
  /** Thème réellement affiché (après résolution de `auto`). */
  themeId: ThemeId = 'port';
  /** Durée du dernier app.render() en ms (lissée). */
  renderMs = 0;
  /** Préparation CPU de la frame (pantins, décor animé, cuisson exclue), ms lissées. */
  prepMs = 0;
  /** Pantins et particules (dernière frame, ms). */
  worldMs = 0;

  /** Chronos détaillés du rendu pixel (dernière frame), pour le profilage. */
  artStats(): { world: number; theme: number; prep: number; pixi: number } {
    const v = this.artViews[0].stats;
    return { world: this.worldMs, theme: v.theme, prep: v.prep, pixi: v.pixi };
  }

  private constructor(app: Application, level: Level) {
    this.app = app;
    this.level = level;
    this.views = [new WorldView(level), new WorldView(level)];
    this.overlays = [new WorldView(level, true), new WorldView(level, true)];
    this.artViews = [new ArtView(), new ArtView()];
    this.masks = [new Graphics(), new Graphics()];
    const stage = app.stage;
    for (let i = 0; i < 2; i++) {
      const holder = new Container();
      holder.addChild(this.views[i].root, this.artViews[i].display, this.overlays[i].root, this.masks[i]);
      holder.mask = this.masks[i];
      stage.addChild(holder);
      this.holders.push(holder);
    }
    stage.addChild(this.divider);
  }

  static async create(container: HTMLElement, level: Level): Promise<Renderer> {
    const app = new Application();
    await app.init({
      preference: 'webgl',
      background: 0x0b0e12,
      resizeTo: container,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
    });
    app.ticker.stop();
    container.appendChild(app.canvas);
    return new Renderer(app, level);
  }

  get width(): number {
    return this.app.screen.width;
  }
  get height(): number {
    return this.app.screen.height;
  }

  /** Change la carte affichée : tuiles et libellés redessinés une fois, l'art recuit au prochain rendu. */
  setLevel(level: Level): void {
    if (level === this.level) return;
    this.level = level;
    for (const v of this.views) v.setLevel(level);
    for (const v of this.overlays) v.setLevel(level);
    this.resetCameras();
  }

  /** Réinitialise le lissage des caméras (nouvelle partie). */
  resetCameras(): void {
    for (const c of this.cameras) c.reset();
  }

  private viewport(index: number): Viewport {
    const w = this.width;
    const h = this.height;
    if (this.mode === 'split' && this.playerCount === 2) {
      const half = Math.floor(w / 2);
      return index === 0 ? { x: 0, y: 0, w: half, h } : { x: half, y: 0, w: w - half, h };
    }
    return { x: 0, y: 0, w, h };
  }

  /** Viewport dans lequel évolue le joueur i. */
  viewportFor(playerIndex: number): Viewport {
    return this.viewport(this.mode === 'split' && this.playerCount === 2 ? playerIndex : 0);
  }

  private cameraFor(playerIndex: number): Camera {
    return this.mode === 'split' && this.playerCount === 2 ? this.cameras[1 + playerIndex] : this.cameras[0];
  }

  screenToWorld(sx: number, sy: number, playerIndex: number, out: { x: number; y: number }): boolean {
    const vp = this.viewportFor(playerIndex);
    this.cameraFor(playerIndex).screenToWorld(sx, sy, vp, out);
    return true;
  }

  /**
   * Zoom calé sur un nombre entier de pixels écran par pixel d'art : les pixels restent des carrés
   * égaux. Réservé aux zooms fixes (solo, split) ; le zoom dynamique à 2 joueurs reste continu.
   */
  private snapZoom(zoom: number, render: RenderSettings): number {
    if (!render.pixelSnap || render.mode === 'greybox') return zoom;
    const dpr = this.app.renderer.resolution || 1;
    const devPerArt = zoom * ART_SCALE * dpr;
    if (devPerArt < 1.5) return zoom;
    return Math.round(devPerArt) / (ART_SCALE * dpr);
  }

  render(
    prev: GameState,
    curr: GameState,
    alpha: number,
    dtReal: number,
    mode: CameraMode,
    cam: CameraSettings,
    dbg: DebugVisuals,
    trails: TrailBuffer[],
    fx: Fx,
    render: RenderSettings = DEFAULT_RENDER,
  ): void {
    // Temps ambiant : le décor continue de vivre derrière les menus et la pause.
    const now = performance.now();
    const bakesBefore = this.artWorld.version;
    const ambientDt = this.lastNow < 0 ? 0 : Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.time += dtReal;
    this.mode = mode;
    this.playerCount = curr.playerCount;
    this.camSettings = cam;
    interpolatePoses(prev, curr, alpha, this.poses);
    const bounds = { w: this.level.width * TILE_SIZE, h: this.level.height * TILE_SIZE };
    const split = mode === 'split' && curr.playerCount === 2;
    const opts = { showHitboxes: dbg.showHitboxes, showVelocity: dbg.showVelocity, showTrail: dbg.showTrail, time: this.time };

    const art = render.mode !== 'greybox';
    if (art) {
      this.themeId = themeIdFor(render.theme, curr.levelId);
      this.artWorld.setScene(getLevel(curr.levelId), getTheme(this.themeId));
      this.artWorld.handleEvents(fx.artEvents, curr);
      const tw = performance.now();
      this.artWorld.update(curr, this.poses, dtReal, ambientDt);
      this.worldMs = performance.now() - tw;
    }
    fx.artEvents.length = 0;

    if (split) {
      for (let i = 0; i < 2; i++) {
        const vp = this.viewport(i);
        const c = this.cameras[1 + i];
        c.follow(this.poses[i].x, this.poses[i].y, this.snapZoom(cam.splitZoom, render), dtReal, cam.smoothing, vp, bounds);
        this.applyView(i, vp, c, curr, opts, trails, fx, render, ambientDt);
      }
      this.divider.clear();
      const half = Math.floor(this.width / 2);
      this.divider.rect(half - 1, 0, 2, this.height).fill(0x06060b);
      this.divider.rect(half, 0, 1, this.height).fill(0x262c3d);
      this.divider.visible = true;
    } else {
      const vp = this.viewport(0);
      let tx = this.poses[0].x;
      let ty = this.poses[0].y;
      let zoom = this.snapZoom(cam.soloZoom, render);
      if (curr.playerCount === 2) {
        const p0 = this.poses[0];
        const p1 = this.poses[1];
        tx = (p0.x + p1.x) / 2;
        ty = (p0.y + p1.y) / 2;
        zoom = fitZoom(Math.abs(p0.x - p1.x), Math.abs(p0.y - p1.y), vp, cam.margin, cam.zoomMin, cam.zoomMax);
      }
      const c = this.cameras[0];
      if (render.mode !== 'greybox') zoom = Math.max(zoom, ArtView.minZoom(vp));
      c.follow(tx, ty, zoom, dtReal, cam.smoothing, vp, bounds);
      this.applyView(0, vp, c, curr, opts, trails, fx, render, ambientDt);
      this.holders[1].visible = false;
      this.divider.visible = false;
    }
    const t0 = performance.now();
    // Une frame de cuisson (changement de carte ou de thème) fausserait la moyenne : on l'écarte.
    if (this.artWorld.version === bakesBefore) this.prepMs += (t0 - now - this.prepMs) * 0.1;
    this.app.render();
    this.renderMs += (performance.now() - t0 - this.renderMs) * 0.1;
  }

  private applyView(
    i: number,
    vp: Viewport,
    c: Camera,
    state: GameState,
    opts: { showHitboxes: boolean; showVelocity: boolean; showTrail: boolean; time: number },
    trails: TrailBuffer[],
    fx: Fx,
    render: RenderSettings,
    ambientDt: number,
  ): void {
    this.holders[i].visible = true;
    const m = this.masks[i];
    m.clear();
    m.rect(vp.x, vp.y, vp.w, vp.h).fill(0xffffff);
    const art = render.mode !== 'greybox';
    const grey = this.views[i];
    const overlay = this.overlays[i];
    const pixel = this.artViews[i];
    grey.root.visible = !art;
    pixel.display.visible = art;
    overlay.root.visible = art;
    if (art) {
      pixel.render(
        this.app.renderer,
        this.artWorld,
        c,
        vp,
        state,
        this.poses,
        trails,
        { mode: render.mode === 'values' ? 'values' : render.mode === 'play' ? 'play' : 'art', showTrail: opts.showTrail, time: opts.time },
        ambientDt,
      );
      overlay.setCamera(c.x, c.y, c.zoom, vp.x, vp.y, vp.w, vp.h);
      overlay.draw(state, this.poses, opts, trails, fx, c.zoom);
    } else {
      grey.setCamera(c.x, c.y, c.zoom, vp.x, vp.y, vp.w, vp.h);
      grey.draw(state, this.poses, opts, trails, fx, c.zoom);
    }
  }

  /** Zoom courant de la caméra du joueur (HUD). */
  zoomOf(playerIndex: number): number {
    return this.cameraFor(playerIndex).zoom;
  }

  get settings(): CameraSettings | null {
    return this.camSettings;
  }
}
