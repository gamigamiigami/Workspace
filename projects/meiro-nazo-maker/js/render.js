/* ===========================================================================
 * render.js — 迷路を絵にする担当
 *
 * ★このファイルの約束★
 *   盤面を描く関数は drawBoard ただ1つ。
 *   画面・印刷・PNG保存・プレイヤー画面、ぜんぶこの1つを呼ぶ。
 *   （画面用と印刷用で描き方を分けると「印刷にだけ番号が無い」ような
 *     取りこぼしが必ず起きる。過去に実際にやらかしているので分けない）
 *   違いは opts（見せる・見せない）だけで表す。
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.render = (function () {
  'use strict';
  const M = MZ.model;

  const DEFAULTS = {
    cellPx: 36,
    pad: 22,
    bg: '#ffffff',
    showGrid: true,
    showWalls: true,
    showElements: true,
    showStartGoal: true,
    showOneway: true,
    showRoute: false,
    routePath: null,
    routeColor: '#f76707',
    routeAlpha: 0.35,
    showRoles: true,      // ○必ず通る・×通らない の目印（制作者モードのみ）
    showGhost: true,      // 消した壁・文字のあとを薄く出す（制作者モードのみ）
    mono: false,          // 白黒印刷モード
    legend: false,
    selection: [],
    highlightCells: [],
    title: ''
  };

  function opt(o, k) { return (o && o[k] !== undefined) ? o[k] : DEFAULTS[k]; }

  /** 描いたときの大きさを返す */
  function measure(board, o) {
    const cell = opt(o, 'cellPx'), pad = opt(o, 'pad');
    const titleH = opt(o, 'title') ? Math.round(cell * 0.9) : 0;
    let legendH = 0;
    if (opt(o, 'legend')) {
      const perRow = Math.max(1, Math.floor((board.cols * cell) / (cell * 2.3)));
      const rows = Math.ceil(M.COLOR_KEYS.length / perRow);
      legendH = Math.round(rows * cell * 0.78 + cell * 0.4);
    }
    return {
      cell: cell, pad: pad, titleH: titleH, legendH: legendH,
      width: pad * 2 + board.cols * cell,
      height: pad * 2 + board.rows * cell + titleH + legendH,
      originY: pad + titleH
    };
  }

  function colorHex(name, mono) {
    if (mono) return '#22272e';
    const c = M.COLORS[name];
    return c ? c.hex : (name && name.charAt(0) === '#' ? name : '#22272e');
  }
  function colorDash(name) {
    const c = M.COLORS[name];
    return c ? c.dash : [];
  }
  function colorDeco(name) {
    const c = M.COLORS[name];
    return c ? c.deco : 'none';
  }

  /* -----------------------------------------------------------------------
   * 盤面をまるごと描く（唯一の描画関数）
   * --------------------------------------------------------------------- */
  function drawBoard(ctx, board, o) {
    o = o || {};
    const m = measure(board, o);
    const cell = m.cell, pad = m.pad, oy = m.originY;
    const mono = opt(o, 'mono');

    const X = function (c) { return pad + c * cell; };
    const Y = function (r) { return oy + r * cell; };
    const CX = function (c) { return pad + c * cell + cell / 2; };
    const CY = function (r) { return oy + r * cell + cell / 2; };

    ctx.save();
    ctx.fillStyle = opt(o, 'bg');
    ctx.fillRect(0, 0, m.width, m.height);

    /* ---- タイトル ---- */
    if (opt(o, 'title')) {
      ctx.fillStyle = '#22272e';
      ctx.font = 'bold ' + Math.round(cell * 0.5) + 'px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(opt(o, 'title'), pad, pad + m.titleH / 2);
    }

    /* ---- マスの色 ---- */
    const cc = board.cellColors || {};
    Object.keys(cc).forEach(function (k) {
      const p = k.split(','), r = +p[0], c = +p[1];
      if (!M.inside(board, r, c)) return;
      ctx.globalAlpha = mono ? 0.12 : 0.22;
      ctx.fillStyle = colorHex(cc[k], false);
      ctx.fillRect(X(c), Y(r), cell, cell);
      ctx.globalAlpha = 1;
    });

    /* ---- 強調するマス（選択中など） ---- */
    const hl = opt(o, 'highlightCells') || [];
    hl.forEach(function (p) {
      ctx.fillStyle = 'rgba(77,171,247,0.28)';
      ctx.fillRect(X(p.c), Y(p.r), cell, cell);
    });

    /* ---- うすいマス目 ---- */
    if (opt(o, 'showGrid')) {
      ctx.strokeStyle = mono ? '#dddddd' : '#e6e8eb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 0; r <= board.rows; r++) { ctx.moveTo(X(0), Y(r)); ctx.lineTo(X(board.cols), Y(r)); }
      for (let c = 0; c <= board.cols; c++) { ctx.moveTo(X(c), Y(0)); ctx.lineTo(X(c), Y(board.rows)); }
      ctx.stroke();
    }

    /* ---- ルート（通る道すじ） ---- */
    const path = opt(o, 'routePath');
    if (opt(o, 'showRoute') && path && path.length) {
      ctx.save();
      ctx.lineWidth = Math.max(4, cell * 0.42);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (mono) { ctx.strokeStyle = '#999999'; ctx.setLineDash([cell * 0.25, cell * 0.2]); ctx.globalAlpha = 0.9; }
      else { ctx.strokeStyle = opt(o, 'routeColor'); ctx.globalAlpha = opt(o, 'routeAlpha'); }
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const isJump = i > 0 && (Math.abs(p.r - path[i - 1].r) + Math.abs(p.c - path[i - 1].c)) !== 1;
        if (!drawing || isJump) { ctx.moveTo(CX(p.c), CY(p.r)); drawing = true; }
        else ctx.lineTo(CX(p.c), CY(p.r));
      }
      ctx.stroke();
      // ルートの順番（1,2,3…）は出さない。通った道が見えれば十分なので図が汚れない
      ctx.restore();
    }

    /* ---- START と GOAL ----
     * 文字の下じきとして先に描く。マスを塗りつぶすと上に置いた文字が読めなくなるため、
     * うすい色の下じき＋わく線にして、S/G の字はマスの左上に小さく入れる。 */
    if (opt(o, 'showStartGoal')) {
      const drawFlag = function (p, label, color, isGoal) {
        const x = X(p.c), y = Y(p.r);
        const hex = colorHex(color, mono);
        ctx.save();
        ctx.globalAlpha = mono ? 0.10 : 0.16;
        ctx.fillStyle = hex;
        roundRect(ctx, x + cell * 0.06, y + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.16);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = hex;
        ctx.lineWidth = Math.max(1.6, cell * 0.06);
        if (isGoal) ctx.setLineDash([]); else ctx.setLineDash([cell * 0.16, cell * 0.1]);
        roundRect(ctx, x + cell * 0.06, y + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.16);
        ctx.stroke();
        ctx.setLineDash([]);
        // 左上に小さくラベル
        const bs = Math.max(9, cell * 0.3);
        ctx.fillStyle = hex;
        roundRect(ctx, x + cell * 0.04, y + cell * 0.04, bs, bs * 0.82, bs * 0.22);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + Math.round(bs * 0.62) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, x + cell * 0.04 + bs / 2, y + cell * 0.04 + bs * 0.41);
        ctx.restore();
      };
      board.starts.forEach(function (s2) { drawFlag(s2, s2.label || 'S', s2.color, false); });
      board.goals.forEach(function (g) { drawFlag(g, g.label || 'G', g.color, true); });
    }

    /* ---- 置いたもの（文字・数字・記号） ---- */
    if (opt(o, 'showElements')) {
      const sel = {};
      (opt(o, 'selection') || []).forEach(function (id) { sel[id] = true; });
      board.elements.forEach(function (e) {
        if (e.hidden && !(opt(o, 'showGhost'))) return;
        const ghost = e.hidden || e.disabled;
        if (ghost && !opt(o, 'showGhost')) return;
        const cx = CX(e.c), cy = CY(e.r);
        const fs = Math.round(cell * 0.62 * (e.size || 1));

        if (sel[e.id]) {
          ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = 2;
          ctx.strokeRect(X(e.c) + 2, Y(e.r) + 2, cell - 4, cell - 4);
        }

        ctx.save();
        if (ghost) ctx.globalAlpha = 0.25;
        ctx.fillStyle = colorHex(e.color, mono);
        ctx.font = (mono ? 'bold ' : '') + fs + 'px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(e.value, cx, cy + fs * 0.04);

        // 白黒印刷では色が消えるので、色ごとに飾りを付けて見分けられるようにする
        if (mono) drawMonoDeco(ctx, colorDeco(e.color), cx, cy, fs);

        // 制作者だけに見せる目印（○＝必ず通る／×＝通らない／ワープ）
        if (opt(o, 'showRoles') && e.role && e.role !== 'none') {
          ctx.globalAlpha = ghost ? 0.2 : 0.85;
          const bs = Math.max(9, cell * 0.26);
          ctx.font = 'bold ' + Math.round(bs * 0.78) + 'px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const bx = X(e.c) + cell - bs * 0.62, by = Y(e.r) + bs * 0.62;
          ctx.fillStyle = e.role === 'avoid' ? '#e03131' : (e.role === 'warp' ? '#8b5cf6' : '#2f9e44');
          ctx.beginPath(); ctx.arc(bx, by, bs * 0.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(e.role === 'avoid' ? '×' : (e.role === 'warp' ? (e.warpGroup || 'W').charAt(0) : '必'), bx, by);
        }
        ctx.restore();
      });
    }

    /* ---- 壁 ---- */
    if (opt(o, 'showWalls')) {
      const lw = Math.max(2.5, cell * 0.16);
      Object.keys(board.walls).forEach(function (key) {
        const w = board.walls[key];
        if (!w) return;
        const gone = w.disabled || w.hidden;
        if (gone && !opt(o, 'showGhost')) return;
        const k = M.parseKey(key);
        let x1, y1, x2, y2;
        if (k.type === 'h') { x1 = X(k.c); y1 = Y(k.r); x2 = X(k.c + 1); y2 = Y(k.r); }
        else { x1 = X(k.c); y1 = Y(k.r); x2 = X(k.c); y2 = Y(k.r + 1); }
        ctx.save();
        if (gone) {
          // 消した壁のあと（制作者にだけ見える）
          ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = Math.max(1, lw * 0.35);
          ctx.setLineDash([3, 4]);
        } else {
          ctx.strokeStyle = colorHex(w.color, mono);
          ctx.lineWidth = lw;
          ctx.lineCap = 'round';
          if (mono && w.color !== 'black') {
            // 破線にするときは丸いはしをやめる。丸いままだと、はしがのびて
            // すきまが埋まってしまい、色ごとのもようが見分けられなくなる
            ctx.lineCap = 'butt';
            ctx.setLineDash(colorDash(w.color).map(function (d) { return d * cell / 36; }));
          }
        }
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
      });
    }

    /* ---- 一方通行の矢印 ---- */
    if (opt(o, 'showOneway')) {
      Object.keys(board.oneways || {}).forEach(function (key) {
        const dir = board.oneways[key];
        if (!dir) return;
        const w = board.walls[key];
        if (w && !w.disabled) return;   // 壁でふさがっているなら矢印は出さない
        const k = M.parseKey(key);
        let cx, cy, ang;
        if (k.type === 'h') { cx = X(k.c) + cell / 2; cy = Y(k.r); ang = dir === 'a2b' ? Math.PI / 2 : -Math.PI / 2; }
        else { cx = X(k.c); cy = Y(k.r) + cell / 2; ang = dir === 'a2b' ? 0 : Math.PI; }
        drawArrow(ctx, cx, cy, ang, cell * 0.34, mono ? '#22272e' : '#7048e8');
      });
    }

    /* ---- 白黒印刷のときの凡例 ---- */
    if (opt(o, 'legend')) drawLegend(ctx, board, m, mono);

    ctx.restore();
    return m;
  }

  /* ---- 白黒のときに色を見分けるための飾り ---- */
  function drawMonoDeco(ctx, deco, cx, cy, fs) {
    ctx.save();
    ctx.strokeStyle = '#22272e';
    ctx.lineWidth = Math.max(1, fs * 0.07);
    ctx.beginPath();
    const h = fs * 0.52, w = fs * 0.46;
    if (deco === 'under') { ctx.moveTo(cx - w, cy + h); ctx.lineTo(cx + w, cy + h); }
    else if (deco === 'double') {
      ctx.moveTo(cx - w, cy + h); ctx.lineTo(cx + w, cy + h);
      ctx.moveTo(cx - w, cy + h * 1.28); ctx.lineTo(cx + w, cy + h * 1.28);
    } else if (deco === 'circle') { ctx.arc(cx, cy, fs * 0.6, 0, Math.PI * 2); }
    else if (deco === 'box') { ctx.rect(cx - fs * 0.55, cy - fs * 0.55, fs * 1.1, fs * 1.1); }
    else if (deco === 'dot') { ctx.arc(cx, cy - h * 1.15, Math.max(1.2, fs * 0.09), 0, Math.PI * 2); ctx.fillStyle = '#22272e'; ctx.fill(); }
    ctx.stroke();
    ctx.restore();
  }

  /** 色の凡例。白黒印刷では「線のもよう」と「文字の飾り」の両方を見せる */
  function drawLegend(ctx, board, m, mono) {
    const lay = legendLayout(board, m);
    const fs = Math.round(m.cell * 0.42);
    ctx.save();
    ctx.textBaseline = 'middle';
    M.COLOR_KEYS.forEach(function (k, i) {
      const info = M.COLORS[k];
      const col = i % lay.perRow, row = Math.floor(i / lay.perRow);
      const x = m.pad + col * lay.itemW;
      const y = lay.top + row * lay.rowH + lay.rowH / 2;
      // 線のサンプル
      ctx.strokeStyle = mono ? '#22272e' : info.hex;
      ctx.lineWidth = Math.max(2, m.cell * 0.12);
      ctx.lineCap = 'butt';
      ctx.setLineDash(mono ? info.dash.map(function (d) { return d * m.cell / 36; }) : []);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + m.cell * 0.6, y); ctx.stroke();
      ctx.setLineDash([]);
      // 文字のサンプル
      const cx = x + m.cell * 0.6 + fs * 0.85;
      ctx.fillStyle = mono ? '#22272e' : info.hex;
      ctx.font = (mono ? 'bold ' : '') + fs + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('あ', cx, y);
      if (mono) drawMonoDeco(ctx, info.deco, cx, y, fs);
      // 色の名前
      ctx.textAlign = 'left';
      ctx.fillStyle = '#22272e';
      ctx.font = Math.round(m.cell * 0.32) + 'px system-ui, sans-serif';
      ctx.fillText(info.label, cx + fs * 0.8, y);
    });
    ctx.restore();
  }

  /** 凡例の並べ方（盤の幅に入りきらないときは折り返す） */
  function legendLayout(board, m) {
    const itemW = m.cell * 2.3;
    const inner = board.cols * m.cell;
    const perRow = Math.max(1, Math.floor(inner / itemW));
    const rows = Math.ceil(M.COLOR_KEYS.length / perRow);
    const rowH = m.cell * 0.78;
    return { itemW: itemW, perRow: perRow, rows: rows, rowH: rowH, top: m.originY + board.rows * m.cell + m.pad * 0.4 };
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

  function drawArrow(ctx, cx, cy, ang, size, color) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(size * 0.55, 0);
    ctx.lineTo(-size * 0.3, size * 0.38);
    ctx.lineTo(-size * 0.3, -size * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* -----------------------------------------------------------------------
   * 画面の座標 → 盤面のマス・壁（クリック位置を調べるため）
   * --------------------------------------------------------------------- */
  function cellAt(board, x, y, o) {
    const m = measure(board, o);
    const c = Math.floor((x - m.pad) / m.cell);
    const r = Math.floor((y - m.originY) / m.cell);
    if (!M.inside(board, r, c)) return null;
    return { r: r, c: c };
  }

  /** クリック位置にいちばん近い壁のキーを返す（遠ければ null） */
  function edgeAt(board, x, y, o, tol) {
    const m = measure(board, o);
    tol = (tol === undefined) ? 0.33 : tol;
    const fx = (x - m.pad) / m.cell;
    const fy = (y - m.originY) / m.cell;
    if (fx < -tol || fy < -tol || fx > board.cols + tol || fy > board.rows + tol) return null;
    let c = Math.floor(fx), r = Math.floor(fy);
    c = Math.max(0, Math.min(board.cols - 1, c));
    r = Math.max(0, Math.min(board.rows - 1, r));
    const dx = fx - c, dy = fy - r;
    const cands = [
      { d: Math.abs(dx), key: M.vKey(r, c) },
      { d: Math.abs(1 - dx), key: M.vKey(r, c + 1) },
      { d: Math.abs(dy), key: M.hKey(r, c) },
      { d: Math.abs(1 - dy), key: M.hKey(r + 1, c) }
    ];
    cands.sort(function (a, b) { return a.d - b.d; });
    return cands[0].d <= tol ? cands[0].key : null;
  }

  /* -----------------------------------------------------------------------
   * 別盤面（文字盤）を、同じ描画関数で描けるように board の形に変える
   * --------------------------------------------------------------------- */
  function subBoardAsBoard(sub) {
    const b = {
      rows: sub.rows, cols: sub.cols, walls: {}, oneways: {},
      cellColors: {}, elements: [], starts: [], goals: [], routes: []
    };
    // 外枠だけ引く
    for (let c = 0; c < sub.cols; c++) { b.walls[M.hKey(0, c)] = M.makeWall(); b.walls[M.hKey(sub.rows, c)] = M.makeWall(); }
    for (let r = 0; r < sub.rows; r++) { b.walls[M.vKey(r, 0)] = M.makeWall(); b.walls[M.vKey(r, sub.cols)] = M.makeWall(); }
    for (let r = 0; r < sub.rows; r++) for (let c = 0; c < sub.cols; c++) {
      const cellData = sub.cells[r][c];
      if (cellData && cellData.value) {
        b.elements.push(M.makeElement(r, c, cellData.value, { color: cellData.color || 'black' }));
      }
    }
    return b;
  }

  /* -----------------------------------------------------------------------
   * PNG画像として書き出す（印刷用の大きいサイズで描き直す）
   * --------------------------------------------------------------------- */
  function toCanvas(board, o) {
    const m = measure(board, o);
    const scale = (o && o.exportScale) || 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(m.width * scale);
    cv.height = Math.round(m.height * scale);
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    drawBoard(ctx, board, o);
    return cv;
  }

  function toDataURL(board, o) {
    return toCanvas(board, o).toDataURL('image/png');
  }

  return {
    DEFAULTS: DEFAULTS,
    measure: measure, drawBoard: drawBoard,
    cellAt: cellAt, edgeAt: edgeAt,
    subBoardAsBoard: subBoardAsBoard,
    toCanvas: toCanvas, toDataURL: toDataURL,
    colorHex: colorHex
  };
})();
