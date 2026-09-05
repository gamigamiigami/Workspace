/* ===========================================================================
 * app.js — 画面の配線
 *
 * ここは「ボタンを押したら何をするか」だけを書く。
 * 迷路の中身の処理は model / engine / generate / ops / steps に任せる。
 * ======================================================================== */
(function () {
  'use strict';
  const M = MZ.model, R = MZ.render, E = MZ.engine, G = MZ.generate;
  const O = MZ.ops, ST = MZ.steps, ED = MZ.editor;

  const $ = function (s) { return document.querySelector(s); };
  const el = function (tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const STORE_KEY = 'meiro-nazo-maker:works';
  const AUTO_KEY = 'meiro-nazo-maker:auto';

  const A = {
    maze: null,
    steps: [],
    results: [],
    checks: [],
    selStep: -1,            // -1 = 設計図（編集できる） / 0以上 = そのSTEPの結果を見ている
    stepHistory: [],        // STEPの操作だけの「もどす」履歴（迷路の履歴とは別に持つ）
    dummyColors: ['black'],
    player: { index: 0, showAnswer: false, screens: [] },
    openId: null
  };

  /* =======================================================================
   * STEPごとの設定画面の作り方（部品ごとに何を聞くか）
   * ===================================================================== */
  const FORMS = {
    'solve': [
      { k: 'startId', t: 'point', label: 'START', list: 'starts' },
      { k: 'goalId', t: 'point', label: 'GOAL', list: 'goals' },
      { k: 'useMust', t: 'check', label: '○を必ず通る' },
      { k: 'ordered', t: 'check', label: '○を決めた順に通る' },
      { k: 'useAvoid', t: 'check', label: '×を通らない' },
      { k: 'useWarp', t: 'check', label: 'ワープを使う' }
    ],
    'route-drawn': [],
    'extract': [{ k: 'order', t: 'order' }, { k: 'parity', t: 'parity' }, { k: 'kinds', t: 'kinds' }],
    'filter-color': [
      { k: 'mode', t: 'sel', label: '読み方', opts: [['include', 'この色だけ読む'], ['exclude', 'この色いがいを読む']] },
      { k: 'colors', t: 'colors', label: '色' }
    ],
    'reorder': [{ k: 'order', t: 'order' }, { k: 'parity', t: 'parity' }],
    'remove-walls': [{ k: 'colors', t: 'colors', label: '消す線の色' }],
    'remove-elements': [
      { k: 'colors', t: 'colors', label: '消す色（選ばなければ色は問わない）' },
      { k: 'kinds', t: 'kinds', label: '消す種類' },
      { k: 'values', t: 'text', label: 'この文字だけ消す（空ならすべて）' }
    ],
    'set-start': [
      { k: 'symbol', t: 'text', label: 'この記号をSTARTにする（例：★）' },
      { k: 'symbolColor', t: 'color1', label: 'その記号の色' },
      { k: 'startId', t: 'point', list: 'starts', label: 'または すでにあるSTART' }
    ],
    'set-goal': [
      { k: 'symbol', t: 'text', label: 'この記号をGOALにする（例：★）' },
      { k: 'symbolColor', t: 'color1', label: 'その記号の色' },
      { k: 'goalId', t: 'point', list: 'goals', label: 'または すでにあるGOAL' }
    ],
    'flip-h': [], 'flip-v': [], 'rotate180': [], 'route-shape': [],
    'transfer': [
      { k: 'offsetR', t: 'num', label: 'たてにずらす' },
      { k: 'offsetC', t: 'num', label: 'よこにずらす' },
      { k: 'order', t: 'order' }, { k: 'parity', t: 'parity' }
    ],
    'enclosed': [{ k: 'order', t: 'order' }, { k: 'parity', t: 'parity' }],
    'answer': [{ k: 'expected', t: 'text', label: '想定しているこたえ' }]
    };

  /* =======================================================================
   * 起動
   * ===================================================================== */
  function init() {
    A.maze = M.createMaze(10, 10);
    buildPickers();
    ED.init({
      canvas: $('#board'), wrap: $('#canvasWrap'), input: $('#cellInput'), maze: A.maze,
      hooks: {
        onChange: function () { A.selStep = -1; ED.clearDisplay(); refresh(); },
        onStatus: setStatus,
        onSelect: onSelectChange,
        onRoute: updateRouteLen
      }
    });
    wire();
    restoreAuto();          // 前回のつづきがあれば編集画面に入れておく
    refresh();
    // 最初に出るのは「かんたん作成」画面（index.html で show 済み）
  }

  /* 外（かんたん作成画面）から呼ぶための窓口 */
  MZ.app = {
    applyBuilt: applyBuilt,
    showEditor: showEditor,
    showWizard: showWizard,
    doPrint: function () { doPrint(); },
    doPng: function () { doPng(); },
    setTool: setTool,
    setStatus: setStatus
  };

  /** かんたん作成で出来たものを、編集画面の状態として受けとる */
  function applyBuilt(maze, steps) {
    ED.replaceMaze(M.normalize(maze));
    A.maze = ED.getMaze();
    A.steps = steps;
    A.stepHistory = [];
    A.selStep = -1;
    A.openId = null;
    ED.state.history = []; ED.state.future = [];
    ED.clearDisplay();
    $('#inRows').value = A.maze.rows;
    $('#inCols').value = A.maze.cols;
    refresh();
  }

  function showEditor() {
    if (MZ.wizard) MZ.wizard.hide();
    refresh();
    setTimeout(function () { ED.fit(); }, 30);
  }
  function showWizard() {
    if (MZ.wizard) MZ.wizard.show();
  }

  /** ツールを外から選ぶ */
  function setTool(name) {
    document.querySelectorAll('.tool').forEach(function (x) {
      x.classList.toggle('on', x.dataset.tool === name);
    });
    ED.set('tool', name);
    if (name === 'route') {
      $('#ckShowShortest').checked = false;
      $('#ckShowRoute').checked = true;
      updateRouteView();
    }
    setStatus(TOOL_HINT[name] || '');
  }

  /* =======================================================================
   * 選択肢をそろえる
   * ===================================================================== */
  function buildPickers() {
    // 色のボタン（ツールバー）
    const sw = $('#swatches');
    M.COLOR_KEYS.forEach(function (k) {
      const b = el('button', 'sw' + (k === 'black' ? ' on' : ''));
      b.style.background = M.COLORS[k].hex;
      b.title = M.COLORS[k].label;
      b.dataset.color = k;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(sw.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        ED.set('color', k);
      });
      sw.appendChild(b);
    });

    // 記号
    const sp = $('#symbolPick');
    M.SYMBOLS.forEach(function (s) { const o = el('option', '', s); o.value = s; sp.appendChild(o); });

    // 文章の色 / お試しの色
    [$('#inPhraseColor'), $('#tryColor')].forEach(function (sel) {
      M.COLOR_KEYS.forEach(function (k) {
        const o = el('option', '', M.COLORS[k].label);
        o.value = k; sel.appendChild(o);
      });
    });
    $('#inPhraseColor').value = 'red';
    $('#tryColor').value = 'red';

    // 読み順・番目
    Object.keys(O.orders).forEach(function (k) {
      const o = el('option', '', O.orders[k].label); o.value = k; $('#tryOrder').appendChild(o);
    });
    Object.keys(O.parities).forEach(function (k) {
      const o = el('option', '', O.parities[k].label); o.value = k; $('#tryParity').appendChild(o);
    });

    // ダミーの色
    const dc = $('#dummyColors');
    M.COLOR_KEYS.forEach(function (k) {
      const b = el('button', 'sw' + (k === 'black' ? ' on' : ''));
      b.style.background = M.COLORS[k].hex;
      b.title = M.COLORS[k].label + 'を混ぜる';
      b.addEventListener('click', function () {
        b.classList.toggle('on');
        A.dummyColors = Array.prototype.filter.call(dc.children, function (x) { return x.classList.contains('on'); })
          .map(function (x) { return M.COLOR_KEYS[Array.prototype.indexOf.call(dc.children, x)]; });
        if (!A.dummyColors.length) { dc.children[0].classList.add('on'); A.dummyColors = ['black']; }
      });
      dc.appendChild(b);
    });

    // 追加できるSTEPの一覧
    const stype = $('#stepType');
    const groups = {};
    O.list().forEach(function (op) { (groups[op.group] = groups[op.group] || []).push(op); });
    Object.keys(groups).forEach(function (g) {
      const og = document.createElement('optgroup');
      og.label = { 'とく': '① 迷路をとく', 'よむ': '② 情報を読む', 'かえる': '③ 盤面を変える', 'つかう': '④ ルートを使う', 'しめ': '⑤ しめくくり' }[g] || g;
      groups[g].forEach(function (op) {
        const o = el('option', '', op.label + '（' + op.inputs + ' → ' + op.outputs + '）');
        o.value = op.id; og.appendChild(o);
      });
      stype.appendChild(og);
    });
  }

  /* =======================================================================
   * ボタンの配線
   * ===================================================================== */
  function wire() {
    // ツール
    document.querySelectorAll('.tool').forEach(function (b) {
      b.addEventListener('click', function () { setTool(b.dataset.tool); });
    });
    $('#symbolPick').addEventListener('change', function () { ED.set('symbol', this.value); });
    $('#rolePick').addEventListener('change', function () {
      ED.set('role', this.value);
      // ワープのときだけ「どの組か」を聞く（A・B・C・D。同じ組どうしがつながる）
      $('#warpGroup').style.display = (this.value === 'warp') ? '' : 'none';
    });
    $('#warpGroup').addEventListener('change', function () { ED.set('warpGroup', this.value); });
    $('#btnHome').addEventListener('click', showWizard);
    $('#btnUndoStep').addEventListener('click', undoStep);
    $('#btnZoomIn').addEventListener('click', function () { ED.zoom(1.2); });
    $('#btnZoomOut').addEventListener('click', function () { ED.zoom(1 / 1.2); });
    $('#btnFit').addEventListener('click', function () { ED.fit(); });

    // 上のバー
    $('#btnUndo').addEventListener('click', function () { ED.undo(); });
    $('#btnRedo').addEventListener('click', function () { ED.redo(); });
    $('#btnHelp').addEventListener('click', function () { $('#helpModal').hidden = false; });
    $('#btnHelpClose').addEventListener('click', function () { $('#helpModal').hidden = true; });
    $('#btnPlay').addEventListener('click', openPlayer);
    $('#btnPlayerClose').addEventListener('click', function () { $('#playerView').hidden = true; });
    $('#btnPlayerPrev').addEventListener('click', function () { movePlayer(-1); });
    $('#btnPlayerNext').addEventListener('click', function () { movePlayer(1); });
    $('#btnPlayerAnswer').addEventListener('click', function () { A.player.showAnswer = !A.player.showAnswer; renderPlayer(); });
    $('#btnPrint').addEventListener('click', doPrint);
    $('#btnPrint2').addEventListener('click', doPrint);
    $('#btnPng').addEventListener('click', doPng);
    $('#btnPng2').addEventListener('click', doPng);
    $('#btnSave').addEventListener('click', function () { $('#saveTitle').value = A.maze.meta.title || ''; $('#saveModal').hidden = false; $('#saveTitle').focus(); });
    $('#btnSaveCancel').addEventListener('click', function () { $('#saveModal').hidden = true; });
    $('#btnSaveDo').addEventListener('click', saveWork);
    $('#btnOpen').addEventListener('click', openWorkList);
    $('#btnOpenCancel').addEventListener('click', function () { $('#openModal').hidden = true; });
    $('#btnExport').addEventListener('click', exportFile);
    $('#btnImport').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', importFile);

    // 画面のタブ（せまい画面用）
    document.querySelectorAll('#paneTabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#paneTabs button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        ['steps', 'canvas', 'side'].forEach(function (p) {
          const node = $('#pane' + p.charAt(0).toUpperCase() + p.slice(1));
          node.classList.toggle('show', p === b.dataset.pane);
        });
        if (b.dataset.pane === 'canvas') setTimeout(function () { ED.fit(); }, 30);
      });
    });

    /* ---- ① 盤面 ---- */
    $('#btnResize').addEventListener('click', function () {
      const rows = clamp(+$('#inRows').value, 2, 40), cols = clamp(+$('#inCols').value, 2, 40);
      ED.pushHistory();
      M.resize(A.maze, rows, cols);
      afterEdit();
      ED.fit();
    });
    $('#inCell').addEventListener('input', function () {
      ED.state.renderOpts.cellPx = +this.value;
      ED.fit();
    });
    $('#ckGrid').addEventListener('change', function () { ED.state.renderOpts.showGrid = this.checked; ED.draw(); });
    $('#btnAllWalls').addEventListener('click', function () { ED.pushHistory(); M.fillAllWalls(A.maze); afterEdit(); });
    $('#btnBorderOnly').addEventListener('click', function () { ED.pushHistory(); M.onlyBorderWalls(A.maze); afterEdit(); });
    $('#btnRandomMaze').addEventListener('click', function () {
      ED.pushHistory();
      A.maze.walls = G.random(A.maze).walls;
      setStatus('迷路をおまかせで作りました');
      afterEdit();
    });

    /* ---- ② 正解ルート ---- */
    $('#btnMakeMaze').addEventListener('click', makeMazeFromRoute);
    $('#btnOpenRoute').addEventListener('click', function () {
      const rt = A.maze.routes[0];
      if (!rt) { setStatus('先にルートを描いてください'); return; }
      ED.pushHistory();
      const res = G.openRoute(A.maze, rt.cells);
      setStatus(res.ok ? res.message : res.reason);
      afterEdit();
    });
    $('#btnClearRoute').addEventListener('click', function () {
      ED.pushHistory(); A.maze.routes = []; afterEdit();
    });
    $('#btnRouteToSG').addEventListener('click', function () {
      const rt = A.maze.routes[0];
      if (!rt || rt.cells.length < 2) { setStatus('先にルートを描いてください'); return; }
      ED.pushHistory();
      const a = rt.cells[0], b = rt.cells[rt.cells.length - 1];
      A.maze.starts = [M.makeStart(a.r, a.c)];
      A.maze.goals = [M.makeGoal(b.r, b.c)];
      setStatus('ルートの両はしをSTARTとGOALにしました');
      afterEdit();
    });
    $('#ckShowRoute').addEventListener('change', updateRouteView);
    $('#ckShowShortest').addEventListener('change', updateRouteView);

    /* ---- ③ 文字を置く ---- */
    $('#btnPlaceText').addEventListener('click', placePhrase);
    $('#btnScatter').addEventListener('click', scatter);
    $('#btnClearDummy').addEventListener('click', function () {
      ED.pushHistory();
      const before = A.maze.elements.length;
      A.maze.elements = A.maze.elements.filter(function (e) { return !e.isDummy; });
      setStatus('ダミーを' + (before - A.maze.elements.length) + '個消しました');
      afterEdit();
    });

    /* ---- ④ 選んだもの ---- */
    const sc = $('#selColors');
    M.COLOR_KEYS.forEach(function (k) {
      const b = el('button', 'sw');
      b.style.background = M.COLORS[k].hex;
      b.title = M.COLORS[k].label + 'にする';
      b.addEventListener('click', function () { ED.applyToSelection({ color: k }); });
      sc.appendChild(b);
    });
    $('#inSelSize').addEventListener('input', function () { ED.applyToSelection({ size: +this.value / 100 }); });
    $('#btnDup').addEventListener('click', function () { ED.duplicateSelection(); });
    $('#btnDel').addEventListener('click', function () { ED.deleteSelection(); });

    /* ---- ⑤ 読み取りのお試し ---- */
    ['#tryFilterMode', '#tryColor', '#tryOrder', '#tryParity'].forEach(function (s) {
      $(s).addEventListener('change', updateTry);
    });
    $('#btnTryToStep').addEventListener('click', tryToSteps);

    /* ---- ⑥ 別盤面 ---- */
    $('#btnMakeSub').addEventListener('click', function () {
      ED.pushHistory();
      A.maze.subBoard = M.createSubBoard(clamp(+$('#inSubRows').value, 2, 20), clamp(+$('#inSubCols').value, 2, 20));
      setStatus('文字盤を作りました。下の欄に文字を書いて「文字盤に反映」を押してください');
      afterEdit();
    });
    $('#btnFillSub').addEventListener('click', fillSub);
    $('#btnRandSub').addEventListener('click', randSub);
    $('#ckShowSub').addEventListener('change', function () { A.selStep = -1; refresh(); });

    /* ---- ⑦ チェック ---- */
    $('#btnRecheck').addEventListener('click', refresh);

    /* ---- STEP ---- */
    $('#btnAddStep').addEventListener('click', function () { addStep($('#stepType').value); });
    $('#btnViewMaze').addEventListener('click', function () { A.selStep = -1; refresh(); });

    // キーボード
    document.addEventListener('keydown', function (e) {
      if (!$('#playerView').hidden) {
        if (e.key === 'ArrowRight') movePlayer(1);
        if (e.key === 'ArrowLeft') movePlayer(-1);
        if (e.key === 'Escape') $('#playerView').hidden = true;
        return;
      }
      ED.handleKey(e);
    });
    window.addEventListener('beforeunload', saveAuto);
  }

  const TOOL_HINT = {
    select: '文字や記号をクリックで選び、ドラッグで動かせます。何もない所をドラッグすると範囲選択。ダブルクリックで文字を直せます',
    wall: 'マスとマスの境目をなぞると壁になります。もう一度なぞると消えます',
    route: '正解にしたい道をなぞってください。通ったマスをもう一度押すと、そこから描き直せます',
    text: 'マスを押すとその場で文字が打てます。Enterで右へ進みます',
    symbol: '記号を置きます。「必ず通る（○）」「通らない（×）」を選ぶとギミックになります',
    start: 'マスを押すとSTART。もう一度押すと消えます（複数置けます）',
    goal: 'マスを押すとGOAL。もう一度押すと消えます（複数置けます）',
    oneway: '壁のない境目を押すと、通れる向きが 片方 → 逆 → なし と切りかわります',
    cellcolor: 'マスに色をつけます。同じ色をもう一度押すと消えます',
    erase: '壁・文字・記号・START/GOAL を消します。ルートの上を押すと、そこから先のルートを消します'
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, isNaN(v) ? a : v)); }
  function setStatus(msg) { if (msg !== undefined && msg !== null) $('#statusText').textContent = msg; }

  function afterEdit() { A.selStep = -1; ED.clearDisplay(); refresh(); ED.draw(); }

  /* =======================================================================
   * 画面の作り直し（変更があったら必ずここを通す）
   * ===================================================================== */
  function refresh() {
    A.results = ST.runSteps(A.maze, A.steps);
    A.checks = ST.validateAll(A.maze, A.steps);
    renderSteps();
    renderChecks();
    updateRouteLen();
    updateTry();
    updateRouteView();
    $('#btnUndo').disabled = !ED.canUndo();
    $('#btnRedo').disabled = !ED.canRedo();
    $('#btnUndoStep').disabled = !A.stepHistory.length;
    $('#answerText').textContent = ST.finalText(A.results) || '—';
    renderFlow();
    saveAuto();
  }

  /** 表示する盤面を決める（設計図か、選んだSTEPの結果か） */
  function updateRouteView() {
    const opts = ED.state.renderOpts;
    if (A.selStep >= 0) return;
    if ($('#ckShowSub').checked && A.maze.subBoard) {
      ED.setDisplay({ board: R.subBoardAsBoard(A.maze.subBoard), readOnly: true, opts: { showRoute: false } });
      $('#viewBadge').className = 'viewbadge show';
      $('#viewBadge').textContent = '文字盤を見ています（編集するにはチェックを外す）';
      return;
    }
    ED.clearDisplay();
    $('#viewBadge').className = 'viewbadge';
    const rt = A.maze.routes[0];
    if ($('#ckShowShortest').checked) {
      const s = E.solve(A.maze, { useAvoid: true });
      opts.routePath = s.ok ? s.path : null;
      opts.showRoute = s.ok;
      opts.routeColor = '#1c7ed6';
      setStatus(s.ok ? '最短ルート：' + s.dist + 'マス' + (s.multiple ? '／同じ長さの道が' + (s.capped ? 'たくさん' : s.count) + '通りあります' : '／1本だけです') : s.reason);
    } else if ($('#ckShowRoute').checked && rt) {
      opts.routePath = rt.cells;
      opts.showRoute = true;
      opts.routeColor = '#f76707';
    } else {
      opts.routePath = null;
      opts.showRoute = false;
    }
    ED.draw();
  }

  function updateRouteLen() {
    const rt = A.maze.routes[0];
    const n = rt ? rt.cells.length : 0;
    $('#routeLen').textContent = 'ルートの長さ：' + n + 'マス' + (n > 1 ? '（' + (n - 1) + '歩）' : '');
    if (ED.state.renderOpts.showRoute) ED.draw();
  }

  function onSelectChange(sel) {
    if (!sel.length) {
      $('#selInfo').textContent = '「えらぶ」で文字や記号をクリックしてください。ドラッグで動かせます。範囲をドラッグすればまとめて選べます。';
    } else if (sel.length === 1) {
      const e = sel[0];
      $('#selInfo').textContent = '選んでいるもの：「' + e.value + '」（' + (M.COLORS[e.color] ? M.COLORS[e.color].label : e.color) + '／' + (e.r + 1) + '行' + (e.c + 1) + '列）';
    } else {
      $('#selInfo').textContent = sel.length + '個を選んでいます';
    }
  }

  /* =======================================================================
   * ② 正解ルートから迷路を作る
   * ===================================================================== */
  function makeMazeFromRoute() {
    const rt = A.maze.routes[0];
    if (!rt || rt.cells.length < 2) { setStatus('先に「ルート」ツールで道を描いてください'); return; }
    const chk = G.checkRoute(A.maze, rt.cells);
    if (!chk.ok) { setStatus('⚠ ' + chk.reason); return; }
    ED.pushHistory();
    const res = G.fromRoute(A.maze, rt.cells, { branchiness: (+$('#inBranch').value) / 100 });
    if (!res.ok) { setStatus('⚠ ' + res.reason); return; }
    A.maze.walls = res.walls;
    // START / GOAL は必ずルートの両はしに置き直す
    // （別の場所に残っていると「描いた道が最短ではない」ことになってしまう）
    const a = rt.cells[0], b = rt.cells[rt.cells.length - 1];
    A.maze.starts = [M.makeStart(a.r, a.c)];
    A.maze.goals = [M.makeGoal(b.r, b.c)];
    setStatus((res.unique ? '✓ ' : '⚠ ') + res.message);
    afterEdit();
  }

  /* =======================================================================
   * ③ 文字を置く / ダミーをまく
   * ===================================================================== */
  function currentPath() {
    const rt = A.maze.routes[0];
    if (rt && rt.cells.length > 1) return rt.cells;
    const s = E.solve(A.maze, { useAvoid: true });
    return s.ok ? s.path : null;
  }

  function placePhrase() {
    const text = $('#inPhrase').value.trim();
    if (!text) { setStatus('置く文章を入れてください'); return; }
    const path = currentPath();
    if (!path) { setStatus('先にルートを描くか、START/GOALを置いてください'); return; }
    ED.pushHistory();
    const res = O.autoPlaceText(A.maze, path, text, {
      mode: $('#inPlaceMode').value,
      color: $('#inPhraseColor').value
    });
    setStatus(res.ok ? '✓ ' + res.message : '⚠ ' + res.reason);
    afterEdit();
  }

  function scatter() {
    const path = currentPath() || [];
    ED.pushHistory();
    const poolKey = $('#inDummyPool').value;
    const res = O.scatterDummies(A.maze, path, {
      density: (+$('#inDensity').value) / 100,
      colors: A.dummyColors.slice(),
      pool: poolKey === 'same' ? null : O.POOLS[poolKey]
    });
    setStatus('✓ ' + res.message);
    afterEdit();
  }

  /* =======================================================================
   * ⑤ 読み取りのお試し
   * ===================================================================== */
  function updateTry() {
    const path = currentPath();
    if (!path) { $('#tryResult').textContent = '（ルートがありません）'; return; }
    let chars = O.collectOnPath(A.maze, path, {});
    const mode = $('#tryFilterMode').value;
    const col = $('#tryColor').value;
    if (mode === 'include') chars = O.filters.includeColors(chars, [col]);
    if (mode === 'exclude') chars = O.filters.excludeColors(chars, [col]);
    chars = O.applyOrder(chars, $('#tryOrder').value, $('#tryParity').value);
    const t = O.charsToText(chars);
    $('#tryResult').textContent = t ? '「' + t + '」（' + chars.length + '文字）' : '（読める文字がありません）';
  }

  function tryToSteps() {
    const mode = $('#tryFilterMode').value;
    addStep('solve', {}, true);
    addStep('extract', { order: 'route', parity: 'all' }, true);
    if (mode !== 'none') addStep('filter-color', { mode: mode, colors: [$('#tryColor').value] }, true);
    if ($('#tryOrder').value !== 'route' || $('#tryParity').value !== 'all') {
      addStep('reorder', { order: $('#tryOrder').value, parity: $('#tryParity').value }, true);
    }
    refresh();
    setStatus('お試しの読み方をSTEPにしました');
  }

  /* =======================================================================
   * ⑥ 別盤面（文字盤）
   * ===================================================================== */
  function fillSub() {
    if (!A.maze.subBoard) { setStatus('先に「作る」を押してください'); return; }
    ED.pushHistory();
    const lines = $('#inSubText').value.split('\n');
    const sub = A.maze.subBoard;
    for (let r = 0; r < sub.rows; r++) {
      const chars = Array.from(lines[r] || '');
      for (let c = 0; c < sub.cols; c++) {
        sub.cells[r][c] = { value: chars[c] || '', color: sub.cells[r][c] ? sub.cells[r][c].color : 'black' };
      }
    }
    setStatus('文字盤に反映しました');
    afterEdit();
  }

  function randSub() {
    if (!A.maze.subBoard) { setStatus('先に「作る」を押してください'); return; }
    ED.pushHistory();
    const sub = A.maze.subBoard;
    const pool = O.POOLS.hiragana;
    const lines = [];
    for (let r = 0; r < sub.rows; r++) {
      let line = '';
      for (let c = 0; c < sub.cols; c++) {
        const v = pool[Math.floor(Math.random() * pool.length)];
        sub.cells[r][c] = { value: v, color: 'black' };
        line += v;
      }
      lines.push(line);
    }
    $('#inSubText').value = lines.join('\n');
    afterEdit();
  }

  /* =======================================================================
   * STEP
   * ===================================================================== */
  /** STEPをいじる前に、いまの並びを覚えておく（迷路の「もどす」とは別の履歴） */
  function pushStepHistory() {
    A.stepHistory.push(JSON.stringify(A.steps));
    if (A.stepHistory.length > 50) A.stepHistory.shift();
  }

  function undoStep() {
    if (!A.stepHistory.length) { setStatus('もどせるSTEPの変更がありません'); return; }
    A.steps = JSON.parse(A.stepHistory.pop());
    A.selStep = -1;
    ED.clearDisplay();
    refresh();
    setStatus('STEPをひとつ前にもどしました（迷路は変わっていません）');
  }

  function addStep(type, params, quiet) {
    pushStepHistory();
    const st = ST.makeStep(type, params);
    A.steps.push(st);
    if (!quiet) { A.selStep = A.steps.length - 1; refresh(); showStepBoard(A.selStep); }
  }

  function renderSteps() {
    const list = $('#stepList');
    list.textContent = '';
    if (!A.steps.length) {
      const p = el('p', 'hint', 'まだSTEPがありません。下の一覧から選んで「＋ STEPを足す」を押してください。');
      list.appendChild(p);
      return;
    }
    A.steps.forEach(function (st, i) {
      const res = A.results[i + 1] || {};
      const node = el('div', 'step' + (A.selStep === i ? ' sel' : '') + (res.error ? ' err' : (res.warn ? ' warn' : '')));

      const head = el('div', 'step-head');
      head.appendChild(el('span', 'step-no', 'STEP' + (i + 1)));
      head.appendChild(el('span', 'step-title', ST.describe(st)));
      head.addEventListener('click', function () {
        A.selStep = (A.selStep === i) ? -1 : i;
        refresh();
        if (A.selStep >= 0) showStepBoard(A.selStep); else ED.clearDisplay();
      });
      node.appendChild(head);

      const log = el('div', 'step-log', (res.error ? '⚠ ' + res.error : (res.warn ? '⚠ ' + res.warn + '　' : '') + (res.log || '')));
      node.appendChild(log);

      if (A.selStep === i) {
        const body = el('div', 'step-body');
        buildStepForm(body, st, i);
        const mini = el('div', 'step-mini');
        mini.appendChild(mkBtn('↑', function () { moveStep(i, -1); }));
        mini.appendChild(mkBtn('↓', function () { moveStep(i, 1); }));
        mini.appendChild(mkBtn('複製', function () {
          pushStepHistory();
          A.steps.splice(i + 1, 0, ST.makeStep(st.type, JSON.parse(JSON.stringify(st.params))));
          A.selStep = i + 1; refresh();
        }));
        const del = mkBtn('消す', function () {
          pushStepHistory();
          A.steps.splice(i, 1); A.selStep = -1; refresh(); ED.clearDisplay();
        });
        del.className = 'danger';
        mini.appendChild(del);
        body.appendChild(mini);
        node.appendChild(body);
      }
      list.appendChild(node);
    });
  }

  function mkBtn(label, fn) { const b = el('button', '', label); b.addEventListener('click', fn); return b; }

  function moveStep(i, d) {
    const j = i + d;
    if (j < 0 || j >= A.steps.length) return;
    pushStepHistory();
    const t = A.steps[i]; A.steps[i] = A.steps[j]; A.steps[j] = t;
    A.selStep = j; refresh(); showStepBoard(j);
  }

  /** STEPの結果の盤面を画面に出す（見るだけ・編集はできない） */
  function showStepBoard(i) {
    const res = A.results[i + 1];
    if (!res) return;
    ED.setDisplay({ board: res.board, path: res.path, cells: res.cells, readOnly: true });
    $('#viewBadge').className = 'viewbadge show';
    $('#viewBadge').textContent = 'STEP' + (i + 1) + ' のあとの盤面（見るだけ）';
    ED.fit();
  }

  /* ---- STEPの設定フォームを組み立てる ---- */
  function buildStepForm(parent, st, index) {
    const fields = FORMS[st.type] || [];
    const op = MZ.ops.get(st.type);
    if (op) {
      const io = el('div', 'hint', op.inputs + ' → ' + op.outputs);
      parent.appendChild(io);
    }
    fields.forEach(function (f) {
      const row = el('div', 'row');
      const upd = function (v) {
        pushStepHistory();
        st.params[f.k] = v;
        refresh();
        if (A.selStep >= 0) showStepBoard(A.selStep);
      };

      if (f.t === 'check') {
        const lb = el('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!st.params[f.k];
        cb.addEventListener('change', function () { upd(cb.checked); });
        lb.appendChild(cb); lb.appendChild(document.createTextNode(' ' + f.label));
        row.appendChild(lb);
      } else if (f.t === 'text') {
        const lb = el('label', '', f.label); lb.style.flex = '1';
        const ip = document.createElement('input');
        ip.type = 'text'; ip.value = st.params[f.k] || '';
        ip.addEventListener('change', function () { upd(ip.value); });
        lb.appendChild(ip); row.appendChild(lb);
      } else if (f.t === 'num') {
        const lb = el('label', '', f.label);
        const ip = document.createElement('input');
        ip.type = 'number'; ip.className = 'num'; ip.value = st.params[f.k] || 0;
        ip.addEventListener('change', function () { upd(+ip.value); });
        lb.appendChild(ip); row.appendChild(lb);
      } else if (f.t === 'sel') {
        const se = document.createElement('select');
        f.opts.forEach(function (o) { const x = el('option', '', o[1]); x.value = o[0]; se.appendChild(x); });
        se.value = st.params[f.k];
        se.addEventListener('change', function () { upd(se.value); });
        row.appendChild(se);
      } else if (f.t === 'order' || f.t === 'parity') {
        const src = f.t === 'order' ? O.orders : O.parities;
        const lb = el('label', '', f.t === 'order' ? '読む順' : '何番目');
        const se = document.createElement('select');
        Object.keys(src).forEach(function (k) { const x = el('option', '', src[k].label); x.value = k; se.appendChild(x); });
        se.value = st.params[f.k] || (f.t === 'order' ? 'route' : 'all');
        se.addEventListener('change', function () { upd(se.value); });
        lb.appendChild(se); row.appendChild(lb);
      } else if (f.t === 'delmode') {
        const lb = el('label', '', '消し方');
        const se = document.createElement('select');
        [['disable', '無効にする（通れる・読めなくなる）'], ['hide', '見た目だけ消す'], ['delete', '完全に消す']]
          .forEach(function (o) { const x = el('option', '', o[1]); x.value = o[0]; se.appendChild(x); });
        se.value = st.params[f.k] || 'disable';
        se.addEventListener('change', function () { upd(se.value); });
        lb.appendChild(se); row.appendChild(lb);
      } else if (f.t === 'colors') {
        const wrap = el('div');
        wrap.appendChild(el('div', 'hint', f.label || '色'));
        const box = el('div', 'row');
        M.COLOR_KEYS.forEach(function (k) {
          const b = el('button', 'sw' + ((st.params[f.k] || []).indexOf(k) >= 0 ? ' on' : ''));
          b.style.background = M.COLORS[k].hex;
          b.title = M.COLORS[k].label;
          b.addEventListener('click', function () {
            const cur = (st.params[f.k] || []).slice();
            const at = cur.indexOf(k);
            if (at >= 0) cur.splice(at, 1); else cur.push(k);
            upd(cur);
          });
          box.appendChild(b);
        });
        wrap.appendChild(box);
        row.appendChild(wrap);
      } else if (f.t === 'color1') {
        const lb = el('label', '', f.label);
        const se = document.createElement('select');
        const none = el('option', '', '色は問わない'); none.value = ''; se.appendChild(none);
        M.COLOR_KEYS.forEach(function (k) { const x = el('option', '', M.COLORS[k].label); x.value = k; se.appendChild(x); });
        se.value = st.params[f.k] || '';
        se.addEventListener('change', function () { upd(se.value); });
        lb.appendChild(se); row.appendChild(lb);
      } else if (f.t === 'kinds') {
        const wrap = el('div');
        wrap.appendChild(el('div', 'hint', f.label || '読む種類（選ばなければ全部）'));
        const box = el('div', 'row');
        [['text', '文字'], ['number', '数字'], ['symbol', '記号']].forEach(function (o) {
          const b = el('button', '', o[1]);
          b.style.padding = '4px 10px'; b.style.minHeight = '32px';
          if ((st.params[f.k] || []).indexOf(o[0]) >= 0) b.classList.add('on');
          b.addEventListener('click', function () {
            const cur = (st.params[f.k] || []).slice();
            const at = cur.indexOf(o[0]);
            if (at >= 0) cur.splice(at, 1); else cur.push(o[0]);
            upd(cur);
          });
          box.appendChild(b);
        });
        wrap.appendChild(box);
        row.appendChild(wrap);
      } else if (f.t === 'point') {
        const lb = el('label', '', f.label);
        const se = document.createElement('select');
        const auto = el('option', '', '最初のものを使う'); auto.value = ''; se.appendChild(auto);
        (A.maze[f.list] || []).forEach(function (p) {
          const x = el('option', '', (p.label || '') + '（' + (p.r + 1) + '行' + (p.c + 1) + '列）');
          x.value = p.id; se.appendChild(x);
        });
        se.value = st.params[f.k] || '';
        se.addEventListener('change', function () { upd(se.value); });
        lb.appendChild(se); row.appendChild(lb);
      }
      parent.appendChild(row);
    });
  }

  /* ---- 謎の流れを言葉で書き出す ---- */
  function renderFlow() {
    const box = $('#flowBox');
    box.textContent = '';
    if (!A.steps.length) { box.textContent = '謎の流れがここに出ます'; return; }
    const parts = ['最初の迷路'];
    A.steps.forEach(function (st, i) {
      const res = A.results[i + 1] || {};
      parts.push('↓ ' + ST.describe(st) + (res.log ? '　' + res.log : ''));
    });
    parts.forEach(function (t) { box.appendChild(el('div', '', t)); });
  }

  /* =======================================================================
   * チェック結果
   * ===================================================================== */
  function renderChecks() {
    const box = $('#checkList');
    box.textContent = '';
    A.checks.forEach(function (c) {
      const row = el('div', 'check ' + c.level);
      row.appendChild(el('span', 'mk', c.level === 'ok' ? '✓' : (c.level === 'warn' ? '⚠' : '✕')));
      row.appendChild(el('span', '', c.text));
      box.appendChild(row);
    });
  }

  /* =======================================================================
   * プレイヤー画面（制作者むけの情報を隠して見せる）
   * ===================================================================== */
  function playerOpts(showAnswer) {
    return {
      cellPx: +$('#inPrintCell').value,
      mono: $('#ckMono').checked,
      legend: $('#ckLegend').checked,
      showGrid: $('#ckGrid').checked,
      showRoles: false,      // ○や×の「はたらき」は見せない
      showGhost: false,      // 消した壁のあとも見せない
      showRoute: !!showAnswer,
      exportScale: 2
    };
  }

  /** プレイヤーが実際に目にする「画面」を並べる（同じ盤面が続くときはまとめる） */
  function buildScreens() {
    const screens = [];
    let lastKey = null;
    A.results.forEach(function (r, i) {
      if (!r.board) return;
      const key = JSON.stringify(r.board);
      if (key === lastKey) {
        // 盤面が変わっていないので、前の画面に説明だけ足す
        if (screens.length && r.step) {
          const prev = screens[screens.length - 1];
          prev.notes.push(ST.describe(r.step) + (r.log ? '　' + r.log : ''));
          // 「最初の盤面」には道すじが無いので、その盤面を解いたSTEPの答えをここで受けとる
          if (!prev.path && r.path) prev.path = r.path;
        }
        return;
      }
      lastKey = key;
      screens.push({
        board: r.board,
        path: r.path,
        title: r.index < 0 ? '問題' : 'STEP' + (r.index + 1) + ' のあと',
        notes: r.step ? [ST.describe(r.step) + (r.log ? '　' + r.log : '')] : ['まずはこの迷路を解いてください']
      });
    });
    return screens;
  }

  function openPlayer() {
    A.player.screens = buildScreens();
    A.player.index = 0;
    A.player.showAnswer = false;
    $('#playerView').hidden = false;
    renderPlayer();
  }

  function movePlayer(d) {
    A.player.index = Math.max(0, Math.min(A.player.screens.length - 1, A.player.index + d));
    A.player.showAnswer = false;
    renderPlayer();
  }

  function renderPlayer() {
    const sc = A.player.screens[A.player.index];
    const body = $('#playerBody');
    body.textContent = '';
    if (!sc) { body.appendChild(el('p', '', 'STEPを作るとここに出ます')); return; }
    $('#playerStep').textContent = (A.player.index + 1) + ' / ' + A.player.screens.length + '　' + sc.title;
    const o = playerOpts(A.player.showAnswer);
    o.routePath = sc.path;
    const img = document.createElement('img');
    img.src = R.toDataURL(sc.board, o);
    img.alt = sc.title;
    body.appendChild(img);
    if (A.player.showAnswer) {
      const note = el('div', 'player-note');
      note.appendChild(el('b', '', 'この画面での答え'));
      sc.notes.forEach(function (t) { note.appendChild(el('div', '', '・' + t)); });
      body.appendChild(note);
    }
    $('#btnPlayerAnswer').textContent = A.player.showAnswer ? 'こたえを隠す' : 'こたえを見る';
    $('#btnPlayerPrev').disabled = A.player.index === 0;
    $('#btnPlayerNext').disabled = A.player.index >= A.player.screens.length - 1;
  }

  /* =======================================================================
   * 印刷・画像で保存
   *   どちらも画面と同じ MZ.render.drawBoard を使う。
   *   （別々に描くと「印刷にだけ何かが無い」が必ず起きるため）
   * ===================================================================== */
  function printOpts(showAnswer) {
    const o = playerOpts(showAnswer);
    o.bg = '#ffffff';
    return o;
  }

  function doPrint() {
    const area = $('#printArea');
    area.textContent = '';
    const screens = buildScreens();
    const pages = $('#ckPrintSteps').checked ? screens : screens.slice(0, 1);

    pages.forEach(function (sc, i) {
      const page = el('div', 'sheet-page');
      page.appendChild(el('h2', '', (A.maze.meta.title || '迷路謎') + '　' + sc.title));
      // 問題用紙には「解く人がやること」を必ず刷る。これが無いと解きようがない
      if (i === 0 && A.maze.meta.instruction) {
        const inst = el('p', 'print-inst', A.maze.meta.instruction);
        page.appendChild(inst);
      }
      const o = printOpts(false);
      o.routePath = null;
      const img = document.createElement('img');
      img.src = R.toDataURL(sc.board, o);
      page.appendChild(img);
      area.appendChild(page);
    });

    if ($('#ckPrintAnswer').checked) {
      screens.forEach(function (sc) {
        if (!sc.path) return;
        const page = el('div', 'sheet-page');
        page.appendChild(el('h2', '', '【答え】' + sc.title));
        const o = printOpts(true);
        o.routePath = sc.path;
        const img = document.createElement('img');
        img.src = R.toDataURL(sc.board, o);
        page.appendChild(img);
        sc.notes.forEach(function (t) { page.appendChild(el('div', '', t)); });
        area.appendChild(page);
      });
      const last = el('div', 'sheet-page');
      last.appendChild(el('h2', '', '【最終こたえ】'));
      last.appendChild(el('div', '', ST.finalText(A.results) || '（まだ出ていません）'));
      area.appendChild(last);
    }
    setTimeout(function () { window.print(); }, 120);
  }

  function doPng() {
    const board = ED.shownBoard();
    const o = printOpts(true);
    o.routePath = (A.selStep >= 0 && A.results[A.selStep + 1]) ? A.results[A.selStep + 1].path
      : (ED.state.renderOpts.routePath || null);
    o.showRoute = $('#ckPrintAnswer').checked && !!o.routePath;
    o.title = A.maze.meta.title || '';
    const url = R.toDataURL(board, o);
    const a = document.createElement('a');
    a.href = url;
    a.download = (A.maze.meta.title || 'meiro-nazo') + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus('画像を保存しました（' + a.download + '）');
  }

  /* =======================================================================
   * 保存・読み込み
   *   localStorage はプライベートモードで落ちるので必ず try-catch で包む
   * ===================================================================== */
  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function writeStore(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; }
    catch (e) { setStatus('⚠ このブラウザでは保存できませんでした（プライベートモードかもしれません）。「ファイルに書き出す」をお使いください'); return false; }
  }
  function saveAuto() {
    try { localStorage.setItem(AUTO_KEY, JSON.stringify({ maze: A.maze, steps: A.steps })); } catch (e) { /* 保存できなくても動作は続ける */ }
  }
  function restoreAuto() {
    try {
      const raw = localStorage.getItem(AUTO_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || !d.maze) return false;
      applyData(d);
      setStatus('前回のつづきを開きました');
      return true;
    } catch (e) { return false; }
  }

  function applyData(d) {
    ED.replaceMaze(M.normalize(d.maze));
    A.maze = ED.getMaze();
    A.steps = (d.steps || []).map(function (s) {
      const st = ST.makeStep(s.type, s.params);
      st.note = s.note || '';
      return st;
    });
    A.selStep = -1;
    A.stepHistory = [];
    ED.clearDisplay();
    $('#inRows').value = A.maze.rows;
    $('#inCols').value = A.maze.cols;
    if (A.maze.subBoard) {
      $('#inSubRows').value = A.maze.subBoard.rows;
      $('#inSubCols').value = A.maze.subBoard.cols;
      $('#inSubText').value = A.maze.subBoard.cells.map(function (row) {
        return row.map(function (c) { return c.value || ' '; }).join('');
      }).join('\n');
    }
  }

  function saveWork() {
    const title = $('#saveTitle').value.trim() || ('迷路謎 ' + new Date().toLocaleDateString('ja-JP'));
    A.maze.meta.title = title;
    A.maze.meta.updatedAt = Date.now();
    const list = readStore();
    const data = { maze: A.maze, steps: A.steps };
    const found = A.openId ? list.filter(function (w) { return w.id === A.openId; })[0] : null;
    if (found) { found.title = title; found.updatedAt = Date.now(); found.data = data; }
    else {
      const id = M.newId('wk');
      list.unshift({ id: id, title: title, updatedAt: Date.now(), data: data });
      A.openId = id;
    }
    if (writeStore(list)) setStatus('✓「' + title + '」を保存しました');
    $('#saveModal').hidden = true;
  }

  function openWorkList() {
    const list = readStore();
    const box = $('#workList');
    box.textContent = '';
    if (!list.length) box.appendChild(el('p', 'hint', 'まだ保存した作品がありません'));
    list.forEach(function (w) {
      const row = el('div', 'work-item');
      const nm = el('div', 'nm', w.title);
      nm.appendChild(el('div', 'dt', new Date(w.updatedAt).toLocaleString('ja-JP')));
      row.appendChild(nm);
      row.appendChild(mkBtn('ひらく', function () {
        applyData(w.data);
        A.openId = w.id;
        $('#openModal').hidden = true;
        refresh(); ED.fit();
        setStatus('「' + w.title + '」をひらきました');
      }));
      const del = mkBtn('消す', function () {
        if (!confirm('「' + w.title + '」を消します。もどせません。よろしいですか？')) return;
        writeStore(readStore().filter(function (x) { return x.id !== w.id; }));
        openWorkList();
      });
      del.className = 'danger';
      row.appendChild(del);
      box.appendChild(row);
    });
    $('#openModal').hidden = false;
  }

  function exportFile() {
    const data = JSON.stringify({ v: 1, maze: A.maze, steps: A.steps }, null, 1);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (A.maze.meta.title || 'meiro-nazo') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    setStatus('ファイルに書き出しました');
  }

  function importFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = function () {
      try {
        const d = JSON.parse(rd.result);
        applyData({ maze: d.maze || d, steps: d.steps || [] });
        A.openId = null;
        refresh(); ED.fit();
        setStatus('ファイルから読みこみました');
      } catch (err) {
        setStatus('⚠ このファイルは読めませんでした');
      }
    };
    rd.readAsText(f);
    e.target.value = '';
  }

  /* ===================================================================== */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
