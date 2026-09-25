/**
 * Menus (DOM) : menu principal (course ou arcade), choix de la carte, paramètres, contrôles +
 * remapping, pause, fin de niveau. Navigables au clavier et à la manette via MenuInput + FocusNav.
 * Lancer une partie : le mode, puis la carte (le dernier choix a le focus : Entrée, Entrée).
 */
import type { Game, Phase } from '../app/game';
import type { AudioEngine } from '../io/audio/audioEngine';
import type { Sfx } from '../io/audio/sfx';
import {
  ACTIONS,
  gamepadControlLabel,
  keyCodeLabel,
  type Action,
  type GamepadControl,
} from '../io/input/bindings';
import { GamepadCapture, type GamepadManager } from '../io/input/gamepad';
import { DT, LEVEL_INFOS, LEVEL_MODE_LABEL, type LevelMode } from '../sim';
import type { NetGame } from '../net/netGame';
import { normalizeCode } from '../net/protocol';
import type { KeyboardMouse } from '../io/input/keyboardMouse';
import { defaultNetUrl, normalizeRelayUrl, type SettingsStore } from '../io/settings';
import { isLocalRelay } from '../net/session';
import { clear, h } from './dom';
import { formatTime } from './hud';
import { FocusNav, MenuInput, type MenuAction } from './focusNav';

export type ScreenId = 'title' | 'race' | 'kills' | 'net' | 'controls' | 'settings' | 'pause' | 'complete';

/** Ce que promet chaque mode, sur sa carte du menu principal et en tête de son écran. */
const MODE_LEAD: Record<LevelMode, string> = {
  race: "Atteins l'arrivée le plus vite possible.",
  kills: 'Élimine tous les ennemis de la carte.',
};

interface Capture {
  kind: 'kbm' | 'pad';
  action: Action;
  slot: number;
  pad: GamepadCapture | null;
  button: HTMLButtonElement;
}

export interface MenuDeps {
  game: Game;
  net: NetGame;
  settings: SettingsStore;
  kbm: KeyboardMouse;
  pads: GamepadManager;
  sfx: Sfx;
  audio: AudioEngine;
}

export class Menu {
  private readonly nav = new FocusNav();
  private readonly input: MenuInput;
  private readonly stack: ScreenId[] = [];
  private readonly screens = new Map<ScreenId, HTMLElement>();
  private capture: Capture | null = null;
  private layoutMap: Map<string, string> | null = null;
  private controlsTab: 'kbm' | 'pad' = 'kbm';
  private lastUpdate = 0;
  private padStatusTimer = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: MenuDeps,
  ) {
    this.input = new MenuInput(deps.pads);
    this.nav.onMove = () => deps.sfx.menuMove();
    clear(root);
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    if (kb?.getLayoutMap) {
      kb.getLayoutMap()
        .then((m) => {
          this.layoutMap = new Map(m as unknown as Iterable<[string, string]>);
          if (this.current === 'controls') this.renderControls();
        })
        .catch(() => undefined);
    }
    // Le menu gère lui-même Entrée/Espace/flèches : on coupe l'activation native des boutons (double clic sinon)
    // et le scroll de la page.
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    });
    deps.game.onPhase = (p) => this.onPhase(p);
    this.onPhase(deps.game.phase);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get current(): ScreenId | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  private onPhase(p: Phase): void {
    this.stack.length = 0;
    if (p === 'menu') this.push('title');
    else if (p === 'paused') this.push('pause');
    else if (p === 'complete') this.push('complete');
    else this.hideAll();
  }

  private hideAll(): void {
    this.root.classList.add('hidden');
    this.nav.detach();
    this.capture = null;
  }

  private push(id: ScreenId): void {
    this.stack.push(id);
    this.render();
  }

  private back(): void {
    if (this.capture) {
      this.cancelCapture();
      return;
    }
    if (this.stack.length <= 1) {
      if (this.current === 'pause') this.deps.game.resume();
      else if (this.current === 'complete') this.deps.game.resumeAfterComplete();
      return;
    }
    this.stack.pop();
    this.deps.sfx.menuBack();
    this.render();
  }

  private confirmSound(): void {
    this.deps.sfx.menuConfirm();
  }

  private render(): void {
    const id = this.current;
    if (!id) return;
    this.root.classList.remove('hidden');
    clear(this.root);
    let el: HTMLElement;
    switch (id) {
      case 'title':
        el = this.buildTitle();
        break;
      case 'race':
      case 'kills':
        el = this.buildMode(id);
        break;
      case 'net':
        el = this.buildNet();
        break;
      case 'controls':
        el = this.buildControls();
        break;
      case 'settings':
        el = this.buildSettings();
        break;
      case 'pause':
        el = this.buildPause();
        break;
      case 'complete':
        el = this.buildComplete();
        break;
    }
    this.screens.set(id, el);
    this.root.append(el);
    this.nav.attach(el);
  }

  private renderControls(): void {
    if (this.current === 'controls') this.render();
  }

  /** Redessine l'écran courant (état réseau qui change sous nos pieds). */
  refresh(): void {
    if (this.visible && !this.capture) this.render();
  }

  // ------------------------------------------------------------------ écrans

  private btn(label: string | (Node | string | null)[], onClick: () => void, extra: Record<string, string | boolean> = {}): HTMLButtonElement {
    const b = h('button', { class: 'menu-btn', 'data-nav': true, type: 'button', tabindex: -1, ...extra }, ...(Array.isArray(label) ? label : [label]));
    b.addEventListener('click', () => {
      b.blur();
      this.confirmSound();
      onClick();
    });
    return b;
  }

  private panel(title: string, ...children: (Node | string | null)[]): HTMLElement {
    return h('div', { class: 'menu-panel' }, h('h2', { class: 'menu-title', text: title }), ...children);
  }

  /** Menu principal : les deux modes en grand, puis le reste. Le mode joué en dernier a le focus. */
  private buildTitle(): HTMLElement {
    const s = this.deps.settings.get();
    const lastMode = (LEVEL_INFOS[s.levelId] ?? LEVEL_INFOS[0]).mode;
    const card = (mode: LevelMode): HTMLButtonElement => {
      const maps = LEVEL_INFOS.filter((l) => l.mode === mode);
      const meta = `${maps.length} cartes · ${maps.map((m) => m.name).join(', ')}`;
      return this.btn(
        [h('span', { class: 'mode-name', text: LEVEL_MODE_LABEL[mode] }), h('span', { class: 'mode-lead', text: MODE_LEAD[mode] }), h('span', { class: 'mode-meta', text: meta })],
        () => this.push(mode),
        { class: `menu-btn mode-card mode-${mode}`, 'data-nav-row': 'modes', 'data-nav-default': mode === lastMode },
      );
    };
    return h(
      'div',
      { class: 'menu-screen title-screen' },
      h('p', { class: 'menu-eyebrow', text: 'PROTOTYPE · DIRECTION ARTISTIQUE V1' }),
      h('h1', { class: 'game-title' }, 'TURBO-SAMOURAÏ', h('br'), 'JETPACK 3D BOOGALOO'),
      h('p', { class: 'menu-sub', text: 'Deux grappins, un jetpack, des tongs' }),
      h('div', { class: 'mode-cards' }, card('race'), card('kills')),
      h(
        'div',
        { class: 'menu-row title-more' },
        this.btn('Multijoueur en ligne', () => this.push('net'), { class: 'menu-btn secondary', 'data-nav-row': 'more' }),
        this.btn('Paramètres', () => this.push('settings'), { class: 'menu-btn secondary', 'data-nav-row': 'more' }),
      ),
      h('p', { class: 'menu-hint' }, 'Flèches pour choisir · Entrée valide · Échap revient · Manette : croix, A valide, B retour'),
      h('p', { class: 'menu-hint', text: this.deps.audio.unlocked ? 'Son actif' : 'Son : activé au premier clic ou à la première touche' }),
    );
  }

  /**
   * Un mode : le nombre de joueurs, puis une carte = une partie. Depuis l'écran de fin (en jeu),
   * choisir une carte relance tout de suite sur celle-ci.
   */
  private buildMode(mode: LevelMode): HTMLElement {
    const s = this.deps.settings.get();
    const inGame = this.stack.includes('pause') || this.stack.includes('complete');
    const maps = LEVEL_INFOS.filter((l) => l.mode === mode);
    const focusId = maps.some((m) => m.id === s.levelId) ? s.levelId : maps[0]?.id;
    const list = maps.map((info) => {
      const b = this.btn([h('span', { class: 'map-name', text: info.name }), h('span', { class: 'map-sub', text: info.subtitle })], () => this.launch(info.id, inGame), {
        class: 'menu-btn map-btn',
        'data-nav-default': info.id === focusId,
      });
      b.classList.toggle('selected', info.id === s.levelId);
      return b;
    });
    const devices = h('p', { class: 'menu-note devices-note', text: this.devicesText() });
    // 1 ou 2 joueurs : mis à jour sur place, le focus reste sur le sélecteur.
    const counts = ([1, 2] as const).map((n) => {
      const b = this.btn(`${n} joueur${n > 1 ? 's' : ''}`, () => {
        this.deps.settings.update((st) => (st.playerCount = n));
        for (const [k, x] of counts.entries()) x.classList.toggle('selected', k + 1 === n);
        devices.textContent = this.devicesText();
      }, { 'data-nav-group': 'count' });
      b.classList.toggle('selected', s.playerCount === n);
      return b;
    });
    const lead = mode === 'race' ? `${MODE_LEAD.race} ${this.restartKeyLabel()} recommence à zéro, chrono compris.` : MODE_LEAD.kills;
    return h(
      'div',
      { class: 'menu-screen' },
      this.panel(
        LEVEL_MODE_LABEL[mode],
        h('p', { class: 'menu-note', text: lead }),
        inGame ? null : h('div', { class: 'menu-row' }, ...counts),
        inGame ? h('p', { class: 'menu-note', text: 'Choisir une carte relance la partie immédiatement.' }) : devices,
        h('div', { class: 'map-list' }, ...list),
        this.btn('Retour', () => this.back(), { class: 'menu-btn secondary' }),
      ),
    );
  }

  /** Lance la carte (menu principal) ou relance la partie dessus (écran de fin). */
  private launch(levelId: number, inGame: boolean): void {
    const g = this.deps.game;
    if (inGame) {
      g.setLevel(levelId);
      if (g.phase !== 'playing') this.back();
      return;
    }
    this.deps.settings.update((st) => (st.levelId = levelId));
    g.start(this.deps.settings.get().playerCount);
  }

  /** Qui joue avec quoi, en une ligne (on change ça dans Paramètres › Contrôles). */
  private devicesText(): string {
    const s = this.deps.settings.get();
    const name = (i: number): string => (s.devices[i].kind === 'kbm' ? 'clavier + souris' : 'manette');
    const who = s.playerCount === 2 ? `J1 : ${name(0)} · J2 : ${name(1)}` : `Joueur 1 : ${name(0)}`;
    return `${who} (Paramètres › Contrôles pour changer)`;
  }

  /** Touche de « Recommencer » telle qu'affichée sur ce clavier (R par défaut). */
  private restartKeyLabel(): string {
    const code = this.deps.settings.get().keyboard.restart[0];
    return code ? keyCodeLabel(code, this.layoutMap) : 'Recommencer';
  }

  private deviceAssignment(): HTMLElement {
    const s = this.deps.settings.get();
    const rows: HTMLElement[] = [];
    const count = s.playerCount;
    for (let i = 0; i < count; i++) {
      const dev = s.devices[i];
      const label = dev.kind === 'kbm' ? 'Clavier + souris' : 'Manette';
      rows.push(
        h(
          'div',
          { class: 'menu-row' },
          h('span', { class: 'menu-label', text: `Joueur ${i + 1}` }),
          this.btn(label, () => {
            this.deps.settings.update((st) => {
              const next = st.devices[i].kind === 'kbm' ? 'gamepad' : 'kbm';
              st.devices[i].kind = next;
              // Un seul clavier/souris : l'autre joueur bascule.
              if (next === 'kbm') for (let j = 0; j < 2; j++) if (j !== i && st.devices[j].kind === 'kbm') st.devices[j].kind = 'gamepad';
            });
            this.render();
          }),
        ),
      );
    }
    if (count === 2) {
      rows.push(
        this.btn('Inverser J1 ↔ J2', () => {
          this.deps.settings.update((st) => {
            const [a, b] = st.devices;
            st.devices = [b, a];
          });
          this.render();
        }, { class: 'menu-btn secondary' }),
      );
    }
    return h('div', { class: 'menu-block' }, ...rows, this.padStatus());
  }

  private padStatus(): HTMLElement {
    const pads = this.deps.pads.connected();
    const lines: string[] = [];
    if (pads.length === 0) lines.push('Aucune manette détectée : appuie sur un bouton de la manette.');
    for (const p of pads) lines.push(`Manette #${p.index} : ${p.id.slice(0, 48)} ${p.standard ? '(mapping standard)' : '(mapping NON standard : remappe les boutons)'}`);
    return h('div', { class: 'menu-status', id: 'pad-status' }, ...lines.map((l) => h('div', { text: l })));
  }

  /** Héberger / rejoindre par code. Le netcode démarre tout seul quand les deux joueurs sont là. */
  private buildNet(): HTMLElement {
    const s = this.deps.settings.get();
    const net = this.deps.net;
    const url = h('input', { type: 'text', class: 'menu-input', value: s.netUrl, spellcheck: 'false', 'data-nav': true }) as HTMLInputElement;
    // Champ vidé ou égal au défaut : on revient au relais du build (et on suit ses corrections).
    url.addEventListener('change', () => {
      const v = normalizeRelayUrl(url.value);
      const def = defaultNetUrl();
      this.deps.settings.update((st) => {
        st.netUrl = v || def;
        st.netUrlCustom = v !== '' && v !== def;
      });
      url.value = this.deps.settings.get().netUrl;
    });

    const code = h('input', {
      type: 'text',
      class: 'menu-input code',
      value: s.netLastCode,
      maxlength: 6,
      placeholder: 'ABC234',
      spellcheck: 'false',
      'data-nav': true,
    }) as HTMLInputElement;
    code.addEventListener('input', () => {
      code.value = normalizeCode(code.value);
      this.deps.settings.update((st) => (st.netLastCode = code.value));
    });

    const status = h('div', { class: 'menu-status' });
    const lines: string[] = [];
    if (net.status === 'connecting') lines.push('Connexion au relais…');
    if (net.status === 'waiting' && net.code) lines.push(`En attente du deuxième joueur. Transmets-lui le code : ${net.code}`);
    if (net.status === 'connected') lines.push('Les deux joueurs sont connectés.');
    if (net.status === 'error') lines.push(net.session.error);
    if (net.message) lines.push(net.message);
    if (lines.length === 0) {
      lines.push(isLocalRelay(s.netUrl) ? 'Lance le relais avec « npm run server », puis héberge ou rejoins avec un code.' : 'Héberge une session, ou rejoins-en une avec le code de ton ami.');
    }
    for (const l of lines) status.append(h('div', { text: l }));

    const codeBanner = net.code && net.status === 'waiting' ? h('div', { class: 'net-code', text: net.code }) : null;

    return h(
      'div',
      { class: 'menu-screen' },
      this.panel(
        'Multijoueur en ligne',
        h('div', { class: 'menu-row' }, h('span', { class: 'menu-label', text: 'Serveur' }), url),
        codeBanner,
        this.btn('Héberger une session', () => net.host(this.deps.settings.get().netUrl)),
        h('div', { class: 'menu-row' }, h('span', { class: 'menu-label', text: 'Code' }), code),
        this.btn('Rejoindre', () => net.join(this.deps.settings.get().netUrl, code.value)),
        net.status === 'idle' || net.status === 'closed' ? null : this.btn('Fermer la session', () => net.leave(), { class: 'menu-btn secondary' }),
        status,
        h('p', { class: 'menu-note', text: 'La partie tourne en rollback : chacun joue son input avec 3 ticks de retard, les divergences sont recalculées. En ligne, la carte, la seed et les params sont ceux de l\'hôte et restent figés.' }),
        this.btn('Retour', () => this.back(), { class: 'menu-btn secondary' }),
      ),
    );
  }

  private buildControls(): HTMLElement {
    const s = this.deps.settings.get();
    const tabK = this.btn('Clavier + souris', () => {
      this.controlsTab = 'kbm';
      this.render();
    }, { 'data-nav-group': 'tab' });
    const tabP = this.btn('Manette', () => {
      this.controlsTab = 'pad';
      this.render();
    }, { 'data-nav-group': 'tab' });
    tabK.classList.toggle('selected', this.controlsTab === 'kbm');
    tabP.classList.toggle('selected', this.controlsTab === 'pad');

    const rows: HTMLElement[] = [];
    for (const a of ACTIONS) {
      const slots: HTMLElement[] = [];
      for (let slot = 0; slot < 2; slot++) {
        let label = '-';
        if (this.controlsTab === 'kbm') {
          const code = s.keyboard[a.id][slot];
          if (code) label = keyCodeLabel(code, this.layoutMap);
        } else {
          const c = s.gamepad[a.id][slot];
          if (c) label = gamepadControlLabel(c, this.deps.pads.connected()[0]?.standard ?? true);
        }
        const b = this.btn(label, () => this.beginCapture(a.id, slot, b), { class: 'menu-btn slot' });
        slots.push(b);
        if (label !== '-') {
          slots.push(
            this.btn('×', () => {
              this.deps.settings.update((st) => {
                if (this.controlsTab === 'kbm') st.keyboard[a.id].splice(slot, 1);
                else st.gamepad[a.id].splice(slot, 1);
              });
              this.render();
            }, { class: 'menu-btn tiny', title: 'Effacer' }),
          );
        }
      }
      rows.push(
        h('div', { class: 'bind-row' }, h('div', { class: 'bind-label' }, h('div', { text: a.label }), h('small', { text: a.hint })), h('div', { class: 'bind-slots' }, ...slots)),
      );
    }
    const note =
      this.controlsTab === 'kbm'
        ? 'Les touches sont physiques (indépendantes de la disposition) : la touche affichée est celle de ton clavier si le navigateur le permet. Q/D = A/D physiques (ZQSD).'
        : 'Mapping "standard" W3C par défaut (Xbox / PlayStation / la plupart des manettes). Manette exotique : clique un slot et appuie sur le bouton ou l\'axe voulu.';
    return h(
      'div',
      { class: 'menu-screen wide' },
      this.panel(
        'Contrôles',
        h('div', { class: 'menu-row' }, tabK, tabP),
        h('p', { class: 'menu-note', text: note }),
        h('div', { class: 'menu-status capture-status hidden', id: 'capture-status', text: '' }),
        h('div', { class: 'bind-table' }, ...rows),
        this.deviceAssignment(),
        h(
          'div',
          { class: 'menu-row' },
          this.btn('Réinitialiser les touches', () => {
            this.deps.settings.resetBindings();
            this.render();
          }, { class: 'menu-btn secondary' }),
          this.btn('Retour', () => this.back(), { class: 'menu-btn secondary' }),
        ),
      ),
    );
  }

  private buildSettings(): HTMLElement {
    const s = this.deps.settings.get();
    const master = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.masterVolume, 'data-nav': true }) as HTMLInputElement;
    const sfx = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.sfxVolume, 'data-nav': true }) as HTMLInputElement;
    const masterVal = h('span', { class: 'menu-value', text: pct(s.masterVolume) });
    const sfxVal = h('span', { class: 'menu-value', text: pct(s.sfxVolume) });
    master.addEventListener('input', () => {
      this.deps.settings.update((st) => (st.masterVolume = Number(master.value)));
      masterVal.textContent = pct(Number(master.value));
      this.deps.sfx.menuMove();
    });
    sfx.addEventListener('input', () => {
      this.deps.settings.update((st) => (st.sfxVolume = Number(sfx.value)));
      sfxVal.textContent = pct(Number(sfx.value));
      this.deps.sfx.menuMove();
    });
    const cam = h('select', { 'data-nav': true }) as HTMLSelectElement;
    cam.append(h('option', { value: 'single', text: 'Caméra unique (zoom dynamique)' }), h('option', { value: 'split', text: 'Écran splitté vertical' }));
    cam.value = s.cameraMode;
    cam.addEventListener('change', () => {
      this.deps.settings.update((st) => (st.cameraMode = cam.value === 'split' ? 'split' : 'single'));
      this.deps.sfx.menuMove();
    });
    const toolsLabel = (): string => (this.deps.settings.get().debug.showPanels ? 'Outils de debug : affichés' : 'Outils de debug : masqués');
    // Mis à jour sur place : le focus reste sur l'interrupteur.
    const tools = this.btn(toolsLabel(), () => {
      this.deps.settings.update((st) => (st.debug.showPanels = !st.debug.showPanels));
      tools.textContent = toolsLabel();
    });
    const fs = this.btn(document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => undefined);
      setTimeout(() => this.render(), 150);
    });
    return h(
      'div',
      { class: 'menu-screen' },
      this.panel(
        'Paramètres',
        h('div', { class: 'menu-row' }, h('span', { class: 'menu-label', text: 'Volume général' }), master, masterVal),
        h('div', { class: 'menu-row' }, h('span', { class: 'menu-label', text: 'Volume effets' }), sfx, sfxVal),
        h('div', { class: 'menu-row' }, h('span', { class: 'menu-label', text: 'Caméra (2 joueurs)' }), cam),
        fs,
        this.stack.includes('pause') ? null : this.btn('Contrôles', () => this.push('controls')),
        tools,
        h('p', { class: 'menu-note', text: "Outils de debug : panneaux DEBUG, CARTES et BUILDS à droite de l'écran, mesures (fps, ticks) dans le HUD. Raccourci : F1." }),
        this.btn('Retour', () => this.back(), { class: 'menu-btn secondary' }),
      ),
    );
  }

  /** Échap : continuer, recommencer, ou quitter au menu. */
  private buildPause(): HTMLElement {
    const g = this.deps.game;
    const net = this.deps.net.active;
    return h(
      'div',
      { class: 'menu-screen' },
      this.panel(
        'Pause',
        this.btn('Continuer', () => g.resume()),
        net ? null : this.btn(g.isRace ? `Recommencer (${this.restartKeyLabel()})` : 'Recommencer', () => g.restart()),
        net
          ? this.btn('Quitter la session en ligne', () => this.deps.net.leave(), { class: 'menu-btn secondary' })
          : this.btn('Quitter au menu', () => g.quitToMenu(), { class: 'menu-btn secondary' }),
      ),
    );
  }

  /** Fin de niveau : chrono figé, récap, et les deux actions qui comptent. */
  private buildComplete(): HTMLElement {
    const g = this.deps.game;
    const st = g.state;
    const net = g.net;
    const guest = net !== null && !net.isHost;
    const time = formatTime(st.finishTick * DT);
    const info = LEVEL_INFOS[st.levelId];
    const race = info?.mode === 'race';
    const perPlayer =
      st.playerCount === 2
        ? h('p', { class: 'menu-note', text: `J1 : ${st.players[0].kills} tués, ${st.players[0].deaths} morts · J2 : ${st.players[1].kills} tués, ${st.players[1].deaths} morts` })
        : h('p', { class: 'menu-note', text: `${st.players[0].deaths} mort${st.players[0].deaths > 1 ? 's' : ''} en route` });
    return h(
      'div',
      { class: 'menu-screen' },
      this.panel(
        race ? 'Arrivée !' : 'Niveau terminé',
        h('div', { class: 'complete-time', text: time }),
        h('p', {
          class: 'menu-sub',
          text: race
            ? `${info?.name ?? ''} bouclée · ${st.kills} ennemi${st.kills > 1 ? 's' : ''} au passage`
            : `${st.kills} ennemi${st.kills > 1 ? 's' : ''} éliminé${st.kills > 1 ? 's' : ''} · ${info?.name ?? ''}`,
        }),
        perPlayer,
        guest ? h('p', { class: 'menu-note', text: 'En ligne, c\'est l\'hôte qui relance la manche ou change de carte.' }) : null,
        guest ? null : this.btn(race ? `Recommencer (${this.restartKeyLabel()})` : 'Recommencer le niveau', () => g.restart()),
        guest ? null : this.btn('Changer de carte', () => this.push(info?.mode ?? 'kills')),
        this.btn('Continuer à jouer', () => g.resumeAfterComplete(), { class: 'menu-btn secondary' }),
        net ? this.btn('Quitter la session', () => this.deps.net.leave(), { class: 'menu-btn secondary' }) : this.btn('Quitter au menu', () => g.quitToMenu(), { class: 'menu-btn secondary' }),
      ),
    );
  }

  // ------------------------------------------------------------------ remapping

  private beginCapture(action: Action, slot: number, button: HTMLButtonElement): void {
    this.deps.kbm.drainPressed(); // oublie le clic / la touche qui a ouvert la capture
    this.capture = {
      kind: this.controlsTab,
      action,
      slot,
      pad: this.controlsTab === 'pad' ? new GamepadCapture(this.deps.pads) : null,
      button,
    };
    button.textContent = '…';
    button.classList.add('capturing');
    const status = this.root.querySelector('#capture-status');
    if (status) {
      status.textContent =
        this.controlsTab === 'kbm'
          ? `Appuie sur une touche ou un bouton de souris pour « ${ACTIONS.find((a) => a.id === action)?.label} » (Échap pour annuler)`
          : `Appuie sur un bouton ou pousse un stick pour « ${ACTIONS.find((a) => a.id === action)?.label} » (Échap pour annuler)`;
      status.classList.remove('hidden');
    }
  }

  private cancelCapture(): void {
    this.capture = null;
    this.render();
  }

  private finishCapture(kb: string | null, pad: GamepadControl | null): void {
    const c = this.capture;
    if (!c) return;
    this.deps.settings.update((st) => {
      if (c.kind === 'kbm' && kb) {
        for (const a of ACTIONS) st.keyboard[a.id] = st.keyboard[a.id].filter((x) => x !== kb); // une touche = une action
        const list = st.keyboard[c.action];
        while (list.length < c.slot) list.push('');
        list[c.slot] = kb;
        st.keyboard[c.action] = list.filter((x) => x);
      } else if (c.kind === 'pad' && pad) {
        for (const a of ACTIONS) {
          st.gamepad[a.id] = st.gamepad[a.id].filter((x) => !(x.type === pad.type && x.index === pad.index && (x.type !== 'axis' || pad.type !== 'axis' || x.sign === pad.sign)));
        }
        const list = st.gamepad[c.action];
        if (c.slot < list.length) list[c.slot] = pad;
        else list.push(pad);
      }
    });
    this.capture = null;
    this.confirmSound();
    this.render();
  }

  // ------------------------------------------------------------------ boucle

  update(nowMs: number): void {
    const dt = this.lastUpdate ? Math.min(0.1, (nowMs - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = nowMs;
    const codes = this.deps.kbm.drainPressed();
    if (!this.visible) {
      // Menu caché : on garde les fronts manette à jour (sinon le Start qui a mis en pause re-déclenche "reprendre").
      this.input.poll(codes, dt);
      return;
    }

    // Rafraîchit le statut des manettes 2x/s (détection après premier appui).
    this.padStatusTimer += dt;
    if (this.padStatusTimer > 0.5) {
      this.padStatusTimer = 0;
      const el = this.root.querySelector('#pad-status');
      if (el) el.replaceWith(this.padStatus());
    }

    if (this.capture) {
      if (codes.includes('Escape')) {
        this.cancelCapture();
        return;
      }
      if (this.capture.kind === 'kbm') {
        const code = codes.find((c) => c !== 'Escape');
        if (code) this.finishCapture(code, null);
      } else if (this.capture.pad) {
        const got = this.capture.pad.poll();
        if (got) this.finishCapture(null, got.control);
      }
      return;
    }

    const actions = this.input.poll(codes, dt);
    for (const a of actions) this.handleAction(a);
  }

  private handleAction(a: MenuAction): void {
    if (a === 'back') {
      this.back();
      return;
    }
    if (a === 'start') {
      if (this.current === 'pause') this.deps.game.resume();
      else if (this.current === 'title') this.push((LEVEL_INFOS[this.deps.settings.get().levelId] ?? LEVEL_INFOS[0]).mode);
      return;
    }
    this.nav.handle(a);
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)} %`;
}
