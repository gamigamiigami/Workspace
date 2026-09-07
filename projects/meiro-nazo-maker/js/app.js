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
    targets: [],            // 「このルートをこの色で読んだらこの言葉」の指定
    dummyColors: ['black'],
    player: { index: 0, showAnswer: false, screens: [] },
    openId: null,
    pngInstBase: null       // #inPngInst に最後に自動で入れた指示文（変わったときだけ上書きする）
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
    'remove-walls': [{ k: 'colors', t: 'colors', label: '消す線の色', hideIf: 'keys' }],
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
    restoreAuto();          // 前回のつづきがあれば盤面に入れておく
    refresh();
    // 最初に出るのは「かんたん作成」画面（index.html で show 済み）
  }

  /* 外（かんたん作成画面）から呼ぶための窓口 */
  MZ.app = {
    applyBuilt: applyBuilt,
    showEditor: showEditor,
    showWizard: showWizard,
    showWork: showWork,
    showBoard: showBoard,
    stageInfo: stageInfo,
    summary: function () {
      return { instruction: A.maze.meta.instruction || '', answer: ST.finalText(A.results) || '',
               selStep: A.selStep };
    },
    viewDesign: viewDesign,
    viewStage: viewStage,
    fit: function () { ED.fit(); },
    doPrint: function () { doPrint(); },
    doPng: function () { doPng(); },
    doPngShare: function () { doPngShare(); },
    canShareFiles: function () { return canShareFiles(); },
    setTool: setTool,
    setStatus: setStatus,
    /** 自動作成のあと、手で直したところがあるか（作り直す前の確認に使う） */
    hasHandEdits: function () { return ED.canUndo(); },
  };

  /** かんたん作成で出来たものを、盤面（編集する側）の状態として受けとる */
  function applyBuilt(maze, steps, grownTo) {
    ED.replaceMaze(M.normalize(maze));
    A.maze = ED.getMaze();
    A.steps = steps;
    A.stepHistory = [];
    A.selStep = -1;
    A.openId = null;
    ED.state.history = []; ED.state.future = [];
    ED.clearDisplay();
    MZ.opt.set('rows', A.maze.rows);
    MZ.opt.set('cols', A.maze.cols);
    // ⑤の「C 読み方とこたえ」を、自動作成した段ごとの読み方で埋めておく。
    // 空のまま渡すと そこが空っぽで、
    // 何を直せばいいのか分からなくなってしまう。
    A.results = ST.runSteps(A.maze, A.steps);
    A.targets = deriveTargetsFromSteps();
    refresh();
    if (grownTo) setStatus('迷路を ' + grownTo + ' にして作りました');
    // 作ったら「④ できたものを見る・直す」と「⑤ もっと細かく直す」を出す。
    // ④に出る盤面は絵ではなく本物の盤面なので、見ながらそのまま直せる。
    showWork();
  }

  /**
   * できたものの置き場（④）と、こまかい設定（⑤）を出す。
   * ★ここが「1ページ統合」の要★
   *   前の版は「かんたん作成の下に、これまでの編集画面をそのままぶら下げる」形だった。
   *   結果の絵と編集用の盤面が別々にあり、直すには下の別の盤面まで行く必要があった。
   *   いまは④に出ている盤面が編集そのものなので、見ている絵を直接直せる。
   */
  function showWork() {
    $('#wizStep4').hidden = false;
    $('#app').classList.add('show');
    // ★タブは盤面より上にあるので、盤面の大きさを合わせる前に作っておく。
    //   あとから増えると そのぶん盤面が下にずれ、描いている途中で
    //   指の位置と迷路のマスがずれてしまう（ルートが1マスで途切れていた）。
    if (MZ.wizard && MZ.wizard.syncViews) MZ.wizard.syncViews();
    setTimeout(function () { ED.fit(); }, 30);
  }

  /** 自動作成のSTEPから、段ごとの「読むルート・色・順・こたえ」を読みとって targets の形にする */
  function deriveTargetsFromSteps() {
    const solves = A.results.filter(function (r) { return r.step && r.step.type === 'solve'; });
    return solves.map(function (sr, k) {
      const nextIdx = (k + 1 < solves.length) ? solves[k + 1].index : Infinity;
      const chain = A.results.filter(function (r) { return r.index >= sr.index && r.index < nextIdx; });
      let color = null, order = 'route', text = '';
      chain.forEach(function (r) {
        // 盤面を変えるSTEP（壁を消す・STARTを移すなど）を通ると text は一度リセットされる。
        // だから「最後の要素」ではなく「最後に出てきた読める文字」を拾う。
        if (r.text !== null && r.text !== undefined) text = r.text;
        if (!r.step) return;
        if (r.step.type === 'filter-color' && r.step.params.mode === 'include' &&
            r.step.params.colors && r.step.params.colors.length === 1) {
          color = r.step.params.colors[0];
        }
        if (r.step.type === 'reorder') order = r.step.params.order || 'route';
      });
      return { srcId: 'step' + sr.index, color: color, order: order, text: text };
    });
  }

  /**
   * ⑤（もっと細かく直す）まで行く。
   * 画面の切りかえではなく、同じページの下のほうへスクロールするだけ。
   */
  /** ④（できたものを見る・直す）まで行く。ふだんの「直す」はこちら */
  function showBoard() {
    showWork();
    setTimeout(function () {
      ED.fit();
      $('#wizStep4').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  }

  function showEditor() {
    showWork();
    refresh();
    // 表示された直後は盤面の大きさが確定していないので、1フレーム待ってから合わせる
    setTimeout(function () {
      ED.fit();
      $('#app').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  }
  /** ページの上（作るところ）へもどる。④⑤は開いたまま残す */
  function showWizard() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** ツールを外から選ぶ */
  function setTool(name) {
    document.querySelectorAll('.tool').forEach(function (x) {
      x.classList.toggle('on', x.dataset.tool === name);
    });
    ED.set('tool', name);
    // 記号の細かい設定は「きごう」を選んだときだけ出す（ふだんは場所を取らせない）
    const sb = $('#symbolBar');
    if (sb) sb.hidden = (name !== 'symbol');
    // 「ルート」のときだけ、次に押すボタンを盤面のすぐ下に出す
    const dh = $('#drawHelp');
    if (dh) dh.hidden = (name !== 'route');
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

    // まぎれ文字の色
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
    $('#btnHelpClose').addEventListener('click', closeHelp);
    // 使い方は中身が長い。背景を押しても Escape でも閉じられるようにする
    $('#helpModal').addEventListener('click', function (e) { if (e.target === this) closeHelp(); });
    $('#btnPlay').addEventListener('click', openPlayer);
    $('#btnPlayerClose').addEventListener('click', function () { $('#playerView').hidden = true; });
    $('#btnPlayerPrev').addEventListener('click', function () { movePlayer(-1); });
    $('#btnPlayerNext').addEventListener('click', function () { movePlayer(1); });
    $('#btnPlayerAnswer').addEventListener('click', function () { A.player.showAnswer = !A.player.showAnswer; renderPlayer(); });
    $('#btnPrint').addEventListener('click', doPrint);
    $('#inPngInst').addEventListener('input', applyInstEdit);
    $('#btnPng').addEventListener('click', doPng);
    $('#btnSave').addEventListener('click', function () { $('#saveTitle').value = A.maze.meta.title || ''; $('#saveModal').hidden = false; $('#saveTitle').focus(); });
    $('#btnSaveCancel').addEventListener('click', function () { $('#saveModal').hidden = true; });
    $('#btnSaveDo').addEventListener('click', saveWork);
    $('#btnOpen').addEventListener('click', openWorkList);
    $('#btnOpenCancel').addEventListener('click', function () { $('#openModal').hidden = true; });
    $('#btnExport').addEventListener('click', exportFile);
    $('#btnImport').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', importFile);

    /* ---- A 盤面と文字の量（②の「もっと細かく決める」と同じ設定を見ている） ---- */
    MZ.opt.bind('#inRows', 'rows');
    MZ.opt.bind('#inCols', 'cols');
    MZ.opt.bind('#inDensity', 'density');
    MZ.opt.bind('#inLoops', 'loops');
    $('#btnResize').addEventListener('click', function () {
      ED.pushHistory();
      M.resize(A.maze, MZ.opt.get('rows'), MZ.opt.get('cols'));
      afterEdit();
      ED.fit();
    });
    $('#inCell').addEventListener('input', function () {
      ED.state.renderOpts.cellPx = +this.value;
      ED.fit();
    });
    $('#ckGrid').addEventListener('change', function () { ED.state.renderOpts.showGrid = this.checked; ED.draw(); });
    $('#btnAllWalls').addEventListener('click', function () {
      if (!askIfMade('いまの迷路の道をぜんぶ壁でふさぎます。')) return;
      ED.pushHistory(); M.fillAllWalls(A.maze); afterEdit(); setStatus('全部かべにしました（↶ でもどせます）');
    });
    $('#btnBorderOnly').addEventListener('click', function () {
      if (!askIfMade('いまの迷路の壁をぜんぶ消して、外わくだけにします。')) return;
      ED.pushHistory(); M.onlyBorderWalls(A.maze); afterEdit(); setStatus('外わくだけにしました（↶ でもどせます）');
    });
    $('#btnRandomMaze').addEventListener('click', function () {
      if (!askIfMade('いまの迷路の壁をぜんぶ作り直します。')) return;
      ED.pushHistory();
      A.maze.walls = G.random(A.maze).walls;
      setStatus('迷路をおまかせで作りました');
      afterEdit();
    });

    /* ---- B 正解ルート ---- */
    $('#btnMakeMaze').addEventListener('click', makeMazeFromRoute);
    $('#btnMakeMazeHere').addEventListener('click', makeMazeFromRoute);
    $('#btnOpenRoute').addEventListener('click', function () {
      const rt = A.maze.routes[ED.state.routeIndex];
      if (!rt) { setStatus('先にルートを描いてください'); return; }
      ED.pushHistory();
      const res = G.openRoute(A.maze, rt.cells);
      setStatus(res.ok ? res.message : res.reason);
      afterEdit();
    });
    $('#btnClearRoute').addEventListener('click', function () {
      const rt = A.maze.routes[ED.state.routeIndex];
      if (!rt || !rt.cells.length) { setStatus('このルートはもう空です'); return; }
      ED.pushHistory();
      const n = rt.cells.length;
      rt.cells = [];
      afterEdit();
      setStatus('ルート（' + n + 'マス）を消しました（↶ でもどせます）');
    });
    $('#btnLengthen').addEventListener('click', lengthenRoute);
    $('#routePick').addEventListener('change', function () {
      ED.state.routeIndex = +this.value;
      updateRouteView(); updateRouteLen(); renderTargets();
    });
    $('#btnAddRoute').addEventListener('click', function () {
      ED.pushHistory();
      A.maze.routes.push(M.makeRoute([]));
      ED.state.routeIndex = A.maze.routes.length - 1;
      setStatus('ルート' + A.maze.routes.length + ' を作りました。「ルート」ツールで描いてください');
      afterEdit();
    });
    $('#btnDelRoute').addEventListener('click', function () {
      if (!A.maze.routes.length) return;
      ED.pushHistory();
      A.maze.routes.splice(ED.state.routeIndex, 1);
      ED.state.routeIndex = Math.max(0, ED.state.routeIndex - 1);
      afterEdit();
    });
    $('#btnRouteToSG').addEventListener('click', function () {
      const rt = A.maze.routes[ED.state.routeIndex];
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
    $('#btnScatter').addEventListener('click', scatter);
    $('#btnClearDummy').addEventListener('click', function () {
      ED.pushHistory();
      const before = A.maze.elements.length;
      A.maze.elements = A.maze.elements.filter(function (e) { return !e.isDummy; });
      setStatus('まぎれ文字を' + (before - A.maze.elements.length) + '文字 消しました（↶ でもどせます）');
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
    $('#btnTryToStep').addEventListener('click', targetsToSteps);

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

    /* ---- ねらった答えにする ---- */
    $('#btnAddTarget').addEventListener('click', function () {
      A.targets.push(newTarget());
      renderTargets();
    });
    $('#btnPlaceTargets').addEventListener('click', placeTargets);

    /* ---- チェック ---- */
    $('#btnRecheck').addEventListener('click', refresh);

    /* ---- STEP ---- */
    $('#btnAddStep').addEventListener('click', function () { addStep($('#stepType').value); });
    $('#btnViewMaze').addEventListener('click', function () { A.selStep = -1; refresh(); });

    // キーボード
    document.addEventListener('keydown', function (e) {
      if (!$('#helpModal').hidden) { if (e.key === 'Escape') closeHelp(); return; }
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
  function closeHelp() { $('#helpModal').hidden = true; }

  /**
   * 作ったものが入っているときだけ確認する。
   * 空の盤面でいちいち聞かれると邪魔なので、中身があるときだけ止める。
   */
  function askIfMade(what) {
    if (isEmptyWork()) return true;
    return window.confirm(what + '\nよろしいですか？（あとで ↶ でもどせます）');
  }
  function setStatus(msg) { if (msg !== undefined && msg !== null) $('#statusText').textContent = msg; }

  /**
   * 盤面を変えたあとの後始末。
   * 盤面は④、こまかいボタンは⑤にあるので、⑤のボタンを押したときは
   * 盤面が画面の外にいることがある。変わったところが見えないと直しようがないので、
   * 見えていないときだけ盤面まで戻す（見えているときは動かさない）。
   */
  function afterEdit() { A.selStep = -1; ED.clearDisplay(); refresh(); ED.draw(); revealBoard(); }

  /* =======================================================================
   * 画面の作り直し（変更があったら必ずここを通す）
   * ===================================================================== */
  function refresh() {
    A.results = ST.runSteps(A.maze, A.steps);
    A.checks = ST.validateAll(A.maze, A.steps, A.results);   // 走らせた結果を渡して二度打ちを避ける
    // 何も作っていないのに「解いてみる」を押すと、空の10×10が開いてしまう。
    // 「✏️ 迷路を直す」は「まっさらから自分で描く」入口でもあるので、ここでは止めない。
    const empty = isEmptyWork();
    ['#btnPlay', '#btnPrint', '#btnPng'].forEach(function (id) {
      const b = $(id);
      if (b) { b.disabled = empty; b.title = empty ? 'まず「✨ 自動で作る」を押してください' : ''; }
    });
    renderSteps();
    renderTargets();
    renderChecks();
    verifyTargets();
    updateRouteLen();
    updateRouteView();
    $('#btnUndo').disabled = !ED.canUndo();
    $('#btnRedo').disabled = !ED.canRedo();
    $('#btnUndoStep').disabled = !A.stepHistory.length;
    $('#answerText').textContent = ST.finalText(A.results) || '—';
    syncPngInst();
    // ④のタブ（問題／n段めの答え）は、編集で段が増減するたびに作り直す
    if (MZ.wizard && MZ.wizard.syncViews) MZ.wizard.syncViews();
    saveAuto();
  }

  /**
   * 指示文の欄（#inPngInst）を、自動作成の指示文と同期させる。
   * ユーザーが自分で書きかえたあとは、迷路そのものが変わるまで上書きしない
   * （書きかえるたびに自動生成の文へもどってしまうと編集にならないため）。
   */
  function syncPngInst() {
    const ta = $('#inPngInst');
    if (!ta) return;
    const inst = A.maze.meta.instruction || '';
    if (A.pngInstBase === null || A.pngInstBase !== inst) {
      A.pngInstBase = inst;
      ta.value = inst;
    }
  }

  /**
   * 指示文（問題用紙にのる文）は1つしか持たない。
   * 前は「印刷は maze.meta.instruction・画像は #inPngInst の中身」と2系統あったので、
   * 欄を書きかえても紙には反映されず、直す手段が事実上なかった。
   * 欄を直したらここで meta に書きもどし、印刷・画像・④の表示がぜんぶ同じ文を見る。
   */
  function applyInstEdit() {
    const ta = $('#inPngInst');
    if (!ta) return;
    A.maze.meta.instruction = ta.value;
    A.pngInstBase = ta.value;
    $('#workInst').textContent = ta.value || '（まだ決まっていません）';
    saveAuto();
  }

  /**
   * 見るだけの盤面（段ごとの答え）のあいだは、道具を押せないようにする。
   * 押せる見た目のままだと「動かせます」という案内も出ているのに何も起きず、
   * しかも出るメッセージが「設計図を選んでください」＝画面に無い名前を指していた。
   */
  function setToolsEnabled(on) {
    const box = $('#paneCanvas');
    if (!box) return;
    box.classList.toggle('readonly', !on);
    box.querySelectorAll('.toolbar button, .toolbar select, .sw').forEach(function (b) { b.disabled = !on; });
    document.querySelectorAll('.sel-strip button, .sel-strip input, .sel-strip .sw')
      .forEach(function (b) { b.disabled = !on; });
    // ズームだけは見るだけでも使えたほうがよい
    ['#btnZoomIn', '#btnZoomOut', '#btnFit'].forEach(function (id) { const e = $(id); if (e) e.disabled = false; });
  }

  /** 表示する盤面を決める（設計図か、選んだSTEPの結果か） */
  function updateRouteView() {
    const opts = ED.state.renderOpts;
    setToolsEnabled(A.selStep < 0);
    if (A.selStep >= 0) return;
    if ($('#ckShowSub').checked && A.maze.subBoard) {
      ED.setDisplay({ board: R.subBoardAsBoard(A.maze.subBoard), readOnly: true, opts: { showRoute: false } });
      $('#viewBadge').className = 'viewbadge show';
      $('#viewBadge').textContent = '文字盤を見ています（編集するにはチェックを外す）';
      return;
    }
    ED.clearDisplay();
    $('#viewBadge').className = 'viewbadge';
    if ($('#ckShowShortest').checked) {
      const s = E.solve(A.maze, { useAvoid: true });
      opts.routePath = s.ok ? s.path : null;
      opts.routePaths = null;
      opts.showRoute = s.ok;
      opts.routeColor = '#1c7ed6';        // 今の最短ルートは青で出す
      setStatus(s.ok ? '最短ルート：' + s.dist + 'マス' + (s.multiple ? '／同じ長さの道が' + (s.capped ? 'たくさん' : s.count) + '通りあります' : '／1本だけです') : s.reason);
    } else if ($('#ckShowRoute').checked && A.maze.routes.length) {
      opts.routeColor = undefined;        // 青にしたままだと、段の答えの道まで青くなる
      // 描いたルートは全部見せる。いま描いているものを濃く、ほかは薄く
      const active = ED.state.routeIndex;
      opts.routePaths = A.maze.routes.map(function (r, i) {
        return { path: r.cells, color: i === active ? '#f76707' : '#9aa5b1',
                 alpha: i === active ? 0.35 : 0.22, width: i === active ? 1 : 0.7 };
      });
      opts.routePath = null;
      opts.showRoute = true;
    } else {
      opts.routeColor = undefined;
      opts.routePath = null;
      opts.routePaths = null;
      opts.showRoute = false;
    }
    ED.draw();
  }

  function updateRouteLen() {
    // ルートの選択肢を組み直す
    const sel = $('#routePick');
    const idx = Math.min(ED.state.routeIndex, Math.max(0, A.maze.routes.length - 1));
    ED.state.routeIndex = idx;
    sel.textContent = '';
    if (!A.maze.routes.length) {
      const o = el('option', '', 'ルート1（まだ描いていません）'); o.value = '0'; sel.appendChild(o);
    } else {
      A.maze.routes.forEach(function (rt, i) {
        const o = el('option', '', 'ルート' + (i + 1) + '（' + rt.cells.length + 'マス）');
        o.value = String(i); sel.appendChild(o);
      });
    }
    sel.value = String(idx);
    $('#btnDelRoute').disabled = A.maze.routes.length < 1;

    const rt = A.maze.routes[idx];
    const n = rt ? rt.cells.length : 0;
    $('#routeLen').textContent = '「ルート' + (idx + 1) + '」の長さ：' + n + 'マス' + (n > 1 ? '（' + (n - 1) + '歩）' : '');
    const dl = $('#drawLen');
    if (dl) dl.textContent = n ? ('いま ' + n + 'マス') : 'まだ描いていません';
    const bh = $('#btnMakeMazeHere');
    if (bh) bh.disabled = n < 2;
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
   * B 正解ルートから迷路を作る
   * ===================================================================== */
  function makeMazeFromRoute() {
    const rt = A.maze.routes[ED.state.routeIndex];
    if (!rt || rt.cells.length < 2) { setStatus('先に「ルート」ツールで道を描いてください'); return; }
    const chk = G.checkRoute(A.maze, rt.cells);
    if (!chk.ok) { setStatus('⚠ ' + chk.reason); return; }
    ED.pushHistory();
    const res = G.fromRoute(A.maze, rt.cells, { branchiness: MZ.packages.LOOPS[MZ.opt.get('loops')] || 0 });
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

  /* -----------------------------------------------------------------------
   * ルートを遠回りにする
   *   次の段で「壁を消して近道を作る」余地を空けるための機能。
   *   置いてある文字の並び順と、いまのSTEPの答えは変えない。
   * --------------------------------------------------------------------- */
  function stepTexts() {
    return JSON.stringify(ST.runSteps(A.maze, A.steps).map(function (r) { return r.text || ''; }));
  }

  function lengthenRoute() {
    const sv = E.solve(A.maze, { useAvoid: true });
    if (!sv.ok) { setStatus('⚠ ' + sv.reason); return; }

    // 今のSTEPの答えと、チェックの結果を控えておく。
    // 答えが変わる案も、チェックが悪くなる案も採らない。
    const before = stepTexts();
    const beforeBad = ST.validateAll(A.maze, A.steps).filter(function (c) { return c.level !== 'ok'; }).length;
    const accept = function () {
      if (A.steps.length && stepTexts() !== before) return false;
      const bad = ST.validateAll(A.maze, A.steps).filter(function (c) { return c.level !== 'ok'; }).length;
      return bad <= beforeBad;
    };

    ED.pushHistory();
    setStatus('⏳ 遠回りにできる場所をさがしています…');
    const res = G.lengthenRoute(A.maze, sv.path, { accept: accept });
    if (!res.ok) {
      ED.undo();
      setStatus('⚠ ' + res.reason);
      return;
    }
    setStatus('✓ ルートを ' + res.gain + 'マス 遠回りにしました（文字の並びと答えはそのままです）');
    afterEdit();
  }

  /* =======================================================================
   * ③ 文字を置く / まぎれ文字をまく
   * ===================================================================== */
  function currentPath() {
    const rt = A.maze.routes[ED.state.routeIndex];
    if (rt && rt.cells.length > 1) return rt.cells;
    const s = E.solve(A.maze, { useAvoid: true });
    return s.ok ? s.path : null;
  }

  function scatter() {
    const path = currentPath() || [];
    ED.pushHistory();
    const poolKey = $('#inDummyPool').value;
    const res = O.scatterDummies(A.maze, path, {
      density: MZ.packages.DENSITY[MZ.opt.get('density')],
      colors: A.dummyColors.slice(),
      pool: poolKey === 'same' ? null : O.POOLS[poolKey]
    });
    setStatus('✓ ' + res.message + '（文字の量：' + DENSITY_LABEL[MZ.opt.get('density')] + '）');
    afterEdit();
  }
  const DENSITY_LABEL = { few: '少なめ', normal: 'ふつう', many: '多め' };

  /**
   * 「読み方とこたえ」に書いた行を、そのままSTEPの流れにする。
   * （前は「読み取りのお試し」という別の欄が同じことをしていたので、こちらに1本化した）
   */
  function targetsToSteps() {
    const rows = A.targets.filter(function (t) { return !!findSource(t.srcId); });
    if (!rows.length) { setStatus('⚠ 先に読む行を1つ足してください'); return; }
    pushStepHistory();
    A.steps = [];
    rows.forEach(function (t, i) {
      addStep('solve', {}, true);
      addStep('extract', { kinds: ['text', 'number'] }, true);
      if (t.color) addStep('filter-color', { mode: 'include', colors: [t.color] }, true);
      if (t.order && t.order !== 'route') addStep('reorder', { order: t.order, parity: 'all' }, true);
      if (i === rows.length - 1) addStep('answer', { expected: MZ.packages.letters(t.text).join('') }, true);
    });
    A.selStep = -1;
    refresh();
    setStatus('✓ ' + rows.length + '行ぶんの読み方をSTEPにしました（盤面を変えるSTEPは自分で足してください）');
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
        revealBoard();
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
  /* =======================================================================
   * ④「できたものを見る・直す」のタブ用
   *
   *   タブは「いま盤面のどこを見ているか」を切りかえるだけ。
   *   ・問題 …………… 手で直せる、ほんものの盤面
   *   ・n段めの答え … そのSTEPまで進めた盤面（見るだけ）
   *   前の版は結果をPNGの絵で見せていたので、絵と編集用の盤面が二重にあった。
   *   絵をやめて盤面ひとつにしたので、見ているものをそのまま直せる。
   * ===================================================================== */
  function stageInfo() {
    const out = [{ title: '問題', stepIndex: -1, log: '', read: '' }];
    let cur = null, stage = 0;
    A.results.forEach(function (r) {
      if (!r.step) return;
      if (r.step.type === 'solve') {
        stage++;
        cur = { title: stage + '段めの答え', stepIndex: r.index, log: r.log || '', read: '' };
        out.push(cur);
      } else if (cur && r.text) {
        cur.read = r.text;      // その段で読めた文字（色でしぼった あと・ならべかえた あと）
      }
    });
    return out;
  }
  /** 手で直せる盤面にもどす */
  function viewDesign() {
    A.selStep = -1;
    ED.clearDisplay();
    refresh();
    ED.fit();
  }
  /** 盤面（④）が画面の外にあるときだけ、そこまでスクロールする。
   *  STEPの一覧は⑤にあるので、押しても上の盤面が見えないと変化に気づけない。 */
  function revealBoard() {
    const box = $('#paneCanvas');
    if (!box) return;
    const r = box.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    if (r.bottom < 120 || r.top > vh - 120) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /** その段の答え（見るだけ）を出す */
  function viewStage(i) {
    A.selStep = i;
    refresh();
    showStepBoard(i);
  }

  function showStepBoard(i) {
    const res = A.results[i + 1];
    if (!res) return;
    ED.setDisplay({ board: res.board, path: res.path, cells: res.cells, readOnly: true });
    $('#viewBadge').className = 'viewbadge show';
    $('#viewBadge').textContent = stageTitleFor(i) + '（見るだけ）';
    setStatus('いまは答えを見ています。直すときは上の「問題」タブを押してください');
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
      // 自動作成が「この線だけ」と決めているときは、色を選ばせない。
      // 選べても run() が色を無視するので、見出しだけ変わって中身が変わらない
      if (f.hideIf && (st.params[f.hideIf] || []).length) return;
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

  /* =======================================================================
   * ねらった答えにする
   *   「このルートを、この色で読んだら、この言葉になる」を並べて、
   *   全部が同時に成り立つように文字を置き直す。
   * ===================================================================== */
  function newTarget() {
    const src = routeSources();
    const used = A.targets.length;
    return {
      srcId: (src[Math.min(used, src.length - 1)] || {}).id || '',
      color: MZ.packages.STAGE_COLORS[Math.min(used, MZ.packages.STAGE_COLORS.length - 1)],
      order: 'route',
      text: ''
    };
  }

  /** 読む対象にできるルートの一覧（描いたルート＋各STEPの通り道） */
  function routeSources() {
    const out = [];
    A.maze.routes.forEach(function (rt, i) {
      if (rt.cells.length > 1) out.push({ id: 'drawn' + i, label: '描いたルート' + (i + 1), path: rt.cells });
    });
    A.results.forEach(function (r) {
      if (!r.step || !r.path) return;
      if (r.step.type !== 'solve' && r.step.type !== 'route-drawn') return;
      // board も持たせておく（自動作成の多段の謎は、前の段の文字を消してから
      // 次の段を解くので、確かめるときも「そのSTEPの時点の盤面」を見る必要がある）
      out.push({ id: 'step' + r.index, label: 'STEP' + (r.index + 1) + '（' + r.title + '）', path: r.path, board: r.board });
    });
    if (!out.length) {
      const sv = E.solve(A.maze, { useAvoid: true });
      if (sv.ok) out.push({ id: 'now', label: 'いまの最短ルート', path: sv.path });
    }
    return out;
  }
  function findSource(id) {
    const list = routeSources();
    return list.filter(function (x) { return x.id === id; })[0] || list[0] || null;
  }

  function renderTargets() {
    const box = $('#targetRows');
    if (!box) return;
    const src = routeSources();
    if (!A.targets.length) A.targets.push(newTarget());
    box.textContent = '';
    if (!src.length) {
      box.appendChild(el('p', 'hint', 'まずSTARTとGOALを置いて、ルートが出る状態にしてください。'));
      return;
    }
    A.targets.forEach(function (t, i) {
      const node = el('div', 'tgt');
      const r1 = el('div', 'row');
      r1.appendChild(el('span', 'no', (i + 1) + '行め'));
      const se = document.createElement('select');
      se.style.flex = '1';
      src.forEach(function (x) {
        const o = el('option', '', x.label); o.value = x.id; se.appendChild(o);
      });
      if (!src.some(function (x) { return x.id === t.srcId; })) t.srcId = src[0].id;
      se.value = t.srcId;
      se.addEventListener('change', function () { t.srcId = se.value; verifyTargets(); });
      r1.appendChild(se);
      const del = el('button', 'del danger', '✕');
      del.addEventListener('click', function () { A.targets.splice(i, 1); renderTargets(); });
      r1.appendChild(del);
      node.appendChild(r1);

      const r2 = el('div', 'row');
      const cs = document.createElement('select');
      cs.style.flex = '1';
      const anyOpt = el('option', '', '全部の文字'); anyOpt.value = ''; cs.appendChild(anyOpt);
      M.COLOR_KEYS.forEach(function (k) {
        const o = el('option', '', M.COLORS[k].label + 'だけ'); o.value = k; cs.appendChild(o);
      });
      cs.value = t.color || '';
      cs.addEventListener('change', function () { t.color = cs.value; verifyTargets(); });
      r2.appendChild(cs);
      // 読む順（通った順のほかに うしろから・左→右 などが選べる）
      const os = document.createElement('select');
      os.style.flex = '1';
      const o0 = el('option', '', '通った順'); o0.value = 'route'; os.appendChild(o0);
      MZ.packages.ORDERS.forEach(function (o) {
        const x = el('option', '', o.label); x.value = o.key; os.appendChild(x);
      });
      os.value = t.order || 'route';
      os.addEventListener('change', function () { t.order = os.value; verifyTargets(); });
      r2.appendChild(os);
      node.appendChild(r2);

      const r3 = el('div', 'row');
      const ip = document.createElement('input');
      ip.type = 'text'; ip.style.flex = '1';
      ip.placeholder = 'この言葉になるように（空なら今の読みを見るだけ）';
      ip.value = t.text;
      ip.addEventListener('input', function () { t.text = ip.value; verifyTargets(); });
      r3.appendChild(ip);
      node.appendChild(r3);
      box.appendChild(node);
    });
  }

  function placeTargets() {
    const rows = [];
    for (let i = 0; i < A.targets.length; i++) {
      const t = A.targets[i];
      const sv = findSource(t.srcId);
      if (!sv) { setStatus('⚠ 読むルートが見つかりません'); return; }
      if (!MZ.packages.letters(t.text).length) { setStatus('⚠ ' + (i + 1) + '行めの言葉を入れてください'); return; }
      rows.push({ path: sv.path, color: t.color || null, order: t.order || 'route', text: t.text, label: sv.label });
    }
    if (!rows.length) return;
    ED.pushHistory();
    const res = MZ.packages.placeTargets(A.maze, rows, { fill: $('#ckTargetFill').checked, density: MZ.opt.get('density') });
    if (!res.ok) { setStatus('⚠ ' + res.reason); ED.undo(); afterEdit(); return; }
    // 置き直した結果が「最終こたえ」と食いちがうと ✕ が出てしまうので、
    // 指定した言葉のどれかになっていれば、想定こたえのほうを合わせておく
    const results = ST.runSteps(A.maze, A.steps);
    const got = ST.finalText(results);
    const wanted = rows.map(function (r) { return MZ.packages.letters(r.text).join(''); });
    const last = A.steps[A.steps.length - 1];
    let synced = '';
    if (last && last.type === 'answer' && got && wanted.indexOf(got) >= 0 && last.params.expected !== got) {
      pushStepHistory();
      last.params.expected = got;
      synced = '（最終こたえも「' + got + '」に合わせました）';
    }
    setStatus('✓ ' + rows.length + '行ぶんを、全部が成り立つように置きました' + synced + (res.note || ''));
    afterEdit();
    verifyTargets();
  }

  /**
   * いま何が読めるかを見せる。答えを書いてある行は ✓／✕ も出す。
   * 読み方の計算は packages.readRow に1本化してある（置くときと同じ関数を使う）。
   */
  function verifyTargets() {
    const box = $('#targetResult');
    if (!box) return;
    box.textContent = '';
    let allOk = true, checked = 0;
    A.targets.forEach(function (t, i) {
      const sv = findSource(t.srcId);
      if (!sv) return;
      // STEP由来の行は、そのSTEPの時点の盤面（前の段の文字が消えたあとの状態）で確かめる。
      // 自動作成の多段の謎（同じ色で読み直す段がある）は、生のA.mazeのままだと
      // まだ消えていない前の段の文字まで拾ってしまう。
      const got = MZ.packages.readRow(sv.board || A.maze, { path: sv.path, color: t.color || null, order: t.order || 'route' });
      const want = MZ.packages.letters(t.text).join('');
      if (!want) {
        box.appendChild(el('div', 'hint', (i + 1) + '行め：いま読めるのは「' + got + '」'));
        return;
      }
      checked++;
      const ok = (got === want);
      if (!ok) allOk = false;
      box.appendChild(el('div', ok ? 'tgt-ok' : 'tgt-ng',
        (ok ? '✓ ' : '✕ ') + (i + 1) + '行め：「' + got + '」' + (ok ? '' : '（ねらいは「' + want + '」）')));
    });
    if (allOk && checked) box.appendChild(el('div', 'hint', 'すべてねらいどおりです。'));
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
  /**
   * 印刷やプレイヤー画面の見出しを、画面のタブと同じ言い方にする。
   * 「STEP4 のあと」は作る側の言葉で、生徒に配る紙に出す言葉ではない。
   */
  function stageTitleFor(stepIndex) {
    const views = stageInfo();
    for (let i = 1; i < views.length; i++) {
      if (views[i].stepIndex === stepIndex) return views[i].title;
    }
    // solve 以外のSTEPの途中経過（ふつうは同じ画面にまとめられるので出ない）
    return 'とちゅうの盤面';
  }

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
        title: r.index < 0 ? '問題' : stageTitleFor(r.index),
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

  /** 画像として書き出すときの盤面と設定（ダウンロード・写真に保存、両方で使う） */
  function pngBoardAndOpts() {
    const board = ED.shownBoard();
    const o = printOpts(true);
    o.routePath = (A.selStep >= 0 && A.results[A.selStep + 1]) ? A.results[A.selStep + 1].path
      : (ED.state.renderOpts.routePath || null);
    o.showRoute = $('#ckPrintAnswer').checked && !!o.routePath;
    o.title = A.maze.meta.title || '';
    const ckInst = $('#ckPngInst');
    o.inst = (!ckInst || ckInst.checked) ? (A.maze.meta.instruction || '') : '';
    return { board: board, o: o };
  }

  function doPng() {
    const bo = pngBoardAndOpts();
    const url = R.toDataURL(bo.board, bo.o);
    const a = document.createElement('a');
    a.href = url;
    a.download = (A.maze.meta.title || 'meiro-nazo') + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus('画像を保存しました（' + a.download + '）');
  }

  /**
   * スマホでは「ダウンロード」だとファイルアプリの奥に入ってしまい、写真アプリから
   * 見つけにくいことがある。Web Share API（ファイル共有に対応した端末）が使えるときは
   * 「写真に保存」ボタンを出し、共有シートの「画像を保存」から写真フォルダへ直接置けるようにする。
   * 対応していない端末・PCでは、ボタンごと出さない（ダウンロードのみでよい）。
   */
  function canShareFiles() {
    if (!navigator.share || !navigator.canShare) return false;
    try {
      const probe = new File([new Blob(['x'])], 'x.png', { type: 'image/png' });
      return navigator.canShare({ files: [probe] });
    } catch (e) { return false; }
  }
  function doPngShare() {
    const bo = pngBoardAndOpts();
    R.toCanvas(bo.board, bo.o).toBlob(function (blob) {
      if (!blob) { setStatus('⚠ 画像を作れませんでした'); return; }
      const name = (A.maze.meta.title || 'meiro-nazo') + '.png';
      const file = new File([blob], name, { type: 'image/png' });
      navigator.share({ files: [file], title: A.maze.meta.title || '迷路謎' })
        .then(function () { setStatus('写真アプリなどに共有しました'); })
        .catch(function () { /* 共有シートを閉じただけの場合もあるので、エラーにはしない */ });
    }, 'image/png');
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
  /** まだ何も作っていない（空の初期盤面）か */
  function isEmptyWork() {
    return !A.steps.length && !A.maze.elements.length && !A.maze.routes.some(function (r) { return r.cells.length; });
  }

  function saveAuto() {
    // 起動直後の空の盤面まで保存すると、2回目に開いたとき
    // 何も作っていないのに「4 できたものを見る・直す」と⑤が開いてしまう
    if (isEmptyWork()) return;
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
    A.targets = [];
    ED.clearDisplay();
    // ★DOMに直接入れてはいけない★
    //   MZ.opt.bind は change イベントしか見ないので、値を直接入れても
    //   MZ.opt の中の値は古いまま＝②の欄も目安表示も古いままになる。
    //   その状態で⑤の「変える」を押すと、開いた作品が古い大きさに切り縮められていた。
    MZ.opt.set('rows', A.maze.rows);
    MZ.opt.set('cols', A.maze.cols);
    if (A.maze.subBoard) {
      $('#inSubRows').value = A.maze.subBoard.rows;
      $('#inSubCols').value = A.maze.subBoard.cols;
      $('#inSubText').value = A.maze.subBoard.cells.map(function (row) {
        return row.map(function (c) { return c.value || ' '; }).join('');
      }).join('\n');
    }
    // 盤面が入ったのだから、④「できたものを見る・直す」も出す
    // （前回のつづき・保存した作品・ファイル読みこみ、どの入口でも同じにする）
    showWork();
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
