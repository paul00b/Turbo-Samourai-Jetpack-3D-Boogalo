/* Moteur pixel minimal : framebuffer 32 bits, primitives entières, tramage Bayer, contour auto. */
(function (G) {
  'use strict';
  const W = 640;
  const H = 360;

  function C(hex) {
    const n = parseInt(hex.slice(1), 16);
    return ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0;
  }
  const cr = (c) => c & 255;
  const cg = (c) => (c >>> 8) & 255;
  const cb = (c) => (c >>> 16) & 255;
  function pack(r, g, b) {
    return ((255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
  }
  function lerpC(a, b, t) {
    return pack(cr(a) + (cr(b) - cr(a)) * t, cg(a) + (cg(b) - cg(a)) * t, cb(a) + (cb(b) - cb(a)) * t);
  }

  // Sinus tabulé : les boucles par pixel (mer, lave) en font des centaines de milliers par frame.
  const LUT_N = 4096, LUT = new Float32Array(LUT_N);
  for (let i = 0; i < LUT_N; i++) LUT[i] = Math.sin((i / LUT_N) * Math.PI * 2);
  const K_LUT = LUT_N / (Math.PI * 2);
  const fsin = (x) => LUT[((x * K_LUT) | 0) & (LUT_N - 1)];

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
  const dith = (x, y, c1, c2, t) => (t > bayer(x, y) ? c2 : c1);

  class Buf {
    constructor(w, h, data) {
      this.w = w;
      this.h = h;
      this.d = data || new Uint32Array(w * h);
    }
    clear(c = 0) { this.d.fill(c); }
    px(x, y, c) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      this.d[y * this.w + x] = c;
    }
    get(x, y) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
      return this.d[y * this.w + x];
    }
    mix(x, y, c, a) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
      const i = y * this.w + x;
      this.d[i] = a >= 1 ? c : lerpC(this.d[i], c, a);
    }
    hline(x0, x1, y, c) {
      y = Math.round(y);
      if (y < 0 || y >= this.h) return;
      x0 = Math.max(0, Math.round(x0)); x1 = Math.min(this.w - 1, Math.round(x1));
      const o = y * this.w;
      for (let x = x0; x <= x1; x++) this.d[o + x] = c;
    }
    rect(x, y, w, h, c) {
      x = Math.round(x); y = Math.round(y);
      for (let j = 0; j < h; j++) this.hline(x, x + w - 1, y + j, c);
    }
    disc(cx, cy, r, c) {
      cx = Math.round(cx); cy = Math.round(cy);
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        const q = r * r - dy * dy + r * 0.6;
        if (q < 0) continue;
        const dx = Math.floor(Math.sqrt(q));
        this.hline(cx - dx, cx + dx, cy + dy, c);
      }
    }
    ellipse(cx, cy, rx, ry, c) {
      cx = Math.round(cx); cy = Math.round(cy);
      for (let dy = -ry; dy <= ry; dy++) {
        const k = 1 - (dy * dy) / (ry * ry + 0.5);
        if (k < 0) continue;
        const dx = Math.round(rx * Math.sqrt(k));
        this.hline(cx - dx, cx + dx, cy + dy, c);
      }
    }
    line(x0, y0, x1, y1, c) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let n = 0; n < 4000; n++) {
        this.px(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    /** Trait épais : carrés de w px le long du segment (membres du perso, cordes épaisses). */
    stroke(x0, y0, x1, y1, w, c) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len * 2));
      const o = (w - 1) / 2;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        this.rect(Math.round(x0 + (x1 - x0) * t - o), Math.round(y0 + (y1 - y0) * t - o), w, w, c);
      }
    }
    poly(p, c) {
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 1; i < p.length; i += 2) { y0 = Math.min(y0, p[i]); y1 = Math.max(y1, p[i]); }
      const n = p.length / 2;
      const xs = [];
      for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
        const sy = y + 0.5;
        xs.length = 0;
        for (let i = 0; i < n; i++) {
          const ax = p[i * 2], ay = p[i * 2 + 1];
          const bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1];
          if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) this.hline(Math.round(xs[k]), Math.round(xs[k + 1]) - 1, y, c);
      }
    }
    vgrad(y0, y1, stops, x0 = 0, x1 = this.w) {
      const n = stops.length - 1;
      for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) {
        const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * n;
        const i = Math.min(n - 1, Math.floor(t));
        const f = t - i;
        const o = y * this.w;
        for (let x = x0; x < x1; x++) this.d[o + x] = dith(x, y, stops[i], stops[i + 1], f);
      }
    }
    glow(cx, cy, r, c, s) {
      cx = Math.round(cx); cy = Math.round(cy);
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= this.h) continue;
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || x >= this.w) continue;
          const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (d2 >= r * r) continue;
          const k = 1 - Math.sqrt(d2) / r;
          const a = s * k * k;
          const q = Math.floor((a + bayer(x, y) * 0.14) / 0.14) * 0.14;
          if (q > 0) this.mix(x, y, c, Math.min(0.85, q));
        }
      }
    }
    blit(src, ox, oy) {
      ox = Math.round(ox); oy = Math.round(oy);
      for (let y = Math.max(0, oy); y < Math.min(this.h, oy + src.h); y++) {
        const so = (y - oy) * src.w - ox, o = y * this.w;
        for (let x = Math.max(0, ox); x < Math.min(this.w, ox + src.w); x++) {
          const v = src.d[so + x];
          if (v) this.d[o + x] = v;
        }
      }
    }
    blitWrap(src, ox, oy) {
      ox = Math.round(ox); oy = Math.round(oy);
      const sw = src.w;
      for (let y = Math.max(0, oy); y < Math.min(this.h, oy + src.h); y++) {
        const so = (y - oy) * sw, o = y * this.w;
        let sx = (((-ox) % sw) + sw) % sw;
        for (let x = 0; x < this.w; x++) {
          const v = src.d[so + sx];
          if (v) this.d[o + x] = v;
          if (++sx === sw) sx = 0;
        }
      }
    }
    /** Blit d'un sprite dessiné à la volée : double contour calculé depuis le masque (1 px plein + 1 px à 45 %). */
    outlineBlit(src, ox, oy, olc) {
      ox = Math.round(ox); oy = Math.round(oy);
      const w = src.w, h = src.h, d = src.d;
      const f = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[y * w + x] !== 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (d[y * w + x]) continue;
        if (f(x + 1, y) || f(x - 1, y) || f(x, y + 1) || f(x, y - 1)) this.px(ox + x, oy + y, olc);
        else if (f(x + 2, y) || f(x - 2, y) || f(x, y + 2) || f(x, y - 2) || f(x + 1, y + 1) || f(x - 1, y - 1) || f(x + 1, y - 1) || f(x - 1, y + 1)) this.mix(ox + x, oy + y, olc, 0.45);
      }
      this.blit(src, ox, oy);
    }
    gray(levels) {
      const d = this.d;
      for (let i = 0; i < d.length; i++) {
        const c = d[i];
        const l = 0.2126 * cr(c) + 0.7152 * cg(c) + 0.0722 * cb(c);
        const q = Math.round((l / 255) * (levels - 1)) * (255 / (levels - 1));
        d[i] = pack(q, q, q);
      }
    }
  }

  function compile(rows, pal) {
    const h = rows.length, w = rows[0].length, px = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch !== '.' && pal[ch] !== undefined) px.push(x, y, pal[ch]);
    }
    return { w, h, px };
  }
  function stamp(buf, s, x, y, flip) {
    x = Math.round(x); y = Math.round(y);
    for (let i = 0; i < s.px.length; i += 3) buf.px(flip ? x + s.w - 1 - s.px[i] : x + s.px[i], y + s.px[i + 1], s.px[i + 2]);
  }

  function hash2(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s, period) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const wx = (i) => (period ? ((i % period) + period) % period : i);
    const a = hash2(wx(xi), yi, s), b = hash2(wx(xi + 1), yi, s);
    const c = hash2(wx(xi), yi + 1, s), d = hash2(wx(xi + 1), yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, period, oct = 4) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * vnoise(x * f, y * f, s + o * 17, period ? period * f : 0);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }

  class Particles {
    constructor() { this.list = []; }
    spawn(x, y, vx, vy, life, colors, grav = 0, drag = 0, size = 1) {
      if (this.list.length > 900) return;
      this.list.push({ x, y, vx, vy, life, max: life, colors, grav, drag, size });
    }
    burst(x, y, n, speed, colors, life = 0.5, grav = 200) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
        this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + Math.random() * 0.5), colors, grav, 2);
      }
    }
    update(dt) {
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i];
        p.life -= dt;
        if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
        p.vy += p.grav * dt;
        p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    }
    draw(buf, camX) {
      for (const p of this.list) {
        const k = 1 - p.life / p.max;
        const c = p.colors[Math.min(p.colors.length - 1, Math.floor(k * p.colors.length))];
        if (p.size > 1) buf.rect(p.x - camX, p.y, p.size, p.size, c); else buf.px(p.x - camX, p.y, c);
      }
    }
  }

  G.PX = { W, H, C, lerpC, pack, bayer, dith, fsin, Buf, compile, stamp, hash2, vnoise, fbm, Particles };
})(window);
