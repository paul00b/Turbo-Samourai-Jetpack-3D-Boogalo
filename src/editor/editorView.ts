/**
 * Éditeur de niveaux : vue plein écran (DOM + canvas 2D). La grille, les outils, les presets, la
 * validation et le format vivent dans des modules purs (grid, presets, format, levelRules) ; ici on
 * ne fait que l'interface : dessiner, écouter la souris et le clavier, sauvegarder, lancer un test.
 */
import './editor.css';
import type { Game } from '../app/game';
import type { SettingsStore } from '../io/settings';
import { LEVEL_THEMES, setCustomTheme } from '../render/art/themes/painters';
import type { ThemeId } from '../render/art/themes/types';
import { LEVEL_DEFS, parseLevel, setCustomLevel, validateRows, type Level, type LevelIssue } from '../sim';
import { clear, h } from '../ui/dom';
import { exportMap, importMap, type MapDoc } from './format';
import {
  applyCells,
  clipCells,
  copyRect,
  EditGrid,
  floodCells,
  History,
  lineCells,
  paint,
  rectCells,
  resized,
  templateGrid,
  type Cell,
  type Clip,
  type MapMode,
  type TileChar,
} from './grid';
import { defaultValues, presetCells, PRESETS, type Preset, type PresetValues } from './presets';
import { EditorStore, type SavedMap } from './store';

export interface EditorDeps {
  game: Game;
  settings: SettingsStore;
}

type Tool = 'brush' | 'rect' | 'line' | 'fill' | 'pick' | 'select' | 'preset';

interface TileDef {
  c: TileChar;
  label: string;
  key: string;
}

const TILES: readonly TileDef[] = [
  { c: '#', label: 'Mur accrochable', key: '1' },
  { c: '=', label: 'Mur lisse', key: '2' },
  { c: '^', label: 'Pics', key: '3' },
  { c: 'T', label: 'Tremplin', key: '4' },
  { c: '.', label: 'Vide / gomme', key: '5' },
  { c: 'S', label: 'Spawn', key: '6' },
  { c: 'e', label: 'Ennemi', key: '7' },
  { c: 'p', label: 'Patrouille', key: '8' },
  { c: 'F', label: 'Arrivée', key: '9' },
];

const TOOLS: readonly { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'brush', label: 'Pinceau', key: 'B', hint: 'Clic gauche peint, clic droit gomme.' },
  { id: 'rect', label: 'Rectangle', key: 'R', hint: 'Glisser pour un rectangle plein (clic droit : le vider).' },
  { id: 'line', label: 'Ligne', key: 'L', hint: 'Glisser pour une ligne (clic droit : la vider).' },
  { id: 'fill', label: 'Remplir', key: 'G', hint: 'Remplit la zone de même tuile.' },
  { id: 'pick', label: 'Pipette', key: 'I', hint: 'Prend la tuile sous le curseur.' },
  { id: 'select', label: 'Sélection', key: 'M', hint: 'Glisser pour sélectionner ; glisser dedans pour déplacer. Ctrl+C / X / V, Suppr.' },
  { id: 'preset', label: 'Presets', key: 'P', hint: 'Choisis un preset à droite, clic pour poser, R pour le miroir.' },
];

const THEME_LABEL: Record<ThemeId, string> = { port: "Port d'Umibozu", bamboo: 'Bambouseraie maudite', forge: 'Forteresse de braise' };

/** Couleurs de la minimap et du grey-box (même grammaire que le jeu). */
const COL = {
  air: '#141920',
  airAlt: '#171c24',
  solid: '#3e4757',
  solidEdge: '#9aa9c0',
  slick: '#274a70',
  slickHi: '#5f93c9',
  spike: '#d94848',
  spikeBase: '#4a1c22',
  padCase: '#2b303b',
  pad: '#9fe04a',
  spawn: '#4fd1ff',
  enemy: '#c74b4b',
  mask: '#f1ece2',
  goal: 'rgba(90, 224, 138, 0.28)',
  goalEdge: '#5ae08a',
  grid: 'rgba(255,255,255,0.045)',
  grid10: 'rgba(255,255,255,0.11)',
  floor: 'rgba(224, 179, 90, 0.55)',
  hover: '#e0b35a',
  select: '#4fd1ff',
  abyss: '#ff5a5a',
};

export class LevelEditor {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly store = new EditorStore();
  private readonly history = new History();

  private map!: SavedMap;
  private grid!: EditGrid;
  private issues: LevelIssue[] = [];

  private tool: Tool = 'brush';
  private tile: TileChar = '#';
  private preset: Preset = PRESETS[0];
  private presetValues: Record<string, PresetValues> = {};
  private mirrored = false;

  // Vue : coin haut-gauche en tuiles, zoom en px CSS par tuile.
  private camX = 0;
  private camY = 0;
  private zoom = 16;
  private hover: { x: number; y: number } | null = null;
  private flash: { x: number; y: number; until: number } | null = null;

  // Geste en cours.
  private drag: {
    kind: 'paint' | 'shape' | 'pan' | 'select' | 'move';
    button: number;
    x0: number;
    y0: number;
    lastX: number;
    lastY: number;
    sx: number;
    sy: number;
    camX: number;
    camY: number;
  } | null = null;
  private spaceDown = false;
  private selection: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private clipboard: Clip | null = null;
  /** Collage flottant : suit la souris (dx, dy = décalage du curseur dans le bloc). */
  private floating: { clip: Clip; dx: number; dy: number } | null = null;

  private dirty = true;
  private raf = 0;
  private saveTimer = 0;
  private opened = false;
  private viewReady = false;

  // Éléments DOM mis à jour.
  private readonly el: Record<string, HTMLElement> = {};
  private modal: HTMLElement | null = null;

  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly deps: EditorDeps,
  ) {
    this.canvas = h('canvas', { class: 'ed-canvas' });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
    this.root = h('div', { id: 'editor', class: 'hidden' });
    parent.append(this.root);
    this.build();
    this.bindInput();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  // ------------------------------------------------------------------ cycle de vie

  open(): void {
    if (!this.map) this.loadInitial();
    this.opened = true;
    this.root.classList.remove('hidden');
    this.onOpen?.();
    this.resize();
    if (!this.viewReady) {
      // Premier affichage : le canvas n'avait pas de taille quand la carte a été chargée.
      this.fitView();
      this.viewReady = true;
    }
    this.refreshAll();
    this.loop();
  }

  close(): void {
    this.flushSave();
    this.opened = false;
    this.closeModal();
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.onClose?.();
  }

  /** Après un test : le jeu revient au menu, l'éditeur reprend exactement où il en était. */
  returnFromTest(): void {
    this.deps.game.endCustom();
    setCustomLevel(null);
    this.open();
  }

  private loadInitial(): void {
    const id = this.store.currentId;
    const saved = (id && this.store.get(id)) || this.store.list()[0];
    if (saved) this.setMap(saved);
    else this.newMap('kills');
  }

  private setMap(map: SavedMap): void {
    this.map = map;
    this.grid = EditGrid.fromRows(map.rows);
    this.history.clear();
    this.selection = null;
    this.floating = null;
    this.store.currentId = map.id;
    this.fitView();
    this.validate();
    this.refreshAll();
  }

  private newMap(mode: MapMode): void {
    const g = templateGrid(mode);
    const name = this.store.freeName(mode === 'race' ? 'Ma course' : 'Mon arène');
    const map = this.store.create({ name, mode, theme: 'port', rows: g.rows() });
    this.setMap(map);
  }

  // ------------------------------------------------------------------ construction du DOM

  private build(): void {
    const toolBtns = TOOLS.map((t) =>
      h('button', { class: 'ed-tool', type: 'button', 'data-tool': t.id, title: `${t.label} (${t.key}) · ${t.hint}`, onclick: () => this.setTool(t.id) }, h('span', { class: 'ed-tool-name', text: t.label }), h('kbd', { text: t.key })),
    );
    const tileBtns = TILES.map((t) =>
      h(
        'button',
        { class: 'ed-tile', type: 'button', 'data-tile': t.c, title: `${t.label} (${t.key})`, onclick: () => this.setTile(t.c) },
        swatch(t.c),
        h('span', { class: 'ed-tile-name', text: t.label }),
        h('kbd', { text: t.key }),
      ),
    );
    const presetBtns = PRESETS.map((p) => h('button', { class: 'ed-preset', type: 'button', 'data-preset': p.id, onclick: () => this.setPreset(p) }, p.label));

    this.el.name = h('input', { class: 'ed-input ed-name', type: 'text', maxlength: 40, spellcheck: 'false', 'aria-label': 'Nom de la carte' });
    this.el.name.addEventListener('change', () => this.rename((this.el.name as HTMLInputElement).value));
    this.el.mode = h(
      'div',
      { class: 'ed-seg' },
      h('button', { type: 'button', 'data-mode': 'kills', onclick: () => this.setMode('kills') }, 'Arcade'),
      h('button', { type: 'button', 'data-mode': 'race', onclick: () => this.setMode('race') }, 'Course'),
    );
    const themeSel = h('select', { class: 'ed-input', 'aria-label': 'Thème' }, ...(['port', 'bamboo', 'forge'] as ThemeId[]).map((t) => h('option', { value: t, text: THEME_LABEL[t] })));
    themeSel.addEventListener('change', () => this.setTheme(themeSel.value as ThemeId));
    this.el.theme = themeSel;
    this.el.w = h('input', { class: 'ed-input ed-num', type: 'number', min: 24, max: 600, 'aria-label': 'Largeur' });
    this.el.h = h('input', { class: 'ed-input ed-num', type: 'number', min: 16, max: 160, 'aria-label': 'Hauteur' });
    const players = h(
      'div',
      { class: 'ed-seg' },
      h('button', { type: 'button', 'data-players': '1', onclick: () => this.setPlayers(1) }, '1J'),
      h('button', { type: 'button', 'data-players': '2', onclick: () => this.setPlayers(2) }, '2J'),
    );
    this.el.players = players;
    this.el.undo = h('button', { class: 'ed-btn', type: 'button', title: 'Annuler (Ctrl+Z)', onclick: () => this.undo() }, 'Annuler');
    this.el.redo = h('button', { class: 'ed-btn', type: 'button', title: 'Refaire (Ctrl+Y)', onclick: () => this.redo() }, 'Refaire');

    const top = h(
      'header',
      { class: 'ed-top' },
      h('div', { class: 'ed-brand' }, h('span', { class: 'ed-brand-name', text: 'ÉDITEUR' }), h('span', { class: 'ed-brand-sub', text: 'TURBO-SAMOURAÏ' })),
      h('div', { class: 'ed-group' }, this.el.name, this.el.mode, themeSel),
      h(
        'div',
        { class: 'ed-group' },
        h('label', { class: 'ed-label' }, 'L', this.el.w),
        h('label', { class: 'ed-label' }, 'H', this.el.h),
        h('button', { class: 'ed-btn', type: 'button', title: 'Redimensionner (le contenu reste calé en bas à gauche)', onclick: () => this.applySize() }, 'Taille'),
      ),
      h('div', { class: 'ed-group' }, this.el.undo, this.el.redo),
      h('div', { class: 'ed-spacer' }),
      h(
        'div',
        { class: 'ed-group' },
        h('button', { class: 'ed-btn', type: 'button', onclick: () => this.showMaps() }, 'Mes cartes'),
        h('button', { class: 'ed-btn', type: 'button', onclick: () => this.showImport() }, 'Importer'),
        h('button', { class: 'ed-btn', type: 'button', onclick: () => this.showExport() }, 'Exporter'),
      ),
      h('div', { class: 'ed-group' }, players, h('button', { class: 'ed-btn ed-play', type: 'button', title: 'Tester la carte (T)', onclick: () => this.test() }, '▶ Tester'), h('button', { class: 'ed-btn', type: 'button', onclick: () => this.close() }, 'Quitter')),
    );

    this.el.toolHint = h('p', { class: 'ed-hint' });
    const left = h(
      'aside',
      { class: 'ed-left' },
      h('h3', { class: 'ed-h', text: 'Outils' }),
      h('div', { class: 'ed-tools' }, ...toolBtns),
      this.el.toolHint,
      h('h3', { class: 'ed-h', text: 'Tuiles' }),
      h('div', { class: 'ed-tiles' }, ...tileBtns),
    );

    this.el.presetForm = h('div', { class: 'ed-preset-form' });
    this.el.issues = h('div', { class: 'ed-issues' });
    this.el.issuesTitle = h('h3', { class: 'ed-h' });
    const right = h(
      'aside',
      { class: 'ed-right' },
      h('h3', { class: 'ed-h', text: 'Presets' }),
      h('div', { class: 'ed-presets' }, ...presetBtns),
      this.el.presetForm,
      this.el.issuesTitle,
      this.el.issues,
      h('p', { class: 'ed-note', text: 'Carte perso : jeu local seulement (1 ou 2 joueurs). Le multijoueur en ligne joue les cartes officielles.' }),
    );

    this.el.status = h('footer', { class: 'ed-status' });
    const stage = h('div', { class: 'ed-stage' }, this.canvas);
    this.el.stage = stage;
    this.root.append(top, h('div', { class: 'ed-body' }, left, stage, right), this.el.status);
  }

  /** Remet tous les contrôles d'accord avec l'état. */
  private refreshAll(): void {
    if (!this.map) return;
    (this.el.name as HTMLInputElement).value = this.map.name;
    (this.el.theme as HTMLSelectElement).value = this.map.theme;
    (this.el.w as HTMLInputElement).value = String(this.grid.w);
    (this.el.h as HTMLInputElement).value = String(this.grid.h);
    for (const b of this.el.mode.querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === this.map.mode);
    const pc = this.deps.settings.get().playerCount;
    for (const b of this.el.players.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.players) === pc);
    for (const b of this.root.querySelectorAll<HTMLElement>('.ed-tool')) b.classList.toggle('on', b.dataset.tool === this.tool);
    for (const b of this.root.querySelectorAll<HTMLElement>('.ed-tile')) b.classList.toggle('on', b.dataset.tile === this.tile);
    for (const b of this.root.querySelectorAll<HTMLElement>('.ed-preset')) b.classList.toggle('on', this.tool === 'preset' && b.dataset.preset === this.preset.id);
    this.el.toolHint.textContent = TOOLS.find((t) => t.id === this.tool)?.hint ?? '';
    (this.el.undo as HTMLButtonElement).disabled = !this.history.canUndo;
    (this.el.redo as HTMLButtonElement).disabled = !this.history.canRedo;
    this.renderPresetForm();
    this.renderIssues();
    this.renderStatus();
    this.dirty = true;
  }

  private renderPresetForm(): void {
    const f = this.el.presetForm;
    clear(f);
    const p = this.preset;
    const v = this.valuesOf(p);
    f.append(h('p', { class: 'ed-hint', text: p.hint + (p.mirror ? ' R : miroir.' : '') }));
    for (const q of p.params) {
      const input = h('input', { class: 'ed-input ed-num', type: 'number', min: q.min, max: q.max, value: Number(v[q.key]) });
      input.addEventListener('input', () => {
        const n = Math.max(q.min, Math.min(q.max, Math.round(Number(input.value) || q.def)));
        v[q.key] = n;
        this.dirty = true;
      });
      f.append(h('label', { class: 'ed-field' }, h('span', { text: q.label }), input));
    }
    for (const c of p.choices ?? []) {
      const sel = h('select', { class: 'ed-input' }, ...c.options.map((o) => h('option', { value: o.value, text: o.label })));
      sel.value = String(v[c.key]);
      sel.addEventListener('change', () => {
        v[c.key] = sel.value;
        this.dirty = true;
      });
      f.append(h('label', { class: 'ed-field' }, h('span', { text: c.label }), sel));
    }
    if (p.mirror) f.append(h('label', { class: 'ed-field' }, h('span', { text: 'Miroir (R)' }), h('span', { class: 'ed-mirror', text: this.mirrored ? 'oui' : 'non' })));
  }

  private renderIssues(): void {
    const errors = this.issues.filter((i) => i.severity === 'error').length;
    const warns = this.issues.length - errors;
    this.el.issuesTitle.textContent = this.issues.length === 0 ? 'Vérification · tout bon' : `Vérification · ${errors ? `${errors} bloquant${errors > 1 ? 's' : ''}` : ''}${errors && warns ? ' · ' : ''}${warns ? `${warns} conseil${warns > 1 ? 's' : ''}` : ''}`;
    this.el.issuesTitle.classList.toggle('ok', this.issues.length === 0);
    const list = this.el.issues;
    clear(list);
    if (this.issues.length === 0) {
      list.append(h('p', { class: 'ed-ok', text: 'Carte jouable, règles de design respectées.' }));
      return;
    }
    for (const i of this.issues) {
      const item = h('button', { class: `ed-issue ${i.severity}`, type: 'button', title: i.x !== undefined ? 'Centrer la vue dessus' : '' }, h('span', { class: 'ed-issue-dot' }), h('span', { text: i.message }));
      item.addEventListener('click', () => {
        if (i.x !== undefined && i.y !== undefined) this.focusTile(i.x, i.y);
      });
      list.append(item);
      if (i.rule === 'goal-missing') list.append(h('button', { class: 'ed-btn ed-fix', type: 'button', onclick: () => this.addGoal() }, "Ajouter l'arrivée à droite"));
    }
  }

  private renderStatus(): void {
    const hv = this.hover;
    const under = hv && this.grid.inside(hv.x, hv.y) ? TILES.find((t) => t.c === this.grid.get(hv.x, hv.y))?.label ?? '' : '';
    const pos = hv ? `x ${hv.x} · y ${hv.y} · k ${this.grid.kOf(hv.y)}` : '—';
    const saved = this.saveTimer ? 'modifié…' : 'enregistré';
    clear(this.el.status);
    this.el.status.append(
      h('span', { class: 'ed-stat-pos', text: pos }),
      h('span', { text: under }),
      h('span', { text: `${this.grid.w} × ${this.grid.h}` }),
      h('span', { text: `zoom ${Math.round(this.zoom)} px` }),
      h('span', { text: this.selection ? `sélection ${Math.abs(this.selection.x1 - this.selection.x0) + 1} × ${Math.abs(this.selection.y1 - this.selection.y0) + 1}` : '' }),
      h('span', { class: 'ed-spacer' }),
      h('span', { class: 'ed-keys', text: 'Molette : zoom · clic milieu / Espace : déplacer · 0 : cadrer · T : tester' }),
      h('span', { class: `ed-saved${this.saveTimer ? ' pending' : ''}`, text: saved }),
    );
  }

  // ------------------------------------------------------------------ état

  private valuesOf(p: Preset): PresetValues {
    return (this.presetValues[p.id] ??= defaultValues(p));
  }

  private setTool(t: Tool): void {
    this.tool = t;
    if (t !== 'select') this.floating = null;
    this.refreshAll();
  }

  private setTile(c: TileChar): void {
    this.tile = c;
    if (this.tool === 'pick' || this.tool === 'select' || this.tool === 'preset') this.tool = 'brush';
    this.refreshAll();
  }

  private setPreset(p: Preset): void {
    this.preset = p;
    this.mirrored = false;
    this.tool = 'preset';
    this.refreshAll();
  }

  private setPlayers(n: 1 | 2): void {
    this.deps.settings.update((s) => (s.playerCount = n));
    this.refreshAll();
  }

  private rename(name: string): void {
    const n = name.trim().slice(0, 40) || this.map.name;
    this.map.name = n;
    this.scheduleSave();
    this.refreshAll();
  }

  private setMode(mode: MapMode): void {
    if (this.map.mode === mode) return;
    this.map.mode = mode;
    this.validate();
    this.scheduleSave();
    this.refreshAll();
  }

  private setTheme(theme: ThemeId): void {
    this.map.theme = theme;
    this.scheduleSave();
  }

  private applySize(): void {
    const w = Math.max(24, Math.min(600, Math.round(Number((this.el.w as HTMLInputElement).value) || this.grid.w)));
    const hh = Math.max(16, Math.min(160, Math.round(Number((this.el.h as HTMLInputElement).value) || this.grid.h)));
    if (w === this.grid.w && hh === this.grid.h) return;
    this.history.push(this.grid);
    this.grid = resized(this.grid, w, hh);
    this.selection = null;
    this.changed();
    this.fitView();
  }

  /** Après toute modification de la grille. */
  private changed(): void {
    this.map.rows = this.grid.rows();
    this.validate();
    this.scheduleSave();
    this.refreshAll();
  }

  private validate(): void {
    this.issues = validateRows(this.grid.rows(), this.map.mode);
  }

  private scheduleSave(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 500);
  }

  private flushSave(): void {
    if (!this.map) return;
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.map.rows = this.grid.rows();
    this.store.save(this.map);
    if (this.opened) this.renderStatus();
  }

  private edit(fn: () => boolean): void {
    const before = this.grid.clone();
    if (fn()) {
      this.history.push(before);
      this.changed();
    }
  }

  private undo(): void {
    const g = this.history.undo(this.grid);
    if (!g) return;
    this.grid = g;
    this.selection = null;
    this.changed();
  }

  private redo(): void {
    const g = this.history.redo(this.grid);
    if (!g) return;
    this.grid = g;
    this.changed();
  }

  private addGoal(): void {
    this.edit(() => {
      const cells: Cell[] = [];
      for (let y = 1; y < this.grid.floorRow; y++) for (let x = this.grid.w - 9; x <= this.grid.w - 6; x++) if (this.grid.get(x, y) === '.') cells.push({ x, y, c: 'F' });
      return applyCells(this.grid, cells);
    });
  }

  // ------------------------------------------------------------------ test en jeu

  private test(): void {
    const rows = this.grid.rows();
    const blocking = this.issues.filter((i) => i.severity === 'error');
    if (blocking.length) {
      this.toast(`Impossible de tester : ${blocking[0].message}`);
      return;
    }
    let level: Level;
    try {
      level = parseLevel(rows, [], this.map.name, 'Carte perso', this.map.mode);
    } catch (e) {
      this.toast((e as Error).message);
      return;
    }
    this.flushSave();
    setCustomLevel(level);
    setCustomTheme(this.map.theme);
    this.opened = false;
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.deps.game.startCustom(this.deps.settings.get().playerCount);
  }

  private toast(msg: string): void {
    const t = h('div', { class: 'ed-toast', text: msg });
    this.root.append(t);
    window.setTimeout(() => t.remove(), 3200);
  }

  // ------------------------------------------------------------------ fenêtres

  private openModal(title: string, ...children: (Node | null)[]): HTMLElement {
    this.closeModal();
    const box = h('div', { class: 'ed-modal-box' }, h('div', { class: 'ed-modal-head' }, h('h2', { text: title }), h('button', { class: 'ed-btn', type: 'button', onclick: () => this.closeModal() }, 'Fermer')), ...children);
    const m = h('div', { class: 'ed-modal' }, box);
    m.addEventListener('pointerdown', (e) => {
      if (e.target === m) this.closeModal();
    });
    this.root.append(m);
    this.modal = m;
    return box;
  }

  private closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }

  private showMaps(): void {
    this.flushSave();
    const list = h('div', { class: 'ed-maplist' });
    const fill = (): void => {
      clear(list);
      for (const m of this.store.list()) {
        const current = m.id === this.map.id;
        const row = h('div', { class: `ed-maprow${current ? ' current' : ''}` });
        const name = h('input', { class: 'ed-input', type: 'text', value: m.name, maxlength: 40, spellcheck: 'false' });
        name.addEventListener('change', () => {
          const n = name.value.trim() || m.name;
          if (current) this.rename(n);
          else this.store.save({ ...m, name: n });
        });
        const actions = h('div', { class: 'ed-maprow-actions' });
        const normal = (): void => {
          clear(actions);
          actions.append(
            current ? h('span', { class: 'ed-tag', text: 'ouverte' }) : h('button', { class: 'ed-btn', type: 'button', onclick: () => { this.setMap(this.store.get(m.id) ?? m); this.closeModal(); } }, 'Ouvrir'),
            h('button', { class: 'ed-btn', type: 'button', onclick: () => { this.store.create({ ...m, name: this.store.freeName(`${m.name} (copie)`) }); fill(); } }, 'Dupliquer'),
            h('button', { class: 'ed-btn danger', type: 'button', onclick: () => confirmDelete() }, 'Supprimer'),
          );
        };
        const confirmDelete = (): void => {
          clear(actions);
          actions.append(
            h('span', { class: 'ed-confirm', text: 'Supprimer pour de bon ?' }),
            h('button', {
              class: 'ed-btn danger',
              type: 'button',
              onclick: () => {
                this.store.remove(m.id);
                if (current) {
                  const next = this.store.list()[0];
                  if (next) this.setMap(next);
                  else this.newMap(this.map.mode);
                }
                fill();
              },
            }, 'Oui'),
            h('button', { class: 'ed-btn', type: 'button', onclick: () => normal() }, 'Non'),
          );
        };
        normal();
        row.append(h('span', { class: 'ed-tag', text: `${m.mode === 'race' ? 'Course' : 'Arcade'} · ${m.rows[0]?.length ?? 0}×${m.rows.length}` }), name, actions);
        list.append(row);
      }
    };
    fill();
    const officials = h(
      'div',
      { class: 'ed-officials' },
      ...LEVEL_DEFS.map((d, i) =>
        h('button', {
          class: 'ed-btn',
          type: 'button',
          onclick: () => {
            const map = this.store.create({ name: this.store.freeName(`${d.mode === 'race' ? 'Course' : 'Arcade'} ${d.name} (copie)`), mode: d.mode, theme: LEVEL_THEMES[i] ?? 'port', rows: d.rows.slice() });
            this.setMap(map);
            this.closeModal();
          },
        }, `${d.mode === 'race' ? 'Course' : 'Arcade'} ${d.name}`),
      ),
    );
    this.openModal(
      'Mes cartes',
      h('div', { class: 'ed-row' }, h('button', { class: 'ed-btn ed-play', type: 'button', onclick: () => { this.newMap('kills'); this.closeModal(); } }, 'Nouvelle arène'), h('button', { class: 'ed-btn ed-play', type: 'button', onclick: () => { this.newMap('race'); this.closeModal(); } }, 'Nouvelle course')),
      list,
      h('h3', { class: 'ed-h', text: 'Partir d\'une carte officielle (copie)' }),
      officials,
    );
  }

  private showExport(): void {
    this.flushSave();
    const text = exportMap(this.doc());
    const area = h('textarea', { class: 'ed-text', readonly: true, spellcheck: 'false' }) as HTMLTextAreaElement;
    area.value = text;
    const status = h('span', { class: 'ed-note' });
    this.openModal(
      'Exporter',
      h('p', { class: 'ed-note', text: 'Le même format que src/sim/level.ts : colle la constante en haut du fichier et l\'entrée dans LEVEL_DEFS pour en faire une carte officielle.' }),
      area,
      h('div', { class: 'ed-row' }, h('button', {
        class: 'ed-btn ed-play',
        type: 'button',
        onclick: () => {
          navigator.clipboard?.writeText(text).then(
            () => (status.textContent = 'Copié dans le presse-papier.'),
            () => {
              area.select();
              status.textContent = 'Sélectionné : Ctrl+C pour copier.';
            },
          );
        },
      }, 'Copier'), status),
    );
    area.focus();
    area.select();
  }

  private showImport(): void {
    const area = h('textarea', { class: 'ed-text', spellcheck: 'false', placeholder: "Colle ici un export, un bloc de level.ts (const MAP_… = [ '…', ]) ou les lignes de la carte." }) as HTMLTextAreaElement;
    const status = h('span', { class: 'ed-note' });
    const run = (): void => {
      const r = importMap(area.value, { name: 'Carte importée', mode: this.map.mode, theme: this.map.theme });
      if (!r.ok) {
        status.textContent = r.error;
        status.classList.add('bad');
        return;
      }
      const map = this.store.create({ ...r.doc, name: this.store.freeName(r.doc.name) });
      this.setMap(map);
      this.closeModal();
      this.toast(`« ${map.name} » importée (${map.rows[0].length} × ${map.rows.length}).`);
    };
    this.openModal(
      'Importer',
      area,
      h('div', { class: 'ed-row' }, h('button', {
        class: 'ed-btn',
        type: 'button',
        onclick: () => {
          navigator.clipboard?.readText().then((t) => (area.value = t), () => (status.textContent = 'Presse-papier inaccessible : colle avec Ctrl+V.'));
        },
      }, 'Coller'), h('button', { class: 'ed-btn ed-play', type: 'button', onclick: run }, 'Importer'), status),
    );
    area.focus();
  }

  private doc(): MapDoc {
    return { name: this.map.name, mode: this.map.mode, theme: this.map.theme, rows: this.grid.rows() };
  }

  // ------------------------------------------------------------------ vue

  private resize(): void {
    const r = this.el.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.dirty = true;
  }

  private get viewW(): number {
    return this.canvas.width / (window.devicePixelRatio || 1);
  }

  private get viewH(): number {
    return this.canvas.height / (window.devicePixelRatio || 1);
  }

  /** Cadre toute la carte (ou sa hauteur, si elle est très longue). */
  private fitView(): void {
    if (!this.grid) return;
    const vw = this.viewW || 1000;
    const vh = this.viewH || 700;
    const fit = Math.min((vw - 60) / this.grid.w, (vh - 50) / this.grid.h);
    if (fit >= 7) {
      // Toute la carte tient à l'écran : on la centre.
      this.zoom = clamp(fit, 3, 40);
      this.camX = -(vw / this.zoom - this.grid.w) / 2;
    } else {
      // Carte longue : toute la hauteur, calée à gauche (on défile vers l'arrivée).
      this.zoom = clamp((vh - 50) / this.grid.h, 3, 28);
      this.camX = -2;
    }
    this.camY = -(vh / this.zoom - this.grid.h) / 2;
    this.dirty = true;
  }

  private focusTile(x: number, y: number): void {
    this.zoom = Math.max(this.zoom, 18);
    this.camX = x + 0.5 - this.viewW / this.zoom / 2;
    this.camY = y + 0.5 - this.viewH / this.zoom / 2;
    this.flash = { x, y, until: performance.now() + 1400 };
    this.dirty = true;
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const wx = this.camX + sx / this.zoom;
    const wy = this.camY + sy / this.zoom;
    this.zoom = clamp(this.zoom * factor, 3, 64);
    this.camX = wx - sx / this.zoom;
    this.camY = wy - sy / this.zoom;
    this.dirty = true;
  }

  private tileAtScreen(sx: number, sy: number): { x: number; y: number } {
    return { x: Math.floor(this.camX + sx / this.zoom), y: Math.floor(this.camY + sy / this.zoom) };
  }

  private loop(): void {
    const tick = (): void => {
      if (!this.opened) return;
      if (this.flash && performance.now() > this.flash.until) {
        this.flash = null;
        this.dirty = true;
      }
      if (this.dirty || this.flash) this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  private draw(): void {
    this.dirty = false;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const z = this.zoom;
    const g = this.grid;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    const x0 = Math.max(0, Math.floor(this.camX));
    const y0 = Math.max(0, Math.floor(this.camY));
    const x1 = Math.min(g.w - 1, Math.ceil(this.camX + this.viewW / z));
    const y1 = Math.min(g.h - 1, Math.ceil(this.camY + this.viewH / z));
    const sx = (x: number): number => (x - this.camX) * z;
    const sy = (y: number): number => (y - this.camY) * z;

    // Fond de carte + tuiles.
    ctx.fillStyle = COL.air;
    ctx.fillRect(sx(0), sy(0), g.w * z, g.h * z);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) drawTile(ctx, g, x, y, sx(x), sy(y), z, 1);
    }
    // Gouffres : ce qui tombe sort de la carte.
    for (let x = x0; x <= x1; x++) {
      if (g.get(x, g.h - 1) !== '.' || x === 0 || x === g.w - 1) continue;
      const grad = ctx.createLinearGradient(0, sy(g.h), 0, sy(g.h) + z * 1.2);
      grad.addColorStop(0, 'rgba(255, 90, 90, 0.55)');
      grad.addColorStop(1, 'rgba(255, 90, 90, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(sx(x), sy(g.h), z, z * 1.2);
    }

    // Grille.
    if (z >= 7) {
      ctx.lineWidth = 1;
      for (let x = x0; x <= x1 + 1; x++) {
        ctx.strokeStyle = x % 10 === 0 ? COL.grid10 : COL.grid;
        ctx.beginPath();
        ctx.moveTo(Math.round(sx(x)) + 0.5, sy(y0));
        ctx.lineTo(Math.round(sx(x)) + 0.5, sy(y1 + 1));
        ctx.stroke();
      }
      for (let y = y0; y <= y1 + 1; y++) {
        ctx.strokeStyle = (g.floorRow - y) % 10 === 0 ? COL.grid10 : COL.grid;
        ctx.beginPath();
        ctx.moveTo(sx(x0), Math.round(sy(y)) + 0.5);
        ctx.lineTo(sx(x1 + 1), Math.round(sy(y)) + 0.5);
        ctx.stroke();
      }
    }
    // Surface du sol (k = 0).
    ctx.strokeStyle = COL.floor;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sx(0), Math.round(sy(g.floorRow)) + 0.5);
    ctx.lineTo(sx(g.w), Math.round(sy(g.floorRow)) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Aperçu de l'outil.
    const ghost = this.ghostCells();
    if (ghost.length) {
      ctx.globalAlpha = 0.62;
      const tmp = g.clone();
      for (const k of ghost) tmp.set(k.x, k.y, k.c);
      for (const k of ghost) if (g.inside(k.x, k.y)) drawTile(ctx, tmp, k.x, k.y, sx(k.x), sy(k.y), z, 1);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(224, 179, 90, 0.4)';
      ctx.lineWidth = 1;
      for (const k of ghost) if (g.inside(k.x, k.y)) ctx.strokeRect(sx(k.x) + 0.5, sy(k.y) + 0.5, z - 1, z - 1);
    }

    // Sélection.
    if (this.selection) {
      const s = normRect(this.selection);
      ctx.strokeStyle = COL.select;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -(performance.now() / 60) % 9;
      ctx.strokeRect(sx(s.x0), sy(s.y0), (s.x1 - s.x0 + 1) * z, (s.y1 - s.y0 + 1) * z);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(79, 209, 255, 0.08)';
      ctx.fillRect(sx(s.x0), sy(s.y0), (s.x1 - s.x0 + 1) * z, (s.y1 - s.y0 + 1) * z);
      this.dirty = true; // fourmis en marche
    }

    // Survol.
    if (this.hover && g.inside(this.hover.x, this.hover.y)) {
      ctx.strokeStyle = COL.hover;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(this.hover.x) + 1, sy(this.hover.y) + 1, z - 2, z - 2);
    }
    if (this.flash) {
      const a = Math.max(0, (this.flash.until - performance.now()) / 1400);
      ctx.strokeStyle = `rgba(255, 90, 90, ${a})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(sx(this.flash.x) - 4, sy(this.flash.y) - 4, z + 8, z + 8);
    }

    // Règles : x tous les 10, k tous les 5.
    ctx.fillStyle = 'rgba(10, 12, 18, 0.82)';
    ctx.fillRect(0, 0, this.viewW, 16);
    ctx.fillRect(0, 0, 30, this.viewH);
    ctx.font = '10px DotGothic16, monospace';
    ctx.fillStyle = '#9097a8';
    ctx.textBaseline = 'middle';
    const stepX = z < 6 ? 20 : 10;
    for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1; x += stepX) ctx.fillText(String(x), sx(x) + 2, 8);
    const stepK = z < 8 ? 10 : 5;
    for (let y = y0; y <= y1; y++) {
      const k = g.floorRow - y;
      if (k % stepK !== 0) continue;
      ctx.fillStyle = k === 0 ? '#e0b35a' : '#9097a8';
      ctx.fillText(`k${k}`, 3, sy(y) + z / 2);
    }
  }

  /** Ce que l'outil poserait maintenant (aperçu fantôme). */
  private ghostCells(): Cell[] {
    const hv = this.hover;
    if (this.floating && hv) return clipCells(this.floating.clip, hv.x - this.floating.dx, hv.y - this.floating.dy);
    if (this.drag?.kind === 'shape' && hv) {
      const c = this.drag.button === 2 ? '.' : this.tile;
      return this.tool === 'rect' ? rectCells(this.drag.x0, this.drag.y0, hv.x, hv.y, c) : lineCells(this.drag.x0, this.drag.y0, hv.x, hv.y, c);
    }
    if (this.tool === 'preset' && hv && !this.drag) return presetCells(this.preset, this.grid, hv.x, hv.y, this.valuesOf(this.preset), this.mirrored);
    return [];
  }

  // ------------------------------------------------------------------ entrées

  private bindInput(): void {
    window.addEventListener('resize', () => {
      if (this.opened) this.resize();
    });
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      if (e.shiftKey) {
        this.camX += (e.deltaY / this.zoom) * 0.6;
        this.dirty = true;
        return;
      }
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      this.renderStatus();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.hover = null;
        this.dirty = true;
        this.renderStatus();
      }
    });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  private local(e: PointerEvent): { sx: number; sy: number } {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  private onDown(e: PointerEvent): void {
    if (this.modal) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const { sx, sy } = this.local(e);
    const t = this.tileAtScreen(sx, sy);
    const base = { button: e.button, x0: t.x, y0: t.y, lastX: t.x, lastY: t.y, sx, sy, camX: this.camX, camY: this.camY };
    if (e.button === 1 || this.spaceDown) {
      this.drag = { kind: 'pan', ...base };
      this.canvas.classList.add('panning');
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    // Collage flottant : un clic le pose.
    if (this.floating) {
      if (e.button === 0) {
        const f = this.floating;
        this.edit(() => applyCells(this.grid, clipCells(f.clip, t.x - f.dx, t.y - f.dy)));
        this.selection = { x0: t.x - f.dx, y0: t.y - f.dy, x1: t.x - f.dx + f.clip.w - 1, y1: t.y - f.dy + f.clip.h - 1 };
      }
      this.floating = null;
      this.refreshAll();
      return;
    }
    const erase = e.button === 2;
    switch (this.tool) {
      case 'brush': {
        const before = this.grid.clone();
        paint(this.grid, t.x, t.y, erase ? '.' : this.tile);
        this.history.push(before);
        this.drag = { kind: 'paint', ...base };
        this.dirty = true;
        break;
      }
      case 'rect':
      case 'line':
        this.drag = { kind: 'shape', ...base };
        this.dirty = true;
        break;
      case 'fill':
        this.edit(() => applyCells(this.grid, floodCells(this.grid, t.x, t.y, erase ? '.' : this.tile)));
        break;
      case 'pick':
        if (this.grid.inside(t.x, t.y)) {
          this.tile = this.grid.get(t.x, t.y);
          this.tool = 'brush';
          this.refreshAll();
        }
        break;
      case 'select': {
        const s = this.selection ? normRect(this.selection) : null;
        if (s && !erase && t.x >= s.x0 && t.x <= s.x1 && t.y >= s.y0 && t.y <= s.y1) {
          // Déplacer : on soulève le bloc, il suit la souris jusqu'au relâché.
          const clip = copyRect(this.grid, s.x0, s.y0, s.x1, s.y1);
          this.edit(() => applyCells(this.grid, rectCells(s.x0, s.y0, s.x1, s.y1, '.')));
          this.floating = { clip, dx: t.x - s.x0, dy: t.y - s.y0 };
          this.selection = null;
          this.drag = { kind: 'move', ...base };
        } else {
          this.selection = erase ? null : { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
          this.drag = erase ? null : { kind: 'select', ...base };
        }
        this.refreshAll();
        break;
      }
      case 'preset':
        if (erase) {
          this.mirrored = !this.mirrored;
          this.refreshAll();
          break;
        }
        this.edit(() => applyCells(this.grid, presetCells(this.preset, this.grid, t.x, t.y, this.valuesOf(this.preset), this.mirrored)));
        break;
    }
  }

  private onMove(e: PointerEvent): void {
    const { sx, sy } = this.local(e);
    const t = this.tileAtScreen(sx, sy);
    const d = this.drag;
    if (d?.kind === 'pan') {
      this.camX = d.camX - (sx - d.sx) / this.zoom;
      this.camY = d.camY - (sy - d.sy) / this.zoom;
      this.dirty = true;
      return;
    }
    const moved = !this.hover || this.hover.x !== t.x || this.hover.y !== t.y;
    this.hover = t;
    if (!moved) return;
    if (d?.kind === 'paint') {
      for (const k of lineCells(d.lastX, d.lastY, t.x, t.y, d.button === 2 ? '.' : this.tile)) paint(this.grid, k.x, k.y, k.c);
      d.lastX = t.x;
      d.lastY = t.y;
    } else if (d?.kind === 'select' && this.selection) {
      this.selection.x1 = t.x;
      this.selection.y1 = t.y;
    }
    this.dirty = true;
    this.renderStatus();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.canvas.classList.remove('panning');
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    const { sx, sy } = this.local(e);
    const t = this.tileAtScreen(sx, sy);
    if (d.kind === 'paint') this.changed();
    else if (d.kind === 'shape') {
      const c = d.button === 2 ? '.' : this.tile;
      const cells = this.tool === 'rect' ? rectCells(d.x0, d.y0, t.x, t.y, c) : lineCells(d.x0, d.y0, t.x, t.y, c);
      this.edit(() => applyCells(this.grid, cells));
    } else if (d.kind === 'move' && this.floating) {
      const f = this.floating;
      const before = this.grid.clone();
      applyCells(this.grid, clipCells(f.clip, t.x - f.dx, t.y - f.dy));
      this.history.push(before);
      this.selection = { x0: t.x - f.dx, y0: t.y - f.dy, x1: t.x - f.dx + f.clip.w - 1, y1: t.y - f.dy + f.clip.h - 1 };
      this.floating = null;
      this.changed();
    } else this.refreshAll();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.opened) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (e.code === 'Space') {
      if (typing) return;
      this.spaceDown = down;
      this.canvas.classList.toggle('pan-ready', down);
      e.preventDefault();
      return;
    }
    if (!down) return;
    if (this.modal) {
      if (e.code === 'Escape') this.closeModal();
      return;
    }
    if (typing) {
      if (e.code === 'Escape' || e.code === 'Enter') target?.blur();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) {
      const k = e.code;
      if (k === 'KeyZ' && !e.shiftKey) this.undo();
      else if (k === 'KeyY' || (k === 'KeyZ' && e.shiftKey)) this.redo();
      else if (k === 'KeyC') this.copy(false);
      else if (k === 'KeyX') this.copy(true);
      else if (k === 'KeyV') this.paste();
      else if (k === 'KeyA') {
        this.tool = 'select';
        this.selection = { x0: 0, y0: 0, x1: this.grid.w - 1, y1: this.grid.h - 1 };
        this.refreshAll();
      } else return;
      e.preventDefault();
      return;
    }
    const digit = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
    if (digit) {
      this.setTile(TILES[Number(digit[1]) - 1].c);
      e.preventDefault();
      return;
    }
    const pan = 60 / this.zoom;
    switch (e.code) {
      case 'KeyB':
        this.setTool('brush');
        break;
      case 'KeyR':
        if (this.tool === 'preset') {
          this.mirrored = !this.mirrored;
          this.refreshAll();
        } else this.setTool('rect');
        break;
      case 'KeyL':
        this.setTool('line');
        break;
      case 'KeyG':
        this.setTool('fill');
        break;
      case 'KeyI':
        this.setTool('pick');
        break;
      case 'KeyM':
        this.setTool('select');
        break;
      case 'KeyP':
        this.setTool('preset');
        break;
      case 'KeyT':
        this.test();
        break;
      case 'Digit0':
      case 'Numpad0':
        this.fitView();
        break;
      case 'Equal':
      case 'NumpadAdd':
        this.zoomAt(this.viewW / 2, this.viewH / 2, 1.25);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        this.zoomAt(this.viewW / 2, this.viewH / 2, 0.8);
        break;
      case 'ArrowLeft':
        this.camX -= pan;
        break;
      case 'ArrowRight':
        this.camX += pan;
        break;
      case 'ArrowUp':
        this.camY -= pan;
        break;
      case 'ArrowDown':
        this.camY += pan;
        break;
      case 'Delete':
      case 'Backspace':
        if (this.selection) {
          const s = normRect(this.selection);
          this.edit(() => applyCells(this.grid, rectCells(s.x0, s.y0, s.x1, s.y1, '.')));
        }
        break;
      case 'Escape':
        if (this.floating) this.floating = null;
        else if (this.selection) this.selection = null;
        else if (this.drag) this.drag = null;
        this.refreshAll();
        break;
      default:
        return;
    }
    this.dirty = true;
    e.preventDefault();
  }

  private copy(cut: boolean): void {
    if (!this.selection) return;
    const s = normRect(this.selection);
    this.clipboard = copyRect(this.grid, s.x0, s.y0, s.x1, s.y1);
    if (cut) this.edit(() => applyCells(this.grid, rectCells(s.x0, s.y0, s.x1, s.y1, '.')));
    this.toast(`${cut ? 'Coupé' : 'Copié'} : ${this.clipboard.w} × ${this.clipboard.h}. Ctrl+V pour coller.`);
  }

  private paste(): void {
    if (!this.clipboard) return;
    this.tool = 'select';
    this.selection = null;
    this.floating = { clip: this.clipboard, dx: 0, dy: 0 };
    this.refreshAll();
  }
}

// ------------------------------------------------------------------ dessin des tuiles

function drawTile(ctx: CanvasRenderingContext2D, g: EditGrid, x: number, y: number, px: number, py: number, z: number, alpha: number): void {
  const c = g.get(x, y);
  const s = Math.ceil(z);
  ctx.globalAlpha *= alpha;
  if (c === '.' || c === 'S' || c === 'e' || c === 'p' || c === 'F') {
    ctx.fillStyle = (x + y) % 2 === 0 ? COL.air : COL.airAlt;
    ctx.fillRect(px, py, s, s);
  }
  switch (c) {
    case '#': {
      ctx.fillStyle = COL.solid;
      ctx.fillRect(px, py, s, s);
      const up = g.get(x, y - 1);
      if (y > 0 && (up === '.' || up === 'S' || up === 'e' || up === 'p' || up === 'F')) {
        ctx.fillStyle = COL.solidEdge;
        ctx.fillRect(px, py, s, Math.max(1, z / 8));
      }
      break;
    }
    case '=':
      ctx.fillStyle = COL.slick;
      ctx.fillRect(px, py, s, s);
      if (z >= 8) {
        ctx.strokeStyle = COL.slickHi;
        ctx.lineWidth = Math.max(1, z / 14);
        ctx.beginPath();
        ctx.moveTo(px + z * 0.2, py + z * 0.8);
        ctx.lineTo(px + z * 0.8, py + z * 0.2);
        ctx.stroke();
      }
      break;
    case '^':
      ctx.fillStyle = COL.spikeBase;
      ctx.fillRect(px, py, s, s);
      ctx.fillStyle = COL.spike;
      ctx.beginPath();
      ctx.moveTo(px, py + z);
      ctx.lineTo(px + z * 0.25, py + z * 0.15);
      ctx.lineTo(px + z * 0.5, py + z);
      ctx.lineTo(px + z * 0.75, py + z * 0.15);
      ctx.lineTo(px + z, py + z);
      ctx.fill();
      break;
    case 'T':
      ctx.fillStyle = COL.padCase;
      ctx.fillRect(px, py + z * 0.3, s, s - z * 0.3);
      ctx.fillStyle = COL.pad;
      ctx.fillRect(px + 1, py, s - 2, Math.max(2, z * 0.22));
      if (z >= 10) {
        ctx.beginPath();
        ctx.moveTo(px + z * 0.28, py + z * 0.85);
        ctx.lineTo(px + z * 0.5, py + z * 0.5);
        ctx.lineTo(px + z * 0.72, py + z * 0.85);
        ctx.fill();
      }
      break;
    case 'S':
      ctx.fillStyle = COL.spawn;
      ctx.beginPath();
      ctx.arc(px + z / 2, py + z / 2, z * 0.36, 0, Math.PI * 2);
      ctx.fill();
      if (z >= 12) {
        ctx.fillStyle = '#0d0f16';
        ctx.font = `${Math.round(z * 0.55)}px DotGothic16, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('S', px + z / 2, py + z / 2 + 1);
        ctx.textAlign = 'start';
      }
      break;
    case 'e':
    case 'p':
      ctx.fillStyle = COL.enemy;
      ctx.fillRect(px + z * 0.18, py + z * 0.12, z * 0.64, z * 0.82);
      ctx.fillStyle = COL.mask;
      ctx.fillRect(px + z * 0.3, py + z * 0.26, z * 0.4, z * 0.22);
      if (c === 'p' && z >= 10) {
        ctx.fillStyle = '#e0b35a';
        ctx.beginPath();
        ctx.moveTo(px, py + z * 0.7);
        ctx.lineTo(px + z * 0.16, py + z * 0.58);
        ctx.lineTo(px + z * 0.16, py + z * 0.82);
        ctx.moveTo(px + z, py + z * 0.7);
        ctx.lineTo(px + z * 0.84, py + z * 0.58);
        ctx.lineTo(px + z * 0.84, py + z * 0.82);
        ctx.fill();
      }
      break;
    case 'F':
      ctx.fillStyle = COL.goal;
      ctx.fillRect(px, py, s, s);
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(90, 224, 138, 0.18)';
        ctx.fillRect(px, py, s, s);
      }
      if (g.get(x - 1, y) !== 'F') {
        ctx.fillStyle = COL.goalEdge;
        ctx.fillRect(px, py, Math.max(1, z / 8), s);
      }
      break;
    default:
      break;
  }
  ctx.globalAlpha /= alpha;
}

/** Petite pastille de la palette. */
function swatch(c: TileChar): HTMLCanvasElement {
  const cv = h('canvas', { class: 'ed-swatch', width: 20, height: 20 });
  const ctx = cv.getContext('2d');
  if (ctx) {
    const g = EditGrid.fromRows(['...', `.${c}.`, '...']);
    ctx.fillStyle = COL.air;
    ctx.fillRect(0, 0, 20, 20);
    drawTile(ctx, g, 1, 1, 0, 0, 20, 1);
  }
  return cv;
}

function normRect(s: { x0: number; y0: number; x1: number; y1: number }): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
