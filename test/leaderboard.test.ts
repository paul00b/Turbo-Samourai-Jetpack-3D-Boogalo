/**
 * Classement : replays (encodage, empreintes), vérification par rejeu côté serveur, handler
 * `/api/scores` sur store mémoire, enregistrement dans le Game, client (pseudo, identité).
 *
 * Pour avoir de VRAIS replays gagnants sans bot, on ajoute au registre (dans ce fichier seulement)
 * une mini carte course où marcher vers la droite quelques secondes atteint l'arrivée.
 */
import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  BTN_RIGHT,
  createInitialState,
  decodeReplay,
  DEFAULT_PARAMS,
  encodeReplay,
  hashLevel,
  LEVELS,
  levelHash,
  makeInput,
  MAX_REPLAY_TICKS,
  packInput,
  paramsHash,
  parseLevel,
  step,
  verifyReplay,
  type Level,
  type ReplayData,
} from '../src/sim';
import { handleScores, type ScoresDeps } from '../server/scores/handler';
import { MemoryStore } from '../server/scores/store';
import { UpstashStore } from '../server/scores/upstash';
import { sanitizeName, TOP_N, type SubmitResult } from '../src/net/scoresApi';
import { ReplayRecorder } from '../src/app/replayRecorder';
import { LeaderboardClient } from '../src/io/leaderboard';
import { makeStubGame } from './stubGame';

const MINI_ROWS = [
  '##############################',
  '#...........FF...............#',
  '#...........FF...............#',
  '#...........FF...............#',
  '#...........FF...............#',
  '#...........FF...............#',
  '#...........FF...............#',
  '#...........FF...............#',
  '#...........FF...............#',
  '#..S........FF...............#',
  '##############################',
  '##############################',
];
(LEVELS as Level[]).push(parseLevel(MINI_ROWS, [], 'Mini', '', 'race'));
const MINI = LEVELS.length - 1;
const RIGHT = packInput(makeInput(BTN_RIGHT));
const IDLE = packInput(makeInput());

/** Replay gagnant sur la mini carte : `idle` ticks sans rien faire, puis marcher à droite. */
function winningReplay(idle = 0, seed = 7): ReplayData {
  const s = createInitialState(seed, 1, DEFAULT_PARAMS, MINI);
  const inputs: number[] = [];
  const inp = [makeInput()];
  while (!s.finished && inputs.length < 5000) {
    const v = inputs.length < idle ? IDLE : RIGHT;
    inp[0].buttons = v & 0xffff;
    step(s, inp, []);
    inputs.push(v);
  }
  expect(s.finished).toBe(1);
  return { seed, levelId: MINI, levelHash: levelHash(MINI), paramsHash: paramsHash(DEFAULT_PARAMS), inputs: Uint32Array.from(inputs) };
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function deps(store = new MemoryStore()): ScoresDeps & { store: MemoryStore } {
  return { store, levelCount: () => LEVELS.length };
}

async function post(d: ScoresDeps, body: unknown, ip = '1.1.1.1') {
  return handleScores({ method: 'POST', query: new URLSearchParams(), body: JSON.stringify(body), ip }, d);
}

async function get(d: ScoresDeps, query: string, ip = '1.1.1.1') {
  return handleScores({ method: 'GET', query: new URLSearchParams(query), body: null, ip }, d);
}

describe('replay : encodage', () => {
  it('base64 identique à celui de Node, aller-retour exact', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 31, 256]) {
      const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
      const s = bytesToBase64(b);
      expect(s).toBe(Buffer.from(b).toString('base64'));
      expect(base64ToBytes(s)).toEqual(b);
    }
    expect(base64ToBytes('ab$d')).toBeNull();
    expect(base64ToBytes('abc')).toBeNull();
  });

  it('aller-retour exact, et le RLE écrase les inputs répétés', () => {
    const inputs = new Uint32Array(3000);
    for (let i = 0; i < inputs.length; i++) inputs[i] = i < 1000 ? RIGHT : i < 2000 ? (i % 7 === 0 ? 0x12340001 : RIGHT) : packInput(makeInput(1, (i * 13) & 0xffff));
    const r: ReplayData = { seed: 0xdeadbeef, levelId: 4, levelHash: 0x01020304, paramsHash: 0xa0b0c0d0, inputs };
    const back = decodeReplay(encodeReplay(r));
    expect(back).not.toBeNull();
    expect(back!.seed).toBe(r.seed);
    expect(back!.levelId).toBe(4);
    expect(back!.levelHash).toBe(r.levelHash);
    expect(back!.paramsHash).toBe(r.paramsHash);
    expect(back!.inputs).toEqual(inputs);
    // 1000 ticks identiques : un seul run de quelques octets.
    const flat: ReplayData = { ...r, inputs: new Uint32Array(1000).fill(RIGHT) };
    expect(encodeReplay(flat).length).toBeLessThan(48);
  });

  it('refuse les replays abîmés ou trop longs', () => {
    const good = encodeReplay(winningReplay());
    expect(decodeReplay(good)).not.toBeNull();
    expect(decodeReplay('')).toBeNull();
    expect(decodeReplay('pas du base64 !')).toBeNull();
    expect(decodeReplay(good.slice(0, good.length - 8))).toBeNull();
    const bytes = base64ToBytes(good)!;
    const badMagic = bytes.slice();
    badMagic[0] ^= 0xff;
    expect(decodeReplay(bytesToBase64(badMagic))).toBeNull();
    const badTicks = bytes.slice();
    new DataView(badTicks.buffer).setUint32(17, 99999, true);
    expect(decodeReplay(bytesToBase64(badTicks))).toBeNull();
    const trailing = new Uint8Array(bytes.length + 3);
    trailing.set(bytes);
    expect(decodeReplay(bytesToBase64(trailing))).toBeNull();
    const long: ReplayData = { ...winningReplay(), inputs: new Uint32Array(MAX_REPLAY_TICKS + 1) };
    expect(decodeReplay(encodeReplay(long))).toBeNull();
  });
});

describe('empreintes', () => {
  it('une empreinte par carte, stable, qui change si une tuile change', () => {
    const hashes = [0, 1, 2, 3, 4, 5].map((id) => levelHash(id));
    expect(new Set(hashes).size).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((id) => levelHash(id))).toEqual(hashes);
    const l = LEVELS[3];
    const moved: Level = { ...l, tiles: l.tiles.slice() };
    const i = moved.tiles.findIndex((t) => t === 0);
    moved.tiles[i] = 1;
    expect(hashLevel(moved)).not.toBe(hashLevel(l));
  });

  it('params : l\'empreinte des défauts est stable, un seul param change tout', () => {
    expect(paramsHash({ ...DEFAULT_PARAMS })).toBe(paramsHash(DEFAULT_PARAMS));
    expect(paramsHash({ ...DEFAULT_PARAMS, gravity: DEFAULT_PARAMS.gravity - 1 })).not.toBe(paramsHash(DEFAULT_PARAMS));
  });
});

describe('vérification par rejeu', () => {
  it('une vraie partie est acceptée, avec le temps recalculé', () => {
    const r = winningReplay();
    const v = verifyReplay(r);
    expect(v).toEqual({ ok: true, finishTick: r.inputs.length });
  });

  it('inputs coupés, inputs en trop, carte ou params différents : refusé', () => {
    const r = winningReplay();
    expect(verifyReplay({ ...r, inputs: r.inputs.slice(0, r.inputs.length - 5) }).ok).toBe(false);
    const extra = new Uint32Array(r.inputs.length + 30);
    extra.set(r.inputs);
    expect(verifyReplay({ ...r, inputs: extra }).ok).toBe(false);
    expect(verifyReplay({ ...r, levelHash: r.levelHash ^ 1 }).ok).toBe(false);
    expect(verifyReplay({ ...r, paramsHash: paramsHash({ ...DEFAULT_PARAMS, walkSpeed: 400 }) }).ok).toBe(false);
    expect(verifyReplay({ ...r, levelId: LEVELS.length }).ok).toBe(false);
    // Une partie jouée avec des params modifiés ne se rejoue pas avec les défauts.
    const fast = createInitialState(7, 1, { ...DEFAULT_PARAMS, walkSpeed: 400, walkAccel: 3000 }, MINI);
    const inputs: number[] = [];
    const inp = [makeInput(BTN_RIGHT)];
    while (!fast.finished) {
      step(fast, inp, []);
      inputs.push(RIGHT);
    }
    expect(inputs.length).toBeLessThan(r.inputs.length);
    expect(verifyReplay({ ...r, inputs: Uint32Array.from(inputs) }).ok).toBe(false);
  });
});

describe('handler /api/scores', () => {
  it('accepte une vraie partie et ignore le temps annoncé par le client', async () => {
    const d = deps();
    const r = winningReplay();
    const res = await post(d, { playerId: uuid(1), name: 'Kenji', replay: encodeReplay(r), ticks: 1, time: 0.01 });
    expect(res.status).toBe(200);
    const body = res.body as SubmitResult;
    expect(body.ok).toBe(true);
    expect(body.ticks).toBe(r.inputs.length);
    expect(body.previous).toBeNull();
    expect(body.improved).toBe(true);
    expect(body.top).toEqual([{ rank: 1, name: 'Kenji', ticks: r.inputs.length }]);
    expect(body.me).toEqual({ rank: 1, ticks: r.inputs.length });
  });

  it('refuse les replays trafiqués', async () => {
    const d = deps();
    const r = winningReplay();
    const cases: ReplayData[] = [
      { ...r, inputs: r.inputs.slice(0, r.inputs.length - 1) },
      { ...r, levelHash: 123 },
      { ...r, paramsHash: paramsHash({ ...DEFAULT_PARAMS, gravity: 900 }) },
      { ...r, inputs: new Uint32Array(r.inputs.length) },
    ];
    for (const c of cases) {
      const res = await post(d, { playerId: uuid(2), name: 'Tricheur', replay: encodeReplay(c) });
      expect(res.status).toBe(422);
      expect((res.body as { ok: boolean }).ok).toBe(false);
    }
    expect((await post(d, { playerId: uuid(2), name: 'Tricheur', replay: 'AAAA' })).status).toBe(400);
    expect(await d.store.count(`lb:v1:${levelHash(MINI).toString(16).padStart(8, '0')}`)).toBe(0);
  });

  it('garde le meilleur temps du joueur', async () => {
    const d = deps();
    const fast = winningReplay(0);
    const slow = winningReplay(40);
    await post(d, { playerId: uuid(3), name: 'Aiko', replay: encodeReplay(fast) });
    const res = (await post(d, { playerId: uuid(3), name: 'Aiko', replay: encodeReplay(slow) })).body as SubmitResult;
    expect(res.ticks).toBe(slow.inputs.length);
    expect(res.previous).toBe(fast.inputs.length);
    expect(res.improved).toBe(false);
    expect(res.me).toEqual({ rank: 1, ticks: fast.inputs.length });
    expect(res.total).toBe(1);
  });

  it('top 10 trié du plus rapide au plus lent, ta place au-delà', async () => {
    const d = deps();
    for (let p = 0; p < 12; p++) {
      const ok = await post(d, { playerId: uuid(100 + p), name: `Joueur ${p}`, replay: encodeReplay(winningReplay((11 - p) * 5)) }, `10.0.0.${p}`);
      expect(ok.status).toBe(200);
    }
    const res = await get(d, `level=${MINI}&playerId=${uuid(100)}`);
    const body = res.body as SubmitResult;
    expect(res.status).toBe(200);
    expect(body.total).toBe(12);
    expect(body.top).toHaveLength(TOP_N);
    expect(body.top[0].name).toBe('Joueur 11');
    for (let i = 1; i < body.top.length; i++) expect(body.top[i].ticks).toBeGreaterThan(body.top[i - 1].ticks);
    expect(body.me?.rank).toBe(12);
  });

  it('pseudos et identifiants contrôlés, renommage, limitation de débit', async () => {
    const d = deps();
    const replay = encodeReplay(winningReplay());
    expect((await post(d, { playerId: 'pas-un-uuid', name: 'Kenji', replay })).status).toBe(400);
    expect((await post(d, { playerId: uuid(4), name: 'x', replay })).status).toBe(400);
    expect((await post(d, { playerId: uuid(4), name: '<!>?', replay })).status).toBe(400);
    expect((await get(d, 'level=999')).status).toBe(400);
    await post(d, { playerId: uuid(4), name: 'Kenji', replay });
    expect((await post(d, { action: 'rename', playerId: uuid(4), name: 'Kenji-2' })).status).toBe(200);
    expect(((await get(d, `level=${MINI}`)).body as SubmitResult).top[0].name).toBe('Kenji-2');
    let last = 0;
    for (let i = 0; i < 20; i++) last = (await post(d, { playerId: uuid(5), name: 'Spam', replay }, '9.9.9.9')).status;
    expect(last).toBe(429);
  });

  it('nettoyage des pseudos', () => {
    expect(sanitizeName('  Jean   Kévin  ')).toBe('Jean Kévin');
    expect(sanitizeName('a<b>c')).toBe('abc');
    expect(sanitizeName('ab')).toBeNull();
    expect(sanitizeName('x'.repeat(17))).toBeNull();
    expect(sanitizeName(42)).toBeNull();
  });
});

describe('store Upstash', () => {
  it('parle à l\'API REST en pipeline (ZADD LT pour ne garder que le meilleur)', async () => {
    const calls: unknown[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      const cmds = JSON.parse(String(init.body)) as string[][];
      calls.push(cmds);
      return new Response(JSON.stringify(cmds.map((c) => ({ result: c[0] === 'ZSCORE' ? '300' : 1 }))), { status: 200 });
    }) as unknown as typeof fetch;
    const s = new UpstashStore('https://x.upstash.io', 'tok', fake);
    expect(await s.submit('lb:v1:abc', uuid(1), 250)).toBe(300);
    expect(calls[0]).toEqual([
      ['ZSCORE', 'lb:v1:abc', uuid(1)],
      ['ZADD', 'lb:v1:abc', 'LT', '250', uuid(1)],
    ]);
    expect(UpstashStore.fromEnv({})).toBeNull();
  });
});

describe('enregistrement dans le jeu', () => {
  it('une manche terminée hors ligne, seul, params par défaut : replay vérifiable', () => {
    const { game } = makeStubGame({
      levelId: MINI,
      playerCount: 1,
      sample: (_s, scratch) => {
        scratch[0].buttons = BTN_RIGHT;
        return scratch;
      },
    });
    (game as unknown as { recorder: ReplayRecorder }).recorder = new ReplayRecorder(() => LEVELS.length);
    game.start(1);
    let t = 0;
    for (let f = 0; f < 2000 && game.phase === 'playing'; f++) game.frame((t += 1000 / 60));
    expect(game.phase).toBe('complete');
    const replay = game.recorder.replay(game.state);
    expect(replay).not.toBeNull();
    expect(verifyReplay(replay!)).toEqual({ ok: true, finishTick: game.state.finishTick });
    // Recommencer repart de zéro.
    game.restart();
    expect(game.recorder.ticks).toBe(0);
    expect(game.recorder.unranked).toBeNull();
  });

  it('hors classement : params changés en cours, 2 joueurs, carte non officielle', () => {
    const { game, params } = makeStubGame({ levelId: MINI, playerCount: 1 });
    (game as unknown as { recorder: ReplayRecorder }).recorder = new ReplayRecorder(() => LEVELS.length);
    game.start(1);
    expect(game.recorder.unranked).toBeNull();
    params.set('gravity', 900);
    expect(game.recorder.unranked).toBe('params');
    params.resetDefaults();
    game.start(2);
    expect(game.recorder.unranked).toBe('players');
    // Registre officiel par défaut : la mini carte ajoutée par ce test n'en fait pas partie.
    const rec = new ReplayRecorder();
    rec.reset(createInitialState(1, 1, DEFAULT_PARAMS, MINI), false);
    expect(rec.unranked).toBe('custom');
    rec.reset(createInitialState(1, 1, DEFAULT_PARAMS, 3), true);
    expect(rec.unranked).toBe('online');
  });
});

describe('client', () => {
  it('identité persistée, pseudo nettoyé, soumission sans temps', async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const sent: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(JSON.stringify({ ok: false, error: 'test' }), { status: 400 });
    }) as unknown as typeof fetch;
    const c = new LeaderboardClient(storage, fake, 'api/scores');
    expect(c.identity.name).toBeNull();
    expect(c.setName('  Mi<>ko  ')).toBe(true);
    expect(c.identity.name).toBe('Miko');
    expect(c.setName('a')).toBe(false);
    const again = new LeaderboardClient(storage, fake, 'api/scores');
    expect(again.identity).toEqual(c.identity);
    await c.submit(winningReplay());
    const body = JSON.parse(sent[0]) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['name', 'playerId', 'replay']);
  });
});
