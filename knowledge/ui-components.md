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

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- コーディング規約 → [rules.md](./rules.md)
