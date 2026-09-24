/* Niveau 3 : Bambouseraie maudite (640 x 360, monde de 960 px). */
(function (G) {
  'use strict';
  const { W, H, C, Buf, fbm, hash2, dith, fsin } = G.PX;
  const { Actor, drawEnemy } = G.HERO;
  const KIT = G.KIT;

  const K = {
    sky: ['#070a1f', '#0c1230', '#121b44', '#1b2656', '#26306a'].map(C),
    star: C('#cfd6ff'), moon: C('#f1e7c8'), moonShade: C('#cbbf9e'), halo: C('#b9b4e6'),
    cloud: [C('#182050'), C('#222b60'), C('#2a3470')], cloudLit: C('#4a538a'),
    mount: C('#141a3a'), mountRim: C('#262e5e'), fall: C('#6a78b0'), fallHi: C('#a8b4e0'),
    bFar: C('#10162f'), bFarNode: C('#0a0f22'),
    stalk: C('#1b3136'), stalkLit: C('#3a6461'), node: C('#0f1f22'), leaf: C('#1f3d3a'), leafLit: C('#2f5a50'),
    dragon: C('#2f6b58'), dragonLit: C('#4a9178'), dragonDk: C('#1e4a3d'), belly: C('#a8893f'), fin: C('#c9a24a'), antler: C('#d9c89a'), dEye: C('#ffe38a'),
    stone: { rock: C('#3a4052'), dk: C('#2a2f3e'), lt: C('#4c5468'), top: C('#6f9a55'), moss: C('#3d5e36') },
    mortar: C('#1e2230'), stoneHi: C('#5a6378'),
    lacq: C('#141220'), gloss: C('#5a5a96'), lacqTop: C('#8a8ac4'),
    rope: C('#8a6a45'), plank: C('#5a4128'), plankTop: C('#a07a4a'), paper: C('#e8e0cf'), ink: C('#a8342a'),
    lantern: C('#ffd98a'), lanternGlow: C('#ffb347'), jizo: C('#6a6f80'), jizoHi: C('#8a90a2'), bib: C('#a8342a'),
    thorn: C('#9fb58a'), thornHi: C('#d2e2b8'),
    pine: C('#2a2420'), pineHi: C('#4a3e34'), needle: C('#1d3a30'), needleLit: C('#32584a'),
    vine: C('#2f5a3a'), vineLit: C('#4f8a4a'), wisp: C('#efe4ff'), wispTrail: C('#9a7ad0'),
    fog: ['#2a1745', '#3f2266', '#5a3288'].map(C), firefly: C('#e8f59a'), fg: C('#04050d'), flat: C('#0f1120'),
  };

  function fogStrip(seed, w, h) {
    const b = new Buf(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = fbm(x / 40, y / 13, seed, w / 40) + (y / h) * 0.5 - 0.25;
      if (n > 0.72) b.d[y * w + x] = K.fog[2];
      else if (n > 0.6) b.d[y * w + x] = K.fog[1];
      else if (n > 0.5) b.d[y * w + x] = dith(x, y, 0, K.fog[0], (n - 0.5) * 8);
    }
    return b;
  }

  function farLayer() {
    const b = new Buf(720, H);
    b.poly([0, 280, 0, 170, 60, 150, 130, 166, 200, 130, 280, 150, 360, 118, 440, 140, 520, 110, 600, 132, 720, 120, 720, 280], K.mount);
    for (let i = 0; i < 3; i++) { const y = 96 + i * 7, hw = 7 + i * 3; b.poly([520 - hw, y + 5, 520 + hw, y + 5, 520 + hw - 3, y, 520 - hw + 3, y], K.mount); }
    b.rect(519, 90, 2, 6, K.mount);
    for (let y = 1; y < H; y++) for (let x = 0; x < 720; x++) { const i = y * 720 + x; if (b.d[i] === K.mount && !b.d[i - 720]) b.d[i] = K.mountRim; }
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(hash2(i, 0, 21) * 720), top = 60 + hash2(i, 1, 21) * 80;
      b.rect(x, top, 2, H - top, K.bFar);
      for (let y = top + 16; y < H; y += 18 + (i % 4)) b.hline(x - 1, x + 2, y, K.bFarNode);
    }
    return b;
  }

  function stoneBlock(b, x, y, w, h) {
    KIT.rockMass(b, [x, y + h, x, y + 2, x + 3, y, x + w - 3, y, x + w, y + 2, x + w, y + h], K.stone);
    for (let r = 0, yy = y + 6; yy < y + h; yy += 9, r++) {
      for (let xx = x; xx < x + w; xx++) if (b.get(xx, yy) === K.stone.rock || b.get(xx, yy) === K.stone.lt) b.px(xx, yy, K.mortar);
      for (let xx = x + ((r & 1) ? 7 : 0); xx < x + w; xx += 16) b.rect(xx, yy - 8, 1, 8, K.mortar);
    }
    for (let i = 0; i < w; i++) if (hash2(x + i, y, 5) > 0.7) b.rect(x + i, y + 2, 1, 1 + Math.floor(hash2(i, y, 6) * 6), K.stone.moss);
  }

  function playLayer() {
    const b = new Buf(960, H);
    stoneBlock(b, 0, 250, 196, 110);
    // Torii de pierre en ruine (A)
    stoneBlock(b, 100, 58, 12, 192); stoneBlock(b, 250, 58, 12, 192);
    stoneBlock(b, 84, 40, 194, 9); stoneBlock(b, 94, 56, 174, 6);
    b.rect(262, 36, 16, 5, 0);
    // Deux bambous géants et leur shimenawa (B)
    for (const x of [318, 458]) {
      b.rect(x, 0, 12, 290, K.stalk); b.rect(x, 0, 2, 290, K.stalkLit); b.rect(x + 9, 0, 3, 290, K.node);
      for (let y = 20; y < 290; y += 38) { b.rect(x - 1, y, 14, 3, K.node); b.hline(x - 1, x + 12, y, K.stalkLit); }
    }
    KIT.beam(b, 318, 470, 48, 5, { post: K.plank, top: K.plankTop, dark: C('#2e2014') });
    stoneBlock(b, 300, 290, 190, 70);
    // Portail de sanctuaire en ruine (C)
    stoneBlock(b, 520, 70, 10, 206); stoneBlock(b, 656, 70, 10, 206);
    b.poly([500, 60, 686, 60, 672, 44, 514, 44], C('#1c1a28')); b.hline(500, 685, 60, K.stoneHi);
    b.rect(520, 60, 146, 6, K.plank); b.hline(520, 665, 60, K.plankTop);
    stoneBlock(b, 500, 276, 190, 84);
    // Falaise droite, panneau laqué lisse, pin tordu (D)
    stoneBlock(b, 700, 240, 260, 120);
    KIT.slick(b, 690, 240, 10, 120, K.lacq, K.gloss, K.lacqTop);
    b.poly([884, 240, 900, 240, 896, 150, 904, 90, 894, 60, 880, 90, 886, 150], K.pine);
    b.stroke(890, 70, 800, 50, 5, K.pine); b.stroke(890, 70, 800, 50, 1, K.pineHi);
    b.stroke(860, 62, 830, 36, 3, K.pine); b.stroke(896, 120, 930, 96, 3, K.pine);
    for (const [cx, cy, r] of [[806, 44, 12], [836, 30, 12], [872, 52, 14], [930, 90, 14], [900, 40, 12]]) {
      for (let k = 0; k < 60; k++) {
        const a = hash2(k, cx, 2) * Math.PI * 2, d = Math.sqrt(hash2(k, cy, 3)) * r;
        const x = cx + Math.cos(a) * d * 1.4, y = cy + Math.sin(a) * d * 0.6;
        b.stroke(x - 2, y, x + 2, y - 1, 1, y < cy ? K.needleLit : K.needle);
      }
    }
    // Jizo, lanternes de pierre, offrandes
    for (const [x, y] of [[40, 250], [58, 250], [760, 240]]) {
      b.rect(x, y - 12, 8, 12, K.jizo); b.disc(x + 4, y - 15, 3.5, K.jizo); b.px(x + 2, y - 17, K.jizoHi);
      b.rect(x, y - 10, 8, 4, K.bib); b.hline(x, x + 7, y - 10, C('#d9574a'));
    }
    for (const [x, y] of [[150, 250], [820, 240]]) {
      b.rect(x - 1, y - 20, 12, 3, K.stoneHi); b.rect(x, y - 17, 10, 6, K.stone.rock);
      b.rect(x + 3, y - 11, 4, 8, K.stone.rock); b.rect(x, y - 3, 10, 3, K.stone.lt);
    }
    return b;
  }

  function spikesLayer() {
    const b = new Buf(960, H);
    KIT.stakes(b, 196, 296, 352, K.thorn, K.thornHi, C('#d94848'), 14);
    KIT.stakes(b, 490, 500, 352, K.thorn, K.thornHi, C('#d94848'), 14);
    return b;
  }

  function bamboo(buf, t, cam, front) {
    const n = front ? 2 : 16;
    for (let i = 0; i < n; i++) {
      const bx = hash2(i, 0, 31) * 900 - cam * 0.7;
      const x0 = front ? (i === 0 ? 6 : 622) - cam * 0.3 : ((bx % 900) + 900) % 900 - 60;
      const top = front ? -10 : 10 + hash2(i, 1, 31) * 60, w = front ? 7 : 4, ph = t * 0.9 + i * 1.3;
      for (let y = Math.floor(top); y < H; y++) {
        const k = (H - y) / H;
        const x = Math.round(x0 + fsin(ph) * k * k * 9 + fsin(ph * 2.3) * k * 1.5);
        if (front) {
          const nd = (y + 400) % 34 < 2;
          buf.hline(x, x + w - 1, y, nd ? C('#141c30') : K.fg);
          buf.px(x + w - 1, y, nd ? C('#1f2a44') : C('#101829'));
          continue;
        }
        const node = (y - Math.floor(top)) % 22 === 0;
        buf.px(x, y, node ? K.node : K.stalkLit);
        buf.hline(x + 1, x + w - 1, y, node ? K.node : K.stalk);
      }
      if (!front) {
        const x = x0 + fsin(ph) * 9;
        for (let l = 0; l < 9; l++) {
          const lx = x + (l - 4) * 3, ly = top + 5 + (l % 3) * 4, d = l < 4 ? -1 : 1;
          const fl = fsin(t * 3 + l + i) * 0.6;
          for (let q = 0; q < 8; q++) buf.px(lx + d * q, ly + q * (0.55 + fl * 0.1), q < 3 ? K.leafLit : K.leaf);
        }
      }
    }
  }

  function dragon(buf, t, cam) {
    const hx = ((t * 18 + 420) % 1100) - 250 - cam * 0.2;
    const seg = [];
    for (let s = 0; s < 62; s++) {
      const x = hx - s * 5.2, y = 104 + fsin(t * 1.2 - s * 0.24) * 14 + fsin(s * 0.1 + t * 0.3) * 5;
      seg.push(x, y, s < 3 ? 7 : 6.5 * (1 - s / 70) + 1.3);
    }
    for (let i = 0; i < 6; i++) {
      const s = 40 + i * 4, age = (t * 0.8 + i * 0.17) % 1;
      if (seg[s * 3] !== undefined) buf.disc(seg[s * 3] - age * 20, seg[s * 3 + 1] + 6, 2 + age * 5, K.cloud[1]);
    }
    for (const s of [12, 20, 38, 46]) {
      const x = seg[s * 3], y = seg[s * 3 + 1], sw = fsin(t * 4 + s) * 3;
      buf.stroke(x, y + 4, x - 3 + sw, y + 11, 2, K.dragonDk);
      buf.px(x - 4 + sw, y + 12, K.antler); buf.px(x - 2 + sw, y + 12, K.antler);
    }
    for (let i = seg.length - 3; i >= 0; i -= 3) buf.disc(seg[i], seg[i + 1] + 2, seg[i + 2] * 0.8, K.belly);
    for (let i = seg.length - 3; i >= 0; i -= 3) {
      const s = i / 3;
      buf.disc(seg[i], seg[i + 1] - 0.5, seg[i + 2], K.dragon);
      buf.px(seg[i], seg[i + 1] - seg[i + 2], K.dragonLit);
      if (s % 2 === 0) buf.px(seg[i] - 1, seg[i + 1] - 1, K.dragonDk);
      if (s % 3 === 1) { buf.px(seg[i], seg[i + 1] - seg[i + 2] - 1, K.fin); buf.px(seg[i] - 1, seg[i + 1] - seg[i + 2] - 2, K.fin); }
    }
    const tx = seg[seg.length - 3], ty = seg[seg.length - 2];
    for (let k = 0; k < 6; k++) buf.px(tx - 2 - k, ty + fsin(t * 5 + k) * 2 - k * 0.3, K.fin);
    const x = seg[0], y = seg[1], jaw = (fsin(t * 1.7) + 1) * 1.5;
    buf.ellipse(x + 5, y - 2, 8, 5, K.dragon);
    buf.poly([x + 8, y - 4, x + 18, y - 3, x + 17, y + 1, x + 8, y + 1], K.dragon);
    buf.poly([x + 8, y + 2 + jaw * 0.3, x + 16, y + 2 + jaw, x + 8, y + 5 + jaw * 0.5], K.dragonDk);
    buf.hline(x + 1, x + 16, y - 6, K.dragonLit);
    buf.px(x + 18, y - 2, K.antler); buf.px(x + 16, y + 2 + jaw, K.antler);
    buf.stroke(x + 2, y - 6, x - 6, y - 16, 1, K.antler); buf.stroke(x - 3, y - 11, x - 1, y - 16, 1, K.antler);
    buf.stroke(x + 5, y - 6, x, y - 17, 1, K.antler);
    for (let k = 0; k < 8; k++) buf.stroke(x - 1 - k * 2, y - 4 + fsin(t * 3 + k) * 1.5, x - 3 - k * 2, y - 8 - fsin(t * 4 + k) * 2, 1, K.fin);
    buf.px(x + 8, y - 3, K.dEye); buf.glow(x + 8, y - 3, 6, K.dEye, 0.4);
    for (const side of [0, 1]) for (let k = 0; k < 20; k++) {
      buf.px(x + 16 - k, y + 1 + side * 2 + fsin(t * 3 + k * 0.4 + side) * 2.5 + k * 0.25, K.antler);
    }
  }

  function decor(buf, t, cam) {
    for (let x = 318; x <= 470; x += 2) { const s = (x - 318) / 152; buf.px(x - cam, 56 + 10 * 4 * s * (1 - s), K.rope); buf.px(x - cam, 57 + 10 * 4 * s * (1 - s), K.rope); }
    for (let i = 1; i < 6; i++) {
      const s = i / 6, x = 318 + s * 152 - cam, y = 58 + 40 * s * (1 - s), sw = Math.round(fsin(t * 3 + i) * 1.5);
      for (let j = 0; j < 9; j++) buf.px(x + sw * (j / 9) + ((j >> 1) & 1), y + j, K.paper);
      buf.px(x + sw * 0.5, y + 4, K.ink);
    }
    for (const [vx, vy, len] of [[120, 62, 30], [230, 62, 44], [540, 66, 26], [640, 66, 38], [812, 54, 24]]) {
      for (let j = 0; j < len; j++) {
        const x = vx + fsin(t * 1.4 + vx + j * 0.12) * (j / len) * 4 - cam;
        buf.px(x, vy + j, j % 5 === 0 ? K.vineLit : K.vine);
        if (j % 6 === 3) buf.px(x + 1, vy + j, K.vineLit);
      }
    }
    for (const [x, y] of [[155, 236], [825, 226]]) { buf.glow(x - cam, y, 12, K.lanternGlow, 0.45 + fsin(t * 8 + x) * 0.05); buf.rect(x - 1 - cam, y - 1, 3, 3, K.lantern); }
    for (let i = 0; i < 4; i++) {
      const bx = [70, 420, 600, 880][i], by = 200 + fsin(t * 1.3 + i * 2) * 8, x = bx + fsin(t * 0.7 + i) * 12 - cam;
      for (let k = 1; k < 7; k++) buf.px(x - fsin(t * 2 + i) * k * 0.6, by + k * 1.5, K.wispTrail);
      buf.glow(x, by, 9, K.wispTrail, 0.4);
      buf.disc(x, by, 2, K.wisp); buf.px(x, by - 3 - (fsin(t * 9 + i) > 0 ? 1 : 0), K.wisp);
    }
  }

  G.SCENES = G.SCENES || [];
  G.SCENES.push({
    id: 'bambou',
    create() {
      const sky = new Buf(W, H);
      sky.vgrad(0, 300, K.sky);
      sky.rect(0, 300, W, 60, K.sky[4]);
      const cl = KIT.clouds(51, 768, 50, 0.52, K.cloud, K.cloudLit), far = farLayer(), play = playLayer(), spikes = spikesLayer();
      const fogA = fogStrip(61, 768, 80), fogB = fogStrip(67, 768, 70);
      const actor = new Actor({
        anchors: [{ x: 175, y: 64, L: 88 }, { x: 390, y: 56, L: 86 }, { x: 590, y: 68, L: 90 }, { x: 800, y: 56, L: 90 }],
        order: [0, 1, 2, 3, 2, 1], bottom: 320, worldW: 960, rim: C('#c9c3f0'), halo: C('#34407a'), wind: 20,
      });
      const cam = new KIT.Cam(960);
      return {
        frame(buf, t, dt, mode) {
          actor.update(dt);
          const cx = cam.update(actor, dt);
          if (mode === 'play') buf.clear(K.flat);
          else {
            buf.blit(sky, 0, 0);
            for (let i = 0; i < 170; i++) {
              const x = hash2(i, 0, 71) * W, y = hash2(i, 1, 71) * 200;
              if (fsin(t * (1 + hash2(i, 2, 71) * 3) + i) > -0.3) buf.px(x, y, i % 9 === 0 ? K.moon : K.star);
            }
            const sq = (t % 11) / 11;
            if (sq < 0.08) { const q = sq / 0.08; for (let k = 0; k < 12; k++) buf.px(120 + q * 180 - k * 2, 30 + q * 50 - k * 0.55, k < 3 ? K.moon : K.star); }
            const mx = 470 - cx * 0.03, my = 60;
            buf.glow(mx, my, 50, K.halo, 0.26);
            for (let y = -22; y <= 22; y++) for (let x = -22; x <= 22; x++) {
              if (x * x + y * y > 484) continue;
              if ((x + 9) * (x + 9) + (y + 6) * (y + 6) < 380) continue;
              buf.px(mx + x, my + y, x > 10 ? K.moonShade : K.moon);
            }
            buf.blitWrap(cl, -t * 5 - cx * 0.08, 70);
            dragon(buf, t, cx);
            buf.blit(far, -cx * 0.12, 0);
            const fx = 296 - cx * 0.12;
            for (let y = 150; y < 250; y++) for (let k = 0; k < 3; k++) {
              if (fsin(y * 0.5 - t * 9 + k * 2) > 0.1) buf.px(fx + k, y, k === 1 ? K.fallHi : K.fall);
            }
            bamboo(buf, t, cx, false);
            buf.blitWrap(fogB, t * 6 - cx * 0.6, 236);
            for (let i = 0; i < 40; i++) {
              const x = ((hash2(i, 0, 81) * 700 - cx * 0.8) % 700 + 700) % 700 - 30 + fsin(t * 0.7 + i) * 18;
              const y = 110 + hash2(i, 1, 81) * 190 + fsin(t * 1.1 + i * 2) * 8;
              if (fsin(t * 2.3 + i * 1.7) > 0.2) { buf.glow(x, y, 5, K.firefly, 0.5); buf.px(x, y, K.firefly); }
            }
            for (let i = 0; i < 36; i++) {
              const v = 14 + hash2(i, 1, 91) * 14, y = ((t * v + hash2(i, 2, 91) * 400) % 400) - 20;
              const x = ((hash2(i, 3, 91) * 720 - cx * 0.9 + fsin(t * 1.3 + i) * 14 + t * 8) % 720 + 720) % 720 - 40;
              const flip = fsin(t * 4 + i) > 0;
              buf.px(x, y, K.leafLit); buf.px(x + (flip ? 1 : -1), y + 1, K.leaf); buf.px(x + (flip ? 2 : -2), y + 1, K.leaf);
            }
          }
          buf.blit(play, -cx, 0);
          if (mode !== 'play') { decor(buf, t, cx); buf.blitWrap(fogA, -t * 9 - cx, 286); }
          buf.blit(spikes, -cx, 0);
          drawEnemy(buf, 88 + 24 * (1 + Math.sin(t * 0.5)) - cx, 229, Math.cos(t * 0.5) < 0, t, true);
          drawEnemy(buf, 740 + 40 * (1 + Math.sin(t * 0.4 + 1)) - cx, 219, Math.cos(t * 0.4 + 1) < 0, t + 2, true);
          drawEnemy(buf, 560 - cx, 255, true, t + 1, false);
          actor.draw(buf, cx);
          if (mode !== 'play') bamboo(buf, t, cx, true);
          return actor.hud();
        },
      };
    },
    palette: [
      ['Nuit', '#121b44'], ['Ryū de jade', '#2f6b58'], ['Brume maudite', '#3f2266'],
      ['Mousse accrochable', '#6f9a55'], ['Laque lisse (=)', '#5a5a96'], ['Épines mortelles', '#9fb58a'],
    ],
  });
})(window);
