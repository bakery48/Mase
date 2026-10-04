// ゲームロジック（描画・通信に依存しない純粋な処理）
import { TILES, HEROES, START_TILE, DECK_TILES } from './tiles.js';

export const DIRS = {
  N: { dx: 0, dy: -1, slot: [0, 1], rot: 0, opp: 'S' },
  E: { dx: 1, dy: 0, slot: [1, 0], rot: 1, opp: 'W' },
  S: { dx: 0, dy: 1, slot: [0, -1], rot: 2, opp: 'N' },
  W: { dx: -1, dy: 0, slot: [-1, 0], rot: 3, opp: 'E' },
};

// 開口部（タイル辺の出入口）の位置 → 方角
const OPENING_SIDE = { '2,0': 'N', '3,2': 'E', '1,3': 'S', '0,1': 'W' };
const ENTRY = [1, 3];

// 役割（アクション）の割り当て
export const ACTION_LABEL = {
  N: '北へ移動', E: '東へ移動', S: '南へ移動', W: '西へ移動',
  explore: '探索', escalator: 'エスカレーター', vortex: 'ワープ',
};
export const ACTION_ICON = {
  N: '⬆️', E: '➡️', S: '⬇️', W: '⬅️', explore: '🔍', escalator: '🛗', vortex: '🌀',
};
export const ALL_ACTIONS = ['N', 'E', 'S', 'W', 'explore', 'escalator', 'vortex'];

export const ROLE_SETS = {
  1: [ALL_ACTIONS],
  2: [['N', 'E', 'explore'], ['S', 'W', 'escalator', 'vortex']],
  3: [['N', 'explore'], ['S', 'E', 'escalator'], ['W', 'vortex']],
  4: [['N', 'vortex'], ['S', 'explore'], ['E', 'escalator'], ['W']],
};

export const key = (x, y) => `${x},${y}`;

function rotate(x, y, r) {
  for (let k = 0; k < r; k++) [x, y] = [3 - y, x];
  return [x, y];
}

// タイルの格子座標 (i, j) → 左上マスの全体座標（風車状にずらして並べる）
export function tileOrigin(i, j) {
  return { x: 4 * i + j, y: i - 4 * j };
}

// 配置済みタイルから盤面（マスの辞書）を組み立てる
export function buildBoard(tiles) {
  const cells = new Map();
  const slots = new Set();
  const escalators = [];
  tiles.forEach((pt, tIndex) => {
    const def = TILES[pt.id];
    const o = tileOrigin(pt.i, pt.j);
    slots.add(key(pt.i, pt.j));
    for (let ly = 0; ly < 4; ly++) {
      for (let lx = 0; lx < 4; lx++) {
        const c = def.cells[ly * 4 + lx];
        const [rx, ry] = rotate(lx, ly, pt.rot);
        const isEntry = !def.start && lx === ENTRY[0] && ly === ENTRY[1];
        const side = OPENING_SIDE[key(rx, ry)];
        const opening = !!side && (isEntry || c.type === 'explore');
        cells.set(key(o.x + rx, o.y + ry), {
          ...c, x: o.x + rx, y: o.y + ry, tile: tIndex, side: opening ? side : null,
        });
      }
    }
    def.esc.forEach(([a, b]) => {
      const [ax, ay] = rotate(a[0], a[1], pt.rot);
      const [bx, by] = rotate(b[0], b[1], pt.rot);
      escalators.push([[o.x + ax, o.y + ay], [o.x + bx, o.y + by]]);
    });
  });
  const escMap = new Map();
  escalators.forEach(([a, b]) => {
    escMap.set(key(a[0], a[1]), b);
    escMap.set(key(b[0], b[1]), a);
  });
  return { cells, slots, escalators, escMap };
}

export function canStep(board, x, y, dir) {
  const d = DIRS[dir];
  const from = board.cells.get(key(x, y));
  const to = board.cells.get(key(x + d.dx, y + d.dy));
  if (!from || !to || to.type === 'wall') return false;
  if (from.tile === to.tile) return true;
  return from.side === dir && to.side === d.opp;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ITEM_TILES = DECK_TILES.filter((id) => TILES[id].cells.some((c) => c.type === 'item'));
const EXIT_TILES = DECK_TILES.filter((id) => TILES[id].cells.some((c) => c.type === 'exit'));

export function makeDeck(rng = Math.random) {
  // 出口は序盤に出すぎず、アイテムは山札の後ろに偏りすぎないようにする
  for (let tries = 0; tries < 500; tries++) {
    const deck = shuffle(DECK_TILES, rng);
    const lastItem = Math.max(...ITEM_TILES.map((id) => deck.indexOf(id)));
    const exitPos = deck.indexOf(EXIT_TILES[0]);
    if (lastItem <= 9 && exitPos >= 3 && exitPos <= 10) return deck;
  }
  return shuffle(DECK_TILES, rng);
}

export function newGame({ time = 180, rng = Math.random } = {}) {
  const spots = shuffle([[1, 1], [2, 1], [1, 2], [2, 2]], rng);
  const heroes = {};
  HEROES.forEach((h, n) => { heroes[h] = { x: spots[n][0], y: spots[n][1], out: false }; });
  return {
    tiles: [{ id: START_TILE, i: 0, j: 0, rot: 0 }],
    heroes,
    deck: makeDeck(rng),
    alarm: false,
    used: [],
    timeLeft: time,
    total: time,
    status: 'playing', // playing | won | lost
    talk: true, // 開始直後と砂時計を返した直後は相談OK
    actions: 0,
  };
}

function heroAt(state, x, y) {
  return HEROES.find((h) => !state.heroes[h].out && state.heroes[h].x === x && state.heroes[h].y === y);
}

// 指定ヒーローに対して、許可されたアクションで実行可能な行動を列挙
export function legalActions(state, hero, allowed = ALL_ACTIONS, board = buildBoard(state.tiles)) {
  const res = [];
  const h = state.heroes[hero];
  if (state.status !== 'playing' || !h || h.out) return res;

  for (const dir of ['N', 'E', 'S', 'W']) {
    if (!allowed.includes(dir)) continue;
    let { x, y } = h;
    while (canStep(board, x, y, dir)) {
      x += DIRS[dir].dx; y += DIRS[dir].dy;
      if (heroAt(state, x, y)) break;
      res.push({ type: 'move', hero, dir, x, y });
    }
  }

  if (allowed.includes('escalator')) {
    const other = board.escMap.get(key(h.x, h.y));
    if (other && !heroAt(state, other[0], other[1])) {
      res.push({ type: 'escalator', hero, x: other[0], y: other[1] });
    }
  }

  if (allowed.includes('vortex') && !state.alarm) {
    for (const c of board.cells.values()) {
      if (c.type === 'vortex' && c.color === hero && !(c.x === h.x && c.y === h.y) && !heroAt(state, c.x, c.y)) {
        res.push({ type: 'vortex', hero, x: c.x, y: c.y });
      }
    }
  }

  if (allowed.includes('explore')) {
    const slot = exploreSlot(state, hero, board);
    if (slot) res.push({ type: 'explore', hero, i: slot.i, j: slot.j });
  }
  return res;
}

// ヒーローが今いる探索マスから開ける未探索スロット（なければ null）
export function exploreSlot(state, hero, board = buildBoard(state.tiles)) {
  const h = state.heroes[hero];
  if (!h || h.out || state.deck.length === 0) return null;
  const c = board.cells.get(key(h.x, h.y));
  if (!c || c.type !== 'explore' || c.color !== hero || !c.side) return null;
  const t = state.tiles[c.tile];
  const s = DIRS[c.side].slot;
  const i = t.i + s[0];
  const j = t.j + s[1];
  if (board.slots.has(key(i, j))) return null;
  return { i, j, rot: DIRS[c.side].rot };
}

export function actionAllowed(allowed, action) {
  if (action.type === 'move') return allowed.includes(action.dir);
  return allowed.includes(action.type);
}

// 行動を適用する。state を直接書き換え、発生したイベントを返す
export function applyAction(state, action, allowed = ALL_ACTIONS) {
  if (state.status !== 'playing') return { ok: false, error: 'ゲームは終了しています' };
  if (!actionAllowed(allowed, action)) return { ok: false, error: 'そのアクションは担当外です' };
  const board = buildBoard(state.tiles);
  const legal = legalActions(state, action.hero, allowed, board);
  const match = legal.find((a) => a.type === action.type
    && (a.type === 'explore' || (a.x === action.x && a.y === action.y)));
  if (!match) return { ok: false, error: 'その行動はできません' };

  const events = [];
  state.actions++;
  state.talk = false;

  if (match.type === 'explore') {
    const slot = exploreSlot(state, match.hero, board);
    const id = state.deck.shift();
    state.tiles.push({ id, i: slot.i, j: slot.j, rot: slot.rot });
    events.push({ type: 'explore', tile: id });
    return { ok: true, events };
  }

  const h = state.heroes[match.hero];
  h.x = match.x; h.y = match.y;
  const cell = board.cells.get(key(h.x, h.y));
  events.push({ type: match.type, hero: match.hero });

  if (cell.type === 'hourglass' && !state.used.includes(key(h.x, h.y))) {
    state.used.push(key(h.x, h.y));
    state.timeLeft = state.total - state.timeLeft;
    state.talk = true;
    events.push({ type: 'flip' });
  }

  if (!state.alarm && HEROES.every((name) => {
    const p = state.heroes[name];
    const c = board.cells.get(key(p.x, p.y));
    return c && c.type === 'item' && c.color === name;
  })) {
    state.alarm = true;
    events.push({ type: 'alarm' });
  }

  if (state.alarm) {
    for (const name of HEROES) {
      const p = state.heroes[name];
      const c = board.cells.get(key(p.x, p.y));
      if (!p.out && c && c.type === 'exit') {
        p.out = true;
        events.push({ type: 'escape', hero: name });
      }
    }
    if (HEROES.every((name) => state.heroes[name].out)) {
      state.status = 'won';
      events.push({ type: 'won' });
    }
  }
  return { ok: true, events };
}

export function tick(state, dt) {
  if (state.status !== 'playing') return false;
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  if (state.timeLeft <= 0) {
    state.status = 'lost';
    return true;
  }
  return false;
}
