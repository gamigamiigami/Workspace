/* ===========================================================================
 * wizard.js — かんたん作成画面（最初に出る画面）
 *
 * ここでやることは3つだけ。
 *   ① どんな謎にするかを選ぶ
 *   ② こたえになる文章を入れる
 *   ③ 「自動で作る」を押す
 * あとは印刷するか、画像で保存するだけ。
 * 細かく直したい人だけが「くわしく直す」で編集画面へ行く。
 * ======================================================================== */
(function () {
  'use strict';
  const P = MZ.packages, R = MZ.render, ST = MZ.steps;

  const $ = function (s) { return document.querySelector(s); };
  const el = function (tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const W = { packId: null, texts: {}, built: null };

  /* =======================================================================
   * ① 謎の型をカードで見せる
   * ===================================================================== */
  function buildCards() {
    const grid = $('#packGrid');
    grid.textContent = '';
    P.list().forEach(function (def) {
      const b = el('button', 'pack');
      b.dataset.id = def.id;
      b.appendChild(el('div', 'em', def.emoji));
      b.appendChild(el('div', 'nm', def.name));
      b.appendChild(el('div', 'sm', def.summary));
      b.appendChild(el('span', 'lv', def.level));
      b.addEventListener('click', function () { selectPack(def.id); });
      grid.appendChild(b);
    });
    // 自分で道を描きたい人むけの入口
    const manual = el('button', 'pack');
    manual.appendChild(el('div', 'em', '✏️'));
    manual.appendChild(el('div', 'nm', 'じぶんで道を描く'));
    manual.appendChild(el('div', 'sm', '正解にしたい道を指でなぞると、その道が最短になる迷路を作ります'));
    manual.appendChild(el('span', 'lv', '自由に作る'));
    manual.addEventListener('click', function () {
      MZ.app.showEditor();
      MZ.app.setTool('route');
      MZ.app.setStatus('「ルート」で正解にしたい道をなぞってから、右の「このルートが最短になる迷路を作る」を押してください');
    });
    grid.appendChild(manual);
  }

  function selectPack(id) {
    W.packId = id;
    document.querySelectorAll('.pack').forEach(function (b) {
      b.classList.toggle('on', b.dataset.id === id);
    });
    buildInputs();
    $('#wizStep2').classList.remove('off');
    $('#wizStep3').classList.remove('off');
    $('#btnGenerate').disabled = false;
    $('#wizResult').textContent = '';
    $('#wizStep2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* =======================================================================
   * ② 文章の入力欄を、選んだ型に合わせて出す
   * ===================================================================== */
  function buildInputs() {
    const box = $('#packInputs');
    box.textContent = '';
    const def = P.get(W.packId);
    if (!def) return;
    def.inputs.forEach(function (f) {
      const wrap = el('div', 'wiz-field');
      wrap.appendChild(el('label', '', f.label));
      const ip = document.createElement('input');
      ip.type = 'text';
      ip.id = 'wizin_' + f.k;
      ip.value = (W.texts[f.k] !== undefined) ? W.texts[f.k] : f.example;
      ip.addEventListener('input', function () { W.texts[f.k] = ip.value; });
      W.texts[f.k] = ip.value;
      wrap.appendChild(ip);
      wrap.appendChild(el('div', 'ex', '例：' + f.example + '　※ひらがな・カタカナ・漢字・数字が使えます'));
      box.appendChild(wrap);
    });
    const note = el('div', 'wiz-inst');
    note.appendChild(el('b', '', '解く人がやること：'));
    note.appendChild(el('span', '', def.instruction({})));
    box.appendChild(note);
  }

  function recipe() {
    const size = +$('#wizSize').value;
    return {
      packageId: W.packId,
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
    // 画面に「作っています」を出してから計算する
    setTimeout(function () {
      let out;
      try { out = P.build(recipe()); }
      catch (e) { out = { ok: false, reason: 'エラーが起きました：' + (e && e.message ? e.message : e) }; }
      btn.disabled = false;
      btn.textContent = '✨ 自動で作る';
      if (!out || !out.ok) {
        const w = el('div', 'wiz-note', '⚠ ' + ((out && out.reason) || '作れませんでした'));
        box.appendChild(w);
        return;
      }
      W.built = out;
      MZ.app.applyBuilt(out.maze, out.steps);
      showResult(out);
    }, 30);
  }

  function showResult(out) {
    const box = $('#wizResult');
    box.textContent = '';
    const results = ST.runSteps(out.maze, out.steps);
    const firstPath = (results.filter(function (r) { return r.path; })[0] || {}).path || null;

    const opts = {
      cellPx: 34, showRoles: false, showGhost: false, showGrid: true, exportScale: 2
    };
    const grid = el('div', 'wiz-preview');

    const c1 = el('div', 'wiz-card');
    c1.appendChild(el('h3', '', '問題（これを印刷します）'));
    const img1 = document.createElement('img');
    img1.src = R.toDataURL(out.maze, Object.assign({}, opts, { showRoute: false }));
    c1.appendChild(img1);
    grid.appendChild(c1);

    const c2 = el('div', 'wiz-card');
    c2.appendChild(el('h3', '', '答え（1段めの通り道）'));
    const img2 = document.createElement('img');
    img2.src = R.toDataURL(out.maze, Object.assign({}, opts, { showRoute: true, routePath: firstPath }));
    c2.appendChild(img2);
    grid.appendChild(c2);
    box.appendChild(grid);

    const ans = el('div', 'wiz-answer');
    ans.appendChild(el('span', '', 'こたえ：'));
    ans.appendChild(el('b', '', out.answer));
    box.appendChild(ans);

    const inst = el('div', 'wiz-inst');
    inst.appendChild(el('b', '', '問題用紙にのる文：'));
    inst.appendChild(el('div', '', out.maze.meta.instruction || ''));
    const flow = el('div', '', '');
    flow.style.marginTop = '8px';
    flow.style.fontSize = '12.5px';
    flow.style.color = '#6b7280';
    results.forEach(function (r) {
      if (r.index < 0) return;
      flow.appendChild(el('div', '', '↓ ' + r.title + (r.log ? '　' + r.log : '')));
    });
    inst.appendChild(flow);
    box.appendChild(inst);

    const acts = el('div', 'wiz-actions');
    acts.appendChild(mk('🔁 もう一度作る', generate));
    acts.appendChild(mk('🖨 印刷する', function () { MZ.app.doPrint(); }, 'primary'));
    acts.appendChild(mk('🖼 画像で保存', function () { MZ.app.doPng(); }));
    acts.appendChild(mk('✏️ くわしく直す', function () { MZ.app.showEditor(); }));
    box.appendChild(acts);

    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function mk(label, fn, cls) {
    const b = el('button', cls || '', label);
    b.addEventListener('click', fn);
    return b;
  }

  /* =======================================================================
   * 画面の出し入れ
   * ===================================================================== */
  function show() {
    $('#wizardView').classList.add('show');
    $('#app').classList.remove('show');
  }
  function hide() {
    $('#wizardView').classList.remove('show');
    $('#app').classList.add('show');
  }

  function init() {
    buildCards();
    $('#btnGenerate').addEventListener('click', generate);
    $('#btnToEditor').addEventListener('click', function () { MZ.app.showEditor(); });
    $('#btnWizHelp').addEventListener('click', function () { $('#helpModal').hidden = false; });
    MZ.wizard = { show: show, hide: hide, generate: generate, select: selectPack };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
