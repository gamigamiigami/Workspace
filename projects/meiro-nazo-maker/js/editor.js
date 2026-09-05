/* ===========================================================================
 * editor.js — キャンバスの上での操作を受けもつ
 *
 * 迷路を「さわって作る」ところ。壁を引く・ルートを描く・文字を置く・動かす。
 * Undo / Redo、ズーム、指での操作（iPad）もここで面倒を見る。
 *
 * タッチの注意（過去にハマった点）
 *   ・ダブルタップ拡大の抑止は CSS の touch-action にまかせる
 *     （JSでタップ回数を数える実装は、連続タップまで潰してしまう）
 *   ・キャンバスは touch-action:none にして、指2本のときだけ拡大・移動
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.editor = (function () {
  'use strict';
  const M = MZ.model;
  const R = MZ.render;

  const S = {
    canvas: null, wrap: null, ctx: null, input: null,
    maze: null,
    view: { scale: 1, tx: 0, ty: 0 },
    tool: 'select',
    routeIndex: 0,           // いま描いている「描いたルート」の番号
    color: 'black',
    symbol: '○',
    role: 'none',
    warpGroup: 'A',
    size: 1,
    pendingText: '',
    selection: [],
    history: [], future: [],
    display: null,           // STEPの結果を見ているときはここに入る（編集はできない）
    renderOpts: {},
    drag: null,
    pointers: {},
    pinch: null,
    marquee: null,
    editingCell: null,
    composing: false,
    histLenBefore: undefined,
    hooks: {}                // onChange / onStatus / onSelect
  };

  const HISTORY_MAX = 80;

  /* =======================================================================
   * 準備
   * ===================================================================== */
  function init(cfg) {
    S.canvas = cfg.canvas;
    S.wrap = cfg.wrap;
    S.input = cfg.input;
    S.ctx = S.canvas.getContext('2d');
    S.maze = cfg.maze;
    S.hooks = cfg.hooks || {};

    S.canvas.addEventListener('pointerdown', onPointerDown);
    S.canvas.addEventListener('pointermove', onPointerMove);
    S.canvas.addEventListener('pointerup', onPointerUp);
    S.canvas.addEventListener('pointercancel', onPointerUp);
    S.canvas.addEventListener('wheel', onWheel, { passive: false });
    S.canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('resize', function () { draw(); });

    setupInlineInput();
    fit();
  }

  function setMaze(m) { S.maze = m; S.selection = []; S.history = []; S.future = []; fit(); }
  function getMaze() { return S.maze; }

  /** いま画面に出ている盤面（STEPを見ているときはその結果） */
  function shownBoard() { return (S.display && S.display.board) || S.maze; }
  function isReadOnly() { return !!(S.display && S.display.readOnly); }

  function setDisplay(d) { S.display = d; S.selection = []; draw(); }
  function clearDisplay() { S.display = null; draw(); }

  function set(k, v) { S[k] = v; if (k === 'tool') { closeInlineInput(); S.selection = []; } draw(); status(); }

  /* =======================================================================
   * 元にもどす／やりなおす
   * ===================================================================== */
  function pushHistory() {
    if (isReadOnly()) return;
    S.history.push(JSON.stringify(S.maze));
    if (S.history.length > HISTORY_MAX) S.history.shift();
    S.future.length = 0;
  }
  function undo() {
    if (!S.history.length) { status('これ以上もどせません'); return; }
    S.future.push(JSON.stringify(S.maze));
    const prev = S.history.pop();
    replaceMaze(JSON.parse(prev));
    changed('undo');
  }
  function redo() {
    if (!S.future.length) { status('やりなおすものがありません'); return; }
    S.history.push(JSON.stringify(S.maze));
    replaceMaze(JSON.parse(S.future.pop()));
    changed('redo');
  }
  function replaceMaze(obj) {
    // 参照を保ったまま中身を入れかえる（外から maze を持っている側が困らないように）
    Object.keys(S.maze).forEach(function (k) { delete S.maze[k]; });
    Object.keys(obj).forEach(function (k) { S.maze[k] = obj[k]; });
    S.selection = [];
  }
  function canUndo() { return S.history.length > 0; }
  function canRedo() { return S.future.length > 0; }

  function changed(why) {
    if (S.hooks.onChange) S.hooks.onChange(why);
    draw();
  }
  function status(msg) { if (S.hooks.onStatus) S.hooks.onStatus(msg); }

  /* =======================================================================
   * 表示（ズーム・移動）
   * ===================================================================== */
  function baseOpts() {
    const o = Object.assign({}, S.renderOpts);
    o.cellPx = o.cellPx || 40;
    return o;
  }

  function fit() {
    const b = shownBoard();
    if (!b || !S.wrap) return;
    const m = R.measure(b, baseOpts());
    const w = S.wrap.clientWidth || 600, h = S.wrap.clientHeight || 400;
    const sc = Math.min((w - 24) / m.width, (h - 24) / m.height);
    S.view.scale = Math.max(0.15, Math.min(3, sc));
    S.view.tx = (w - m.width * S.view.scale) / 2;
    S.view.ty = (h - m.height * S.view.scale) / 2;
    draw();
  }

  function zoomAt(factor, sx, sy) {
    const old = S.view.scale;
    const next = Math.max(0.15, Math.min(4, old * factor));
    if (next === old) return;
    // 指やカーソルの下の点が動かないように寄せる
    S.view.tx = sx - (sx - S.view.tx) * (next / old);
    S.view.ty = sy - (sy - S.view.ty) * (next / old);
    S.view.scale = next;
    draw();
  }
  function zoom(factor) {
    const w = S.wrap.clientWidth / 2, h = S.wrap.clientHeight / 2;
    zoomAt(factor, w, h);
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const p = screenPoint(e);
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.sx, p.sy);
    } else {
      S.view.tx -= e.deltaX;
      S.view.ty -= e.deltaY;
      draw();
    }
  }

  /* =======================================================================
   * 描く
   * ===================================================================== */
  function draw() {
    if (!S.ctx || !S.wrap) return;
    const board = shownBoard();
    if (!board) return;
    const dpr = window.devicePixelRatio || 1;
    const w = S.wrap.clientWidth, h = S.wrap.clientHeight;
    if (!w || !h) return;
    S.canvas.width = Math.round(w * dpr);
    S.canvas.height = Math.round(h * dpr);
    S.canvas.style.width = w + 'px';
    S.canvas.style.height = h + 'px';
    const ctx = S.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#eef1f5';
    ctx.fillRect(0, 0, w, h);

    const o = baseOpts();
    o.selection = S.selection;
    if (S.display) {
      o.routePath = S.display.path || null;
      o.showRoute = !!S.display.path;
      if (S.display.opts) Object.assign(o, S.display.opts);
      if (S.display.cells) o.highlightCells = S.display.cells;
    } else {
      const rt = S.maze.routes[S.routeIndex];
      o.routePath = (S.renderOpts.routePath !== undefined) ? S.renderOpts.routePath : (rt ? rt.cells : null);
      if (S.renderOpts.showRoute === undefined) o.showRoute = !!o.routePath;
    }

    ctx.save();
    ctx.translate(S.view.tx, S.view.ty);
    ctx.scale(S.view.scale, S.view.scale);
    // 盤の下じき（白い紙）
    const m = R.measure(board, o);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    ctx.fillRect(0, 0, m.width, m.height);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    R.drawBoard(ctx, board, o);
    ctx.restore();

    // 範囲選択の枠（画面の座標でそのまま描く）
    if (S.marquee) {
      ctx.save();
      ctx.strokeStyle = '#4dabf7'; ctx.fillStyle = 'rgba(77,171,247,0.15)';
      ctx.lineWidth = 1.5;
      const r = normRect(S.marquee);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    if (S.hooks.onDraw) S.hooks.onDraw();
  }

  function normRect(m) {
    return {
      x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1),
      w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0)
    };
  }

  /* =======================================================================
   * 座標の変換
   * ===================================================================== */
  function screenPoint(e) {
    const rect = S.canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }
  function boardPoint(e) {
    const p = screenPoint(e);
    return { x: (p.sx - S.view.tx) / S.view.scale, y: (p.sy - S.view.ty) / S.view.scale, sx: p.sx, sy: p.sy };
  }
  function cellOf(e) { return R.cellAt(shownBoard(), boardPoint(e).x, boardPoint(e).y, baseOpts()); }
  function edgeOf(e) { return R.edgeAt(shownBoard(), boardPoint(e).x, boardPoint(e).y, baseOpts()); }

  /** いま描いているルート（無ければ作る） */
  function activeRoute(board) {
    if (!board.routes) board.routes = [];
    while (board.routes.length <= S.routeIndex) board.routes.push(M.makeRoute([]));
    return board.routes[S.routeIndex];
  }

  /** 押した場所が、盤（白い紙）の外かどうか */
  function outsideBoard(e) {
    const b = shownBoard();
    if (!b) return true;
    const m = R.measure(b, baseOpts());
    const p = boardPoint(e);
    const slack = m.cell * 0.35;
    return p.x < m.pad - slack || p.y < m.originY - slack ||
           p.x > m.pad + b.cols * m.cell + slack ||
           p.y > m.originY + b.rows * m.cell + slack;
  }

  function elementAt(board, r, c) {
    const list = board.elements.filter(function (el) { return el.r === r && el.c === c; });
    return list.length ? list[list.length - 1] : null;
  }

  /* =======================================================================
   * ポインタ操作（マウス・指・ペン 共通）
   * ===================================================================== */
  function onPointerDown(e) {
    // pointerdown の直後にブラウザが mousedown を出し、その既定動作でフォーカスが奪われる。
    // マスに重ねた入力欄に文字を打てるようにするため、ここで既定動作を止めておく。
    if (e.cancelable) e.preventDefault();
    S.canvas.setPointerCapture(e.pointerId);
    S.pointers[e.pointerId] = screenPoint(e);
    const n = Object.keys(S.pointers).length;

    if (n === 2) {                       // 指2本 → 拡大・移動に切りかえ
      // 1本目の指が触れた時点で道具が動いてしまっているので、それを取り消す
      // （ピンチのつもりが「ルートが切れた」「壁が消えた」になるのを防ぐ）
      cancelPendingEdit();
      S.drag = null; S.marquee = null;
      const ps = Object.keys(S.pointers).map(function (k) { return S.pointers[k]; });
      S.pinch = { d: dist(ps[0], ps[1]), mid: mid(ps[0], ps[1]), scale: S.view.scale, tx: S.view.tx, ty: S.view.ty };
      return;
    }
    if (n > 2) return;

    closeInlineInput();
    // 盤の外側をつかんだら画面を動かす（「うごかす」道具をなくしたかわり）
    // 指2本でも動かせるが、マウスの人はこちらのほうが分かりやすい
    if (e.button === 1 || outsideBoard(e)) {
      S.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: S.view.tx, ty: S.view.ty };
      return;
    }
    if (isReadOnly()) { status('STEPの結果を見ています。編集するには「設計図」を選んでください'); return; }
    S.histLenBefore = S.history.length;
    startTool(e);
  }

  /** 直前のポインタ操作でした変更を取り消す（ピンチに切りかわったときなど） */
  function cancelPendingEdit() {
    if (S.histLenBefore === undefined) return;
    let snap = null;
    while (S.history.length > S.histLenBefore) snap = S.history.pop();
    S.histLenBefore = undefined;
    if (snap) { replaceMaze(JSON.parse(snap)); changed('cancel'); }
  }

  function onPointerMove(e) {
    if (S.pointers[e.pointerId]) S.pointers[e.pointerId] = screenPoint(e);
    const n = Object.keys(S.pointers).length;

    if (n === 2 && S.pinch) {
      const ps = Object.keys(S.pointers).map(function (k) { return S.pointers[k]; });
      const d = dist(ps[0], ps[1]);
      const m2 = mid(ps[0], ps[1]);
      const f = d / (S.pinch.d || 1);
      S.view.scale = Math.max(0.15, Math.min(4, S.pinch.scale * f));
      S.view.tx = m2.sx - (S.pinch.mid.sx - S.pinch.tx) * (S.view.scale / S.pinch.scale);
      S.view.ty = m2.sy - (S.pinch.mid.sy - S.pinch.ty) * (S.view.scale / S.pinch.scale);
      draw();
      return;
    }
    if (!S.drag && !S.marquee) { hoverTool(e); return; }
    if (S.drag && S.drag.kind === 'pan') {
      S.view.tx = S.drag.tx + (e.clientX - S.drag.sx);
      S.view.ty = S.drag.ty + (e.clientY - S.drag.sy);
      draw();
      return;
    }
    moveTool(e);
  }

  function onPointerUp(e) {
    delete S.pointers[e.pointerId];
    if (Object.keys(S.pointers).length < 2) S.pinch = null;
    if (S.marquee) finishMarquee();
    if (S.drag && S.drag.kind !== 'pan' && S.drag.dirty) changed('edit');
    S.drag = null;
    S.histLenBefore = undefined;
    draw();
  }

  function dist(a, b) { return Math.hypot(a.sx - b.sx, a.sy - b.sy); }
  function mid(a, b) { return { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 }; }

  /* =======================================================================
   * 道具ごとのふるまい
   * ===================================================================== */
  function startTool(e) {
    const board = S.maze;
    const cell = cellOf(e);
    const t = S.tool;

    if (t === 'wall') {
      const key = edgeOf(e);
      if (!key) return;
      pushHistory();
      const exists = board.walls[key];
      const mode = exists ? 'erase' : 'add';
      S.drag = { kind: 'wall', mode: mode, dirty: true, done: {} };
      applyWall(key, mode);
      draw();
      return;
    }

    if (t === 'oneway') {
      const key = edgeOf(e);
      if (!key) return;
      if (board.walls[key] && !board.walls[key].disabled) { status('ここは壁です。先に壁を消すと一方通行にできます'); return; }
      pushHistory();
      const cur = board.oneways[key];
      if (!cur) board.oneways[key] = 'a2b';
      else if (cur === 'a2b') board.oneways[key] = 'b2a';
      else delete board.oneways[key];
      changed('edit');
      return;
    }

    if (!cell) return;

    if (t === 'route') {
      pushHistory();
      let rt = activeRoute(board);
      const at = lastIndexInRoute(rt.cells, cell);
      if (at >= 0) {
        // すでに通っているマスを押した → そこから先を消して描き直せるようにする
        // （交差もできるので、いちばん後ろに通ったところから切る）
        rt.cells = rt.cells.slice(0, at + 1);
      } else if (!rt.cells.length || adjacent(rt.cells[rt.cells.length - 1], cell)) {
        rt.cells.push({ r: cell.r, c: cell.c });
      } else {
        rt.cells = [{ r: cell.r, c: cell.c }];   // 離れた場所 → 新しく引き直す
      }
      S.drag = { kind: 'route', dirty: true };
      changed('edit');
      return;
    }

    if (t === 'text') { openInlineInput(cell); return; }

    if (t === 'symbol') {
      pushHistory();
      const ex = elementAt(board, cell.r, cell.c);
      if (ex && ex.value === S.symbol && ex.role === S.role) {
        board.elements = board.elements.filter(function (x) { return x.id !== ex.id; });
      } else {
        board.elements.push(M.makeElement(cell.r, cell.c, S.symbol, {
          color: S.color, size: S.size, role: S.role,
          warpGroup: S.role === 'warp' ? S.warpGroup : ''
        }));
      }
      S.drag = { kind: 'symbol', dirty: true, done: {} };
      S.drag.done[M.cellKey(cell.r, cell.c)] = true;
      changed('edit');
      return;
    }

    if (t === 'start' || t === 'goal') {
      pushHistory();
      const list = t === 'start' ? board.starts : board.goals;
      const found = list.filter(function (p) { return p.r === cell.r && p.c === cell.c; })[0];
      if (found) {
        if (t === 'start') board.starts = board.starts.filter(function (p) { return p.id !== found.id; });
        else board.goals = board.goals.filter(function (p) { return p.id !== found.id; });
      } else {
        const label = t === 'start' ? 'S' : 'G';
        const n = list.length;
        const mk = t === 'start' ? M.makeStart : M.makeGoal;
        list.push(mk(cell.r, cell.c, { label: n ? label + (n + 1) : label, color: S.color }));
      }
      changed('edit');
      return;
    }

    if (t === 'cellcolor') {
      pushHistory();
      const k = M.cellKey(cell.r, cell.c);
      if (board.cellColors[k] === S.color) delete board.cellColors[k];
      else board.cellColors[k] = S.color;
      S.drag = { kind: 'cellcolor', dirty: true, done: {} };
      S.drag.done[k] = true;
      changed('edit');
      return;
    }

    if (t === 'erase') {
      pushHistory();
      S.drag = { kind: 'erase', dirty: true, done: {} };
      eraseAt(e);
      changed('edit');
      return;
    }

    /* --- 選ぶ・動かす --- */
    if (t === 'select') {
      const el = elementAt(board, cell.r, cell.c);
      if (el) {
        if (e.shiftKey) {
          if (S.selection.indexOf(el.id) >= 0) S.selection = S.selection.filter(function (id) { return id !== el.id; });
          else S.selection.push(el.id);
        } else if (S.selection.indexOf(el.id) < 0) {
          S.selection = [el.id];
        }
        const p = boardPoint(e);
        S.drag = { kind: 'move', from: cell, startX: p.x, startY: p.y, moved: false, dirty: false };
        notifySelect();
        draw();
      } else {
        if (!e.shiftKey) S.selection = [];
        const p = screenPoint(e);
        S.marquee = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, add: e.shiftKey };
        notifySelect();
        draw();
      }
    }
  }

  function moveTool(e) {
    const board = S.maze;
    if (S.marquee) {
      const p = screenPoint(e);
      S.marquee.x1 = p.sx; S.marquee.y1 = p.sy;
      draw();
      return;
    }
    if (!S.drag) return;

    if (S.drag.kind === 'wall') {
      const key = edgeOf(e);
      if (key && !S.drag.done[key]) { applyWall(key, S.drag.mode); draw(); }
      return;
    }
    if (S.drag.kind === 'route') {
      const cell = cellOf(e);
      if (!cell) return;
      const rt = activeRoute(board);
      const last = rt.cells[rt.cells.length - 1];
      if (!last || (last.r === cell.r && last.c === cell.c)) return;
      const prev = rt.cells[rt.cells.length - 2];
      if (prev && prev.r === cell.r && prev.c === cell.c) { rt.cells.pop(); draw(); return; }  // 引き返し
      if (!adjacent(last, cell)) return;
      // 交差（同じマスを別の向きで通る）はOK。同じ通路をなぞり返すのだけNG。
      if (edgeAlreadyUsed(rt.cells, last, cell)) { status('同じ通路は2回通れません（交差はできます）'); return; }
      rt.cells.push({ r: cell.r, c: cell.c });
      draw();
      if (S.hooks.onRoute) S.hooks.onRoute();
      return;
    }
    if (S.drag.kind === 'symbol' || S.drag.kind === 'cellcolor' || S.drag.kind === 'erase') {
      const cell = cellOf(e);
      if (!cell) return;
      const k = M.cellKey(cell.r, cell.c);
      if (S.drag.done[k]) return;
      S.drag.done[k] = true;
      if (S.drag.kind === 'symbol') {
        board.elements.push(M.makeElement(cell.r, cell.c, S.symbol, {
          color: S.color, size: S.size, role: S.role, warpGroup: S.role === 'warp' ? S.warpGroup : ''
        }));
      } else if (S.drag.kind === 'cellcolor') {
        board.cellColors[k] = S.color;
      } else {
        eraseAt(e);
      }
      draw();
      return;
    }
    if (S.drag.kind === 'move') {
      const cell = cellOf(e);
      if (!cell) return;
      if (cell.r === S.drag.from.r && cell.c === S.drag.from.c) return;
      const dr = cell.r - S.drag.from.r, dc = cell.c - S.drag.from.c;
      if (!S.drag.moved) { pushHistory(); S.drag.moved = true; }
      let blocked = false;
      S.selection.forEach(function (id) {
        const el = M.findById(board.elements, id);
        if (!el) return;
        if (!M.inside(board, el.r + dr, el.c + dc)) blocked = true;
      });
      if (blocked) return;
      S.selection.forEach(function (id) {
        const el = M.findById(board.elements, id);
        if (el) { el.r += dr; el.c += dc; }
      });
      S.drag.from = cell;
      S.drag.dirty = true;
      draw();
    }
  }

  function hoverTool(e) { /* いまは何もしない（将来ここに下じき表示を足せる） */ }

  function finishMarquee() {
    const r = normRect(S.marquee);
    const board = S.maze;
    const o = baseOpts();
    const m = R.measure(board, o);
    const toBoard = function (sx, sy) { return { x: (sx - S.view.tx) / S.view.scale, y: (sy - S.view.ty) / S.view.scale }; };
    const a = toBoard(r.x, r.y), b = toBoard(r.x + r.w, r.y + r.h);
    const hits = board.elements.filter(function (el) {
      const x = m.pad + el.c * m.cell + m.cell / 2;
      const y = m.originY + el.r * m.cell + m.cell / 2;
      return x >= a.x && x <= b.x && y >= a.y && y <= b.y;
    }).map(function (el) { return el.id; });
    S.selection = S.marquee.add ? S.selection.concat(hits) : hits;
    S.marquee = null;
    notifySelect();
  }

  function applyWall(key, mode) {
    const board = S.maze;
    if (mode === 'erase') {
      if (M.isBorderKey(board, key)) return;   // 外周は消させない（迷路が壊れるため）
      delete board.walls[key];
    } else {
      board.walls[key] = M.makeWall(S.color);
      delete board.oneways[key];
    }
    if (S.drag) S.drag.done[key] = true;
  }

  function eraseAt(e) {
    const board = S.maze;
    const cell = cellOf(e);
    const key = edgeOf(e);
    // 近くに壁があればまず壁を消す
    if (key && board.walls[key] && !M.isBorderKey(board, key)) { delete board.walls[key]; return; }
    if (!cell) return;
    const el = elementAt(board, cell.r, cell.c);
    if (el) { board.elements = board.elements.filter(function (x) { return x.id !== el.id; }); return; }
    if (board.cellColors[M.cellKey(cell.r, cell.c)]) { delete board.cellColors[M.cellKey(cell.r, cell.c)]; return; }
    if (board.starts.some(function (p) { return p.r === cell.r && p.c === cell.c; }) ||
        board.goals.some(function (p) { return p.r === cell.r && p.c === cell.c; })) {
      board.starts = board.starts.filter(function (p) { return !(p.r === cell.r && p.c === cell.c); });
      board.goals = board.goals.filter(function (p) { return !(p.r === cell.r && p.c === cell.c); });
      return;
    }
    // 消すものが他に無ければ、正解ルートをそのマスから先だけ消す
    const rt = board.routes[S.routeIndex];
    if (rt) {
      const at = indexInRoute(rt.cells, cell);
      if (at >= 0) rt.cells = rt.cells.slice(0, at);
    }
  }

  function adjacent(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1; }
  function indexInRoute(cells, p) {
    for (let i = 0; i < cells.length; i++) if (cells[i].r === p.r && cells[i].c === p.c) return i;
    return -1;
  }
  /** いちばん後ろに通った位置（交差できるので同じマスが複数あり得る） */
  function lastIndexInRoute(cells, p) {
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i].r === p.r && cells[i].c === p.c) return i;
    return -1;
  }
  /** その一歩が「すでに通った通路」かどうか（交差は通路が別なのでOK） */
  function edgeAlreadyUsed(cells, from, to) {
    const key = M.edgeBetween(from.r, from.c, to.r, to.c);
    if (!key) return false;
    for (let i = 0; i + 1 < cells.length; i++) {
      if (M.edgeBetween(cells[i].r, cells[i].c, cells[i + 1].r, cells[i + 1].c) === key) return true;
    }
    return false;
  }

  /* =======================================================================
   * マスの中に直接文字を打つ（日本語入力に対応）
   *   変換中の文字を勝手に確定しないよう composition を見る
   * ===================================================================== */
  function setupInlineInput() {
    const inp = S.input;
    if (!inp) return;
    inp.addEventListener('compositionstart', function () { S.composing = true; });
    inp.addEventListener('compositionupdate', function () { S.composing = true; });
    inp.addEventListener('compositionend', function (e) {
      S.composing = false;
      commitInline(e.data || inp.value);
      inp.value = '';
    });
    inp.addEventListener('input', function (e) {
      if (S.composing || e.isComposing) return;   // 変換中は何もしない
      commitInline(inp.value);
      inp.value = '';
    });
    inp.addEventListener('keydown', function (e) {
      if (S.composing || e.isComposing) return;
      const move = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (e.key === 'Escape') { closeInlineInput(); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { moveInline(0, 1); e.preventDefault(); }
      else if (e.key === 'Backspace' && !inp.value) { deleteAtEditing(); e.preventDefault(); }
      else if (move[e.key]) { moveInline(move[e.key][0], move[e.key][1]); e.preventDefault(); }
    });
    inp.addEventListener('blur', function () {
      setTimeout(function () {
        if (document.activeElement === S.input) return;   // すぐ戻ってきたときは閉じない
        closeInlineInput();
      }, 150);
    });
  }

  function openInlineInput(cell) {
    if (!S.input || isReadOnly()) return;
    S.editingCell = { r: cell.r, c: cell.c };
    const o = baseOpts();
    const m = R.measure(S.maze, o);
    const x = S.view.tx + (m.pad + cell.c * m.cell) * S.view.scale;
    const y = S.view.ty + (m.originY + cell.r * m.cell) * S.view.scale;
    const size = m.cell * S.view.scale;
    S.input.style.display = 'block';
    S.input.style.left = x + 'px';
    S.input.style.top = y + 'px';
    S.input.style.width = Math.max(size, 28) + 'px';
    S.input.style.height = Math.max(size, 28) + 'px';
    S.input.style.fontSize = Math.max(14, size * 0.5) + 'px';
    S.input.value = '';
    S.input.focus();
    // 念のため、他の処理が終わったあとにもう一度あてる
    setTimeout(function () { if (S.editingCell) S.input.focus(); }, 0);
    S.renderOpts.highlightCells = [S.editingCell];
    draw();
  }

  function closeInlineInput() {
    if (!S.input) return;
    S.input.style.display = 'none';
    S.editingCell = null;
    S.renderOpts.highlightCells = [];
    draw();
  }

  /** 確定した文字を置く。2文字以上なら右へ続けて置いていく */
  function commitInline(text) {
    if (!S.editingCell || !text) return;
    const chars = Array.from(text);
    pushHistory();
    let cell = S.editingCell;
    chars.forEach(function (ch) {
      if (!cell || !M.inside(S.maze, cell.r, cell.c)) return;
      if (/\s/.test(ch)) { cell = { r: cell.r, c: cell.c + 1 }; return; }
      S.maze.elements = S.maze.elements.filter(function (e) {
        return !(e.r === cell.r && e.c === cell.c && e.role === 'none');
      });
      S.maze.elements.push(M.makeElement(cell.r, cell.c, ch, { color: S.color, size: S.size }));
      cell = { r: cell.r, c: cell.c + 1 };
    });
    changed('edit');
    if (cell && M.inside(S.maze, cell.r, cell.c)) openInlineInput(cell);
    else closeInlineInput();
  }

  function moveInline(dr, dc) {
    if (!S.editingCell) return;
    const n = { r: S.editingCell.r + dr, c: S.editingCell.c + dc };
    if (M.inside(S.maze, n.r, n.c)) openInlineInput(n);
  }

  function deleteAtEditing() {
    if (!S.editingCell) return;
    pushHistory();
    const cell = S.editingCell;
    S.maze.elements = S.maze.elements.filter(function (e) { return !(e.r === cell.r && e.c === cell.c); });
    changed('edit');
  }

  function onDoubleClick(e) {
    if (isReadOnly()) return;
    const cell = cellOf(e);
    if (!cell) return;
    if (S.tool === 'select' || S.tool === 'text') openInlineInput(cell);
  }

  /* =======================================================================
   * 選んだものへの操作
   * ===================================================================== */
  function notifySelect() { if (S.hooks.onSelect) S.hooks.onSelect(getSelected()); }
  function getSelected() {
    return S.selection.map(function (id) { return M.findById(S.maze.elements, id); }).filter(Boolean);
  }
  function selectAll() {
    S.selection = S.maze.elements.map(function (e) { return e.id; });
    notifySelect(); draw();
  }
  function deleteSelection() {
    if (!S.selection.length || isReadOnly()) return;
    pushHistory();
    const del = {};
    S.selection.forEach(function (id) { del[id] = true; });
    S.maze.elements = S.maze.elements.filter(function (e) { return !del[e.id]; });
    S.selection = [];
    notifySelect();
    changed('edit');
  }
  function duplicateSelection() {
    const sel = getSelected();
    if (!sel.length || isReadOnly()) return;
    pushHistory();
    const made = [];
    sel.forEach(function (e) {
      const n = Object.assign({}, e, { id: M.newId('el'), r: Math.min(S.maze.rows - 1, e.r + 1) });
      S.maze.elements.push(n);
      made.push(n.id);
    });
    S.selection = made;
    notifySelect();
    changed('edit');
  }
  function applyToSelection(patch) {
    const sel = getSelected();
    if (!sel.length || isReadOnly()) return;
    pushHistory();
    sel.forEach(function (e) { Object.assign(e, patch); });
    changed('edit');
  }

  /* キーボードショートカット */
  function handleKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const cmd = e.ctrlKey || e.metaKey;
    if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey) { undo(); e.preventDefault(); return; }
    if (cmd && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { redo(); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'd') { duplicateSelection(); e.preventDefault(); return; }
    if (cmd && e.key.toLowerCase() === 'a') { selectAll(); e.preventDefault(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.selection.length) { deleteSelection(); e.preventDefault(); } return; }
    if (e.key === 'Escape') { S.selection = []; notifySelect(); draw(); }
  }

  return {
    init: init, state: S, draw: draw, fit: fit, zoom: zoom,
    set: set, setMaze: setMaze, getMaze: getMaze,
    setDisplay: setDisplay, clearDisplay: clearDisplay, shownBoard: shownBoard, isReadOnly: isReadOnly,
    pushHistory: pushHistory, undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,
    replaceMaze: replaceMaze, changed: changed,
    activeRoute: activeRoute,
    getSelected: getSelected, selectAll: selectAll, deleteSelection: deleteSelection,
    duplicateSelection: duplicateSelection, applyToSelection: applyToSelection,
    handleKey: handleKey, openInlineInput: openInlineInput, closeInlineInput: closeInlineInput,
    baseOpts: baseOpts
  };
})();
