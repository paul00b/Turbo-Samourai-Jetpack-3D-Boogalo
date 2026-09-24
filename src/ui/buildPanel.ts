/**
 * Onglet BUILDS : sauvegarder les paramètres courants sous un nom, les annoter, les réappliquer.
 * Sert à comparer des réglages de feel entre eux sans refaire les sliders à la main.
 */
import type { Game } from '../app/game';
import { countParamDiff, MAX_NAME, MAX_NOTE, type BuildsStore, type ParamBuild } from '../io/buildsStore';
import type { ParamsStore } from '../io/paramsStore';
import { PARAM_SYNC_DELAY } from '../net/netPlay';
import { clear, h } from './dom';

export interface BuildPanelDeps {
  game: Game;
  params: ParamsStore;
  builds: BuildsStore;
}

export class BuildPanel {
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private nameInput!: HTMLInputElement;
  private noteInput!: HTMLTextAreaElement;
  /** Build appliqué en dernier : sert juste à mettre en avant la carte correspondante. */
  private lastApplied = '';

  constructor(
    private readonly panel: HTMLElement,
    private readonly deps: BuildPanelDeps,
  ) {
    this.list = h('div', { class: 'build-list' });
    this.status = h('div', { class: 'debug-result' });
    this.build();
    deps.builds.subscribe(() => this.renderList());
    deps.params.subscribe(() => this.renderList());
  }

  private build(): void {
    clear(this.panel);
    this.nameInput = h('input', {
      type: 'text',
      class: 'debug-num wide',
      maxlength: MAX_NAME,
      placeholder: 'Nom du build',
    }) as HTMLInputElement;
    this.noteInput = h('textarea', {
      class: 'build-note',
      rows: 2,
      maxlength: MAX_NOTE,
      placeholder: 'Note : ce que ce réglage cherche à obtenir…',
    }) as HTMLTextAreaElement;
    const save = h('button', { class: 'debug-btn', type: 'button' }, 'Sauvegarder les params actuels') as HTMLButtonElement;
    save.addEventListener('click', () => this.saveCurrent());

    this.panel.append(
      h('h3', { text: 'Nouveau build' }),
      h('p', { class: 'side-note', text: 'Un build = une photo des paramètres de sim, nommée et annotée. Le réappliquer les remet tous d\'un coup. En ligne, seul l\'hôte applique : le changement est daté et prend effet au même tick chez les deux joueurs.' }),
      this.nameInput,
      this.noteInput,
      h('div', { class: 'debug-row' }, save),
      this.status,
      h('h3', { text: 'Builds enregistrés' }),
      this.list,
    );
    this.renderList();
  }

  private saveCurrent(): void {
    const existing = this.deps.builds.list();
    const name = this.nameInput.value.trim() || `Build ${existing.length + 1}`;
    const b = this.deps.builds.create(name, this.deps.params.get(), this.noteInput.value);
    this.lastApplied = b.id;
    this.nameInput.value = '';
    this.noteInput.value = '';
    this.flash(`« ${b.name} » enregistré.`);
  }

  private apply(b: ParamBuild): void {
    const net = this.deps.game.net;
    if (net && !net.isHost) {
      this.flash('Partie en ligne : les params sont contrôlés par l\'hôte. Demande-lui d\'appliquer ce build.', true);
      return;
    }
    this.deps.params.replace({ ...b.params } as Record<string, unknown>);
    this.lastApplied = b.id;
    this.flash(
      net
        ? `« ${b.name} » envoyé aux deux joueurs : effet dans ${PARAM_SYNC_DELAY} ticks, au même tick des deux côtés.`
        : `« ${b.name} » appliqué.`,
    );
    this.renderList();
  }

  private renderList(): void {
    clear(this.list);
    const builds = this.deps.builds.list();
    if (builds.length === 0) {
      this.list.append(h('p', { class: 'side-note', text: 'Aucun build pour l\'instant.' }));
      return;
    }
    const current = this.deps.params.get();
    for (const b of builds) {
      const diff = countParamDiff(b.params, current);
      const name = h('input', { type: 'text', class: 'build-name', value: b.name, maxlength: MAX_NAME }) as HTMLInputElement;
      name.addEventListener('change', () => this.deps.builds.rename(b.id, name.value));
      const note = h('textarea', { class: 'build-note', rows: 2, maxlength: MAX_NOTE }) as HTMLTextAreaElement;
      note.value = b.note;
      note.placeholder = 'Note…';
      note.addEventListener('change', () => this.deps.builds.setNote(b.id, note.value));

      const applyBtn = h('button', { class: 'debug-btn', type: 'button' }, 'Appliquer') as HTMLButtonElement;
      applyBtn.addEventListener('click', () => this.apply(b));
      const updateBtn = h('button', { class: 'debug-btn', type: 'button', title: 'Remplacer par les params actuels' }, 'Mettre à jour') as HTMLButtonElement;
      updateBtn.addEventListener('click', () => {
        this.deps.builds.update(b.id, this.deps.params.get());
        this.flash(`« ${b.name} » mis à jour avec les params actuels.`);
      });
      const delBtn = h('button', { class: 'debug-btn danger', type: 'button', title: 'Supprimer' }, '×') as HTMLButtonElement;
      delBtn.addEventListener('click', () => {
        this.deps.builds.remove(b.id);
        this.flash(`« ${b.name} » supprimé.`);
      });

      const card = h(
        'div',
        { class: 'build-card' },
        name,
        note,
        h(
          'div',
          { class: 'debug-row wrap' },
          applyBtn,
          updateBtn,
          delBtn,
          h('span', { class: 'debug-unit', text: diff === 0 ? 'identique aux params actuels' : `${diff} param${diff > 1 ? 's' : ''} d'écart` }),
        ),
      );
      card.classList.toggle('active', diff === 0 || b.id === this.lastApplied);
      this.list.append(card);
    }
  }

  private flash(msg: string, error = false): void {
    this.status.textContent = msg;
    this.status.classList.toggle('error', error);
  }
}
