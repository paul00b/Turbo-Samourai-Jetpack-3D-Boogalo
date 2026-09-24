/**
 * Onglet CARTES : les 4 difficultés avec un aperçu dessiné (minimap 1 px/tuile) et application à chaud.
 * Le sélecteur "en partie" vit ici ; le menu ne garde que le choix d'avant-partie.
 */
import { getLevel, LEVEL_INFOS, LEVEL_MODE_LABEL, T_SLICK, T_SOLID, T_SPIKE, TILE_SIZE, type Level, type LevelMode } from '../sim';
import type { Game } from '../app/game';
import type { SettingsStore } from '../io/settings';
import { clear, h } from './dom';

export interface MapPanelDeps {
  game: Game;
  settings: SettingsStore;
}

const PREVIEW_W = 320;
const COLOR_AIR = '#141920';
const COLOR_SOLID = '#3e4757';
const COLOR_SLICK = '#274a70';
const COLOR_SPIKE = '#d94848';
const COLOR_SPAWN = '#5ae08a';
const COLOR_ENEMY = '#c74b4b';
const COLOR_GOAL = '#5ae08a';

/** Minimap : une tuile = un pixel, mise à l'échelle par le canvas lui-même (pixelated en CSS). */
export function drawLevelPreview(canvas: HTMLCanvasElement, level: Level): void {
  canvas.width = level.width;
  canvas.height = level.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = COLOR_AIR;
  ctx.fillRect(0, 0, level.width, level.height);
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const t = level.tiles[y * level.width + x];
      if (t === 0) continue;
      ctx.fillStyle = t === T_SOLID ? COLOR_SOLID : t === T_SLICK ? COLOR_SLICK : t === T_SPIKE ? COLOR_SPIKE : COLOR_AIR;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (const e of level.enemies) {
    ctx.fillStyle = COLOR_ENEMY;
    ctx.fillRect(Math.floor(e.x / TILE_SIZE), Math.floor(e.y / TILE_SIZE) - 1, 1, 2);
  }
  if (level.goal) {
    ctx.fillStyle = COLOR_GOAL;
    ctx.fillRect(
      Math.floor(level.goal.x / TILE_SIZE),
      Math.floor(level.goal.y / TILE_SIZE),
      Math.max(1, Math.round(level.goal.w / TILE_SIZE)),
      Math.max(1, Math.round(level.goal.h / TILE_SIZE)),
    );
  }
  ctx.fillStyle = COLOR_SPAWN;
  ctx.fillRect(Math.floor(level.spawnX / TILE_SIZE) - 1, Math.floor(level.spawnY / TILE_SIZE) - 1, 2, 2);
}

export class MapPanel {
  private readonly cards = new Map<number, HTMLElement>();
  private readonly status: HTMLElement;
  private shown = -1;

  constructor(
    private readonly panel: HTMLElement,
    private readonly deps: MapPanelDeps,
  ) {
    this.status = h('div', { class: 'debug-info' });
    this.build();
    deps.settings.subscribe(() => this.refresh());
  }

  private build(): void {
    clear(this.panel);
    this.panel.append(
      h('p', { class: 'side-note', text: 'Appliquer une carte relance la partie (même seed, mêmes params).' }),
    );
    this.cards.clear();
    let group: LevelMode | null = null;
    for (const info of LEVEL_INFOS) {
      if (info.mode !== group) {
        group = info.mode;
        this.panel.append(
          h('h3', { text: LEVEL_MODE_LABEL[group] }),
          h('p', {
            class: 'side-note',
            text: group === 'kills'
              ? 'Tuer tout le stock d\'ennemis termine la manche.'
              : 'Cartes longues : atteindre l\'arrivée (zone verte, tout à droite) fige le chrono.',
          }),
        );
      }
      const level = getLevel(info.id);
      const canvas = h('canvas', { class: 'map-preview', width: PREVIEW_W }) as HTMLCanvasElement;
      drawLevelPreview(canvas, level);
      const apply = h('button', { class: 'debug-btn', type: 'button' }, 'Appliquer') as HTMLButtonElement;
      apply.addEventListener('click', () => {
        const net = this.deps.game.net;
        if (net && !net.isHost) {
          this.status.textContent = 'En ligne, la carte est choisie par l\'hôte.';
          return;
        }
        this.deps.game.setLevel(info.id);
        this.refresh();
      });
      const card = h(
        'div',
        { class: 'map-card' },
        h('div', { class: 'map-card-head' }, h('strong', { text: info.name }), h('span', { class: 'debug-unit', text: `${LEVEL_MODE_LABEL[info.mode].toLowerCase()} · ${level.width}×${level.height}` })),
        canvas,
        h('small', { class: 'side-note', text: info.subtitle }),
        h('div', { class: 'debug-row' }, apply, h('span', { class: 'map-current', text: 'en cours' })),
      );
      this.cards.set(info.id, card);
      this.panel.append(card);
    }
    this.panel.append(this.status);
    this.refresh();
  }

  private refresh(): void {
    const current = this.deps.game.state.levelId;
    if (current === this.shown) return;
    this.status.textContent = '';
    this.shown = current;
    for (const [id, card] of this.cards) card.classList.toggle('active', id === current);
    const info = LEVEL_INFOS[current];
    this.status.textContent = info ? `Carte en cours : ${info.name}` : '';
  }

  /** Appelé chaque frame par main.ts (la carte peut changer ailleurs : menu, réseau). */
  update(): void {
    this.refresh();
  }
}
