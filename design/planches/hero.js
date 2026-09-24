/* Le samouraï : pantin pixel articulé + mini physique (corde PBD, gravité, jetpack) pilotée par un contrôleur.
   Teinte réservée : cyan #4fd1ff (écharpe, sangles des tongs, corde pendant le reel). */
(function (G) {
  'use strict';
  const { C, lerpC, Buf, compile, stamp, Particles } = G.PX;

  const P = {
    helm: C('#3a4258'), helmHi: C('#8190b2'), gold: C('#f0bf55'), skin: C('#e8ac80'), eye: C('#0b0b12'),
    armor: C('#30447a'), armorHi: C('#7098e0'), armorDk: C('#222f55'), lace: C('#c2452f'),
    sleeve: C('#2a3a66'), sleeveDk: C('#1f2a4a'), glove: C('#1c2238'),
    pack: C('#7c8391'), packHi: C('#c9ced8'), nozzle: C('#34373f'), hot: C('#ff5a2a'), strapB: C('#4a3320'),
    obi: C('#8a6136'), hak: C('#2d3b60'), hakHi: C('#52699c'), hakDk: C('#1f2944'),
    sole: C('#dcc59a'), soleDk: C('#a88f63'), strap: C('#4fd1ff'),
    saya: C('#6a1f1f'), tsA: C('#e8e0cf'), tsB: C('#1a1a22'),
    scarf: C('#4fd1ff'), scarfHi: C('#b4f0ff'), scarfDk: C('#2595c8'),
    hemp: C('#d9cfb4'), metal: C('#9aa3b2'), white: C('#ffffff'),
  };
  const OUTLINE = C('#06060b');
  const FLAME = [C('#fff7d6'), C('#ffd166'), C('#ff9a3c'), C('#e0502a')];
  const SMOKE = [C('#8a8f9c'), C('#5f6472'), C('#3d414c')];
  const SPARK = [C('#ffffff'), C('#ffe9a8'), C('#ffb347')];
  const EMBER = [C('#ffd166'), C('#ff9a3c'), C('#8a3a24')];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // --------------------------------------------------------------- chauffe (valeurs de src/sim/params.ts)
  class Heat {
    constructor() { this.heat = 0; this.overheated = false; }
    update(dt, want) {
      if (this.overheated && this.heat <= 0.35) this.overheated = false;
      let thrust = false;
      if (want && !this.overheated) {
        thrust = true;
        this.heat += 0.45 * dt;
        if (this.heat >= 1) { this.heat = 1; this.overheated = true; thrust = false; }
      }
      if (!thrust) this.heat = Math.max(0, this.heat - 0.55 * dt);
      return thrust;
    }
  }

  // --------------------------------------------------------------- acteur
  const GRAV = 700, JET = 1150, REEL = 120, DRAG = 0.05, VMAX = 540, HOOK_V = 1700, FIRE_R = 180;
  const OX = 40, OY = 44;

  class Actor {
    /** o : { anchors: [{x, y, L}], order: [...], bottom, worldW, rim, halo, wind } */
    constructor(o) {
      this.o = o;
      this.parts = new Particles();
      this.heat = new Heat();
      this.off = new Buf(80, 80);
      this.deaths = 0; this.t = 0; this.face = 1; this.beta = 0;
      this.lag = 0; this.lagV = 0; this.flash = 0; this.jet = false; this.tx = 0; this.ty = -1;
      this.J = null;
      this.respawn(true);
    }
    get cur() { return this.o.anchors[this.o.order[this.k]]; }
    get tgt() { return this.o.anchors[this.o.order[(this.k + 1) % this.o.order.length]]; }
    respawn(first) {
      this.k = 0;
      const a = this.cur;
      this.x = a.x - Math.sin(0.55) * a.L; this.y = a.y + Math.cos(0.55) * a.L;
      this.vx = 0; this.vy = 0;
      this.state = 'att'; this.timer = 0; this.throwT = 0;
      this.hook = { state: 'att', x: a.x, y: a.y, L: a.L };
      this.scarf = [];
      for (let i = 0; i < 11; i++) this.scarf.push({ x: this.x - 1, y: this.y - 8 + i * 1.8, px: this.x - 1, py: this.y - 8 + i * 1.8 });
      if (!first) {
        this.deaths++;
        this.flash = 0.3;
        this.parts.burst(this.x, this.y, 18, 120, [P.scarfHi, P.scarf, P.scarfDk], 0.5, 0);
      }
    }
    update(dt) {
      if (dt <= 0) return;
      this.t += dt;
      this.flash = Math.max(0, this.flash - dt);
      this.throwT = Math.max(0, this.throwT - dt);
      const o = this.o, tg = this.tgt, ca = this.cur;
      const sp = Math.hypot(this.vx, this.vy) || 1;
      let want = false, tx = this.tx, ty = this.ty;
      this.timer += dt;
      if (this.state === 'att') {
        const rx = this.x - ca.x, dir = Math.sign(tg.x - ca.x) || 1;
        if (this.vx * dir > 30 && Math.abs(rx) < this.hook.L * 0.55 && sp < 340 * Math.min(1, ca.L / 85)) { want = true; tx = this.vx / sp; ty = this.vy / sp; }
        if ((this.vx * dir > 40 && rx * dir > this.hook.L * 0.4 && this.vy < -30) || this.timer > 6) {
          this.state = 'free'; this.hook.state = 'idle'; this.timer = 0;
        }
      } else {
        const dx = tg.x - this.x, dy = tg.y - this.y, d = Math.hypot(dx, dy);
        if (this.hook.state === 'idle' && d < FIRE_R && this.timer > 0.12 && this.J) {
          this.hook.state = 'fly';
          this.hook.x = this.x + this.J.hand[0] - OX; this.hook.y = this.y + this.J.hand[1] - OY;
          this.throwT = 0.25;
        }
        if (this.y > tg.y + 25 || d > FIRE_R || (o.jetFree && this.heat.heat < 0.7 && this.y > tg.y - 4)) {
          want = true;
          const ux = dx, uy = dy - (o.lift === undefined ? 70 : o.lift), l = Math.hypot(ux, uy) || 1;
          tx = ux / l; ty = uy / l;
        }
        if (this.y > o.bottom || this.x < -40 || this.x > o.worldW + 40 || this.timer > 4.5) { this.respawn(false); return; }
      }
      this.jet = this.heat.update(dt, want);
      this.tx = tx; this.ty = ty;

      const n = 4, h = dt / n;
      for (let s = 0; s < n; s++) {
        this.vy += GRAV * h;
        if (this.jet) { this.vx += tx * JET * h; this.vy += ty * JET * h; }
        const dr = 1 - DRAG * h;
        this.vx *= dr; this.vy *= dr;
        const v = Math.hypot(this.vx, this.vy);
        if (v > VMAX) { this.vx *= VMAX / v; this.vy *= VMAX / v; }
        const x0 = this.x, y0 = this.y;
        this.x += this.vx * h; this.y += this.vy * h;
        if (this.hook.state === 'fly') {
          const hx = tg.x - this.hook.x, hy = tg.y - this.hook.y, hd = Math.hypot(hx, hy);
          if (hd <= HOOK_V * h) {
            this.hook.state = 'att'; this.hook.x = tg.x; this.hook.y = tg.y;
            this.hook.L = Math.hypot(this.x - tg.x, this.y - tg.y);
            this.state = 'att'; this.timer = 0;
            this.k = (this.k + 1) % o.order.length;
            this.parts.burst(tg.x, tg.y, 9, 140, SPARK, 0.35, 300);
          } else { this.hook.x += (hx / hd) * HOOK_V * h; this.hook.y += (hy / hd) * HOOK_V * h; }
        }
        if (this.state === 'att') {
          const a = this.cur;
          if (this.hook.L > a.L) this.hook.L = Math.max(a.L, this.hook.L - REEL * h);
          const ddx = this.x - a.x, ddy = this.y - a.y, d = Math.hypot(ddx, ddy);
          if (d > this.hook.L) { this.x = a.x + (ddx * this.hook.L) / d; this.y = a.y + (ddy * this.hook.L) / d; }
          this.vx = (this.x - x0) / h; this.vy = (this.y - y0) / h;
        }
      }

      // Animation secondaire : orientation, retard des jambes, écharpe.
      const v = Math.hypot(this.vx, this.vy);
      if (Math.abs(this.vx) > 25) this.face = this.vx > 0 ? 1 : -1;
      let bt, lagT;
      if (this.state === 'att') {
        const a = this.cur;
        bt = Math.atan2(a.x - this.x, -(a.y - this.y));
        const rx = this.x - a.x, ry = this.y - a.y;
        const om = (rx * this.vy - ry * this.vx) / Math.max(1, rx * rx + ry * ry);
        lagT = clamp(-om * 0.35, -0.9, 0.9);
      } else {
        bt = clamp(this.vx / 800, -0.45, 0.45) + (this.jet ? this.tx * 0.3 : 0);
        lagT = clamp(-this.vx / 700, -0.7, 0.7);
      }
      this.beta += (bt - this.beta) * Math.min(1, dt * (this.state === 'att' ? 18 : 8));
      this.lagV += ((lagT - this.lag) * 70 - this.lagV * 9) * dt;
      this.lag += this.lagV * dt;
      this.tuck = this.state === 'att' ? 0.15 + 0.75 * (1 - clamp(v / 300, 0, 1)) : this.jet ? 0.55 : 0.35;
      this.speed = v;

      const wind = o.wind || 0, sc = this.scarf;
      sc[0].x = this.x + 7.5 * Math.sin(this.beta) - this.face * 0.8 * Math.cos(this.beta); sc[0].y = this.y - 7.5 * Math.cos(this.beta);
      for (let i = 1; i < sc.length; i++) {
        const p = sc[i], vx = (p.x - p.px) * 0.92, vy = (p.y - p.py) * 0.92;
        p.px = p.x; p.py = p.y;
        p.x += vx + (wind + Math.sin(this.t * 7 + i) * 18) * dt * dt * 4; p.y += vy + 180 * dt * dt;
      }
      for (let it = 0; it < 4; it++) for (let i = 1; i < sc.length; i++) {
        const a = sc[i - 1], b = sc[i], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, k = (d - 1.9) / d;
        if (i === 1) { b.x -= dx * k; b.y -= dy * k; } else { a.x += dx * k * 0.5; a.y += dy * k * 0.5; b.x -= dx * k * 0.5; b.y -= dy * k * 0.5; }
      }

      if (this.jet && this.J) {
        for (const nz of this.J.nozzles) {
          const wx = this.x + nz[0] - OX, wy = this.y + nz[1] - OY;
          this.parts.spawn(wx, wy, -this.tx * 90 + (Math.random() - 0.5) * 40, -this.ty * 90 + (Math.random() - 0.5) * 40, 0.4, EMBER, 80, 1);
          if (Math.random() < 0.4) this.parts.spawn(wx, wy, -this.tx * 40, -this.ty * 40 - 10, 0.8, SMOKE, -30, 1.5, 2);
        }
      }
      if (this.heat.overheated && Math.random() < 0.3 && this.J) {
        const nz = this.J.nozzles[0];
        this.parts.spawn(this.x + nz[0] - OX, this.y + nz[1] - OY, (Math.random() - 0.5) * 20, -30, 0.9, SMOKE, -20, 1, 2);
      }
      this.parts.update(dt);
    }

    phase() {
      if (this.state === 'att') return this.hook.L > this.cur.L + 0.5 ? 'REEL' : 'SWING';
      if (this.hook.state === 'fly' || this.throwT > 0) return 'LANCER';
      return this.jet ? 'JET' : 'VOL';
    }
    hud() { return { speed: this.speed * 2, heat: this.heat.heat, over: this.heat.overheated, deaths: this.deaths, phase: this.phase() }; }

    // ------------------------------------------------------------- pantin
    pose() {
      const f = this.face, b = this.beta, cb = Math.cos(b), sb = Math.sin(b), t = this.t;
      const T = (lx, ly) => { const x = lx * f; return [OX + x * cb - ly * sb, OY + x * sb + ly * cb]; };
      const rot = (ang) => [Math.sin(b + ang * f), Math.cos(b + ang * f)];
      const leg = (hip, phi, kappa) => {
        const d1 = rot(phi), k = [hip[0] + d1[0] * 4.6, hip[1] + d1[1] * 4.6];
        const d2 = rot(phi - kappa), a = [k[0] + d2[0] * 4.6, k[1] + d2[1] * 4.6];
        const fd = rot(phi - kappa + Math.PI / 2);
        return { hip, k, a, fd };
      };
      const tuck = this.tuck, lag = this.lag * f;
      const pedal = this.state === 'free' && !this.jet ? Math.sin(t * 14) * 0.45 : 0;
      const J = { T, f };
      J.legF = leg(T(1, 1.5), 0.25 + lag + tuck * 0.9 + pedal, tuck * 1.5);
      J.legB = leg(T(-1, 1.5), -0.2 + lag * 0.7 + tuck * 0.35 - pedal, 0.3 + tuck * 1.1);
      J.flap = 0.2 + Math.sin(t * 11) * clamp(this.speed / 350, 0, 1) * 0.6;
      J.shF = T(1.6, -6.4); J.shB = T(-1.6, -6.4);
      // Main avant : sur la corde, lancée vers la cible, ou tendue en avant.
      let aim;
      if (this.state === 'att') aim = [this.hook.x - this.x + OX, this.hook.y - this.y + OY];
      else if (this.hook.state === 'fly' || this.throwT > 0) aim = [this.tgt.x - this.x + OX, this.tgt.y - this.y + OY];
      else aim = T(4.5, -11);
      const dx = aim[0] - J.shF[0], dy = aim[1] - J.shF[1], d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(d, 7.4), ux = dx / d, uy = dy / d;
      const hand = [J.shF[0] + ux * reach, J.shF[1] + uy * reach];
      const bend = Math.sqrt(Math.max(0, 3.7 * 3.7 - (reach / 2) * (reach / 2)));
      J.elbF = [(J.shF[0] + hand[0]) / 2 - uy * bend * f, (J.shF[1] + hand[1]) / 2 + ux * bend * f];
      J.hand = hand;
      const hang = this.state === 'att' ? -this.lag * 0.8 - f * 0.35 : -f * 0.9 + Math.sin(t * 9) * 0.25;
      const bd = [Math.sin(hang), Math.cos(hang)];
      J.elbB = [J.shB[0] + bd[0] * 3.6, J.shB[1] + bd[1] * 3.6];
      J.handB = [J.elbB[0] + Math.sin(hang - f * 0.5) * 3.4, J.elbB[1] + Math.cos(hang - f * 0.5) * 3.4];
      J.nozzles = [T(-6, 1.2), T(-4, 1.2)];
      this.J = J;
      return J;
    }

    drawBody(o, J, rim, dx, dy) {
      const c = (col) => (rim === null ? col : rim);
      const T = (lx, ly) => { const p = J.T(lx, ly); return [p[0] + dx, p[1] + dy]; };
      const S = (p) => [p[0] + dx, p[1] + dy];
      const poly = (pts, col) => o.poly(pts.flatMap(([x, y]) => T(x, y)), c(col));
      const drawLeg = (L, thigh, shin) => {
        const h = S(L.hip), k = S(L.k), a = S(L.a);
        o.stroke(h[0], h[1], k[0], k[1], 3, c(thigh));
        o.stroke(k[0], k[1], a[0], a[1], 2, c(shin));
        const toe = [a[0] + L.fd[0] * 2.2, a[1] + L.fd[1] * 2.2];
        o.stroke(a[0], a[1], toe[0], toe[1], 1, c(P.skin));
        const fl = -J.flap * J.f, cs = Math.cos(fl), sn = Math.sin(fl);
        const sx = L.fd[0] * cs - L.fd[1] * sn, sy = L.fd[0] * sn + L.fd[1] * cs;
        o.stroke(toe[0] + 0.5, toe[1] + 1, toe[0] - sx * 4 + 0.5, toe[1] - sy * 4 + 1, 1, c(P.sole));
        o.px(a[0] + L.fd[0], a[1] + L.fd[1], c(P.strap));
      };
      const scarf = this.scarf;
      for (let i = 1; i < scarf.length; i++) {
        const p0 = [scarf[i - 1].x - this.x + OX + dx, scarf[i - 1].y - this.y + OY + dy];
        const p1 = [scarf[i].x - this.x + OX + dx, scarf[i].y - this.y + OY + dy];
        o.stroke(p0[0], p0[1], p1[0], p1[1], i < 7 ? 2 : 1, c(i < 7 ? P.scarf : P.scarfDk));
        if (i < 5 && rim === null) o.px(p0[0], p0[1] - 1, P.scarfHi);
      }
      const eB = S(J.elbB), hB = S(J.handB), sB = S(J.shB);
      o.stroke(sB[0], sB[1], eB[0], eB[1], 2, c(P.sleeveDk));
      o.stroke(eB[0], eB[1], hB[0], hB[1], 2, c(P.glove));
      drawLeg(J.legB, P.hakDk, P.hakDk);
      const ts = [T(-5.8, -13.2), T(-4.2, -10)];
      for (let i = 0; i <= 4; i++) o.px(ts[0][0] + (ts[1][0] - ts[0][0]) * i / 4, ts[0][1] + (ts[1][1] - ts[0][1]) * i / 4, c(i & 1 ? P.tsB : P.tsA));
      const sa = [T(-3.8, -9.4), T(2.8, 3.2)];
      o.stroke(sa[0][0], sa[0][1], sa[1][0], sa[1][1], 1, c(P.saya));
      const tb = T(-4, -9.7); o.px(tb[0], tb[1], c(P.gold));
      const heat = this.heat.heat;
      const blink = this.heat.overheated && Math.sin(this.t * 20) > 0;
      const packC = blink ? P.hot : lerpC(P.pack, P.hot, heat * heat * 0.7);
      poly([[-7.2, -7.6], [-3, -7.6], [-3, 0.2], [-7, 0.2]], packC);
      if (rim === null) {
        const hi = [T(-6.6, -7), T(-6.6, -1)];
        o.stroke(hi[0][0], hi[0][1], hi[1][0], hi[1][1], 1, P.packHi);
        for (const nz of J.nozzles) o.rect(nz[0] + dx - 0.5, nz[1] + dy - 0.5, 2, 2, P.nozzle);
      }
      poly([[-3, -7.6], [3, -7.6], [2.6, 0.2], [-2.6, 0.2]], P.armor);
      poly([[-4.2, -8], [-1.4, -8], [-1.4, -4], [-4.6, -4.6]], P.armorDk);
      if (rim === null) {
        for (const ly of [-5.6, -3.6, -1.6]) for (let lx = -2; lx <= 2; lx++) if (((lx + 3) & 1) === 0) { const p = T(lx, ly); o.px(p[0], p[1], P.lace); }
        const e = [T(2, -6.8), T(2.2, -1)]; o.stroke(e[0][0], e[0][1], e[1][0], e[1][1], 1, P.armorHi);
      }
      const ob = [T(-2.8, 0.6), T(2.8, 0.6)]; o.stroke(ob[0][0], ob[0][1], ob[1][0], ob[1][1], 2, c(P.obi));
      poly([[-3.2, 1.6], [3.2, 1.6], [4, 4.6], [-4, 4.6]], P.armor);
      if (rim === null) for (const lx of [-1.2, 1.2]) { const a = T(lx, 1.9), bb = T(lx * 1.2, 4.3); o.stroke(a[0], a[1], bb[0], bb[1], 1, P.armorDk); }
      poly([[-4.8, -10.2], [-1, -10.2], [-1.6, -7.4], [-5.6, -8]], P.helm);
      poly([[0.4, -10.2], [3.3, -10.2], [3.1, -7.6], [0.4, -7.6]], P.skin);
      poly([[-3.6, -10], [-3.1, -13.2], [-1.1, -14.6], [1.6, -14.6], [3.3, -13.1], [3.6, -10.4]], P.helm);
      const br = [T(-4.6, -10.2), T(4.1, -10.2)]; o.stroke(br[0][0], br[0][1], br[1][0], br[1][1], 1, c(P.helmHi));
      const cr = [T(0.8, -14.3), T(3.6, -17.8), T(-1.9, -17.4)];
      o.stroke(cr[0][0], cr[0][1], cr[1][0], cr[1][1], 1, c(P.gold));
      o.stroke(cr[0][0], cr[0][1], cr[2][0], cr[2][1], 1, c(P.gold));
      if (rim === null) {
        const blinkEye = this.t % 3.3 < 0.11;
        const ey = T(2.3, -9.2); o.px(ey[0], ey[1], blinkEye ? P.skin : P.eye);
        const m = [T(1.2, -8.2), T(3, -8.2)]; o.stroke(m[0][0], m[0][1], m[1][0], m[1][1], 1, P.lace);
        const kn = T(0.6, -7.2); o.px(kn[0], kn[1], P.scarf); o.px(kn[0] + 1, kn[1], P.scarfHi);
      }
      drawLeg(J.legF, P.hak, P.hak);
      const sF = S(J.shF), eF = S(J.elbF), hF = S(J.hand);
      o.stroke(sF[0], sF[1], eF[0], eF[1], 2, c(P.sleeve));
      o.stroke(eF[0], eF[1], hF[0], hF[1], 2, c(P.glove));
      poly([[0.2, -8.2], [3.8, -8.2], [4, -5], [0.6, -5]], P.armor);
      if (rim === null) { const s1 = T(1, -7), s2 = T(3, -7); o.px(s1[0], s1[1], P.lace); o.px(s2[0], s2[1], P.lace); }
    }

    draw(buf, cam) {
      const J = this.pose();
      const sx = Math.round(this.x - cam), sy = Math.round(this.y);
      const ox = sx - OX, oy = sy - OY;
      if (this.o.halo) buf.glow(sx, sy - 4, 26, this.o.halo, 0.3);
      if (this.hook.state !== 'idle') {
        const hx = J.hand[0] + ox, hy = J.hand[1] + oy, ax = this.hook.x - cam, ay = this.hook.y;
        const dist = Math.hypot(ax - hx, ay - hy);
        const reeling = this.state === 'att' && this.hook.L > this.cur.L + 0.5;
        const col = reeling ? P.scarf : P.hemp;
        const slack = this.state === 'att' ? Math.max(0, this.hook.L - Math.hypot(this.x - this.hook.x, this.y - this.hook.y)) : 0;
        if (slack > 1.5) {
          let px = hx, py = hy;
          for (let i = 1; i <= 16; i++) {
            const s = i / 16, x = hx + (ax - hx) * s, y = hy + (ay - hy) * s + slack * 0.6 * 4 * s * (1 - s);
            buf.line(px, py, x, y, col); px = x; py = y;
          }
        } else buf.line(hx, hy, ax, ay, col);
        buf.px(ax - 1, ay, P.metal); buf.px(ax + 1, ay, P.metal); buf.px(ax, ay - 1, P.metal); buf.px(ax, ay + 1, P.metal);
        if (Math.sin(this.t * 6) > 0.5 || this.hook.state === 'fly') buf.px(ax, ay, P.white);
        if (this.hook.state === 'fly' && dist > 4) buf.px(ax - (ax - hx) / dist * 2, ay - (ay - hy) / dist * 2, P.metal);
      }
      if (this.jet) {
        const fx = -this.tx, fy = -this.ty;
        for (const nz of J.nozzles) {
          const nx = nz[0] + ox, ny = nz[1] + oy;
          buf.glow(nx, ny + 2, 12, FLAME[2], 0.4);
          const len = 6 + Math.floor((Math.sin(this.t * 47 + nx) * 0.5 + 0.5) * 5);
          for (let k = 0; k <= len; k++) {
            const q = k / len, ci = q < 0.2 ? 0 : q < 0.45 ? 1 : q < 0.8 ? 2 : 3;
            const px = nx + fx * k, py = ny + fy * k;
            buf.px(px, py, FLAME[ci]);
            if (q < 0.55) { buf.px(px - fy, py + fx, FLAME[Math.min(3, ci + 1)]); }
          }
        }
      }
      const o = this.off;
      o.clear();
      this.drawBody(o, J, this.o.rim, -1, -1);
      this.drawBody(o, J, null, 0, 0);
      if (this.flash > 0 && Math.sin(this.flash * 60) > 0) for (let i = 0; i < o.d.length; i++) if (o.d[i]) o.d[i] = P.white;
      buf.outlineBlit(o, ox, oy, OUTLINE);
      this.parts.draw(buf, cam);
    }
  }

  // --------------------------------------------------------------- ennemi (ashigaru)
  const EROWS = [
    '.....rrrrr.....',
    '...rrRRRRRrr...',
    '.rrrrrrrrrrrrr.',
    '.....mmmmm.....',
    '.....mkmkm.....',
    '.....mmmmm.....',
    '.....mmrmm.....',
    '....ddddddd....',
    '...dDDdddDDd...',
    '..dd.ddddd.dd..',
    '..d..dDdDd..d..',
    '..s..ddddd..s..',
    '.....bbbbb.....',
    '.....ddddd.....',
  ];
  const EPAL = { r: C('#7e2622'), R: C('#b8453a'), m: C('#efe6d6'), k: C('#0b0b10'), d: C('#c74b4b'), D: C('#e88a78'), s: C('#e8ac80'), b: C('#3a1c1c') };
  const ESPR = compile(EROWS, EPAL);
  const eoff = new Buf(40, 44);
  function drawEnemy(buf, x, y, flip, t, walking) {
    eoff.clear();
    const bob = walking ? (Math.sin(t * 10) > 0 ? 1 : 0) : Math.sin(t * 2.2) > 0.6 ? 1 : 0;
    stamp(eoff, ESPR, 12, 10 + bob, flip);
    const legC = C('#3a1c1c');
    const st = walking ? Math.sin(t * 10) * 2.2 : 0;
    eoff.stroke(18, 24 + bob, 18 + st, 30, 2, legC);
    eoff.stroke(21, 24 + bob, 21 - st, 30, 2, legC);
    eoff.rect(17 + st, 30, 3, 1, C('#0b0b10')); eoff.rect(20 - st, 30, 3, 1, C('#0b0b10'));
    const hx = flip ? 14 : 24, sway = Math.sin(t * 2) * 1.2;
    eoff.line(hx, 22 + bob, hx + sway, 2 + bob, C('#6b4a33'));
    eoff.poly([hx + sway - 1, 3 + bob, hx + sway + 1, 3 + bob, hx + sway, bob - 1], C('#d8dde6'));
    buf.outlineBlit(eoff, Math.round(x) - 12, Math.round(y) - 10, OUTLINE);
  }

  G.HERO = { Actor, Heat, drawEnemy, P, OUTLINE, FLAME, SMOKE, SPARK, EMBER };
})(window);
