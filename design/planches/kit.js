/* Accessoires communs aux niveaux : bois, pierre, surfaces lisses, pieux, bannières, lanternes, pluie, caméra. */
(function (G) {
  'use strict';
  const { W, H, C, Buf, fbm, hash2, dith, fsin } = G.PX;

  const WOOD = {
    body: C('#4a2f1c'), top: C('#c48a54'), mid: C('#8a5a34'), seam: C('#2e1c11'), dark: C('#24160d'),
    post: C('#3a2517'), postHi: C('#5a3a22'), knot: C('#6b4428'),
  };

  function planks(b, x, y, w, h, P = WOOD) {
    b.rect(x, y, w, h, P.body);
    b.hline(x, x + w - 1, y, P.top);
    b.hline(x, x + w - 1, y + 1, P.mid);
    b.hline(x, x + w - 1, y + h - 1, P.dark);
    for (let s = x + 5; s < x + w; s += 11) {
      b.rect(s, y + 2, 1, h - 3, P.seam);
      if (hash2(s, y, 3) > 0.6) b.px(s + 4, y + 3 + ((s * 7) % Math.max(1, h - 4)), P.knot);
    }
  }
  function post(b, x, y0, y1, w = 4, P = WOOD) {
    b.rect(x, y0, w, y1 - y0, P.post);
    b.rect(x, y0, 1, y1 - y0, P.postHi);
    for (let y = y0 + 6; y < y1; y += 14) b.hline(x, x + w - 1, y, P.seam);
  }
  function beam(b, x0, x1, y, h = 4, P = WOOD) {
    b.rect(x0, y, x1 - x0, h, P.post);
    b.hline(x0, x1 - 1, y, P.top);
    b.hline(x0, x1 - 1, y + h - 1, P.dark);
  }
  /** Surface lisse (=) : reflets obliques froids, arête haute claire. Même grammaire dans tous les niveaux. */
  function slick(b, x, y, w, h, base, gloss, top) {
    b.rect(x, y, w, h, base);
    b.hline(x, x + w - 1, y, top);
    for (let j = 1; j < h; j++) for (let i = 0; i < w; i++) {
      if ((i + j) % 7 === 0 && hash2(x + i, y + j, 3) > 0.3) b.px(x + i, y + j, gloss);
    }
  }
  /** Pieux mortels (^) : pointe rouge. */
  function stakes(b, x0, x1, yb, body, hi, tip = C('#d94848'), hgt = 12) {
    for (let x = x0; x <= x1; x += 6) {
      const hh = hgt + Math.floor(hash2(x, yb, 2) * 4);
      b.poly([x, yb, x + 3, yb - hh, x + 6, yb], body);
      b.line(x + 2, yb - 1, x + 3, yb - hh + 1, hi);
      b.px(x + 3, yb - hh, tip); b.px(x + 3, yb - hh + 1, tip); b.px(x + 2, yb - hh + 2, tip);
    }
  }
  /** Masse rocheuse texturée : arête haute claire, mousse, grain au bruit. */
  function rockMass(b, pts, P) {
    b.poly(pts, P.rock);
    for (let y = 1; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const i = y * b.w + x;
      if (b.d[i] !== P.rock) continue;
      if (b.d[i - b.w] === 0) b.d[i] = P.top;
      else if (y > 2 && b.d[i - 2 * b.w] === 0 && P.moss) b.d[i] = dith(x, y, P.rock, P.moss, 0.8);
      else {
        const n = fbm(x / 11, y / 7, 7);
        const cr = hash2(x, y, 9);
        b.d[i] = n > 0.62 ? P.lt : n < 0.38 ? P.dk : cr > 0.985 ? P.lt : P.rock;
      }
    }
  }
  /** Bannière nobori : mât + tissu qui ondule sous le vent (colonne par colonne). */
  function banner(buf, x, y, h, t, cloth, mark, pole) {
    buf.rect(x, y - 2, 1, h + 22, pole);
    buf.hline(x, x + 6, y - 1, pole);
    for (let j = 0; j < h; j++) {
      const off = Math.round(fsin(t * 5 + j * 0.35 + x) * (j / h) * 1.6);
      for (let i = 1; i <= 6; i++) buf.px(x + i + off, y + j, (j > 3 && j < h - 3 && i > 2 && i < 5 && j % 5 < 3) ? mark : cloth);
    }
  }
  /** Guirlande de lanternes en chaînette, chaque lanterne se balance. */
  function lanternString(buf, ax, ay, bx, by, sag, n, t, P) {
    const pt = (s) => [ax + (bx - ax) * s, ay + (by - ay) * s + sag * 4 * s * (1 - s)];
    let [px, py] = pt(0);
    for (let i = 1; i <= 40; i++) { const [x, y] = pt(i / 40); buf.line(px, py, x, y, P.rope); px = x; py = y; }
    for (let i = 1; i <= n; i++) {
      const [x, y] = pt(i / (n + 1));
      const lx = x + fsin(t * 1.7 + i * 1.3) * 2, ly = y + 3;
      buf.glow(lx, ly + 3, 12, P.glow, 0.42);
      buf.line(x, y, lx, ly, P.rope);
      buf.rect(lx - 2, ly, 4, 1, P.cap);
      buf.rect(lx - 2, ly + 1, 4, 5, P.body);
      buf.rect(lx - 1, ly + 2, 2, 3, P.core);
      buf.px(lx - 2, ly + 3, P.rib);
      buf.px(lx + 1, ly + 3, P.rib);
      buf.rect(lx - 2, ly + 6, 4, 1, P.cap);
      buf.px(lx, ly + 7, P.cap);
    }
  }
  /** Pluie sans état (pas de tableau à tenir) ; `avoid` écarte les gouttes autour du perso. */
  function rain(buf, t, n, len, speed, color, seed, avoid, slant = 0.35) {
    for (let i = 0; i < n; i++) {
      const x0 = hash2(i, 1, seed) * (W + 80), y0 = hash2(i, 2, seed) * (H + 60), v = speed * (0.8 + hash2(i, 3, seed) * 0.4);
      const y = ((y0 + t * v) % (H + 60)) - 30;
      const x = ((((x0 - t * v * slant) % (W + 80)) + W + 80) % (W + 80)) - 40;
      if (avoid && (x - avoid.x) ** 2 + (y - avoid.y) ** 2 < 24 * 24) continue;
      for (let k = 0; k < len; k++) buf.px(x - k * slant, y - k, color);
    }
  }
  function clouds(seed, w, h, thr, tones, lit) {
    const b = new Buf(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fall = Math.abs(y - h / 2) / (h / 2);
      const n = fbm(x / 64, y / 22, seed, w / 64) - fall * 0.38;
      if (n > thr + 0.13) b.d[y * w + x] = tones[2];
      else if (n > thr + 0.06) b.d[y * w + x] = tones[1];
      else if (n > thr) b.d[y * w + x] = dith(x, y, 0, tones[0], 0.75);
    }
    if (lit) for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (b.d[i] && !b.d[i - w] && hash2(x, y, 4) > 0.2) b.d[i] = lit;
    }
    return b;
  }
  /** Caméra qui suit le perso avec un peu d'avance, bornée au monde. */
  class Cam {
    constructor(worldW) { this.x = 0; this.worldW = worldW; this.init = false; }
    update(actor, dt) {
      const target = Math.max(0, Math.min(this.worldW - W, actor.x - W / 2 + actor.vx * 0.35));
      if (!this.init) { this.x = target; this.init = true; }
      this.x += (target - this.x) * Math.min(1, dt * 2.2);
      return Math.round(this.x);
    }
  }

  G.KIT = { WOOD, planks, post, beam, slick, stakes, rockMass, banner, lanternString, rain, clouds, Cam };
})(window);
