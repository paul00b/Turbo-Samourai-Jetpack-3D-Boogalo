/**
 * Renderer Pixi (WebGL) : 1 ou 2 WorldView (split), caméras, masques, séparateur.
 * Implémente WorldPicker pour que la couche IO convertisse la souris en point monde.
 */
import { Application, Container, Graphics } from 'pixi.js';
import { TILE_SIZE, type GameState, type Level } from '../sim';
import type { WorldPicker } from '../io/input/inputMapper';
import type { CameraMode, CameraSettings, DebugVisuals } from '../io/settings';
import { Camera, fitZoom, type Viewport } from './camera';
import type { Fx } from './fx';
import { interpolatePoses, makePose, type PlayerPose } from './interpolate';
import type { TrailBuffer } from './trail';
import { WorldView } from './worldView';

export class Renderer implements WorldPicker {
  readonly app: Application;
  private readonly views: WorldView[];
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
  /** Durée du dernier app.render() en ms (lissée). */
  renderMs = 0;

  private constructor(app: Application, level: Level) {
    this.app = app;
    this.level = level;
    this.views = [new WorldView(level), new WorldView(level)];
    this.masks = [new Graphics(), new Graphics()];
    const stage = app.stage;
    for (let i = 0; i < 2; i++) {
      const holder = new Container();
      holder.addChild(this.views[i].root);
      holder.addChild(this.masks[i]);
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

  /** Change la carte affichée : les tuiles et les libellés sont redessinés une fois. */
  setLevel(level: Level): void {
    if (level === this.level) return;
    this.level = level;
    for (const v of this.views) v.setLevel(level);
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
  ): void {
    this.time += dtReal;
    this.mode = mode;
    this.playerCount = curr.playerCount;
    this.camSettings = cam;
    interpolatePoses(prev, curr, alpha, this.poses);
    const bounds = { w: this.level.width * TILE_SIZE, h: this.level.height * TILE_SIZE };
    const split = mode === 'split' && curr.playerCount === 2;
    const opts = { showHitboxes: dbg.showHitboxes, showVelocity: dbg.showVelocity, showTrail: dbg.showTrail, time: this.time };

    if (split) {
      for (let i = 0; i < 2; i++) {
        const vp = this.viewport(i);
        const c = this.cameras[1 + i];
        c.follow(this.poses[i].x, this.poses[i].y, cam.splitZoom, dtReal, cam.smoothing, vp, bounds);
        this.applyView(i, vp, c, curr, opts, trails, fx);
      }
      this.divider.clear();
      const half = Math.floor(this.width / 2);
      this.divider.rect(half - 1, 0, 2, this.height).fill(0xdde3ea);
      this.divider.visible = true;
    } else {
      const vp = this.viewport(0);
      let tx = this.poses[0].x;
      let ty = this.poses[0].y;
      let zoom = cam.soloZoom;
      if (curr.playerCount === 2) {
        const p0 = this.poses[0];
        const p1 = this.poses[1];
        tx = (p0.x + p1.x) / 2;
        ty = (p0.y + p1.y) / 2;
        zoom = fitZoom(Math.abs(p0.x - p1.x), Math.abs(p0.y - p1.y), vp, cam.margin, cam.zoomMin, cam.zoomMax);
      }
      const c = this.cameras[0];
      c.follow(tx, ty, zoom, dtReal, cam.smoothing, vp, bounds);
      this.applyView(0, vp, c, curr, opts, trails, fx);
      this.holders[1].visible = false;
      this.divider.visible = false;
    }
    const t0 = performance.now();
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
  ): void {
    const view = this.views[i];
    this.holders[i].visible = true;
    const m = this.masks[i];
    m.clear();
    m.rect(vp.x, vp.y, vp.w, vp.h).fill(0xffffff);
    view.setCamera(c.x, c.y, c.zoom, vp.x, vp.y, vp.w, vp.h);
    view.draw(state, this.poses, opts, trails, fx, c.zoom);
  }

  /** Zoom courant de la caméra du joueur (HUD). */
  zoomOf(playerIndex: number): number {
    return this.cameraFor(playerIndex).zoom;
  }

  get settings(): CameraSettings | null {
    return this.camSettings;
  }
}
