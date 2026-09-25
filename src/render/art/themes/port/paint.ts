/**
 * Port d'Umibozu, peintre de carte (pur). La planche est une scène composée à la main ; ici la même
 * grammaire habille n'importe quelle carte :
 *   - accrochable (#) = BOIS : pontons, défenses, solives, poutres de cargaison. Arête claire chaude.
 *   - lisse (=) = pierre mouillée à reflets obliques froids.
 *   - mortel (^) = pieux à pointe rouge plantés dans l'eau noire du fond de la cave.
 * Les masses (sol, murs) sont un quai de pierre sombre, habillé de bois sur chaque face exposée :
 * c'est le bois qui dit « on s'accroche ici », la pierre reste dans les valeurs sombres.
 */
import { T_SLICK, T_SOLID } from '../../../../sim';
import { Buf, dith, fsin, hash2, type Color } from '../../../pixel/engine';
import { banner, lantern, sagPoint, sagRope, stakes, WOOD } from '../../../pixel/kit';
import { ART_TILE, solidAt, type LevelShape, type Region } from '../../levelShape';
import {
  deckSpots,
  FACE_BOTTOM,
  FACE_LEFT,
  FACE_RIGHT,
  FACE_TOP,
  floatingBlocks,
  forEachSolid,
  goalArt,
  isCaveAir,
  lightVeil,
  risingRope,
  rowPairs,
  slickTile,
  stoneTile,
  type SolidTile,
} from '../paintKit';
import type { LevelCanvases, PropAnim, PropInstance } from '../types';
import { K } from './palette';

const T = ART_TILE;
const C_WHITE: Color = 0xffffffff;

// ------------------------------------------------------------------ masses accrochables

/** Ponton (dessus exposé) : les planches de la planche, arête claire chaude. */
function deckTrim(b: Buf, s: SolidTile): void {
  const y = s.Y;
  for (let x = s.X; x < s.X + T; x++) {
    b.px(x, y, WOOD.top);
    b.px(x, y + 1, WOOD.mid);
    for (let j = 2; j < 6; j++) b.px(x, y + j, WOOD.body);
    b.px(x, y + 6, WOOD.dark);
    if (x % 11 === 5) {
      for (let j = 2; j < 6; j++) b.px(x, y + j, WOOD.seam);
      if (hash2(x, y, 3) > 0.6 && x + 4 < s.X + T) b.px(x + 4, y + 3 + ((x * 7) % 3), WOOD.knot);
    }
  }
  // Bouts de planches aux extrémités (trou, bord de quai).
  if (s.faces & FACE_LEFT) for (let j = 0; j < 6; j++) b.px(s.X, y + j, j === 0 ? WOOD.top : WOOD.mid);
  if (s.faces & FACE_RIGHT) for (let j = 0; j < 6; j++) b.px(s.X + T - 1, y + j, j === 0 ? WOOD.top : WOOD.dark);
}

/** Défense verticale (face latérale exposée) : planches debout, liseré moyen. */
function fenderTrim(b: Buf, s: SolidTile, right: boolean): void {
  const x0 = right ? s.X + T - 4 : s.X;
  for (let y = s.Y; y < s.Y + T; y++) {
    for (let i = 0; i < 4; i++) {
      const outer = right ? i === 3 : i === 0;
      const inner = right ? i === 0 : i === 3;
      let c: Color = outer ? WOOD.mid : inner ? WOOD.dark : WOOD.post;
      if (y % 14 === 6 && !outer) c = WOOD.seam;
      b.px(x0 + i, y, c);
    }
    if (y % 14 === 9 && hash2(s.X, y, 4) > 0.4) b.px(right ? x0 + 1 : x0 + 2, y, K.rivet);
  }
}

/** Solives sous un plafond de quai (dessous exposé) : on s'y accroche par en dessous. */
function joistTrim(b: Buf, s: SolidTile): void {
  const y1 = s.Y + T - 1;
  for (let x = s.X; x < s.X + T; x++) {
    b.px(x, y1, WOOD.mid);
    b.px(x, y1 - 1, WOOD.post);
    b.px(x, y1 - 2, WOOD.post);
    b.px(x, y1 - 3, WOOD.dark);
    if (x % 32 === 3 || x % 32 === 4) {
      b.px(x, y1 - 1, WOOD.dark);
      b.px(x, y1 - 2, WOOD.dark);
    }
    if (x % 32 === 12) b.px(x, y1 - 2, K.rivet);
  }
}

function quayTile(b: Buf, s: SolidTile): void {
  stoneTile(b, s, K.quay, 16, 8, 23);
  // Pierre qui ruisselle sous le ponton : quelques traînées plus claires.
  for (let x = s.X; x < s.X + T; x++) {
    if (hash2(x, 0, 41) > 0.93) {
      const len = 3 + Math.floor(hash2(x, 1, 41) * 8);
      for (let j = 0; j < len && 7 + j < T; j++) if (hash2(x, s.Y + j, 42) > 0.25) b.px(x, s.Y + 7 + j, K.quayWet);
    }
  }
  if (s.faces & FACE_LEFT) fenderTrim(b, s, false);
  if (s.faces & FACE_RIGHT) fenderTrim(b, s, true);
  if (s.faces & FACE_BOTTOM) joistTrim(b, s);
  if (s.faces & FACE_TOP) deckTrim(b, s);
}

/** Pieu de bois (pilier accrochable) : fibre verticale, cordages enroulés. */
function pileTile(b: Buf, s: SolidTile, r: Region): void {
  const x0 = r.x0 * T;
  const w = (r.x1 - r.x0 + 1) * T;
  for (let y = s.Y; y < s.Y + T; y++) {
    for (let x = s.X; x < s.X + T; x++) {
      const i = x - x0;
      let c: Color = WOOD.body;
      if (i === 0) c = WOOD.postHi;
      else if (i === w - 1) c = WOOD.dark;
      else if (i % 7 === 3) c = WOOD.seam;
      else if (hash2(x, y >> 2, 17) > 0.85) c = WOOD.knot;
      if (y % 28 < 3 && i > 0 && i < w - 1) c = (y % 28) === 1 ? K.hemp : WOOD.mid;
      b.px(x, y, c);
    }
  }
  if (s.faces & FACE_TOP) {
    b.hline(s.X, s.X + T - 1, s.Y, WOOD.top);
    b.hline(s.X, s.X + T - 1, s.Y + 1, WOOD.mid);
  }
  if (s.faces & FACE_BOTTOM) b.hline(s.X, s.X + T - 1, s.Y + T - 1, WOOD.mid);
}

/** Poutre de cargaison ou pile de caisses (ancrage flottant). */
function paintFloat(b: Buf, r: Region): void {
  const X = r.x0 * T;
  const Y = r.y0 * T;
  const W = (r.x1 - r.x0 + 1) * T;
  const H = (r.y1 - r.y0 + 1) * T;
  const variant = hash2(r.x0, r.y0, 77);
  if (W >= 2 * T && W <= 4 * T && variant > 0.62) {
    // Caisses cerclées, une par tuile.
    for (let cx = X; cx < X + W; cx += T) {
      for (let cy = Y; cy < Y + H; cy += T) {
        b.rect(cx, cy, T, T, WOOD.body);
        b.rect(cx + 1, cy + 1, 2, T - 2, WOOD.mid);
        b.line(cx + 1, cy + 1, cx + T - 2, cy + T - 2, WOOD.seam);
        b.line(cx + T - 2, cy + 1, cx + 1, cy + T - 2, WOOD.seam);
        b.hline(cx, cx + T - 1, cy, WOOD.top);
        b.hline(cx, cx + T - 1, cy + T - 1, WOOD.mid);
        b.rect(cx, cy, 1, T, WOOD.dark);
        b.rect(cx + T - 1, cy + 1, 1, T - 2, WOOD.dark);
        b.hline(cx + 1, cx + T - 2, cy + 5, K.iron);
        b.hline(cx + 1, cx + T - 2, cy + T - 6, K.iron);
        b.px(cx + 3, cy + 5, K.rivet);
        b.px(cx + T - 4, cy + T - 6, K.rivet);
      }
    }
    return;
  }
  // Poutre épaisse : planches horizontales, frettes de fer aux deux bouts.
  for (let y = Y; y < Y + H; y++) {
    const j = y - Y;
    for (let x = X; x < X + W; x++) {
      let c: Color = WOOD.body;
      if (j === 0) c = WOOD.top;
      else if (j === 1) c = WOOD.mid;
      else if (j === H - 1) c = WOOD.mid;
      else if (j === H - 2) c = WOOD.dark;
      else if (j === H - 3) c = WOOD.post;
      else if ((j - 1) % 5 === 0) c = WOOD.seam;
      else if (x % 13 === 6) c = WOOD.seam;
      else if (hash2(x, y, 5) > 0.97) c = WOOD.knot;
      b.px(x, y, c);
    }
  }
  for (const fx of [X + 3, X + W - 6]) {
    b.rect(fx, Y + 1, 3, H - 2, K.iron);
    b.px(fx + 1, Y + 3, K.rivet);
    b.px(fx + 1, Y + H - 4, K.rivet);
  }
  b.rect(X, Y + 1, 1, H - 2, WOOD.mid);
  b.rect(X + W - 1, Y + 1, 1, H - 2, WOOD.dark);
}

function paintSolids(shape: LevelShape, b: Buf): void {
  const doneRegions = new Set<number>();
  forEachSolid(shape, (s) => {
    if (s.type === T_SLICK) {
      slickTile(b, s, { base: K.slick, gloss: K.gloss, top: K.slickTop, edge: K.slickEdge });
      return;
    }
    const r = s.region;
    if (r.kind === 'float' || r.kind === 'slab') {
      if (!doneRegions.has(r.id)) {
        doneRegions.add(r.id);
        paintFloat(b, r);
      }
      return;
    }
    if (r.kind === 'pillar') {
      pileTile(b, s, r);
      return;
    }
    quayTile(b, s);
  });
}

// ------------------------------------------------------------------ dessous du ponton (cave)

function paintCave(shape: LevelShape, b: Buf): void {
  const holes = new Set<number>();
  for (let tx = 0; tx < shape.w; tx++) {
    if (!solidAt(shape, tx, shape.floorRow) && !solidAt(shape, tx, shape.floorRow + 1)) holes.add(tx);
  }
  for (let ty = shape.floorRow; ty < shape.h; ty++) {
    for (let tx = 0; tx < shape.w; tx++) {
      if (!isCaveAir(shape, tx, ty)) continue;
      const X = tx * T;
      const Y = ty * T;
      const nearHole = holes.has(tx) || holes.has(tx - 1) || holes.has(tx + 1);
      const onFloor = solidAt(shape, tx, ty + 1);
      for (let y = Y; y < Y + T; y++) {
        for (let x = X; x < X + T; x++) {
          const depth = (y - shape.floorRow * T) / Math.max(1, (shape.h - shape.floorRow) * T);
          let c: Color = dith(x, y, K.under, K.underBeam, 0.35 - depth * 0.3);
          // Pieux du ponton, tous les 48 px, avec leurs croisillons.
          const px = ((x % 48) + 48) % 48;
          if (px < 5) c = px === 0 ? K.underPostHi : K.underPost;
          else {
            const bay = Math.floor(x / 48);
            if (bay % 2 === 0) {
              const u = px - 5;
              const v = (y - shape.floorRow * T) % 43;
              if (Math.abs(u - v) < 1 || Math.abs(u - (42 - v)) < 1) c = K.underBeam;
            }
          }
          if (nearHole) {
            const shaft = holes.has(tx) ? 0.32 : 0.14;
            if (dith(x, y, 0, 1, shaft * (1 - depth * 0.7)) === 1) c = K.water[1];
          }
          b.px(x, y, c);
        }
      }
      // Eau noire au fond : les pieux mortels y sont plantés.
      if (onFloor) {
        for (let x = X; x < X + T; x++) {
          const yb = Y + T;
          b.px(x, yb - 6, fsin(x * 0.7) > 0.6 ? K.water[2] : K.water[1]);
          for (let j = 5; j >= 1; j--) b.px(x, yb - j, dith(x, yb - j, K.water[0], K.water[1], j / 6));
        }
      }
    }
  }
}

function paintSpikes(shape: LevelShape, b: Buf): void {
  for (const run of shape.spikes) {
    const X0 = run.x0 * T;
    const X1 = (run.x1 + 1) * T - 1;
    const yb = (run.y + 1) * T;
    stakes(b, X0, X1 - 6, yb - 1, K.stake, K.stakeHi, K.tip, 12);
    // Ligne d'eau devant le pied des pieux.
    for (let x = X0; x <= X1; x++) {
      b.px(x, yb - 4, fsin(x * 0.9 + run.y) > 0.3 ? K.water[3] : K.water[2]);
      b.px(x, yb - 3, K.water[1]);
      b.px(x, yb - 2, dith(x, yb - 2, K.water[0], K.water[1], 0.5));
      b.px(x, yb - 1, K.water[0]);
    }
  }
}

// ------------------------------------------------------------------ gréement, guirlandes, ponton

/** Dalles de pierre lisse suspendues : chaînes de fer (maillons un pixel sur deux). */
function paintChains(shape: LevelShape, b: Buf): void {
  for (const r of floatingBlocks(shape, T_SLICK)) {
    const X = r.x0 * T;
    const Y = r.y0 * T;
    const W = (r.x1 - r.x0 + 1) * T;
    const n = Math.max(2, Math.round(W / (4 * T)) + 1);
    for (let k = 0; k < n; k++) {
      const x = Math.round(X + 6 + ((W - 13) * k) / (n - 1));
      for (let y = Y - 1, i = 0; y > Y - 120 && y > 0; y--, i++) {
        if (solidAt(shape, Math.floor(x / T), Math.floor(y / T))) break;
        const fade = i < 70 ? 1 : 1 - (i - 70) / 50;
        if (fade < 1 && hash2(x, y, 44) > fade) continue;
        b.px(x, y, i % 4 < 2 ? K.stoneDk : K.stone);
        if (i % 4 === 1) b.px(x + (i % 8 < 4 ? 1 : -1), y, K.stoneDk);
      }
    }
  }
}

function paintSupports(shape: LevelShape, b: Buf): void {
  paintChains(shape, b);
  for (const r of floatingBlocks(shape)) {
    const X = r.x0 * T;
    const Y = r.y0 * T;
    const W = (r.x1 - r.x0 + 1) * T;
    const hooks = W > 8 * T ? Math.ceil(W / (6 * T)) : 1;
    for (let k = 0; k < hooks; k++) {
      const segX = X + (W * k) / hooks;
      const segW = W / hooks;
      const ax = Math.round(segX + segW / 2);
      const ay = Y - 14 - Math.floor(hash2(r.x0 + k, r.y0, 91) * 10);
      if (solidAt(shape, Math.floor(ax / T), Math.floor(ay / T))) continue;
      b.line(Math.round(segX + 4), Y - 1, ax, ay + 2, K.rig);
      b.line(Math.round(segX + segW - 5), Y - 1, ax, ay + 2, K.rig);
      // Poulie : bloc de bois sombre et son axe de fer.
      b.rect(ax - 1, ay - 1, 3, 4, WOOD.post);
      b.px(ax, ay, K.rivet);
      risingRope(b, shape, ax, ay - 2, 70 + Math.floor(hash2(r.x0, r.y0 + k, 92) * 50), K.rig, 40, r.id + 7);
    }
  }
}

function paintStrings(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  const blocks = floatingBlocks(shape);
  const rows = [...new Set(blocks.map((r) => r.y0))].sort((a, c) => a - c);
  for (const [a, c] of rowPairs(blocks, 12)) {
    const seed = hash2(a.x0, a.y0, 51);
    if (seed < 0.25) continue;
    const ax = (a.x1 + 1) * T - 2;
    const ay = a.y1 * T + T - 3;
    const bx = c.x0 * T + 1;
    const by = c.y1 * T + T - 3;
    const gap = bx - ax;
    const sag = 8 + gap * 0.1;
    sagRope(b, ax, ay, bx, by, sag, K.lantern.rope);
    const lowRow = rows.indexOf(a.y0) >= rows.length - 2;
    if (lowRow || seed > 0.7) {
      const n = Math.max(1, Math.floor(gap / 26));
      for (let i = 1; i <= n; i++) {
        const [x, y] = sagPoint(ax, ay, bx, by, sag, i / (n + 1));
        props.push({ kind: 'lantern', x: Math.round(x), y: Math.round(y), phase: hash2(a.x0, i, 52) * 4, layer: 'back' });
      }
    } else {
      // Fanions rouge et blanc sur les cordes des rangées hautes.
      for (let s = 0.08, i = 0; s < 0.94; s += 8 / gap, i++) {
        const [x, y] = sagPoint(ax, ay, bx, by, sag, s);
        const col = i % 2 ? K.pennant : K.cloth;
        b.poly([x, y, x + 3, y, x + 1.5, y + 4], col);
      }
    }
  }
}

function paintDeck(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  const spots = deckSpots(shape, 5, 61, { mainFloorOnly: true, margin: 2 });
  spots.forEach((spot, i) => {
    const x = spot.x;
    const y = spot.y;
    const kind = hash2(Math.floor(x / T), i, 62);
    if (i % 3 === 0) {
      props.push({ kind: 'nobori', x, y, phase: hash2(x, 1, 63) * 2, layer: 'back' });
      return;
    }
    if (kind < 0.25) {
      // Tonneaux (planche : deux fûts cerclés).
      for (const dx of [0, 11]) {
        const bx = x + dx - 6;
        b.rect(bx, y - 13, 10, 13, WOOD.body);
        b.rect(bx + 1, y - 13, 2, 13, WOOD.mid);
        b.hline(bx, bx + 9, y - 10, WOOD.seam);
        b.hline(bx, bx + 9, y - 4, WOOD.seam);
        b.hline(bx, bx + 9, y - 13, WOOD.top);
      }
    } else if (kind < 0.45) {
      // Caisse en X.
      const bx = x - 7;
      b.rect(bx, y - 12, 14, 12, WOOD.body);
      b.line(bx, y - 12, bx + 13, y - 1, WOOD.seam);
      b.line(bx + 13, y - 12, bx, y - 1, WOOD.seam);
      b.hline(bx, bx + 13, y - 12, WOOD.top);
    } else if (kind < 0.62) {
      // Lanterne de pierre (tōrō).
      const bx = x - 5;
      b.rect(bx - 1, y - 20, 12, 3, K.stoneHi);
      b.rect(bx, y - 17, 10, 3, K.stone);
      b.rect(bx + 2, y - 14, 6, 5, K.stoneDk);
      b.rect(bx + 3, y - 13, 4, 3, K.lantern.core);
      b.rect(bx + 3, y - 9, 4, 6, K.stone);
      b.rect(bx, y - 3, 10, 3, K.stone);
      props.push({ kind: 'toro', x: bx + 5, y: y - 12, phase: hash2(x, 2, 64) * 3, layer: 'back' });
    } else if (kind < 0.8) {
      // Rouleau de cordage.
      for (let rr = 5; rr > 1; rr -= 1.5) b.ellipse(x, y - 3, rr + 2, rr - 1, rr % 2 ? K.hemp : K.rig);
    } else {
      // Poissons qui sèchent entre deux piquets.
      const x0 = x - 12;
      const x1 = x + 12;
      b.rect(x0, y - 18, 1, 18, WOOD.post);
      b.rect(x1, y - 18, 1, 18, WOOD.post);
      for (let s = 0; s <= 1; s += 0.04) b.px(x0 + s * 24, y - 17 + 3 * 4 * s * (1 - s), K.rig);
      for (let k = 1; k < 5; k++) {
        const s = k / 5;
        const fx = Math.round(x0 + s * 24);
        const fy = Math.round(y - 17 + 12 * s * (1 - s));
        b.rect(fx, fy + 1, 2, 6, K.fish);
        b.px(fx, fy + 7, K.fishDk);
        b.px(fx + 1, fy + 1, K.fishDk);
      }
    }
  });
  // Garde-corps de bois le long des grands tronçons de ponton (en retrait, dans le décor).
  for (const run of shape.tops) {
    if (run.type !== T_SOLID || run.y !== shape.floorRow || run.x1 - run.x0 < 10) continue;
    const X0 = (run.x0 + 2) * T;
    const X1 = (run.x1 - 1) * T;
    const y = run.y * T;
    for (let x = X0; x <= X1; x += 12) {
      if (solidAt(shape, Math.floor(x / T), run.y - 1)) continue;
      b.rect(x, y - 13, 2, 13, WOOD.post);
      b.px(x, y - 13, WOOD.postHi);
    }
    b.hline(X0, X1 + 1, y - 13, WOOD.postHi);
    b.hline(X0, X1 + 1, y - 12, WOOD.post);
    b.hline(X0, X1 + 1, y - 7, WOOD.post);
  }
}

function paintGoal(shape: LevelShape, b: Buf, props: PropInstance[]): void {
  const g = goalArt(shape);
  if (!g) return;
  const cx = g.x + g.w / 2;
  // Voile doré : la zone d'arrivée entière se lit de loin, plus dense au pied du torii.
  lightVeil(b, g.x, g.y, g.w, g.h, K.veil, (x, y) => {
    const u = 1 - Math.abs(x - cx) / (g.w / 2);
    const v = (y - g.y) / g.h;
    return Math.max(0, 0.08 + 0.3 * u * (0.3 + 0.7 * v));
  });
  // Torii rouge debout sur le sol de l'arrivée.
  let floorY = g.y + g.h;
  for (let ty = Math.floor(floorY / T); ty < shape.h; ty++) {
    if (solidAt(shape, Math.floor(cx / T), ty)) {
      floorY = ty * T;
      break;
    }
  }
  const left = Math.round(g.x - 4);
  const right = Math.round(g.x + g.w - 1);
  const top = floorY - 84;
  for (const x of [left, right]) {
    b.rect(x, top + 10, 5, floorY - top - 10, K.red);
    b.rect(x + 3, top + 10, 2, floorY - top - 10, K.redDk);
    b.rect(x - 1, floorY - 4, 7, 4, K.cap);
  }
  b.rect(left - 10, top, right - left + 25, 4, K.cap);
  b.rect(left - 6, top + 4, right - left + 17, 4, K.red);
  b.hline(left - 6, right + 10, top + 4, K.redHi);
  b.rect(left - 2, top + 16, right - left + 9, 3, K.red);
  b.rect(Math.round(cx) - 3, top + 8, 6, 8, K.cap);
  b.rect(Math.round(cx) - 2, top + 9, 4, 6, K.gold);
  // Shimenawa et ses shide de papier.
  b.stroke(left + 3, top + 21, right + 2, top + 21, 2, K.hemp);
  for (let x = left + 7; x < right; x += 7) {
    b.px(x, top + 23, K.paper);
    b.px(x + 1, top + 24, K.paper);
    b.px(x, top + 25, K.paper);
    b.px(x + 1, top + 26, K.paper);
  }
  props.push({ kind: 'toro', x: left - 12, y: floorY - 14, phase: 0.3, layer: 'back' });
  props.push({ kind: 'toro', x: right + 16, y: floorY - 14, phase: 1.1, layer: 'back' });
  for (const x of [left - 17, right + 11]) {
    b.rect(x - 1, floorY - 20, 12, 3, K.stoneHi);
    b.rect(x, floorY - 17, 10, 3, K.stone);
    b.rect(x + 2, floorY - 14, 6, 5, K.stoneDk);
    b.rect(x + 3, floorY - 13, 4, 3, K.lantern.core);
    b.rect(x + 3, floorY - 9, 4, 6, K.stone);
    b.rect(x, floorY - 3, 10, 3, K.stone);
  }
}

export function paintPort(shape: LevelShape, out: LevelCanvases): PropInstance[] {
  const props: PropInstance[] = [];
  paintCave(shape, out.back);
  paintSupports(shape, out.back);
  paintStrings(shape, out.back, props);
  paintDeck(shape, out.back, props);
  paintGoal(shape, out.back, props);
  paintSolids(shape, out.tiles);
  paintSpikes(shape, out.hazards);
  return props;
}

// ------------------------------------------------------------------ accessoires animés

export function portProps(): Record<string, PropAnim> {
  const lanternFrames: Buf[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(30, 28);
    lantern(f, 15, 1, fsin((k / 16) * Math.PI * 2) * 2, K.lantern, true);
    lanternFrames.push(f);
  }
  const noboriFrames: Buf[] = [];
  for (let k = 0; k < 16; k++) {
    const f = new Buf(11, 52);
    banner(f, 1, 3, 26, ((k / 16) * Math.PI * 2) / 5, K.cloth, K.clothMark, WOOD.post);
    noboriFrames.push(f);
  }
  const toroFrames: Buf[] = [];
  for (let k = 0; k < 6; k++) {
    const f = new Buf(25, 25);
    f.glowA(12, 12, 12, K.lantern.glow, 0.3 + (k % 3) * 0.04);
    f.rect(11, 11, 3, 2, K.lantern.core);
    if (k % 2) f.px(12, 10, C_WHITE);
    toroFrames.push(f);
  }
  return {
    lantern: { frames: lanternFrames, fps: 16 / 3.7, ax: 15, ay: 1 },
    nobori: { frames: noboriFrames, fps: 12.7, ax: 1, ay: 49 },
    toro: { frames: toroFrames, fps: 7, ax: 12, ay: 12 },
  };
}

