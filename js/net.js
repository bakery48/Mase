// オンライン対戦（PeerJS / WebRTC）。ホストの端末がゲームの状態を管理する
const PEERJS_URL = 'vendor/peerjs.min.js';
const PREFIX = 'magicmaze-mobile-';

let loading = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEERJS_URL;
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('通信ライブラリを読み込めませんでした')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

// 開発用: ?peerserver=localhost:9000 で自前の PeerServer を使う
function peerOptions() {
  const v = new URLSearchParams(location.search).get('peerserver');
  if (!v) return {};
  const [host, port] = v.split(':');
  return { host, port: Number(port || 9000), path: '/', secure: location.protocol === 'https:' };
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions());
    const fail = (e) => { peer.destroy(); reject(e); };
    peer.once('open', () => { peer.off('error', fail); resolve(peer); });
    peer.once('error', fail);
  });
}

export class Host {
  constructor() {
    this.conns = new Map(); // peerId -> { conn, name }
    this.onMessage = () => {};
    this.onLeave = () => {};
    this.onJoin = () => {};
  }

  async start() {
    await loadPeerJS();
    for (let tries = 0; tries < 5; tries++) {
      this.code = randomCode();
      try {
        this.peer = await openPeer(PREFIX + this.code);
        break;
      } catch (e) {
        if (e.type !== 'unavailable-id' || tries === 4) throw e;
      }
    }
    this.peer.on('connection', (conn) => {
      conn.on('open', () => { this.conns.set(conn.peer, { conn, name: '?' }); });
      conn.on('data', (msg) => {
        if (msg && msg.t === 'hello') {
          const entry = this.conns.get(conn.peer) || { conn };
          entry.name = String(msg.name || 'ゲスト').slice(0, 12);
          this.conns.set(conn.peer, entry);
          this.onJoin(conn.peer, entry.name);
          return;
        }
        this.onMessage(conn.peer, msg);
      });
      conn.on('close', () => { this.conns.delete(conn.peer); this.onLeave(conn.peer); });
    });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) { /* noop */ } });
    return this.code;
  }

  send(peerId, msg) {
    const e = this.conns.get(peerId);
    if (e && e.conn.open) e.conn.send(msg);
  }

  broadcast(msg) {
    for (const { conn } of this.conns.values()) if (conn.open) conn.send(msg);
  }

  close() {
    if (this.peer) this.peer.destroy();
  }
}

export class Client {
  constructor() {
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  async join(code, name) {
    await loadPeerJS();
    this.peer = await openPeer(null);
    await new Promise((resolve, reject) => {
      const conn = this.peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      const timer = setTimeout(() => reject(new Error('部屋が見つかりません')), 12000);
      this.peer.once('error', (e) => {
        clearTimeout(timer);
        reject(e.type === 'peer-unavailable' ? new Error('部屋が見つかりません') : e);
      });
      conn.on('open', () => {
        clearTimeout(timer);
        this.conn = conn;
        conn.send({ t: 'hello', name });
        resolve();
      });
      conn.on('data', (msg) => this.onMessage(msg));
      conn.on('close', () => this.onClose());
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  close() {
    if (this.peer) this.peer.destroy();
  }
}
