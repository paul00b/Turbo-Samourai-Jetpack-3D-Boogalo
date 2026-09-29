/**
 * Workshop : contrat partagé (contrôle des cartes, noms, aperçu), rejeu sur une carte perso, handler
 * `/api/workshop` sur stores mémoire (publication avec preuve, listes, classement, modération) et
 * store Upstash (les commandes envoyées).
 *
 * Carte de test : une petite course où marcher vers la droite quelques secondes atteint l'arrivée,
 * pour avoir de VRAIS replays gagnants sans bot.
 */
import { describe, expect, it } from 'vitest';
import {
  BTN_RIGHT,
  createInitialState,
  CUSTOM_LEVEL_ID,
  DEFAULT_PARAMS,
  encodeReplay,
  getCustomLevel,
  hashLevel,
  makeInput,
  packInput,
  paramsHash,
  parseLevel,
  setCustomLevel,
  step,
  verifyCustomReplay,
  type Level,
  type ReplayData,
} from '../src/sim';
import {
  checkDoc,
  isWorkshopId,
  makeThumb,
  sanitizeMapName,
  THUMB_MAX_H,
  THUMB_MAX_W,
  WS_MAX_PER_AUTHOR,
  WS_PAGE,
  type PublishResult,
  type WorkshopBoardResult,
  type WorkshopDoc,
  type WorkshopGetResult,
  type WorkshopListResult,
} from '../src/net/workshopApi';
import type { SubmitResult } from '../src/net/scoresApi';
import { handleWorkshop, workshopBoardKey, type WorkshopDeps } from '../server/workshop/handler';
import { MemoryWorkshopStore } from '../server/workshop/store';
import { UpstashWorkshopStore } from '../server/workshop/upstash';
import { MemoryStore } from '../server/scores/store';
import { hashState, hashToHex } from '../src/sim';
import type { WorkshopMap } from '../src/net/workshopApi';
import { NetGame } from '../src/net/netGame';
import { PROTOCOL_VERSION, type PeerMsg } from '../src/net/protocol';
import type { Game } from '../src/app/game';
import { makeStubGame } from './stubGame';

/** Course de w × h : sol plein, spawn à gauche, arrivée (2 colonnes) en `goalX`. */
function raceRows(goalX = 12, w = 40, h = 16): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      if (y === 0 || x === 0 || x === w - 1 || y >= h - 2) r += '#';
      else if (x >= goalX && x < goalX + 2) r += 'F';
      else if (y === h - 3 && x === 3) r += 'S';
      else r += '.';
    }
    rows.push(r);
  }
  return rows;
}

const doc = (name = 'Petite course', rows = raceRows()): WorkshopDoc => ({ name, mode: 'race', theme: 'port', rows });
const level = (d: WorkshopDoc): Level => parseLevel(d.rows, [], d.name, '', d.mode);
const RIGHT = packInput(makeInput(BTN_RIGHT));
const IDLE = packInput(makeInput());

/** Replay qui termine la carte : `idle` ticks sans rien faire, puis marcher à droite. */
function winning(d: WorkshopDoc, idle = 0, seed = 7): ReplayData {
  const lv = level(d);
  const before = getCustomLevel();
  setCustomLevel(lv);
  try {
    const s = createInitialState(seed, 1, DEFAULT_PARAMS, CUSTOM_LEVEL_ID);
    const inputs: number[] = [];
    const inp = [makeInput()];
    while (!s.finished && inputs.length < 5000) {
      const v = inputs.length < idle ? IDLE : RIGHT;
      inp[0].buttons = v & 0xffff;
      step(s, inp, []);
      inputs.push(v);
    }
    expect(s.finished).toBe(1);
    return { seed, levelId: CUSTOM_LEVEL_ID, levelHash: hashLevel(lv), paramsHash: paramsHash(DEFAULT_PARAMS), inputs: Uint32Array.from(inputs) };
  } finally {
    setCustomLevel(before);
  }
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function deps(): WorkshopDeps & { ws: MemoryWorkshopStore; scores: MemoryStore } {
  let t = 1_000_000;
  return { ws: new MemoryWorkshopStore(), scores: new MemoryStore(), adminKey: 'cle-admin-secrete', now: () => (t += 1000) };
}

let ipSeq = 0;
/** Une IP par requête par défaut : les tests ne butent pas sur la limitation de débit. */
async function post(d: WorkshopDeps, body: unknown, ip = `10.0.0.${ipSeq++ % 250}`) {
  return handleWorkshop({ method: 'POST', query: new URLSearchParams(), body: JSON.stringify(body), ip }, d);
}

async function get(d: WorkshopDeps, query: string, ip = `10.1.0.${ipSeq++ % 250}`) {
  return handleWorkshop({ method: 'GET', query: new URLSearchParams(query), body: null, ip }, d);
}

async function publish(d: WorkshopDeps, player: number, m = doc(), extra: Record<string, unknown> = {}): Promise<PublishResult> {
  const res = await post(d, { action: 'publish', playerId: uuid(player), name: `Joueur ${player}`, map: m, replay: encodeReplay(winning(m)), ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as PublishResult;
}

describe('contrat du workshop', () => {
  it('noms de carte nettoyés, bornés', () => {
    expect(sanitizeMapName('  La   grande  course ')).toBe('La grande course');
    expect(sanitizeMapName("L’île <b>maudite</b>")).toBe("L'île bmauditeb");
    expect(sanitizeMapName('ab')).toBeNull();
    expect(sanitizeMapName('x'.repeat(33))).toBeNull();
    expect(sanitizeMapName(42)).toBeNull();
  });

  it('une carte envoyée est contrôlée : forme, tailles, caractères, règles bloquantes', () => {
    expect(checkDoc(doc()).ok).toBe(true);
    expect(checkDoc({ ...doc(), name: '?' }).ok).toBe(false);
    expect(checkDoc({ ...doc(), mode: 'foot' }).ok).toBe(false);
    expect(checkDoc({ ...doc(), theme: 'lune' }).ok).toBe(false);
    expect(checkDoc({ ...doc(), rows: raceRows(12, 20) }).ok).toBe(false); // trop étroite
    expect(checkDoc({ ...doc(), rows: raceRows(12, 40, 12) }).ok).toBe(false); // trop basse
    const bad = raceRows();
    bad[5] = bad[5].slice(0, 10) + 'X' + bad[5].slice(11);
    expect(checkDoc({ ...doc(), rows: bad }).ok).toBe(false);
    const noSpawn = raceRows().map((r) => r.replace('S', '.'));
    const r = checkDoc({ ...doc(), rows: noSpawn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/spawn/i);
    // Arrivée derrière un mur du plafond au sol : refusée avant même la preuve.
    const sealed = raceRows().map((row, y) => (y > 0 && y < 14 ? row.slice(0, 8) + '#' + row.slice(9) : row));
    expect(checkDoc({ ...doc(), rows: sealed }).ok).toBe(false);
  });

  it("l'aperçu tient dans 96 × 24 et garde spawn, arrivée et danger", () => {
    const small = makeThumb(raceRows());
    expect(small).toHaveLength(16);
    expect(small[13][3]).toBe('S');
    expect(small[5][12]).toBe('F');
    const wide = Array.from({ length: 160 }, (_, y) => (y === 150 ? '^'.repeat(600) : '#'.repeat(600)));
    const t = makeThumb(wide);
    expect(t.length).toBeLessThanOrEqual(THUMB_MAX_H);
    expect(t[0].length).toBeLessThanOrEqual(THUMB_MAX_W);
    expect(t.some((row) => row.includes('^'))).toBe(true);
  });
});

describe('rejeu sur une carte perso', () => {
  it('accepte la vraie partie, refuse une autre carte, remet la carte perso en place', () => {
    const d = doc();
    const r = winning(d);
    const marker = level(doc('Autre', raceRows(20)));
    setCustomLevel(marker);
    const ok = verifyCustomReplay(r, level(d));
    expect(ok).toEqual({ ok: true, finishTick: r.inputs.length });
    expect(getCustomLevel()).toBe(marker);
    expect(verifyCustomReplay(r, level(doc('Autre', raceRows(20)))).ok).toBe(false);
    expect(verifyCustomReplay({ ...r, levelId: 3 }, level(d)).ok).toBe(false);
    expect(verifyCustomReplay({ ...r, inputs: r.inputs.slice(0, -5) }, level(d)).ok).toBe(false);
    setCustomLevel(null);
  });
});

describe('handler /api/workshop : publication', () => {
  it('publie avec la preuve de fin : la carte apparaît, son auteur ouvre le classement', async () => {
    const d = deps();
    const m = doc();
    const res = await publish(d, 1, m);
    expect(res.created).toBe(true);
    expect(isWorkshopId(res.map.id)).toBe(true);
    expect(res.map).toMatchObject({ name: 'Petite course', mode: 'race', theme: 'port', width: 40, height: 16, author: 'Joueur 1', mine: true, version: 1, plays: 0, parent: null });
    expect(res.map.authorTicks).toBe(winning(m).inputs.length);

    const list = (await get(d, 'list=recent')).body as WorkshopListResult;
    expect(list.items.map((i) => i.id)).toEqual([res.map.id]);
    expect(list.items[0].mine).toBe(false); // sans playerId, personne n'est l'auteur

    const full = (await get(d, `id=${res.map.id}&playerId=${uuid(2)}`)).body as WorkshopGetResult;
    expect(full.map.rows).toEqual(m.rows);
    expect(full.map.mine).toBe(false);

    const board = (await get(d, `board=${res.map.id}&playerId=${uuid(1)}`)).body as WorkshopBoardResult;
    expect(board.top).toEqual([{ rank: 1, name: 'Joueur 1', ticks: res.map.authorTicks }]);
    expect(board.me?.rank).toBe(1);
  });

  it('sans preuve, avec la preuve d\'une autre carte ou une preuve coupée : refusé', async () => {
    const d = deps();
    const m = doc();
    const base = { action: 'publish', playerId: uuid(1), name: 'Joueur 1', map: m };
    expect((await post(d, base)).status).toBe(400);
    expect((await post(d, { ...base, replay: 'pas du base64' })).status).toBe(400);
    const other = winning(doc('Autre', raceRows(20)));
    expect((await post(d, { ...base, replay: encodeReplay(other) })).status).toBe(422);
    const r = winning(m);
    expect((await post(d, { ...base, replay: encodeReplay({ ...r, inputs: r.inputs.slice(0, -3) }) })).status).toBe(422);
    expect((await post(d, { ...base, name: '!' , replay: encodeReplay(r) })).status).toBe(400);
    expect((await post(d, { ...base, map: { ...m, name: '' }, replay: encodeReplay(r) })).status).toBe(400);
    expect(((await get(d, 'list=recent')).body as WorkshopListResult).total).toBe(0);
  });

  it("republier : même id, version suivante ; une nouvelle géométrie remet le classement à zéro ; un autre joueur ne peut pas", async () => {
    const d = deps();
    const first = await publish(d, 1);
    const id = first.map.id;
    await post(d, { action: 'score', playerId: uuid(2), name: 'Rival', id, replay: encodeReplay(winning(doc(), 30)) });
    expect(((await get(d, `board=${id}`)).body as WorkshopBoardResult).total).toBe(2);

    // Même géométrie, autre nom : le classement reste.
    const renamed = await publish(d, 1, doc('Petite course 2'), { id });
    expect(renamed.created).toBe(false);
    expect(renamed.map).toMatchObject({ id, version: 2, name: 'Petite course 2', created: first.map.created });
    expect(((await get(d, `board=${id}`)).body as WorkshopBoardResult).total).toBe(2);

    // Nouvelle géométrie : nouveau classement, ouvert par le temps de l'auteur.
    const moved = await publish(d, 1, doc('Plus longue', raceRows(20)), { id });
    expect(moved.map.version).toBe(3);
    expect(moved.map.hash).not.toBe(first.map.hash);
    const board = (await get(d, `board=${id}`)).body as WorkshopBoardResult;
    expect(board.total).toBe(1);
    expect(board.top[0].ticks).toBe(moved.map.authorTicks);
    expect(await d.scores.count(workshopBoardKey(id, first.map.hash))).toBe(0);

    const stolen = await post(d, { action: 'publish', playerId: uuid(3), name: 'Pirate', map: doc(), replay: encodeReplay(winning(doc())), id });
    expect(stolen.status).toBe(403);
  });

  it('une copie publiée garde la trace de la carte d\'origine', async () => {
    const d = deps();
    const orig = await publish(d, 1);
    const copy = await publish(d, 2, doc('Ma version', raceRows(16)), { parentId: orig.map.id });
    expect(copy.map.parent).toEqual({ id: orig.map.id, name: 'Petite course', author: 'Joueur 1' });
  });

  it(`au plus ${WS_MAX_PER_AUTHOR} cartes par joueur`, async () => {
    const d = deps();
    for (let i = 0; i < WS_MAX_PER_AUTHOR; i++) await publish(d, 1, doc(`Carte ${i}`, raceRows(8 + (i % 20))));
    const res = await post(d, { action: 'publish', playerId: uuid(1), name: 'Joueur 1', map: doc(), replay: encodeReplay(winning(doc())) });
    expect(res.status).toBe(409);
  });

  it('limitation de débit : trop de publications depuis la même adresse', async () => {
    const d = deps();
    const m = doc();
    const body = { action: 'publish', playerId: uuid(1), name: 'Joueur 1', map: m, replay: encodeReplay(winning(m)) };
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await post(d, body, '9.9.9.9')).status);
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes[7]).toBe(429);
  });
});

describe('handler /api/workshop : listes, parties, classement', () => {
  it('récentes, populaires (une partie par joueur et par heure), filtre par mode, les miennes, pages', async () => {
    const d = deps();
    const a = await publish(d, 1, doc('Alpha', raceRows(10)));
    const b = await publish(d, 2, doc('Bravo', raceRows(14)));
    const recent = (await get(d, 'list=recent')).body as WorkshopListResult;
    expect(recent.items.map((i) => i.name)).toEqual(['Bravo', 'Alpha']);

    for (const p of [3, 4, 4, 4]) await post(d, { action: 'play', playerId: uuid(p), id: a.map.id });
    const popular = (await get(d, 'list=popular')).body as WorkshopListResult;
    expect(popular.items.map((i) => [i.name, i.plays])).toEqual([['Alpha', 2], ['Bravo', 0]]);

    expect(((await get(d, 'list=recent&mode=kills')).body as WorkshopListResult).total).toBe(0);
    expect(((await get(d, 'list=recent&mode=race')).body as WorkshopListResult).total).toBe(2);
    expect((await get(d, 'list=recent&mode=foot')).status).toBe(400);

    const mine = (await get(d, `list=mine&playerId=${uuid(2)}`)).body as WorkshopListResult;
    expect(mine.items.map((i) => [i.id, i.mine])).toEqual([[b.map.id, true]]);
    expect((await get(d, 'list=mine')).status).toBe(400);

    for (let i = 0; i < WS_PAGE + 3; i++) await publish(d, 10 + i, doc(`Page ${i}`, raceRows(8 + (i % 20))));
    const p1 = (await get(d, 'list=recent')).body as WorkshopListResult;
    const p2 = (await get(d, `list=recent&offset=${WS_PAGE}`)).body as WorkshopListResult;
    expect(p1.items).toHaveLength(WS_PAGE);
    expect(p2.items).toHaveLength(5);
    expect(p1.total).toBe(WS_PAGE + 5);
  });

  it('classement d\'une carte du workshop : le serveur rejoue, garde le meilleur, refuse le faux', async () => {
    const d = deps();
    const m = doc();
    const pub = await publish(d, 1, m);
    const id = pub.map.id;
    const slow = await post(d, { action: 'score', playerId: uuid(2), name: 'Rival', id, replay: encodeReplay(winning(m, 60)) });
    expect(slow.status).toBe(200);
    const s1 = slow.body as SubmitResult;
    expect(s1.previous).toBeNull();
    expect(s1.me?.rank).toBe(2);
    const fast = (await post(d, { action: 'score', playerId: uuid(2), name: 'Rival', id, replay: encodeReplay(winning(m, 0, 9)) })).body as SubmitResult;
    expect(fast.improved).toBe(true);
    expect(fast.me?.ticks).toBe(pub.map.authorTicks);
    const fake = await post(d, { action: 'score', playerId: uuid(2), name: 'Rival', id, replay: encodeReplay(winning(doc('Autre', raceRows(20)))) });
    expect(fake.status).toBe(422);
    expect((await post(d, { action: 'score', playerId: uuid(2), name: 'Rival', id: 'zzzzzzzzzz', replay: encodeReplay(winning(m)) })).status).toBe(404);
  });
});

describe('handler /api/workshop : modération', () => {
  it('trois joueurs signalent : la carte quitte les listes, seul son auteur la voit encore', async () => {
    const d = deps();
    const pub = await publish(d, 1);
    const id = pub.map.id;
    expect((await post(d, { action: 'report', playerId: uuid(1), id })).status).toBe(400); // pas sa propre carte
    for (const p of [2, 3, 3]) expect((await post(d, { action: 'report', playerId: uuid(p), id })).status).toBe(200);
    expect(((await get(d, 'list=recent')).body as WorkshopListResult).total).toBe(1);
    await post(d, { action: 'report', playerId: uuid(4), id });
    expect(((await get(d, 'list=recent')).body as WorkshopListResult).total).toBe(0);
    expect(((await get(d, 'list=popular')).body as WorkshopListResult).total).toBe(0);
    expect((await get(d, `id=${id}&playerId=${uuid(5)}`)).status).toBe(404);
    expect((await get(d, `id=${id}&playerId=${uuid(1)}`)).status).toBe(200);
    const mine = (await get(d, `list=mine&playerId=${uuid(1)}`)).body as WorkshopListResult;
    expect(mine.total).toBe(1);
  });

  it("suppression : par l'auteur, par l'admin avec la bonne clé, jamais par un autre", async () => {
    const d = deps();
    const a = await publish(d, 1, doc('Alpha', raceRows(10)));
    const b = await publish(d, 1, doc('Bravo', raceRows(14)));
    expect((await post(d, { action: 'delete', playerId: uuid(2), id: a.map.id })).status).toBe(403);
    expect((await post(d, { action: 'delete', adminKey: 'mauvaise-cle', playerId: uuid(2), id: a.map.id })).status).toBe(403);
    expect((await post(d, { action: 'delete', playerId: uuid(1), id: a.map.id })).status).toBe(200);
    expect((await get(d, `id=${a.map.id}&playerId=${uuid(1)}`)).status).toBe(404);
    expect(await d.scores.count(workshopBoardKey(a.map.id, a.map.hash))).toBe(0);
    expect((await post(d, { action: 'delete', adminKey: 'cle-admin-secrete', id: b.map.id })).status).toBe(200);
    expect(((await get(d, 'list=recent')).body as WorkshopListResult).total).toBe(0);
  });

  it('requêtes mal formées et limitation de débit des lectures', async () => {
    const d = deps();
    expect((await get(d, 'id=pas-un-id')).status).toBe(404);
    expect((await get(d, 'list=nimporte')).status).toBe(400);
    expect((await get(d, 'list=recent&offset=-1')).status).toBe(400);
    expect((await post(d, { action: 'play', playerId: 'moi', id: 'abcdefghjk' })).status).toBe(400);
    expect((await post(d, { action: 'danse', playerId: uuid(1) })).status).toBe(400);
    expect((await handleWorkshop({ method: 'POST', query: new URLSearchParams(), body: '{', ip: '1' }, d)).status).toBe(400);
    expect((await handleWorkshop({ method: 'DELETE', query: new URLSearchParams(), body: null, ip: '1' }, d)).status).toBe(405);
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await get(d, 'list=recent', '8.8.8.8')).status;
    expect(last).toBe(429);
  });
});

describe('store Upstash du workshop', () => {
  it('parle en pipeline : fiche et lignes à part, listes par mode, partie comptée une fois (SET NX)', async () => {
    const sent: (string | number)[][][] = [];
    const replies: unknown[][] = [];
    const s = new UpstashWorkshopStore(async (cmds) => {
      sent.push(cmds);
      return replies.shift() ?? cmds.map(() => null);
    });
    const rec = { id: 'abcdefghjk', name: 'Alpha', mode: 'race' as const, theme: 'port' as const, width: 40, height: 16, authorId: uuid(1), created: 1, updated: 2, version: 1, authorTicks: 300, hash: '0badf00d', parent: null, thumb: ['#'], hidden: false };
    replies.push(['3']);
    await s.save(rec, ['##', '..']);
    const flat = sent[1].map((c) => c.join(' '));
    expect(flat).toContain(`SET ws:r:abcdefghjk ##\n..`);
    expect(flat).toContain('ZADD ws:recent:race 2 abcdefghjk');
    expect(flat).toContain('ZADD ws:pop:all 3 abcdefghjk');
    expect(flat).toContain(`SADD ws:by:${uuid(1)} abcdefghjk`);

    sent.length = 0;
    replies.push([['abcdefghjk'], 1]);
    expect(await s.list('popular', 'race', 20, 20)).toEqual({ ids: ['abcdefghjk'], total: 1 });
    expect(sent[0][0]).toEqual(['ZREVRANGE', 'ws:pop:race', 20, 39]);

    sent.length = 0;
    replies.push([null], ['7']);
    expect(await s.addPlay(rec, uuid(2))).toBe(7);
    expect(sent[0][0]).toEqual(['SET', `ws:pl:abcdefghjk:${uuid(2)}`, 1, 'NX', 'EX', 3600]);
    expect(sent[1][0]).toEqual(['HGET', 'ws:plays', 'abcdefghjk']);
  });
});

/** Une carte du workshop telle que l'API la rend (lignes, empreinte, aperçu). */
function wsMap(d = doc(), id = 'abcdefghjk'): WorkshopMap {
  return {
    id,
    name: d.name,
    mode: d.mode,
    theme: d.theme,
    width: d.rows[0].length,
    height: d.rows.length,
    author: 'Kenji',
    mine: false,
    created: 0,
    updated: 0,
    version: 1,
    plays: 0,
    authorTicks: 0,
    hash: hashToHex(hashLevel(level(d))),
    parent: null,
    thumb: makeThumb(d.rows),
    rows: d.rows.slice(),
  };
}

/** Joue des ticks jusqu'à la fin de la manche (la boucle réelle, un tick à la fois). */
function playToEnd(game: Game, max = 5000): void {
  const tick = (game as unknown as { tick: () => boolean }).tick;
  for (let i = 0; i < max && !game.state.finished; i++) tick.call(game);
}

describe('dans le jeu', () => {
  const walkRight = { sample: (_s: unknown, scratch: ReturnType<typeof makeInput>[]) => ((scratch[0].buttons = BTN_RIGHT), scratch) };

  it('une carte du workshop jouée seul donne un replay que le serveur accepte', () => {
    const { game } = makeStubGame({ playerCount: 1, ...walkRight });
    const m = wsMap();
    expect(game.startWorkshop(m, 1)).toBe(true);
    expect(game.state.levelId).toBe(CUSTOM_LEVEL_ID);
    expect(game.workshopMap?.id).toBe(m.id);
    playToEnd(game);
    expect(game.recorder.unranked).toBeNull();
    const replay = game.recorder.replay(game.state)!;
    expect(verifyCustomReplay(replay, level(doc()))).toEqual({ ok: true, finishTick: game.state.finishTick });
    game.endCustom();
    expect(game.workshopMap).toBeNull();
    expect(game.state.levelId).not.toBe(CUSTOM_LEVEL_ID);
  });

  it("le test de l'éditeur réussi seul sert de preuve ; à deux, non", () => {
    const { game } = makeStubGame({ playerCount: 1, ...walkRight });
    setCustomLevel(level(doc()));
    game.startCustom(1);
    playToEnd(game);
    expect(game.recorder.replay(game.state)).not.toBeNull();
    game.startCustom(2);
    expect(game.recorder.unranked).toBe('players');
    game.endCustom();
    setCustomLevel(null);
  });

  it("une carte abîmée (empreinte différente) ne se joue pas", () => {
    const { game } = makeStubGame({ playerCount: 1 });
    const m = { ...wsMap(), hash: 'deadbeef' };
    expect(game.startWorkshop(m, 1)).toBe(false);
    expect(game.workshopMap).toBeNull();
  });

  it("en ligne : l'hôte envoie la carte avec la config, l'invité la joue à l'identique, recommencer la garde", () => {
    const host = makeStubGame({ playerCount: 2, seed: 99 });
    const guest = makeStubGame({ playerCount: 2, seed: 1 });
    const sent: PeerMsg[][] = [[], []];
    const net = [host, guest].map((g, slot) => {
      const ng = new NetGame({ game: g.game, settings: g.settings, params: g.params });
      Object.assign(ng, {
        session: { isHost: slot === 0, status: 'connected', code: 'ABC234', error: '', sendPeer: (m: PeerMsg) => sent[slot].push(m), close: () => undefined },
      });
      return ng as unknown as { hostMap: WorkshopMap | null; onStatus: (s: string) => void; onPeer: (m: PeerMsg) => void; message: string };
    });
    const m = wsMap();
    net[0].hostMap = m;
    net[0].onStatus('connected');
    const config = sent[0].find((x) => x.t === 'config');
    expect(config).toMatchObject({ t: 'config', version: PROTOCOL_VERSION, levelId: CUSTOM_LEVEL_ID, map: { id: m.id, hash: m.hash } });
    net[1].onPeer(JSON.parse(JSON.stringify(config)) as PeerMsg);
    expect(guest.game.workshopMap?.id).toBe(m.id);
    expect(guest.game.state.levelId).toBe(CUSTOM_LEVEL_ID);
    expect(hashToHex(hashState(guest.game.state))).toBe(hashToHex(hashState(host.game.state)));

    // L'hôte recommence : même carte des deux côtés.
    host.game.restart();
    const restart = sent[0].filter((x) => x.t === 'restart').pop() as Extract<PeerMsg, { t: 'restart' }>;
    expect(restart.levelId).toBe(CUSTOM_LEVEL_ID);
    guest.game.netRestart(restart.gen, restart.seed, restart.levelId);
    expect(guest.game.workshopMap?.id).toBe(m.id);
    // Puis passe sur une carte officielle : l'invité quitte la carte du workshop.
    guest.game.netRestart(restart.gen + 1, restart.seed, 3);
    expect(guest.game.workshopMap).toBeNull();
    expect(guest.game.state.levelId).toBe(3);
  });

  it("en ligne : une carte reçue abîmée annule la partie au lieu de désynchroniser", () => {
    const guest = makeStubGame({ playerCount: 2 });
    const ng = new NetGame({ game: guest.game, settings: guest.settings, params: guest.params });
    Object.assign(ng, { session: { isHost: false, status: 'connected', code: 'ABC234', error: '', sendPeer: () => undefined, close: () => undefined } });
    const n = ng as unknown as { onPeer: (m: PeerMsg) => void; message: string; play: unknown };
    n.onPeer({ t: 'config', version: PROTOCOL_VERSION, seed: 1, levelId: CUSTOM_LEVEL_ID, params: {}, map: { ...wsMap(), hash: 'deadbeef' } });
    expect(n.play).toBeNull();
    expect(n.message).toMatch(/abîmée/);
    expect(guest.game.workshopMap).toBeNull();
  });
});
