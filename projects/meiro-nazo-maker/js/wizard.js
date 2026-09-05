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
  const W = { parts: [], texts: {}, edited: {}, built: null, view: 0, views: [] };

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
      grid.appendChild(wrap);
    });
    updateCards();
  }

  /** しかけを1つ足す（同じものを何回でも足せる） */
  function addPart(id) {
    if (!P.canAdd(W.parts, id)) {
      const def = P.part(id);
      setNote(def.kind === 'solve'
        ? 'この しかけ は1回だけ選べます'
        : '段は' + P.MAX_STAGES + 'つまでです。ほかの しかけ を減らしてから選んでください');
      return;
    }
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
    document.querySelectorAll('.pack').forEach(function (b) {
      const id = b.dataset.id;
      const cnt = P.countOf(W.parts, id);
      b.classList.toggle('on', cnt > 0 || (id === 'read-color' && colorForced));
      b.classList.toggle('auto', id === 'read-color' && colorForced && cnt === 0);
      b.classList.toggle('full', cnt > 0 && !P.canAdd(W.parts, id));
    });
    document.querySelectorAll('.pack-count').forEach(function (badge) {
      const cnt = P.countOf(W.parts, badge.dataset.for);
      badge.classList.toggle('show', cnt > 0);
      badge.querySelector('.cnt-num').textContent = '×' + cnt;
    });
    const info = $('#stageInfo');
    if (n === 1 && !W.parts.length) {
      info.textContent = 'しかけを選ばないと「最短ルートを通って、通ったマスの文字を読む」だけの1段の謎になります。カードは何回でも押せます。';
    } else {
      const kinds = P.stageParts(W.parts);
      const how = kinds.map(function (k) {
        return { 'erase-wall': '線を消す', 'move-start': 'STARTが変わる', 'move-goal': 'GOALが変わる',
                 'move-both': 'STARTもGOALも変わる', 'next-color': '色を変えて読み直す' }[k] || k;
      });
      info.textContent = n + '段の謎になります' + (how.length ? '（' + how.join(' → ') + '）' : '') + '。' +
        (colorForced ? '段ごとに 赤 → 青 → 緑 → 紫 と文字の色が変わります。' : '');
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
    box.textContent = '';

    for (let i = 0; i < n; i++) {
      const key = 's' + (i + 1);
      const isLast = (i === n - 1);
      const cname = color ? M.COLORS[P.STAGE_COLORS[i]].label : '黒';
      const label = (n > 1 ? (i + 1) + '段め' : '') +
        (isLast ? (n > 1 ? 'のこたえ' : 'こたえになる文章') : 'に読ませる指示') +
        '（' + cname + 'で置きます）';
      const wrap = el('div', 'wiz-field');
      wrap.appendChild(el('label', '', label));
      const ip = document.createElement('input');
      ip.type = 'text';
      ip.id = 'wizin_' + key;
      const def = P.defaultText(W.parts, i);
      ip.value = W.edited[key] ? (W.texts[key] || def) : def;
      W.texts[key] = ip.value;
      ip.addEventListener('input', function () { W.texts[key] = ip.value; W.edited[key] = true; });
      wrap.appendChild(ip);
      if (!isLast) wrap.appendChild(el('div', 'ex', 'ここに書いた指示のとおりにすると、次の段に進めます'));
      box.appendChild(wrap);
    }

    const note = el('div', 'wiz-inst');
    note.appendChild(el('b', '', '解く人がやること：'));
    note.appendChild(el('div', '', P.instruction(W.parts)));
    box.appendChild(note);
  }

  function recipe() {
    const size = +$('#wizSize').value;
    return {
      parts: W.parts.slice(),
      texts: Object.assign({}, W.texts),
      rows: size, cols: size,
      density: $('#wizDensity').value,
      sg: $('#wizSG').value,
      loops: $('#wizLoops').value
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
    acts.appendChild(mk('✏️ くわしく直す', function () { MZ.app.showEditor(); }));
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
  function show() { $('#wizardView').classList.add('show'); $('#app').classList.remove('show'); }
  function hide() { $('#wizardView').classList.remove('show'); $('#app').classList.add('show'); }

  function init() {
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
    MZ.wizard = { show: show, hide: hide, generate: generate, add: addPart, remove: removePart };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
