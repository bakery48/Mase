// キャンバス描画とカメラ（パン・ピンチズーム）
import { HEROES, HERO_INFO } from './tiles.js';
import { buildBoard, tileOrigin, key, ACTION_ICON } from './engine.js';

const ANGLE = { N: -Math.PI / 2, E: 0, S: Math.PI / 2, W: Math.PI };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 2, y: 2, scale: 48 };
    this.disp = {};
    this.state = null;
    this.board = null;
    this.tileCount = 0;
    this.selected = null;
    this.targets = [];
    this.flash = 0;
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setState(state) {
    const newTile = !this.state || state.tiles.length !== this.tileCount;
    this.state = state;
    if (newTile) {
      this.board = buildBoard(state.tiles);
      this.tileCount = state.tiles.length;
    }
    for (const h of HEROES) {
      const p = state.heroes[h];
      if (!this.disp[h]) this.disp[h] = { x: p.x, y: p.y };
    }
  }

  // 盤面全体が画面に収まるようにカメラを合わせる
  fit(padTop = 90, padBottom = 170) {
    if (!this.board) return;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const c of this.board.cells.values()) {
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x + 1); y1 = Math.max(y1, c.y + 1);
    }
    x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
    const availH = Math.max(100, this.h - padTop - padBottom);
    const scale = Math.min(this.w / (x1 - x0), availH / (y1 - y0), 70);
    this.cam.scale = Math.max(14, scale);
    this.cam.x = (x0 + x1) / 2;
    this.cam.y = (y0 + y1) / 2 - (padTop - padBottom) / 2 / this.cam.scale;
  }

  toScreen(x, y) {
    return [(x - this.cam.x) * this.cam.scale + this.w / 2, (y - this.cam.y) * this.cam.scale + this.h / 2];
  }

  toWorld(sx, sy) {
    return [(sx - this.w / 2) / this.cam.scale + this.cam.x, (sy - this.h / 2) / this.cam.scale + this.cam.y];
  }

  pan(dx, dy) {
    this.cam.x -= dx / this.cam.scale;
    this.cam.y -= dy / this.cam.scale;
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.scale = Math.min(140, Math.max(12, this.cam.scale * factor));
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx;
    this.cam.y += wy - ny;
  }

  // タップ位置の判定: ヒーロー / 行き先 / 探索スロット
  hit(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    const cx = Math.floor(wx); const cy = Math.floor(wy);
    const target = this.targets.find((t) => t.type !== 'explore' && t.x === cx && t.y === cy);
    if (target) return { kind: 'target', action: target };
    if (this.state) {
      const hero = HEROES.find((h) => {
        const p = this.state.heroes[h];
        return !p.out && p.x === cx && p.y === cy;
      });
      if (hero) return { kind: 'hero', hero };
    }
    const ex = this.targets.find((t) => {
      if (t.type !== 'explore') return false;
      const o = tileOrigin(t.i, t.j);
      return wx >= o.x && wx < o.x + 4 && wy >= o.y && wy < o.y + 4;
    });
    if (ex) return { kind: 'target', action: ex };
    return { kind: 'none' };
  }

  draw(now) {
    const { ctx } = this;
    ctx.fillStyle = '#1b1530';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.state) return;
    const s = this.cam.scale;
    this.drawGrid();

    for (const t of this.state.tiles) {
      const o = tileOrigin(t.i, t.j);
      const [sx, sy] = this.toScreen(o.x, o.y);
      ctx.fillStyle = '#3a2f55';
      roundRect(ctx, sx - s * 0.08, sy - s * 0.08, s * 4.16, s * 4.16, s * 0.25);
      ctx.fill();
    }

    for (const c of this.board.cells.values()) this.drawCell(c, now);
    this.drawWalls();
    for (const [a, b] of this.board.escalators) this.drawEscalator(a, b);

    // 探索できるスロット
    for (const t of this.targets) {
      if (t.type !== 'explore') continue;
      const o = tileOrigin(t.i, t.j);
      const [sx, sy] = this.toScreen(o.x, o.y);
      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      ctx.save();
      ctx.setLineDash([s * 0.2, s * 0.15]);
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.4 * pulse})`;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(ctx, sx, sy, s * 4, s * 4, s * 0.25);
      ctx.fill(); ctx.stroke();
      ctx.restore();
      drawText(ctx, '🔍', sx + s * 2, sy + s * 1.7, s * 1.2);
      drawText(ctx, 'タップで探索', sx + s * 2, sy + s * 2.9, s * 0.38, '#fff');
    }

    // 行き先マーカー
    for (const t of this.targets) {
      if (t.type === 'explore') continue;
      const [sx, sy] = this.toScreen(t.x + 0.5, t.y + 0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(sx, sy, s * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = HERO_INFO[t.hero].dark;
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.stroke();
      if (t.type === 'move') drawArrow(ctx, sx, sy, s * 0.32, t.dir, HERO_INFO[t.hero].dark);
      else drawText(ctx, ACTION_ICON[t.type], sx, sy + s * 0.02, s * 0.32);
    }

    // ヒーロー
    for (const h of HEROES) {
      const p = this.state.heroes[h];
      const d = this.disp[h];
      if (p.out) continue;
      const dist = Math.hypot(p.x - d.x, p.y - d.y);
      if (dist > 6) { d.x = p.x; d.y = p.y; } else { d.x += (p.x - d.x) * 0.3; d.y += (p.y - d.y) * 0.3; }
      const [sx, sy] = this.toScreen(d.x + 0.5, d.y + 0.5);
      const info = HERO_INFO[h];
      if (this.selected === h) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 180);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, s * 0.07);
        ctx.beginPath(); ctx.arc(sx, sy, s * (0.46 + 0.04 * pulse), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(sx, sy + s * 0.3, s * 0.32, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = info.color;
      ctx.strokeStyle = info.dark;
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.beginPath(); ctx.arc(sx, sy, s * 0.38, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      drawText(ctx, info.icon, sx, sy + s * 0.02, s * 0.42);
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,60,60,${this.flash * 0.4})`;
      ctx.fillRect(0, 0, this.w, this.h);
      this.flash = Math.max(0, this.flash - 0.03);
    }
  }

  drawGrid() {
    const { ctx } = this;
    const s = this.cam.scale;
    if (s < 18) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const [wx0, wy0] = this.toWorld(0, 0);
    const [wx1, wy1] = this.toWorld(this.w, this.h);
    ctx.beginPath();
    for (let x = Math.floor(wx0); x <= wx1; x++) {
      const [sx] = this.toScreen(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, this.h);
    }
    for (let y = Math.floor(wy0); y <= wy1; y++) {
      const [, sy] = this.toScreen(0, y); ctx.moveTo(0, sy); ctx.lineTo(this.w, sy);
    }
    ctx.stroke();
  }

  drawCell(c, now) {
    const { ctx } = this;
    const s = this.cam.scale;
    const [sx, sy] = this.toScreen(c.x, c.y);
    const cx = sx + s / 2; const cy = sy + s / 2;
    if (c.type === 'wall') {
      ctx.fillStyle = '#5b4a3a';
      ctx.fillRect(sx, sy, s + 0.5, s + 0.5);
      ctx.fillStyle = '#6e5a47';
      ctx.fillRect(sx + s * 0.1, sy + s * 0.1, s * 0.8, s * 0.35);
      ctx.fillRect(sx + s * 0.1, sy + s * 0.55, s * 0.8, s * 0.35);
      return;
    }
    ctx.fillStyle = (c.x + c.y) % 2 === 0 ? '#efe4cc' : '#e6d8bb';
    ctx.fillRect(sx, sy, s + 0.5, s + 0.5);

    if (c.type === 'explore') {
      const info = HERO_INFO[c.color];
      ctx.fillStyle = info.color;
      ctx.globalAlpha = 0.85;
      roundRect(ctx, sx + s * 0.1, sy + s * 0.1, s * 0.8, s * 0.8, s * 0.15);
      ctx.fill();
      ctx.globalAlpha = 1;
      drawArrow(ctx, cx, cy, s * 0.5, c.side, '#fff');
    } else if (c.type === 'vortex') {
      const info = HERO_INFO[c.color];
      const off = this.state.alarm;
      ctx.save();
      ctx.globalAlpha = off ? 0.3 : 1;
      ctx.translate(cx, cy);
      ctx.rotate(off ? 0 : now / 600);
      ctx.strokeStyle = info.color;
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, s * (0.12 + k * 0.1), k * 2, k * 2 + Math.PI * 1.3);
        ctx.stroke();
      }
      ctx.restore();
    } else if (c.type === 'item') {
      const info = HERO_INFO[c.color];
      ctx.fillStyle = info.color;
      ctx.strokeStyle = info.dark;
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.35); ctx.lineTo(cx + s * 0.3, cy);
      ctx.lineTo(cx, cy + s * 0.35); ctx.lineTo(cx - s * 0.3, cy);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (this.state.alarm) drawText(ctx, '✔', cx, cy, s * 0.35, '#fff');
    } else if (c.type === 'hourglass') {
      const used = this.state.used.includes(key(c.x, c.y));
      ctx.globalAlpha = used ? 0.3 : 1;
      drawText(ctx, '⌛', cx, cy, s * 0.6);
      ctx.globalAlpha = 1;
      if (used) drawText(ctx, '✕', cx, cy, s * 0.7, '#c0392b');
    } else if (c.type === 'exit') {
      ctx.fillStyle = this.state.alarm ? '#2ecc71' : '#7f8c8d';
      roundRect(ctx, sx + s * 0.08, sy + s * 0.08, s * 0.84, s * 0.84, s * 0.12);
      ctx.fill();
      drawText(ctx, '🚪', cx, cy, s * 0.55);
    }
  }

  drawWalls() {
    // タイル外周の壁（開口部は開ける）
    const { ctx } = this;
    const s = this.cam.scale;
    ctx.strokeStyle = '#2a213d';
    ctx.lineWidth = Math.max(2, s * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const c of this.board.cells.values()) {
      const edges = [['N', 0, -1, 0, 0, 1, 0], ['S', 0, 1, 0, 1, 1, 1], ['W', -1, 0, 0, 0, 0, 1], ['E', 1, 0, 1, 0, 1, 1]];
      for (const [dir, dx, dy, ax, ay, bx, by] of edges) {
        const n = this.board.cells.get(key(c.x + dx, c.y + dy));
        if (n && n.tile === c.tile) continue;
        if (c.side === dir && n && n.side) continue; // 繋がっている開口部
        if (c.side === dir && !n) continue; // 未探索の開口部
        const [x0, y0] = this.toScreen(c.x + ax, c.y + ay);
        const [x1, y1] = this.toScreen(c.x + bx, c.y + by);
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
    }
    ctx.stroke();
  }

  drawEscalator(a, b) {
    const { ctx } = this;
    const s = this.cam.scale;
    const [x0, y0] = this.toScreen(a[0] + 0.5, a[1] + 0.5);
    const [x1, y1] = this.toScreen(b[0] + 0.5, b[1] + 0.5);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(70,80,100,0.85)';
    ctx.lineWidth = s * 0.34;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,210,230,0.9)';
    ctx.lineWidth = s * 0.22;
    ctx.setLineDash([s * 0.06, s * 0.1]);
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawArrow(ctx, x, y, size, dir, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ANGLE[dir]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, 0);
  ctx.lineTo(-size * 0.35, -size * 0.42);
  ctx.lineTo(-size * 0.35, size * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawText(ctx, text, x, y, size, color = '#000') {
  ctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
