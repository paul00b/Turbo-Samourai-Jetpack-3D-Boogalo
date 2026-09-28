/**
 * Cartes perso sauvegardées dans le navigateur (localStorage). Tout accès est protégé : navigation
 * privée ou stockage bloqué = l'éditeur marche quand même, sans mémoire.
 */
import type { MapDoc } from './format';
import type { MapMode } from './grid';
import type { ThemeId } from '../render/art/themes/types';

export interface SavedMap extends MapDoc {
  id: string;
  updated: number;
}

const KEY = 'tsj.editor.maps.v1';
const CURRENT = 'tsj.editor.current.v1';

function readAll(): SavedMap[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(isSavedMap);
  } catch {
    return [];
  }
}

function isSavedMap(m: unknown): m is SavedMap {
  const o = m as SavedMap;
  return (
    !!o &&
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    (o.mode === 'kills' || o.mode === 'race') &&
    typeof o.theme === 'string' &&
    Array.isArray(o.rows) &&
    o.rows.every((r) => typeof r === 'string')
  );
}

function writeAll(list: SavedMap[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export class EditorStore {
  list(): SavedMap[] {
    return readAll().sort((a, b) => b.updated - a.updated);
  }

  get(id: string): SavedMap | null {
    return readAll().find((m) => m.id === id) ?? null;
  }

  /** Crée ou met à jour. Renvoie faux si le stockage a refusé. */
  save(map: SavedMap): boolean {
    const list = readAll().filter((m) => m.id !== map.id);
    list.push({ ...map, updated: Date.now() });
    return writeAll(list);
  }

  remove(id: string): void {
    writeAll(readAll().filter((m) => m.id !== id));
  }

  create(doc: MapDoc): SavedMap {
    const map: SavedMap = { ...doc, rows: doc.rows.slice(), id: newId(), updated: Date.now() };
    this.save(map);
    return map;
  }

  /** Nom libre : « Ma carte », « Ma carte 2 »… */
  freeName(base: string): string {
    const names = readAll().map((m) => m.name);
    if (!names.includes(base)) return base;
    for (let i = 2; ; i++) if (!names.includes(`${base} ${i}`)) return `${base} ${i}`;
  }

  get currentId(): string | null {
    try {
      return localStorage.getItem(CURRENT);
    } catch {
      return null;
    }
  }

  set currentId(id: string | null) {
    try {
      if (id) localStorage.setItem(CURRENT, id);
      else localStorage.removeItem(CURRENT);
    } catch {
      /* stockage indisponible : on oublie simplement */
    }
  }
}

function newId(): string {
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export type { MapMode, ThemeId };
