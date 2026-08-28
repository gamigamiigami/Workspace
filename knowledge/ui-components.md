# 再利用可能UIコンポーネント集

最終更新：2026-08-27

コピペで使えるUI部品をまとめる。スタイルはインラインまたは `<style>` 内に記載。

---

## NG制約エラー表示（3層化）

**用途：** ユーザーが手で座席配置を編集したときに、NG設定（隣席NG、ペアNGなど）に違反した場合、その違反を「層別」に視覚化して即座に修正を促す。

**設計理念：**
- **層1（ポップアップ）：即座の警告** — 違反を犯したその場で「🚫 男2 と 男1 がとなり同士です（隣席NG）：おしゃべり」と理由メモ付きで知らせる
- **層2（警告バー）：画面上部に集約** — 赤い警告バーに違反件数を表示（「❌ NG違反が3件あります」）。直すと自動で消える
- **層3（視覚マーク）：該当席をマーク** — 違反している座席を赤く囲んで🚫マークで視認性向上

**実装（席替えツール `projects/seat-assignment/index.html` の実物）：**

HTML — 警告バーは操作バーの中に置き、ふだんは空にしておく。
```html
<div class="sticky-bar no-print">
  <div class="row"><button id="btnRunShuffle" class="primary">🎲 席替え実行</button></div>
  <div id="prevCheck" class="prev-check"></div>
  <div id="hardAlert" class="hard-alert"></div>
</div>
```

CSS — 警告バーと、違反した席の強調。
```css
.hard-alert {
  display: none;                 /* 違反が無いあいだは出さない */
  background: #fdecea;
  border: 2px solid #c0392b;
  color: #c0392b;
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 8px;
  font-size: 14px;
}
.hard-alert ul { margin: 4px 0 4px 18px; }
/* 層3：違反している席（!important で他の色づけに勝たせる） */
.seat.ng-violation .desk {
  background: #fdecea !important;
  border-color: #c0392b !important;
  box-shadow: 0 0 0 3px rgba(192,57,43,0.35);
}
```

JS — 違反を1か所で判定し、3層すべてがその結果を使う。
```javascript
// 判定はここ1か所だけ。戻り値に ng:true を付けておくと座席描画で拾える
function checkNgViolations(cr, assignment) {
  const violations = [];
  const seen = new Set();
  for (const key of Object.keys(assignment)) {
    const sid = assignment[key];
    if (!sid) continue;
    const meta = cr.deskMeta[key];
    if (meta && (meta.ngStudentIds || []).includes(sid)) {
      violations.push({ level: 'error', ng: true, seats: [key],
        text: '🚫 ' + nameOf(sid) + ' は ' + seatLabel(key) + ' に座れません（着席NGの席です）' });
    }
    for (const nKey of getNeighbors(cr, key)) {
      const nid = assignment[nKey];
      if (!nid || !isNGPair(cr, sid, nid)) continue;
      const pk = pairKey(sid, nid);
      if (seen.has(pk)) continue;   // 同じペアを2回出さない
      seen.add(pk);
      const p = cr.ngPairs.find(x => (x.a===sid&&x.b===nid)||(x.a===nid&&x.b===sid));
      violations.push({ level: 'error', ng: true, seats: [key, nKey],
        text: '🚫 ' + nameOf(sid) + ' と ' + nameOf(nid) + ' がとなり同士です（隣席NG）' +
              (p && p.reason ? '：' + p.reason : '') });
    }
  }
  return violations;
}

// 層2：警告バー（違反が無ければ空にして display:none にもどす）
function renderHardAlert(cr) {
  const el = document.getElementById('hardAlert');
  const v = cr.currentSeats ? checkNgViolations(cr, cr.currentSeats) : [];
  if (!v.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<strong>🚫 NG設定にひっかかっています（' + v.length + '件）</strong><ul>' +
    v.map(w => '<li>' + escapeHtml(w.text.replace(/^🚫 /, '')) + '</li>').join('') + '</ul>';
}

// 層1：手で動かした「その席」が原因のものだけ、その場で知らせる
const moved = [seatA, seatB];
const bad = checkNgViolations(cr, cr.currentSeats)
  .filter(w => (w.seats || []).some(s => moved.includes(s)));
if (bad.length) alert('🚫 NG設定にひっかかりました\n\n' + bad.map(w => '・' + w.text).join('\n'));

// 層3：座席描画で ng:true の席にクラスとアイコンを付ける
const ngSeats = new Set();
for (const w of warnings) if (w.ng) for (const k of (w.seats || [])) ngSeats.add(k);
if (ngSeats.has(key)) { cell.classList.add('ng-violation'); icons += '🚫'; }
```

**ポイント：**
- 判定関数は1つだけにして、3層すべてが同じ結果を使う（表示のズレが起きない）
- ポップアップは「いま動かした席が原因のものだけ」に絞る（関係ない既存の違反で毎回出さない）
- 隣席NGは同じペアを2回数えないよう `pairKey` で重複を除く
- 警告バーは違反が消えたら `innerHTML=''` にもどす（消し忘れを防ぐ）
- 席の強調は `!important`。男女の背景色・班のわく色より前に出す必要があるため

**ポイント：**
- **段階的な情報提示** — ポップアップ（即座）→ 警告バー（継続表示）→ 席マーク（視覚的位置情報）で、ユーザーが「何が問題か」「どこに問題があるか」を多角的に理解可能
- **自動消去** — 違反を修正したら層1～3が自動で消える。ユーザーの修正がリアルタイムで「成功」に変わるまで表示
- **理由メモ** — 各NG違反に「なぜダメなのか」（例：「隣席NG」「ペアNG」）を明記。教育現場で「なぜ入れかえてくれないのか」という疑問を事前に解消

**応用例：**
- 入場制限（定員超）の警告
- データ入力エラー（必須項目未入力）の警告
- スケジュール競合（ダブルブッキング）の警告

---

## 操作バー（画面上部貼りつき・スクロール不要）

**用途：** 長いコンテンツ（座席表など）を見ながら、スクロール不要で操作ボタンにアクセスする必要があるUI。iPad や タッチデバイスでの UX 向上。

```html
<!-- 操作バー：画面上部に固定 -->
<div class="action-bar">
  <div class="comparison-info">
    前回とくらべて ✅席が同じ 0人 ✅となりが同じ 0組 ❌前後が同じ 1組 ✅斜めが同じ 0組
  </div>
  <div class="button-group">
    <button onclick="executeSeating()">🎲席替え実行</button>
    <button onclick="swapSeats()">🔀入れかえる</button>
    <button onclick="fixSeat()">📌今回だけ固定</button>
    <button onclick="reverseMaleFemale()">♀♂逆にする</button>
  </div>
</div>

<!-- メインコンテンツ：スクロール可能 -->
<div class="seating-container">
  <!-- 座席表をここに配置 -->
</div>
```

```css
.action-bar {
  position: sticky;
  top: 0;
  background: white;
  border-bottom: 2px solid #ddd;
  padding: 12px;
  z-index: 50;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.comparison-info {
  font-size: 14px;
  margin-bottom: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}
.button-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.button-group button {
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.button-group button:active {
  background: #e8e8e8;
}

/* iPad縦持ち対応 */
@media (max-width: 600px) {
  .action-bar { padding: 8px; }
  .button-group { gap: 4px; }
  .button-group button { padding: 6px 8px; font-size: 12px; }
}
```

**ポイント：**
- `position: sticky; top: 0;` で「スクロール時も画面上部に貼りつく」を実現
- `z-index: 50` で、下部のコンテンツより上に浮かぶ
- 比較情報（「前回とくらべて」）をバー内に常時表示することで、ユーザーが「今回の質」を意識
- iPad での 2人入れかえなど細かいタップ操作も、スクロール不要で実施可能

**実装例（座席配置ツール）：**
- セッション107で実装完了。30名の座席表を見ながら、バーの操作ボタンにアクセスできるようになった。
- 結果として「初心者がスクロール位置で迷わない」「操作→座席確認のループが高速化」

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

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- コーディング規約 → [rules.md](./rules.md)
