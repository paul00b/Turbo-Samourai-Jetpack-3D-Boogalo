/**
 * Fabrique un `Game` réel avec des dépendances muettes (pas de Pixi, pas de DOM) : la sim,
 * l'historique, le netcode et la machine à phases sont ceux du jeu.
 */
import { makeInput, type GameState, type PlayerInput } from '../src/sim';
import { Game } from '../src/app/game';
import { ParamsStore } from '../src/io/paramsStore';
import { SettingsStore } from '../src/io/settings';

export interface StubOptions {
  seed?: number;
  levelId?: number;
  playerCount?: 1 | 2;
  /** Inputs locaux en mode réseau : appelé avec le slot du joueur local. */
  sampleNet?: (state: GameState, slot: number, scratch: PlayerInput[]) => PlayerInput;
}

export interface StubGame {
  game: Game;
  settings: SettingsStore;
  params: ParamsStore;
}

export function makeStubGame(opts: StubOptions = {}): StubGame {
  const scratch: PlayerInput[] = [makeInput(), makeInput()];
  const settings = new SettingsStore();
  settings.update((s) => {
    s.seed = opts.seed ?? 4242;
    s.levelId = opts.levelId ?? 1;
    s.playerCount = opts.playerCount ?? 2;
    s.debug.trailSeconds = 1;
  });
  const params = new ParamsStore();
  params.resetDefaults();
  const noop = (): void => undefined;
  const deps = {
    renderer: { setLevel: noop, resetCameras: noop, render: noop, screenToWorld: () => false },
    mapper: {
      sample: () => scratch,
      sampleNet: (state: GameState, _picker: unknown, slot: number) =>
        opts.sampleNet ? opts.sampleNet(state, slot, scratch) : scratch[slot],
      flush: noop,
      suppressPauseEdge: noop,
      pausePressed: () => false,
    },
    kbm: { captureKeys: false },
    sfx: { silenceLoops: noop, handleEvents: noop, update: noop },
    settings,
    params,
  };
  const game = new Game(deps as unknown as ConstructorParameters<typeof Game>[0]);
  return { game, settings, params };
}
