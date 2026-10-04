import test from 'node:test';
import assert from 'node:assert/strict';
import { TILES, HEROES } from '../js/tiles.js';
import {
  buildBoard, newGame, legalActions, applyAction, tick, tileOrigin, key, ROLE_SETS, ALL_ACTIONS,
} from '../js/engine.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPENINGS = ['2,0', '3,2', '1,3', '0,1'];

test('タイル: 開口部の位置と内部の連結性', () => {
  for (const t of TILES) {
    t.cells.forEach((c, n) => {
      const pos = `${n % 4},${Math.floor(n / 4)}`;
      if (c.type === 'explore') assert.ok(OPENINGS.includes(pos), `tile ${t.id}: explore at ${pos}`);
    });
    if (!t.start) assert.notEqual(t.cells[3 * 4 + 1].type, 'wall', `tile ${t.id}: entry is wall`);
    const open = t.cells.map((c, n) => (c.type !== 'wall' ? n : -1)).filter((n) => n >= 0);
    const seen = new Set([open[0]]);
    const stack = [open[0]];
    while (stack.length) {
      const n = stack.pop();
      const x = n % 4; const y = Math.floor(n / 4);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx; const ny = y + dy;
        const m = ny * 4 + nx;
        if (nx < 0 || ny < 0 || nx > 3 || ny > 3 || seen.has(m) || t.cells[m].type === 'wall') continue;
        seen.add(m); stack.push(m);
      }
    }
    assert.equal(seen.size, open.length, `tile ${t.id} is not connected`);
    for (const [a, b] of t.esc) {
      assert.notEqual(t.cells[a[1] * 4 + a[0]].type, 'wall');
      assert.notEqual(t.cells[b[1] * 4 + b[0]].type, 'wall');
    }
  }
  // アイテムは各色1つ、出口は1つ
  for (const h of HEROES) {
    const n = TILES.flatMap((t) => t.cells).filter((c) => c.type === 'item' && c.color === h).length;
    assert.equal(n, 1, `item ${h}`);
  }
  assert.equal(TILES.flatMap((t) => t.cells).filter((c) => c.type === 'exit').length, 1);
});

test('風車状の配置でタイル同士が重ならない', () => {
  const seen = new Set();
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const o = tileOrigin(i, j);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const k = key(o.x + x, o.y + y);
        assert.ok(!seen.has(k), `overlap at ${k}`);
        seen.add(k);
      }
    }
  }
});

test('移動はヒーローと壁で止まり、担当外アクションは拒否される', () => {
  const s = newGame({ rng: rng(1) });
  s.heroes.purple = { x: 1, y: 1, out: false };
  s.heroes.orange = { x: 2, y: 1, out: false };
  s.heroes.green = { x: 1, y: 2, out: false };
  s.heroes.yellow = { x: 2, y: 2, out: false };
  const moves = legalActions(s, 'purple', ['E', 'N']);
  // 東はドワーフがいるので不可、北は (1,0) まで
  assert.deepEqual(moves.map((m) => `${m.dir}${m.x},${m.y}`), ['N1,0']);
  const r = applyAction(s, { type: 'move', hero: 'purple', dir: 'S', x: 1, y: 3 }, ['N']);
  assert.equal(r.ok, false);
});

test('探索するとタイルが入口を向けて繋がる', () => {
  const s = newGame({ rng: rng(2) });
  // 紫の探索マスは開始タイルの (2,0)
  s.heroes.purple = { x: 2, y: 0, out: false };
  s.heroes.orange = { x: 0, y: 0 + 2, out: false };
  const ex = legalActions(s, 'purple', ['explore']);
  assert.equal(ex.length, 1);
  const r = applyAction(s, ex[0]);
  assert.ok(r.ok);
  assert.equal(s.tiles.length, 2);
  const b = buildBoard(s.tiles);
  // 新タイルの入口は (2,-1) に来て、南向きの開口部になっている
  const entry = b.cells.get(key(2, -1));
  assert.equal(entry.side, 'S');
  assert.ok(legalActions(s, 'purple', ['N']).some((m) => m.y === -1));
});

test('砂時計で残り時間が反転し、時間切れで負け', () => {
  const s = newGame({ time: 180, rng: rng(3) });
  s.tiles.push({ id: 7, i: 0, j: 1, rot: 0 }); // 北に砂時計タイル
  const b = buildBoard(s.tiles);
  const hg = [...b.cells.values()].find((c) => c.type === 'hourglass');
  s.timeLeft = 150;
  // 直接その位置に隣接させてから移動
  const path = legalActions(s, 'purple', ALL_ACTIONS);
  assert.ok(path.length > 0);
  s.heroes.purple = { x: hg.x - 1, y: hg.y, out: false };
  const r = applyAction(s, { type: 'move', hero: 'purple', dir: 'E', x: hg.x, y: hg.y });
  assert.ok(r.ok, r.error);
  assert.equal(s.timeLeft, 30);
  assert.ok(r.events.some((e) => e.type === 'flip'));
  tick(s, 31);
  assert.equal(s.status, 'lost');
});

test('役割セットは全アクションをちょうど1回ずつ配る', () => {
  for (const n of [2, 3, 4]) {
    const all = ROLE_SETS[n].flat().sort();
    assert.deepEqual(all, ALL_ACTIONS.slice().sort());
  }
});

// --- ボットによる通しプレイ（タイルセットがクリア可能かの確認） ---

function bfs(state, hero, goal) {
  // ヒーロー1体の最短手順（他のヒーローは固定）
  const start = state.heroes[hero];
  const startK = key(start.x, start.y);
  const prev = new Map([[startK, null]]);
  const queue = [[start.x, start.y]];
  const board = buildBoard(state.tiles);
  while (queue.length) {
    const [x, y] = queue.shift();
    if (goal(x, y, board)) {
      const path = [];
      let k = key(x, y);
      while (prev.get(k)) { path.unshift(prev.get(k).action); k = prev.get(k).from; }
      return path;
    }
    const tmp = { ...state, heroes: { ...state.heroes, [hero]: { x, y, out: false } } };
    for (const a of legalActions(tmp, hero, ALL_ACTIONS, board)) {
      if (a.type === 'explore') continue;
      const k = key(a.x, a.y);
      if (prev.has(k)) continue;
      prev.set(k, { from: key(x, y), action: a });
      queue.push([a.x, a.y]);
    }
  }
  return null;
}

function runPath(state, path) {
  for (const a of path) {
    const r = applyAction(state, a);
    if (!r.ok) return false;
  }
  return true;
}

function botPlay(seed) {
  const s = newGame({ time: 1e9, rng: rng(seed) });
  for (let guard = 0; guard < 400 && s.status === 'playing'; guard++) {
    const board = buildBoard(s.tiles);
    const cells = [...board.cells.values()];
    if (!s.alarm) {
      // 1) 見えているアイテムに向かう
      let progressed = false;
      for (const h of HEROES) {
        const item = cells.find((c) => c.type === 'item' && c.color === h);
        if (!item) continue;
        const p = s.heroes[h];
        if (p.x === item.x && p.y === item.y) continue;
        const path = bfs(s, h, (x, y) => x === item.x && y === item.y);
        if (path && path.length && runPath(s, path)) { progressed = true; break; }
      }
      if (progressed) continue;
      // 2) 探索
      for (const h of HEROES) {
        const path = bfs(s, h, (x, y, b) => {
          const tmp = { ...s, heroes: { ...s.heroes, [h]: { x, y, out: false } } };
          return legalActions(tmp, h, ['explore'], b).length > 0;
        });
        if (path) {
          runPath(s, path);
          const ex = legalActions(s, h, ['explore']);
          if (ex.length) { applyAction(s, ex[0]); progressed = true; break; }
        }
      }
      if (progressed) continue;
      // 3) 道を塞いでいるヒーローをどかす（ランダム移動）
      const r = rng(seed + guard);
      const h = HEROES[Math.floor(r() * 4)];
      const opts = legalActions(s, h, ALL_ACTIONS).filter((a) => a.type !== 'explore');
      if (opts.length) applyAction(s, opts[Math.floor(r() * opts.length)]);
    } else {
      const exit = cells.find((c) => c.type === 'exit');
      if (!exit) {
        // 出口がまだ見つかっていなければ探索を続ける
        let done = false;
        for (const h of HEROES) {
          if (s.heroes[h].out) continue;
          const path = bfs(s, h, (x, y, b) => {
            const tmp = { ...s, heroes: { ...s.heroes, [h]: { x, y, out: false } } };
            return legalActions(tmp, h, ['explore'], b).length > 0;
          });
          if (path) {
            runPath(s, path);
            const ex = legalActions(s, h, ['explore']);
            if (ex.length) { applyAction(s, ex[0]); done = true; break; }
          }
        }
        if (!done) return { won: false, s };
        continue;
      }
      let moved = false;
      for (const h of HEROES) {
        if (s.heroes[h].out) continue;
        const path = bfs(s, h, (x, y) => x === exit.x && y === exit.y);
        if (path && runPath(s, path)) { moved = true; break; }
      }
      if (!moved) {
        const r = rng(seed * 7 + guard);
        const h = HEROES.filter((n) => !s.heroes[n].out)[0];
        const opts = legalActions(s, h, ALL_ACTIONS);
        if (opts.length) applyAction(s, opts[Math.floor(r() * opts.length)]);
      }
    }
  }
  return { won: s.status === 'won', s };
}

test('ボットが多くのシードでクリアできる（タイルセットの健全性）', () => {
  let wins = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) if (botPlay(seed).won) wins++;
  // 探索の行き詰まりは本物のゲームでも起こりうるが、大半はクリアできること
  assert.ok(wins / N >= 0.8, `win rate ${wins}/${N}`);
});
