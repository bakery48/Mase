import { HEROES, HERO_INFO } from './tiles.js';
import {
  newGame, applyAction, legalActions, tick, tileOrigin,
  ROLE_SETS, ALL_ACTIONS, ACTION_ICON, ACTION_LABEL,
} from './engine.js';
import { Renderer } from './render.js';
import { Host, Client } from './net.js';

const $ = (id) => document.getElementById(id);

// ---------- 画面切り替え ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function modal(title, body, buttons) {
  $('modal-title').textContent = title;
  $('modal-body').textContent = body;
  const box = $('modal-buttons');
  box.innerHTML = '';
  buttons.forEach(([label, cls, fn]) => {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.onclick = () => { closeModal(); fn(); };
    box.appendChild(b);
  });
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }

let toastTimer = null;
function toast(text, ms = 1800) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function vibrate(p) { if (navigator.vibrate) navigator.vibrate(p); }

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- 設定 ----------
const nameInput = $('name');
try { nameInput.value = localStorage.getItem('mm-name') || ''; } catch (_) { /* noop */ }
try { const d = localStorage.getItem('mm-time'); if (d) $('difficulty').value = d; } catch (_) { /* noop */ }
function playerName() {
  const n = nameInput.value.trim() || 'プレイヤー';
  try { localStorage.setItem('mm-name', n); } catch (_) { /* noop */ }
  return n;
}
function timeSetting() {
  const v = $('difficulty').value;
  try { localStorage.setItem('mm-time', v); } catch (_) { /* noop */ }
  return Number(v);
}

// ---------- セッション ----------
// mode: 'solo' | 'host' | 'client'
const S = {
  mode: null,
  state: null,
  players: [], // [{id, name, actions}]
  myId: 'me',
  paused: false,
  selected: null,
  receivedAt: 0,
  lastBroadcast: 0,
  net: null,
  lobby: [], // ホスト: [{id, name}]
  pickingPing: false,
  time: 180,
};

const renderer = new Renderer($('board'));
window.__mm = { S, renderer }; // デバッグ用

function myActions() {
  const me = S.players.find((p) => p.id === S.myId);
  return me ? me.actions : [];
}

function displayTime() {
  if (!S.state) return 0;
  if (S.mode === 'client' && S.state.status === 'playing') {
    return S.state.timeLeft - (performance.now() - S.receivedAt) / 1000;
  }
  return S.state.timeLeft;
}

// ---------- ゲーム開始 ----------
function startSolo() {
  S.mode = 'solo';
  S.time = timeSetting();
  S.myId = 'me';
  S.players = [{ id: 'me', name: playerName(), actions: ALL_ACTIONS }];
  beginGame(newGame({ time: S.time }));
}

function beginGame(state) {
  S.state = state;
  S.paused = false;
  S.selected = null;
  S.receivedAt = performance.now();
  closeModal();
  show('game');
  renderer.disp = {};
  renderer.resize();
  renderer.setState(state);
  renderer.fit();
  updateHud();
  renderActions();
  renderPlayers();
  refreshTargets();
  $('btn-pause').classList.toggle('hidden', S.mode !== 'solo');
  $('btn-ping').classList.toggle('hidden', S.mode === 'solo' || S.players.length < 2);
  requestWakeLock();
  toast('💬 作戦タイム！ 最初の一手で会話禁止に', 2200);
}

// 状態更新（ローカル・ホストで行動を適用した後、またはクライアントが受信した時）
function onStateChanged(events = []) {
  renderer.setState(S.state);
  if (S.selected && S.state.heroes[S.selected].out) S.selected = null;
  refreshTargets();
  updateHud();
  handleEvents(events);
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'flip') { toast('⌛ 砂時計をひっくり返した！\n💬 相談OK'); vibrate([60, 40, 60]); }
    if (e.type === 'alarm') {
      toast('🚨 アラーム発動！\n出口へ逃げろ！（ワープ不可）', 2600);
      renderer.flash = 1;
      vibrate([200, 80, 200]);
    }
    if (e.type === 'escape') toast(`${HERO_INFO[e.hero].icon} ${HERO_INFO[e.hero].name}が脱出！`);
    if (e.type === 'explore') {
      vibrate(30);
      const t = S.state.tiles[S.state.tiles.length - 1];
      const o = tileOrigin(t.i, t.j);
      const [x0, y0] = renderer.toScreen(o.x, o.y);
      const [x1, y1] = renderer.toScreen(o.x + 4, o.y + 4);
      if (x0 < 0 || y0 < 80 || x1 > renderer.w || y1 > renderer.h - 160) renderer.fit();
    }
  }
  if (S.state.status !== 'playing') gameOver();
}

function doAction(action) {
  if (!S.state || S.state.status !== 'playing') return;
  if (S.mode === 'solo') {
    if (S.paused) return;
    const r = applyAction(S.state, action, myActions());
    if (r.ok) onStateChanged(r.events); else toast(r.error);
  } else if (S.mode === 'host') {
    hostApply('host', action);
  } else if (S.mode === 'client') {
    S.net.send({ t: 'act', action });
  }
}

let overShown = false;
function gameOver() {
  if (overShown) return;
  overShown = true;
  releaseWakeLock();
  const won = S.state.status === 'won';
  const body = won
    ? `残り時間 ${fmtTime(S.state.timeLeft)}\n探索したタイル ${S.state.tiles.length - 1}枚・行動 ${S.state.actions}回`
    : `時間切れ…\n探索したタイル ${S.state.tiles.length - 1}枚・行動 ${S.state.actions}回`;
  vibrate(won ? [80, 50, 80, 50, 200] : 400);
  const toTitle = ['タイトルへ', 'ghost', leaveToTitle];
  if (S.mode === 'solo') {
    modal(won ? '🎉 脱出成功！' : '💀 失敗…', body, [['もう一度', 'primary', startSolo], toTitle]);
  } else if (S.mode === 'host') {
    modal(won ? '🎉 脱出成功！' : '💀 失敗…', body, [['もう一度（全員）', 'primary', hostStartGame], toTitle]);
  } else {
    modal(won ? '🎉 脱出成功！' : '💀 失敗…', `${body}\n\nホストが再開するのを待っています…`, [toTitle]);
  }
}

function leaveToTitle() {
  if (S.net) { S.net.close(); S.net = null; }
  S.mode = null;
  S.state = null;
  releaseWakeLock();
  closeModal();
  show('title');
}

// ---------- HUD ----------
function updateHud() {
  const st = S.state;
  if (!st) return;
  const left = HEROES.filter((h) => !st.heroes[h].out).length;
  $('goal').textContent = st.alarm
    ? `🚪 出口へ脱出せよ！（残り${left}人）`
    : '💎 全員を同じ色のアイテムへ同時に！';
  $('deck').textContent = `山札 ${st.deck.length}`;
  $('talk').textContent = st.talk ? '💬 相談OK' : '🤫 会話禁止';
}

function renderActions() {
  const box = $('my-actions');
  box.innerHTML = '';
  const acts = myActions();
  if (!acts.length) {
    box.innerHTML = '<div class="hint-line">観戦中（次のゲームから参加できます）</div>';
    return;
  }
  for (const a of acts) {
    const d = document.createElement('div');
    d.className = 'act';
    d.innerHTML = `<b>${ACTION_ICON[a]}</b>${ACTION_LABEL[a]}`;
    box.appendChild(d);
  }
}

function renderPlayers() {
  const box = $('players');
  box.innerHTML = '';
  if (S.players.length < 2) return;
  for (const p of S.players) {
    const c = document.createElement('div');
    c.className = 'chip';
    if (p.id === S.myId) c.classList.add('me');
    if (S.pickingPing && p.id !== S.myId) c.classList.add('pickable');
    c.textContent = `${p.name} ${p.actions.map((a) => ACTION_ICON[a]).join('')}`;
    c.onclick = () => {
      if (!S.pickingPing || p.id === S.myId) return;
      S.pickingPing = false;
      sendPing(p.id);
      renderPlayers();
      setHint();
    };
    box.appendChild(c);
  }
}

function refreshTargets() {
  const acts = myActions();
  renderer.selected = S.selected;
  renderer.targets = S.selected && S.state.status === 'playing'
    ? legalActions(S.state, S.selected, acts)
    : [];
  setHint();
}

function setHint() {
  let text;
  if (S.pickingPing) text = '急かしたい人の名前をタップ！';
  else if (!S.selected) text = 'ヒーローをタップして選んでね';
  else if (!renderer.targets.length) text = `${HERO_INFO[S.selected].name}：あなたのアクションでは今は動かせない`;
  else if (renderer.targets.some((t) => t.type === 'explore')) text = `${HERO_INFO[S.selected].name}：点線の枠をタップで探索！`;
  else text = `${HERO_INFO[S.selected].name}：○をタップで移動`;
  $('hint').textContent = text;
}

// ---------- 入力（タップ・パン・ピンチ） ----------
const canvas = $('board');
const pointers = new Map();
let gesture = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  } else if (pointers.size === 1) {
    gesture = { type: 'tap' };
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x; const dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (!gesture) return;
  if (gesture.type === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    renderer.pan(mx - gesture.mx, my - gesture.my);
    if (gesture.dist > 0) renderer.zoomAt(mx, my, dist / gesture.dist);
    gesture.dist = dist; gesture.mx = mx; gesture.my = my;
  } else if (pointers.size === 1) {
    if (gesture.type === 'tap' && Math.hypot(p.x - p.sx, p.y - p.sy) > 10) gesture.type = 'pan';
    if (gesture.type === 'pan') renderer.pan(dx, dy);
  }
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p) return;
  if (gesture && gesture.type === 'tap' && pointers.size === 0) onTap(e.clientX, e.clientY);
  if (pointers.size === 0) gesture = null;
  else if (gesture && gesture.type === 'pinch') gesture = { type: 'pan' };
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); gesture = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

function onTap(x, y) {
  if (!S.state || S.state.status !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const hit = renderer.hit(x - rect.left, y - rect.top);
  if (hit.kind === 'target') {
    doAction(hit.action);
    if (hit.action.type === 'explore') S.selected = null;
  } else if (hit.kind === 'hero') {
    S.selected = S.selected === hit.hero ? null : hit.hero;
    vibrate(10);
  } else {
    S.selected = null;
  }
  refreshTargets();
}

// ---------- メインループ ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (S.state && S.state.status === 'playing') {
    if ((S.mode === 'solo' && !S.paused) || S.mode === 'host') {
      if (tick(S.state, dt)) onStateChanged();
    }
    if (S.mode === 'host' && now - S.lastBroadcast > 1000) hostBroadcast();
  }
  if (S.state) {
    const t = displayTime();
    const el = $('timer');
    el.textContent = `⌛ ${fmtTime(t)}`;
    el.classList.toggle('warn', t <= 20 && S.state.status === 'playing');
    el.classList.toggle('paused', S.paused);
    renderer.draw(now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => { renderer.resize(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.mode === 'solo' && S.state && S.state.status === 'playing' && !S.paused) togglePause();
  if (!document.hidden && S.state && S.state.status === 'playing') requestWakeLock();
});

// ---------- 画面のスリープ防止 ----------
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { /* noop */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

// ---------- ボタン ----------
$('btn-solo').onclick = startSolo;
$('btn-rules').onclick = () => $('rules').classList.remove('hidden');
$('btn-rules-close').onclick = () => $('rules').classList.add('hidden');
$('btn-fit').onclick = () => renderer.fit();
$('btn-join-open').onclick = () => {
  $('join-box').classList.toggle('hidden');
  $('join-code').focus();
};

function togglePause() {
  if (S.mode !== 'solo' || !S.state || S.state.status !== 'playing') return;
  S.paused = !S.paused;
  $('btn-pause').textContent = S.paused ? '▶ 再開' : '⏸ 一時停止';
  if (S.paused) toast('⏸ 一時停止中', 1200);
}
$('btn-pause').onclick = togglePause;

$('btn-menu').onclick = () => {
  const wasPaused = S.paused;
  if (S.mode === 'solo' && !S.paused) togglePause();
  const resume = () => { if (S.mode === 'solo' && !wasPaused && S.paused) togglePause(); };
  modal('メニュー', S.mode === 'solo' ? '一時停止中' : 'オンライン対戦中は時間は止まりません', [
    ['ゲームに戻る', 'primary', resume],
    ['あそびかた', '', () => { $('rules').classList.remove('hidden'); resume(); }],
    ['タイトルへ戻る', 'danger', leaveToTitle],
  ]);
};

$('btn-ping').onclick = () => {
  if (S.players.length === 2) {
    const other = S.players.find((p) => p.id !== S.myId);
    if (other) sendPing(other.id);
    return;
  }
  S.pickingPing = !S.pickingPing;
  renderPlayers();
  setHint();
};

function sendPing(to) {
  const me = S.players.find((p) => p.id === S.myId);
  const msg = { t: 'ping', to, from: me ? me.name : '?' };
  if (S.mode === 'host') hostRelayPing(msg);
  else if (S.mode === 'client') S.net.send(msg);
  toast('❗ 急かしました');
}

function showPing(from) {
  const o = $('ping-overlay');
  $('ping-from').textContent = from ? `${from} より` : '';
  o.classList.remove('hidden');
  o.style.animation = 'none';
  void o.offsetWidth;
  o.style.animation = '';
  vibrate([150, 60, 150, 60, 150]);
  setTimeout(() => o.classList.add('hidden'), 1200);
}

// ---------- オンライン: ホスト ----------
$('btn-host').onclick = async () => {
  $('title-msg').textContent = '部屋を作成中…';
  const host = new Host();
  try {
    const code = await host.start();
    S.net = host;
    S.mode = 'host';
    S.myId = 'host';
    S.lobby = [{ id: 'host', name: playerName() }];
    $('title-msg').textContent = '';
    $('room-code').textContent = code;
    $('btn-start').classList.remove('hidden');
    $('lobby-wait').classList.add('hidden');
    $('lobby-msg').textContent = '';
    renderLobby();
    show('lobby');
  } catch (e) {
    host.close();
    $('title-msg').textContent = `部屋を作れませんでした: ${e.message || e.type || e}`;
    return;
  }

  host.onJoin = (id, name) => {
    if (!S.lobby.some((p) => p.id === id)) S.lobby.push({ id, name });
    renderLobby();
    hostSendLobby();
    if (S.state) {
      // ゲーム中の参加者は観戦（次のゲームから参加）
      host.send(id, { t: 'start', state: S.state, players: S.players });
    }
  };
  host.onLeave = (id) => {
    S.lobby = S.lobby.filter((p) => p.id !== id);
    renderLobby();
    hostSendLobby();
    if (S.state && S.players.some((p) => p.id === id)) {
      const name = S.players.find((p) => p.id === id).name;
      // 抜けた人のアクションを残りのメンバーで分け直す
      const remaining = S.players.filter((p) => p.id !== id);
      const sets = shuffle(ROLE_SETS[remaining.length]);
      S.players = remaining.map((p, n) => ({ ...p, actions: sets[n] }));
      renderActions(); renderPlayers(); refreshTargets();
      $('btn-ping').classList.toggle('hidden', S.players.length < 2);
      toast(`${name}が抜けました。アクションを配り直します`, 2500);
      host.broadcast({ t: 'roles', players: S.players, note: `${name}が抜けました。アクションを配り直します` });
    }
  };
  host.onMessage = (id, msg) => {
    if (msg.t === 'act') hostApply(id, msg.action);
    if (msg.t === 'ping') hostRelayPing(msg);
  };
};

function renderLobby() {
  const ul = $('player-list');
  ul.innerHTML = '';
  S.lobby.slice(0, 8).forEach((p, n) => {
    const li = document.createElement('li');
    li.innerHTML = `<span></span><span>${n === 0 ? '👑 ホスト' : n < 4 ? '' : '観戦'}</span>`;
    li.firstChild.textContent = p.name;
    ul.appendChild(li);
  });
}

function hostSendLobby() {
  S.net.broadcast({ t: 'lobby', players: S.lobby.map((p) => ({ name: p.name })) });
}

function hostStartGame() {
  const members = S.lobby.slice(0, 4);
  const sets = shuffle(ROLE_SETS[members.length]);
  S.players = members.map((p, n) => ({ id: p.id, name: p.name, actions: sets[n] }));
  S.time = timeSetting();
  overShown = false;
  const state = newGame({ time: S.time });
  S.net.broadcast({ t: 'start', state, players: S.players });
  S.lastBroadcast = performance.now();
  beginGame(state);
}
$('btn-start').onclick = () => { overShown = false; hostStartGame(); };

function hostApply(id, action) {
  const p = S.players.find((x) => x.id === id);
  if (!p || !S.state) return;
  const r = applyAction(S.state, action, p.actions);
  if (!r.ok) {
    if (id === 'host') toast(r.error); else S.net.send(id, { t: 'err', error: r.error });
    return;
  }
  onStateChanged(r.events);
  hostBroadcast(r.events);
}

function hostBroadcast(events = []) {
  S.lastBroadcast = performance.now();
  S.net.broadcast({ t: 'state', state: S.state, events });
}

function hostRelayPing(msg) {
  if (msg.to === 'host') showPing(msg.from);
  else S.net.send(msg.to, msg);
}

// ---------- オンライン: 参加 ----------
$('btn-join').onclick = async () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('title-msg').textContent = '4文字の部屋コードを入れてね'; return; }
  $('title-msg').textContent = '接続中…';
  const client = new Client();
  client.onMessage = onClientMessage;
  client.onClose = () => {
    if (S.net !== client) return;
    leaveToTitle();
    modal('切断されました', 'ホストとの接続が切れました', [['OK', 'primary', () => {}]]);
  };
  try {
    await client.join(code, playerName());
  } catch (e) {
    client.close();
    $('title-msg').textContent = e.message || '接続できませんでした';
    return;
  }
  S.net = client;
  S.mode = 'client';
  S.myId = client.peer.id;
  $('title-msg').textContent = '';
  $('room-code').textContent = code;
  $('btn-start').classList.add('hidden');
  $('lobby-wait').classList.remove('hidden');
  show('lobby');
};

function onClientMessage(msg) {
  if (msg.t === 'lobby') {
    S.lobby = msg.players;
    if (!S.state) renderLobby();
  } else if (msg.t === 'start') {
    S.players = msg.players;
    overShown = false;
    beginGame(msg.state);
  } else if (msg.t === 'state') {
    if (!S.state) return;
    S.state = msg.state;
    S.receivedAt = performance.now();
    onStateChanged(msg.events || []);
  } else if (msg.t === 'roles') {
    S.players = msg.players;
    renderActions(); renderPlayers(); refreshTargets();
    $('btn-ping').classList.toggle('hidden', S.players.length < 2);
    if (msg.note) toast(msg.note, 2500);
  } else if (msg.t === 'ping') {
    showPing(msg.from);
  } else if (msg.t === 'err') {
    toast(msg.error);
  }
}

$('btn-leave').onclick = leaveToTitle;
$('btn-share').onclick = async () => {
  const code = $('room-code').textContent;
  const text = `マジック・メイズで遊ぼう！ 部屋コード: ${code}\n${location.href}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); $('lobby-msg').textContent = 'コピーしました'; }
  } catch (_) { /* キャンセル */ }
};

// ---------- PWA ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
