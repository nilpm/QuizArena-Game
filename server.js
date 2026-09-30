const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
/* ---------- rendimiento (pensado para servidores con muy poco CPU: 0.1 CPU / 512 MB) ----------
   - Sin compresión por mensaje: gastaba mucho CPU y los mensajes de los jugadores son diminutos.
   - Los archivos de /public se comprimen una sola vez al arrancar y se sirven desde memoria (fast-static.js).
   - El cliente de socket.io también se sirve precomprimido, en /sio.js (si se encuentra en node_modules).
     OJO: no puede ir bajo /socket.io/, esa ruta la intercepta la propia librería. */
const fastStatic = require('./fast-static');
let CLIENT_JS = null;
try { const f = path.join(path.dirname(require.resolve('socket.io')), '..', 'client-dist', 'socket.io.min.js'); if (fs.existsSync(f)) CLIENT_JS = f; } catch (e) { /* se usa el cliente integrado */ }
const io = new Server(server, { pingInterval: 10000, pingTimeout: 25000, perMessageDeflate: false, httpCompression: false });
app.use(fastStatic(path.join(__dirname, 'public'), CLIENT_JS ? { '/sio.js': CLIENT_JS } : {}));
if (!CLIENT_JS) app.get('/sio.js', (req, res) => res.redirect('/socket.io/socket.io.js'));   // respaldo: cliente integrado de socket.io
app.use(express.static(path.join(__dirname, 'public'), {   // respaldo: mp3/png (con soporte de "Range", que Safari necesita para el audio)
  etag: true,
  setHeaders: (res, f) => { if (/\.(mp3|png)$/i.test(f)) res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); }
}));

const PORT = process.env.PORT || 3000;
const PIN = process.env.HOST_PIN || '1212';           // opcional: protege /host.html
const QF = path.join(__dirname, 'questions.json');

/* ---------- utilidades ---------- */
const now = () => Date.now();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const lanIp = () => { for (const l of Object.values(os.networkInterfaces())) for (const i of l) if (i.family === 'IPv4' && !i.internal) return i.address; return 'localhost'; };
const publicUrl = () => process.env.PUBLIC_URL || `http://${lanIp()}:${PORT}`;
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'star'];

const BASE = 100, BONUS = 50;      // puntos por acierto / extra al primero en acertar esa pregunta
const T = process.env.FAST ? 0.1 : 1;   // FAST=1 acelera todos los tiempos (solo para pruebas)
const INTRO = 5000 * T;                // cuenta regresiva antes de cada combate
const GRACE = 20000 * T;               // tiempo para reconectar antes de perder por W.O.

const qrCache = { url: '', buf: null };
app.get('/qr.png', async (req, res) => {
  const u = publicUrl();
  if (qrCache.url !== u || !qrCache.buf) { qrCache.buf = await QRCode.toBuffer(u, { width: 420, margin: 1 }); qrCache.url = u; }
  res.type('png').set('Cache-Control', 'public, max-age=300').send(qrCache.buf);
});

/* ---------- preguntas ---------- */
let Q = {};
const loadQ = () => { try { Q = JSON.parse(fs.readFileSync(QF, 'utf8')); } catch (e) { Q = {}; } };
loadQ();
const poolTotal = () => Object.values(Q).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
function validateQ(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Debe ser un objeto: { "ronda1": [...], ... }');
  for (const [k, arr] of Object.entries(o)) {
    if (!Array.isArray(arr)) throw new Error(`"${k}" debe ser una lista`);
    arr.forEach((x, i) => {
      const w = `${k} #${i + 1}`;
      if (!x || typeof x.q !== 'string' || !x.q.trim()) throw new Error(`${w}: falta "q" (texto)`);
      if (!Array.isArray(x.o) || x.o.length < 2 || x.o.length > 4) throw new Error(`${w}: "o" debe tener de 2 a 4 opciones`);
      if (!Number.isInteger(x.a) || x.a < 0 || x.a >= x.o.length) throw new Error(`${w}: "a" debe ser el índice (0-${x.o.length - 1}) de la correcta`);
    });
  }
}
function pickQuestions(key, count) {
  let pool = shuffle([...(Q[key] || [])]);
  if (pool.length < count) pool = pool.concat(shuffle([...(Q.otras || [])]));
  if (!pool.length) pool = shuffle(Object.values(Q).flat());
  return pool.slice(0, count);
}

/* ---------- estado ---------- */
let G;
function reset(keepCfg, keepPlayers) {
  const cfg = keepCfg || { totalMin: 40, battleSec: 60, qCount: 5, topQSec: 15, prizes: ['', '', ''] };
  G = { phase: 'lobby', players: new Map(), stage: null, round: 0, history: [], queue: [], repPending: false,
        cfg, endAt: null, timeUp: false, roundTop: [], hq: null };
  (keepPlayers || []).forEach(p => G.players.set(p.id, { ...p, status: 'bracket', rscore: 0, total: 0, byes: 0, rank: null, last: null }));
}
reset();

const pub = p => ({ id: p.id, name: p.name, shape: p.shape, color: p.color, status: p.status, rscore: p.rscore, total: p.total, online: p.online, rank: p.rank });
const P = id => G.players.get(id);
const toP = (p, type, data = {}) => { if (p && p.bot) return botReact(p, type, data); if (p && p.sid) { const k = io.sockets.sockets.get(p.sid); if (k) k.emit('screen', { type, ...data }); } };
const matchOf = id => (G.stage && G.stage.mOf && G.stage.mOf.get(id)) || undefined;
const liveMatch = id => { const m = matchOf(id); return m && (m.state === 'intro' || m.state === 'live') ? m : undefined; };

function hostState() {
  const st = G.stage;
  return {
    phase: G.phase, cfg: G.cfg, timeUp: G.timeUp,
    leftMs: G.endAt ? Math.max(0, G.endAt - now()) : null,
    players: [...G.players.values()].map(pub),
    stage: st && {
      name: st.name, kind: st.kind, seq: !!st.seq, bye: st.bye,
      introMs: st.introEnd ? Math.max(0, st.introEnd - now()) : 0,
      matches: st.matches.map(m => ({ id: m.id, a: m.a, b: m.b, sa: m.score[m.a], sb: m.score[m.b], state: m.state, winner: m.winner, tie: m.tie }))
    },
    bots: (() => { let n = 0; G.players.forEach(p => { if (p.bot) n++; }); return n; })(),   // para el panel de bots del lobby
    history: G.history, roundTop: G.roundTop,
    hq: G.hq && { ...G.hq, endsMs: Math.max(0, G.hq.endsAt - now()) }
  };
}
// Sonido en el host: avisa de cada clic de respuesta, agrupados en lotes de 80 ms (1 mensaje de ~1 byte de datos, sin importar cuántos clics)
let clk = 0, clkT = null;
function hostClick() {
  clk++;
  if (clkT) return;
  clkT = setTimeout(() => { clkT = null; const n = clk; clk = 0; io.to('host').emit('clk', n); }, 80);
}
let ht = null;
// Con pocos jugadores el anfitrión se actualiza casi al instante; con muchos, se agrupan los cambios (hasta 0,6 s).
// Los momentos importantes (cambio de fase, semifinales/final, donde juegan solo 2) usan el envío rápido.
let htAt = 0;
const pushDelay = () => (G.stage && G.stage.seq) ? 100 : Math.min(600, 120 + Math.max(0, G.players.size - 30) * 4);
function pushHost(fast) {
  const d = fast ? 60 : pushDelay(), at = now() + d;
  if (ht) { if (at >= htAt) return; clearTimeout(ht); }   // ya hay un envío programado igual de pronto o antes
  htAt = at;
  ht = setTimeout(() => { ht = null; io.to('host').emit('state', hostState()); }, d);
}

/* ---------- pantalla de cada jugador según el estado ---------- */
const vsInfo = (m, id, ms) => ({ a: pub(P(m.a)), b: pub(P(m.b)), me: id, ms, host: !!m.host });
function syncPlayer(p) {
  if (!p.sid && !p.bot) return;
  const st = G.stage;
  if (G.phase === 'lobby') return toP(p, 'lobby');
  if (G.phase === 'finished') return toP(p, 'end', { rank: p.rank, prize: p.rank && p.rank <= 3 ? G.cfg.prizes[p.rank - 1] : '', total: p.total });
  if (G.phase === 'stageEnd' && p.last) return toP(p, 'result', p.last);
  if (!st) return toP(p, 'wait', { msg: 'Esperando…' });
  const m = matchOf(p.id);
  if (!m) return toP(p, 'wait', { msg: st.bye === p.id ? '😴 Descansas esta ronda: avanzas automáticamente' : (p.status === 'out' ? 'Ya no participas. ¡Mira la pantalla del anfitrión!' : 'Esperando la siguiente fase…') });
  if (m.state === 'intro') return toP(p, 'vs', vsInfo(m, p.id, Math.max(0, st.introEnd - now())));
  if (m.state === 'live') {
    if (!m.host) return sendQ(m, p.id);
    if (m.revealing || (m.ans && m.ans[p.id])) return toP(p, 'wait', { msg: 'Respuesta enviada ✔ Mira la pantalla del anfitrión', look: true });
    return toP(p, 'pad', { n: m.qIdx + 1, total: m.qs.length, count: m.qs[m.qIdx].o.length, ms: G.hq ? Math.max(0, G.hq.endsAt - now()) : 0, tot: G.cfg.topQSec * 1000 });
  }
  if (m.state === 'done') return toP(p, 'wait', { msg: m.winner === p.id ? '🏆 ¡Ganaste este combate! Esperando al resto…' : 'Combate terminado. Esperando al resto…' });
  return toP(p, 'wait', { msg: st.seq ? 'Prepárate: pronto juegas. Mira la pantalla del anfitrión 👀' : 'Tu combate empieza cuando el anfitrión inicie la ronda', look: !!st.seq });
}

/* ---------- planificación del torneo ---------- */
function planNext() {
  const by = s => [...G.players.values()].filter(p => p.status === s);
  if (G.queue.length) return G.queue.shift();
  if (G.repPending) {
    G.repPending = false;
    const rp = by('rep');
    if (rp.length) return { kind: 'rep', name: 'Repechaje', key: 'repechaje', ids: rp.map(p => p.id) };
  }
  const br = by('bracket'), n = br.length, ids = br.map(p => p.id);
  if (G.round === 0 || n > 4) { G.round++; return { kind: 'round', name: `Ronda ${G.round}`, key: `ronda${G.round}`, ids }; }
  if (n >= 3) return { kind: 'semi', name: 'Semifinales', key: 'final', seq: true, host: true, ids };
  if (n === 2) return { kind: 'final', name: '🏆 Final', key: 'final', seq: true, host: true, ids };
  return null;
}

function buildStage(plan) {
  let ps = plan.ids.map(P);
  shuffle(ps);
  let bye = null;
  if (ps.length % 2) {                                  // número impar → uno descansa (quien menos "byes" lleve)
    const min = Math.min(...ps.map(p => p.byes));
    const c = ps.filter(p => p.byes === min);
    bye = c[Math.floor(Math.random() * c.length)];
    ps.splice(ps.indexOf(bye), 1); bye.byes++;
  }
  const matches = [];
  for (let i = 0; i < ps.length; i += 2)
    matches.push({ id: matches.length, a: ps[i].id, b: ps[i + 1].id, state: 'pending', host: !!plan.host, score: { [ps[i].id]: 0, [ps[i + 1].id]: 0 } });
  const mOf = new Map(); matches.forEach(m => { mOf.set(m.a, m); mOf.set(m.b, m); });
  return { ...plan, no: plan.kind === 'round' ? G.round : 0, matches, mOf, bye: bye && bye.id };
}

function enterReady() {
  const plan = planNext();
  if (!plan) return finishByPoints();
  G.players.forEach(p => { p.last = null; p.rscore = 0; });
  G.stage = buildStage(plan);
  G.phase = 'ready';
  G.players.forEach(syncPlayer);
  pushHost(true);
}

function startRound() {
  const st = G.stage;
  if (!st || G.phase !== 'ready') return;
  let ms = st.seq ? [st.matches.find(m => m.state === 'pending')] : st.matches.filter(m => m.state === 'pending');
  ms = ms.filter(Boolean);
  if (!ms.length) return finishStage();
  G.phase = 'intro';
  st.introEnd = now() + INTRO;
  ms.forEach(startIntro);
  if (st.bye && !st.seq) toP(P(st.bye), 'wait', { msg: '😴 Descansas esta ronda: avanzas automáticamente' });
  st.timer = setTimeout(() => { G.phase = 'battle'; ms.forEach(beginBattle); pushHost(true); }, INTRO);
  pushHost(true);
}

function startIntro(m) {
  const st = G.stage;
  m.state = 'intro';
  m.qs = pickQuestions(st.key, G.cfg.qCount);
  m.first = {}; m.lastAt = { [m.a]: 0, [m.b]: 0 };
  const perms = () => m.qs.map(q => shuffle(q.o.map((_, i) => i)));
  if (m.host) m.hperm = perms();                        // top 4: mismo orden para ambos (se ve en la pantalla del host)
  else { m.P = {}; [m.a, m.b].forEach(id => { m.P[id] = { order: shuffle([...m.qs.keys()]), perm: perms(), i: 0 }; }); }
  [m.a, m.b].forEach(id => {
    const p = P(id); clearTimeout(p.wo);
    toP(p, 'vs', vsInfo(m, id, INTRO));
    if (!p.online) p.wo = setTimeout(() => { if (!p.online) endMatch(m, id); }, GRACE);
  });
}

function beginBattle(m) {
  if (m.state !== 'intro') return;
  m.state = 'live';
  if (m.host) { m.qIdx = 0; return nextHostQ(m); }
  const ms = G.cfg.battleSec * 1000;
  m.endsAt = now() + ms;
  m.timer = setTimeout(() => endMatch(m), ms + 300);
  sendQ(m, m.a); sendQ(m, m.b);
}

/* ---------- combate normal (cada uno en su dispositivo) ---------- */
function sendQ(m, pid) {
  if (m.state !== 'live') return;
  const P_ = m.P[pid], p = P(pid);
  if (P_.i >= m.qs.length) {
    toP(p, 'wait', { msg: '¡Terminaste! Esperando a tu rival…' });
    if ([m.a, m.b].every(id => m.P[id].i >= m.qs.length)) endMatch(m);
    return;
  }
  const qi = P_.order[P_.i], q = m.qs[qi];
  toP(p, 'question', { n: P_.i + 1, total: m.qs.length, text: q.q, opts: P_.perm[qi].map(k => q.o[k]), ms: Math.max(0, m.endsAt - now()), tot: G.cfg.battleSec * 1000, score: m.score[pid] });
}

function answer(p, idx) {
  const m = liveMatch(p.id);
  if (!m || m.state !== 'live' || G.phase !== 'battle') return;
  idx = +idx;
  if (m.host) return hostAnswer(m, p, idx);
  const S = m.P[p.id];
  if (S.i >= m.qs.length || S.busy) return;
  const qi = S.order[S.i], q = m.qs[qi];
  if (!(idx >= 0 && idx < q.o.length)) return;
  S.busy = true; hostClick();
  const ok = S.perm[qi][idx] === q.a;
  let pts = 0;
  if (ok) {
    pts = BASE;
    if (!m.first[qi]) { m.first[qi] = p.id; pts += BONUS; }   // el primero en acertar esa pregunta gana un extra
    m.score[p.id] += pts; m.lastAt[p.id] = now();
  }
  S.i++;
  toP(p, 'feedback', { ok, pts, correct: S.perm[qi].indexOf(q.a), chosen: idx, score: m.score[p.id] });
  setTimeout(() => { S.busy = false; sendQ(m, p.id); }, 900 * T);
  pushHost();
}

/* ---------- combate en la pantalla del host (semis, 3er puesto, final) ---------- */
function nextHostQ(m) {
  if (m.state !== 'live') return;
  if (m.qIdx >= m.qs.length) return endMatch(m);
  const q = m.qs[m.qIdx], perm = m.hperm[m.qIdx], ms = G.cfg.topQSec * 1000;
  m.ans = {}; m.revealing = false;
  G.hq = { n: m.qIdx + 1, total: m.qs.length, text: q.q, opts: perm.map(k => q.o[k]), endsAt: now() + ms, answered: [], reveal: null };
  [m.a, m.b].forEach(id => toP(P(id), 'pad', { n: m.qIdx + 1, total: m.qs.length, count: q.o.length, ms, tot: ms }));
  m.timer = setTimeout(() => revealHostQ(m), ms);
  pushHost();
}
function hostAnswer(m, p, idx) {
  if (m.revealing || m.ans[p.id]) return;
  const q = m.qs[m.qIdx];
  if (!(idx >= 0 && idx < q.o.length)) return;
  m.ans[p.id] = { idx, t: now() };
  G.hq.answered.push(p.id); hostClick();
  toP(p, 'wait', { msg: 'Respuesta enviada ✔ Mira la pantalla del anfitrión', look: true });
  pushHost();
  if (m.ans[m.a] && m.ans[m.b]) revealHostQ(m);
}
function revealHostQ(m) {
  if (m.revealing || m.state !== 'live') return;
  m.revealing = true; clearTimeout(m.timer);
  const q = m.qs[m.qIdx], perm = m.hperm[m.qIdx], res = {};
  [m.a, m.b].forEach(id => { const a = m.ans[id]; res[id] = { ok: !!a && perm[a.idx] === q.a, chosen: a ? a.idx : null, pts: 0, t: a ? a.t : 0 }; });
  [m.a, m.b].filter(id => res[id].ok).sort((x, y) => res[x].t - res[y].t).forEach((id, i) => {
    res[id].pts = BASE + (i === 0 ? BONUS : 0); m.score[id] += res[id].pts; m.lastAt[id] = res[id].t;
  });
  const correct = perm.indexOf(q.a);
  [m.a, m.b].forEach(id => toP(P(id), 'feedback', { ok: res[id].ok, pts: res[id].pts, correct, chosen: res[id].chosen, score: m.score[id], pad: true }));
  G.hq.reveal = { correct, res };
  m.timer = setTimeout(() => { m.qIdx++; nextHostQ(m); }, 3500 * T);
  pushHost();
}

/* ---------- fin de combate y de fase ---------- */
function endMatch(m, offlineId) {
  if (m.state === 'done') return;
  clearTimeout(m.timer);
  m.state = 'done';
  const A = m.a, B = m.b;
  let w;
  if (offlineId) w = offlineId === A ? B : A;                       // W.O.
  else if (m.score[A] !== m.score[B]) w = m.score[A] > m.score[B] ? A : B;
  else {                                                            // empate: gana quien sumó primero; si nadie sumó, azar
    const ta = m.lastAt[A] || Infinity, tb = m.lastAt[B] || Infinity;
    if (ta !== tb) { w = ta < tb ? A : B; m.tie = 'speed'; }
    else { w = Math.random() < .5 ? A : B; m.tie = 'coin'; }
  }
  m.winner = w; m.loser = w === A ? B : A;
  [A, B].forEach(id => { const p = P(id); p.rscore = m.score[id]; p.total += m.score[id]; clearTimeout(p.wo); });
  if (m.host) G.hq = null;
  [A, B].forEach(id => syncPlayer(P(id)));
  const st = G.stage;
  if (st.matches.every(x => x.state === 'done')) finishStage();
  else if (st.seq) G.phase = 'ready';                               // falta otro partido: el host lo inicia
  pushHost(G.phase !== 'battle');
}

function finishStage() {
  const st = G.stage, elim = [];
  sanity(st);
  const last = (p, cls, title, sub) => { p.last = { cls, title, sub }; };
  st.matches.forEach(m => {
    const w = P(m.winner), l = P(m.loser);
    if (st.kind === 'round') {
      if (st.no === 1) { l.status = 'rep'; last(w, 'win', '¡Ganaste!', 'Pasas a la siguiente ronda'); last(l, 'rep', 'Perdiste esta batalla', 'Tienes otra oportunidad en el Repechaje'); }
      else { l.status = 'out'; elim.push(l); last(w, 'win', '¡Ganaste!', 'Pasas a la siguiente ronda'); }
    } else if (st.kind === 'rep') {
      w.status = 'bracket'; l.status = 'out'; elim.push(l); last(w, 'win', '¡Sobreviviste al repechaje!', 'Vuelves al torneo');
    } else if (st.kind === 'semi') {
      last(w, 'win', '¡Ganaste la semifinal!', 'Pasas a la final');
      if (st.bye) { l.status = 'out'; l.rank = 3; last(l, 'out', 'Perdiste la semifinal', 'Terminaste en el Top 3'); }
      else { l.status = 'semi'; last(l, 'rep', 'Perdiste la semifinal', 'Juegas por el 3er lugar'); }
    } else if (st.kind === 'third') { w.rank = 3; l.rank = 4; w.status = l.status = 'out'; }
    else if (st.kind === 'final') { w.rank = 1; l.rank = 2; w.status = l.status = 'out'; }
  });
  if (st.bye) {
    const b = P(st.bye);
    if (st.kind === 'rep') b.status = 'bracket';
    last(b, 'win', 'Descansaste esta ronda', 'Avanzas automáticamente');
  }
  const alive = [...G.players.values()].filter(p => p.status !== 'out').length;
  elim.forEach(p => { p.rank = alive + elim.length; last(p, 'out', 'Fuiste eliminado 😢', `Terminaste en el Top ${p.rank}`); });
  st.matches.forEach(m => { if (m.tie) [m.winner, m.loser].forEach(id => { const p = P(id); if (p.last) p.last.sub += m.tie === 'speed' ? ' · Empataron en puntos: ganó quien sumó primero' : ' · Empataron en puntos: definido al azar 🎲'; }); });
  if (st.kind === 'semi') {
    const ws = st.matches.map(m => m.winner); if (st.bye) ws.push(st.bye);
    const ls = st.bye ? [] : st.matches.map(m => m.loser);
    if (ls.length === 2) G.queue.push({ kind: 'third', name: '🥉 Tercer puesto', key: 'final', seq: true, host: true, ids: ls });
    G.queue.push({ kind: 'final', name: '🏆 Final', key: 'final', seq: true, host: true, ids: ws });
  }
  if (st.kind === 'round' && st.no === 1) G.repPending = true;

  G.history.push({ name: st.name, kind: st.kind, bye: st.bye, matches: st.matches.map(m => ({ a: m.a, b: m.b, sa: m.score[m.a], sb: m.score[m.b], w: m.winner, tie: m.tie })) });
  G.roundTop = st.matches.flatMap(m => [m.a, m.b]).map(P).sort((x, y) => y.rscore - x.rscore).slice(0, 5).map(p => ({ ...pub(p), score: p.rscore }));

  if (st.kind === 'final') return finish();
  if (G.timeUp) return finishByPoints();
  G.phase = 'stageEnd';
  G.players.forEach(syncPlayer);
  pushHost(true);
}

function finishByPoints() {                                         // se acabó el tiempo global (o no quedan rivales)
  [...G.players.values()].filter(p => p.status !== 'out').sort((a, b) => b.total - a.total)
    .forEach((p, i) => { p.rank = i + 1; p.status = 'out'; });
  finish();
}
function finish() {
  G.phase = 'finished';
  logPodium();
  G.players.forEach(p => { if (!p.rank) p.rank = G.players.size; });
  G.players.forEach(syncPlayer);
  pushHost(true);
}

/* ---------- sockets ---------- */
io.on('connection', s => {
  const host = fn => (...a) => { if (s.isHost) fn(...a); };

  s.on('host:join', pin => {
    if (PIN && pin !== PIN) return s.emit('host:denied');
    s.isHost = true; s.join('host');
    s.emit('host:ok', { url: publicUrl() });
    s.emit('state', hostState());
  });
  s.on('host:cfg', host(c => {
    if (G.phase !== 'lobby') return;
    const n = (v, lo, hi, d) => Math.min(hi, Math.max(lo, parseInt(v) || d));
    G.cfg = { totalMin: n(c.totalMin, 1, 240, 40), battleSec: n(c.battleSec, 10, 600, 60), qCount: n(c.qCount, 1, 20, 5), topQSec: n(c.topQSec, 5, 60, 15),
              prizes: [0, 1, 2].map(i => String((c.prizes || [])[i] || '').slice(0, 60)) };
    pushHost();
  }));
  s.on('host:bots', host(d => {                          // botón "Agregar bots" del lobby
    if (G.phase !== 'lobby') return;
    const n = Math.min(500, 1000 - G.players.size, Math.max(0, parseInt(d && d.n) || 0));
    if (n > 0) addBots(n, !!(d && d.flaky));
  }));
  s.on('host:bots:clear', host(() => { if (G.phase === 'lobby') clearBots(); }));
  s.on('host:q:get', host(() => s.emit('host:q', JSON.stringify(Q, null, 2))));
  s.on('host:q:save', host(txt => {
    try { const o = JSON.parse(txt); validateQ(o); fs.writeFileSync(QF, JSON.stringify(o, null, 2)); Q = o; s.emit('host:q:saved', { ok: true, total: poolTotal() }); }
    catch (e) { s.emit('host:q:saved', { ok: false, err: e.message }); }
  }));
  s.on('host:start', host(() => startTournament(m => s.emit('host:msg', m))));
  s.on('host:round', host(startRound));
  s.on('host:next', host(hostNext));
  s.on('host:reset', host(() => {
    if (G.stage) { clearTimeout(G.stage.timer); G.stage.matches.forEach(m => clearTimeout(m.timer)); }
    G.players.forEach(p => clearTimeout(p.wo));
    const keep = [...G.players.values()].filter(p => p.online);
    reset(G.cfg, keep);
    G.players.forEach(syncPlayer); pushHost(true);
  }));

  s.on('p:join', d => {
    const id = String((d && d.id) || '').slice(0, 40);
    if (!id) return;
    let p = G.players.get(id);
    if (!p) {
      if (G.phase !== 'lobby') return s.emit('screen', { type: 'denied' });
      p = { id, name: String(d.name || '').trim().slice(0, 14) || 'Jugador', shape: SHAPES.includes(d.shape) ? d.shape : 'circle',
            color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#e21b3c',
            status: 'bracket', rscore: 0, total: 0, byes: 0, rank: null, last: null };
      G.players.set(id, p);
    }
    p.sid = s.id; p.online = true; s.pid = id; clearTimeout(p.wo);
    syncPlayer(p); pushHost();
  });
  s.on('p:update', d => {   // el jugador cambia nombre/figura/color mientras está en el lobby
    const p = G.players.get(s.pid); if (!p || !d || G.phase !== 'lobby') return;
    const nm = String(d.name || '').trim().slice(0, 14); if (nm) p.name = nm;
    if (SHAPES.includes(d.shape)) p.shape = d.shape;
    if (/^#[0-9a-f]{6}$/i.test(d.color)) p.color = d.color;
    pushHost();
  });
  s.on('answer', idx => { const p = G.players.get(s.pid); if (p) answer(p, idx); });

  s.on('disconnect', () => {
    const p = G.players.get(s.pid);
    if (!p || p.sid !== s.id) return;
    p.online = false;
    const m = liveMatch(p.id);
    if (m) p.wo = setTimeout(() => { if (!p.online && m.state !== 'done') endMatch(m, p.id); }, GRACE);
    pushHost();
  });
});

setInterval(() => {
  if (G.endAt && !G.timeUp && now() >= G.endAt) { G.timeUp = true; pushHost(true); }
  if (G.endAt) io.to('host').emit('tick', { leftMs: Math.max(0, G.endAt - now()), timeUp: G.timeUp });
}, 1000);


/* ---------- utilidades de consola + BOTS de prueba ---------- */
function startTournament(say) {
  if (G.phase !== 'lobby') return;
  [...G.players.values()].filter(p => !p.online).forEach(p => G.players.delete(p.id));
  if (G.players.size < 2) return say('Se necesitan al menos 2 jugadores conectados.');
  if (!poolTotal()) return say('Agrega preguntas primero (botón Preguntas).');
  G.endAt = now() + G.cfg.totalMin * 60000;
  enterReady();
}
function hostNext() { if (G.phase !== 'stageEnd') return; G.timeUp ? finishByPoints() : enterReady(); }

function sanity(st) {                                   // detecta inconsistencias y las imprime en consola
  const seen = new Set();
  st.matches.forEach(m => [m.a, m.b].forEach(id => { if (seen.has(id)) console.log(`❗ [${st.name}] jugador repetido: ${P(id).name}`); seen.add(id); }));
  if (st.bye && seen.has(st.bye)) console.log(`❗ [${st.name}] el bye también juega: ${P(st.bye).name}`);
  st.matches.forEach(m => { if (m.state !== 'done' || !m.winner || !m.loser || m.winner === m.loser) console.log(`❗ [${st.name}] combate mal cerrado`, m.state, m.winner, m.loser); });
  console.log(`✔ ${st.name} terminada (${st.matches.length} combates${st.bye ? ' + 1 descansa' : ''})`);
}
function logPodium() {
  const by = r => [...G.players.values()].filter(p => p.rank === r);
  [1, 2, 3].slice(0, Math.min(3, G.players.size)).forEach(r => { if (by(r).length !== 1) console.log(`❗ Top ${r} tiene ${by(r).length} jugadores`); });
  console.log('🏁 Podio:', [1, 2, 3].map(r => `${r}º ${by(r).map(p => p.name).join('/') || '-'}`).join('  '));
}
function status() {
  const c = {}; G.players.forEach(p => { c[p.status] = (c[p.status] || 0) + 1; });
  console.log(`Fase: ${G.phase} | ${G.stage ? G.stage.name : '-'} | jugadores ${G.players.size} (${Object.entries(c).map(([k, v]) => k + ':' + v).join(' ')}) | conectados ${[...G.players.values()].filter(p => p.online).length}${G.timeUp ? ' | ⏱ tiempo global agotado' : ''}`);
  if (G.stage) G.stage.matches.forEach(m => console.log(`   ${P(m.a).name} ${m.score[m.a]} - ${m.score[m.b]} ${P(m.b).name}  [${m.state}]${m.tie ? ' empate:' + m.tie : ''}`));
}

const BOT_NAMES = ['Ana', 'Luis', 'Sofía', 'Diego', 'Camila', 'Mateo', 'Valeria', 'Andrés', 'Isabel', 'Sebas', 'Lucía', 'Pablo', 'Fer', 'Nico', 'Dani', 'Karla', 'José', 'Mari', 'Gabo', 'Ale'];
const BOT_COLORS = ['#ffffff', '#e21b3c', '#ff7a00', '#ffd600', '#26890c', '#00c9a7', '#1368ce', '#7b2ff7', '#e91e8c', '#8b5a2b', '#9e9e9e', '#111111'];
let botSeq = 0;
function addBots(n, flaky) {
  if (G.phase !== 'lobby') return console.log('⚠ Los bots solo se agregan en el lobby (antes de iniciar el torneo).');
  for (let i = 0; i < n; i++) {
    const id = 'bot' + (++botSeq) + '_' + Math.random().toString(36).slice(2, 6);
    G.players.set(id, { id, bot: true, flaky, acc: .4 + Math.random() * .55, slow: 1500 + Math.random() * 4500,
      name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + botSeq, shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      color: BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)], online: true, status: 'bracket', rscore: 0, total: 0, byes: 0, rank: null, last: null });
  }
  pushHost();
  console.log(`🤖 +${n} bots${flaky ? ' (con desconexiones aleatorias)' : ''}. Jugadores en total: ${G.players.size}`);
}
function clearBots() { [...G.players.values()].filter(p => p.bot).forEach(p => G.players.delete(p.id)); pushHost(); }
function goOffline(p) {
  p.online = false;
  const m = liveMatch(p.id);
  if (m) p.wo = setTimeout(() => { if (!p.online && m.state !== 'done') endMatch(m, p.id); }, GRACE);
  pushHost();
}
function goOnline(p) { p.online = true; clearTimeout(p.wo); syncPlayer(p); pushHost(); }

// Los bots "reciben" las mismas pantallas que un celular y reaccionan como un estudiante
function botReact(p, type, d) {
  if (type === 'vs' && p.flaky && Math.random() < .25) {               // se desconecta a mitad del combate
    const back = (2000 + Math.random() * 35000) * T;                    // a veces vuelve tarde → prueba el W.O.
    setTimeout(() => { if (!p.online) return; goOffline(p); console.log(`📴 ${p.name} se desconecta ${(back / 1000).toFixed(1)}s`); setTimeout(() => goOnline(p), back); }, (6000 + Math.random() * 8000) * T);
    return;
  }
  if (type !== 'question' && type !== 'pad') return;
  const m = liveMatch(p.id);
  if (!m) return;
  let correct, count, mark;
  if (type === 'question') { const S = m.P[p.id], qi = S.order[S.i]; mark = S.i; correct = S.perm[qi].indexOf(m.qs[qi].a); count = m.qs[qi].o.length; }
  else { const q = m.qs[m.qIdx]; mark = m.qIdx; correct = m.hperm[m.qIdx].indexOf(q.a); count = q.o.length; }
  setTimeout(() => {
    if (!p.online || liveMatch(p.id) !== m) return;
    if (type === 'question' ? m.P[p.id].i !== mark : m.qIdx !== mark) return;
    let idx = correct;
    if (Math.random() > p.acc) { const w = [...Array(count).keys()].filter(i => i !== correct); idx = w[Math.floor(Math.random() * w.length)]; }
    answer(p, idx);
  }, (800 + Math.random() * p.slow) * T);
}

let autoTimer = null;
function auto(on) {
  clearInterval(autoTimer); autoTimer = null;
  if (!on) return console.log('🕹 Piloto automático: OFF');
  console.log('🕹 Piloto automático: ON (el anfitrión pulsa iniciar ronda / continuar solo)');
  autoTimer = setInterval(() => {
    if (G.phase === 'ready') startRound();
    else if (G.phase === 'stageEnd') hostNext();
    else if (G.phase === 'finished') { clearInterval(autoTimer); autoTimer = null; console.log('🕹 Torneo terminado, piloto automático OFF'); }
  }, 1500 * T);
}

const HELP = `
Comandos (escríbelos aquí en la consola):
  bots N            agrega N bots al lobby            (ej: bots 30)
  bots N flaky      igual, pero algunos se desconectan a mitad de combate
  bots clear        quita todos los bots (solo en el lobby)
  cfg k=v ...       cambia la config: totalMin, battleSec, qCount, topQSec   (ej: cfg battleSec=15 qCount=3)
  start             inicia el torneo (como el botón del anfitrión)
  round / next      iniciar ronda / continuar (como los botones del anfitrión)
  auto on|off       el anfitrión se maneja solo hasta el final
  status            estado actual y combates
  help              esta ayuda`;
if (process.stdin) {
  require('readline').createInterface({ input: process.stdin }).on('line', line => {
    const [c, ...a] = line.trim().split(/\s+/);
    try {
      if (c === 'bots' && a[0] === 'clear') { if (G.phase !== 'lobby') return console.log('⚠ Solo en el lobby.'); clearBots(); console.log('🤖 Bots eliminados'); }
      else if (c === 'bots') { const n = parseInt(a[0]); n > 0 ? addBots(Math.min(n, 500), a.includes('flaky')) : console.log('Uso: bots 30  |  bots 30 flaky  |  bots clear'); }
      else if (c === 'cfg') { a.forEach(kv => { const [k, v] = kv.split('='); if (k in G.cfg && k !== 'prizes' && +v > 0) G.cfg[k] = +v; }); pushHost(); console.log('Config:', JSON.stringify(G.cfg)); }
      else if (c === 'start') startTournament(console.log);
      else if (c === 'round') startRound();
      else if (c === 'next') hostNext();
      else if (c === 'auto') auto(a[0] !== 'off');
      else if (c === 'status') status();
      else if (c === 'help' || c === '?') console.log(HELP);
      else if (c) console.log('Comando desconocido. Escribe help');
    } catch (e) { console.error('💥 Error en comando:', e); }
  });
}
process.on('uncaughtException', e => console.error('💥 Excepción no controlada:', e));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nJugadores (QR):  ${publicUrl()}`);
  console.log(`Anfitrión:        ${publicUrl().replace(/\/$/, '')}/host.html`);
  console.log('Escribe "help" para ver los comandos de prueba (bots, auto, status...)\n');
});
