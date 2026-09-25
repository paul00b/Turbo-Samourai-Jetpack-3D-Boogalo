/**
 * Coque des panneaux latéraux : une colonne d'onglets verticaux + un panneau visible à la fois.
 * DEBUG et CARTES partagent ce shell (même style, même largeur, même ouverture/fermeture).
 * Le tout reste masqué tant que les outils de debug ne sont pas affichés (Paramètres, ou F1).
 */
import type { SettingsStore } from '../io/settings';
import { clear, h } from './dom';

export interface SidePanelSpec {
  id: string;
  label: string;
  title?: string;
}

interface Entry {
  id: string;
  button: HTMLButtonElement;
  panel: HTMLElement;
}

export class SidePanelHost {
  private readonly tabs = h('div', { class: 'side-tabs' });
  private readonly entries: Entry[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: SettingsStore,
  ) {
    clear(root);
    root.append(this.tabs);
    settings.subscribe(() => this.applyVisibility());
  }

  get shown(): boolean {
    return this.settings.get().debug.showPanels;
  }

  /** Affiche ou masque les outils (onglets et panneaux). */
  setShown(v: boolean): void {
    if (v !== this.shown) this.settings.update((st) => (st.debug.showPanels = v));
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const s = this.settings.get().debug;
    this.root.classList.toggle('hidden', !s.showPanels);
    document.body.classList.toggle('debug-open', s.showPanels && s.panelOpen);
  }

  /** Crée un onglet et retourne le panneau vide à remplir. */
  add(spec: SidePanelSpec): HTMLElement {
    const button = h('button', { class: 'side-tab', type: 'button', title: spec.title ?? '' }, spec.label) as HTMLButtonElement;
    const panel = h('div', { class: 'side-panel' });
    button.addEventListener('click', () => this.toggle(spec.id));
    this.tabs.append(button);
    this.root.append(panel);
    this.entries.push({ id: spec.id, button, panel });
    return panel;
  }

  /** À appeler une fois tous les onglets ajoutés : applique l'état persisté. */
  restore(): void {
    const s = this.settings.get().debug;
    const known = this.entries.some((e) => e.id === s.panelTab);
    this.apply(s.panelOpen, known ? s.panelTab : (this.entries[0]?.id ?? ''));
  }

  get openTab(): string | null {
    const s = this.settings.get().debug;
    return s.panelOpen ? s.panelTab : null;
  }

  /** Clic sur un onglet (ou F1…) : ouvre celui-ci, ou referme si c'était déjà l'onglet courant. Outils masqués : les affiche. */
  toggle(id: string): void {
    const s = this.settings.get().debug;
    if (!s.showPanels) {
      this.setShown(true);
      this.apply(true, id);
    } else if (s.panelOpen && s.panelTab === id) this.apply(false, id);
    else this.apply(true, id);
  }

  open(id: string): void {
    this.apply(true, id);
  }

  close(): void {
    this.apply(false, this.settings.get().debug.panelTab);
  }

  private apply(open: boolean, tab: string): void {
    this.settings.update((st) => {
      st.debug.panelOpen = open;
      st.debug.panelTab = tab;
    });
    this.root.classList.toggle('open', open);
    this.applyVisibility();
    for (const e of this.entries) {
      const active = open && e.id === tab;
      e.panel.classList.toggle('active', active);
      e.button.classList.toggle('selected', active);
      e.button.textContent = active ? `${e.id.toUpperCase()} ▸` : `◂ ${e.id.toUpperCase()}`;
    }
  }
}
