/**
 * "Builds" de paramètres : des presets nommés et annotés, pour comparer des réglages de feel.
 * Persistés en localStorage, indépendants des params courants (qui restent dans ParamsStore).
 */
import { PARAM_KEYS, paramsFromPartial, type SimParams } from '../sim';

export interface ParamBuild {
  id: string;
  name: string;
  /** Note libre : ce que ce build cherche à obtenir, ce qu'il donne en jeu. */
  note: string;
  params: SimParams;
  createdAt: string;
  updatedAt: string;
}

export const MAX_BUILDS = 64;
export const MAX_NAME = 60;
export const MAX_NOTE = 600;

const STORAGE_KEY = 'tsj.builds.v1';

/** Sous-ensemble de localStorage : permet de tester sans navigateur. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Listener = (builds: readonly ParamBuild[]) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function cleanName(raw: string, fallback: string): string {
  const n = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return n.length > 0 ? n : fallback;
}

/** Compte les paramètres qui diffèrent entre deux jeux de params (pour situer un build d'un coup d'œil). */
export function countParamDiff(a: Readonly<SimParams>, b: Readonly<SimParams>): number {
  let n = 0;
  for (const k of PARAM_KEYS) if (a[k] !== b[k]) n++;
  return n;
}

export class BuildsStore {
  private builds: ParamBuild[] = [];
  private listeners: Listener[] = [];
  private seq = 0;

  constructor(private readonly storage: StorageLike | null = defaultStorage()) {
    this.builds = this.load();
  }

  list(): readonly ParamBuild[] {
    return this.builds;
  }

  get(id: string): ParamBuild | null {
    return this.builds.find((b) => b.id === id) ?? null;
  }

  /** Sauvegarde les params passés sous un nouveau nom. Le plus ancien saute si la limite est atteinte. */
  create(name: string, params: Readonly<SimParams>, note = ''): ParamBuild {
    const build: ParamBuild = {
      id: this.nextId(),
      name: cleanName(name, `Build ${this.builds.length + 1}`),
      note: note.slice(0, MAX_NOTE),
      params: paramsFromPartial({ ...params } as Record<string, unknown>),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.builds.unshift(build);
    if (this.builds.length > MAX_BUILDS) this.builds.length = MAX_BUILDS;
    this.commit();
    return build;
  }

  rename(id: string, name: string): void {
    this.patch(id, (b) => (b.name = cleanName(name, b.name)));
  }

  setNote(id: string, note: string): void {
    this.patch(id, (b) => (b.note = note.slice(0, MAX_NOTE)));
  }

  /** Écrase le build avec d'autres params (typiquement les params courants). */
  update(id: string, params: Readonly<SimParams>): void {
    this.patch(id, (b) => (b.params = paramsFromPartial({ ...params } as Record<string, unknown>)));
  }

  remove(id: string): void {
    const before = this.builds.length;
    this.builds = this.builds.filter((b) => b.id !== id);
    if (this.builds.length !== before) this.commit();
  }

  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  private patch(id: string, fn: (b: ParamBuild) => void): void {
    const b = this.get(id);
    if (!b) return;
    fn(b);
    b.updatedAt = nowIso();
    this.commit();
  }

  private nextId(): string {
    this.seq++;
    return `b${Date.now().toString(36)}${this.seq.toString(36)}`;
  }

  private commit(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.builds));
    } catch {
      /* stockage plein ou indisponible : les builds vivent au moins le temps de la session */
    }
    for (const l of this.listeners) l(this.builds);
  }

  /** Tolérant : un build corrompu ou d'une version antérieure est assaini, pas rejeté. */
  private load(): ParamBuild[] {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return [];
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const out: ParamBuild[] = [];
      for (const item of parsed.slice(0, MAX_BUILDS)) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Partial<ParamBuild>;
        if (typeof o.id !== 'string') continue;
        out.push({
          id: o.id,
          name: cleanName(String(o.name ?? ''), 'Build'),
          note: String(o.note ?? '').slice(0, MAX_NOTE),
          params: paramsFromPartial((o.params ?? {}) as Record<string, unknown>),
          createdAt: typeof o.createdAt === 'string' ? o.createdAt : nowIso(),
          updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : nowIso(),
        });
      }
      return out;
    } catch {
      return [];
    }
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
