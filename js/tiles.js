// タイル定義
// 各タイルは 4x4 マス。向きは「入口が南（下）」を基準に記述する。
// 開口部の位置は固定: 北(2,0) 東(3,2) 南(1,3) 西(0,1)
// （本物のマジックメイズ同様、タイルを少しずらして並べることで開口部が噛み合う）
//
// トークン:
//   .   床            #   壁（通れない）
//   eX  探索マス      vX  ワープ（渦）
//   iX  アイテム      h   砂時計
//   x   出口
//   X = p(紫/魔術師) o(橙/ドワーフ) g(緑/エルフ) y(黄/バーバリアン)

export const HEROES = ['purple', 'orange', 'green', 'yellow'];

export const HERO_INFO = {
  purple: { name: '魔術師', icon: '🧙', color: '#9b59d0', dark: '#5e2d8a' },
  orange: { name: 'ドワーフ', icon: '⛏️', color: '#f08a24', dark: '#a3540c' },
  green: { name: 'エルフ', icon: '🏹', color: '#3fb35a', dark: '#1f6e33' },
  yellow: { name: 'バーバリアン', icon: '⚔️', color: '#f1c40f', dark: '#9a7b06' },
};

const CODE = { p: 'purple', o: 'orange', g: 'green', y: 'yellow' };

export const START_TILE = 0;

const RAW = [
  {
    id: 0, start: true,
    rows: [
      '#  .  ep .',
      'eg .  .  .',
      '.  .  .  ey',
      '.  eo .  #',
    ],
  },
  {
    id: 1,
    rows: [
      '.  .  eg .',
      '#  .  #  .',
      '.  ip .  eo',
      '#  .  .  .',
    ],
  },
  {
    id: 2,
    rows: [
      '.  #  ep .',
      'ey .  .  .',
      '.  .  #  h',
      '#  .  io #',
    ],
  },
  {
    id: 3,
    rows: [
      '.  .  #  .',
      '#  vp .  .',
      '.  .  .  ey',
      '.  .  ig #',
    ],
  },
  {
    id: 4,
    rows: [
      '#  .  eo .',
      'ep .  #  .',
      '.  .  .  .',
      'iy .  #  .',
    ],
  },
  {
    id: 5,
    rows: [
      'x  .  ey #',
      '.  #  .  .',
      '.  .  .  eg',
      '#  .  h  .',
    ],
  },
  {
    id: 6,
    rows: [
      '.  vo eg .',
      'ep .  #  .',
      '#  .  .  vg',
      '.  .  .  #',
    ],
  },
  {
    id: 7,
    rows: [
      '#  .  ep #',
      'eg .  .  .',
      '.  #  h  eo',
      '.  .  .  #',
    ],
  },
  {
    id: 8,
    rows: [
      '.  .  ey .',
      'eo #  #  .',
      '.  vy #  .',
      '#  .  .  .',
    ],
    esc: [[[0, 2], [3, 0]]],
  },
  {
    id: 9,
    rows: [
      '.  .  eo .',
      '.  #  .  #',
      'vp .  .  eg',
      '.  .  #  .',
    ],
    esc: [[[0, 0], [2, 2]]],
  },
  {
    id: 10,
    rows: [
      '.  .  #  .',
      'ey .  .  .',
      '#  vo #  h',
      '.  .  .  .',
    ],
  },
  {
    id: 11,
    rows: [
      '.  #  eg .',
      'eo .  .  .',
      '.  vg #  ep',
      '.  .  .  #',
    ],
  },
  {
    id: 12,
    rows: [
      '#  .  .  .',
      '.  .  #  .',
      'h  #  vy eo',
      '.  .  .  .',
    ],
  },
  {
    id: 13,
    rows: [
      '.  .  ey .',
      'eg #  .  .',
      '.  .  #  .',
      '#  .  .  vp',
    ],
    esc: [[[0, 2], [3, 1]]],
  },
  {
    id: 14,
    rows: [
      '.  .  eo #',
      '#  .  .  .',
      '.  .  .  ep',
      '.  .  #  .',
    ],
  },
];

function parseToken(tok) {
  if (tok === '.') return { type: 'floor' };
  if (tok === '#') return { type: 'wall' };
  if (tok === 'h') return { type: 'hourglass' };
  if (tok === 'x') return { type: 'exit' };
  const kind = { e: 'explore', v: 'vortex', i: 'item' }[tok[0]];
  const color = CODE[tok[1]];
  if (!kind || !color || tok.length !== 2) throw new Error('bad tile token: ' + tok);
  return { type: kind, color };
}

export const TILES = RAW.map((raw) => {
  const cells = [];
  raw.rows.forEach((row) => {
    const toks = row.trim().split(/\s+/);
    if (toks.length !== 4) throw new Error(`tile ${raw.id}: row needs 4 cells`);
    toks.forEach((t) => cells.push(parseToken(t)));
  });
  if (cells.length !== 16) throw new Error(`tile ${raw.id}: needs 4 rows`);
  return { id: raw.id, start: !!raw.start, cells, esc: raw.esc || [] };
});

export const DECK_TILES = TILES.filter((t) => !t.start).map((t) => t.id);
