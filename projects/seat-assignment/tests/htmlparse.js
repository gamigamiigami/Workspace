// 実際の index.html の <body> をかんたんに解析して、domstub2.js のElement木にする。
// フルスペックのHTMLパーサーではなく、このファイルの形（属性値はダブルクオート、
// コメントは <!-- --> のみ）に合わせた簡易版。
'use strict';
const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

function parseAttrs(str) {
  const attrs = {};
  const re = /([a-zA-Z0-9_-]+)(=("([^"]*)"|'([^']*)'))?/g;
  let m;
  while ((m = re.exec(str))) {
    attrs[m[1]] = m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : '');
  }
  return attrs;
}

function parseHtml(html, createElement, registerInTree) {
  // コメントを除去
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  // <script>...</script> は中身をタグとして解析しない（別扱い）
  const scripts = [];
  html = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (m, body) => {
    scripts.push(body);
    return '';
  });
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');

  const root = createElement('root');
  const stack = [root];
  const tagRe = /<\/?[a-zA-Z][a-zA-Z0-9]*[^>]*>/g;
  let lastIndex = 0;
  let m;
  while ((m = tagRe.exec(html))) {
    const text = html.slice(lastIndex, m.index);
    if (text.trim()) {
      const top = stack[stack.length - 1];
      const t = createElement('#text');
      t.tagName = '#TEXT';
      t._text = decodeEntities(text);
      top.appendChild(t);
    }
    lastIndex = tagRe.lastIndex;
    const tag = m[0];
    if (tag.startsWith('</')) {
      const name = tag.slice(2, -1).trim().toLowerCase();
      // 対応する開始タグまでポップ
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === name) { stack.length = i; break; }
      }
    } else {
      const selfClose = /\/>$/.test(tag);
      const inner = tag.replace(/^<|\/?>$/g, '');
      const sp = inner.indexOf(' ');
      const name = (sp === -1 ? inner : inner.slice(0, sp)).toLowerCase();
      const attrStr = sp === -1 ? '' : inner.slice(sp + 1);
      const attrs = parseAttrs(attrStr);
      const el = createElement(name);
      if (attrs.id) el.id = attrs.id;
      if (attrs.class) { el._classes = new Set(attrs.class.split(/\s+/).filter(Boolean)); el.className = attrs.class; }
      for (const k of Object.keys(attrs)) {
        if (k === 'class') continue;
        if (k === 'checked') el.checked = true;
        else if (k === 'disabled') el.disabled = true;
        else if (k === 'value') el.value = attrs.value;
        else if (k.startsWith('data-')) el.dataset[camelize(k.slice(5))] = attrs[k];
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
      top.appendChild(el);
      if (!selfClose && !VOID_TAGS.has(name)) stack.push(el);
    }
  }
  const tail = html.slice(lastIndex);
  if (tail.trim()) {
    const top = stack[stack.length - 1];
    const t = createElement('#text');
    t.tagName = '#TEXT';
    t._text = decodeEntities(tail);
    top.appendChild(t);
  }
  registerInTree(root);
  return { root, scripts };
}

function camelize(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

module.exports = { parseHtml };
