/**
 * Workshop dans les menus : la liste des cartes publiées (récentes, populaires, les miennes ; tout,
 * course ou arcade) et la fiche d'une carte (jouer, en ligne, classement, copie, téléchargement,
 * signalement, gestion de ses propres cartes). L'état réseau vit ici ; menu.ts pose les écrans.
 */
import { DT, LEVEL_MODE_LABEL } from '../sim';
import type { WorkshopClient } from '../io/workshop';
import type { BoardView } from '../net/scoresApi';
import type { WorkshopMap, WorkshopModeFilter, WorkshopSort, WorkshopSummary, WorkshopTheme } from '../net/workshopApi';
import { exportMap, constName } from '../editor/format';
import { h } from './dom';
import { formatTime } from './hud';
import type { BtnFactory, LeaderboardUi } from './leaderboard';

type Load<T> = { kind: 'loading' } | { kind: 'ok'; value: T } | { kind: 'error'; message: string };

export interface WorkshopActions {
  /** Le bloc 1 / 2 joueurs du menu. */
  players: () => (HTMLElement | null)[];
  play: (map: WorkshopMap) => void;
  playOnline: (map: WorkshopMap) => void;
  /** Copie à toi (`asOwner` faux), ou ta carte publiée à modifier puis republier. */
  copy: (map: WorkshopMap, asOwner: boolean) => void;
  openEditor: (() => void) | null;
}

const SORT_LABEL: Record<WorkshopSort, string> = { recent: 'Récentes', popular: 'Populaires', mine: 'Les miennes' };
const MODE_LABEL: Record<WorkshopModeFilter, string> = { all: 'Tout', race: 'Course', kills: 'Arcade' };
const THEME_LABEL: Record<WorkshopTheme, string> = { port: "Port d'Umibozu", bamboo: 'Bambouseraie maudite', forge: 'Forteresse de braise' };

/** Couleurs de l'aperçu (celles de l'éditeur), le vide teinté par le thème. */
const THUMB_AIR: Record<WorkshopTheme, string> = { port: '#101a26', bamboo: '#111a15', forge: '#1c1112' };
const THUMB_COLOR: Record<string, string> = { '#': '#56627a', '=': '#2f5a88', '^': '#d94848', T: '#9fe04a', S: '#4fd1ff', F: '#5ae08a' };

/** Aperçu d'une carte (3 px par bloc, agrandi en CSS sans lissage). */
export function thumbCanvas(thumb: readonly string[], theme: WorkshopTheme, cls = 'ws-thumb'): HTMLCanvasElement {
  const px = 3;
  const w = Math.max(1, thumb[0]?.length ?? 1);
  const cv = h('canvas', { class: cls, width: w * px, height: Math.max(1, thumb.length) * px });
  const ctx = cv.getContext('2d');
  if (ctx) {
    ctx.fillStyle = THUMB_AIR[theme] ?? THUMB_AIR.port;
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < thumb.length; y++) {
      for (let x = 0; x < thumb[y].length; x++) {
        const c = THUMB_COLOR[thumb[y][x]];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * px, y * px, px, px);
      }
    }
  }
  return cv;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

function dateFr(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

/** Le fichier de la carte : l'export de l'éditeur (réimportable tel quel), avec d'où elle vient. */
export function workshopFile(map: WorkshopMap): { name: string; text: string } {
  const head = `// Workshop Turbo-Samouraï : « ${map.name} » par ${map.author} (id ${map.id}, version ${map.version})\n`;
  const text = head + exportMap({ name: map.name, mode: map.mode, theme: map.theme, rows: map.rows });
  return { name: `${constName(map.name).slice(4).toLowerCase() || 'carte'}.txt`, text };
}

function download(map: WorkshopMap): void {
  const f = workshopFile(map);
  const url = URL.createObjectURL(new Blob([f.text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: f.name }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export class WorkshopUi {
  sort: WorkshopSort = 'recent';
  mode: WorkshopModeFilter = 'all';
  private list: Load<{ items: WorkshopSummary[]; total: number }> | null = null;
  private loadingMore = false;
  private selected: WorkshopSummary | null = null;
  private full: Load<WorkshopMap> | null = null;
  private board: Load<BoardView> | null = null;
  private confirm: 'delete' | 'report' | null = null;
  private notice: string | null = null;
  /** Appelé quand une réponse arrive : le menu redessine l'écran. */
  onChange: (() => void) | null = null;

  constructor(
    private readonly client: WorkshopClient,
    private readonly lb: LeaderboardUi,
  ) {}

  // ------------------------------------------------------------------ chargements

  /** Recharge la liste (à chaque ouverture, et quand on change d'onglet). */
  reload(): void {
    this.list = { kind: 'loading' };
    const sort = this.sort;
    const mode = this.mode;
    void this.client.list(sort, mode, 0).then((res) => {
      if (sort !== this.sort || mode !== this.mode) return;
      this.list = res.ok ? { kind: 'ok', value: { items: res.items, total: res.total } } : { kind: 'error', message: res.error };
      this.onChange?.();
    });
  }

  private more(): void {
    const l = this.list;
    if (l?.kind !== 'ok' || this.loadingMore) return;
    this.loadingMore = true;
    const sort = this.sort;
    const mode = this.mode;
    void this.client.list(sort, mode, l.value.items.length).then((res) => {
      this.loadingMore = false;
      if (sort !== this.sort || mode !== this.mode || this.list?.kind !== 'ok') return;
      if (res.ok) {
        const seen = new Set(this.list.value.items.map((i) => i.id));
        this.list = { kind: 'ok', value: { items: [...this.list.value.items, ...res.items.filter((i) => !seen.has(i.id))], total: res.total } };
      }
      this.onChange?.();
    });
  }

  /** Ouvre la fiche d'une carte : ses lignes et son classement se chargent. */
  select(s: WorkshopSummary): void {
    this.selected = s;
    this.confirm = null;
    this.notice = null;
    this.refreshSelected();
  }

  /** Recharge la fiche ouverte (retour d'une partie : nouveau temps, nouvelles parties). */
  refreshSelected(): void {
    const s = this.selected;
    if (!s) return;
    this.full = { kind: 'loading' };
    this.board = { kind: 'loading' };
    void this.client.get(s.id).then((res) => {
      if (this.selected?.id !== s.id) return;
      if (res.ok) {
        this.full = { kind: 'ok', value: res.map };
        this.selected = res.map;
      } else this.full = { kind: 'error', message: res.error };
      this.onChange?.();
    });
    void this.client.board(s.id).then((res) => {
      if (this.selected?.id !== s.id) return;
      this.board = res.ok ? { kind: 'ok', value: res } : { kind: 'error', message: res.error };
      this.onChange?.();
    });
  }

  /** Une partie lancée : compte (une fois par joueur et par heure, côté serveur). */
  countPlay(id: string): void {
    void this.client.play(id);
  }

  // ------------------------------------------------------------------ écran liste

  listScreen(btn: BtnFactory, open: () => void, actions: WorkshopActions, back: () => void): HTMLElement {
    if (!this.list) this.reload();
    const tabs = <K extends string>(labels: Record<K, string>, current: K, group: string, set: (k: K) => void): HTMLElement =>
      h(
        'div',
        { class: 'menu-row tab-row' },
        ...(Object.keys(labels) as K[]).map((k) => {
          const b = btn(labels[k], () => {
            if (k === current) return;
            set(k);
            this.reload();
            this.onChange?.();
          }, { 'data-nav-group': group, 'data-nav-default': k === current && group === 'ws-sort' });
          b.classList.toggle('selected', k === current);
          return b;
        }),
      );
    let body: (HTMLElement | null)[];
    const l = this.list;
    if (!l || l.kind === 'loading') body = [h('p', { class: 'lb-status', text: 'Chargement des cartes…' })];
    else if (l.kind === 'error') {
      body = [
        h('p', { class: 'lb-status lb-error', text: l.message === 'hors ligne' ? 'Workshop hors ligne.' : `Workshop indisponible : ${l.message}.` }),
        btn('Réessayer', () => {
          this.reload();
          this.onChange?.();
        }, { class: 'menu-btn secondary' }),
      ];
    } else if (l.value.items.length === 0) {
      body = [
        h('p', {
          class: 'menu-note',
          text: this.sort === 'mine' ? "Tu n'as encore rien publié. Dans l'éditeur, termine ta carte en test puis appuie sur Publier." : 'Aucune carte ici pour l\'instant. Sois le premier : Éditeur, puis Publier.',
        }),
      ];
    } else {
      const cards = l.value.items.map((s) => {
        const c = btn('', () => {
          this.select(s);
          open();
        }, { class: 'menu-btn ws-card' });
        c.append(
          thumbCanvas(s.thumb, s.theme),
          h(
            'span',
            { class: 'ws-card-text' },
            h('span', { class: 'map-head' }, h('span', { class: 'map-name', text: s.name }), s.mine ? h('span', { class: 'tier tier-0', text: 'À toi' }) : null),
            h('span', { class: 'map-sub', text: `par ${s.author} · ${LEVEL_MODE_LABEL[s.mode]} · ${s.width} × ${s.height} · ${plural(s.plays, 'partie', 'parties')}` }),
          ),
        );
        return c;
      });
      body = [h('div', { class: 'ws-list' }, ...cards), l.value.items.length < l.value.total ? btn(this.loadingMore ? 'Chargement…' : 'Plus de cartes', () => this.more(), { class: 'menu-btn secondary' }) : null];
    }
    return h(
      'div',
      { class: 'menu-screen wide' },
      h(
        'div',
        { class: 'menu-panel' },
        h('h2', { class: 'menu-title', text: 'Workshop' }),
        h('p', { class: 'menu-note', text: "Les cartes des joueurs : joue-les, télécharge-les, fais-en ta version. Pour publier la tienne : l'éditeur, puis Publier." }),
        tabs(SORT_LABEL, this.sort, 'ws-sort', (k) => (this.sort = k)),
        tabs(MODE_LABEL, this.mode, 'ws-mode', (k) => (this.mode = k)),
        ...body,
        actions.openEditor ? btn('Éditeur', () => actions.openEditor?.(), { class: 'menu-btn secondary' }) : null,
        btn('Retour', back, { class: 'menu-btn secondary' }),
      ),
    );
  }

  // ------------------------------------------------------------------ fiche

  detailScreen(btn: BtnFactory, actions: WorkshopActions, back: () => void): HTMLElement {
    const s = this.selected;
    if (!s) return h('div', { class: 'menu-screen' }, h('div', { class: 'menu-panel' }, btn('Retour', back, { class: 'menu-btn secondary' })));
    const full = this.full?.kind === 'ok' ? this.full.value : null;
    const race = s.mode === 'race';
    const meta = `par ${s.author} · ${LEVEL_MODE_LABEL[s.mode]} · ${THEME_LABEL[s.theme]} · ${s.width} × ${s.height}`;
    const stats = `${plural(s.plays, 'partie', 'parties')} · version ${s.version} · ${dateFr(s.updated)} · ${race ? "temps de l'auteur" : "l'auteur a tout éliminé en"} ${formatTime(s.authorTicks * DT)}`;

    let boardEl: HTMLElement;
    const b = this.board;
    if (!b || b.kind === 'loading') boardEl = h('p', { class: 'lb-status', text: 'Chargement du classement…' });
    else if (b.kind === 'error') boardEl = h('p', { class: 'lb-status lb-error', text: `Classement indisponible : ${b.message}.` });
    else boardEl = this.lb.renderTable(b.value, race);

    let loadNote: HTMLElement | null = null;
    if (this.full?.kind === 'loading') loadNote = h('p', { class: 'lb-status', text: 'Chargement de la carte…' });
    else if (this.full?.kind === 'error') loadNote = h('p', { class: 'lb-status lb-error', text: this.full.message === 'hors ligne' ? 'Workshop hors ligne.' : `Carte indisponible : ${this.full.message}.` });

    const need = (fn: (m: WorkshopMap) => void) => () => {
      if (full) fn(full);
    };
    const playRow = h(
      'div',
      { class: 'menu-row tab-row' },
      btn('Jouer', need((m) => {
        this.countPlay(m.id);
        actions.play(m);
      }), { 'data-nav-default': true }),
      btn('Jouer en ligne', need((m) => actions.playOnline(m))),
    );
    const own = s.mine
      ? this.confirm === 'delete'
        ? h(
            'div',
            { class: 'menu-row tab-row' },
            btn('Supprimer pour de bon', () => {
              void this.client.remove(s.id).then((res) => {
                this.confirm = null;
                if (res.ok) {
                  this.selected = null;
                  this.reload();
                  back();
                } else this.notice = `Suppression impossible : ${res.error}.`;
                this.onChange?.();
              });
            }, { class: 'menu-btn danger' }),
            btn('Annuler', () => {
              this.confirm = null;
              this.onChange?.();
            }, { class: 'menu-btn secondary' }),
          )
        : h(
            'div',
            { class: 'menu-row tab-row' },
            btn('Modifier et republier', need((m) => actions.copy(m, true))),
            btn('Supprimer', () => {
              this.confirm = 'delete';
              this.onChange?.();
            }, { class: 'menu-btn secondary' }),
          )
      : this.confirm === 'report'
        ? h(
            'div',
            { class: 'menu-row tab-row' },
            btn('Oui, la signaler', () => {
              void this.client.report(s.id).then((res) => {
                this.confirm = null;
                this.notice = res.ok ? 'Merci, c\'est noté. Au bout de quelques signalements, la carte quitte les listes.' : `Signalement impossible : ${res.error}.`;
                this.onChange?.();
              });
            }, { class: 'menu-btn danger' }),
            btn('Annuler', () => {
              this.confirm = null;
              this.onChange?.();
            }, { class: 'menu-btn secondary' }),
          )
        : null;
    return h(
      'div',
      { class: 'menu-screen wide' },
      h(
        'div',
        { class: 'menu-panel' },
        h('h2', { class: 'menu-title', text: s.name }),
        h('div', { class: 'ws-banner' }, thumbCanvas(s.thumb, s.theme, 'ws-thumb big')),
        h('p', { class: 'menu-sub ws-meta', text: meta }),
        h('p', { class: 'menu-note', text: stats }),
        s.parent ? h('p', { class: 'menu-note', text: `D'après « ${s.parent.name} » de ${s.parent.author}` }) : null,
        loadNote,
        ...actions.players(),
        playRow,
        h('h3', { class: 'ws-h', text: 'Classement' }),
        boardEl,
        h(
          'div',
          { class: 'menu-row tab-row' },
          btn('Créer une copie', need((m) => actions.copy(m, false))),
          btn('Télécharger', need((m) => download(m))),
          s.mine ? null : btn('Signaler', () => {
            this.confirm = 'report';
            this.onChange?.();
          }, { class: 'menu-btn secondary' }),
        ),
        this.confirm === 'report' ? h('p', { class: 'menu-note', text: 'Signaler cette carte (contenu choquant, nom insultant, carte cassée) ?' }) : null,
        own,
        this.notice ? h('p', { class: 'menu-note', text: this.notice }) : null,
        btn('Retour', back, { class: 'menu-btn secondary' }),
      ),
    );
  }
}
