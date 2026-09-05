# 再利用可能UIコンポーネント集

最終更新：2026-09-05（セッション173・STEPエディタと3カラム制作ツールのレイアウトを追加）

コピペで使えるUI部品をまとめる。スタイルはインラインまたは `<style>` 内に記載。

---

## STEPエディタ（処理を1本の流れとして並べる左パネル）

**用途：** 「これをして → 次にこれをして → 答えが出る」という**連鎖する処理**を、
プログラムを書かずに組み立ててもらうUI。迷路謎メーカーの心臓部。
制作ツール全般（作問ツール・自動化の手順書・チェックリスト）に流用できる。

**考え方**
- STEPは上から順に実行する。**各STEPの結果（その時点の盤面・文字）を保存**しておく
- STEPの見出しをクリックすると、**その時点の状態を再現して表示**する（見るだけ・編集不可）
- 編集は常に「設計図（STEP0）」に対して行う。→「STEP3を直したらSTEP1が壊れた」が起きない
- 選択中のSTEPだけ、その場に設定フォームを開く（別画面に飛ばさない）
- 結果・警告・エラーはSTEPの中に小さく出す（別の場所を見に行かせない）

**HTML**

```html
<aside class="pane" id="paneSteps">
  <h2>STEP（謎の流れ）</h2>
  <div id="stepList"></div>
  <select id="stepType"></select>
  <button id="btnAddStep">＋ STEPを足す</button>
  <button id="btnViewMaze">設計図にもどる</button>
  <div class="answer-box">最後に出てくる文字：<b id="answerText">—</b></div>
</aside>
```

**CSS**

```css
.step { border:1px solid #e5e9ef; border-radius:10px; margin-bottom:6px; background:#fff; overflow:hidden; }
.step.sel  { border-color:#1c7ed6; box-shadow:0 0 0 2px rgba(28,126,214,.15); }
.step-head { display:flex; align-items:center; gap:6px; padding:8px 10px; cursor:pointer; }
.step-no   { font-size:11px; font-weight:700; color:#fff; background:#64748b;
             border-radius:6px; padding:2px 6px; white-space:nowrap; }
.step.err  .step-no { background:#e03131; }   /* エラーは番号の色で知らせる */
.step.warn .step-no { background:#e8a300; }
.step-title{ flex:1; font-size:13px; font-weight:600; }
.step-log  { font-size:11px; color:#6b7280; padding:0 10px 8px; word-break:break-all; }
.step-body { padding:8px 10px 10px; border-top:1px dashed #e5e9ef;
             display:flex; flex-direction:column; gap:6px; }  /* 選択中だけ出す */
```

**JS（設定フォームを型から自動で作る）**

```js
// 部品ごとに「何を聞くか」だけを書いておけば、フォームは自動で組み上がる
const FORMS = {
  'filter-color': [
    { k:'mode',   t:'sel',    label:'読み方', opts:[['include','この色だけ'],['exclude','この色いがい']] },
    { k:'colors', t:'colors', label:'色' }
  ],
  'remove-walls': [ { k:'colors', t:'colors' }, { k:'mode', t:'delmode' } ]
};
// t（型）ごとに1回だけ描き方を書く → 新しいギミックはFORMSに1行足すだけ
```

**ポイント：** STEPの並べかえ（↑↓）・複製・削除は、**選択中のSTEPの中**に小さく置く。
一覧の各行にボタンを並べると、指で押し間違える。

**タグ：** #制作ツール #パイプラインUI #meiro-nazo-maker

---

## 制作ツールの3カラムレイアウト（PC 3列 ↔ iPad縦持ち タブ切りかえ）

**用途：** 「一覧／作業キャンバス／設定」の3つを同時に見せたい制作ツール。
iPad縦持ち（768px）では3列が入らないので、**タブで1枚ずつ**に切りかえる。

```html
<nav class="panetabs" id="paneTabs">
  <button data-pane="steps">① STEP</button>
  <button data-pane="canvas" class="on">② 迷路</button>
  <button data-pane="side">③ 設定</button>
</nav>
<main class="layout">
  <aside class="pane" id="paneSteps">…</aside>
  <section class="pane pane-canvas show" id="paneCanvas">…</section>
  <aside class="pane" id="paneSide">…</aside>
</main>
```

```css
.layout { flex:1; min-height:0; display:grid;
          grid-template-columns:250px 1fr 330px; gap:8px; padding:8px; }
.pane { background:#fff; border-radius:12px; overflow:auto; padding:12px; }
.pane-canvas { padding:0; display:flex; flex-direction:column; overflow:hidden; }
.panetabs { display:none; gap:4px; padding:6px 8px; background:#e2e8f0; }
.panetabs button { flex:1; border-radius:8px; min-height:44px; }

@media (max-width: 900px) {
  .panetabs { display:flex; }
  .layout { grid-template-columns:1fr; padding:6px; }
  .pane { display:none; }
  .pane.show { display:block; }
  .pane-canvas.show { display:flex; }   /* キャンバスだけ flex にもどす */
}
```

```js
// タブでキャンバスに戻ったら、大きさが変わっているので描き直す
if (pane === 'canvas') setTimeout(() => editor.fit(), 30);
```

**注意点**
- `.pane.show { display:block }` だけだと**キャンバス面が縦に潰れる**。
  `.pane-canvas.show { display:flex }` を別に書くこと
- 設定パネルは `<details>` のアコーディオンにして、よく使う項目だけ `open` にする
- 右パネルの折りたたみは、**自動テストからは閉じていて触れない**。
  テストの最初に `document.querySelectorAll('details').forEach(d => d.open = true)` を入れる

**タグ：** #レイアウト #iPad #レスポンシブ #制作ツール #meiro-nazo-maker

---

## 外部サービス依存機能でのフォールバック設計（「短いリンク」ボタン）

**用途：** 短縮URLサービス（is.gd など）を使うが、ネットワークブロック・サービス終了時のリスクに対応したい場合

**設計方針：**
- **長いリンク＝本体（常に表示・必ず動作）**
- **短いリンク＝おまけ（追加ボタンで展開・失敗してもOK）**
- 失敗時のメッセージに「元に戻す・代替手段（QRコード）」を明記

```html
<!-- 配布リンク表示パネル -->
<div class="panel">
  <h2>配布用リンク</h2>
  
  <!-- 長いリンク（常に表示・本体） -->
  <div id="longLinkBox">
    <input type="text" id="longLink" readonly />
    <button onclick="copyToClipboard('longLink')">コピー</button>
  </div>
  
  <!-- 短いリンク化ボタン -->
  <button id="btnMakeShort" onclick="makeShortLink()">
    短いリンクにする
  </button>
  
  <!-- 短いリンク表示（ボタン押下後のみ表示） -->
  <div id="shortLinkBox" style="display:none;">
    <input type="text" id="shortLink" readonly />
    <button onclick="copyToClipboard('shortLink')">コピー</button>
    <button id="btnLongLink" onclick="backToLongLink()">
      長いリンクに戻す
    </button>
    <p id="shortMsg" style="font-size:13px; color:#666;">
      ⚠️ 学校のネットが短縮リンクをブロックしていないか確認してください
    </p>
  </div>
  
  <!-- QRコード -->
  <div id="qrBox">
    <canvas id="qr" width="200" height="200"></canvas>
    <p style="font-size:12px;">↑ スマホで撮影して開く（最も確実）</p>
  </div>
</div>
```

**JavaScriptロジック例：**
```javascript
async function makeShortLink() {
  const longUrl = document.getElementById('longLink').value;
  
  try {
    // 短縮サービスを呼び出し
    const res = await fetch(
      'https://is.gd/create.php?format=json&url=' + 
      encodeURIComponent(longUrl)
    );
    const data = await res.json();
    
    if (!data || !data.shorturl) {
      throw new Error(data?.errormessage || '短縮に失敗');
    }
    
    // 成功時：短いリンクを表示
    document.getElementById('shortLink').value = data.shorturl;
    document.getElementById('shortLinkBox').style.display = 'block';
    document.getElementById('btnMakeShort').style.display = 'none';
    document.getElementById('shortMsg').innerHTML = 
      '✅ 短縮成功（279文字 → 20文字）。<br/>' +
      '上の<b>長いリンクとQRコードはそのまま使えます</b>ので、' +
      '短縮リンクが開けないときはそちらを配ってください。';
  } catch (err) {
    // 失敗時：フォールバック（長いリンク・QRコード維持）
    document.getElementById('shortMsg').innerHTML = 
      '⚠️ 短縮に失敗しました。<br/>' +
      '上の<b>長いリンクとQRコードはそのまま使えます</b>ので、' +
      'そちらを配ってください。';
  }
}

function backToLongLink() {
  document.getElementById('shortLinkBox').style.display = 'none';
  document.getElementById('btnMakeShort').style.display = 'block';
  document.getElementById('shortMsg').textContent = '';
}
```

**重要なポイント：**
1. **長いリンク（本体）は必ず表示し続ける** — ユーザーが「何が本当の手段か」を迷わない
2. **失敗時のメッセージに代替手段（QRコード）を明記** — ネットワークブロック時の対応を明記
3. **「戻す」ボタンで短いリンク化を取り消し可能にする** — 試行錯誤を容易に
4. **UI上で「外部サービス依存」であることを開示** — ユーザーが判断できるように

**応用例：**
- 動画配信サービスの再生時の代替CDN（失敗時は本家を使用）
- API呼び出しの失敗時フォールバック（複数サービスの切り替え）
- キャッシュ活用（高速・低容量を試した後、失敗時はオリジナルを使用）

**プロジェクト実装例：** `/Workspace/projects/crossword/index.html` セッション140

---

## モーダルダイアログ（シンプル）

```html
<!-- トリガーボタン -->
<button onclick="openModal('modal1')">説明を見る</button>

<!-- モーダル本体 -->
<div id="modal1" class="modal" onclick="closeModal('modal1')">
  <div class="modal-content" onclick="event.stopPropagation()">
    <h2>タイトル</h2>
    <p>内容をここに書く</p>
    <button onclick="closeModal('modal1')">閉じる</button>
  </div>
</div>
```

```css
.modal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 100;
  align-items: center;
  justify-content: center;
}
.modal.open { display: flex; }
.modal-content {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  max-width: 90%;
  width: 400px;
}
```

```javascript
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
```

---

## タイマー表示

```html
<div class="timer" id="timer">30</div>
```

```css
.timer {
  font-size: 48px;
  font-weight: bold;
  text-align: center;
  color: #333;
  transition: color 0.3s;
}
.timer.warning { color: #e74c3c; } /* 残り少ない時は赤に */
```

```javascript
let timeLeft = 30;
let timerId = null;

function startTimer(seconds, onEnd) {
  timeLeft = seconds;
  updateTimerDisplay();
  timerId = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(timerId);
      onEnd();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  el.textContent = timeLeft;
  el.classList.toggle('warning', timeLeft <= 10);
}

function stopTimer() {
  clearInterval(timerId);
}
```

---

## 選択肢ボタン（クイズ用）

```html
<div id="choices" class="choices"></div>
```

```css
.choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 16px 0;
}
.choice-btn {
  padding: 16px;
  font-size: 16px;
  border: 2px solid #ccc;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  min-height: 60px;
}
.choice-btn:hover   { background: #f0f0f0; }
.choice-btn.correct { background: #d4edda; border-color: #28a745; }
.choice-btn.wrong   { background: #f8d7da; border-color: #dc3545; }
```

```javascript
function renderChoices(choices, correctIndex, onSelect) {
  const container = document.getElementById('choices');
  container.innerHTML = '';
  choices.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      // 全ボタン無効化
      container.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
      // 正解・不正解の色付け
      btn.classList.add(i === correctIndex ? 'correct' : 'wrong');
      if (i !== correctIndex) {
        container.querySelectorAll('.choice-btn')[correctIndex].classList.add('correct');
      }
      onSelect(i === correctIndex);
    });
    container.appendChild(btn);
  });
}
```

---

## トースト通知（画面上部に一時表示）

```html
<div id="toast" class="toast"></div>
```

```css
.toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: #fff;
  padding: 12px 24px;
  border-radius: 24px;
  font-size: 15px;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  z-index: 200;
}
.toast.show { opacity: 1; }
```

```javascript
function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}
```

---

---

## アコーディオン（よくある質問）

**用途：** FAQやセクション展開時に1つだけ開くパターン。複数同時展開しない仕様。

```html
<div class="accordion">
  <button class="accordion-btn">質問1：参加費に何が含まれますか？</button>
  <div class="accordion-body">
    <p>参加費1,500円にはソフトドリンク飲み放題が含まれます。</p>
  </div>

  <button class="accordion-btn">質問2：どんなゲームがありますか？</button>
  <div class="accordion-body">
    <p>ライトなカードゲームから重めのボードゲームまで揃えています。</p>
  </div>
</div>
```

```css
.accordion {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.accordion-btn {
  background: #f5f0e8;
  border: 1px solid #e0d8cc;
  border-radius: 8px;
  padding: 16px;
  font-size: 1rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.accordion-btn:hover {
  background: #e8e0d0;
}

.accordion-btn::after {
  content: '▼';
  font-size: 0.75rem;
  transition: transform 0.2s;
}

.accordion-btn.open::after {
  transform: rotate(180deg);
}

.accordion-body {
  display: none;
  padding: 0 16px 16px;
  border-left: 3px solid #c9a84c;
  padding-left: 16px;
  color: #666;
  line-height: 1.7;
}

.accordion-body.open {
  display: block;
}
```

```javascript
document.querySelectorAll('.accordion-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const body = btn.nextElementSibling;
    const isOpen = body.classList.contains('open');
    
    // 他のアコーディオンを閉じる
    document.querySelectorAll('.accordion-body').forEach(b => b.classList.remove('open'));
    document.querySelectorAll('.accordion-btn').forEach(b => b.classList.remove('open'));
    
    // クリックされた項目を開く
    if (!isOpen) {
      body.classList.add('open');
      btn.classList.add('open');
    }
  });
});
```

---

## チャットボット UI（質問選択 → 回答表示）

**用途：** よくある質問をチャット形式で提示し、回答を表示する。複数の質問データを管理。

```html
<div class="bot-wrap">
  <!-- 初期画面：質問一覧 -->
  <div class="bot-intro">
    <div class="bot-face">🎲</div>
    <div class="bot-bubble">
      こんにちは！何か気になることはありますか？<br>下から選んでみてください👇
    </div>
  </div>

  <div class="bot-questions" id="bot-questions">
    <button class="bot-q-btn" data-key="fee">💰 参加費に何が含まれますか？</button>
    <button class="bot-q-btn" data-key="game">🎮 どんなゲームがありますか？</button>
    <button class="bot-q-btn" data-key="age">👥 参加者の年齢層は？</button>
  </div>

  <!-- 質問選択後の会話表示 -->
  <div id="bot-chat"></div>

  <!-- 戻るボタン -->
  <button class="bot-back" id="bot-back">← 別の質問を見る</button>
</div>
```

```css
.bot-wrap {
  margin-top: 24px;
}

.bot-intro {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: flex-end;
}

.bot-face {
  font-size: 32px;
  min-width: 40px;
  text-align: center;
}

.bot-bubble {
  background: #f5f0e8;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  color: #333;
  word-break: break-word;
}

.bot-questions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0;
}

.bot-q-btn {
  background: #fff;
  border: 1px solid #e0d8cc;
  border-radius: 8px;
  padding: 12px 16px;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  font-size: 0.95rem;
}

.bot-q-btn:hover {
  background: #f5f0e8;
  border-color: #c9a84c;
}

.user-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.user-bubble {
  background: #c9a84c;
  color: #fff;
  padding: 12px 16px;
  border-radius: 12px;
  max-width: 80%;
  text-align: left;
  word-break: break-word;
}

.bot-back {
  display: none;
  background: #f5f0e8;
  border: 1px solid #e0d8cc;
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 0.9rem;
  margin-top: 16px;
  transition: background 0.2s;
}

.bot-back:hover {
  background: #e8e0d0;
}
```

```javascript
// チャットボット用データベース
const botData = {
  fee: {
    q: '💰 参加費に何が含まれますか？',
    a: '参加費1,500円にはソフトドリンク飲み放題が含まれます。\n会場のドリンクが楽しめます🍹'
  },
  game: {
    q: '🎮 どんなゲームがありますか？',
    a: 'ライトなカードゲームから少し重めのボードゲームまで幅広く揃えています。\n詳しいゲームリストはお問い合わせください！'
  },
  age: {
    q: '👥 参加者の年齢層は？',
    a: '20代が中心ですが、10代〜30代まで幅広く参加しています。\n性別問わず、一人参加の方が多いので気軽に来てください😊'
  }
};

const questionsEl = document.getElementById('bot-questions');
const chatEl = document.getElementById('bot-chat');
const backBtn = document.getElementById('bot-back');

questionsEl.addEventListener('click', e => {
  const btn = e.target.closest('.bot-q-btn');
  if (!btn) return;
  
  const item = botData[btn.dataset.key];
  if (!item) return;
  
  // 質問一覧を非表示、チャット表示
  questionsEl.style.display = 'none';
  backBtn.style.display = 'inline';
  
  chatEl.innerHTML = `
    <div class="user-row">
      <div class="user-bubble">${item.q}</div>
    </div>
    <div class="bot-intro" style="margin-bottom:0">
      <div class="bot-face">🎲</div>
      <div class="bot-bubble">${item.a.replace(/\n/g, '<br>')}</div>
    </div>
  `;
});

backBtn.addEventListener('click', () => {
  questionsEl.style.display = 'flex';
  backBtn.style.display = 'none';
  chatEl.innerHTML = '';
});
```

---

---

## PCレスポンシブレイアウト（スマホ縦積み ↔ PC 2カラム）

**用途：** スマートフォン（〜768px）では縦積みレイアウト、PC（769px〜）では横幅1080pxの2カラムレイアウトに自動切り替え。

**HTML例：**
```html
<section class="hero">
  <div class="hero-text">キャッチコピー・ボタン</div>
  <div class="hero-stats">スタッツカード</div>
</section>
```

**CSS：**
```css
/* スマホ：デフォルト（縦積み） */
.hero {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 100%;
  margin: 0 auto;
  padding: 20px;
}

/* PC：769px以上で2カラム対応 */
@media (min-width: 769px) {
  body {
    max-width: 1080px;
    margin: 0 auto;
    padding: 0;
  }
  
  .hero {
    flex-direction: row;
    align-items: center;
    gap: 40px;
  }
  
  .hero-text { flex: 1; }
  .hero-stats { flex: 1; }
  
  /* About セクション：3カラム → 4カラム横並び */
  .about-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  
  /* Gallery：3カラム横並び */
  .gallery {
    grid-template-columns: repeat(3, 1fr);
  }
  
  /* FAQ & Chat：左右並列 */
  .faq-chat {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
  }
}
```

**活用ポイント：**
- ブレークポイント `769px` でスマホ/PC を明確に分岐
- 最大幅 `1080px` で大画面での見栄え調整
- `flex-direction: row/column` の切り替えでシンプルに横並び実装
- `grid-template-columns` 数の増減で各セクション最適化

---

## ゲームカード一覧（検索機能付き）

**用途：** ボードゲーム一覧などで、複数のアイテムをカード形式で表示し、検索フィルタリングを行う。

**HTML例：**
```html
<!-- 検索フォーム -->
<div class="games-search-wrap">
  <input class="games-search" id="games-search" type="text" placeholder="キーワードで検索…">
</div>

<!-- ゲームカード一覧 -->
<div class="games-grid" id="games-grid"></div>

<!-- 表示件数 -->
<p class="games-count" id="games-count"></p>
```

**CSS（ダークモード対応）：**
```css
.games-search-wrap { margin-bottom: 24px; }
.games-search {
  width: 100%;
  height: 44px;
  padding: 0 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--text);
  font-size: 0.9rem;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.games-search::placeholder { color: var(--text3); }
.games-search:focus { border-color: var(--border2); }

/* グリッドレイアウト */
.games-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

/* 個別カード */
.game-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s;
}
.game-card:hover { border-color: var(--border2); }

.game-card-name {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--white);
}

.game-card-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.game-tag {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}

.tag-players {
  background: rgba(212, 168, 67, 0.12);
  color: var(--gold);
  border: 1px solid rgba(212, 168, 67, 0.2);
}

.tag-time {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text2);
  border: 1px solid var(--border);
}

.game-card-desc {
  font-size: 0.78rem;
  color: var(--text2);
  line-height: 1.65;
}

.games-count {
  font-size: 0.78rem;
  color: var(--text3);
  text-align: right;
  margin-top: 12px;
}

/* PC: 3カラム */
@media (min-width: 769px) {
  .games-grid { grid-template-columns: repeat(3, 1fr); gap: 12px; }
}
```

**JavaScript（リアルタイム検索）：**
```javascript
// 1. ゲームデータ配列（オブジェクト形式）
const games = [
  {
    name: 'ito',
    players: '2〜',
    explain: 5,
    play: 5,
    desc: '教室にある一番小さいものを1、一番大きいものを100とすると、34は？'
  },
  {
    name: 'ペチャリブレ',
    players: '3〜',
    explain: 5,
    play: 5,
    desc: '失恋直後の魔法使いVS身体が鋼鉄のユーチューバー　どっちが強い？'
  },
  // ... 以下続く
];

// 2. HTML生成＆検索処理
function renderGames(list) {
  const grid = document.getElementById('games-grid');
  const count = document.getElementById('games-count');
  
  grid.innerHTML = list.map(g => `
    <div class="game-card">
      <div class="game-card-name">${g.name}</div>
      <div class="game-card-meta">
        <span class="game-tag tag-players">👥 ${g.players}</span>
        <span class="game-tag tag-time">⏱ ${g.play}分</span>
      </div>
      <div class="game-card-desc">${g.desc}</div>
    </div>
  `).join('');
  
  count.textContent = `${list.length}件表示`;
}

// 3. 初期表示
renderGames(games);

// 4. リアルタイム検索
document.getElementById('games-search').addEventListener('input', e => {
  const query = e.target.value.toLowerCase();
  const filtered = games.filter(g =>
    g.name.toLowerCase().includes(query) ||
    g.desc.toLowerCase().includes(query) ||
    g.players.toLowerCase().includes(query)
  );
  renderGames(filtered);
});
```

**活用ポイント：**
- `grid-template-columns` を `1fr 1fr` (スマホ2カラム) と `repeat(3, 1fr)` (PC3カラム) で切り替え
- `game-tag` は背景色＆ボーダーで視認性UP
- 検索は配列の `filter()` で `name/desc/players` を部分マッチ検索
- 表示件数を動的表示することでUXが向上

---

## 落ちもの系ゲームUI（アクション・リアルタイム学習用）

**用途：** 落ちてくるアイテムを判別・分類するアクション型学習ゲーム（品詞パニックなど）のUI・システム。リアルタイムスコア・コンボ・レベル・ライフを動的に更新し、ゲーム終了後に学習成果を可視化する。

**主要な画面・要素：**

1. **ゲーム画面（縦向き）**
   - 落下エリア：上から単語が降りてくる領域（アイテムは動的に生成）
   - 操作エリア：下部に分類ボタン（品詞ボタンなど）を配置
   - スコア表示：左上に「スコア」「コンボ数」「レベル」をリアルタイム表示
   - ライフ表示：右上に残りライフ数（❤️ アイコン）
   - フィーバー演出：コンボ10達成時に背景色・エフェクト変更

2. **ゲームオーバー画面**
   - 最終スコア・獲得ハイスコア
   - 進出レベル・コンボ記録
   - ハイスコア記録（称号表示：「文法みならい」→「品詞マスター」まで段階的）
   - 「もう一回」ボタン

3. **成績分析画面**
   - 品詞別の正答率バー（横棒グラフ）
   - まちがえた単語リスト（テーブル：単語・正解・回数）
   - 苦手分析テキスト（「副詞が苦手なので、もう一回チャレンジ！」など）

**実装例（品詞パニック）：**

```html
<!-- ゲーム画面構成 -->
<div class="game-area">
  <!-- スコア・ライフ表示 -->
  <div class="hud">
    <div class="score-block">
      <div>スコア: <span id="score">0</span></div>
      <div>コンボ: <span id="combo">0</span>x</div>
      <div>Lv: <span id="level">1</span></div>
    </div>
    <div class="life-block" id="lifeDisplay">❤️❤️❤️</div>
  </div>

  <!-- 落下エリア -->
  <div class="game-field" id="gameField">
    <!-- 落ちてくるアイテム（動的生成） -->
  </div>

  <!-- 操作エリア（選択ボタン） -->
  <div class="control-panel">
    <button class="btn-hinshi" data-hinshi="noun">名詞</button>
    <button class="btn-hinshi" data-hinshi="verb">動詞</button>
    <button class="btn-hinshi" data-hinshi="adjective">形容詞</button>
    <!-- ... -->
  </div>

  <!-- フィーバー演出用背景 -->
  <div class="fever-effect" id="feverEffect"></div>
</div>

<!-- ゲームオーバー画面 -->
<div class="modal" id="gameOverModal">
  <div class="modal-content game-over">
    <h2>ゲームオーバー！</h2>
    <div class="final-score">
      <div>スコア: <strong id="finalScore">0</strong></div>
      <div>ハイスコア: <strong id="highScore">0</strong></div>
      <div>称号: <span id="badge">文法みならい</span> 🏆</div>
    </div>
    <button onclick="location.reload()">もう一回</button>
  </div>
</div>

<!-- 成績分析画面 -->
<div class="analysis-screen" id="analysisScreen">
  <h3>成績分析</h3>
  <div class="accuracy-bars">
    <div class="accuracy-item">
      <label>名詞</label>
      <div class="bar"><div class="filled" style="width: 85%"></div></div>
      <span>85%</span>
    </div>
    <!-- ... 品詞ごと繰り返し ... -->
  </div>
  <div class="mistake-list">
    <h4>間違えた単語</h4>
    <table>
      <tr><td>単語</td><td>正解</td><td>回数</td></tr>
      <!-- 動的生成 -->
    </table>
  </div>
</div>
```

**CSS（フレームワーク不依存）：**

```css
.game-area {
  position: relative;
  width: 100%;
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
}

.hud {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: rgba(0,0,0,0.3);
  color: white;
  font-weight: bold;
  font-size: 14px;
}

.game-field {
  flex: 1;
  position: relative;
  overflow: hidden;
  border: 2px solid rgba(255,255,255,0.2);
}

/* 落ちてくるアイテム */
.falling-item {
  position: absolute;
  width: 50px;
  height: 50px;
  background: white;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: #333;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  animation: fall linear forwards;
}

.falling-item.highlight {
  background: #ffeb3b;
  animation: pulse 0.5s infinite;
}

@keyframes fall {
  from { transform: translateY(-100px); }
  to { transform: translateY(calc(100vh - 100px)); }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.control-panel {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px;
  background: rgba(0,0,0,0.2);
}

.btn-hinshi {
  padding: 16px;
  border: none;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  background: #4CAF50;
  color: white;
  transition: all 0.1s;
}

.btn-hinshi:active {
  transform: scale(0.95);
  background: #45a049;
}

/* フィーバー演出 */
.fever-effect {
  position: fixed;
  inset: 0;
  pointer-events: none;
  display: none;
  animation: fever-flash 0.6s ease-out;
}

.fever-effect.active {
  display: block;
  background: radial-gradient(circle, rgba(255,215,0,0.4) 0%, transparent 70%);
}

/* 成績分析 */
.accuracy-bars {
  margin: 20px 0;
}

.accuracy-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}

.bar {
  flex: 1;
  height: 20px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
}

.bar .filled {
  height: 100%;
  background: linear-gradient(90deg, #4CAF50, #81C784);
  transition: width 0.3s;
}
```

**JavaScript（リアルタイム更新）：**

```javascript
// ゲーム状態管理
const gameState = {
  score: 0,
  combo: 0,
  level: 1,
  life: 3,
  highScore: localStorage.getItem('hinshiPanicHighScore') || 0,
  correctCount: {},  // 品詞別正答数
  totalCount: {},    // 品詞別総問題数
  mistakeWords: []   // 間違えた単語リスト
};

// リアルタイム更新関数
function updateHUD() {
  document.getElementById('score').textContent = gameState.score;
  document.getElementById('combo').textContent = gameState.combo;
  document.getElementById('level').textContent = gameState.level;
  
  // ライフ表示（❤️の個数）
  const hearts = '❤️'.repeat(gameState.life);
  document.getElementById('lifeDisplay').textContent = hearts;
  
  // コンボ10でフィーバー演出
  if (gameState.combo >= 10) {
    triggerFeverEffect();
  }
}

function triggerFeverEffect() {
  const fever = document.getElementById('feverEffect');
  fever.classList.add('active');
  setTimeout(() => fever.classList.remove('active'), 600);
}

// 成績分析画面を動的生成
function showAnalysis(state) {
  const accuracyHTML = Object.entries(state.correctCount).map(([hinshi, correct]) => {
    const total = state.totalCount[hinshi] || 1;
    const percent = Math.round((correct / total) * 100);
    return `
      <div class="accuracy-item">
        <label>${hinshi}</label>
        <div class="bar"><div class="filled" style="width: ${percent}%"></div></div>
        <span>${percent}%</span>
      </div>
    `;
  }).join('');
  
  document.getElementById('analysisScreen').innerHTML = `
    <h3>成績分析</h3>
    <div class="accuracy-bars">${accuracyHTML}</div>
    <div class="mistake-list">
      <h4>間違えた単語</h4>
      <ul>
        ${state.mistakeWords.map(w => `<li>${w.word} (正解: ${w.correct})</li>`).join('')}
      </ul>
    </div>
  `;
}
```

**活用ポイント：**
- **縦向きレイアウト：** iOS Safari での固定 viewport 指定により、アドレスバーによる高さ変動を防止
- **リアルタイム更新：** 1フレーム毎に `.textContent` を更新（アニメーション・パフォーマンス両立）
- **ローカルストレージ：** try-catch で保護し、システム設定・プライベートモード下での例外に対応
- **アイテムアニメーション：** `animation-duration` を変数化し、レベル上げで速度加速可能
- **正答率バー：** `width: ${percent}%` で CSS を動的生成（チャート機能を追加実装可能）

---

## 作品保存・一覧ダイアログ（複数保存管理）

**用途：** クロスワード・スケルトンなど作品を複数保存して、名前つきで管理・再開する。IndexedDB で永続化。

**HTML例：**
```html
<!-- 保存ボタン -->
<button id="saveWorkBtn" class="save-work-btn">作品として保存</button>
<button id="loadWorkBtn" class="load-work-btn">保存した作品を開く</button>

<!-- 保存ダイアログ -->
<div id="saveWorkModal" class="modal">
  <div class="modal-content work-modal">
    <h3>作品として保存</h3>
    <input id="workTitle" type="text" placeholder="作品の名前を入力…" class="work-title-input">
    <div class="modal-buttons">
      <button onclick="saveWork()">保存</button>
      <button onclick="closeModal('saveWorkModal')">キャンセル</button>
    </div>
  </div>
</div>

<!-- 一覧ダイアログ -->
<div id="loadWorkModal" class="modal">
  <div class="modal-content work-modal">
    <h3>保存した作品</h3>
    <div id="workList" class="work-list"></div>
    <div class="modal-buttons">
      <button onclick="closeModal('loadWorkModal')">閉じる</button>
    </div>
  </div>
</div>
```

**CSS：**
```css
.save-work-btn, .load-work-btn {
  padding: 10px 20px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: background 0.2s;
  margin: 4px;
}

.save-work-btn:hover, .load-work-btn:hover {
  background: #45a049;
}

.modal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 200;
  align-items: center;
  justify-content: center;
}

.modal.open { display: flex; }

.modal-content.work-modal {
  background: white;
  border-radius: 12px;
  padding: 24px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.3);
}

.modal-content.work-modal h3 {
  margin: 0 0 16px 0;
  font-size: 1.1rem;
  color: #333;
}

.work-title-input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.95rem;
  margin-bottom: 16px;
  box-sizing: border-box;
}

.work-title-input:focus {
  outline: none;
  border-color: #4CAF50;
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.1);
}

.work-list {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.work-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid #eee;
  border-radius: 6px;
  margin-bottom: 8px;
  background: #f9f9f9;
  cursor: pointer;
  transition: background 0.2s;
}

.work-item:hover {
  background: #f0f0f0;
}

.work-item-name {
  flex: 1;
  font-weight: 500;
  color: #333;
  word-break: break-all;
}

.work-item-actions {
  display: flex;
  gap: 8px;
  margin-left: 12px;
}

.work-item-btn {
  padding: 6px 12px;
  font-size: 0.8rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.work-item-open {
  background: #4CAF50;
  color: white;
}

.work-item-open:hover {
  background: #45a049;
}

.work-item-delete {
  background: #f44336;
  color: white;
}

.work-item-delete:hover {
  background: #da190b;
}

.modal-buttons {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.modal-buttons button {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: background 0.2s;
}

.modal-buttons button:first-child {
  background: #4CAF50;
  color: white;
}

.modal-buttons button:first-child:hover {
  background: #45a049;
}

.modal-buttons button:last-child {
  background: #e0e0e0;
  color: #333;
}

.modal-buttons button:last-child:hover {
  background: #d0d0d0;
}

/* ダークモード対応 */
@media (prefers-color-scheme: dark) {
  .modal-content.work-modal {
    background: #2a2a2a;
    color: #fff;
  }
  
  .modal-content.work-modal h3 {
    color: #fff;
  }
  
  .work-title-input {
    background: #3a3a3a;
    border-color: #555;
    color: #fff;
  }
  
  .work-item {
    background: #3a3a3a;
    border-color: #555;
  }
  
  .work-item:hover {
    background: #454545;
  }
  
  .work-item-name {
    color: #fff;
  }
  
  .modal-buttons button:last-child {
    background: #555;
    color: #fff;
  }
}
```

**JavaScript（IndexedDB 使用）：**
```javascript
const DB_NAME = 'WorkWorks';
const STORE_NAME = 'works';
let db = null;

// DB 初期化
async function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const objStore = e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      objStore.createIndex('timestamp', 'timestamp', { unique: false });
    };
  });
}

// 作品保存
async function saveWork() {
  const title = document.getElementById('workTitle').value.trim();
  if (!title) {
    alert('名前を入力してください');
    return;
  }

  const workData = {
    title,
    timestamp: Date.now(),
    data: getWorkData() // アプリケーション固有の保存関数
  };

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  
  // 同名の作品がある場合は上書き確認
  const existing = await new Promise((res) => {
    store.getAll().onsuccess = (e) => {
      res(e.target.result.find(w => w.title === title));
    };
  });

  if (existing) {
    if (!confirm(`「${title}」は既に存在します。上書きしますか？`)) return;
    store.put({ ...workData, id: existing.id });
  } else {
    store.add(workData);
  }

  document.getElementById('workTitle').value = '';
  closeModal('saveWorkModal');
  alert('保存しました！');
}

// 作品一覧表示
async function loadWorkList() {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  
  const works = await new Promise((res) => {
    store.getAll().onsuccess = (e) => res(e.target.result);
  });

  // 新しい順にソート
  works.sort((a, b) => b.timestamp - a.timestamp);

  const listEl = document.getElementById('workList');
  if (works.length === 0) {
    listEl.innerHTML = '<p style="color:#999;">保存した作品がありません</p>';
    return;
  }

  listEl.innerHTML = works.map(w => `
    <div class="work-item">
      <div class="work-item-name">${escapeHtml(w.title)}</div>
      <div class="work-item-actions">
        <button class="work-item-btn work-item-open" onclick="openWork(${w.id})">開く</button>
        <button class="work-item-btn work-item-delete" onclick="deleteWork(${w.id})">削除</button>
      </div>
    </div>
  `).join('');
}

// 作品を開く
async function openWork(id) {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const work = await new Promise((res) => {
    tx.objectStore(STORE_NAME).get(id).onsuccess = (e) => res(e.target.result);
  });

  if (work) {
    loadWorkData(work.data); // アプリケーション固有の復元関数
    closeModal('loadWorkModal');
  }
}

// 作品削除
async function deleteWork(id) {
  if (!confirm('この作品を削除しますか？')) return;

  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  
  await loadWorkList();
}

// イベントバインディング
initDB().then(() => {
  document.getElementById('saveWorkBtn').addEventListener('click', () => {
    openModal('saveWorkModal');
    document.getElementById('workTitle').focus();
  });

  document.getElementById('loadWorkBtn').addEventListener('click', () => {
    openModal('loadWorkModal');
    loadWorkList();
  });
});

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
```

**活用ポイント：**
- **IndexedDB：** ローカルストレージ（5MB制限）より容量が大きい（ブラウザ仕様で 20〜50MB+）
- **上書き保存：** 同名作品検出時に確認ダイアログ
- **タイムスタンプ：** 新しい順に並び替え
- **HTML エスケープ：** XSS対策で `escapeHtml()` 使用
- **ダークモード対応：** `@media (prefers-color-scheme: dark)` で自動対応

---

---

## タブ切り替え＋パネルレイアウト（複数モード UI）

**用途：** 2つ以上の異なるモード（表示形式・操作方式）を切り替えて使用する場合。五十音表モード ↔ 文字列入力モード など。各モードで共通設定（ずらし方）を保有。

**設計思想：**
- **タブ：** モード選択ボタン（アクティブ時は濃い背景）
- **パネル：** 各モード固有の操作エリア（タブ押下時のみ表示）
- **共通設定エリア：** ずらし方・ループ設定など、全モード共通の制御を常時表示

**HTML例（文字ずらし君）：**

```html
<header>
  <h1>文字ずらし君 <span class="sub-title">謎解き作問ツール</span></h1>
</header>

<!-- モード切り替えタブ -->
<div class="tabs">
  <button class="tab-btn" aria-pressed="true" onclick="switchMode('table')">
    <span class="no">①</span>五十音表
  </button>
  <button class="tab-btn" onclick="switchMode('text')">
    <span class="no">②</span>文字列入力
  </button>
</div>

<!-- 五十音表モード -->
<div class="mode-panel" id="mode-table" style="display: block;">
  <!-- キャンバス：五十音表・九九マス -->
  <canvas id="canvas" width="400" height="300" style="border: 1px solid #ddd;"></canvas>
  
  <!-- 十字ボタン（上下左右移動） -->
  <div class="control-pad">
    <button onclick="moveChar('up')">↑</button>
    <button onclick="moveChar('left')">←</button>
    <button onclick="moveChar('down')">↓</button>
    <button onclick="moveChar('right')">→</button>
  </div>
  
  <!-- 現在の文字・対応先表示 -->
  <p id="tableResult">あ → き (左1・下1)</p>
</div>

<!-- 文字列入力モード -->
<div class="mode-panel" id="mode-text" style="display: none;">
  <div class="text-input-group">
    <textarea id="inputText" placeholder="ここに日本語を入力…" rows="4"></textarea>
    <button onclick="processText()">ずらしを反映</button>
  </div>
  
  <div id="textResult" style="margin-top: 16px; padding: 12px; background: #f0f0f0; border-radius: 8px;">
    結果がここに表示されます
  </div>
</div>

<!-- 共通設定パネル（全モード共通） -->
<div class="panel">
  <h2>ずらし方を選ぶ</h2>
  
  <!-- ずらし方選択 -->
  <div class="row">
    <label>
      <input type="radio" name="shiftType" value="grid" checked> たて・よこにずらす
    </label>
    <label>
      <input type="radio" name="shiftType" value="sequence"> あいうえお順で送る
    </label>
  </div>
  
  <!-- はしの扱い -->
  <div class="row">
    <label>
      <input type="checkbox" id="loopEdge" checked> はしで回り込む
    </label>
    <small>(チェック外すと、はみ出しで ×表示)</small>
  </div>
  
  <!-- 数値入力（グリッドモード時） -->
  <div class="row" id="gridInputs">
    <label>左右: <input type="number" id="shiftX" value="0" min="-4" max="4" style="width: 60px;"></label>
    <label>上下: <input type="number" id="shiftY" value="0" min="-4" max="4" style="width: 60px;"></label>
  </div>
  
  <!-- 数値入力（シーケンスモード時） -->
  <div class="row" id="sequenceInputs" style="display: none;">
    <label>送る数: <input type="number" id="shiftSeq" value="1" min="-50" max="50" style="width: 80px;"></label>
  </div>
</div>

<!-- 提案機能パネル -->
<div class="panel" id="proposalPanel">
  <h2>さがす（提案機能）</h2>
  <div class="row">
    <input type="text" id="searchWord" placeholder="例：あい" maxlength="20" style="flex: 1;">
    <button onclick="searchProposals()">検索</button>
  </div>
  
  <div id="proposalList" style="margin-top: 12px; max-height: 300px; overflow-y: auto;">
    <!-- 検索結果がここに動的生成される -->
  </div>
</div>
```

**CSS（スタイル例）：**

```css
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.tab-btn {
  flex: 1;
  background: #e7edf4;
  border: none;
  border-radius: 10px 10px 0 0;
  padding: 12px 8px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.tab-btn[aria-pressed="true"] {
  background: #2f6fb2;
  color: white;
  font-weight: 700;
}

.tab-btn .no {
  display: inline-block;
  width: 21px;
  height: 21px;
  line-height: 21px;
  border-radius: 50%;
  background: rgba(0,0,0,.12);
  font-size: 12px;
  text-align: center;
}

.tab-btn[aria-pressed="true"] .no {
  background: rgba(255,255,255,.28);
}

.mode-panel {
  background: white;
  border: 1px solid #d9e0e8;
  border-radius: 0 0 12px 12px;
  padding: 12px;
  margin-bottom: 10px;
}

.control-pad {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  margin: 12px 0;
  width: fit-content;
}

.control-pad button {
  width: 44px;
  height: 44px;
  font-size: 18px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.text-input-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

textarea {
  font-family: monospace;
  padding: 12px;
  border: 1px solid #d9e0e8;
  border-radius: 8px;
  font-size: 14px;
  resize: vertical;
}
```

**JavaScript（モード切り替え）：**

```javascript
// モード切り替え処理
function switchMode(mode) {
  // タブの状態更新
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', false);
  });
  event.target.closest('.tab-btn').setAttribute('aria-pressed', true);
  
  // パネルの表示・非表示
  document.querySelectorAll('.mode-panel').forEach(panel => {
    panel.style.display = 'none';
  });
  document.getElementById(`mode-${mode}`).style.display = 'block';
  
  // ずらし方の入力欄を切り替え
  const gridInputs = document.getElementById('gridInputs');
  const sequenceInputs = document.getElementById('sequenceInputs');
  if (mode === 'table') {
    document.querySelector('input[name="shiftType"][value="grid"]').checked = true;
    gridInputs.style.display = 'flex';
    sequenceInputs.style.display = 'none';
  }
}

// ずらし方の選択変更時
document.querySelectorAll('input[name="shiftType"]').forEach(input => {
  input.addEventListener('change', (e) => {
    const gridInputs = document.getElementById('gridInputs');
    const sequenceInputs = document.getElementById('sequenceInputs');
    if (e.target.value === 'grid') {
      gridInputs.style.display = 'flex';
      sequenceInputs.style.display = 'none';
    } else {
      gridInputs.style.display = 'none';
      sequenceInputs.style.display = 'flex';
    }
  });
});

// テキスト入力モード用処理
function processText() {
  const text = document.getElementById('inputText').value;
  const shiftType = document.querySelector('input[name="shiftType"]:checked').value;
  const loopEdge = document.getElementById('loopEdge').checked;
  
  // ずらし方パラメータを取得
  let shiftParams;
  if (shiftType === 'grid') {
    shiftParams = {
      x: parseInt(document.getElementById('shiftX').value) || 0,
      y: parseInt(document.getElementById('shiftY').value) || 0
    };
  } else {
    shiftParams = {
      seq: parseInt(document.getElementById('shiftSeq').value) || 0
    };
  }
  
  // 各文字をずらす処理（実装は省略）
  const result = shiftText(text, shiftType, shiftParams, loopEdge);
  document.getElementById('textResult').textContent = result;
}

// 提案機能
async function searchProposals() {
  const word = document.getElementById('searchWord').value.trim();
  if (!word) return;
  
  const shiftType = document.querySelector('input[name="shiftType"]:checked').value;
  const loopEdge = document.getElementById('loopEdge').checked;
  
  // 辞書データを検索（IPADIC 1万語）
  const proposals = await findShiftPatterns(word, shiftType, loopEdge);
  
  const listEl = document.getElementById('proposalList');
  listEl.innerHTML = proposals.map(p => `
    <div style="padding: 8px; border-bottom: 1px solid #eee;">
      <strong>${p.result}</strong> 
      <span style="color: #999; font-size: 12px;">
        ${shiftType === 'grid' 
          ? `(左${p.dx} 下${p.dy})`
          : `(${p.steps}送る)`
        }
      </span>
      <br>
      <small style="color: #666;">使用頻度: ${p.frequency}位</small>
    </div>
  `).join('');
}
```

**活用ポイント：**
- **タブ `aria-pressed` 属性：** スクリーンリーダー対応（アクセシビリティ）
- **共通設定を常時表示：** モード選択後も設定値を即座に反映可能
- **ずらし方の入力欄を動的に切り替え：** グリッドモード（上下左右数値）とシーケンスモード（送る数）で異なる操作体系
- **提案機能の辞書検索：** 外部通信ゼロ（データはクライアント側に埋込）
- **レスポンシブ対応：** タブが縦積みになる場合、`flex-direction: column` で対応

**プロジェクト実装例：** `/Workspace/projects/moji-zurashi/index.html` セッション145

---

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- コーディング規約 → [rules.md](./rules.md)
