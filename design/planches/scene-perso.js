/* Planche 4 : le samouraï en gros plan (monde de 160 x 90 agrandi x4 dans le cadre, soit x8 à l'écran). */
(function (G) {
  'use strict';
  const { W, H, C, Buf, fsin } = G.PX;
  const { Actor } = G.HERO;
  const SW = 160, SH = 90, Z = 4;

  G.SCENES = G.SCENES || [];
  G.SCENES.push({
    id: 'perso',
    create() {
      const bg = new Buf(SW, SH);
      bg.vgrad(0, SH, ['#1a1f2e', '#20273a', '#262f45'].map(C));
      for (let x = 4; x < SW; x += 8) for (let y = 4; y < SH; y += 8) bg.px(x, y, C('#2e3752'));
      const beamC = C('#4a2f1c'), beamTop = C('#c48a54');
      const small = new Buf(SW, SH);
      const actor = new Actor({
        anchors: [{ x: 46, y: 22, L: 36 }, { x: 114, y: 22, L: 36 }],
        order: [0, 1], bottom: 88, worldW: SW, rim: C('#a9c2ee'), halo: null, wind: 25, jetFree: true,
      });
      return {
        frame(buf, t, dt, mode) {
          actor.update(dt);
          if (mode === 'play') small.clear(C('#10131b')); else small.blit(bg, 0, 0);
          small.rect(20, 16, 120, 4, beamC); small.hline(20, 139, 16, beamTop);
          for (const x of [46, 114]) { small.px(x, 20, C('#9aa3b2')); small.px(x, 21, C('#9aa3b2')); }
          small.rect(0, 84, SW, 6, beamC); small.hline(0, SW - 1, 84, beamTop);
          actor.draw(small, 0);
          const d = buf.d, s = small.d;
          for (let y = 0; y < H; y++) {
            const sy = Math.min(SH - 1, (y / Z) | 0), o = y * W, so = sy * SW;
            for (let x = 0; x < W; x++) d[o + x] = s[so + Math.min(SW - 1, (x / Z) | 0)];
          }
          return actor.hud();
        },
      };
    },
    palette: [
      ['Écharpe, tongs (réservé J1)', '#4fd1ff'], ['Armure', '#30447a'], ['Liseré de lumière', '#a9c2ee'],
      ['Casque', '#3a4258'], ['Kuwagata (cimier)', '#f0bf55'], ['Flamme du jet', '#ffd166'],
    ],
  });
})(window);
