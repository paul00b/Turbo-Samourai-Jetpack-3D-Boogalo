/** HUD permanent (DOM) : vitesse en gros, jauge de chauffe, chrono, FPS, TPS, PV, morts. */
import { DT, getLevel, type GameState } from '../sim';
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
  kills: HTMLElement;
  chrono: HTMLElement;
  cut: HTMLElement;
  device: HTMLElement;
}

/** Nom du niveau affiché en haut du HUD (planches : en or, à droite). */
export interface StageLabel {
  name: string;
  sub: string;
}

export class Hud {
  private blocks: PlayerBlock[] = [];
  private readonly stats: HTMLElement;
  private readonly globalChrono: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly complete: HTMLElement;
  private readonly message: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly stageName: HTMLElement;
  private readonly stageSub: HTMLElement;
  private readonly modeLabel: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardName: HTMLElement;
  private readonly cardSub: HTMLElement;
  private lastTextUpdate = 0;
  private bannerAllowed = true;
  private lastTick = -1;
  private cardPending = false;

  constructor(private readonly root: HTMLElement) {
    clear(root);
    this.globalChrono = h('div', { class: 'hud-chrono', text: '00:00.00' });
    this.objective = h('div', { class: 'hud-objective', text: '' });
    this.complete = h('div', { class: 'hud-complete hidden' });
    this.stats = h('div', { class: 'hud-stats', text: '' });
    this.message = h('div', { class: 'hud-message hidden' });
    this.crosshair = h('div', { class: 'crosshair hidden' }, h('i'), h('i'), h('i'), h('i'), h('b'));
    this.stageName = h('span', { class: 'hud-stage-name', text: '' });
    this.stageSub = h('span', { class: 'hud-stage-sub', text: '' });
    this.stage = h('div', { class: 'hud-stage' }, this.stageName, this.stageSub);
    this.modeLabel = h('div', { class: 'hud-mode hidden', text: '' });
    this.cardName = h('div', { class: 'hud-card-name', text: '' });
    this.cardSub = h('div', { class: 'hud-card-sub', text: '' });
    this.card = h('div', { class: 'hud-card' }, this.cardName, this.cardSub);
    root.append(this.globalChrono, this.objective, this.complete, this.stats, this.message, this.stage, this.modeLabel, this.card, this.crosshair);
    for (let i = 0; i < 2; i++) {
      const speed = h('div', { class: 'hud-speed', text: '0' });
      const heatFill = h('div', { class: 'hud-heat-fill' });
      const heatLabel = h('div', { class: 'hud-heat-label', text: 'CHAUFFE' });
      const hp = h('div', { class: 'hud-hp', text: '' });
      const deaths = h('div', { class: 'hud-deaths', text: '' });
      const kills = h('div', { class: 'hud-kills', text: '' });
      const chrono = h('div', { class: 'hud-run', text: '' });
      const cut = h('div', { class: 'hud-cut hidden', text: 'CUT !' });
      const device = h('div', { class: 'hud-device', text: '' });
      const block = h(
        'div',
        { class: `hud-player hud-p${i + 1}` },
        h('div', { class: 'hud-title', text: `J${i + 1}` }, device),
        h('div', { class: 'hud-speed-row' }, speed, h('span', { class: 'hud-unit', text: 'px/s' })),
        h('div', { class: 'hud-heat' }, heatFill, heatLabel),
        h('div', { class: 'hud-row' }, hp, deaths, kills, chrono),
        cut,
      );
      root.append(block);
      this.blocks.push({ root: block, speed, heatFill, heatLabel, hp, deaths, kills, chrono, cut, device });
    }
  }

  setVisible(v: boolean): void {
    // Le HUD réapparaît (on quitte le menu) : carton-titre à la prochaine mise à jour.
    if (v && this.root.classList.contains('hidden')) this.cardPending = true;
    this.root.classList.toggle('hidden', !v);
  }

  /** La bannière de fin doublonne avec l'écran de fin : on ne la montre qu'en jeu. */
  setBannerVisible(v: boolean): void {
    this.bannerAllowed = v;
  }

  /** Carton-titre : nom du niveau en grand, animation CSS de 2,6 s (rejouée à chaque appel). */
  showCard(stage: StageLabel): void {
    this.cardName.textContent = stage.name;
    this.cardSub.textContent = stage.sub;
    this.card.classList.remove('show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
  }

  update(
    state: GameState,
    loop: GameLoop,
    mapper: InputMapper,
    settings: Settings,
    mouse: { x: number; y: number; visible: boolean },
    renderMs = 0,
    stage: StageLabel | null = null,
    modeText = '',
  ): void {
    const now = performance.now();
    const textTick = now - this.lastTextUpdate > 50; // 20 Hz pour le texte, la barre de chauffe chaque frame
    if (textTick) this.lastTextUpdate = now;
    this.root.classList.toggle('two-players', state.playerCount === 2);
    // Nouvelle manche (le tick repart de zéro) : carton-titre du niveau, qui s'efface tout seul.
    if (state.tick < this.lastTick) this.cardPending = true;
    this.lastTick = state.tick;
    if (stage && this.cardPending) {
      this.cardPending = false;
      this.showCard(stage);
    }
    if (textTick) {
      this.stage.classList.toggle('hidden', !stage);
      if (stage) {
        if (this.stageName.textContent !== stage.name) this.stageName.textContent = stage.name;
        if (this.stageSub.textContent !== stage.sub) this.stageSub.textContent = stage.sub;
      }
      this.modeLabel.classList.toggle('hidden', !modeText);
      if (this.modeLabel.textContent !== modeText) this.modeLabel.textContent = modeText;
    }

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
      b.kills.textContent = `⚔ ${pl.kills}`;
      b.chrono.textContent = formatTime((state.tick - pl.spawnTick) * DT);
      const dev = settings.devices[i];
      const status = mapper.status(i);
      b.device.textContent = dev.kind === 'kbm' ? 'clavier+souris' : status === 'ok' ? 'manette' : 'manette ?';
      b.device.classList.toggle('warn', status !== 'ok');
    }

    if (textTick) {
      const runTicks = state.finished ? state.finishTick : state.tick;
      this.globalChrono.textContent = formatTime(runTicks * DT);
      this.globalChrono.classList.toggle('done', state.finished === 1);
      this.objective.textContent = objectiveText(state);
      this.complete.classList.toggle('hidden', state.finished !== 1 || !this.bannerAllowed);
      if (state.finished) {
        const race = getLevel(state.levelId).mode === 'race';
        this.complete.textContent = race
          ? `ARRIVÉE · ${formatTime(runTicks * DT)}`
          : `NIVEAU TERMINÉ · ${state.kills} ennemi${state.kills > 1 ? 's' : ''} · ${formatTime(runTicks * DT)}`;
      }
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

/** Objectif courant : progression vers l'arrivée (chrono), ou stock d'ennemis (élimination). */
export function objectiveText(state: GameState): string {
  const level = getLevel(state.levelId);
  if (level.mode === 'race') {
    if (state.finished) return '🏁 arrivée franchie';
    const goal = level.goal;
    if (!goal) return '🏁 course';
    const start = level.spawnX;
    const end = goal.x + goal.w / 2;
    let best = 0;
    for (let i = 0; i < state.playerCount; i++) best = Math.max(best, state.players[i].x);
    const span = end - start;
    const pct = span <= 0 ? 100 : Math.max(0, Math.min(100, Math.round(((best - start) / span) * 100)));
    return `🏁 ${pct} % · ${Math.max(0, Math.round((end - best) / 32))} tuiles restantes`;
  }
  if (!state.params.enemiesEnabled) return 'Ennemis désactivés';
  if (state.params.enemiesUnlimited) return `⚔ ${state.kills} · ennemis illimités`;
  const total = state.enemies.length;
  if (total === 0) return '⚔ 0 · aucun ennemi sur cette carte';
  const left = state.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
  return state.finished ? `⚔ ${state.kills} / ${total} · terminé` : `⚔ ${state.kills} / ${total} · ${left} restant${left > 1 ? 's' : ''}`;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
