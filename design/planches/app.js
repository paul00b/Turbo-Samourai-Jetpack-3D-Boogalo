/* Boucle des planches : une instance de scène par cadre, rendu seulement quand le cadre est visible. */
(function () {
  'use strict';
  const { W, H, Buf } = window.PX;
  const HELP = {
    game: 'Rendu final, toutes couches.',
    values: 'Six niveaux de gris. Le perso doit rester la forme la plus nette.',
    play: 'Décor coupé : ce qui reste est tout ce qui compte pour jouer.',
  };
  const LABEL = { game: '', values: 'VALEURS', play: 'COUCHE DE JEU' };
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }
  let playing = !reduce;
  const views = [];

  function fmt(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s * 100) % 100);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  function render(v, dt) {
    try {
      const r = v.inst.frame(v.buf, v.t, dt, v.mode === 'play' ? 'play' : 'game');
      if (v.mode === 'values') v.buf.gray(6);
      v.ctx.putImageData(v.img, 0, 0);
      v.hudAcc += dt;
      if (v.hudAcc >= 0.08 || dt === 0) {
        v.hudAcc = 0;
        const sp = Math.round(r.speed);
        if (v.speed) v.speed.textContent = String(sp);
        if (v.speed) { v.speed.classList.toggle('lethal', sp > 1800); v.speed.classList.toggle('killer', sp >= 450 && sp <= 1800); }
        v.heat.style.width = `${Math.round(r.heat * 100)}%`;
        v.heat.classList.toggle('over', r.over);
        v.heat.classList.toggle('hot', !r.over && r.heat > 0.75);
        v.heatLabel.textContent = r.over ? 'SURCHAUFFE' : `CHAUFFE ${Math.round(r.heat * 100)}%`;
        if (v.chrono) v.chrono.textContent = fmt(v.t);
        if (v.deaths && r.deaths !== undefined) v.deaths.textContent = `☠ ${r.deaths}`;
        if (v.phase && r.phase) v.phase.textContent = r.phase;
      }
    } catch (e) {
      v.failed = true;
      const d = document.createElement('div');
      d.className = 'frame-error';
      d.textContent = `Cette planche n'a pas pu se dessiner : ${e.message}`;
      v.frame.append(d);
    }
  }

  function setMode(v, mode) {
    v.mode = mode;
    v.el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    v.help.textContent = HELP[mode];
    v.modeLabel.textContent = LABEL[mode];
    v.modeLabel.hidden = !LABEL[mode];
    if (!playing && !v.failed) render(v, 0);
  }

  document.querySelectorAll('[data-scene]').forEach((el, i) => {
    const def = (window.SCENES || []).find((s) => s.id === el.dataset.scene);
    if (!def) return;
    const frame = el.querySelector('.frame');
    const canvas = el.querySelector('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const v = {
      el, frame, def, ctx, img,
      buf: new Buf(W, H, new Uint32Array(img.data.buffer)),
      inst: def.create(),
      t: 4 + i * 2.3, mode: 'game', visible: true, failed: false, hudAcc: 0,
      speed: el.querySelector('[data-speed]'), heat: el.querySelector('[data-heat]'),
      heatLabel: el.querySelector('[data-heat-label]'), chrono: el.querySelector('[data-chrono]'),
      deaths: el.querySelector('[data-deaths]'), phase: el.querySelector('[data-phase]'),
      help: el.querySelector('[data-mode-help]'), modeLabel: el.querySelector('[data-mode-label]'),
    };
    const pal = el.querySelector('[data-palette]');
    for (const [name, hex] of def.palette) {
      const li = document.createElement('li');
      const sw = document.createElement('i'); sw.style.background = hex;
      const n = document.createElement('span'); n.textContent = name;
      const c = document.createElement('code'); c.textContent = hex;
      li.append(sw, n, c);
      pal.append(li);
    }
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(v, b.dataset.mode)));
    setMode(v, 'game');
    for (let k = 0; k < 150 + i * 23; k++) { v.t += 1 / 60; v.inst.frame(v.buf, v.t, 1 / 60, 'game'); }
    render(v, 0);
    views.push(v);
  });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = views.find((x) => x.frame === e.target);
        if (v) v.visible = e.isIntersecting;
      }
    }, { rootMargin: '120px' });
    views.forEach((v) => io.observe(v.frame));
  }

  const btn = document.getElementById('toggle-anim');
  const syncBtn = () => { btn.textContent = playing ? 'Mettre en pause' : "Lancer l'animation"; };
  btn.addEventListener('click', () => { playing = !playing; syncBtn(); });
  syncBtn();

  let last = -1;
  function loop(now) {
    const dt = last < 0 ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing) {
      for (const v of views) {
        if (!v.visible || v.failed) continue;
        v.t += dt;
        render(v, dt);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
