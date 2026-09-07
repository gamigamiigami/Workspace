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
          setNote('');
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
    setNote('');
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

  /**
   * 「作れませんでした」などの案内を出す。
   * 直し方を番号つきで出すので、太字や改行を使えるように innerHTML で入れる。
   * 中に入る使う人の文章は packages.esc() で無害化してある。
   */
  function setNote(msg, kind) {
    const box = $('#wizNote');
    box.textContent = '';
    if (!msg) return;
    const n = el('div', 'wiz-note' + (kind === 'info' ? ' info' : ''));
    n.innerHTML = (kind === 'info' ? 'ℹ️ ' : '⚠ ') + msg;
    box.appendChild(n);
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
      ip.addEventListener('input', function () {
        W.texts[key] = ip.value; W.edited[key] = true;
        updateCapacity();
      });
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

    updateCapacity();
  }

  /**
   * 「いまの迷路の大きさに、あと何文字入るか」をその場で出す。
   * 作ってから「文章が長すぎます」と断られるより、
   * 打っている最中に分かるほうが直しやすい。
   */
  function updateCapacity() {
    const box = $('#capNote');
    if (!box) return;
    const cap = P.capacity(recipe());
    const o = MZ.opt.all();
    box.className = 'cap-note' + (cap.over ? ' over' : '');
    if (cap.over) {
      box.textContent = '⚠ 文章が長すぎます：合計 ' + cap.total + ' 文字／この迷路（' +
        o.rows + '×' + o.cols + '）に入るのは ' + cap.limit + ' 文字まで。' +
        (cap.total - cap.limit) + ' 文字みじかくするか、迷路を ' + cap.suggest + '×' + cap.suggest + ' 以上にしてください。';
    } else {
      box.textContent = '文章は合計 ' + cap.total + ' 文字。この迷路（' + o.rows + '×' + o.cols +
        '）には ' + cap.limit + ' 文字まで入ります（あと ' + (cap.limit - cap.total) + ' 文字）。';
    }
  }

  function recipe() {
    const o = MZ.opt.all();      // 大きさ・文字の量・わき道は ⑤ の A と同じ設定を見ている
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
    btn.disabled = true;
    btn.textContent = '⏳ 作っています…';
    setNote('');
    setTimeout(function () {
      let out;
      try { out = P.build(recipe()); }
      catch (e) { out = { ok: false, reason: 'エラーが起きました：' + (e && e.message ? e.message : e) }; }
      btn.disabled = false;
      btn.textContent = '✨ 自動で作る';
      if (!out || !out.ok) { setNote((out && out.reason) || '作れませんでした'); return; }
      // 迷路の大きさを自動で広げたときは黙っていない。
      // ②の欄も「あと何文字入るか」の目安も、この新しい大きさに変わるので、
      // 何も言わないと「勝手に数字が変わった」ように見える。
      setNote(out.grownTo
        ? '文章が入りきらなかったので、迷路を <b>' + out.grownTo + '</b> にして作りました。' +
          '（②の「もっと細かく決める」の大きさも、この値に変わっています）'
        : '', 'info');
      W.built = out;
      // 盤面は app（編集する側）が持つ。ここでは渡すだけ。
      // applyBuilt → refresh → syncViews の順で、④のタブと盤面がそろう。
      MZ.app.applyBuilt(out.maze, out.steps, out.grownTo);
      W.view = 0;
      showResult();
    }, 30);
  }

  /* =======================================================================
   * ④ できたものを見る・直す
   *
   *   ここに出る盤面は「結果の絵」ではなく、編集そのものの盤面（canvas）。
   *   前の版は結果をPNGで見せていたので、直すには下の編集エリアにある
   *   別の盤面まで行く必要があった（伊神さんの指摘：
   *   「ページの統合とはそういうことではない」）。
   *   絵をやめて盤面をひとつにしたので、見ているものをそのまま直せる。
   * ===================================================================== */

  /**
   * タブ・問題文・こたえを作り直す。app.js の refresh() から毎回呼ばれるので、
   * 盤面を手で直すたびに、段の数もこたえもその場で追いかけて変わる。
   */
  function syncViews() {
    const host = $('#ansTabs');
    if (!host || !MZ.app.stageInfo) return;
    W.views = MZ.app.stageInfo();
    const sum = MZ.app.summary();
    // いま見えている盤面から、光らせるタブを決める。
    // ⑤のSTEP一覧から別のSTEPを選んだときは、どのタブにも当てはまらないので光らせない。
    W.view = -1;
    W.views.forEach(function (v, i) { if (v.stepIndex === sum.selStep) W.view = i; });
    host.textContent = '';
    W.views.forEach(function (v, i) {
      const b = el('button', i === W.view ? 'on' : '', v.title);
      b.addEventListener('click', function () { setView(i); });
      host.appendChild(b);
    });
    $('#workInst').textContent = sum.instruction || '（まだ決まっていません）';
    const ans = $('#ansAnswer');
    ans.textContent = '';
    ans.appendChild(el('span', '', 'こたえ：'));
    ans.appendChild(el('b', '', sum.answer || '—'));
    renderNote();
  }

  /** 盤面の下のボタン（作り直す・印刷・保存…）。中身は変わらないので1回だけ作る */
  function buildActions() {
    const acts = $('#ansActions');
    acts.textContent = '';
    // ★並び順に意味がある★
    //   「もう一度作る」は手で直したところを全部すてる。前は「印刷する」のとなりに
    //   あったので、刷ろうとした指が当たると作ったものが消えていた。
    //   よく使うものを左に、すてるものはいちばん右に置き、赤くして確認も出す。
    acts.appendChild(mk('🖨 印刷する', function () { MZ.app.doPrint(); }, 'primary'));
    acts.appendChild(mk('🖼 画像で保存', function () { MZ.app.doPng(); }));
    if (MZ.app.canShareFiles()) acts.appendChild(mk('📱 写真に保存', function () { MZ.app.doPngShare(); }));
    acts.appendChild(mk('⚙️ もっと細かく直す', function () { MZ.app.showEditor(); }));
    acts.appendChild(mk('🔁 作り直す', regenerate, 'danger'));
  }

  /** 手で直したものがあるときだけ確認してから作り直す */
  function regenerate() {
    if (MZ.app.hasHandEdits() &&
        !window.confirm('手で直したところは消えて、新しい迷路になります。\nよろしいですか？')) return;
    generate();
  }

  /** 見る段を切りかえる（盤面そのものを切りかえる） */
  function setView(i) {
    W.view = i;
    const v = W.views[i];
    if (!v || v.stepIndex < 0) MZ.app.viewDesign();
    else MZ.app.viewStage(v.stepIndex);
    // viewDesign / viewStage は refresh を通るので syncViews が走り、タブの色も直る
  }

  /** 盤面の下に出す説明（通り道の長さ・その段で読める文字） */
  function renderNote() {
    const v = W.views[W.view];
    const note = $('#ansNote');
    if (!note) return;
    note.textContent = '';
    if (!v) { note.appendChild(el('div', '', '⑤のSTEPを1つ選んで見ています。上のタブを押すと、問題や段ごとの答えにもどれます。')); return; }
    if (v.stepIndex < 0) {
      // 「問題」を見ているときは、盤面の下のステータスバーが案内になっているので何も出さない
      //（同じことを二重に書くと、そのぶん盤面の高さが取れなくなる）
    } else {
      if (v.log) note.appendChild(el('div', '', '通り道：' + v.log));
      if (v.read) note.appendChild(el('div', '', 'ここで読める文字：「' + v.read + '」'));
    }
  }

  function showResult() {
    setView(0);
    $('#wizStep4').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function mk(label, fn, cls) {
    const b = el('button', cls || '', label);
    b.addEventListener('click', fn);
    return b;
  }

  /* =======================================================================
   * 立ち上げ
   * ===================================================================== */
  function init() {
    // 大きさ・文字の量・わき道は ⑤ の A とまったく同じ設定を見る（START/GOALはここだけ）
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
    MZ.opt.watch(function (k) {
      if (k === 'rows' || k === 'cols') updateCapacity();
    });
    buildCards();
    buildInputs();
    buildActions();
    $('#btnGenerate').addEventListener('click', generate);
    $('#btnToEditor').addEventListener('click', function () { MZ.app.showBoard(); });
    $('#btnWizHelp').addEventListener('click', function () { $('#helpModal').hidden = false; });
    $('#btnDrawSelf').addEventListener('click', function () {
      MZ.app.showBoard();
      MZ.app.setTool('route');
      MZ.app.setStatus('STARTからGOALまで、正解にしたい道を指でなぞってください');
    });
    MZ.wizard = { generate: generate, add: addPart, remove: removePart,
                  syncViews: syncViews, state: W };
    // app.js のほうが先に動くので、前回のつづきを開いていた場合は
    // ここで1回だけタブと問題文を作る（以後は refresh() から呼ばれる）
    if (!$('#wizStep4').hidden) syncViews();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
