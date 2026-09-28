/**
 * Classement dans les menus : le bloc de l'écran de fin (pseudo demandé une fois, envoi de la
 * partie, top 10 de la carte), l'écran Classement (une carte après l'autre, par mode) et la ligne
 * « Pseudo » des paramètres. L'état réseau vit ici ; menu.ts ne fait que poser les blocs.
 */
import type { Game } from '../app/game';
import { UNRANKED_LABEL } from '../app/replayRecorder';
import { BIOMES, biomeInfo, DT, LEVEL_INFOS, LEVEL_MODE_LABEL, levelsIn, levelsOf, type LevelMode, type ReplayData } from '../sim';
import type { LeaderboardClient } from '../io/leaderboard';
import { NAME_MAX, type BoardView, type SubmitResult } from '../net/scoresApi';
import { h } from './dom';
import { formatTime } from './hud';

/** Fabrique de bouton du menu (sons, data-nav) : fournie par Menu. */
export type BtnFactory = (label: string, onClick: () => void, extra?: Record<string, string | boolean>) => HTMLButtonElement;

type Run =
  | { kind: 'none' }
  | { kind: 'unranked'; reason: string }
  | { kind: 'needName'; replay: ReplayData; error: string | null; draft: string | null }
  | { kind: 'sending'; replay: ReplayData }
  | { kind: 'done'; result: SubmitResult }
  | { kind: 'error'; replay: ReplayData; message: string };

type BoardState = { kind: 'loading' } | { kind: 'ok'; view: BoardView } | { kind: 'error'; message: string };

export class LeaderboardUi {
  private run: Run = { kind: 'none' };
  private readonly boards = new Map<number, BoardState>();
  /** Carte affichée dans l'écran Classement, par mode. */
  private boardLevel: Partial<Record<LevelMode, number>> = {};
  /** Le dernier onglet touché était un biome : le focus y reste après le rechargement. */
  private focusBiomeRow = false;
  /** Appelé quand un résultat réseau arrive : le menu redessine l'écran concerné. */
  onChange: (() => void) | null = null;

  constructor(private readonly client: LeaderboardClient) {}

  get playerName(): string | null {
    return this.client.identity.name;
  }

  // ------------------------------------------------------------------ fin de manche

  /** Fin de manche : classable ? pseudo connu ? On envoie tout de suite si oui. */
  onComplete(game: Game): void {
    const rec = game.recorder;
    const replay = rec.replay(game.state);
    if (!replay) {
      this.run = rec.unranked ? { kind: 'unranked', reason: UNRANKED_LABEL[rec.unranked] } : { kind: 'none' };
      return;
    }
    if (!this.client.identity.name) {
      this.run = { kind: 'needName', replay, error: null, draft: null };
      return;
    }
    this.send(replay);
  }

  private send(replay: ReplayData): void {
    this.run = { kind: 'sending', replay };
    void this.client.submit(replay).then((res) => {
      if (this.run.kind !== 'sending' || this.run.replay !== replay) return; // manche déjà oubliée
      if (res.ok) {
        this.run = { kind: 'done', result: res };
        this.boards.set(res.level, { kind: 'ok', view: res });
      } else {
        this.run = { kind: 'error', replay, message: res.error };
      }
      this.onChange?.();
    });
  }

  private submitName(raw: string): void {
    if (this.run.kind !== 'needName') return;
    if (!this.client.setName(raw)) {
      this.run = { ...this.run, draft: raw, error: `Pseudo invalide : 3 à ${NAME_MAX} caractères, lettres, chiffres, espace, - _ .` };
      this.onChange?.();
      return;
    }
    this.send(this.run.replay);
    this.onChange?.();
  }

  /** Nouvelle manche : l'écran de fin précédent est oublié. */
  reset(): void {
    this.run = { kind: 'none' };
  }

  /** Le bloc « classement » de l'écran de fin (null si rien à dire). */
  completeBlock(btn: BtnFactory, levelId: number): HTMLElement | null {
    const r = this.run;
    switch (r.kind) {
      case 'none':
        return null;
      case 'unranked':
        return h('div', { class: 'lb-block' }, h('p', { class: 'lb-status', text: `Hors classement : ${r.reason}.` }));
      case 'needName': {
        const input = h('input', {
          type: 'text',
          class: 'menu-input lb-name',
          value: r.draft ?? this.client.suggestedName(),
          maxlength: NAME_MAX + 4,
          spellcheck: 'false',
          autocomplete: 'off',
          'data-nav': true,
        }) as HTMLInputElement;
        input.addEventListener('keydown', (e) => {
          if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            this.submitName(input.value);
          }
        });
        // Au clavier, on tape directement ; à la manette, le pseudo proposé se valide tel quel.
        queueMicrotask(() => {
          input.focus();
          input.select();
        });
        return h(
          'div',
          { class: 'lb-block' },
          h('p', { class: 'lb-lead', text: 'Ton temps peut entrer au classement mondial. Choisis ton pseudo (une seule fois, modifiable dans Paramètres).' }),
          input,
          r.error ? h('p', { class: 'lb-status lb-error', text: r.error }) : null,
          btn('Enregistrer mon temps', () => this.submitName(input.value), { 'data-nav-default': true }),
        );
      }
      case 'sending':
        return h('div', { class: 'lb-block' }, h('p', { class: 'lb-status', text: 'Envoi au classement… (le serveur rejoue ta partie)' }));
      case 'error':
        return h(
          'div',
          { class: 'lb-block' },
          h('p', { class: 'lb-status lb-error', text: r.message === 'hors ligne' ? 'Classement hors ligne : ton temps n\'a pas été envoyé.' : `Classement : ${r.message}.` }),
          btn('Réessayer l\'envoi', () => {
            this.send(r.replay);
            this.onChange?.();
          }, { class: 'menu-btn secondary' }),
        );
      case 'done': {
        const res = r.result;
        let line: string;
        if (res.previous === null) line = `Premier temps classé sur cette carte : ${res.me ? `${res.me.rank}e sur ${res.total}` : 'enregistré'}.`;
        else if (res.improved) line = `Nouveau record perso (ancien : ${formatTime(res.previous * DT)}) · ${res.me?.rank ?? '?'}e sur ${res.total}.`;
        else line = `Ton record reste ${formatTime(res.previous * DT)} · ${res.me?.rank ?? '?'}e sur ${res.total}.`;
        return h(
          'div',
          { class: 'lb-block' },
          h('p', { class: res.improved ? 'lb-status lb-record' : 'lb-status', text: line }),
          this.table(res, levelId),
        );
      }
    }
  }

  // ------------------------------------------------------------------ écran Classement

  /** Carte affichée par l'écran Classement du mode (la carte en cours si elle est de ce mode). */
  boardFor(mode: LevelMode, currentLevel: number): number {
    const maps = LEVEL_INFOS.filter((l) => l.mode === mode);
    const chosen = this.boardLevel[mode];
    if (chosen !== undefined && maps.some((m) => m.id === chosen)) return chosen;
    return maps.some((m) => m.id === currentLevel) ? currentLevel : (maps[0]?.id ?? 0);
  }

  /** Recharge le classement d'une carte (à chaque ouverture : il bouge pendant qu'on joue). */
  load(levelId: number): void {
    const prev = this.boards.get(levelId);
    if (prev?.kind === 'loading') return;
    if (!prev || prev.kind === 'error') this.boards.set(levelId, { kind: 'loading' });
    void this.client.board(levelId).then((res) => {
      this.boards.set(levelId, res.ok ? { kind: 'ok', view: res } : { kind: 'error', message: res.error });
      this.onChange?.();
    });
  }

  /** `onMode` : affiche les onglets Course / Arcade (écran ouvert depuis le menu principal). */
  boardScreen(mode: LevelMode, currentLevel: number, btn: BtnFactory, title: string, back: () => void, onMode?: (m: LevelMode) => void): HTMLElement {
    const levelId = this.boardFor(mode, currentLevel);
    const modeTabs = onMode
      ? h(
          'div',
          { class: 'menu-row' },
          ...(['race', 'kills'] as const).map((m) => {
            const b = btn(LEVEL_MODE_LABEL[m], () => {
              if (m !== mode) onMode(m);
            }, { 'data-nav-group': 'lb-mode', class: 'menu-btn secondary' });
            b.classList.toggle('selected', m === mode);
            return b;
          }),
        )
      : null;
    const pick = (id: number, fromBiomeRow: boolean): void => {
      this.focusBiomeRow = fromBiomeRow;
      if (this.boardLevel[mode] === id) return;
      this.boardLevel[mode] = id;
      this.load(id);
      this.onChange?.();
    };
    const cur = LEVEL_INFOS[levelId];
    const tab = (label: string, id: number, group: string, selected: boolean, focus: boolean): HTMLButtonElement => {
      const b = btn(label, () => pick(id, group === 'lb-biome'), { 'data-nav-group': group, 'data-nav-default': focus });
      b.classList.toggle('selected', selected);
      return b;
    };
    // Course : le biome, puis la difficulté (neuf cartes). Arcade : une arène par biome.
    const tabs: HTMLElement[] = [];
    if (mode === 'race' && cur) {
      tabs.push(h('div', { class: 'menu-row' }, ...BIOMES.map((b) => {
        const inBiome = levelsIn('race', b.id);
        const target = inBiome.find((m) => m.difficulty === cur.difficulty) ?? inBiome[0];
        return tab(b.name, target.id, 'lb-biome', b.id === cur.biome, this.focusBiomeRow && b.id === cur.biome);
      })));
      tabs.push(h('div', { class: 'menu-row' }, ...levelsIn('race', cur.biome).map((m) => tab(m.name, m.id, 'lb-map', m.id === levelId, !this.focusBiomeRow && m.id === levelId))));
    } else {
      tabs.push(h('div', { class: 'menu-row' }, ...levelsOf(mode).map((m) => tab(biomeInfo(m.biome).name, m.id, 'lb-map', m.id === levelId, m.id === levelId))));
    }
    const st = this.boards.get(levelId);
    let body: HTMLElement;
    if (!st || st.kind === 'loading') body = h('p', { class: 'lb-status', text: 'Chargement du classement…' });
    else if (st.kind === 'error') body = h('p', { class: 'lb-status lb-error', text: st.message === 'hors ligne' ? 'Classement hors ligne.' : `Classement indisponible : ${st.message}.` });
    else if (st.view.total === 0) body = h('p', { class: 'lb-status', text: 'Personne n\'a encore de temps classé sur cette carte. À toi.' });
    else body = this.table(st.view, levelId);
    return h(
      'div',
      { class: 'menu-screen' },
      h(
        'div',
        { class: 'menu-panel' },
        h('h2', { class: 'menu-title', text: title }),
        modeTabs,
        ...tabs,
        body,
        h('p', { class: 'menu-note', text: this.client.identity.name ? `Tu joues sous le nom « ${this.client.identity.name} ».` : 'Ton pseudo sera demandé à la fin de ta première partie classée.' }),
        btn('Retour', back, { class: 'menu-btn secondary' }),
      ),
    );
  }

  private table(view: BoardView, levelId: number): HTMLElement {
    const race = LEVEL_INFOS[levelId]?.mode === 'race';
    const rows: HTMLElement[] = [
      h('div', { class: 'lb-row lb-head' }, h('span', { text: '#' }), h('span', { text: 'Pseudo' }), h('span', { text: race ? 'Temps' : 'Temps (tous éliminés)' })),
    ];
    const me = view.me;
    for (const e of view.top) {
      const mine = me !== null && me.rank === e.rank;
      rows.push(
        h('div', { class: mine ? 'lb-row lb-me' : 'lb-row' }, h('span', { class: 'lb-rank', text: String(e.rank) }), h('span', { class: 'lb-who', text: e.name }), h('span', { class: 'lb-time', text: formatTime(e.ticks * DT) })),
      );
    }
    if (me && me.rank > view.top.length) {
      rows.push(h('div', { class: 'lb-row lb-gap' }, h('span', { text: '…' })));
      rows.push(
        h('div', { class: 'lb-row lb-me' }, h('span', { class: 'lb-rank', text: String(me.rank) }), h('span', { class: 'lb-who', text: this.client.identity.name ?? 'Toi' }), h('span', { class: 'lb-time', text: formatTime(me.ticks * DT) })),
      );
    }
    return h('div', { class: 'lb-table' }, ...rows);
  }

  // ------------------------------------------------------------------ paramètres

  /** Ligne « Pseudo » des paramètres : changer de nom renomme tous tes temps. */
  settingsRow(): HTMLElement {
    const input = h('input', {
      type: 'text',
      class: 'menu-input',
      value: this.client.identity.name ?? '',
      placeholder: 'demandé à ta première partie classée',
      maxlength: NAME_MAX + 4,
      spellcheck: 'false',
      autocomplete: 'off',
      'data-nav': true,
    }) as HTMLInputElement;
    const note = h('span', { class: 'menu-value lb-saved', text: '' });
    input.addEventListener('change', () => {
      if (input.value.trim() === '' || input.value === this.client.identity.name) return;
      if (!this.client.setName(input.value)) {
        note.textContent = 'invalide';
        return;
      }
      input.value = this.client.identity.name ?? '';
      note.textContent = '…';
      void this.client.rename().then((r) => (note.textContent = r.ok ? 'ok' : 'local'));
    });
    return h('div', { class: 'menu-row' }, h('span', { class: 'menu-label', text: 'Pseudo (classement)' }), input, note);
  }
}
