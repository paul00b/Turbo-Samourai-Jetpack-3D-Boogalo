import { describe, expect, it } from 'vitest';
import { getLevel, LEVEL_INFOS, LEVEL_MODE_LABEL } from '../src/sim';
import { SettingsStore } from '../src/io/settings';
import { restartHint } from '../src/ui/hud';
import { makeStubGame } from './stubGame';

const RACE = LEVEL_INFOS.find((l) => l.mode === 'race')!.id;
const ARCADE = LEVEL_INFOS.find((l) => l.mode === 'kills')!.id;

/** Une partie à une touche près : `press` simule le front de « Recommencer » (R). */
function setup(levelId: number) {
  const key = { press: false };
  const stub = makeStubGame({ playerCount: 1, levelId, restartPressed: () => key.press });
  stub.game.start(1);
  let now = 0;
  const frame = (): void => void stub.game.frame((now += 100));
  return { ...stub, key, frame };
}

describe('mode course : R recommence à zéro', () => {
  it('en pleine course, R repart du départ avec le chrono à zéro', () => {
    const { game, key, frame } = setup(RACE);
    const spawnX = game.state.players[0].x;
    for (let i = 0; i < 5; i++) frame();
    expect(game.state.tick).toBeGreaterThan(0);
    game.state.players[0].x += 600;
    game.state.players[0].deaths = 2;
    key.press = true;
    frame();
    key.press = false;
    expect(game.phase).toBe('playing');
    expect(game.state.tick).toBe(0);
    expect(game.state.levelId).toBe(RACE);
    expect(game.state.players[0].x).toBe(spawnX);
    expect(game.state.players[0].deaths).toBe(0);
    // Le chrono repart : la course reprend normalement.
    for (let i = 0; i < 3; i++) frame();
    expect(game.state.tick).toBeGreaterThan(0);
  });

  it("à l'arrivée, R relance aussi la course (sans repasser par le menu)", () => {
    const { game, key, frame } = setup(RACE);
    frame();
    const goal = getLevel(RACE).goal!;
    game.state.players[0].x = goal.x + goal.w / 2;
    game.state.players[0].y = goal.y + goal.h / 2;
    frame();
    frame();
    expect(game.state.finished).toBe(1);
    expect(game.phase).toBe('complete');
    key.press = true;
    frame();
    expect(game.phase).toBe('playing');
    expect(game.state.tick).toBe(0);
    expect(game.state.finished).toBe(0);
  });

  it('en arcade, R ne fait rien : on recommence depuis la pause', () => {
    const { game, key, frame } = setup(ARCADE);
    for (let i = 0; i < 3; i++) frame();
    const tick = game.state.tick;
    key.press = true;
    frame();
    expect(game.state.tick).toBeGreaterThan(tick);
  });

  it('en pause, R attend : Échap puis « Recommencer »', () => {
    const { game, key, frame } = setup(RACE);
    for (let i = 0; i < 3; i++) frame();
    game.pause();
    const tick = game.state.tick;
    key.press = true;
    frame();
    expect(game.phase).toBe('paused');
    expect(game.state.tick).toBe(tick);
  });
});

describe('menu rapide', () => {
  it('le menu principal propose deux modes, course et arcade, chacun avec ses cartes', () => {
    expect(LEVEL_MODE_LABEL).toEqual({ race: 'Course', kills: 'Arcade' });
    expect(LEVEL_INFOS.filter((l) => l.mode === 'race').length).toBeGreaterThanOrEqual(1);
    expect(LEVEL_INFOS.filter((l) => l.mode === 'kills').length).toBeGreaterThanOrEqual(1);
  });

  it('les outils de debug sont masqués par défaut ; R et Select recommencent', () => {
    const s = new SettingsStore().get();
    expect(s.debug.showPanels).toBe(false);
    expect(s.keyboard.restart).toEqual(['KeyR']);
    expect(s.gamepad.restart).toEqual([{ type: 'button', index: 8 }]);
  });

  it('le HUD rappelle la bonne touche : le clavier si quelqu\'un y joue, sinon la manette', () => {
    const s = structuredClone(new SettingsStore().get());
    s.playerCount = 1;
    s.devices[0].kind = 'kbm';
    expect(restartHint(s)).toBe('R recommencer');
    s.devices[0].kind = 'gamepad';
    expect(restartHint(s)).toBe('Select / Share recommencer');
  });
});
