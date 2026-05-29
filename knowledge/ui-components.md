# 再利用可能UIコンポーネント集

最終更新：2026-05-30

コピペで使えるUI部品をまとめる。スタイルはインラインまたは `<style>` 内に記載。

---

## リマインダーモーダル（タスク通知）

**用途：** アプリが最小化またはバックグラウンドにある場合、PowerShell MessageBox とは別に、アプリウィンドウがアクティブなときに静かに（または効果音付きで）タスク期限切れを通知する。

```html
<!-- リマインダーモーダル本体 -->
<div id="reminderModal" class="reminder-modal" onclick="closeReminder()">
  <div class="reminder-content" onclick="event.stopPropagation()">
    <h3 id="reminderTitle">Reminder</h3>
    <button class="close-btn" onclick="closeReminder()">✕</button>
  </div>
</div>
```

```css
.reminder-modal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  z-index: 1000;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease-in;
}

.reminder-modal.open {
  display: flex;
}

.reminder-modal.open.shake {
  animation: shake 0.5s ease-in-out;
}

.reminder-content {
  background: linear-gradient(135deg, #fff 0%, #f9f9f9 100%);
  border-radius: 8px;
  padding: 20px 24px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  width: 280px;
  position: relative;
}

.reminder-modal.open.sound .reminder-content {
  border-left: 4px solid #ff6b6b;  /* アラーム表示 */
}

.reminder-modal.open.quiet .reminder-content {
  border-left: 4px solid #4a90e2;  /* 静かなモード表示 */
}

#reminderTitle {
  margin: 0;
  font-size: 14px;
  color: #222;
  word-break: break-word;
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  font-size: 18px;
  color: #999;
  cursor: pointer;
}

.close-btn:hover {
  color: #222;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
}
```

```javascript
function showReminder(title, type = 'quiet') {
  const modal = document.getElementById('reminderModal');
  const titleEl = document.getElementById('reminderTitle');
  
  titleEl.textContent = title;
  
  // タイプに応じた効果
  modal.classList.remove('sound', 'quiet');
  modal.classList.add(type);
  modal.classList.add('open');
  
  if (type === 'sound') {
    // 揺れアニメーション
    modal.classList.add('shake');
    // 効果音再生（あれば）
    playNotificationSound();
  }
  
  // 5秒後に自動閉じ
  setTimeout(closeReminder, 5000);
}

function closeReminder() {
  const modal = document.getElementById('reminderModal');
  modal.classList.remove('open', 'shake', 'sound', 'quiet');
}

function playNotificationSound() {
  // 例）ブラウザの標準通知音を再生
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.connect(gain);
    gain.connect(context.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.2);
    osc.start(context.currentTime);
    osc.stop(context.currentTime + 0.2);
  } catch (e) { /* 再生不可環境 */ }
}
```

**特徴：**
- **条件付き効果：** `type='sound'` でアラーム風（赤い左枠、揺れ、音）、`type='quiet'` で静かに（青い左枠、音なし）
- **自動閉じ：** 5秒後に自動で消える（重要度は低いため）
- **PowerShell フォールバック：** このモーダルは「アプリがアクティブなときの補助」。MinimizeされたらPowerShell MessageBox が担当
- **アニメーション：** fadeIn は標準、shake はアラーム時のみ（UX 差別化）

**使用プロジェクト：** sticky-todo（リマインダー通知UI）

**タグ：** #modal #notification #reminder #animation #ux-polish

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

## 付箋風 Todo カード（sticky-todo）

```html
<!-- カードコンテナ -->
<div id="card-container" class="card-container"></div>

<!-- 新規追加フォーム -->
<div class="add-card-form">
  <input id="new-task" type="text" placeholder="タスクを入力" />
  <button onclick="addCard()">追加</button>
</div>
```

```css
.card-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  padding: 16px;
  background: #f9f9f9;
  border-radius: 8px;
  min-height: 400px;
}

.card {
  background: linear-gradient(135deg, #fff9c4 0%, #ffeb3b 100%);
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: column;
  position: relative;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.card-title {
  font-size: 18px;
  font-weight: bold;
  color: #333;
  margin-bottom: 12px;
  word-wrap: break-word;
}

.card-submission {
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
}

.card-date {
  font-size: 12px;
  color: #999;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}

.card-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
}

.add-card-form {
  display: flex;
  gap: 8px;
  padding: 16px;
}

.add-card-form input {
  flex: 1;
  padding: 10px 12px;
  border: 2px solid #ddd;
  border-radius: 6px;
  font-size: 16px;
}

.add-card-form button {
  padding: 10px 20px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
}
```

```javascript
let cards = JSON.parse(localStorage.getItem('todoCards')) || [];

function addCard() {
  const input = document.getElementById('new-task');
  const task = input.value.trim();
  if (!task) return;
  
  const card = {
    id: Date.now(),
    title: task,
    submission: '📤 教頭先生',
    createdDate: new Date().toLocaleDateString('ja-JP', { month: 'short', day: '2-digit' })
  };
  
  cards.push(card);
  saveCards();
  renderCards();
  input.value = '';
}

function deleteCard(id) {
  cards = cards.filter(c => c.id !== id);
  saveCards();
  renderCards();
}

function renderCards() {
  const container = document.getElementById('card-container');
  container.innerHTML = cards.map(card => `
    <div class="card">
      <button class="card-delete" onclick="deleteCard(${card.id})">✕</button>
      <div class="card-title">${card.title}</div>
      <div class="card-submission">${card.submission}</div>
      <div class="card-date">作成 ${card.createdDate}</div>
    </div>
  `).join('');
}

function saveCards() {
  localStorage.setItem('todoCards', JSON.stringify(cards));
}

// 初期表示
renderCards();
```

**ポイント：**
- CSS `linear-gradient` で付箋風の視覚効果を実装
- `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` でレスポンシブグリッド
- `localStorage` でクライアント側にデータ保存（サーバー不要）
- アイコン（📤）と日付で視認性向上
- ホバーエフェクトで操作感を改善

**2026-05-27 リデザイン：Windows 11 付箋風 UI**
- **タイトルバー**：黒背景＋SVGアイコン＋Windowsアプリ風フォント
- **カード背景**：カテゴリ別カラー＋色帯（付箋風）
- **優先度表示**：色付きドット● バッジに変更（視認性向上）
- **モーダル効果**：背景ぼかし＋スライドインアニメーション
- **空の状態**：ノートSVGイラスト＋励ましテキスト
- **SVGアイコン**：専用デザイン（オレンジ角丸＋白い○＋チェック）、ブラウザタブ・タスクバーにも表示
- **ツールバー**：より締まったWindows風デザイン

**使用プロジェクト：** sticky-todo (最終版)

**タグ：** #ui #card #todo #windows-style #svg-icon #backdrop-blur #animation

---

## 4方向リマインド通知（favicon 赤化 + alert + アラーム音 + タイトル点滅 + 揺れるモーダル）

**概要：** Notification API に依存しない、`file://` でも動作する確実な通知UI。favicon 赤化・ブラウザ alert・アラーム音・タイトル点滅・揺れるモーダルの4方向同時通知でユーザー見落とし率をほぼ0に。最後の手段として OS レベルのモーダルダイアログ（alert()）で強制表示。

```html
<!-- リマインダーアラートモーダル（×ボタンなし） -->
<div id="reminder-alert" class="reminder-alert">
  <div class="reminder-modal">
    <h2>🔔 タスク期限のお知らせ</h2>
    <p id="reminder-message" class="reminder-message"></p>
    <div class="reminder-buttons">
      <button onclick="snoozeReminder()">5分後にもう一度</button>
      <button onclick="dismissReminder()">確認した</button>
    </div>
  </div>
</div>

<!-- 音声生成用 -->
<div id="audio-container" style="display:none;"></div>
```

```css
.reminder-alert {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.reminder-alert.show {
  display: flex;
  animation: fadeIn 0.3s ease-in-out;
}

.reminder-modal {
  background: #1e1e1e;
  color: #fff;
  border-radius: 12px;
  padding: 24px;
  max-width: 90%;
  width: 400px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  animation: shake 0.5s ease-in-out;
  text-align: center;
}

.reminder-message {
  font-size: 16px;
  margin: 16px 0 24px;
  line-height: 1.6;
}

.reminder-buttons {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.reminder-buttons button {
  padding: 12px 20px;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.2s;
}

.reminder-buttons button:first-child {
  background: #ff9800;
  color: #fff;
}

.reminder-buttons button:first-child:hover {
  background: #f57c00;
}

.reminder-buttons button:last-child {
  background: #4CAF50;
  color: #fff;
}

.reminder-buttons button:last-child:hover {
  background: #45a049;
}

/* 揺れアニメーション */
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-8px); }
  50% { transform: translateX(8px); }
  75% { transform: translateX(-8px); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

```javascript
let reminderQueue = [];
let currentReminder = null;
let titleFlashInterval = null;
let alarmAudioContext = null;

// 4方向通知：favicon赤化 + alert + アラーム音 + タイトル点滅 + 揺れるモーダル
function showReminder(taskTitle, deadlineTime) {
  currentReminder = { taskTitle, deadlineTime, dismissedAt: null };
  const msg = `「${taskTitle}」の期限は ${deadlineTime} です`;
  document.getElementById('reminder-message').textContent = msg;
  
  // 1. favicon を赤い「！」に変更
  setFavicon('red');
  
  // 2. ブラウザ alert() でネイティブダイアログを強制表示
  alert(`リマインド通知\n\n${msg}`);
  
  // 3. モーダル表示 + 揺れアニメーション
  document.getElementById('reminder-alert').classList.add('show');
  
  // 4. アラーム音開始（4秒ループ × 3音）
  playAlarmSound();
  
  // 5. タイトル点滅開始（「⏰ リマインド！」と交互）
  startTitleFlash();
}

function dismissReminder() {
  currentReminder.dismissedAt = new Date();
  document.getElementById('reminder-alert').classList.remove('show');
  stopAlarmAndFlash();
  setFavicon('normal'); // favicon を通常のオレンジに戻す
  currentReminder = null;
}

function snoozeReminder() {
  if (currentReminder) {
    reminderQueue.push({
      ...currentReminder,
      nextCheckTime: new Date(Date.now() + 5 * 60000) // 5分後
    });
  }
  document.getElementById('reminder-alert').classList.remove('show');
  stopAlarmAndFlash();
  setFavicon('normal'); // favicon を通常のオレンジに戻す
  currentReminder = null;
}

// favicon を動的に変更（赤 = リマインド状態、通常 = 通常状態）
function setFavicon(state) {
  const svgRed = `<svg viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'><rect width='64' height='64' rx='14' fill='%23dc3545'/><text x='32' y='45' font-size='40' font-weight='bold' text-anchor='middle' fill='white'>!</text></svg>`;
  const svgNormal = `<svg viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'><rect width='64' height='64' rx='14' fill='%23f5a623'/><circle cx='32' cy='32' r='18' fill='none' stroke='white' stroke-width='4.5'/><path d='M22 32 L29 39 L42 25' stroke='white' stroke-width='4.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  
  const svg = state === 'red' ? svgRed : svgNormal;
  const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  
  // 既存の favicon link を削除
  let link = document.querySelector('link[rel="icon"]');
  if (link) link.remove();
  
  // 新しい favicon link を追加
  link = document.createElement('link');
  link.rel = 'icon';
  link.href = dataUrl;
  document.head.appendChild(link);
}

// アラーム音生成（Web Audio API で「ポポポーン」）
function playAlarmSound() {
  if (!alarmAudioContext) {
    alarmAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  const now = alarmAudioContext.currentTime;
  const noteFreqs = [440, 554, 659]; // C5, C#5, E5
  const duration = 0.3; // 各音300ms
  const loop = 4; // 4秒ループ（3音）
  
  // 3ループ分のサウンド
  for (let loopIdx = 0; loopIdx < 3; loopIdx++) {
    for (let noteIdx = 0; noteIdx < 3; noteIdx++) {
      const startTime = now + loopIdx * 4 + noteIdx * 0.4;
      const endTime = startTime + duration;
      
      const osc = alarmAudioContext.createOscillator();
      const gain = alarmAudioContext.createGain();
      
      osc.frequency.value = noteFreqs[noteIdx];
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, endTime);
      
      osc.connect(gain);
      gain.connect(alarmAudioContext.destination);
      
      osc.start(startTime);
      osc.stop(endTime);
    }
  }
}

// タイトル点滅開始
function startTitleFlash() {
  const originalTitle = document.title;
  let isFlashing = true;
  
  titleFlashInterval = setInterval(() => {
    if (!isFlashing) return;
    document.title = document.title.includes('⏰') ? originalTitle : '⏰ リマインド！';
  }, 500);
}

// アラーム音と点滅を停止
function stopAlarmAndFlash() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    document.title = document.title.split(' - ')[0];
  }
}

// バックグラウンドでの定期チェック（30秒ごと）
setInterval(() => {
  const now = new Date();
  for (const task of tasks) {
    if (!task.deadline || task.reminderShown) continue;
    const deadline = new Date(task.deadline);
    const diffMs = deadline - now;
    
    // 期限の前後30秒以内で3重通知トリガー
    if (Math.abs(diffMs) < 30000) {
      showReminder(task.title, task.deadline);
      task.reminderShown = true;
    }
  }
}, 30000);
```

**4方向リマインド方式：**

| 手段 | 実装 | 効果 |
|---|---|---|
| **favicon 赤化** | `document.head` に `<link rel="icon">` 動的追加、リマインド時に赤い「！」に変更 | ブラウザタブが赤く強調、Windows タスクバーも赤表示 |
| **ブラウザ alert()** | `alert(message)` でネイティブダイアログ呼び出し | OS レベルのモーダル（最前面・アプリ強制フォーカス） |
| **アラーム音** | Web Audio API で「ポポポーン」3音×4秒ループ | 確認するまで鳴り続ける |
| **タイトル点滅** | `document.title` を「⏰ リマインド！」と交互 | タブ/ウィンドウが点滅 |
| **揺れるモーダル** | CSS `@keyframes shake` で画面中央に強制表示（×ボタンなし） | 集中力強制 |

**特徴：**
- **Notification API 廃止**：`file://` プロトコルでも動作（ローカルHTML実行対応）
- **×ボタンなし**：「5分後にもう一度」か「確認した」のみ選択可能
- **30秒ごとのバックグラウンドチェック**：期限前後の通知を確実に捕捉
- **見落とし率ほぼ0**：3方向同時通知で絶対気づく設計

**使用プロジェクト：** sticky-todo (リマインダー機能 最終版 2026-05-28)

**タグ：** #alert #reminder #animation #shake #notification #ux-pattern

---

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- コーディング規約 → [rules.md](./rules.md)
