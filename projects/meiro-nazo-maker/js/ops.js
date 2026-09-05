/* ===========================================================================
 * ops.js — ギミックの「部品」置き場
 *
 * ★このファイルの約束★
 *   ギミックは1つ1つを「入れたもの → 出てくるもの」の部品として作る。
 *   if文で場合分けした特別あつかいはしない。
 *   だから新しいギミックは、この下の register() に1つ足すだけで増やせる。
 *
 *   例）最短ルート : 迷路+START+GOAL → ルート
 *       文字を読む : ルート          → 文字
 *       色でしぼる : 文字+色         → 文字
 *       壁を消す   : 迷路+色         → 変わった迷路
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.ops = (function () {
  'use strict';
  const M = MZ.model;

  /* =======================================================================
   * 1. 読む順番（あとから種類を足せるように名前で登録しておく）
   * ===================================================================== */
  const orders = {
    route:   { label: '通った順',   fn: function (a) { return a.slice(); } },
    reverse: { label: '逆から',     fn: function (a) { return a.slice().reverse(); } },
    lr:      { label: '左 → 右',    fn: function (a) { return sortBy(a, function (x) { return [x.c, x.r]; }); } },
    rl:      { label: '右 → 左',    fn: function (a) { return sortBy(a, function (x) { return [-x.c, x.r]; }); } },
    tb:      { label: '上 → 下',    fn: function (a) { return sortBy(a, function (x) { return [x.r, x.c]; }); } },
    bt:      { label: '下 → 上',    fn: function (a) { return sortBy(a, function (x) { return [-x.r, x.c]; }); } }
  };

  const parities = {
    all:  { label: 'ぜんぶ',     fn: function (a) { return a; } },
    odd:  { label: '奇数番目',   fn: function (a) { return a.filter(function (_, i) { return i % 2 === 0; }); } },
    even: { label: '偶数番目',   fn: function (a) { return a.filter(function (_, i) { return i % 2 === 1; }); } }
  };

  function sortBy(arr, keyFn) {
    return arr.map(function (v, i) { return { v: v, i: i, k: keyFn(v) }; })
      .sort(function (a, b) {
        for (let i = 0; i < a.k.length; i++) { if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i]; }
        return a.i - b.i;
      })
      .map(function (x) { return x.v; });
  }

  /* =======================================================================
   * 2. 絞り込み
   * ===================================================================== */
  const filters = {
    includeColors: function (chars, colors) {
      if (!colors || !colors.length) return chars;
      return chars.filter(function (ch) { return colors.indexOf(ch.color) >= 0; });
    },
    excludeColors: function (chars, colors) {
      if (!colors || !colors.length) return chars;
      return chars.filter(function (ch) { return colors.indexOf(ch.color) < 0; });
    },
    kinds: function (chars, kinds) {
      if (!kinds || !kinds.length) return chars;
      return chars.filter(function (ch) { return kinds.indexOf(ch.kind) >= 0; });
    }
  };

  /* =======================================================================
   * 3. ルートの上にある文字を拾う
   *    disabled（無効化＝消された）ものは読まない。
   *    hidden（見た目だけ消した）ものは読む。
   * ===================================================================== */
  function collectOnPath(board, path, params) {
    params = params || {};
    const out = [];
    if (!path) return out;
    const byCell = {};
    board.elements.forEach(function (e) {
      if (e.disabled) return;
      (byCell[M.cellKey(e.r, e.c)] = byCell[M.cellKey(e.r, e.c)] || []).push(e);
    });
    const seen = {};
    path.forEach(function (p, i) {
      const k = M.cellKey(p.r, p.c);
      if (seen[k] && !params.allowRepeat) return;   // 同じマスを2回通っても1回だけ読む
      seen[k] = true;
      (byCell[k] || []).forEach(function (e) {
        out.push({ value: e.value, color: e.color, kind: e.kind, r: e.r, c: e.c, step: i, id: e.id });
      });
    });
    return filters.kinds(out, params.kinds);
  }

  function charsToText(chars) {
    return chars.map(function (ch) { return ch.value; }).join('');
  }

  function applyOrder(chars, orderKey, parityKey) {
    const o = orders[orderKey] || orders.route;
    let out = o.fn(chars);
    const p = parities[parityKey] || parities.all;
    return p.fn(out);
  }

  /* =======================================================================
   * 4. ルートの上に文章を自動で置く
   * ===================================================================== */
  const POOLS = {
    hiragana: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'.split(''),
    katakana: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'.split(''),
    number: '0123456789'.split(''),
    alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    symbol: M.SYMBOLS.slice()
  };

  /**
   * text を path の上に並べる
   *   mode: 'from-start' 始点から順 / 'from-goal' 終点から逆順
   *         'even' 等間隔 / 'picked' 指定したマスだけ
   */
  function autoPlaceText(board, path, text, opts) {
    opts = opts || {};
    let chars = Array.from(String(text || ''));
    if (opts.skipSpace !== false) chars = chars.filter(function (ch) { return !/\s/.test(ch); });
    if (!chars.length) return { ok: false, reason: '置く文字がありません' };
    if (!path || !path.length) return { ok: false, reason: 'ルートがありません' };

    // 同じマスを2回通る場合は1回だけ使う
    const cells = [];
    const seen = {};
    path.forEach(function (p) {
      const k = M.cellKey(p.r, p.c);
      if (seen[k]) return;
      seen[k] = true;
      cells.push(p);
    });

    let targets = [];
    const mode = opts.mode || 'from-start';
    if (mode === 'from-goal') {
      targets = cells.slice().reverse().slice(0, chars.length);
    } else if (mode === 'even') {
      const n = chars.length;
      if (n === 1) targets = [cells[0]];
      else for (let i = 0; i < n; i++) targets.push(cells[Math.round(i * (cells.length - 1) / (n - 1))]);
    } else if (mode === 'picked') {
      const idxs = opts.pickedIndices || [];
      targets = idxs.map(function (i) { return cells[i]; }).filter(Boolean).slice(0, chars.length);
    } else {
      targets = cells.slice(0, chars.length);
    }

    if (targets.length < chars.length) {
      return { ok: false, reason: 'ルートが短すぎます。' + chars.length + 'マス必要ですが ' + targets.length + 'マスしかありません' };
    }

    // 置く前に、そのマスの古い文字を片づける（記号やチェックポイントは残す）
    const placedIds = [];
    targets.forEach(function (p, i) {
      if (opts.overwrite !== false) {
        board.elements = board.elements.filter(function (e) {
          return !(e.r === p.r && e.c === p.c && e.role === 'none');
        });
      }
      const el = M.makeElement(p.r, p.c, chars[i], {
        color: opts.color || 'black',
        size: opts.size || 1
      });
      el.fromAuto = true;
      board.elements.push(el);
      placedIds.push(el.id);
    });
    return { ok: true, placed: targets.length, ids: placedIds, message: chars.length + '文字を置きました。1文字ずつ動かしたり色を変えたりできます' };
  }

  /* =======================================================================
   * 5. ダミー文字をまく（これが無いと答えが丸見えになる）
   * ===================================================================== */
  function scatterDummies(board, path, opts) {
    opts = opts || {};
    const onRoute = {};
    (path || []).forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    const occupied = {};
    board.elements.forEach(function (e) { occupied[M.cellKey(e.r, e.c)] = true; });
    board.starts.concat(board.goals).forEach(function (p) { occupied[M.cellKey(p.r, p.c)] = true; });

    const cands = [];
    for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) {
      const k = M.cellKey(r, c);
      if (occupied[k]) continue;
      if (opts.avoidRoute !== false && onRoute[k]) continue;
      cands.push({ r: r, c: c });
    }
    // 文字の種類：ルートに置いた文字と同じ字を使うといちばん紛れる
    let pool = opts.pool && opts.pool.length ? opts.pool.slice() : null;
    if (!pool) {
      const used = board.elements.filter(function (e) { return e.role === 'none'; })
        .map(function (e) { return e.value; });
      pool = used.length ? unique(used) : POOLS.hiragana;
    }
    const colors = (opts.colors && opts.colors.length) ? opts.colors : ['black'];

    shuffle(cands);
    const n = opts.count !== undefined ? Math.min(opts.count, cands.length)
      : Math.round(cands.length * (opts.density !== undefined ? opts.density : 0.5));
    const ids = [];
    for (let i = 0; i < n; i++) {
      const p = cands[i];
      const el = M.makeElement(p.r, p.c, pool[Math.floor(Math.random() * pool.length)], {
        color: colors[Math.floor(Math.random() * colors.length)]
      });
      el.isDummy = true;
      board.elements.push(el);
      ids.push(el.id);
    }
    return { ok: true, placed: n, ids: ids, message: 'ダミーを' + n + '文字まきました' };
  }

  function unique(a) { const s = {}; const o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* =======================================================================
   * 6. 盤面をひっくり返す・回す
   *    絵をひっくり返すのではなく、壁・文字・START・GOAL の位置関係ごと変える
   * ===================================================================== */
  function mapPoint(kind, board, r, c) {
    if (kind === 'flip-h') return { r: r, c: board.cols - 1 - c };
    if (kind === 'flip-v') return { r: board.rows - 1 - r, c: c };
    return { r: board.rows - 1 - r, c: board.cols - 1 - c };   // rotate180
  }

  function mapEdgeKey(kind, board, key) {
    const k = M.parseKey(key);
    if (kind === 'flip-h') {
      return k.type === 'h' ? M.hKey(k.r, board.cols - 1 - k.c) : M.vKey(k.r, board.cols - k.c);
    }
    if (kind === 'flip-v') {
      return k.type === 'h' ? M.hKey(board.rows - k.r, k.c) : M.vKey(board.rows - 1 - k.r, k.c);
    }
    return k.type === 'h' ? M.hKey(board.rows - k.r, board.cols - 1 - k.c)
                          : M.vKey(board.rows - 1 - k.r, board.cols - k.c);
  }

  function flipDir(d) { return d === 'a2b' ? 'b2a' : 'a2b'; }

  /** 一方通行の向きも一緒に直す（ここを忘れると解けない迷路になる） */
  function mapOneway(kind, key, dir) {
    const k = M.parseKey(key);
    if (kind === 'flip-h') return k.type === 'v' ? flipDir(dir) : dir;
    if (kind === 'flip-v') return k.type === 'h' ? flipDir(dir) : dir;
    return flipDir(dir);   // rotate180 は縦横どちらも反対になる
  }

  function transformBoard(board, kind) {
    const out = M.cloneBoard(board);
    out.walls = {};
    Object.keys(board.walls).forEach(function (k) { out.walls[mapEdgeKey(kind, board, k)] = board.walls[k]; });
    out.oneways = {};
    Object.keys(board.oneways || {}).forEach(function (k) {
      out.oneways[mapEdgeKey(kind, board, k)] = mapOneway(kind, k, board.oneways[k]);
    });
    out.cellColors = {};
    Object.keys(board.cellColors || {}).forEach(function (k) {
      const p = k.split(',');
      const q = mapPoint(kind, board, +p[0], +p[1]);
      out.cellColors[M.cellKey(q.r, q.c)] = board.cellColors[k];
    });
    const move = function (o) { const q = mapPoint(kind, board, o.r, o.c); o.r = q.r; o.c = q.c; };
    out.elements.forEach(move);
    out.starts.forEach(move);
    out.goals.forEach(move);
    out.routes.forEach(function (rt) { rt.cells.forEach(move); });
    return out;
  }

  /** ルート（道すじ）そのものも同じように変える */
  function transformPath(path, board, kind) {
    if (!path) return path;
    return path.map(function (p) { return mapPoint(kind, board, p.r, p.c); });
  }

  /* =======================================================================
   * 7. ルートの「形」を取り出す（次の謎に使うため）
   * ===================================================================== */
  function routeShape(path) {
    if (!path || !path.length) return null;
    let r0 = Infinity, c0 = Infinity, r1 = -Infinity, c1 = -Infinity;
    path.forEach(function (p) {
      r0 = Math.min(r0, p.r); c0 = Math.min(c0, p.c);
      r1 = Math.max(r1, p.r); c1 = Math.max(c1, p.c);
    });
    const dirs = [];
    for (let i = 1; i < path.length; i++) {
      const dr = path[i].r - path[i - 1].r, dc = path[i].c - path[i - 1].c;
      if (dr === -1) dirs.push('上'); else if (dr === 1) dirs.push('下');
      else if (dc === -1) dirs.push('左'); else if (dc === 1) dirs.push('右');
      else dirs.push('ワープ');
    }
    const segments = [];
    for (let i = 1; i < path.length; i++) segments.push({ from: path[i - 1], to: path[i] });
    return {
      cells: path.map(function (p) { return { r: p.r, c: p.c }; }),
      normalized: path.map(function (p) { return { r: p.r - r0, c: p.c - c0 }; }),
      segments: segments,
      dirs: dirs,
      bbox: { r0: r0, c0: c0, r1: r1, c1: c1, rows: r1 - r0 + 1, cols: c1 - c0 + 1 }
    };
  }

  /* =======================================================================
   * 8. ルートで囲まれた中のマスを取り出す
   *    （外側から水を流して、届かなかったところが「囲まれた中」）
   * ===================================================================== */
  function enclosedCells(board, path) {
    const wall = {};
    (path || []).forEach(function (p) { wall[M.cellKey(p.r, p.c)] = true; });
    const seen = {};
    const queue = [];
    const push = function (r, c) {
      if (r < 0 || c < 0 || r >= board.rows || c >= board.cols) return;
      const k = M.cellKey(r, c);
      if (seen[k] || wall[k]) return;
      seen[k] = true; queue.push({ r: r, c: c });
    };
    for (let c = 0; c < board.cols; c++) { push(0, c); push(board.rows - 1, c); }
    for (let r = 0; r < board.rows; r++) { push(r, 0); push(r, board.cols - 1); }
    let head = 0;
    while (head < queue.length) {
      const p = queue[head++];
      push(p.r - 1, p.c); push(p.r + 1, p.c); push(p.r, p.c - 1); push(p.r, p.c + 1);
    }
    const out = [];
    for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) {
      const k = M.cellKey(r, c);
      if (!seen[k] && !wall[k]) out.push({ r: r, c: c });
    }
    return out;
  }

  /* =======================================================================
   * 9. ルートの形を別の盤面（文字盤）に重ねて読む
   * ===================================================================== */
  function transferToSubBoard(shape, sub, opts) {
    opts = opts || {};
    if (!shape || !sub) return { ok: false, reason: 'ルートの形か、別盤面がありません' };
    const dr = opts.offsetR || 0, dc = opts.offsetC || 0;
    const src = opts.useOriginal ? shape.cells : shape.normalized;
    const chars = [];
    let outside = 0;
    src.forEach(function (p, i) {
      const r = p.r + dr, c = p.c + dc;
      if (r < 0 || c < 0 || r >= sub.rows || c >= sub.cols) { outside++; return; }
      const cellData = sub.cells[r][c];
      if (cellData && cellData.value) {
        chars.push({ value: cellData.value, color: cellData.color || 'black', kind: M.guessKind(cellData.value), r: r, c: c, step: i });
      }
    });
    return { ok: true, chars: chars, outside: outside };
  }

  /* =======================================================================
   * 10. ギミック部品の登録所
   *     すべて { 入れたもの → 出てくるもの } の形にそろえてある
   * ===================================================================== */
  const registry = {};
  const order = [];

  function register(def) { registry[def.id] = def; order.push(def.id); return def; }
  function list() { return order.map(function (id) { return registry[id]; }); }
  function get(id) { return registry[id]; }

  /**
   * 新しいSTART/GOALの場所をさがす
   *   ① 記号で指定（「黄色い★をGOALにせよ」など）
   *   ② すでに置いてあるSTART/GOALのIDで指定
   *   ③ 行・列の数字で指定
   */
  function findPoint(board, p, idKey, list) {
    if (p.symbol) {
      const hit = M.activeElements(board).filter(function (e) {
        if (e.value !== p.symbol) return false;
        if (p.symbolColor && e.color !== p.symbolColor) return false;
        return true;
      })[0];
      if (hit) return { r: hit.r, c: hit.c };
      return null;
    }
    if (p[idKey]) {
      const f = M.findById(list, p[idKey]);
      if (f) return { r: f.r, c: f.c };
    }
    if (p.r !== null && p.r !== undefined && p.c !== null && p.c !== undefined) return { r: p.r, c: p.c };
    return null;
  }

  function pointOf(board, spec) {
    if (!spec) return null;
    if (typeof spec === 'string') {
      const s = M.findById(board.starts, spec) || M.findById(board.goals, spec);
      return s ? { r: s.r, c: s.c } : null;
    }
    return spec;
  }

  /* ---- 迷路を解く ---- */
  register({
    id: 'solve', label: '最短ルートを通る', group: 'とく',
    inputs: '迷路 + START + GOAL', outputs: 'ルート',
    defaults: { startId: '', goalId: '', useMust: false, ordered: false, useAvoid: true, useWarp: false },
    describe: function (p) {
      let s = '最短ルート';
      if (p.useMust) s += p.ordered ? '（○を順番に）' : '（○を全部通る）';
      return s;
    },
    run: function (ctx, p) {
      const res = MZ.engine.solve(ctx.board, {
        start: p.startId || undefined, goal: p.goalId || undefined,
        useMust: p.useMust, ordered: p.ordered, useAvoid: p.useAvoid !== false, useWarp: p.useWarp
      });
      if (!res.ok) return { error: res.reason };
      return {
        path: res.path,
        log: '長さ ' + res.dist + 'マス' + (res.multiple ? '／同じ長さの道が ' + (res.capped ? 'たくさん' : res.count) + '通りあります' : '／道は1本だけ'),
        warn: res.multiple ? '最短ルートが複数あります' : null,
        info: res
      };
    }
  });

  /* ---- 制作者が描いたルートを使う ---- */
  register({
    id: 'route-drawn', label: '描いた正解ルートを使う', group: 'とく',
    inputs: '正解ルート', outputs: 'ルート',
    defaults: { routeId: '' },
    describe: function () { return '描いた正解ルート'; },
    run: function (ctx, p) {
      const rt = p.routeId ? M.findById(ctx.board.routes, p.routeId) : ctx.board.routes[0];
      if (!rt || !rt.cells.length) return { error: '正解ルートが描かれていません' };
      return { path: rt.cells.slice(), log: '長さ ' + (rt.cells.length - 1) + 'マス' };
    }
  });

  /* ---- ルート上の文字を読む ---- */
  register({
    id: 'extract', label: 'ルートの文字を読む', group: 'よむ',
    inputs: 'ルート', outputs: '文字',
    defaults: { kinds: [], order: 'route', parity: 'all' },
    describe: function (p) {
      const o = orders[p.order] ? orders[p.order].label : '通った順';
      return '文字を読む（' + o + '）';
    },
    run: function (ctx, p) {
      if (!ctx.path) return { error: '先にルートを出すSTEPが必要です' };
      let chars = collectOnPath(ctx.board, ctx.path, { kinds: p.kinds });
      chars = applyOrder(chars, p.order, p.parity);
      return { chars: chars, text: charsToText(chars), log: '「' + charsToText(chars) + '」' };
    }
  });

  /* ---- 色でしぼる ---- */
  register({
    id: 'filter-color', label: '色でしぼる', group: 'よむ',
    inputs: '文字 + 色', outputs: '文字',
    defaults: { mode: 'include', colors: ['red'] },
    describe: function (p) {
      const names = (p.colors || []).map(function (c) { return M.COLORS[c] ? M.COLORS[c].label : c; }).join('・');
      if (!names) return '色でしぼる（色が未設定）';
      return (p.mode === 'exclude' ? names + '以外を読む' : names + 'だけ読む');
    },
    run: function (ctx, p) {
      if (!ctx.chars) return { error: '先に文字を読むSTEPが必要です' };
      const chars = p.mode === 'exclude'
        ? filters.excludeColors(ctx.chars, p.colors)
        : filters.includeColors(ctx.chars, p.colors);
      return { chars: chars, text: charsToText(chars), log: '「' + charsToText(chars) + '」' };
    }
  });

  /* ---- 読む順を変える ---- */
  register({
    id: 'reorder', label: '読む順を変える', group: 'よむ',
    inputs: '文字', outputs: '文字',
    defaults: { order: 'reverse', parity: 'all' },
    describe: function (p) {
      const o = orders[p.order] ? orders[p.order].label : '通った順';
      const q = parities[p.parity] && p.parity !== 'all' ? '・' + parities[p.parity].label : '';
      return '読む順：' + o + q;
    },
    run: function (ctx, p) {
      if (!ctx.chars) return { error: '先に文字を読むSTEPが必要です' };
      const chars = applyOrder(ctx.chars, p.order, p.parity);
      return { chars: chars, text: charsToText(chars), log: '「' + charsToText(chars) + '」' };
    }
  });

  /* ---- 壁を消す ---- */
  register({
    id: 'remove-walls', label: '線（壁）を消す', group: 'かえる',
    inputs: '迷路 + 色', outputs: '変わった迷路',
    defaults: { colors: ['red'], mode: 'disable' },
    describe: function (p) {
      const names = (p.colors || []).map(function (c) { return M.COLORS[c] ? M.COLORS[c].label : c; }).join('・');
      return (names || 'すべて') + 'の線を消す';
    },
    run: function (ctx, p) {
      const board = M.cloneBoard(ctx.board);
      let n = 0;
      Object.keys(board.walls).forEach(function (k) {
        const w = board.walls[k];
        if (!w) return;
        if (p.colors && p.colors.length && p.colors.indexOf(w.color) < 0) return;
        if (p.mode === 'delete') { delete board.walls[k]; n++; }
        else if (p.mode === 'hide') { w.hidden = true; n++; }
        else { w.disabled = true; n++; }      // 通れるようになる
      });
      if (!n) return { board: board, warn: 'その色の線が1本もありません', log: '0本' };
      return { board: board, log: n + '本の線を消しました', path: null, chars: null, text: null };
    }
  });

  /* ---- 文字・記号を消す ---- */
  register({
    id: 'remove-elements', label: '文字・記号を消す', group: 'かえる',
    inputs: '迷路 + 色/種類', outputs: '変わった迷路',
    defaults: { colors: [], kinds: [], values: '', mode: 'disable' },
    describe: function (p) {
      const names = (p.colors || []).map(function (c) { return M.COLORS[c] ? M.COLORS[c].label : c; }).join('・');
      const vals = (p.values || '').trim();
      return (names ? names + 'の' : '') + (vals ? '「' + vals + '」' : '文字') + 'を消す';
    },
    run: function (ctx, p) {
      const board = M.cloneBoard(ctx.board);
      const vals = Array.from((p.values || '').trim());
      let n = 0;
      const hit = function (e) {
        if (p.colors && p.colors.length && p.colors.indexOf(e.color) < 0) return false;
        if (p.kinds && p.kinds.length && p.kinds.indexOf(e.kind) < 0) return false;
        if (vals.length && vals.indexOf(e.value) < 0) return false;
        return true;
      };
      if (p.mode === 'delete') {
        const before = board.elements.length;
        board.elements = board.elements.filter(function (e) { return !hit(e); });
        n = before - board.elements.length;
      } else {
        board.elements.forEach(function (e) {
          if (!hit(e)) return;
          if (p.mode === 'hide') e.hidden = true; else e.disabled = true;
          n++;
        });
      }
      return { board: board, log: n + '個を消しました', warn: n ? null : '消える文字がありません' };
    }
  });

  /* ---- STARTを変える ---- */
  register({
    id: 'set-start', label: 'STARTを変える', group: 'かえる',
    inputs: '迷路 + 新しいSTART', outputs: '変わった迷路',
    defaults: { startId: '', symbol: '', symbolColor: '', r: null, c: null },
    describe: function (p) {
      if (p.symbol) return (p.symbolColor && M.COLORS[p.symbolColor] ? M.COLORS[p.symbolColor].label : '') + p.symbol + 'をSTARTにする';
      return 'STARTを変える';
    },
    run: function (ctx, p) {
      const board = M.cloneBoard(ctx.board);
      let pt = findPoint(board, p, 'startId', board.starts);
      if (!pt) return { error: '新しいSTARTが選ばれていません（記号か場所を指定してください）' };
      board.starts = [M.makeStart(pt.r, pt.c, { label: 'S' })];
      return { board: board, log: '(' + (pt.r + 1) + '行, ' + (pt.c + 1) + '列) をSTARTにしました', path: null };
    }
  });

  /* ---- GOALを変える ---- */
  register({
    id: 'set-goal', label: 'GOALを変える', group: 'かえる',
    inputs: '迷路 + 新しいGOAL', outputs: '変わった迷路',
    defaults: { goalId: '', symbol: '', symbolColor: '', r: null, c: null },
    describe: function (p) {
      if (p.symbol) return (p.symbolColor && M.COLORS[p.symbolColor] ? M.COLORS[p.symbolColor].label : '') + p.symbol + 'をGOALにする';
      return 'GOALを変える';
    },
    run: function (ctx, p) {
      const board = M.cloneBoard(ctx.board);
      let pt = findPoint(board, p, 'goalId', board.goals);
      if (!pt) return { error: '新しいGOALが選ばれていません（記号か場所を指定してください）' };
      board.goals = [M.makeGoal(pt.r, pt.c, { label: 'G' })];
      return { board: board, log: '(' + (pt.r + 1) + '行, ' + (pt.c + 1) + '列) をGOALにしました', path: null };
    }
  });

  /* ---- ひっくり返す・回す ---- */
  [
    { id: 'flip-h', label: '左右を反転する（鏡）', done: '左右を反転しました' },
    { id: 'flip-v', label: '上下を反転する', done: '上下を反転しました' },
    { id: 'rotate180', label: '180度まわす', done: '180度まわしました' }
  ].forEach(function (t) {
    register({
      id: t.id, label: t.label, group: 'かえる',
      inputs: '迷路', outputs: '変わった迷路',
      defaults: {},
      describe: function () { return t.label; },
      run: function (ctx) {
        const board = transformBoard(ctx.board, t.id);
        return {
          board: board,
          path: ctx.path ? transformPath(ctx.path, ctx.board, t.id) : null,
          log: t.done
        };
      }
    });
  });

  /* ---- ルートの形を取り出す ---- */
  register({
    id: 'route-shape', label: 'ルートの形を取り出す', group: 'つかう',
    inputs: 'ルート', outputs: '形',
    defaults: {},
    describe: function () { return 'ルートの形を取り出す'; },
    run: function (ctx) {
      if (!ctx.path) return { error: '先にルートを出すSTEPが必要です' };
      const sh = routeShape(ctx.path);
      return { shape: sh, log: sh.bbox.rows + '×' + sh.bbox.cols + 'の形（' + sh.dirs.join('') + '）' };
    }
  });

  /* ---- 別盤面に重ねて読む ---- */
  register({
    id: 'transfer', label: '別の盤面に重ねて読む', group: 'つかう',
    inputs: '形 + 別盤面', outputs: '文字',
    defaults: { offsetR: 0, offsetC: 0, useOriginal: false, order: 'route', parity: 'all' },
    describe: function () { return '別の盤面に重ねて読む'; },
    run: function (ctx, p) {
      const shape = ctx.shape || (ctx.path ? routeShape(ctx.path) : null);
      if (!shape) return { error: '先にルートか形を出すSTEPが必要です' };
      if (!ctx.board.subBoard) return { error: '別盤面（文字盤）がまだ作られていません' };
      const res = transferToSubBoard(shape, ctx.board.subBoard, p);
      if (!res.ok) return { error: res.reason };
      const chars = applyOrder(res.chars, p.order, p.parity);
      return {
        chars: chars, text: charsToText(chars),
        log: '「' + charsToText(chars) + '」' + (res.outside ? '（' + res.outside + 'マスが盤面の外）' : ''),
        warn: res.outside ? 'ルートの形が別盤面からはみ出しています' : null
      };
    }
  });

  /* ---- 囲まれた中を読む ---- */
  register({
    id: 'enclosed', label: '囲まれた中の文字を読む', group: 'つかう',
    inputs: '形 + 迷路', outputs: '文字',
    defaults: { order: 'tb', parity: 'all' },
    describe: function () { return '囲まれた中の文字を読む'; },
    run: function (ctx, p) {
      if (!ctx.path) return { error: '先にルートを出すSTEPが必要です' };
      const cells = enclosedCells(ctx.board, ctx.path);
      if (!cells.length) return { chars: [], text: '', warn: 'ルートが輪になっていないため、囲まれた場所がありません', log: '0マス' };
      let chars = collectOnPath(ctx.board, cells, {});
      chars = applyOrder(chars, p.order, p.parity);
      return { chars: chars, text: charsToText(chars), cells: cells, log: cells.length + 'マス →「' + charsToText(chars) + '」' };
    }
  });

  /* ---- 最終こたえ ---- */
  register({
    id: 'answer', label: '最終こたえ', group: 'しめ',
    inputs: '文字', outputs: 'こたえ',
    defaults: { expected: '' },
    describe: function (p) { return p.expected ? 'こたえ：' + p.expected : '最終こたえ'; },
    run: function (ctx, p) {
      const got = ctx.text || '';
      if (!p.expected) return { text: got, log: '「' + got + '」', answer: got };
      const ok = got === p.expected;
      return {
        text: got, answer: got,
        log: '「' + got + '」' + (ok ? ' ＝ 想定どおり' : ' ／ 想定は「' + p.expected + '」'),
        warn: ok ? null : '想定したこたえと違います'
      };
    }
  });

  return {
    orders: orders, parities: parities, filters: filters,
    registry: registry, register: register, list: list, get: get,
    collectOnPath: collectOnPath, charsToText: charsToText, applyOrder: applyOrder,
    autoPlaceText: autoPlaceText, scatterDummies: scatterDummies, POOLS: POOLS,
    transformBoard: transformBoard, transformPath: transformPath,
    routeShape: routeShape, enclosedCells: enclosedCells, transferToSubBoard: transferToSubBoard
  };
})();
