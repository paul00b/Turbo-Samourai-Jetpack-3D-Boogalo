import './style.css';
import { getLevel } from './sim';
import { Game } from './app/game';
import { AudioEngine } from './io/audio/audioEngine';
import { Sfx } from './io/audio/sfx';
import { GamepadManager } from './io/input/gamepad';
import { InputMapper } from './io/input/inputMapper';
import { KeyboardMouse } from './io/input/keyboardMouse';
import { ParamsStore } from './io/paramsStore';
import { SettingsStore } from './io/settings';
import { Renderer } from './render/renderer';
import { DebugPanel } from './ui/debugPanel';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';

async function boot(): Promise<void> {
  const gameEl = document.getElementById('game') as HTMLElement;
  const hudEl = document.getElementById('hud') as HTMLElement;
  const menuEl = document.getElementById('menu') as HTMLElement;
  const debugEl = document.getElementById('debug') as HTMLElement;

  const settings = new SettingsStore();
  const params = new ParamsStore();
  const kbm = new KeyboardMouse(gameEl);
  const pads = new GamepadManager();
  const audio = new AudioEngine();
  const sfx = new Sfx(audio);

  // Déblocage de l'AudioContext au premier geste (Chrome). On réessaie tant que ce n'est pas "running".
  const unlock = (): void => {
    audio.unlock();
    audio.setVolumes(settings.get().masterVolume, settings.get().sfxVolume);
    if (audio.unlocked) {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  settings.subscribe((s) => audio.setVolumes(s.masterVolume, s.sfxVolume));

  let renderer: Renderer;
  try {
    renderer = await Renderer.create(gameEl, getLevel(0));
  } catch (e) {
    showFatal(`WebGL indisponible : ${(e as Error).message}`);
    return;
  }

  const mapper = new InputMapper(kbm, pads, () => settings.get());
  const game = new Game({ renderer, mapper, kbm, sfx, settings, params });
  const hud = new Hud(hudEl);
  const menu = new Menu(menuEl, { game, settings, kbm, pads, sfx, audio });
  const debug = new DebugPanel(debugEl, { game, settings, params });
  // Handle d'inspection (console navigateur, tests Playwright).
  (window as unknown as { __tsj: unknown }).__tsj = { game, settings, params, mapper, pads, kbm, audio };

  // Raccourcis debug globaux
  window.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'F1':
        e.preventDefault();
        debug.toggle();
        break;
      case 'F2':
        e.preventDefault();
        settings.update((s) => (s.cameraMode = s.cameraMode === 'single' ? 'split' : 'single'));
        break;
      case 'F3':
        e.preventDefault();
        settings.update((s) => (s.debug.showHitboxes = !s.debug.showHitboxes));
        break;
      case 'F4':
        e.preventDefault();
        settings.update((s) => (s.debug.showVelocity = !s.debug.showVelocity));
        break;
      case 'F6':
        e.preventDefault();
        settings.update((s) => (s.debug.showTrail = !s.debug.showTrail));
        break;
      default:
        break;
    }
  });

  // Onglet caché : on met en pause pour éviter tout rattrapage à la reprise.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.phase === 'playing') game.pause();
  });

  const mouse = { x: 0, y: 0, visible: false };
  const frame = (now: number): void => {
    pads.poll(now);
    menu.update(now);
    game.frame(now);
    const s = settings.get();
    const kbmPlayer = s.devices.findIndex((d, i) => d.kind === 'kbm' && i < game.state.playerCount);
    mouse.visible = game.phase === 'playing' && kbmPlayer >= 0 && kbm.mouseSeen;
    mouse.x = kbm.mouseX;
    mouse.y = kbm.mouseY;
    hud.setVisible(game.phase !== 'menu');
    hud.update(game.state, game.loop, mapper, s, mouse, renderer.renderMs);
    debug.update(now);
    document.body.classList.toggle('playing', game.phase === 'playing');
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function showFatal(msg: string): void {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = msg;
  document.body.append(el);
}

void boot();
