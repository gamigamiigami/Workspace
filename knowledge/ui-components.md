# 再利用可能UIコンポーネント集

最終更新：2026-05-23

コピペで使えるUI部品をまとめる。スタイルはインラインまたは `<style>` 内に記載。

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

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- コーディング規約 → [rules.md](./rules.md)
