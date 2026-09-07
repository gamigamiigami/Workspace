/* ===========================================================================
 * wizard.js — かんたん作成画面（最初に出る画面）
 *
 *   ① どんなしかけを入れるか えらぶ（いくつでも組み合わせられる）
 *   ② 段ごとの文章を入れる
 *   ③ 「自動で作る」を押す → 問題と答えが出る → 印刷
 *
 * 「STARTからGOALまで最短ルートを通る」は、どの謎にも必ず入る土台なので
 * 選択肢には出さない。
 * ======================================================================== */
(function () {
  'use strict';
  const P = MZ.packages, R = MZ.render, ST = MZ.steps, M = MZ.model, E = MZ.engine;

  const $ = function (s) { return document.querySelector(s); };
  const el = function (tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // texts …… いま欄に入っている文字
  // edited … 使う人が自分で書きかえた欄。書きかえていない欄は、
  //          しかけを変えるたびに「その組み合わせにふさわしい例文」に入れかえる
  // opts … カードに「選ぶところ」がある しかけ の設定（今は「読む順番」だけ）
  const W = { parts: [], texts: {}, edited: {}, opts: {}, built: null, view: 0, views: [] };

  /* =======================================================================
   * ① しかけをカードでえらぶ（複数選択）
   * ===================================================================== */
  function buildCards() {
    const grid = $('#packGrid');
    grid.textContent = '';
    P.PARTS.forEach(function (def) {
      const wrap = el('div', 'pack-wrap');
      const b = el('button', 'pack');
      b.dataset.id = def.id;
      b.appendChild(el('div', 'em', def.emoji));
      b.appendChild(el('div', 'nm', def.name));
      b.appendChild(el('div', 'sm', def.summary));
      b.appendChild(el('span', 'lv', def.level));
      b.addEventListener('click', function () { addPart(def.id); });
      wrap.appendChild(b);
      // 個数のバッジ（同じしかけを何回でも重ねられる）
      const badge = el('div', 'pack-count');
      badge.dataset.for = def.id;
      const minus = el('button', 'cnt-btn', '−');
      minus.title = '1つ減らす';
      minus.addEventListener('click', function (e) { e.stopPropagation(); removePart(def.id); });
      const num = el('span', 'cnt-num', '');
      badge.appendChild(minus);
      badge.appendChild(num);
      wrap.appendChild(badge);
      // 「読む順番」のように、選んだあとで中身を決める しかけ
      if (def.option) {
        const opt = el('div', 'pack-opt');
        opt.dataset.for = def.id;
        opt.appendChild(el('span', '', def.option.label + '：'));
        const se = document.createElement('select');
        def.option.list.forEach(function (o) {
          const x = el('option', '', o.label); x.value = o.key; se.appendChild(x);
        });
        W.opts[def.option.key] = W.opts[def.option.key] || def.option.def;
        se.value = W.opts[def.option.key];
        se.addEventListener('click', function (e) { e.stopPropagation(); });
        se.addEventListener('change', function () {
          W.opts[def.option.key] = se.value;
          buildInputs();
          $('#wizResult').textContent = '';
        });
        opt.appendChild(se);
        wrap.appendChild(opt);
      }
      grid.appendChild(wrap);
    });
    updateCards();
  }

  /** しかけを1つ足す（同じものを何回でも足せる） */
  function addPart(id) {
    if (!P.canAdd(W.parts, id)) { setNote(P.whyNot(W.parts, id)); return; }
    W.parts.push(id);
    afterPartChange();
  }
  /** しかけを1つ減らす（同じものが複数あれば最後の1つ） */
  function removePart(id) {
    const at = W.parts.lastIndexOf(id);
    if (at < 0) return;
    W.parts.splice(at, 1);
    afterPartChange();
  }
  function afterPartChange() {
    updateCards();
    buildInputs();
    $('#wizResult').textContent = '';
  }

  function updateCards() {
    const n = P.stageCount(W.parts);
    const colorForced = n > 1;
    // 段が2つ以上あると、選ばなくても「色でしぼって読む」が自動でONになる。
    // ただし「色いがいを読む」を選んでいるときは、そちらが効いているので出さない。
    const hasRead = W.parts.some(function (id) { const d = P.part(id); return d && d.kind === 'read'; });
    document.querySelectorAll('.pack').forEach(function (b) {
      const id = b.dataset.id;
      const cnt = P.countOf(W.parts, id);
      const auto = (id === 'read-color' && colorForced && !hasRead);
      b.classList.toggle('on', cnt > 0 || auto);
      b.classList.toggle('auto', auto);
      b.classList.toggle('full', cnt === 0 ? false : !P.canAdd(W.parts, id));
      b.classList.toggle('off', cnt === 0 && !auto && !P.canAdd(W.parts, id));
    });
    document.querySelectorAll('.pack-count').forEach(function (badge) {
      const cnt = P.countOf(W.parts, badge.dataset.for);
      badge.classList.toggle('show', cnt > 0);
      badge.querySelector('.cnt-num').textContent = '×' + cnt;
    });
    document.querySelectorAll('.pack-opt').forEach(function (o) {
      o.classList.toggle('show', P.countOf(W.parts, o.dataset.for) > 0);
    });
    const info = $('#stageInfo');
    if (n === 1 && !W.parts.length) {
      info.textContent = 'しかけを選ばないと「最短ルートを通って、通ったマスの文字を読む」だけの1段の謎になります。カードは何回でも押せます。';
    } else {
      const kinds = P.stageParts(W.parts);
      const how = kinds.map(function (k) {
        return { 'erase-wall': '線を消す', 'move-start': 'STARTが変わる', 'move-goal': 'GOALが変わる',
                 'move-both': 'STARTもGOALも変わる', 'next-read': '読み方を変えて読み直す' }[k] || k;
      });
      // 既定では「読み方を変えて読み直す」で次の色へ、「線を消す/START・GOALが変わる」で赤にもどる
      // （直前がすでに赤なら次の色）。②の欄でこの段だけ個別に色を変えることもできる。
      const sc = P.stageColors(W.parts, W.opts);
      const colorWords = sc.map(function (c) { return M.COLORS[c].label; });
      info.textContent = n + '段の謎になります' + (how.length ? '（' + how.join(' → ') + '）' : '') + '。' +
        (colorForced ? '文字の色は ' + colorWords.join(' → ') + ' の順です（②の欄で段ごとに変えられます）。' : '');
    }
    $('#btnGenerate').disabled = false;
  }

  function setNote(msg) {
    const box = $('#wizResult');
    box.textContent = '';
    box.appendChild(el('div', 'wiz-note', '⚠ ' + msg));
  }

  /* =======================================================================
   * ② 段ごとの文章
   * ===================================================================== */
  function buildInputs() {
    const box = $('#packInputs');
    const n = P.stageCount(W.parts);
    const color = P.usesColor(W.parts);
    const hasOrder = P.countOf(W.parts, 'read-order') > 0;
    box.textContent = '';

    const mode = P.readMode(W.parts);
    for (let i = 0; i < n; i++) {
      const key = 's' + (i + 1);
      const isLast = (i === n - 1);
      const cname = M.COLORS[P.answerColor(mode, i, W.parts, W.opts)].label;
      const label = (n > 1 ? (i + 1) + '段め' : '') +
        (isLast ? (n > 1 ? 'のこたえ' : 'こたえになる文章') : 'に読ませる指示') +
        '（' + cname + 'で置きます）';
      const wrap = el('div', 'wiz-field');
      wrap.appendChild(el('label', '', label));
      const ip = document.createElement('input');
      ip.type = 'text';
      ip.id = 'wizin_' + key;
      const def = P.defaultText(W.parts, i, W.opts);
      ip.value = W.edited[key] ? (W.texts[key] || def) : def;
      W.texts[key] = ip.value;
      ip.addEventListener('input', function () { W.texts[key] = ip.value; W.edited[key] = true; });
      wrap.appendChild(ip);

      // この段だけの細かい調整（色・読む順）。基本は自動でよいので、
      // 「変えたいときだけ」触ればいい小さいセレクトにしている。
      if (color || hasOrder) {
        const tune = el('div', 'wiz-tune');
        if (color) {
          tune.appendChild(el('span', '', '色：'));
          const cs = document.createElement('select');
          P.STAGE_COLORS.forEach(function (c) {
            const o = el('option', '', M.COLORS[c].label); o.value = c; cs.appendChild(o);
          });
          cs.value = P.answerColor(mode, i, W.parts, W.opts);
          cs.addEventListener('change', function () {
            W.opts.stageColor = W.opts.stageColor || {};
            W.opts.stageColor[i] = cs.value;
            afterPartChange();
          });
          tune.appendChild(cs);
        }
        if (hasOrder) {
          tune.appendChild(el('span', '', ' 読む順：'));
          const os = document.createElement('select');
          const defOpt = el('option', '', 'カードの設定のまま'); defOpt.value = ''; os.appendChild(defOpt);
          P.ORDERS.forEach(function (o) {
            const x = el('option', '', o.label); x.value = o.key; os.appendChild(x);
          });
          os.value = (W.opts.stageOrder && W.opts.stageOrder[i]) || '';
          os.addEventListener('change', function () {
            W.opts.stageOrder = W.opts.stageOrder || {};
            if (os.value) W.opts.stageOrder[i] = os.value; else delete W.opts.stageOrder[i];
            afterPartChange();
          });
          tune.appendChild(os);
        }
        wrap.appendChild(tune);
      }

      if (!isLast) wrap.appendChild(el('div', 'ex', 'ここに書いた指示のとおりにすると、次の段に進めます'));
      box.appendChild(wrap);
    }

    const note = el('div', 'wiz-inst');
    note.appendChild(el('b', '', '解く人がやること：'));
    note.appendChild(el('div', '', P.instruction(W.parts, W.opts)));
    box.appendChild(note);
  }

  function recipe() {
    const o = MZ.opt.all();      // 大きさ・文字の量・わき道は編集画面と同じ設定を見ている
    return {
      parts: W.parts.slice(),
      texts: Object.assign({}, W.texts),
      opts: Object.assign({}, W.opts),
      rows: o.rows, cols: o.cols,
      density: o.density,
      sg: o.sg,
      loops: o.loops
    };
  }

  /* =======================================================================
   * ③ 作る
   * ===================================================================== */
  function generate() {
    const btn = $('#btnGenerate');
    const box = $('#wizResult');
    btn.disabled = true;
    btn.textContent = '⏳ 作っています…';
    box.textContent = '';
    setTimeout(function () {
      let out;
      try { out = P.build(recipe()); }
      catch (e) { out = { ok: false, reason: 'エラーが起きました：' + (e && e.message ? e.message : e) }; }
      btn.disabled = false;
      btn.textContent = '✨ 自動で作る';
      if (!out || !out.ok) { setNote((out && out.reason) || '作れませんでした'); return; }
      W.built = out;
      MZ.app.applyBuilt(out.maze, out.steps);
      showResult(out);
    }, 30);
  }

  /** 段ごとの「盤面＋通り道」を並べる。1つの迷路で切りかえて見せるため */
  function buildViews(out) {
    const results = ST.runSteps(out.maze, out.steps);
    const views = [{ title: '問題', board: results[0].board, path: null, note: out.maze.meta.instruction || '' }];
    let stage = 0;
    results.forEach(function (r) {
      if (!r.step || r.step.type !== 'solve') return;
      stage++;
      const notes = [];
      if (r.log) notes.push(r.log);
      views.push({ title: stage + '段めの答え', board: r.board, path: r.path, note: '' , stage: stage, log: r.log });
    });
    // その段で読めた文字を、あとから拾ってメモに足す
    let idx = 0;
    results.forEach(function (r) {
      if (!r.step) return;
      if (r.step.type === 'solve') idx++;
      if (r.step.type === 'filter-color' || (r.step.type === 'extract' && !P.usesColor(W.parts))) {
        if (views[idx]) views[idx].read = r.text;
      }
    });
    return views;
  }

  function showResult(out) {
    const box = $('#wizResult');
    box.textContent = '';
    W.views = buildViews(out);
    W.view = 0;

    const tabs = el('div', 'ans-tabs');
    W.views.forEach(function (v, i) {
      const b = el('button', '', v.title);
      b.addEventListener('click', function () { W.view = i; renderView(); });
      tabs.appendChild(b);
    });
    box.appendChild(tabs);

    const view = el('div', 'ans-view');
    view.id = 'ansView';
    box.appendChild(view);

    const ans = el('div', 'wiz-answer');
    ans.appendChild(el('span', '', 'こたえ：'));
    ans.appendChild(el('b', '', out.answer));
    box.appendChild(ans);

    const inst = el('div', 'wiz-inst');
    inst.appendChild(el('b', '', '問題用紙にのる文：'));
    inst.appendChild(el('div', '', out.maze.meta.instruction || ''));
    box.appendChild(inst);

    const acts = el('div', 'wiz-actions');
    acts.appendChild(mk('🔁 もう一度作る', generate));
    acts.appendChild(mk('🖨 印刷する', function () { MZ.app.doPrint(); }, 'primary'));
    acts.appendChild(mk('🖼 画像で保存', function () { MZ.app.doPng(); }));
    if (MZ.app.canShareFiles()) acts.appendChild(mk('📱 写真に保存', function () { MZ.app.doPngShare(); }));
    acts.appendChild(mk('✏️ 下で細かく直す', function () { MZ.app.showEditor(); }));
    box.appendChild(acts);

    renderView();
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderView() {
    const v = W.views[W.view];
    const host = $('#ansView');
    if (!v || !host) return;
    document.querySelectorAll('.ans-tabs button').forEach(function (b, i) {
      b.classList.toggle('on', i === W.view);
    });
    host.textContent = '';
    const img = document.createElement('img');
    img.src = R.toDataURL(v.board, {
      cellPx: 38, showRoles: false, showGhost: false, showGrid: true, exportScale: 2,
      showRoute: !!v.path, routePath: v.path
    });
    img.alt = v.title;
    host.appendChild(img);
    const note = el('div', 'ans-note');
    if (v.path) {
      note.appendChild(el('div', '', '通り道：' + (v.log || '')));
      if (v.read) note.appendChild(el('div', '', 'ここで読める文字：「' + v.read + '」'));
    } else {
      note.appendChild(el('div', '', v.note));
    }
    host.appendChild(note);
  }

  function mk(label, fn, cls) {
    const b = el('button', cls || '', label);
    b.addEventListener('click', fn);
    return b;
  }

  /* =======================================================================
   * 画面の出し入れ
   * ===================================================================== */
  // かんたん作成と編集エリアは同じ1ページに縦に並んでいるので、
  // 「見せる／隠す」ではなく「そこまでスクロールする」だけでよい。
  function show() { MZ.opt.paintAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function hide() { $('#app').classList.add('show'); }

  function init() {
    // 大きさ・文字の量・わき道・START/GOAL は編集画面①とまったく同じ設定を見る
    MZ.opt.bind('#wizRows', 'rows');
    MZ.opt.bind('#wizCols', 'cols');
    MZ.opt.bind('#wizDensity', 'density');
    MZ.opt.bind('#wizLoops', 'loops');
    MZ.opt.bind('#wizSG', 'sg');
    document.querySelectorAll('.sizebtn').forEach(function (b) {
      b.addEventListener('click', function () {
        MZ.opt.set('rows', b.dataset.size);
        MZ.opt.set('cols', b.dataset.size);
      });
    });
    buildCards();
    buildInputs();
    $('#btnGenerate').addEventListener('click', generate);
    $('#btnToEditor').addEventListener('click', function () { MZ.app.showEditor(); });
    $('#btnWizHelp').addEventListener('click', function () { $('#helpModal').hidden = false; });
    $('#btnDrawSelf').addEventListener('click', function () {
      MZ.app.showEditor();
      MZ.app.setTool('route');
      MZ.app.setStatus('「ルート」で正解にしたい道をなぞってから、右の「このルートが最短になる迷路を作る」を押してください');
    });
    MZ.wizard = { show: show, hide: hide, generate: generate, add: addPart, remove: removePart, state: W };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
