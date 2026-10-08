const SHAPES = {
  circle: 'circle(50%)',
  square: 'inset(0)',
  triangle: 'polygon(50% 4%,100% 96%,0 96%)',
  diamond: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
  hexagon: 'polygon(25% 3%,75% 3%,100% 50%,75% 97%,25% 97%,0 50%)',
  star: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)'
};
const COLORS = ['#ffffff', '#f0523f', '#ff8a3d', '#ffd23f', '#3bb54a', '#1fc8a9', '#2d9cdb', '#7b5cd6', '#ec4899', '#8b5a2b', '#9e9e9e', '#111111'];
const OPT = [{ c: '#f0523f', s: 'A' }, { c: '#1f9d8f', s: 'B' }, { c: '#d68a00', s: 'C' }, { c: '#7b5cd6', s: 'D' }];
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Avatar: figura + color elegidos, inicial centrada (letra blanca con borde negro)
const av = (p, s = 44) => `<span class="av" style="width:${s}px;height:${s}px;background:${p.color};-webkit-clip-path:${SHAPES[p.shape] || SHAPES.circle};clip-path:${SHAPES[p.shape] || SHAPES.circle};font-size:${Math.round(s * .5)}px">${esc([...(p.name || '?')][0] || '?').toUpperCase()}</span>`;

// Barra de tiempo (solo transform: barata para móviles lentos). ms = restante, tot = total
function barAnim(el, ms, tot) { if (!el) return; tot = tot || ms || 1; el.style.transition = 'none'; el.style.transform = `scaleX(${Math.min(1, ms / tot)})`; el.offsetWidth; el.style.transition = `transform ${ms}ms linear`; el.style.transform = 'scaleX(0)'; }
function confetti(n = 40) { const cs = ['#ffc93c', '#f0523f', '#2d9cdb', '#1f9d8f', '#fff', '#ff8a3d'], w = document.createElement('div'); w.className = 'cf';
  for (let i = 0; i < n; i++) { const e = document.createElement('i'); e.style.cssText = `left:${Math.random() * 100}%;background:${cs[i % 6]};animation-duration:${2.5 + Math.random() * 3}s;animation-delay:${Math.random() * 1.5}s`; w.appendChild(e); }
  document.body.appendChild(w); setTimeout(() => w.remove(), 9000); }

/* ---------- Sonido de clic (WebAudio, polifónico) ----------
   · El mp3 (2 KB) se descarga UNA vez (cache del navegador) y se decodifica en memoria: cada clic es local, no gasta red.
   · Cada reproducción es una fuente independiente → se pueden solapar muchas a la vez (host).
   · Si WebAudio falla, se usa <audio> como respaldo (solo cliente). */
const Snd = (() => {
  const SRC = 'buttonClickSong_V1.mp3', MAX = 40;           // MAX = voces simultáneas (protege CPU de equipos lentos)
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, buf = null, master = null, loading = false, voices = 0, cb = null, fbAudio = null;
  let on = true; try { on = localStorage.snd !== '0'; } catch (e) {}

  function init() {
    if (ctx || !AC) return;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();          // evita saturación cuando suenan muchos a la vez
      master = ctx.createGain(); master.gain.value = .9;
      master.connect(comp); comp.connect(ctx.destination);
      ctx.onstatechange = () => cb && cb(ctx.state === 'running');
    } catch (e) { ctx = null; }
  }
  function load() {
    if (buf || loading || !ctx) return;
    loading = true;
    fetch(SRC, { cache: 'force-cache' }).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(ab => new Promise((ok, no) => { const p = ctx.decodeAudioData(ab, ok, no); if (p && p.catch) p.catch(no); }))
      .then(b => { buf = b; loading = false; })
      .catch(() => { loading = false; setTimeout(load, 4000); });   // mala conexión: reintenta solo
  }
  function unlock() {                                        // hay que llamarlo desde un gesto del usuario
    init(); load();
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    if (ctx && ctx.state === 'running') ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(e => document.removeEventListener(e, unlock, true));
  }
  ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(e => document.addEventListener(e, unlock, { capture: true, passive: true }));
  init(); load();                                            // precarga apenas abre la página

  function voice(when, rate, gain) {
    if (voices >= MAX) return;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g); g.connect(master); voices++;
    s.onended = () => { voices--; s.disconnect(); g.disconnect(); };
    s.start(when);
  }
  function fallback() {
    try { if (!fbAudio) fbAudio = new Audio(SRC); fbAudio.currentTime = 0; const p = fbAudio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  return {
    // Un clic. opts.fb = permitir <audio> de respaldo (jugador). opts.vary = variar tono (host)
    play(opts = {}) {
      if (!on) return;
      if (!ctx) init();
      if (!ctx || !buf) { if (opts.fb) fallback(); load(); return; }
      if (ctx.state !== 'running') { ctx.resume().catch(() => {}); if (opts.fb) fallback(); return; }
      voice(0, opts.vary ? .94 + Math.random() * .14 : 1, 1);
    },
    // n clics casi simultáneos repartidos en `spread` ms (host: lote llegado del servidor)
    many(n, spread = 80) {
      if (!on || !ctx || !buf) return;
      if (ctx.state !== 'running') { ctx.resume().catch(() => {}); return; }
      n = Math.min(n, 24);
      const g = Math.min(1, 1.5 / Math.sqrt(n)), t0 = ctx.currentTime;
      for (let i = 0; i < n; i++) voice(t0 + Math.random() * spread / 1000, .92 + Math.random() * .16, g);
    },
    get on() { return on; },
    set on(v) { on = !!v; try { localStorage.snd = on ? '1' : '0'; } catch (e) {} },
    get running() { return !!ctx && ctx.state === 'running'; },
    onstate(f) { cb = f; }
  };
})();
