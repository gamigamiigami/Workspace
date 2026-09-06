/* ===========================================================================
 * opt.js — かんたん作成と編集画面で「同じ値」を見るための共通設定
 *
 * ★このファイルの約束★
 *   同じ意味の設定が2か所にあると、どちらが効いているのか分からなくなる。
 *   そこで値は必ずここに1つだけ持ち、画面の入力欄は「それを映すだけ」にする。
 *   だから、かんたん作成で「文字の量：多め」にしてから編集画面へ行っても、
 *   編集画面の「文字の量」は多めのままだし、逆も同じになる。
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.opt = (function () {
  'use strict';

  /* 持っている値はこれだけ */
  const V = {
    rows: 12,             // 迷路のたて
    cols: 12,             // 迷路のよこ
    density: 'normal',    // まわりにまく文字の量  few / normal / many
    loops: 'none',        // わき道の量            none / some / many
    sg: 'corners'         // START・GOALの決め方   corners / auto
  };
  const RANGE = { rows: [4, 30], cols: [4, 30] };

  const binds = [];       // { key, el } … その値を映している入力欄
  const watchers = [];    // 値が変わったときに呼ぶもの

  function fix(k, v) {
    const r = RANGE[k];
    if (!r) return String(v);
    v = Math.round(+v);
    if (isNaN(v)) v = V[k];
    return Math.max(r[0], Math.min(r[1], v));
  }

  function get(k) { return V[k]; }
  function all() { return Object.assign({}, V); }

  function set(k, v, from) {
    if (!(k in V)) return;
    const nv = fix(k, v);
    const changed = (V[k] !== nv);
    V[k] = nv;
    paint(k, from);
    if (changed) watchers.forEach(function (fn) { try { fn(k, nv); } catch (e) { /* 画面が無いときは無視 */ } });
  }

  /** その値を映している入力欄に書きもどす（自分が発火元の欄は書きかえない） */
  function paint(k, from) {
    binds.forEach(function (b) {
      if (b.key !== k || b.el === from) return;
      if (String(b.el.value) !== String(V[k])) b.el.value = V[k];
    });
  }
  function paintAll() { Object.keys(V).forEach(function (k) { paint(k, null); }); }

  /**
   * 入力欄をこの設定につなぐ。
   * かんたん作成の欄と編集画面の欄を同じ key でつなげば、両方が同じ値になる。
   */
  function bind(sel, key) {
    const el = (typeof sel === 'string') ? document.querySelector(sel) : sel;
    if (!el || !(key in V)) return null;
    binds.push({ key: key, el: el });
    el.value = V[key];
    // 打っている途中で書きかえられると気持ちが悪いので change だけを見る
    el.addEventListener('change', function () { set(key, el.value, el); });
    return el;
  }

  function watch(fn) { if (typeof fn === 'function') watchers.push(fn); }

  return { get: get, set: set, all: all, bind: bind, watch: watch, paintAll: paintAll, RANGE: RANGE };
})();
