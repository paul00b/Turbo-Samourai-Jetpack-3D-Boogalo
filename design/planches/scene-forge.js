/* Niveau 2 : Forteresse de braise (640 x 360, monde de 960 px). */
(function (G) {
  'use strict';
  const { W, H, C, Buf, fbm, hash2, lerpC, bayer, fsin, Particles } = G.PX;
  const { Actor, drawEnemy } = G.HERO;
  const KIT = G.KIT;

  const K = {
    sky: ['#12070a', '#240c0e', '#3d1311', '#5e1d12', '#8a2e14', '#a8401a'].map(C),
    smoke: ['#261211', '#341915', '#45211a'].map(C), smokeLit: C('#8a3a1c'),
    volc: C('#1c0b0b'), volcRim: C('#3a1410'), crater: C('#ff5a1f'),
    flow: ['#fff0a8', '#ffb347', '#ff7a2a', '#d9481f', '#8a2414'].map(C),
    oni: C('#1f0c0c'), oniRim: C('#3d1713'), veinLo: C('#4a160e'), veinHi: C('#ff7a2a'), oniEye: C('#ffcf5a'), fang: C('#e8d8c0'),
    town: C('#1d0d0c'), townRim: C('#4a1c12'),
    castle: C('#2f1a17'), roof: C('#1c0f0f'), under: C('#7a3018'), win: C('#c4561f'), gold: C('#b88a36'),
    wall: C('#4a4040'), wallLt: C('#5e5250'), mortar: C('#2a2222'), wallTop: C('#c79a72'),
    obs: C('#1a1418'), obsGloss: C('#6b5a7a'), obsTop: C('#9a86ad'), chain: C('#6d6a70'), iron: C('#3a3a42'), ironHi: C('#8a8a96'),
    bronze: C('#8a6a3a'), bronzeHi: C('#c9a25a'), bronzeDk: C('#4a3620'),
    ember: [C('#ffd166'), C('#ff9a3c'), C('#d9481f')], ash: C('#6b5552'),
    fire: ['#fff3b0', '#ffc44d', '#ff7a2a', '#c93a1a'].map(C), cloth: C('#e8d8c0'), clothMark: C('#1c0f0f'),
    fg: C('#0a0405'), flat: C('#14100f'),
  };

  function rimPass(b, body, rim, below) {
    for (let y = 1; y < b.h - 1; y++) for (let x = 0; x < b.w; x++) {
      const i = y * b.w + x;
      if (b.d[i] !== body) continue;
      if (b.d[i - b.w] === 0) b.d[i] = rim;
      else if (below && b.d[i + b.w] === 0) b.d[i] = below;
    }
  }

  function volcanoes() {
    const b = new Buf(720, H);
    b.poly([0, 250, 80, 110, 104, 104, 200, 250], K.volc);
    b.poly([380, 250, 540, 86, 574, 82, 720, 250], K.volc);
    rimPass(b, K.volc, K.volcRim);
    const flows = [];
    for (const [sx, sy, seed, drift] of [[552, 88, 1, -0.4], [562, 86, 2, 0.5], [92, 106, 3, -0.3], [570, 88, 4, 0.9]]) {
      const path = [];
      let x = sx, y = sy;
      while (y < 246) { path.push(x, y); y += 1; x += (hash2(y, seed, 9) - 0.5) * 2 + drift; }
      flows.push(path);
    }
    return { b, flows };
  }

  function town() {
    const b = new Buf(760, H);
    for (let x = 0; x < 760; x += 26 + Math.floor(hash2(x, 0, 3) * 14)) {
      const w = 22 + Math.floor(hash2(x, 1, 3) * 16), y = 236 + Math.floor(hash2(x, 2, 3) * 10);
      b.rect(x + 3, y, w - 6, 30, K.town);
      b.poly([x, y + 1, x + w, y + 1, x + w - 6, y - 7, x + 6, y - 7], K.town);
    }
    b.rect(0, 256, 760, 20, K.town);
    rimPass(b, K.town, K.townRim);
    return b;
  }

  function castle() {
    const b = new Buf(840, H);
    const ridge = C('#1a0c0b'), pts = [0, H];
    for (let x = 0; x <= 840; x += 12) pts.push(x, 256 + Math.round(fsin(x * 0.07) * 3 + hash2(x, 0, 12) * 4));
    pts.push(840, H);
    b.poly(pts, ridge);
    rimPass(b, ridge, K.volcRim);
    b.rect(150, 222, 540, 34, K.castle);
    b.rect(146, 218, 548, 4, K.roof);
    const tower = (cx, base, w, tiers) => {
      b.poly([cx - w / 2 - 10, base, cx + w / 2 + 10, base, cx + w / 2 - 2, base - 36, cx - w / 2 + 2, base - 36], K.castle);
      let y = base - 36, hw = w / 2;
      for (let i = 0; i < tiers; i++) {
        b.rect(cx - hw + 4, y - 18, hw * 2 - 8, 18, K.castle);
        b.poly([cx - hw - 8, y, cx + hw + 8, y, cx + hw - 4, y - 8, cx - hw + 4, y - 8], K.roof);
        if (i === 1) b.poly([cx - 10, y - 8, cx + 10, y - 8, cx, y - 16], K.roof);
        for (let x = cx - hw + 9; x < cx + hw - 9; x += 8) b.rect(x, y - 15, 3, 4, K.win);
        y -= 18; hw -= 8;
      }
      b.poly([cx - hw - 8, y, cx + hw + 8, y, cx, y - 11], K.roof);
      b.px(cx - hw - 6, y - 2, K.gold); b.px(cx + hw + 6, y - 2, K.gold); b.px(cx - hw - 7, y - 3, K.gold); b.px(cx + hw + 7, y - 3, K.gold);
    };
    tower(420, 250, 110, 4);
    tower(150, 250, 60, 2);
    tower(690, 250, 72, 3);
    for (let y = 214; y < 256; y += 6) for (let x = 90; x < 760; x++) if (b.d[y * 840 + x] === K.castle && hash2(x, y, 3) > 0.72) b.px(x, y, K.roof);
    rimPass(b, K.castle, K.castle, K.under);
    rimPass(b, K.roof, K.roof, K.under);
    return b;
  }

  function stoneWall(b, x, y, w, h) {
    b.rect(x, y, w, h, K.wall);
    for (let r = 0, yy = y + 4; yy < y + h; yy += 8, r++) {
      b.hline(x, x + w - 1, yy, K.mortar);
      for (let xx = x + ((r & 1) ? 6 : 0); xx < x + w; xx += 14) b.rect(xx, yy - 7, 1, 7, K.mortar);
      for (let xx = x + 1; xx < x + w; xx++) if (hash2(xx, yy, 8) > 0.82) b.px(xx, yy - 4, K.wallLt);
    }
    b.hline(x, x + w - 1, y, K.wallTop);
    b.hline(x, x + w - 1, y + 1, K.wallLt);
  }

  function playLayer() {
    const b = new Buf(960, H), WD = KIT.WOOD;
    stoneWall(b, 0, 262, 222, 58);
    for (let i = -1; i <= 1; i++) b.stroke(60, 262, 60 + i * 6, 250, 1, K.iron);
    b.rect(54, 246, 13, 4, K.iron); b.hline(54, 66, 246, K.ironHi);
    KIT.post(b, 206, 36, 262, 6);
    KIT.beam(b, 148, 214, 34, 5);
    b.stroke(208, 84, 176, 39, 2, WD.post);
    for (let y = 39; y < 57; y += 2) b.px(170, y, K.chain);
    // Pont de cordes, pile de pierre, clocher (portique B)
    KIT.planks(b, 222, 276, 80, 6);
    for (const x of [236, 286]) KIT.post(b, x, 282, 330, 4);
    for (let x = 222; x < 302; x++) b.px(x, 266 + Math.round(4 * ((x - 222) / 80) * (1 - (x - 222) / 80) * 4), C('#6b4a33'));
    stoneWall(b, 300, 270, 160, 50);
    KIT.post(b, 312, 40, 270, 6); KIT.post(b, 444, 40, 270, 6);
    KIT.beam(b, 300, 460, 34, 6);
    b.poly([294, 34, 466, 34, 454, 24, 306, 24], K.roof); b.hline(294, 465, 34, K.under);
    for (let y = 40; y < 48; y += 2) b.px(380, y, K.chain);
    // Échafaudage, tour de guet (C), masse d'armes pendue
    KIT.planks(b, 460, 286, 100, 6);
    for (const x of [476, 540]) KIT.post(b, x, 292, 330, 4);
    KIT.post(b, 640, 48, 330, 5); KIT.post(b, 676, 48, 330, 5);
    for (let y = 70; y < 320; y += 34) { b.stroke(644, y, 676, y + 34, 2, WD.post); b.stroke(676, y, 644, y + 34, 2, WD.post); }
    KIT.planks(b, 556, 42, 140, 6);
    b.poly([626, 30, 704, 30, 694, 20, 636, 20], K.roof); b.hline(626, 703, 30, K.under);
    KIT.post(b, 632, 30, 42, 3); KIT.post(b, 694, 30, 42, 3);
    for (let y = 48; y < 54; y += 2) b.px(580, y, K.chain);
    // Rempart droit, obsidienne lisse, pagode et sa potence (D)
    stoneWall(b, 700, 258, 260, 62);
    KIT.slick(b, 690, 258, 10, 62, K.obs, K.obsGloss, K.obsTop);
    for (let i = 0; i < 5; i++) {
      const y = 256 - i * 40, hw = 22 - i * 3;
      b.rect(905 - hw, y - 30, hw * 2, 30, C('#3a1f18'));
      b.poly([905 - hw - 16, y - 28, 905 + hw + 16, y - 28, 905 + hw + 4, y - 38, 905 - hw - 4, y - 38], K.roof);
      b.hline(905 - hw - 16, 905 + hw + 15, y - 28, K.under);
      for (let x = 905 - hw + 5; x < 905 + hw - 5; x += 7) b.rect(x, y - 22, 3, 5, K.win);
    }
    b.rect(904, 40, 2, 20, K.gold);
    KIT.beam(b, 776, 884, 50, 5);
    b.stroke(882, 90, 850, 55, 2, WD.post);
    for (let y = 55; y < 59; y += 2) b.px(792, y, K.chain);
    return b;
  }

  function lava(buf, t, cam) {
    const y0 = 320;
    for (let y = y0 - 20; y < y0; y++) {
      const a = 0.42 * (1 - (y0 - y) / 20);
      for (let x = 0; x < W; x++) if (a > bayer(x, y) * 0.8) buf.mix(x, y, K.flow[2], 0.35);
    }
    for (let x = 0; x < W; x++) {
      const wx = x + cam;
      const sy = y0 + fsin(wx * 0.08 + t * 1.6) * 1.5 + fsin(wx * 0.023 - t * 0.7) * 1.2;
      for (let y = Math.round(sy); y < H; y++) {
        const n = fsin(wx * 0.11 + y * 0.4 - t * 2.2) + fsin(wx * 0.05 - y * 0.3 + t * 1.3);
        const d = y - sy;
        buf.d[y * W + x] = d < 1 ? K.flow[0] : n > 1.2 ? K.flow[1] : n > 0.2 ? K.flow[2] : n > -0.9 ? K.flow[3] : K.flow[4];
      }
    }
    for (let i = 0; i < 20; i++) {
      const per = 1.8 + hash2(i, 0, 1) * 1.5, ph = (t + hash2(i, 1, 1) * per) % per;
      const bx = ((hash2(i, 2, 1) * 1000 - cam) % 1000 + 1000) % 1000 - 40, by = 328 + hash2(i, 3, 1) * 26;
      if (ph < per * 0.7) { const r = (ph / (per * 0.7)) * 4.5; buf.disc(bx, by, r, K.flow[1]); buf.px(bx - 1, by - r + 1, K.flow[0]); }
      else {
        const q = (ph - per * 0.7) / (per * 0.3);
        for (let k = 0; k < 5; k++) buf.px(bx + (k - 2) * 9 * q, by - 30 * q + 50 * q * q, K.flow[q < 0.5 ? 1 : 3]);
      }
    }
    for (const fx of [110, 760]) {
      const x = fx - cam;
      for (let y = 300; y < 322; y++) for (let k = 0; k < 4; k++) {
        const n = fsin(y * 0.6 - t * 14 + k * 1.7);
        buf.px(x + k, y, n > 0.4 ? K.flow[0] : n > -0.3 ? K.flow[1] : K.flow[2]);
      }
      buf.glow(x + 2, 318, 12, K.flow[1], 0.4);
    }
  }

  function shimmer(buf, t) {
    for (let y = 266; y < 318; y++) {
      const s = Math.round(fsin(y * 0.7 + t * 6) * 0.6);
      if (!s) continue;
      const o = y * W;
      if (s > 0) buf.d.copyWithin(o + 1, o, o + W - 1); else buf.d.copyWithin(o, o + 1, o + W);
    }
  }

  function flames(buf, x, y, t, s, glowR) {
    for (let k = -3; k <= 3; k++) {
      const hgt = Math.round((4 + (fsin(t * 9 + k * 1.7 + x) * 0.5 + 0.5) * 7 - Math.abs(k)) * s);
      for (let j = 0; j < hgt; j++) buf.px(x + k, y - j, K.fire[Math.min(3, Math.floor((j / Math.max(1, hgt)) * 4))]);
    }
    buf.glow(x, y - 3, glowR, K.fire[2], 0.3);
  }

  function oni(buf, t, cam, veins) {
    const hx = 400 - cam * 0.25, hy = 128 + fsin(t * 0.4) * 2, jaw = fsin(t * 0.8) * 2;
    buf.poly([hx - 50, hy - 30, hx - 96, hy - 92, hx - 84, hy - 36], K.oniRim);
    buf.poly([hx + 50, hy - 30, hx + 96, hy - 92, hx + 84, hy - 36], K.oniRim);
    buf.poly([hx - 62, hy - 36, hx + 62, hy - 36, hx + 72, hy + 30, hx + 34, hy + 84 + jaw, hx - 34, hy + 84 + jaw, hx - 72, hy + 30], K.oni);
    buf.hline(hx - 61, hx + 61, hy - 36, K.oniRim);
    for (let i = 0; i < veins.length; i += 3) {
      const k = 0.5 + 0.5 * fsin(t * 1.3 + veins[i + 2] * 0.9);
      buf.px(hx + veins[i], hy + veins[i + 1], lerpC(K.veinLo, K.veinHi, k * 0.8));
    }
    const pulse = 0.5 + 0.5 * fsin(t * 1.3);
    for (const s of [-1, 1]) {
      buf.stroke(hx + s * 12, hy - 20, hx + s * 44, hy - 30, 3, K.oniRim);
      const ex = hx + s * 26, ey = hy - 8;
      buf.glow(ex, ey, 18, K.veinHi, 0.25 + pulse * 0.15);
      buf.poly([ex - 11 * s, ey - 4, ex + 10 * s, ey + 2, ex - 8 * s, ey + 5], K.oniEye);
      buf.px(ex - 2 * s, ey + 1, K.oni);
      const age = (t * 0.6 + (s > 0 ? 0.5 : 0)) % 1;
      buf.disc(hx + s * 9 + age * 10 * s, hy + 24 - age * 30, 1 + age * 4, K.smoke[age < 0.5 ? 2 : 1]);
    }
    const my = hy + 46 + jaw;
    for (let x = -32; x <= 32; x++) buf.px(hx + x, my + Math.round(fsin(x * 0.4) * 1.5), K.veinHi);
    for (const f of [-24, -10, 10, 24]) buf.poly([hx + f - 3, my, hx + f + 3, my, hx + f, my + 8], K.fang);
    for (const f of [-17, 17]) buf.poly([hx + f - 2, my, hx + f + 2, my, hx + f, my - 6], K.fang);
  }

  function veinsGen() {
    const v = [];
    for (let k = 0; k < 16; k++) {
      let x = (hash2(k, 1, 4) - 0.5) * 110, y = -28 + hash2(k, 2, 4) * 90;
      for (let s = 0; s < 34; s++) { v.push(Math.round(x), Math.round(y), k); x += (hash2(k, s, 5) - 0.5) * 3.4; y += hash2(k, s, 6) * 1.8 - 0.35; }
    }
    return v;
  }

  G.SCENES = G.SCENES || [];
  G.SCENES.push({
    id: 'forge',
    create() {
      const sky = new Buf(W, H);
      sky.vgrad(0, H, K.sky);
      const sm1 = KIT.clouds(31, 768, 90, 0.5, K.smoke, null), sm2 = KIT.clouds(47, 768, 70, 0.56, K.smoke, null);
      for (const s of [sm1, sm2]) for (let y = s.h - 2; y >= 0; y--) for (let x = 0; x < s.w; x++) { const i = y * s.w + x; if (s.d[i] && !s.d[i + s.w]) s.d[i] = K.smokeLit; }
      const vol = volcanoes(), tw = town(), cas = castle(), play = playLayer(), veins = veinsGen();
      const actor = new Actor({
        anchors: [{ x: 170, y: 58, L: 88 }, { x: 380, y: 50, L: 86 }, { x: 580, y: 56, L: 90 }, { x: 792, y: 60, L: 90 }],
        order: [0, 1, 2, 3, 2, 1], bottom: 312, worldW: 960, rim: C('#ffb27a'), halo: null, wind: 50,
      });
      const cam = new KIT.Cam(960);
      return {
        frame(buf, t, dt, mode) {
          actor.update(dt);
          const cx = cam.update(actor, dt);
          if (mode === 'play') buf.clear(K.flat);
          else {
            buf.blit(sky, 0, 0);
            buf.blitWrap(sm1, -t * 4 - cx * 0.05, 10);
            const vx = -cx * 0.12, crx = 558 + vx;
            for (let i = 0; i < 18; i++) {
              const age = (t * 0.12 + i / 18) % 1;
              const x = crx + age * 90 + fsin(i * 1.7 + t * 0.3) * 10, y = 80 - age * 150, r = 8 + age * 30;
              buf.disc(x, y, r, K.smoke[0]); buf.disc(x - 2, y - 2, r * 0.7, K.smoke[age < 0.3 ? 2 : 1]);
            }
            buf.glow(crx, 82, 40, K.crater, 0.45 + 0.1 * fsin(t * 2));
            buf.blit(vol.b, vx, 0);
            vol.flows.forEach((p, fi) => {
              for (let i = 0; i < p.length; i += 2) buf.px(p[i] + vx, p[i + 1], K.flow[(Math.floor(i / 2 - t * 14 + fi * 7) & 3) + 1]);
            });
            const te = t % 3.1;
            for (let i = 0; i < 12; i++) {
              const bvx = (hash2(i, Math.floor(t / 3.1), 3) - 0.5) * 80, bvy = -70 - hash2(i, 5, 3) * 60;
              const x = crx + bvx * te, y = 82 + bvy * te + 45 * te * te;
              if (y < 250) { buf.rect(x, y, 2, 2, K.flow[1]); buf.px(x - bvx * 0.03, y + 2, K.flow[3]); }
            }
            buf.blitWrap(sm2, -t * 9 - cx * 0.2, 70);
            oni(buf, t, cx, veins);
            buf.blit(tw, -cx * 0.35, 0);
            for (const [x, y] of [[80, 236], [300, 232], [520, 238], [690, 234]]) flames(buf, x - cx * 0.35, y, t, 1.3, 14);
            buf.blit(cas, -cx * 0.55, 0);
            for (const [x, y] of [[472, 158], [368, 176], [180, 196], [720, 178], [640, 214]]) flames(buf, x - cx * 0.55, y, t, 1, 12);
            for (let i = 0; i < 7; i++) KIT.banner(buf, 210 + i * 70 - cx * 0.55, 200, 16, t + i, K.cloth, K.clothMark, K.roof);
            for (let i = 0; i < 3; i++) {
              const q = ((t * 0.35 + i / 3) % 1), x = 150 + q * 540 - cx * 0.55, y = 200 - fsin(q * Math.PI) * 120;
              for (let k = 1; k < 10; k++) {
                const qk = q - k * 0.006, xk = 150 + qk * 540 - cx * 0.55, yk = 200 - fsin(qk * Math.PI) * 120;
                buf.px(xk, yk, K.fire[Math.min(3, k >> 1)]);
              }
              buf.px(x, y, K.fire[0]); buf.glow(x, y, 5, K.fire[1], 0.4);
            }
            for (let i = 0; i < 110; i++) {
              const v = 18 + hash2(i, 1, 9) * 30, y = H - ((t * v + hash2(i, 2, 9) * 380) % 380);
              const x = ((hash2(i, 3, 9) * 720 - cx * 0.8 + fsin(t * 2 + i) * 5) % 720 + 720) % 720 - 40;
              buf.px(x, y, i % 5 === 0 ? K.ash : K.ember[i % 3]);
            }
          }
          buf.blit(play, -cx, 0);
          if (mode !== 'play') flames(buf, 60 - cx, 246, t, 1.2, 16);
          const bell = fsin(t * 1.6) * 0.25, bx = 342 - cx + Math.sin(bell) * 18, by = 40 + Math.cos(bell) * 18;
          buf.line(342 - cx, 40, bx, by, C('#6b4a33'));
          buf.poly([bx - 5, by, bx + 5, by, bx + 8, by + 14, bx - 8, by + 14], K.bronze);
          buf.stroke(bx - 3, by + 2, bx - 5, by + 12, 1, K.bronzeHi); buf.hline(bx - 8, bx + 8, by + 14, K.bronzeDk);
          const ma = fsin(t * 2.4) * 0.9, mx = 510 - cx + Math.sin(ma) * 18, my = 292 + Math.cos(ma) * 18;
          for (let s = 0; s <= 1; s += 0.06) buf.px(510 - cx + (mx - 510 + cx) * s, 292 + (my - 292) * s, K.chain);
          buf.disc(mx, my, 6, K.iron); buf.disc(mx - 1, my - 1, 2, K.ironHi);
          for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; buf.px(mx + Math.cos(a) * 8, my + Math.sin(a) * 8, C('#d94848')); buf.px(mx + Math.cos(a) * 7, my + Math.sin(a) * 7, K.ironHi); }
          lava(buf, t, cx);
          if (mode !== 'play') shimmer(buf, t);
          drawEnemy(buf, 96 - cx, 241, false, t, false);
          drawEnemy(buf, 226 + 30 * (1 + Math.sin(t * 0.6)) - cx, 255, Math.cos(t * 0.6) < 0, t + 1, true);
          drawEnemy(buf, 735 - cx, 237, true, t + 2, false);
          actor.draw(buf, cx);
          if (mode !== 'play') for (let i = 0; i < 26; i++) {
            const v = 40 + hash2(i, 1, 13) * 40, y = H - ((t * v + hash2(i, 2, 13) * 380) % 380);
            const x = ((hash2(i, 3, 13) * 720 - cx * 1.3) % 720 + 720) % 720 - 40;
            if ((x - actor.x + cx) ** 2 + (y - actor.y) ** 2 > 26 * 26) buf.rect(x, y, 2, 2, K.ember[i % 2]);
          }
          return actor.hud();
        },
      };
    },
    palette: [
      ['Ciel de braise', '#3d1311'], ['Basalte de l\'oni', '#1f0c0c'], ['Veines', '#ff7a2a'],
      ['Rempart accrochable', '#c79a72'], ['Obsidienne lisse (=)', '#6b5a7a'], ['Lave mortelle', '#ffd166'],
    ],
  });
})(window);
