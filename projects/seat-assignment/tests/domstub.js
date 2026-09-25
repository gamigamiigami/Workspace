// 席替え屋さん index.html をまるごと動かすための、必要最低限のDOMスタブ。
// コンテナ再起動で前のdomstub.jsが消えたため、今回の検証に必要な範囲だけ作りなおす。
'use strict';

function makeClassList(el) {
  return {
    contains(c) { return el._classes.has(c); },
    add(...cs) { cs.forEach(c => el._classes.add(c)); syncClassAttr(el); },
    remove(...cs) { cs.forEach(c => el._classes.delete(c)); syncClassAttr(el); },
    toggle(c, force) {
      const has = el._classes.has(c);
      const on = (force === undefined) ? !has : !!force;
      if (on) el._classes.add(c); else el._classes.delete(c);
      syncClassAttr(el);
      return on;
    }
  };
}
function syncClassAttr(el) { el.className = [...el._classes].join(' '); }

function makeStyleProxy() {
  const store = {};
  return new Proxy(store, {
    get(t, k) { return t[k] === undefined ? '' : t[k]; },
    set(t, k, v) { t[k] = v; return true; }
  });
}

let idCounter = 0;

function createElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: '',
    _classes: new Set(),
    className: '',
    style: makeStyleProxy(),
    children: [],
    parent: null,
    dataset: {},
    _text: '',
    _html: '',
    _listeners: {},
    disabled: false,
    value: '',
    checked: false,
    _uid: ++idCounter,
    get classList() { return makeClassList(this); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this._html = escapeForHtml(String(v)); },
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = v;
      this._text = String(v).replace(/<[^>]*>/g, '');
      this.children = [];
      parseFragmentInto(this, String(v));
    },
    get outerHTML() { return this._html; },
    get options() { return this.children.filter(c => c.tagName === 'OPTION'); },
    get previousElementSibling() {
      if (!this.parent) return null;
      const i = this.parent.children.indexOf(this);
      return i > 0 ? this.parent.children[i - 1] : null;
    },
    get nextElementSibling() {
      if (!this.parent) return null;
      const i = this.parent.children.indexOf(this);
      return (i >= 0 && i < this.parent.children.length - 1) ? this.parent.children[i + 1] : null;
    },
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      registerInTree(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    remove() { if (this.parent) this.parent.removeChild(this); },
    setAttribute(name, val) {
      if (name === 'class') { this._classes = new Set(String(val).split(/\s+/).filter(Boolean)); syncClassAttr(this); }
      else if (name === 'id') this.id = val;
      else this[name] = val;
    },
    getAttribute(name) { return this[name]; },
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(f => f !== fn);
    },
    dispatchEvent(evt) {
      const fns = this._listeners[evt.type] || [];
      for (const fn of fns) fn(evt);
      return true;
    },
    dispatch(type, evt) {
      this.dispatchEvent(Object.assign({ type, target: this, preventDefault() {} }, evt || {}));
    },
    closest(sel) {
      const cls = sel.replace('.', '');
      let cur = this;
      while (cur) { if (cur._classes && cur._classes.has(cls)) return cur; cur = cur.parent; }
      return null;
    },
    querySelector(sel) { return querySelectorFrom(this, sel, true)[0] || null; },
    querySelectorAll(sel) { return querySelectorFrom(this, sel, false); },
    get clientWidth() { return this._clientWidth || 0; },
    set clientWidth(v) { this._clientWidth = v; },
    get scrollWidth() { return this._scrollWidth || 0; },
    set scrollWidth(v) { this._scrollWidth = v; },
    get scrollHeight() { return this._scrollHeight || 0; },
    set scrollHeight(v) { this._scrollHeight = v; },
    get offsetHeight() { return this._offsetHeight || 0; },
    set offsetHeight(v) { this._offsetHeight = v; },
    getBoundingClientRect() { return { top: 0, left: 0, width: this.clientWidth, height: this._offsetHeight || 0 }; },
    focus() { global.document.activeElement = this; },
    blur() { if (global.document.activeElement === this) global.document.activeElement = null; }
  };
  return el;
}
function escapeForHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const VOID_TAGS_FRAG = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
// innerHTML = '...' で入れた文字列を、簡易パースして本当の子要素として組みたてる
// （app.js 側が sel.options や cell.children を読む箇所があるため）
function parseFragmentInto(parentEl, html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  const stack = [parentEl];
  const tagRe = /<\/?[a-zA-Z][a-zA-Z0-9]*[^>]*>/g;
  let lastIndex = 0, m;
  while ((m = tagRe.exec(html))) {
    const text = html.slice(lastIndex, m.index);
    if (text.trim()) {
      const top = stack[stack.length - 1];
      const t = createElement('#text');
      t.tagName = '#TEXT';
      t._text = text;
      top.children.push(t);
    }
    lastIndex = tagRe.lastIndex;
    const tag = m[0];
    if (tag.startsWith('</')) {
      const name = tag.slice(2, -1).trim().toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === name) { stack.length = i; break; }
      }
    } else {
      const selfClose = /\/>$/.test(tag);
      const inner = tag.replace(/^<|\/?>$/g, '');
      const sp = inner.indexOf(' ');
      const name = (sp === -1 ? inner : inner.slice(0, sp)).toLowerCase();
      const attrStr = sp === -1 ? '' : inner.slice(sp + 1);
      const attrs = {};
      const attrRe = /([a-zA-Z0-9_-]+)(=("([^"]*)"|'([^']*)'))?/g;
      let am;
      while ((am = attrRe.exec(attrStr))) attrs[am[1]] = am[4] !== undefined ? am[4] : (am[5] !== undefined ? am[5] : '');
      const el = createElement(name);
      if (attrs.id) el.id = attrs.id;
      if (attrs.class) { el._classes = new Set(attrs.class.split(/\s+/).filter(Boolean)); el.className = attrs.class; }
      for (const k of Object.keys(attrs)) {
        if (k === 'class') continue;
        else if (k === 'value') el.value = attrs.value;
        else if (k === 'style') {
          for (const decl of attrs.style.split(';')) {
            const idx = decl.indexOf(':');
            if (idx < 0) continue;
            const prop = decl.slice(0, idx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            if (prop) el.style[prop] = decl.slice(idx + 1).trim();
          }
        }
        else el[k] = attrs[k];
      }
      const top = stack[stack.length - 1];
      top.children.push(el);
      el.parent = top;
      if (attrs.id) allById[attrs.id] = el;
      if (!selfClose && !VOID_TAGS_FRAG.has(name)) stack.push(el);
    }
  }
  const tail = html.slice(lastIndex);
  if (tail.trim()) {
    const top = stack[stack.length - 1];
    const t = createElement('#text');
    t.tagName = '#TEXT';
    t._text = tail;
    top.children.push(t);
  }
}

const allById = {};
const allByTag = {};
function registerInTree(el) {
  if (el.id) allById[el.id] = el;
  (allByTag[el.tagName] = allByTag[el.tagName] || []).push(el);
  for (const c of el.children) registerInTree(c);
}

// ざっくりセレクタ対応：'.cls'、'#id'、'tag'、'tag.cls'、'a b'（子孫、簡易）
function matches(el, simple) {
  if (simple.startsWith('#')) return el.id === simple.slice(1);
  if (simple.startsWith('.')) return el._classes && el._classes.has(simple.slice(1));
  const m = simple.match(/^([a-zA-Z0-9]+)(\.[\w-]+)?$/);
  if (m) {
    const tagOk = el.tagName === m[1].toUpperCase();
    const clsOk = !m[2] || (el._classes && el._classes.has(m[2].slice(1)));
    return tagOk && clsOk;
  }
  return false;
}
function collectAll(root) {
  const out = [];
  (function walk(el) { out.push(el); for (const c of el.children) walk(c); })(root);
  return out;
}
function querySelectorFrom(root, sel, first) {
  const parts = sel.trim().split(/\s+/);
  let candidates = collectAll(root).filter(e => e !== root || true);
  // ルート自身は除外（実DOMのquerySelectorはルート自身にはマッチしない）
  candidates = candidates.filter(e => e !== root);
  if (parts.length === 1) {
    const out = candidates.filter(e => matches(e, parts[0]));
    return first ? out.slice(0, 1) : out;
  }
  // 簡易な子孫セレクタ：最後のパートにマッチし、かつ先祖のどこかが最初のパートにマッチ
  const last = parts[parts.length - 1];
  const out = candidates.filter(e => {
    if (!matches(e, last)) return false;
    let cur = e.parent;
    let idx = parts.length - 2;
    while (cur && idx >= 0) {
      if (matches(cur, parts[idx])) idx--;
      cur = cur.parent;
    }
    return idx < 0;
  });
  return first ? out.slice(0, 1) : out;
}

function buildDocument(bodyEl) {
  return {
    body: bodyEl,
    activeElement: null,
    _listeners: {},
    getElementById(id) { return allById[id] || null; },
    createElement,
    querySelector(sel) { return querySelectorFrom(bodyEl, sel, true)[0] || null; },
    querySelectorAll(sel) { return querySelectorFrom(bodyEl, sel, false); },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    dispatchEvent(evt) { (this._listeners[evt.type] || []).forEach(fn => fn(evt)); }
  };
}

module.exports = { createElement, buildDocument, registerInTree, allById };
