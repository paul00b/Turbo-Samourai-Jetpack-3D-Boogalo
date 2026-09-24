import { describe, expect, it } from 'vitest';
import { BuildsStore, countParamDiff, MAX_BUILDS, MAX_NAME, type StorageLike } from '../src/io/buildsStore';
import { cloneParams, DEFAULT_PARAMS } from '../src/sim';

/** localStorage de test : le store doit marcher sans navigateur. */
function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('builds de paramètres', () => {
  it('sauvegarde, renomme, annote et retrouve un build', () => {
    const store = new BuildsStore(memory());
    const p = cloneParams(DEFAULT_PARAMS);
    p.jetForce = 4000;
    const b = store.create('Jetpack de brute', p, 'Ça monte trop vite au plafond.');
    expect(store.list()).toHaveLength(1);
    expect(store.get(b.id)?.params.jetForce).toBe(4000);
    store.rename(b.id, '  Jetpack   de   brute v2 ');
    expect(store.get(b.id)?.name).toBe('Jetpack de brute v2'); // espaces normalisés
    store.setNote(b.id, 'Mieux avec reelSpeed bas.');
    expect(store.get(b.id)?.note).toBe('Mieux avec reelSpeed bas.');
  });

  it('les params sauvegardés sont indépendants des params courants', () => {
    const store = new BuildsStore(memory());
    const p = cloneParams(DEFAULT_PARAMS);
    const b = store.create('Snapshot', p);
    p.gravity = 99; // on continue à bouger les sliders après la sauvegarde
    expect(store.get(b.id)?.params.gravity).toBe(DEFAULT_PARAMS.gravity);
  });

  it('un build est assaini : valeurs hors bornes et champs manquants', () => {
    const storage = memory();
    storage.setItem(
      'tsj.builds.v1',
      JSON.stringify([
        { id: 'x1', name: '', params: { gravity: 999999, substeps: 3.7, inconnu: 12 } },
        { pasDId: true },
      ]),
    );
    const store = new BuildsStore(storage);
    expect(store.list()).toHaveLength(1); // l'entrée sans id est ignorée
    const b = store.list()[0];
    expect(b.name).toBe('Build');
    expect(b.params.gravity).toBe(5000); // borné par PARAM_META
    expect(b.params.substeps).toBe(4); // entier
    expect(b.params.jetForce).toBe(DEFAULT_PARAMS.jetForce); // champ absent -> défaut
  });

  it('persiste entre deux instances et supprime', () => {
    const storage = memory();
    const a = new BuildsStore(storage);
    const b1 = a.create('Un', cloneParams(DEFAULT_PARAMS));
    a.create('Deux', cloneParams(DEFAULT_PARAMS));
    const b = new BuildsStore(storage);
    expect(b.list().map((x) => x.name)).toEqual(['Deux', 'Un']); // le plus récent en tête
    b.remove(b1.id);
    expect(new BuildsStore(storage).list().map((x) => x.name)).toEqual(['Deux']);
  });

  it('nom tronqué, note tronquée, nombre de builds borné', () => {
    const store = new BuildsStore(memory());
    const long = store.create('x'.repeat(200), cloneParams(DEFAULT_PARAMS), 'n'.repeat(5000));
    expect(long.name).toHaveLength(MAX_NAME);
    expect(long.note.length).toBeLessThanOrEqual(600);
    for (let i = 0; i < MAX_BUILDS + 5; i++) store.create(`b${i}`, cloneParams(DEFAULT_PARAMS));
    expect(store.list()).toHaveLength(MAX_BUILDS);
  });

  it('countParamDiff situe un build par rapport aux params courants', () => {
    const a = cloneParams(DEFAULT_PARAMS);
    const b = cloneParams(DEFAULT_PARAMS);
    expect(countParamDiff(a, b)).toBe(0);
    b.gravity += 1;
    b.jetForce += 1;
    expect(countParamDiff(a, b)).toBe(2);
  });

  it('sans stockage (localStorage indisponible), tout marche en mémoire', () => {
    const store = new BuildsStore(null);
    store.create('Volatile', cloneParams(DEFAULT_PARAMS));
    expect(store.list()).toHaveLength(1);
  });
});
