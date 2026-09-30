/**
 * Tutoriel : la carte (règles de l'éditeur sans le moindre avertissement, panneaux qui ne mordent
 * aucune tuile, points de reprise posés au sol), les textes (touches du joueur, police qui sait tout
 * écrire), la police pixel, et les points de reprise dans le vrai Game.
 */
import { describe, expect, it } from 'vitest';
import { BTN_RIGHT, CUSTOM_LEVEL_ID, getLevel, isSolidTile, T_AIR, TILE_SIZE, tileAt, validateRows } from '../src/sim';
import { buildTutorialLevel, checkpointSpawn, fillTokens, TUTORIAL_CHECKPOINTS, TUTORIAL_ROWS, TUTORIAL_SIGNS, TUTORIAL_STATIONS, TUTORIAL_THEME, tutorialKeys } from '../src/app/tutorial';
import { DEFAULT_SETTINGS, type Settings } from '../src/io/settings';
import { ART_TILE } from '../src/render/art/levelShape';
import { signBox } from '../src/render/art/signs';
import { Buf, C } from '../src/render/pixel/engine';
import { drawText, hasGlyph, normalizeText, textWidth } from '../src/render/pixel/font';
import { objectiveText } from '../src/ui/hud';
import { makeStubGame } from './stubGame';

const padSettings = (): Settings => ({ ...DEFAULT_SETTINGS, devices: [{ kind: 'gamepad', gamepadIndex: 0 }, DEFAULT_SETTINGS.devices[1]] });

describe('carte du tutoriel', () => {
  it("respecte toutes les règles de l'éditeur, sans un seul avertissement", () => {
    expect(validateRows(TUTORIAL_ROWS, 'race')).toEqual([]);
  });

  it('un point de reprise par atelier, dans l\'ordre, debout sur du sol plein', () => {
    const level = buildTutorialLevel(tutorialKeys(DEFAULT_SETTINGS, null, 'fr'));
    expect(TUTORIAL_CHECKPOINTS).toHaveLength(TUTORIAL_STATIONS.length);
    const standY = Math.floor(level.spawnY / TILE_SIZE);
    for (let k = 0; k < TUTORIAL_CHECKPOINTS.length; k++) {
      const x = TUTORIAL_CHECKPOINTS[k];
      if (k > 0) expect(x).toBeGreaterThan(TUTORIAL_CHECKPOINTS[k - 1]);
      expect(tileAt(level, x, standY), `reprise ${k}`).toBe(T_AIR);
      expect(isSolidTile(tileAt(level, x, standY + 1)), `sol sous la reprise ${k}`).toBe(true);
      for (let y = standY - 3; y < standY; y++) expect(tileAt(level, x, y), `tête libre à la reprise ${k}`).toBe(T_AIR);
    }
    expect(checkpointSpawn(level, 0)).toEqual({ x: level.spawnX, y: level.spawnY });
  });

  it('les panneaux ne mordent aucune tuile et ne se chevauchent pas', () => {
    for (const keys of [tutorialKeys(DEFAULT_SETTINGS, null, 'fr'), tutorialKeys(padSettings())]) {
      const level = buildTutorialLevel(keys);
      const boxes = (level.signs ?? []).map(signBox);
      boxes.forEach((b, i) => {
        for (let ty = Math.floor(b.y / ART_TILE); ty <= Math.floor((b.y + b.h - 1) / ART_TILE); ty++) {
          for (let tx = Math.floor(b.x / ART_TILE); tx <= Math.floor((b.x + b.w - 1) / ART_TILE); tx++) {
            expect(isSolidTile(tileAt(level, tx, ty)) || tileAt(level, tx, ty) !== T_AIR, `panneau ${i} sur la tuile (${tx}, ${ty})`).toBe(false);
          }
        }
        boxes.forEach((o, j) => {
          if (j <= i) return;
          const overlap = b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h;
          expect(overlap, `panneaux ${i} et ${j}`).toBe(false);
        });
      });
    }
  });
});

describe('textes du tutoriel', () => {
  it('les touches du joueur 1 : clavier (AZERTY supposé en français sans navigator.keyboard), manette', () => {
    expect(tutorialKeys(DEFAULT_SETTINGS, null, 'fr-FR')).toMatchObject({ LEFT: 'Q', RIGHT: 'D', HOOK_L: 'Clic gauche', HOOK_R: 'Clic droit', JET: 'Espace', RESTART: 'R', PAUSE: 'Échap', AIM: 'LA SOURIS' });
    expect(tutorialKeys(DEFAULT_SETTINGS, null, 'en-US').LEFT).toBe('A');
    expect(tutorialKeys(DEFAULT_SETTINGS, new Map([['KeyA', 'q']]), 'en-US').LEFT).toBe('Q');
    expect(tutorialKeys(padSettings())).toMatchObject({ LEFT: 'Stick G ←', RIGHT: '→', HOOK_L: 'LB', HOOK_R: 'RB', JET: 'RT', PAUSE: 'Start', RESTART: 'Select', AIM: 'LE STICK DROIT' });
  });

  it('tous les jetons sont remplacés, et la police sait écrire chaque caractère', () => {
    for (const keys of [tutorialKeys(DEFAULT_SETTINGS, null, 'fr'), tutorialKeys(DEFAULT_SETTINGS, null, 'en'), tutorialKeys(padSettings())]) {
      for (const s of buildTutorialLevel(keys).signs ?? []) {
        for (const line of [s.title, ...s.lines]) {
          expect(line, line).not.toMatch(/\{(LEFT|RIGHT|HOOK_L|HOOK_R|JET|RESTART|PAUSE|AIM)\}/);
          for (const ch of normalizeText(line)) expect(hasGlyph(ch), `« ${ch} » dans « ${line} »`).toBe(true);
        }
      }
    }
    expect(fillTokens('MAINTIENS {JET}', { ...tutorialKeys(DEFAULT_SETTINGS, null, 'fr') })).toBe('MAINTIENS {Espace}');
    expect(TUTORIAL_SIGNS.length).toBeGreaterThanOrEqual(TUTORIAL_STATIONS.length);
  });
});

describe('police pixel', () => {
  it('proportionnelle, accents au-dessus, touches en couleur, inconnu = espace', () => {
    expect(textWidth('I')).toBeLessThan(textWidth('M'));
    expect(textWidth('ÉTÉ')).toBe(textWidth('ETE'));
    expect(textWidth('{ESPACE}')).toBe(textWidth('ESPACE'));
    expect(textWidth('A', 2)).toBe(textWidth('A') * 2);
    const b = new Buf(80, 12);
    const white = C('#ffffff');
    const blue = C('#4fd1ff');
    drawText(b, 0, 0, 'É {A}', { color: white, accent: blue });
    expect(b.get(3, 0)).toBe(white); // accent aigu, au-dessus de la lettre
    expect([...b.d].some((c) => c === blue)).toBe(true);
    expect(hasGlyph('¤')).toBe(false);
    expect(drawText(new Buf(10, 10), 0, 0, '¤', { color: white })).toBe(3);
  });
});

describe('tutoriel dans le jeu', () => {
  const walkRight = { sample: (_s: unknown, scratch: { buttons: number }[]) => ((scratch[0].buttons = BTN_RIGHT), scratch) };

  it('un atelier atteint au sol devient le point de reprise ; recommencer ramène au début', () => {
    const { game } = makeStubGame({ playerCount: 1, ...(walkRight as object) });
    const level = buildTutorialLevel(tutorialKeys(DEFAULT_SETTINGS, null, 'fr'));
    const start = { x: level.spawnX, y: level.spawnY };
    game.startTutorial(level, TUTORIAL_CHECKPOINTS, TUTORIAL_THEME, 1);
    expect(game.tutorial).toBe(true);
    expect(game.state.levelId).toBe(CUSTOM_LEVEL_ID);
    expect(game.recorder.unranked).toBe('custom');
    expect(objectiveText(game.state)).toBe(`Atelier 1 / ${TUTORIAL_STATIONS.length} · Bienvenue`);
    const tick = (game as unknown as { tick: () => boolean }).tick;
    for (let i = 0; i < 2000 && game.state.players[0].x < TUTORIAL_CHECKPOINTS[1] * TILE_SIZE + 40; i++) tick.call(game);
    const cp1 = checkpointSpawn(level, 1);
    expect(getLevel(CUSTOM_LEVEL_ID).spawnX).toBe(cp1.x);
    expect(objectiveText(game.state)).toBe(`Atelier 2 / ${TUTORIAL_STATIONS.length} · Jetpack`);

    // Une chute dans les pics : retour au dernier atelier atteint, pas au début.
    const spikes = TUTORIAL_ROWS[TUTORIAL_ROWS.length - 2].indexOf('^');
    const pl = game.state.players[0];
    pl.x = spikes * TILE_SIZE + TILE_SIZE / 2;
    pl.y = (TUTORIAL_ROWS.length - 2) * TILE_SIZE + TILE_SIZE / 2;
    pl.grounded = 0;
    tick.call(game);
    expect(game.state.players[0].deaths).toBe(1);
    expect(game.state.players[0].x).toBeCloseTo(cp1.x, 0);

    game.restart();
    expect(getLevel(CUSTOM_LEVEL_ID).spawnX).toBe(start.x);
    expect(game.state.players[0].x).toBeCloseTo(start.x, 0);
    game.endCustom();
    expect(game.tutorial).toBe(false);
    expect(game.state.levelId).not.toBe(CUSTOM_LEVEL_ID);
  });
});
