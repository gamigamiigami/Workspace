# テスト（実機に近い簡易ハーネス）

`index.html` をまるごと読みこんで、実際のボタン操作・キーボード操作に近い形で
動かすためのテストハーネス。以前のフルテスト一式（Node.js製の手作りDOMスタブ、
340件以上）はコンテナの再起動で失われたため、2026-09-25 のセッションで作りなおした。

## ファイル

- `domstub.js` … `document` / 要素 / `localStorage` などの最低限のスタブ
- `htmlparse.js` … `index.html` の `<body>` を簡易パースして、本物に近い要素木にする
- `undo-redo.test.js` … 元に戻す・やり直す（Ctrl+Z / Ctrl+Y）、NG設定タブの黒板連動 のテスト

## 実行方法

```bash
node undo-redo.test.js
```

## 新しいテストを足すとき

```js
const { createElement, buildDocument, registerInTree } = require('./domstub.js');
const { parseHtml } = require('./htmlparse.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const { root, scripts } = parseHtml(html.match(/<body>([\s\S]*)<\/body>/)[1], createElement, registerInTree);
root.tagName = 'BODY';
global.document = buildDocument(root);
// alert / confirm / localStorage / window を用意してから…
eval(scripts[0].replace("'use strict';", '')); // ← 'use strict' を外さないと、
                                                //   関数宣言がこのファイルのスコープに出てこない
```

`byId('btnXxx').dispatch('click')` でボタン操作、
`document.dispatchEvent({ type: 'keydown', ctrlKey: true, key: 'z', preventDefault(){} })`
でキーボード操作を再現できる。
