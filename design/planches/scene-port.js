/* Niveau 1 : Port d'Umibozu (640 x 360, monde de 960 px). */
(function (G) {
  'use strict';
  const { W, H, C, Buf, hash2, dith, fsin, Particles } = G.PX;
  const { Actor, drawEnemy } = G.HERO;
  const KIT = G.KIT;

  const K = {
    sky: ['#070b16', '#0c1424', '#142037', '#1d2c47', '#27395a'].map(C),
    skyF: ['#1b2740', '#2a3a5a', '#3c5073', '#4f6588', '#5b7294'].map(C),
    cloud: ['#0f1829', '#17233a', '#22324d'].map(C), cloudLit: C('#34496a'),
    far: C('#131c2e'), farRim: C('#22314d'), farF: C('#34466a'), farFRim: C('#4a6088'), window: C('#8a5c30'),
    boat: C('#0b111d'), sail: C('#16202f'), sailLine: C('#0e1624'),
    uBody: C('#0d1320'), uRim: C('#1f2d45'), uF: C('#2c3d5c'), uSpot: C('#0a0f1a'), sucker: C('#2a3a52'),
    eye: C('#c9dfe9'), eyeGlow: C('#7fb0c9'),
    sea: ['#0e1828', '#132036', '#1b2d49', '#314b6d'].map(C), foam: C('#9db5cc'), foamHi: C('#dfe9f2'),
    red: C('#a8342a'), redHi: C('#d9574a'), redDk: C('#6e1f19'), cap: C('#1a1414'),
    rock: { rock: C('#252a36'), dk: C('#1b1f29'), lt: C('#323847'), top: C('#5a6479'), moss: C('#46613f') },
    slick: C('#15202d'), gloss: C('#4a6d91'), slickTop: C('#79a0c4'),
    stake: C('#bda57a'), stakeHi: C('#e6d4aa'),
    lantern: { rope: C('#6b4a33'), glow: C('#ff9a4a'), cap: C('#2a1a12'), body: C('#c8412e'), core: C('#ffd08a'), rib: C('#8e2a20') },
    stone: C('#5b6070'), stoneHi: C('#80879a'), stoneDk: C('#3c404c'), hemp: C('#d9cfb4'), net: C('#6d5a44'),
    hull: C('#3a2416'), hullLine: C('#26170d'), sailFurl: C('#cfc3a8'), sailFurlDk: C('#9c917a'), rig: C('#5a3d28'),
    cloth: C('#e8e0cf'), clothMark: C('#a8342a'), pennant: C('#c8412e'),
    fish: C('#8d9aa8'), fishDk: C('#56606e'), gull: C('#b8c4d2'),
    rainFar: C('#34465f'), rainNear: C('#7d93ae'), fg: C('#05070c'), flat: C('#10131b'),
  };

  function farLayer(body, rim) {
    const b = new Buf(720, H);
    b.poly([0, 210, 0, 120, 30, 112, 70, 140, 120, 168, 170, 210], body);
    b.poly([440, 210, 480, 160, 540, 138, 600, 100, 640, 104, 690, 80, 720, 84, 720, 210], body);
    for (let i = 0; i < 4; i++) {
      const y = 62 + i * 10, hw = 12 + i * 4;
      b.poly([608 - hw, y + 7, 608 + hw, y + 7, 608 + hw - 5, y, 608 - hw + 5, y], body);
      b.rect(602 - i, y + 7, 12 + i * 2, 3, body);
    }
    b.rect(607, 52, 2, 10, body);
    for (let y = 1; y < H; y++) for (let x = 0; x < 720; x++) {
      const i = y * 720 + x;
      if (b.d[i] === body && b.d[i - 720] === 0) b.d[i] = rim;
    }
    for (const [x, y] of [[606, 74], [611, 84], [520, 170], [548, 160], [60, 150], [492, 186], [676, 110]]) b.rect(x, y, 2, 2, K.window);
    return b;
  }

  function playLayer() {
    const b = new Buf(960, H), WD = KIT.WOOD;
    // Ponton gauche : pilotis, garde-corps, filets, tonneaux, caisses
    for (let x = 10; x < 300; x += 50) KIT.post(b, x, 256, H, 5);
    KIT.planks(b, 0, 250, 300, 8);
    for (let x = 20; x <= 200; x += 12) { b.rect(x, 236, 2, 14, K.red); b.px(x + 1, 237, K.redDk); }
    b.rect(20, 234, 184, 2, K.red); b.hline(20, 203, 234, K.redHi);
    for (let y = 237; y < 250; y++) for (let x = 60; x < 124; x++) if (((x + y) % 4 === 0 || (x - y) % 4 === 0) && hash2(x, y, 5) > 0.2) b.px(x, y, K.net);
    for (const x of [226, 238]) {
      b.rect(x, 237, 10, 13, WD.body); b.rect(x + 1, 237, 2, 13, WD.mid);
      b.hline(x, x + 9, 240, WD.seam); b.hline(x, x + 9, 246, WD.seam); b.hline(x, x + 9, 237, WD.top);
    }
    b.rect(264, 238, 14, 12, WD.body); b.line(264, 238, 277, 249, WD.seam); b.line(277, 238, 264, 249, WD.seam); b.hline(264, 277, 238, WD.top);
    for (let r = 5; r > 1; r -= 1.5) b.ellipse(208, 246, r + 2, r - 1, r % 2 ? K.hemp : K.rig);
    // Grue A
    KIT.post(b, 246, 36, 250, 6);
    KIT.beam(b, 168, 256, 34, 5);
    b.stroke(248, 84, 214, 39, 2, WD.post);
    b.disc(180, 41, 3, K.stoneDk); b.px(180, 41, K.stoneHi);
    b.line(180, 44, 180, 58, K.rig);
    // Ponton bas piégé et mât B
    for (let x = 310; x < 480; x += 50) KIT.post(b, x, 299, H, 5);
    KIT.planks(b, 300, 292, 180, 7);
    KIT.stakes(b, 306, 470, 292, K.stake, K.stakeHi);
    KIT.post(b, 396, 38, 292, 5);
    KIT.beam(b, 370, 432, 36, 4);
    b.line(400, 40, 400, 56, K.rig);
    // Jonque amarrée : coque, cabine, mât C, vergue et voile ferlée, haubans
    b.poly([470, 262, 732, 262, 716, 302, 492, 302], K.hull);
    for (let y = 268; y < 302; y += 6) b.hline(476 + (y - 262) * 0.4, 726 - (y - 262) * 0.4, y, K.hullLine);
    b.hline(470, 731, 262, WD.top); b.hline(470, 731, 263, WD.mid);
    b.poly([456, 250, 478, 262, 470, 262], K.hull);
    b.rect(640, 238, 70, 24, WD.body); b.hline(640, 709, 238, WD.top);
    b.poly([632, 239, 718, 239, 710, 230, 640, 230], K.cap);
    for (let x = 648; x < 704; x += 12) b.rect(x, 246, 5, 6, C('#e0a050'));
    KIT.post(b, 596, 22, 262, 6);
    KIT.beam(b, 548, 654, 44, 4);
    for (let x = 548; x < 654; x++) { const h = 5 + Math.round(fsin(x * 0.5) * 1.5); b.rect(x, 48, 1, h, (x % 9 < 2) ? K.sailFurlDk : K.sailFurl); }
    b.line(585, 48, 585, 56, K.rig);
    b.line(599, 22, 458, 250, K.rig); b.line(599, 22, 728, 262, K.rig);
    // Falaise droite, face lisse, grue D, torii, lanternes de pierre, sanctuaire
    KIT.rockMass(b, [720, H, 726, 238, 760, 232, 800, 236, 860, 228, 960, 232, 960, H], K.rock);
    KIT.slick(b, 724, 240, 14, 120, K.slick, K.gloss, K.slickTop);
    KIT.post(b, 824, 34, 232, 6);
    KIT.beam(b, 776, 834, 32, 5);
    b.stroke(826, 80, 800, 37, 2, WD.post);
    b.line(790, 37, 790, 52, K.rig);
    for (const x of [856, 892]) { b.rect(x, 176, 5, 54, K.red); b.rect(x + 3, 176, 2, 54, K.redDk); }
    b.rect(842, 166, 68, 4, K.cap); b.rect(846, 170, 60, 4, K.red); b.hline(846, 905, 170, K.redHi);
    b.rect(850, 184, 52, 3, K.red);
    for (let x = 862; x < 892; x += 6) { b.px(x, 188, K.hemp); b.px(x + 1, 189, K.hemp); b.px(x, 190, K.hemp); b.px(x + 1, 191, K.hemp); }
    b.stroke(858, 187, 894, 187, 2, K.hemp);
    for (const x of [838, 918]) {
      b.rect(x - 1, 212, 12, 3, K.stoneHi); b.rect(x, 215, 10, 3, K.stone); b.rect(x + 2, 218, 6, 5, K.stoneDk);
      b.rect(x + 3, 223, 4, 6, K.stone); b.rect(x, 229, 10, 3, K.stone);
    }
    b.rect(930, 190, 30, 42, WD.post);
    b.poly([922, 192, 960, 192, 960, 176, 936, 176], K.cap);
    b.hline(922, 959, 192, K.stoneHi);
    for (let x = 934; x < 960; x += 7) b.rect(x, 198, 4, 30, WD.body);
    return b;
  }

  function umibozu(buf, t, cam, flash, heroX, parts, state) {
    const hx = 420 - cam * 0.3, hy = 150 + fsin(t * 0.5) * 3;
    const body = flash ? K.uF : K.uBody;
    const offs = [-104, -78, -52, 50, 76, 102], tilt = [-0.8, -0.45, -0.15, 0.15, 0.45, 0.8];
    const segs = [];
    for (let i = 0; i < 6; i++) {
      let x = hx + offs[i], y = 216, a = -Math.PI / 2 + tilt[i];
      for (let s = 0; s < 22; s++) {
        a += (i < 3 ? -0.045 : 0.045) + 0.06 * fsin(t * 0.8 + i * 1.9 + s * 0.35);
        x += Math.cos(a) * 4.2; y += Math.sin(a) * 4.2;
        segs.push(x, y, 9 * (1 - s / 22) + 1.2, a, i < 3 ? 1 : -1);
      }
    }
    // Tentacule qui se lève puis frappe l'eau (cycle de 9 s)
    const q = (t % 9) / 9;
    if (q < 0.72) {
      const lift = q < 0.45 ? q / 0.45 : q < 0.62 ? 1 : 1 - (q - 0.62) / 0.1 * 1.6;
      let x = hx + 150, y = 218, a = -Math.PI / 2 - 0.2 - lift * 0.3;
      for (let s = 0; s < 26; s++) {
        a += -0.04 * lift + 0.08 * fsin(t * 1.6 + s * 0.4) + (1 - lift) * 0.09;
        x += Math.cos(a) * 4.4; y += Math.sin(a) * 4.4;
        segs.push(x, y, 8 * (1 - s / 26) + 1.4, a, -1);
      }
    }
    if (q >= 0.7 && state.lastSlam !== Math.floor(t / 9)) {
      state.lastSlam = Math.floor(t / 9);
      for (let k = 0; k < 46; k++) parts.spawn(hx + 60 + Math.random() * 60, 206, (Math.random() - 0.5) * 120, -80 - Math.random() * 140, 1.1, [K.foamHi, K.foam, K.sea[3]], 260, 0.4);
    }
    for (let i = 0; i < segs.length; i += 5) buf.disc(segs[i] - 1, segs[i + 1] - 1, segs[i + 2], K.uRim);
    buf.ellipse(hx - 1, hy - 1, 64, 56, K.uRim);
    for (let i = 0; i < segs.length; i += 5) buf.disc(segs[i], segs[i + 1], segs[i + 2], body);
    buf.ellipse(hx, hy, 64, 56, body);
    if (!flash) for (let k = 0; k < 18; k++) {
      const sx = hx + (hash2(k, 0, 3) - 0.5) * 90, sy = hy - 40 + hash2(k, 1, 3) * 40;
      buf.disc(sx, sy, 1 + hash2(k, 2, 3) * 2.5, K.uSpot);
    }
    for (let i = 0; i < segs.length; i += 10) {
      const a = segs[i + 3], side = segs[i + 4], r = segs[i + 2];
      buf.px(segs[i] + Math.cos(a + side * Math.PI / 2) * r * 0.6, segs[i + 1] + Math.sin(a + side * Math.PI / 2) * r * 0.6, K.sucker);
    }
    const blink = t % 5.1 < 0.14;
    const look = Math.max(-3, Math.min(3, (heroX - hx) / 60));
    for (const s of [-1, 1]) {
      const ex = hx + s * 22, ey = hy - 6;
      buf.glow(ex, ey, 16, K.eyeGlow, 0.32);
      if (blink) buf.hline(ex - 6, ex + 6, ey, K.eye);
      else { buf.ellipse(ex, ey, 6, 4, K.eye); buf.rect(ex + look - 0.5, ey - 3, 2, 7, K.uBody); }
    }
    return hx;
  }

  function sea(buf, t, cam) {
    const y0 = 205;
    buf.hline(0, W - 1, y0, K.sea[3]);
    for (let y = y0 + 1; y < H; y++) {
      const k = (y - y0) / (H - y0), o = y * W;
      const fr = 0.11 - k * 0.07, sp = 1.1 + k * 1.6, par = 0.35 + k * 0.45;
      for (let x = 0; x < W; x++) {
        const wx = x + cam * par;
        const v = fsin(wx * fr + t * sp + y * 0.55) + 0.7 * fsin(wx * fr * 0.37 - t * 0.9 + y * 0.23) + 0.35 * fsin(wx * 0.21 + y * 1.7 - t * 2);
        buf.d[o + x] = v > 1.7 ? K.foam : v > 1.3 ? K.sea[3] : v > 0.55 ? K.sea[2] : dith(x, y, K.sea[0], K.sea[1], 1 - k);
      }
    }
  }

  function boats(buf, t, cam) {
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 150 + hash2(i, 0, 2) * 40 - cam * 0.3, y = 200 + fsin(t * 1.3 + i * 2) * 1.2;
      buf.poly([x - 10, y, x + 10, y, x + 7, y + 3, x - 7, y + 3], K.boat);
      buf.line(x, y, x, y - 13, K.boat);
      buf.rect(x + 1, y - 12, 7, 10, K.sail);
      for (let j = y - 10; j < y - 2; j += 3) buf.hline(x + 1, x + 7, j, K.sailLine);
      buf.glow(x - 8, y - 2, 6, K.lantern.glow, 0.4);
      buf.px(x - 8, y - 2, K.lantern.core);
    }
  }

  function gulls(buf, t, cam) {
    for (let i = 0; i < 4; i++) {
      const x = ((i * 230 - t * (16 + i * 3) - cam * 0.45) % 800 + 800) % 800 - 80, y = 80 + i * 24 + fsin(t * 0.9 + i) * 6;
      const up = fsin(t * 8 + i * 2) > 0;
      buf.px(x, y, K.gull);
      if (up) { buf.line(x - 4, y - 2, x - 1, y, K.gull); buf.line(x + 1, y, x + 4, y - 2, K.gull); }
      else { buf.line(x - 4, y + 1, x - 1, y, K.gull); buf.line(x + 1, y, x + 4, y + 1, K.gull); }
    }
  }

  function bolt(buf, t, cam) {
    const s = Math.floor(t / 7.3);
    let x = 500 - cam * 0.2 + hash2(s, 0, 5) * 80, y = 0;
    while (y < 180) {
      const nx = x + (hash2(s, y, 6) - 0.5) * 16, ny = y + 7 + hash2(s, y, 7) * 8;
      buf.line(x, y, nx, ny, C('#e8f3ff')); buf.line(x + 1, y, nx + 1, ny, C('#8fb3d9'));
      if (hash2(s, y, 8) > 0.8) buf.line(nx, ny, nx + 14, ny + 12, C('#8fb3d9'));
      x = nx; y = ny;
    }
  }

  function decor(buf, t, cam) {
    KIT.lanternString(buf, 250 - cam, 96, 397 - cam, 88, 24, 7, t, K.lantern);
    KIT.lanternString(buf, 598 - cam, 26, 728 - cam, 262, 0, 5, t + 2, K.lantern);
    for (const [x, y] of [[30, 214], [150, 214], [812, 196]]) KIT.banner(buf, x - cam, y, 26, t, K.cloth, K.clothMark, KIT.WOOD.post);
    // Poissons qui sèchent sur une corde
    for (let s = 0; s <= 1; s += 0.02) buf.px(60 + s * 70 - cam, 222 + 6 * 4 * s * (1 - s), K.rig);
    for (let i = 1; i < 6; i++) {
      const s = i / 6, x = 60 + s * 70 - cam, y = 222 + 24 * s * (1 - s), sw = fsin(t * 2 + i) * 1.2;
      buf.rect(x + sw, y + 1, 2, 6, K.fish); buf.px(x + sw, y + 7, K.fishDk); buf.px(x + sw + 1, y + 1, K.fishDk);
    }
    // Flammes de guidon sur les haubans
    for (let i = 1; i < 7; i++) {
      const s = i / 7, x = 599 + (458 - 599) * s - cam, y = 22 + (250 - 22) * s;
      const fl = Math.round(fsin(t * 7 + i) * 1.5);
      buf.poly([x, y, x - 5, y + 2 + fl, x, y + 4], i % 2 ? K.pennant : K.cloth);
    }
    // Écume contre la coque, éclaboussures de pluie, gouttes sous les bras de grue
    for (let x = 492; x < 716; x += 3) if (fsin(x * 0.3 + t * 3) > 0.2) buf.px(x - cam, 302 + (fsin(x * 0.7 + t * 2) > 0.5 ? 1 : 0), K.foam);
    const decks = [[0, 300, 250], [300, 480, 292], [470, 730, 262], [760, 960, 231]];
    for (let i = 0; i < 44; i++) {
      const dk = decks[i % 4], ph = (t * 1.4 + hash2(i, 0, 7)) % 1;
      if (ph > 0.14) continue;
      const x = dk[0] + hash2(i, Math.floor(t * 1.4 + hash2(i, 0, 7)), 8) * (dk[1] - dk[0]) - cam, y = dk[2] - 1;
      buf.px(x - 1, y - 1, K.rainNear); buf.px(x + 1, y - 1, K.rainNear); buf.px(x, y, K.foamHi);
    }
    for (const [ax, ay] of [[200, 39], [230, 39], [410, 40], [800, 37]]) {
      const ph = (t * 0.8 + ax * 0.01) % 1;
      buf.px(ax - cam, ay + ph * 190, K.rainNear);
    }
  }

  G.SCENES = G.SCENES || [];
  G.SCENES.push({
    id: 'port',
    create() {
      const sky = new Buf(W, H), skyF = new Buf(W, H);
      sky.vgrad(0, 212, K.sky); skyF.vgrad(0, 212, K.skyF);
      const cFar = KIT.clouds(11, 768, 80, 0.5, K.cloud, null), cNear = KIT.clouds(23, 768, 90, 0.55, K.cloud, K.cloudLit);
      const far = farLayer(K.far, K.farRim), farF = farLayer(K.farF, K.farFRim);
      const play = playLayer();
      const actor = new Actor({
        anchors: [{ x: 180, y: 60, L: 88 }, { x: 400, y: 58, L: 86 }, { x: 585, y: 58, L: 90 }, { x: 790, y: 54, L: 90 }],
        order: [0, 1, 2, 3, 2, 1], bottom: 330, worldW: 960, rim: C('#a9c2ee'), halo: C('#3a5478'), wind: 30,
      });
      const cam = new KIT.Cam(960), fx = new Particles(), st = { lastSlam: -1 };
      return {
        frame(buf, t, dt, mode) {
          actor.update(dt);
          const cx = cam.update(actor, dt);
          const ph = t % 7.3, flash = ph < 0.09 || (ph > 0.17 && ph < 0.24);
          if (mode === 'play') buf.clear(K.flat);
          else {
            buf.blit(flash ? skyF : sky, 0, 0);
            buf.blitWrap(cFar, -t * 4 - cx * 0.05, 6);
            if (flash) bolt(buf, t, cx);
            buf.blitWrap(cNear, -t * 10 - cx * 0.12, 54);
            buf.blit(flash ? farF : far, -cx * 0.2, 0);
            gulls(buf, t, cx);
            boats(buf, t, cx);
            KIT.rain(buf, t, 240, 3, 180, K.rainFar, 1, null);
            umibozu(buf, t, cx, flash, actor.x - cx, fx, st);
            sea(buf, t, cx);
            const hx = 420 - cx * 0.3;
            for (let i = 0; i < 30; i++) {
              const x = hx + (i - 15) * 7 + fsin(t * 1.7 + i * 2.3) * 5, r = (fsin(t * 2.6 + i * 1.7) + 1) * 1.3;
              if (r > 0.6) buf.hline(x - r * 2, x + r * 2, 207 + fsin(i * 2.1) * 1.5, K.foam);
            }
            fx.update(dt); fx.draw(buf, 0);
          }
          buf.blit(play, -cx, 0);
          if (mode !== 'play') decor(buf, t, cx);
          drawEnemy(buf, 60 + 70 * (0.5 + 0.5 * Math.sin(t * 0.5)) - cx, 229, Math.cos(t * 0.5) < 0, t, true);
          drawEnemy(buf, 520 - cx, 241, false, t + 1, false);
          drawEnemy(buf, 868 - cx, 211, true, t + 2, false);
          actor.draw(buf, cx);
          if (mode !== 'play') {
            KIT.rain(buf, t, 70, 6, 280, K.rainNear, 2, { x: actor.x - cx, y: actor.y - 4 });
            for (const bx of [40, 600]) {
              const x = ((bx - cx * 1.25) % 760 + 760) % 760 - 60;
              buf.rect(x, 322, 12, 38, K.fg); buf.rect(x - 2, 320, 16, 4, K.fg);
            }
          }
          return actor.hud();
        },
      };
    },
    palette: [
      ['Ciel d\'orage', '#142037'], ['Umibozu', '#0d1320'], ['Écume', '#9db5cc'],
      ['Bois accrochable', '#c48a54'], ['Laque du torii', '#a8342a'], ['Pierre lisse (=)', '#4a6d91'],
    ],
  });
})(window);
