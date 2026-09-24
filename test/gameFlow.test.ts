import { describe, expect, it } from 'vitest';
import { makeStubGame } from './stubGame';

/** Tue tous les ennemis en écrivant dans l'état : on teste la machine à phases, pas la physique. */
function clearLevel(game: ReturnType<typeof makeStubGame>['game']): void {
  for (const e of game.state.enemies) {
    if (e.alive) game.state.kills++;
    e.alive = 0;
    e.respawnTimer = 0;
  }
}

describe('fin de niveau : phase et actions', () => {
  it('quand le niveau est terminé, le jeu passe en phase "complete" et la boucle se fige', () => {
    const { game } = makeStubGame({ playerCount: 1 });
    game.start(1);
    expect(game.phase).toBe('playing');
    let now = 0;
    const frame = (): void => void game.frame((now += 100));
    frame();
    frame();
    frame();
    expect(game.state.tick).toBeGreaterThan(0);

    clearLevel(game);
    frame(); // le tick suivant constate la fin
    frame();
    expect(game.state.finished).toBe(1);
    expect(game.phase).toBe('complete');
    expect(game.loop.paused).toBe(true);

    const frozenTick = game.state.tick;
    for (let i = 0; i < 30; i++) frame();
    expect(game.state.tick).toBe(frozenTick); // la sim n'avance plus
  });

  it('« Recommencer le niveau » repart à zéro sur la même carte', () => {
    const { game } = makeStubGame({ playerCount: 1, levelId: 2 });
    game.start(1);
    let now = 0;
    const frame = (): void => void game.frame((now += 100));
    frame();
    frame();
    clearLevel(game);
    frame();
    expect(game.phase).toBe('complete');

    game.restart();
    expect(game.phase).toBe('playing');
    expect(game.state.tick).toBe(0);
    expect(game.state.finished).toBe(0);
    expect(game.state.kills).toBe(0);
    expect(game.state.levelId).toBe(2);
    expect(game.state.enemies.every((e) => e.alive === 1)).toBe(true);
  });

  it('« Changer de carte » depuis l\'écran de fin relance sur la nouvelle carte', () => {
    const { game } = makeStubGame({ playerCount: 1, levelId: 0 });
    game.start(1);
    let now = 0;
    const frame = (): void => void game.frame((now += 100));
    frame();
    clearLevel(game);
    frame();
    expect(game.phase).toBe('complete');

    game.setLevel(3);
    expect(game.state.levelId).toBe(3);
    expect(game.phase).toBe('playing');
    expect(game.state.tick).toBe(0);
    expect(game.state.finished).toBe(0);
  });

  it('« Continuer à jouer » rend la main sans réinitialiser la manche', () => {
    const { game } = makeStubGame({ playerCount: 1 });
    game.start(1);
    let now = 0;
    const frame = (): void => void game.frame((now += 100));
    frame();
    frame();
    clearLevel(game);
    frame();
    const finishTick = game.state.finishTick;
    expect(game.phase).toBe('complete');

    game.resumeAfterComplete();
    expect(game.phase).toBe('playing');
    for (let i = 0; i < 10; i++) frame();
    expect(game.state.tick).toBeGreaterThan(finishTick); // la sim tourne à nouveau
    expect(game.state.finished).toBe(1); // mais le niveau reste terminé
    expect(game.state.finishTick).toBe(finishTick); // et le chrono reste figé
  });

  it('le retour en phase "complete" ne se redéclenche pas après « Continuer à jouer »', () => {
    const { game } = makeStubGame({ playerCount: 1 });
    game.start(1);
    let now = 0;
    const frame = (): void => void game.frame((now += 100));
    frame();
    clearLevel(game);
    frame();
    game.resumeAfterComplete();
    for (let i = 0; i < 20; i++) frame();
    expect(game.phase).toBe('playing');
  });
});
