/* ===========================================================================
 * model.js — 迷路謎メーカーのデータ構造
 *
 * ここでは「迷路そのもの（Maze）」の形だけを決める。
 * 探索・生成・描画はいっさいしない（役割を混ぜるとバグの元になるため）。
 *
 * ★重要な考え方★
 *   Maze  … 制作者が編集している「設計図」。変わるのはここだけ。
 *   Board … STEPの変換（壁を消す・反転する等）を適用したあとの「今の盤面」。
 *           Maze を複製して作るので、STEPをいじっても設計図は壊れない。
 *   どちらも同じ形のデータなので、探索も描画も同じ関数が使える。
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.model = (function () {
  'use strict';

  /* ===== 色 =====
   * 謎解きで「赤い文字だけ読め」のように使うので、名前で持つ。
   * 画面表示用の実際の色コードと、白黒印刷用の区別方法をセットで持たせる。 */
  const COLORS = {
    black:  { label: '黒',   hex: '#22272e', dash: [],          deco: 'none'    },
    red:    { label: '赤',   hex: '#e03131', dash: [9, 4],      deco: 'under'   },
    blue:   { label: '青',   hex: '#1c7ed6', dash: [2, 4],      deco: 'circle'  },
    yellow: { label: '黄',   hex: '#e8a300', dash: [14, 4, 2, 4], deco: 'box'   },
    green:  { label: '緑',   hex: '#2f9e44', dash: [5, 3, 5, 9], deco: 'dot'    },
    purple: { label: '紫',   hex: '#8b5cf6', dash: [1, 3],      deco: 'double'  }
  };
  const COLOR_KEYS = Object.keys(COLORS);

  /* ===== よく使う記号 ===== */
  const SYMBOLS = ['○', '●', '△', '▲', '□', '■', '☆', '★', '×', '◇', '◆', '♪', '→', '↑', '?'];

  /* ===== 通し番号 ===== */
  let seq = 0;
  function newId(prefix) {
    seq += 1;
    return (prefix || 'x') + '_' + Date.now().toString(36) + '_' + seq;
  }

  /* -----------------------------------------------------------------------
   * 壁のキー
   *   'h:r:c' … マス(r-1,c) と マス(r,c) のあいだ（横向きの壁）  r は 0〜rows
   *   'v:r:c' … マス(r,c-1) と マス(r,c) のあいだ（縦向きの壁）  c は 0〜cols
   * 壁は「ある／ない」ではなく、辞書に入っていれば壁があるとみなす。
   * --------------------------------------------------------------------- */
  function hKey(r, c) { return 'h:' + r + ':' + c; }
  function vKey(r, c) { return 'v:' + r + ':' + c; }

  /** 隣り合う2マスのあいだの壁キーを返す（隣り合っていなければ null） */
  function edgeBetween(r1, c1, r2, c2) {
    if (r1 === r2 && Math.abs(c1 - c2) === 1) return vKey(r1, Math.max(c1, c2));
    if (c1 === c2 && Math.abs(r1 - r2) === 1) return hKey(Math.max(r1, r2), c1);
    return null;
  }

  /** 壁キーを分解して {type, r, c} にする */
  function parseKey(key) {
    const p = key.split(':');
    return { type: p[0], r: +p[1], c: +p[2] };
  }

  /** 壁キーの両側のマスを返す。a は上／左、b は下／右（盤外もそのまま返す） */
  function edgeCells(key) {
    const k = parseKey(key);
    if (k.type === 'h') return { a: { r: k.r - 1, c: k.c }, b: { r: k.r, c: k.c } };
    return { a: { r: k.r, c: k.c - 1 }, b: { r: k.r, c: k.c } };
  }

  /** その壁キーが外周（盤面のふち）かどうか */
  function isBorderKey(maze, key) {
    const k = parseKey(key);
    if (k.type === 'h') return k.r === 0 || k.r === maze.rows;
    return k.c === 0 || k.c === maze.cols;
  }

  function cellKey(r, c) { return r + ',' + c; }
  function inside(maze, r, c) { return r >= 0 && c >= 0 && r < maze.rows && c < maze.cols; }

  /* -----------------------------------------------------------------------
   * 迷路をつくる
   * --------------------------------------------------------------------- */
  function createMaze(rows, cols) {
    const maze = {
      rows: rows,
      cols: cols,
      /* 壁：キー → { color, style, hidden, disabled }
       *   hidden   … 見た目だけ消す（通れない状態は続く）
       *   disabled … 無効化。通れるようになる（「赤い線を消せ」はこれ）
       *   完全削除 … 辞書から取り除く */
      walls: {},
      /* 一方通行：壁キー → 'a2b'（上/左 → 下/右）または 'b2a' */
      oneways: {},
      /* マスの色：'r,c' → 色名 */
      cellColors: {},
      /* 置いたもの（文字・数字・記号）。○や×のチェックポイントもここに入る */
      elements: [],
      /* スタート（複数可） */
      starts: [],
      /* ゴール（複数可） */
      goals: [],
      /* 制作者が描いた正解ルート（複数可） */
      routes: [],
      /* 別盤面（ルートを重ねて文字を読むための文字盤） */
      subBoard: null,
      meta: { title: '', note: '', updatedAt: Date.now() }
    };
    fillAllWalls(maze);
    return maze;
  }

  /** すべての壁を立てる（迷路生成の出発点） */
  function fillAllWalls(maze) {
    maze.walls = {};
    for (let r = 0; r <= maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) maze.walls[hKey(r, c)] = makeWall();
    }
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c <= maze.cols; c++) maze.walls[vKey(r, c)] = makeWall();
    }
  }

  /** 外周だけ壁を立て、中はまっさらにする（手で描きたいとき用） */
  function onlyBorderWalls(maze) {
    maze.walls = {};
    for (let c = 0; c < maze.cols; c++) {
      maze.walls[hKey(0, c)] = makeWall();
      maze.walls[hKey(maze.rows, c)] = makeWall();
    }
    for (let r = 0; r < maze.rows; r++) {
      maze.walls[vKey(r, 0)] = makeWall();
      maze.walls[vKey(r, maze.cols)] = makeWall();
    }
  }

  function makeWall(color) {
    return { color: color || 'black', hidden: false, disabled: false };
  }

  /* -----------------------------------------------------------------------
   * 置くもの（文字・数字・記号）
   *   role: 'none'  … ただの文字
   *         'must'  … ここを必ず通る（○を通る）
   *         'avoid' … ここは通らない（×を避ける）
   *         'warp'  … 同じ warpGroup のマスへ移動できる
   * --------------------------------------------------------------------- */
  function makeElement(r, c, value, opt) {
    opt = opt || {};
    return {
      id: newId('el'),
      r: r, c: c,
      value: String(value),
      kind: opt.kind || guessKind(value),
      color: opt.color || 'black',
      size: opt.size || 1,
      role: opt.role || 'none',
      order: opt.order || 0,        // 「指定した順番で○を通る」で使う
      warpGroup: opt.warpGroup || '',
      hidden: false,
      disabled: false
    };
  }

  /** 文字か記号かをざっくり判定する（表示の細かい調整に使うだけ） */
  function guessKind(v) {
    const s = String(v);
    if (/^[0-9]+$/.test(s)) return 'number';
    if (SYMBOLS.indexOf(s) >= 0) return 'symbol';
    return 'text';
  }

  function makeStart(r, c, opt) {
    opt = opt || {};
    return { id: newId('st'), r: r, c: c, label: opt.label || 'S', color: opt.color || 'black' };
  }
  function makeGoal(r, c, opt) {
    opt = opt || {};
    return { id: newId('gl'), r: r, c: c, label: opt.label || 'G', color: opt.color || 'black' };
  }
  function makeRoute(cells, opt) {
    opt = opt || {};
    return {
      id: newId('rt'),
      name: opt.name || 'ルート',
      startId: opt.startId || null,
      goalId: opt.goalId || null,
      cells: (cells || []).map(function (p) { return { r: p.r, c: p.c }; })
    };
  }

  /* ----- 取り出しヘルパー ----- */
  function findById(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function elementsAt(board, r, c) {
    return board.elements.filter(function (e) { return e.r === r && e.c === c; });
  }
  /** 探索や抽出で「生きている」要素だけを返す（無効化されたものは除く） */
  function activeElements(board) {
    return board.elements.filter(function (e) { return !e.disabled; });
  }
  function cellsWithRole(board, role) {
    return activeElements(board).filter(function (e) { return e.role === role; });
  }

  /* -----------------------------------------------------------------------
   * 複製と保存
   * --------------------------------------------------------------------- */
  function cloneBoard(board) {
    return JSON.parse(JSON.stringify(board));
  }

  /** 保存用の文字列にする */
  function serialize(maze) {
    return JSON.stringify({ v: 1, maze: maze });
  }

  /** 保存した文字列から戻す。古い形でも落ちないように穴埋めする */
  function deserialize(text) {
    const data = JSON.parse(text);
    const m = data.maze || data;
    return normalize(m);
  }

  /** 足りない項目を補って、いつでも安全に使える形にそろえる */
  function normalize(m) {
    m.rows = m.rows || 10;
    m.cols = m.cols || 10;
    m.walls = m.walls || {};
    m.oneways = m.oneways || {};
    m.cellColors = m.cellColors || {};
    m.elements = m.elements || [];
    m.starts = m.starts || [];
    m.goals = m.goals || [];
    m.routes = m.routes || [];
    m.subBoard = m.subBoard || null;
    m.meta = m.meta || { title: '', note: '', updatedAt: Date.now() };
    m.elements.forEach(function (e) {
      if (!e.id) e.id = newId('el');
      if (!e.kind) e.kind = guessKind(e.value);
      if (!e.color) e.color = 'black';
      if (!e.size) e.size = 1;
      if (!e.role) e.role = 'none';
      if (e.hidden === undefined) e.hidden = false;
      if (e.disabled === undefined) e.disabled = false;
    });
    Object.keys(m.walls).forEach(function (k) {
      const w = m.walls[k];
      if (!w || typeof w !== 'object') { m.walls[k] = makeWall(); return; }
      if (!w.color) w.color = 'black';
      if (w.hidden === undefined) w.hidden = false;
      if (w.disabled === undefined) w.disabled = false;
    });
    return m;
  }

  /* -----------------------------------------------------------------------
   * 別盤面（文字盤）— ルートを重ねて文字を読むためのもの
   * --------------------------------------------------------------------- */
  function createSubBoard(rows, cols) {
    const cells = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push({ value: '', color: 'black' });
      cells.push(row);
    }
    return { rows: rows, cols: cols, cells: cells };
  }

  /** 盤面の大きさを変える（はみ出した内容は捨てる） */
  function resize(maze, rows, cols) {
    const old = cloneBoard(maze);
    maze.rows = rows;
    maze.cols = cols;
    // 壁：範囲内のものだけ残す
    const walls = {};
    Object.keys(old.walls).forEach(function (k) {
      const p = parseKey(k);
      if (p.type === 'h' && p.r <= rows && p.c < cols) walls[k] = old.walls[k];
      if (p.type === 'v' && p.r < rows && p.c <= cols) walls[k] = old.walls[k];
    });
    maze.walls = walls;
    // 一方通行も同じ条件で残す
    const ow = {};
    Object.keys(old.oneways).forEach(function (k) {
      const p = parseKey(k);
      const ok = (p.type === 'h') ? (p.r <= rows && p.c < cols) : (p.r < rows && p.c <= cols);
      if (ok) ow[k] = old.oneways[k];
    });
    maze.oneways = ow;
    // 外周は必ず壁にする
    for (let c = 0; c < cols; c++) {
      if (!maze.walls[hKey(0, c)]) maze.walls[hKey(0, c)] = makeWall();
      if (!maze.walls[hKey(rows, c)]) maze.walls[hKey(rows, c)] = makeWall();
    }
    for (let r = 0; r < rows; r++) {
      if (!maze.walls[vKey(r, 0)]) maze.walls[vKey(r, 0)] = makeWall();
      if (!maze.walls[vKey(r, cols)]) maze.walls[vKey(r, cols)] = makeWall();
    }
    const keep = function (o) { return o.r < rows && o.c < cols; };
    maze.elements = maze.elements.filter(keep);
    maze.starts = maze.starts.filter(keep);
    maze.goals = maze.goals.filter(keep);
    maze.routes.forEach(function (rt) { rt.cells = rt.cells.filter(keep); });
    const cc = {};
    Object.keys(maze.cellColors).forEach(function (k) {
      const p = k.split(',');
      if (+p[0] < rows && +p[1] < cols) cc[k] = maze.cellColors[k];
    });
    maze.cellColors = cc;
    return maze;
  }

  return {
    COLORS: COLORS, COLOR_KEYS: COLOR_KEYS, SYMBOLS: SYMBOLS,
    newId: newId,
    hKey: hKey, vKey: vKey, edgeBetween: edgeBetween, parseKey: parseKey,
    edgeCells: edgeCells, isBorderKey: isBorderKey, cellKey: cellKey, inside: inside,
    createMaze: createMaze, fillAllWalls: fillAllWalls, onlyBorderWalls: onlyBorderWalls,
    makeWall: makeWall, makeElement: makeElement, guessKind: guessKind,
    makeStart: makeStart, makeGoal: makeGoal, makeRoute: makeRoute,
    findById: findById, elementsAt: elementsAt, activeElements: activeElements,
    cellsWithRole: cellsWithRole,
    cloneBoard: cloneBoard, serialize: serialize, deserialize: deserialize, normalize: normalize,
    createSubBoard: createSubBoard, resize: resize
  };
})();
