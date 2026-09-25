/**
 * Panneau de debug (DOM) : sliders + champ numérique par paramètre, toggles, seed, export/import JSON,
 * auto-test de déterminisme, test de rollback, infos live (tick, hash, TPS).
 */
import {
  PARAM_META,
  PARAM_TOGGLES,
  runDeterminismSelfTest,
  type ParamGroup,
  type SimParams,
} from '../sim';
import type { Game } from '../app/game';
import { exportConfig, parseConfig, type ParamsStore } from '../io/paramsStore';
import { RENDER_MODES, THEME_CHOICES, type RenderMode, type SettingsStore, type ThemeChoice } from '../io/settings';
import { getTheme } from '../render/art/themes';
import type { Renderer } from '../render/renderer';
import { clear, h } from './dom';

export interface DebugDeps {
  game: Game;
  settings: SettingsStore;
  params: ParamsStore;
  /** Pour afficher le thème réellement dessiné et le coût du rendu pixel. */
  renderer?: Renderer;
}

const RENDER_MODE_TEXT: Record<RenderMode, string> = {
  art: 'Jeu : pixel art, toutes couches',
  values: 'Valeurs : 6 niveaux de gris',
  play: 'Couche de jeu : décor coupé',
  greybox: 'Grey-box : rendu du proto',
};

const THEME_TEXT: Record<ThemeChoice, string> = {
  auto: 'Auto : le thème de la carte',
  port: "Port d'Umibozu",
  forge: 'Forteresse de braise',
  bamboo: 'Bambouseraie maudite',
};

const GROUP_ORDER: ParamGroup[] = ['Mouvement', 'Grappin', 'Jetpack', 'Mort', 'Ennemis', 'Solveur'];

export class DebugPanel {
  private readonly info: HTMLElement;
  private readonly netInfo: HTMLElement;
  private readonly result: HTMLElement;
  private readonly sliders = new Map<keyof SimParams, { range: HTMLInputElement; num: HTMLInputElement }>();
  private readonly toggles = new Map<keyof SimParams, HTMLInputElement>();
  private lastInfo = 0;
  private lockedForGuest: boolean | null = null;
  private seedInput!: HTMLInputElement;
  private importArea!: HTMLTextAreaElement;
  private readonly countButtons = new Map<number, HTMLButtonElement>();
  private camSelect: HTMLSelectElement | null = null;
  private renderSelect: HTMLSelectElement | null = null;
  private themeSelect: HTMLSelectElement | null = null;
  private readonly renderInfo = h('div', { class: 'debug-info' });
  private readonly swatches = h('div', { class: 'swatch-row' });
  private shownSwatches = '';

  constructor(
    private readonly panel: HTMLElement,
    private readonly deps: DebugDeps,
  ) {
    this.info = h('div', { class: 'debug-info' });
    this.netInfo = h('div', { class: 'debug-info' });
    this.result = h('div', { class: 'debug-result' });
    this.build();
    deps.params.subscribe(() => this.refreshValues());
    deps.settings.subscribe((s) => {
      for (const [n, b] of this.countButtons) b.classList.toggle('selected', s.playerCount === n);
      if (this.camSelect && this.camSelect.value !== s.cameraMode) this.camSelect.value = s.cameraMode;
      if (this.renderSelect && this.renderSelect.value !== s.render.mode) this.renderSelect.value = s.render.mode;
      if (this.themeSelect && this.themeSelect.value !== s.render.theme) this.themeSelect.value = s.render.theme;
    });
  }

  /** Direction artistique : mode de rendu (dont Valeurs et Couche de jeu des planches), thème. */
  private buildRender(p: HTMLElement): void {
    const s = this.deps.settings.get();
    p.append(h('h3', { text: 'Rendu (direction artistique)' }));
    const mode = h('select', { class: 'debug-select' }) as HTMLSelectElement;
    for (const m of RENDER_MODES) mode.append(h('option', { value: m, text: RENDER_MODE_TEXT[m] }));
    mode.value = s.render.mode;
    mode.addEventListener('change', () => this.deps.settings.update((st) => (st.render.mode = mode.value as RenderMode)));
    this.renderSelect = mode;
    const theme = h('select', { class: 'debug-select' }) as HTMLSelectElement;
    for (const t of THEME_CHOICES) theme.append(h('option', { value: t, text: THEME_TEXT[t] }));
    theme.value = s.render.theme;
    theme.addEventListener('change', () => this.deps.settings.update((st) => (st.render.theme = theme.value as ThemeChoice)));
    this.themeSelect = theme;
    p.append(
      h('div', { class: 'debug-row' }, h('label', { text: 'Mode (F8)' }), mode),
      h('div', { class: 'debug-row', style: 'margin-top:6px' }, h('label', { text: 'Thème' }), theme),
      this.checkbox('Pixels entiers (zoom solo/split calé)', s.render.pixelSnap, (v) => this.deps.settings.update((st) => (st.render.pixelSnap = v))),
      h('p', { class: 'side-note', text: 'Valeurs : le perso doit rester la forme la plus nette. Couche de jeu : ce qui reste est tout ce qui compte pour jouer.' }),
      this.swatches,
      this.renderInfo,
    );
  }

  private build(): void {
    const p = this.panel;
    clear(p);
    const s = this.deps.settings.get();
    this.buildRender(p);

    // ---- Seed
    this.seedInput = h('input', { type: 'number', value: s.seed, min: 0, step: 1, class: 'debug-num wide' }) as HTMLInputElement;
    p.append(
      h('h3', { text: 'Seed (PRNG mulberry32)' }),
      h(
        'div',
        { class: 'debug-row' },
        this.seedInput,
        this.button('Appliquer + recommencer', () => {
          const v = Math.max(0, Math.floor(Number(this.seedInput.value) || 0)) >>> 0;
          this.deps.settings.update((st) => (st.seed = v));
          this.deps.game.restart();
        }),
        this.button('Aléatoire', () => {
          const v = (Math.random() * 0xffffffff) >>> 0;
          this.seedInput.value = String(v);
          this.deps.settings.update((st) => (st.seed = v));
          this.deps.game.restart();
        }),
      ),
    );

    // ---- Toggles hors sim
    p.append(h('h3', { text: 'Session' }));
    const countRow = h('div', { class: 'debug-row' });
    this.countButtons.clear();
    for (const n of [1, 2] as const) {
      const b = this.button(`${n} joueur${n > 1 ? 's' : ''}`, () => {
        this.deps.settings.update((st) => (st.playerCount = n));
        this.deps.game.setPlayerCount(n);
      });
      b.classList.toggle('selected', s.playerCount === n);
      this.countButtons.set(n, b);
      countRow.append(b);
    }
    p.append(countRow);
    const camSel = h('select', { class: 'debug-select' }) as HTMLSelectElement;
    this.camSelect = camSel;
    camSel.append(h('option', { value: 'single', text: 'Caméra unique (zoom dynamique)' }), h('option', { value: 'split', text: 'Split vertical' }));
    camSel.value = s.cameraMode;
    camSel.addEventListener('change', () => this.deps.settings.update((st) => (st.cameraMode = camSel.value === 'split' ? 'split' : 'single')));
    p.append(h('div', { class: 'debug-row' }, h('label', { text: 'Mode caméra (F2)' }), camSel));
    p.append(
      this.checkbox('Hitboxes visibles (F3)', s.debug.showHitboxes, (v) => this.deps.settings.update((st) => (st.debug.showHitboxes = v))),
      this.checkbox('Vecteurs de vélocité (F4)', s.debug.showVelocity, (v) => this.deps.settings.update((st) => (st.debug.showVelocity = v))),
      this.checkbox('Trail de trajectoire (F6)', s.debug.showTrail, (v) => this.deps.settings.update((st) => (st.debug.showTrail = v))),
    );
    p.append(
      this.genericSlider('Durée du trail', s.debug.trailSeconds, 0.5, 15, 0.5, 's', (v) => this.deps.settings.update((st) => (st.debug.trailSeconds = v))),
    );

    // ---- Toggles sim
    p.append(h('h3', { text: 'Toggles (sim)' }));
    for (const t of PARAM_TOGGLES) {
      const cb = this.checkbox(t.label, this.deps.params.get()[t.key] !== 0, (v) => this.deps.params.set(t.key, v ? 1 : 0));
      this.toggles.set(t.key, cb.querySelector('input') as HTMLInputElement);
      p.append(cb);
    }

    // ---- Sliders par groupe
    for (const group of GROUP_ORDER) {
      const metas = PARAM_META.filter((m) => m.group === group);
      if (metas.length === 0) continue;
      p.append(h('h3', { text: group }));
      for (const m of metas) {
        const value = this.deps.params.get()[m.key];
        const range = h('input', { type: 'range', min: m.min, max: m.max, step: m.step, value }) as HTMLInputElement;
        const num = h('input', { type: 'number', min: m.min, max: m.max, step: m.step, value, class: 'debug-num' }) as HTMLInputElement;
        range.addEventListener('input', () => {
          num.value = range.value;
          this.deps.params.set(m.key, Number(range.value));
        });
        num.addEventListener('change', () => {
          this.deps.params.set(m.key, Number(num.value));
          const v = this.deps.params.get()[m.key];
          num.value = String(v);
          range.value = String(v);
        });
        this.sliders.set(m.key, { range, num });
        p.append(
          h(
            'div',
            { class: 'debug-param', title: m.hint ?? '' },
            h('label', {}, m.label, m.unit ? h('span', { class: 'debug-unit', text: ` ${m.unit}` }) : null),
            h('div', { class: 'debug-row' }, range, num),
          ),
        );
      }
    }

    // ---- Caméra (rendu)
    p.append(h('h3', { text: 'Caméra (rendu)' }));
    const cam = s.camera;
    p.append(
      this.genericSlider('Zoom min (2J)', cam.zoomMin, 0.1, 1.5, 0.05, '', (v) => this.deps.settings.update((st) => (st.camera.zoomMin = v))),
      this.genericSlider('Zoom max (2J)', cam.zoomMax, 0.2, 2, 0.05, '', (v) => this.deps.settings.update((st) => (st.camera.zoomMax = v))),
      this.genericSlider('Zoom solo', cam.soloZoom, 0.2, 2, 0.05, '', (v) => this.deps.settings.update((st) => (st.camera.soloZoom = v))),
      this.genericSlider('Zoom split', cam.splitZoom, 0.2, 2, 0.05, '', (v) => this.deps.settings.update((st) => (st.camera.splitZoom = v))),
      this.genericSlider('Marge autour des joueurs', cam.margin, 0, 800, 10, 'px', (v) => this.deps.settings.update((st) => (st.camera.margin = v))),
      this.genericSlider('Lissage caméra', cam.smoothing, 1, 30, 0.5, '/s', (v) => this.deps.settings.update((st) => (st.camera.smoothing = v))),
    );

    // ---- Actions
    p.append(h('h3', { text: 'Config' }));
    this.importArea = h('textarea', { class: 'debug-import hidden', placeholder: 'Colle ici un JSON exporté…', rows: 6 }) as HTMLTextAreaElement;
    p.append(
      h(
        'div',
        { class: 'debug-row wrap' },
        this.button('Reset aux défauts', () => {
          this.deps.params.resetDefaults();
          this.flash('Paramètres remis aux défauts.');
        }),
        this.button('Exporter JSON', () => this.exportJson(true)),
        this.button('Copier JSON', () => this.exportJson(false)),
        this.button('Importer JSON…', () => {
          this.importArea.classList.toggle('hidden');
          this.importArea.focus();
        }),
      ),
      this.importArea,
      h(
        'div',
        { class: 'debug-row wrap' },
        this.button('Appliquer le JSON collé', () => this.importJson()),
      ),
    );

    p.append(h('h3', { text: 'Déterminisme' }));
    p.append(
      h(
        'div',
        { class: 'debug-row wrap' },
        this.button('Auto-test 1000 ticks', () => {
          const t0 = performance.now();
          const r = runDeterminismSelfTest(1000, 1234);
          const ms = performance.now() - t0;
          this.flash(`Auto-test : hash ${r.hashHex} en ${ms.toFixed(1)} ms (${r.deaths} morts, ${r.events} événements). Compare ce hash entre navigateurs.`);
        }),
        this.button('Test rollback (60 ticks)', () => {
          const r = this.deps.game.rollbackTest(60);
          this.flash(
            r.ok
              ? `Rollback OK : re-simulation de ${r.depth} ticks identique (hash ${r.hashResim}) en ${r.ms.toFixed(2)} ms.`
              : `Rollback KO : live ${r.hashLive} ≠ resim ${r.hashResim}`,
            !r.ok,
          );
        }),
        this.button('Recommencer', () => this.deps.game.restart()),
      ),
      this.result,
      this.info,
      this.netInfo,
    );
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { class: 'debug-btn', type: 'button' }, label) as HTMLButtonElement;
    b.addEventListener('click', onClick);
    return b;
  }

  private checkbox(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'debug-check' }, input, h('span', { text: label }));
  }

  private genericSlider(label: string, value: number, min: number, max: number, step: number, unit: string, onChange: (v: number) => void): HTMLElement {
    const range = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement;
    const num = h('input', { type: 'number', min, max, step, value, class: 'debug-num' }) as HTMLInputElement;
    range.addEventListener('input', () => {
      num.value = range.value;
      onChange(Number(range.value));
    });
    num.addEventListener('change', () => {
      const v = Math.min(max, Math.max(min, Number(num.value) || 0));
      num.value = String(v);
      range.value = String(v);
      onChange(v);
    });
    return h('div', { class: 'debug-param' }, h('label', {}, label, unit ? h('span', { class: 'debug-unit', text: ` ${unit}` }) : null), h('div', { class: 'debug-row' }, range, num));
  }

  private refreshValues(): void {
    const p = this.deps.params.get();
    for (const [key, ui] of this.sliders) {
      ui.range.value = String(p[key]);
      ui.num.value = String(p[key]);
    }
    for (const [key, cb] of this.toggles) cb.checked = p[key] !== 0;
  }

  private exportJson(download: boolean): void {
    const s = this.deps.settings.get();
    const json = exportConfig({
      seed: s.seed,
      params: { ...this.deps.params.get() },
      debug: s.debug,
      camera: s.camera,
      cameraMode: s.cameraMode,
      playerCount: s.playerCount,
    });
    if (download) {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tsj-config-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this.flash('Config exportée (téléchargement).');
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(
        () => this.flash(download ? 'Config exportée et copiée dans le presse-papier.' : 'Config copiée dans le presse-papier.'),
        () => {
          this.importArea.value = json;
          this.importArea.classList.remove('hidden');
          this.flash('Presse-papier indisponible : JSON affiché ci-dessous.');
        },
      );
    } else {
      this.importArea.value = json;
      this.importArea.classList.remove('hidden');
    }
  }

  private importJson(): void {
    try {
      const cfg = parseConfig(this.importArea.value);
      this.deps.params.replace({ ...cfg.params } as Record<string, unknown>);
      this.deps.settings.update((st) => {
        st.seed = cfg.seed;
        if (cfg.debug) Object.assign(st.debug, cfg.debug);
        if (cfg.camera) Object.assign(st.camera, cfg.camera);
        if (cfg.cameraMode) st.cameraMode = cfg.cameraMode;
        if (cfg.playerCount) st.playerCount = cfg.playerCount;
      });
      this.build();
      this.flash('Config importée. Les params s\'appliquent en live ; la seed au prochain redémarrage.');
    } catch (e) {
      this.flash(`Import impossible : ${(e as Error).message}`, true);
    }
  }

  private flash(msg: string, error = false): void {
    this.result.textContent = msg;
    this.result.classList.toggle('error', error);
  }

  update(nowMs: number): void {
    const s = this.deps.settings.get().debug;
    if (!s.showPanels || !s.panelOpen || s.panelTab !== 'debug') return;
    if (nowMs - this.lastInfo < 250) return;
    this.lastInfo = nowMs;
    const g = this.deps.game;
    this.info.textContent = `tick ${g.state.tick} · hash ${g.stateHashHex()} · ${g.loop.tps} ticks/s · ${g.loop.fps} fps · historique ${g.history.oldestTick}→${g.history.newestTick}`;
    const r = this.deps.renderer;
    if (r) {
      const painter = getTheme(r.themeId).painter;
      this.renderInfo.textContent = `thème affiché : ${painter.name} · préparation ${r.prepMs.toFixed(1)} ms · rendu GPU ${r.renderMs.toFixed(1)} ms · cuisson du niveau ${r.artWorld.bakeMs.toFixed(0)} ms`;
      if (this.shownSwatches !== painter.id) {
        this.shownSwatches = painter.id;
        clear(this.swatches);
        for (const [name, hex] of painter.swatches) {
          this.swatches.append(h('span', { title: `${name} ${hex}` }, h('i', { style: `background:${hex}` }), `${name}`));
        }
      }
    }
    const net = g.net;
    if (!net) {
      this.netInfo.textContent = '';
      this.setLocked(false);
      return;
    }
    this.setLocked(!net.isHost);
    const st = net.stats;
    const pending = g.paramSyncTick >= 0 ? ` · params au tick ${g.paramSyncTick}` : '';
    const role = net.isHost
      ? 'tu es l\'hôte : tes changements de params sont datés et envoyés à l\'autre joueur'
      : 'params contrôlés par l\'hôte';
    this.netInfo.textContent =
      `réseau : slot ${net.slot} · ${st.rollbacks} rollbacks (${st.resimTicks} ticks resimulés, dernier ${st.lastDepth}) · ` +
      `${st.stalls} attentes · prédiction ${st.predictedAhead} ticks · ${st.paramSyncs} synchros params` +
      `${st.paramsTooLate > 0 ? ` · ${st.paramsTooLate} TROP TARD` : ''}${pending}` +
      `${g.loop.stalled ? ' · EN ATTENTE DU PAIR' : ''} — ${role}`;
  }

  /** Chez l'invité, les réglages de sim sont en lecture seule : c'est l'hôte qui décide. */
  private setLocked(locked: boolean): void {
    if (this.lockedForGuest === locked) return;
    this.lockedForGuest = locked;
    for (const ui of this.sliders.values()) {
      ui.range.disabled = locked;
      ui.num.disabled = locked;
    }
    for (const cb of this.toggles.values()) cb.disabled = locked;
  }
}
