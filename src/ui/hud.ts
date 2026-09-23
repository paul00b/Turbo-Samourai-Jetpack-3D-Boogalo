/** HUD permanent (DOM) : vitesse en gros, jauge de chauffe, chrono, FPS, TPS, PV, morts. */
import { DT, type GameState } from '../sim';
import type { GameLoop } from '../app/gameLoop';
import type { InputMapper } from '../io/input/inputMapper';
import type { Settings } from '../io/settings';
import { clear, h } from './dom';

interface PlayerBlock {
  root: HTMLElement;
  speed: HTMLElement;
  heatFill: HTMLElement;
  heatLabel: HTMLElement;
  hp: HTMLElement;
  deaths: HTMLElement;
  chrono: HTMLElement;
  cut: HTMLElement;
  device: HTMLElement;
}

export class Hud {
  private blocks: PlayerBlock[] = [];
  private readonly stats: HTMLElement;
  private readonly globalChrono: HTMLElement;
  private readonly message: HTMLElement;
  private readonly crosshair: HTMLElement;
  private lastTextUpdate = 0;

  constructor(private readonly root: HTMLElement) {
    clear(root);
    this.globalChrono = h('div', { class: 'hud-chrono', text: '00:00.00' });
    this.stats = h('div', { class: 'hud-stats', text: '' });
    this.message = h('div', { class: 'hud-message hidden' });
    this.crosshair = h('div', { class: 'crosshair hidden' });
    root.append(this.globalChrono, this.stats, this.message, this.crosshair);
    for (let i = 0; i < 2; i++) {
      const speed = h('div', { class: 'hud-speed', text: '0' });
      const heatFill = h('div', { class: 'hud-heat-fill' });
      const heatLabel = h('div', { class: 'hud-heat-label', text: 'CHAUFFE' });
      const hp = h('div', { class: 'hud-hp', text: '' });
      const deaths = h('div', { class: 'hud-deaths', text: '' });
      const chrono = h('div', { class: 'hud-run', text: '' });
      const cut = h('div', { class: 'hud-cut hidden', text: 'CUT !' });
      const device = h('div', { class: 'hud-device', text: '' });
      const block = h(
        'div',
        { class: `hud-player hud-p${i + 1}` },
        h('div', { class: 'hud-title', text: `J${i + 1}` }, device),
        h('div', { class: 'hud-speed-row' }, speed, h('span', { class: 'hud-unit', text: 'px/s' })),
        h('div', { class: 'hud-heat' }, heatFill, heatLabel),
        h('div', { class: 'hud-row' }, hp, deaths, chrono),
        cut,
      );
      root.append(block);
      this.blocks.push({ root: block, speed, heatFill, heatLabel, hp, deaths, chrono, cut, device });
    }
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  update(
    state: GameState,
    loop: GameLoop,
    mapper: InputMapper,
    settings: Settings,
    mouse: { x: number; y: number; visible: boolean },
    renderMs = 0,
  ): void {
    const now = performance.now();
    const textTick = now - this.lastTextUpdate > 50; // 20 Hz pour le texte, la barre de chauffe chaque frame
    if (textTick) this.lastTextUpdate = now;

    for (let i = 0; i < 2; i++) {
      const b = this.blocks[i];
      const active = i < state.playerCount;
      b.root.classList.toggle('hidden', !active);
      if (!active) continue;
      const pl = state.players[i];
      b.heatFill.style.width = `${Math.round(pl.heat * 100)}%`;
      b.heatFill.classList.toggle('overheated', pl.overheated === 1);
      b.heatFill.classList.toggle('hot', pl.heat > 0.75 && !pl.overheated);
      b.cut.classList.toggle('hidden', pl.pendingCutEnemy < 0);
      if (!textTick) continue;
      const speed = Math.hypot(pl.vx, pl.vy);
      b.speed.textContent = String(Math.round(speed));
      b.speed.classList.toggle('lethal', speed > state.params.wallDeathSpeed);
      b.speed.classList.toggle('killer', speed >= state.params.enemyKillSpeed && speed <= state.params.wallDeathSpeed);
      b.heatLabel.textContent = pl.overheated ? 'SURCHAUFFE' : `CHAUFFE ${Math.round(pl.heat * 100)}%`;
      let hearts = '';
      for (let k = 0; k < state.params.maxHp; k++) hearts += k < pl.hp ? '♥' : '♡';
      b.hp.textContent = hearts;
      b.deaths.textContent = `☠ ${pl.deaths}`;
      b.chrono.textContent = formatTime((state.tick - pl.spawnTick) * DT);
      const dev = settings.devices[i];
      const status = mapper.status(i);
      b.device.textContent = dev.kind === 'kbm' ? 'clavier+souris' : status === 'ok' ? 'manette' : 'manette ?';
      b.device.classList.toggle('warn', status !== 'ok');
    }

    if (textTick) {
      this.globalChrono.textContent = formatTime(state.tick * DT);
      this.stats.textContent = `${loop.fps} fps · ${loop.tps} ticks/s · rendu ${renderMs.toFixed(1)} ms · tick ${state.tick}`;
      let msg = '';
      for (let i = 0; i < state.playerCount; i++) {
        if (mapper.status(i) === 'waiting-gamepad') msg += `J${i + 1} : appuie sur un bouton de la manette pour la détecter\n`;
      }
      this.message.textContent = msg.trim();
      this.message.classList.toggle('hidden', msg.length === 0);
    }

    this.crosshair.classList.toggle('hidden', !mouse.visible);
    if (mouse.visible) this.crosshair.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
  }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
