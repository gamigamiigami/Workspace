/* =====================================================================
   ポケット秘書 — アプリ本体

   ・データはサーバーに置く（スマホとパソコンで同じものが見える）
   ・電波が無いときは、この端末に覚えておいて、つながったらまとめて送る
   ・入力中は画面を描きなおさない（日本語入力の変換がとぎれるため）
   ===================================================================== */

import {
  todayStr, addDays, addMonths, addYears, mondayOf, weekdayOf, diffDays,
  fmtDay, fmtFull, isYmd, isHm, splitYmd, pad2, WEEKDAY, daysInMonth
} from './shared-date.js';
import {
  blankEvent, normalizeEvent, blankTask, normalizeTask,
  defaultSettings, normalizeSettings, eventLabel, eventStartTime, moneyOf, newId
} from './shared-model.js';

/* =====================================================================
   1. 保存しておく場所（この端末の中）
   ===================================================================== */

const LS_TOKEN = 'ph:token';
const LS_CACHE = 'ph:cache';
const LS_QUEUE = 'ph:queue';

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 容量オーバー等は無視 */ }
}
function lsDel(key) { try { localStorage.removeItem(key); } catch { /* 無視 */ } }

/* =====================================================================
   2. いまの状態
   ===================================================================== */

const state = {
  token: lsGet(LS_TOKEN, ''),
  tab: 'schedule',            // schedule / task / notify
  scope: 'day',               // day / week / month / year
  cursor: todayStr(),
  taskFilter: 'open',         // open / today / done
  online: navigator.onLine,
  loading: false
};

let data = {
  events: [], tasks: [], settings: defaultSettings(), ext: [],
  vapidPublicKey: '', icsUrl: '', devices: [], calendarsLast: null
};

let editingEventId = null;
let editingTaskId = null;

/* =====================================================================
   3. サーバーとのやりとり
   ----------------------------------------------------------------
   つながらないときは、送るはずだった内容を並べて覚えておき、
   つながったときに古いものから順に送り直す。
   ===================================================================== */

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 401) { logout(true); throw new Error('ログインしてください'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('通信に失敗しました（' + res.status + '）'));
  return json;
}

/** 書きこみ。つながらなければ、あとで送るために取っておく */
async function apiWrite(method, path, body) {
  try {
    const r = await api(method, path, body);
    setOnline(true);
    return r;
  } catch (e) {
    if (isNetworkError(e)) {
      const queue = lsGet(LS_QUEUE, []);
      queue.push({ method, path, body, at: Date.now() });
      lsSet(LS_QUEUE, queue);
      setOnline(false);
      return { queued: true };
    }
    throw e;
  }
}
function isNetworkError(e) {
  return e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(String(e && e.message));
}

/** ためていた書きこみを、古い順に送る */
async function flushQueue() {
  let queue = lsGet(LS_QUEUE, []);
  if (!queue.length) return 0;
  let done = 0;
  while (queue.length) {
    const item = queue[0];
    try {
      await api(item.method, item.path, item.body);
      queue.shift();
      lsSet(LS_QUEUE, queue);
      done++;
    } catch (e) {
      if (isNetworkError(e)) break;          // まだつながらない → 次の機会に
      queue.shift();                         // 内容が悪くて通らないものは捨てる（詰まり続けないため）
      lsSet(LS_QUEUE, queue);
    }
  }
  if (done) showToast(done + '件、サーバーに送りました');
  return done;
}

/* つながっているかどうかを1か所で持ち、見た目も必ずここで合わせる。
   「変わったときだけ書きかえる」作りにすると、
   はじめからつながっていない状態で起動したときに帯が出ない。 */
function setOnline(v) {
  state.online = v;
  const bar = document.getElementById('net-bar');
  if (bar) bar.hidden = v;
}

/* --- 起動時にまとめて読む --- */
async function loadAll(showSpinner) {
  if (showSpinner) document.getElementById('head-sub').textContent = '読み込み中…';
  try {
    await flushQueue();
    const r = await api('GET', '/api/bootstrap');
    data = {
      events: (r.events || []).map(normalizeEvent),
      tasks: (r.tasks || []).map(normalizeTask),
      settings: normalizeSettings(r.settings),
      ext: r.ext || [],
      vapidPublicKey: r.vapidPublicKey || '',
      icsUrl: r.icsUrl || '',
      devices: r.devices || [],
      calendarsLast: r.calendarsLast || null
    };
    lsSet(LS_CACHE, data);
    setOnline(true);
  } catch (e) {
    if (isNetworkError(e)) {
      setOnline(false);
      const cached = lsGet(LS_CACHE, null);
      if (cached) data = { ...data, ...cached };
    } else if (String(e.message).includes('ログイン')) {
      return;
    } else {
      showToast(e.message);
    }
  }
  document.getElementById('head-sub').textContent = '予定とやることを、ポケットの中に';
  render();
}

/* =====================================================================
   4. ログイン
   ===================================================================== */

async function doLogin() {
  const pass = document.getElementById('f-pass').value;
  const msg = document.getElementById('login-msg');
  msg.hidden = true;
  if (!pass) { msg.textContent = '合言葉を入れてください'; msg.hidden = false; return; }
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = '確認しています…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'ログインできませんでした');
    state.token = json.token;
    lsSet(LS_TOKEN, state.token);
    document.getElementById('f-pass').value = '';
    showScreen('app');
    await loadAll(true);
    await registerServiceWorker();
  } catch (e) {
    msg.textContent = isNetworkError(e) ? 'インターネットにつながっていないようです' : e.message;
    msg.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'はいる';
  }
}

function logout(silent) {
  state.token = '';
  lsDel(LS_TOKEN); lsDel(LS_CACHE); lsDel(LS_QUEUE);
  closeAllSheets();
  showScreen('login');
  if (!silent) showToast('ログアウトしました');
}

function showScreen(which) {
  document.getElementById('screen-login').hidden = (which !== 'login');
  document.getElementById('screen-app').hidden = (which !== 'app');
}

/* =====================================================================
   5. 予定・タスクの取り出し
   ===================================================================== */

function sortedEvents() {
  return data.events.slice().sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1)
      : ((eventStartTime(a) || '99:99') < (eventStartTime(b) || '99:99') ? -1 : 1));
}
function eventsOn(dateStr) { return sortedEvents().filter(e => e.date === dateStr); }
function extOn(dateStr) {
  return data.ext.filter(e => e.date === dateStr)
    .sort((a, b) => (a.startTime || '99:99') < (b.startTime || '99:99') ? -1 : 1);
}
function tasksOn(dateStr) { return data.tasks.filter(t => !t.done && t.due === dateStr); }

/** その日に付く印（週・月ビューの両方から呼ぶ） */
function marksOn(dateStr) {
  const out = [];
  for (const e of sortedEvents()) {
    if (e.date === dateStr) out.push({ type: 'sem', ev: e });
    if (e.stay.place && e.stay.date === dateStr && e.stay.date !== e.date) out.push({ type: 'stay', ev: e });
  }
  for (const x of extOn(dateStr)) out.push({ type: 'ext', ev: x });
  for (const t of tasksOn(dateStr)) out.push({ type: 'task', ev: t });
  return out;
}
function nextEventFrom(dateStr) {
  return sortedEvents().find(e => e.date >= dateStr) || null;
}
function moneyOfRange(fromStr, toStr) {
  let income = 0, expense = 0, count = 0;
  for (const e of sortedEvents()) {
    if (e.date < fromStr || e.date > toStr) continue;
    count++;
    const m = moneyOf(e);
    income += m.income; expense += m.expense;
  }
  return { income, expense, net: income - expense, count };
}

/* =====================================================================
   6. 画面に出すための小道具
   ===================================================================== */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function yen(n) { return Number(n || 0).toLocaleString('ja-JP') + '円'; }
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
function has(s) { return typeof s === 'string' && s.trim() !== ''; }

function showToast(message, duration) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), duration || 2400);
}

function askConfirm(title, text, yesLabel, onYes) {
  const modal = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-text').textContent = text;
  const yes = document.getElementById('modal-yes');
  yes.textContent = yesLabel;
  const close = () => modal.classList.remove('open');
  const fresh = yes.cloneNode(true);                     // 前回の押した内容を残さない
  yes.parentNode.replaceChild(fresh, yes);
  fresh.addEventListener('click', () => { close(); onYes(); });
  document.getElementById('modal-no').onclick = close;
  modal.onclick = ev => { if (ev.target === modal) close(); };
  modal.classList.add('open');
}

/* =====================================================================
   7. 描画（render を入口にして、そこから各画面へ振り分ける）
   ===================================================================== */

function render() {
  // 下のナビ
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  document.getElementById('bar-schedule').hidden = (state.tab !== 'schedule');
  document.getElementById('bar-task').hidden = (state.tab !== 'task');
  document.getElementById('btn-add').hidden = (state.tab === 'notify');

  // のこっているやることの数
  const open = data.tasks.filter(t => !t.done).length;
  const badge = document.getElementById('task-badge');
  badge.hidden = open === 0;
  badge.textContent = String(open);

  const view = document.getElementById('view');
  if (state.tab === 'task') { view.innerHTML = renderTasks(); bindView(); return; }
  if (state.tab === 'notify') { view.innerHTML = renderNotify(); bindView(); return; }

  document.querySelectorAll('#scope button').forEach(b => b.classList.toggle('on', b.dataset.scope === state.scope));
  document.getElementById('date-label').textContent = scopeLabel();

  if (data.events.length === 0 && data.ext.length === 0 && state.scope === 'day') {
    view.innerHTML = introHtml(); bindView(); return;
  }
  if (state.scope === 'day') view.innerHTML = renderDay();
  else if (state.scope === 'week') view.innerHTML = renderWeek();
  else if (state.scope === 'month') view.innerHTML = renderMonth();
  else view.innerHTML = renderYear();
  bindView();
}

function scopeLabel() {
  const p = splitYmd(state.cursor) || { y: 2026, m: 1 };
  if (state.scope === 'day') return fmtFull(state.cursor);
  if (state.scope === 'week') { const m = mondayOf(state.cursor); return fmtDay(m) + ' 〜 ' + fmtDay(addDays(m, 6)); }
  if (state.scope === 'month') return p.y + '年 ' + p.m + '月';
  return p.y + '年';
}

function introHtml() {
  return '<div class="card"><div class="intro">' +
    '<div class="lead">まだ予定がありません</div>' +
    '<div class="note">右下の「＋」から、セミナーを1件入れてみてください。<br>' +
    '入れるのは<strong>日付だけ</strong>でかまいません。会場や連絡先は、分かったときに足せます。</div>' +
    '<button class="btn primary wide" data-act="add-event">＋ 最初の予定を入れる</button>' +
    '<button class="btn wide" data-act="sample">どんな画面か見本で見る</button>' +
    '</div></div>';
}

/* ---------- 日 ---------- */
function renderDay() {
  const list = eventsOn(state.cursor);
  const exts = extOn(state.cursor);
  const tks = tasksOn(state.cursor);
  let html = '';

  if (list.length === 0 && exts.length === 0) {
    html += '<div class="card"><div class="empty-day"><span class="mark">🍵</span>この日は予定なし</div></div>';
    const nx = nextEventFrom(state.cursor);
    if (nx) html += nextCardHtml(nx);
  } else {
    html += list.map(dayCardHtml).join('');
    html += exts.map(extCardHtml).join('');
  }

  if (tks.length) {
    html += '<div class="card"><div class="sec"><h3>☑️ この日が期限のやること</h3></div>' +
      tks.map(taskRowHtml).join('') + '</div>';
  }
  return html;
}

function nextCardHtml(ev) {
  const left = diffDays(todayStr(), ev.date);
  const when = left === 0 ? 'きょうです' : (left > 0 ? 'あと' + left + '日' : '');
  return '<div class="card"><div class="sec"><h3>つぎのセミナー</h3>' +
    (when ? '<div class="countdown">' + esc(when) + '</div>' : '') +
    '<div class="big">' + esc(fmtDay(ev.date)) + (has(ev.openTime) ? ' ' + esc(ev.openTime) + '開演' : '') + '</div>' +
    '<div class="sub">' + esc(eventLabel(ev)) + '</div>' +
    '<div class="actions"><button class="act" data-act="goto" data-date="' + esc(ev.date) + '">この日をひらく ▶</button></div>' +
    '</div></div>';
}

/** 外部カレンダーから取り込んだ予定（読み取り専用なので短く出す） */
function extCardHtml(x) {
  return '<div class="card ext"><div class="sec">' +
    '<div class="countdown ext">カレンダーから</div>' +
    '<div class="big">' + (x.allDay ? '終日' : esc(x.startTime || '')) + ' ' + esc(x.title) + '</div>' +
    (x.location ? '<div class="sub">' + esc(x.location) + '</div>' : '') +
    '<div class="sub" style="margin-top:6px">※ この予定はカレンダー側で編集してください</div>' +
    '</div></div>';
}

function dayCardHtml(ev) {
  const isToday = ev.date === todayStr();
  const left = diffDays(todayStr(), ev.date);
  let h = '<div class="card' + (isToday ? ' today' : '') + '">';

  let badge;
  if (left === 0) badge = '<div class="countdown">🔥 きょうです</div>';
  else if (left > 0) badge = '<div class="countdown">あと' + left + '日</div>';
  else badge = '<div class="countdown past">' + (-left) + '日前に終了</div>';

  const times = [];
  if (has(ev.openTime)) times.push(esc(ev.openTime) + ' <span>開演</span>');
  if (has(ev.arriveTime)) times.push(esc(ev.arriveTime) + ' <span>会場入り</span>');
  if (has(ev.endTime)) times.push(esc(ev.endTime) + ' <span>終了</span>');

  h += '<div class="hero">' + badge +
    '<h2>' + esc(ev.title || '（セミナー名 未入力）') + '</h2>' +
    (times.length ? '<div class="times">' + times.join('　／　') + '</div>' : '') +
    (ev.remindOff ? '<div class="sub" style="margin-top:6px">🔕 この予定は通知しません</div>' : '') +
    '</div>';

  if (has(ev.venue.place) || has(ev.venue.address) || has(ev.venue.note)) {
    h += '<div class="sec"><h3>🏢 ばしょ</h3>';
    if (has(ev.venue.place)) h += '<div class="big">' + esc(ev.venue.place) + '</div>';
    if (has(ev.venue.address)) h += '<div class="sub">' + esc(ev.venue.address) + '</div>';
    if (has(ev.venue.note)) h += '<div class="sub">📌 ' + esc(ev.venue.note) + '</div>';
    if (has(ev.venue.address)) {
      h += '<div class="actions">' +
        '<a class="act" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.venue.address) + '">🗺 地図をひらく</a>' +
        '<button class="act plain" data-act="copy" data-text="' + esc(ev.venue.address) + '">住所をコピー</button></div>';
    }
    h += '</div>';
  }

  if (has(ev.contact.org) || has(ev.contact.person) || has(ev.contact.tel) || has(ev.contact.email)) {
    h += '<div class="sec"><h3>👤 れんらくさき</h3>';
    if (has(ev.contact.org)) h += '<div class="big">' + esc(ev.contact.org) + '</div>';
    if (has(ev.contact.person)) h += '<div class="sub">' + esc(ev.contact.person) + ' さん</div>';
    const acts = [];
    if (has(ev.contact.tel)) acts.push('<a class="act" href="tel:' + encodeURIComponent(ev.contact.tel.replace(/\s/g, '')) + '">📞 電話</a>');
    if (has(ev.contact.email)) acts.push('<a class="act" href="mailto:' + encodeURIComponent(ev.contact.email) + '">✉ メール</a>');
    if (acts.length) h += '<div class="actions">' + acts.join('') + '</div>';
    h += '</div>';
  }

  if (ev.schedule.length) {
    h += '<div class="sec"><h3>⏱ 当日のながれ</h3><div class="rows">';
    for (const r of ev.schedule) h += '<div class="row-line"><div class="t">' + esc(r.time) + '</div><div class="l">' + esc(r.label) + '</div></div>';
    h += '</div></div>';
  }

  if (has(ev.travelGo.route) || has(ev.travelGo.time) || has(ev.travelBack.route) || has(ev.travelBack.time)) {
    h += '<div class="sec"><h3>🚄 いどう</h3><div class="rows">' +
      travelLine('行き', ev.travelGo) + travelLine('帰り', ev.travelBack) + '</div></div>';
  }

  if (has(ev.stay.place)) {
    h += '<div class="sec"><h3>🏨 しゅくはく</h3><div class="big">' + esc(ev.stay.place) + '</div>';
    const sub = [];
    if (isYmd(ev.stay.date)) sub.push(fmtDay(ev.stay.date) + ' 泊');
    if (has(ev.stay.note)) sub.push(ev.stay.note);
    if (sub.length) h += '<div class="sub">' + esc(sub.join('／')) + '</div>';
    if (has(ev.stay.address)) h += '<div class="sub">' + esc(ev.stay.address) + '</div>';
    const acts = [];
    if (has(ev.stay.tel)) acts.push('<a class="act" href="tel:' + encodeURIComponent(ev.stay.tel.replace(/\s/g, '')) + '">📞 宿に電話</a>');
    if (has(ev.stay.address)) acts.push('<a class="act plain" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.stay.address) + '">🗺 地図</a>');
    if (acts.length) h += '<div class="actions">' + acts.join('') + '</div>';
    h += '</div>';
  }

  if (has(ev.content.audience) || has(ev.content.people) || has(ev.content.materials) || has(ev.content.note)) {
    h += '<div class="sec"><h3>📝 ないよう</h3>';
    const head = [];
    if (has(ev.content.audience)) head.push('対象：' + ev.content.audience);
    if (has(ev.content.people)) head.push(ev.content.people + '名');
    if (head.length) h += '<div class="big">' + esc(head.join('　')) + '</div>';
    if (has(ev.content.materials)) h += '<div class="sub">資料：' + esc(ev.content.materials) + '</div>';
    if (has(ev.content.note)) h += '<div class="sub" style="margin-top:6px">' + nl2br(ev.content.note) + '</div>';
    h += '</div>';
  }

  if (ev.items.length) {
    const doneCount = ev.items.filter(i => i.done).length;
    h += '<div class="sec"><h3>🎒 もちもの（' + doneCount + '／' + ev.items.length + '）</h3><div class="check-list">';
    ev.items.forEach((it, i) => {
      h += '<label class="check-item' + (it.done ? ' done' : '') + '">' +
        '<input type="checkbox" data-act="check-item" data-id="' + esc(ev.id) + '" data-i="' + i + '"' + (it.done ? ' checked' : '') + '>' +
        '<span>' + esc(it.text) + '</span></label>';
    });
    h += '</div></div>';
  }

  // その予定にひもづく「やること」
  const linked = data.tasks.filter(t => t.eventId === ev.id);
  if (linked.length) {
    h += '<div class="sec"><h3>☑️ この予定のやること</h3></div>' + linked.map(taskRowHtml).join('');
  }

  h += '<div class="sec"><h3>💰 おかね</h3>';
  if (ev.money.length) {
    h += '<div class="rows">';
    for (const m of ev.money) {
      h += '<div class="row-line"><div class="l">' + esc(m.label || (m.kind === 'out' ? '経費' : '売上')) + '</div>' +
        '<div class="y ' + m.kind + '">' + (m.kind === 'out' ? '−' : '＋') + yen(m.amount) + '</div></div>';
    }
    h += '</div><div class="total-line"><div>差引</div><div>' + yen(moneyOf(ev).net) + '</div></div>';
  } else {
    h += '<div class="sub">まだ入っていません。</div>';
  }
  h += '<div class="actions"><button class="act" data-act="edit-money" data-id="' + esc(ev.id) + '">💰 お金を記録する</button></div></div>';

  if (has(ev.memo)) h += '<div class="sec"><h3>🗒 メモ</h3><div>' + nl2br(ev.memo) + '</div></div>';

  h += '<div class="sec">' +
    '<button class="btn wide" data-act="edit-event" data-id="' + esc(ev.id) + '">✏️ この予定を編集する</button>' +
    '<button class="btn wide" data-act="add-task-for" data-id="' + esc(ev.id) + '">＋ この予定のやることを足す</button>' +
    '</div></div>';
  return h;
}

function travelLine(label, t) {
  if (!has(t.route) && !has(t.time)) return '';
  const right = [];
  if (has(t.route)) right.push(t.route);
  if (has(t.mins)) right.push('約' + t.mins + '分');
  return '<div class="row-line"><div class="t">' + esc(label) + '</div>' +
    '<div class="l">' + (has(t.time) ? '<strong>' + esc(t.time) + '</strong> ' : '') + esc(right.join('／')) + '</div></div>';
}

/* ---------- 週 ---------- */
function renderWeek() {
  const start = mondayOf(state.cursor);
  let h = '<div class="card">';
  for (let i = 0; i < 7; i++) {
    const ds = addDays(start, i);
    const w = weekdayOf(ds);
    const marks = marksOn(ds);
    h += '<button class="week-row' + (ds === todayStr() ? ' is-today' : '') + '" data-act="goto" data-date="' + ds + '">' +
      '<div class="d' + (w === 6 ? ' sat' : '') + (w === 0 ? ' sun' : '') + '">' +
      '<span class="wd">' + WEEKDAY[w] + '</span><span class="dd">' + (splitYmd(ds).d) + '</span></div><div class="body">';
    if (!marks.length) h += '<div class="none">—</div>';
    else for (const mk of marks) {
      if (mk.type === 'sem') {
        h += '<div><span class="chip sem">セミナー</span><strong>' + esc(mk.ev.venue.place || eventLabel(mk.ev)) + '</strong></div>' +
          '<div class="none">' + esc((eventStartTime(mk.ev) ? eventStartTime(mk.ev) + ' ' : '') + (mk.ev.title || '')) + '</div>';
      } else if (mk.type === 'stay') {
        h += '<div><span class="chip stay">宿泊</span>' + esc(mk.ev.stay.place) + '</div>';
      } else if (mk.type === 'ext') {
        h += '<div><span class="chip ext">カレンダー</span>' + esc((mk.ev.startTime ? mk.ev.startTime + ' ' : '') + mk.ev.title) + '</div>';
      } else {
        h += '<div><span class="chip task">やること</span>' + esc(mk.ev.title) + '</div>';
      }
    }
    h += '</div></button>';
  }
  h += '</div>';
  const mm = moneyOfRange(start, addDays(start, 6));
  h += '<div class="card"><div class="sec"><h3>この週</h3><div class="big">' + mm.count + '件　売上 ' + yen(mm.income) + '</div></div></div>';
  return h;
}

/* ---------- 月 ---------- */
function renderMonth() {
  const p = splitYmd(state.cursor);
  const first = p.y + '-' + pad2(p.m) + '-01';
  const gridStart = mondayOf(first);
  const last = p.y + '-' + pad2(p.m) + '-' + pad2(daysInMonth(p.y, p.m));

  let h = '<div class="card"><div class="cal-head">' +
    ['月', '火', '水', '木', '金', '土', '日'].map((w, i) =>
      '<div class="' + (i === 5 ? 'sat' : (i === 6 ? 'sun' : '')) + '">' + w + '</div>').join('') +
    '</div><div class="cal-grid">';

  for (let i = 0; i < 42; i++) {
    const ds = addDays(gridStart, i);
    const dp = splitYmd(ds);
    const other = (dp.m !== p.m || dp.y !== p.y);
    const marks = marksOn(ds);
    let dots = '';
    if (marks.some(m => m.type === 'sem')) dots += '<span class="dot sem"></span>';
    if (marks.some(m => m.type === 'ext')) dots += '<span class="dot ext"></span>';
    if (marks.some(m => m.type === 'stay')) dots += '<span class="dot stay"></span>';
    if (marks.some(m => m.type === 'task')) dots += '<span class="dot task"></span>';
    const w = weekdayOf(ds);
    h += '<button class="cal-cell' + (other ? ' other' : '') +
      (w === 6 ? ' sat' : '') + (w === 0 ? ' sun' : '') +
      (ds === todayStr() ? ' is-today' : '') + (ds === state.cursor ? ' picked' : '') +
      '" data-act="goto" data-date="' + ds + '"><div class="n">' + dp.d + '</div><div class="dots">' + dots + '</div></button>';
    // 6週目が丸ごと翌月なら、そこで打ち切って月をつめて見せる
    if (i === 34) { const nx = splitYmd(addDays(gridStart, 35)); if (nx.m !== p.m || nx.y !== p.y) break; }
  }
  h += '</div><div class="legend">' +
    '<span><i class="dot sem"></i>セミナー</span><span><i class="dot ext"></i>カレンダー</span>' +
    '<span><i class="dot stay"></i>宿泊</span><span><i class="dot task"></i>やること</span></div></div>';

  const mm = moneyOfRange(first, last);
  h += '<div class="card"><div class="sec"><h3>' + p.m + '月のまとめ</h3>' +
    '<div class="big">' + mm.count + '件　売上 ' + yen(mm.income) + '</div>' +
    (mm.expense ? '<div class="sub">経費 ' + yen(mm.expense) + '／差引 ' + yen(mm.net) + '</div>' : '') +
    '</div>' + listHtml(first, last) + '</div>';
  return h;
}

function listHtml(fromStr, toStr) {
  const list = sortedEvents().filter(e => e.date >= fromStr && e.date <= toStr);
  if (!list.length) return '<div class="sec"><div class="sub">予定はありません。</div></div>';
  return list.map(e => {
    const mm = moneyOf(e);
    const sub = [];
    if (has(e.contact.org)) sub.push(esc(e.contact.org));
    if (mm.income) sub.push('<span class="amt">' + yen(mm.income) + '</span>');
    return '<button class="list-item" data-act="goto" data-date="' + esc(e.date) + '">' +
      '<div class="ld">' + esc(fmtDay(e.date)) + '</div>' +
      '<div class="lb"><div class="lt">' + esc(e.venue.place || eventLabel(e)) + '</div>' +
      '<div class="ls">' + sub.join('　/　') + '</div></div></button>';
  }).join('');
}

/* ---------- 年 ---------- */
function renderYear() {
  const y = splitYmd(state.cursor).y;
  const mm = moneyOfRange(y + '-01-01', y + '-12-31');
  let h = '<div class="card"><div class="sum-grid">' +
    '<div class="sum-row"><div class="k">セミナー</div><div class="v">' + mm.count + '件</div></div>' +
    '<div class="sum-row"><div class="k">売上</div><div class="v" style="color:var(--in)">' + yen(mm.income) + '</div></div>' +
    '<div class="sum-row"><div class="k">経費</div><div class="v" style="color:var(--out)">' + yen(mm.expense) + '</div></div>' +
    '<div class="sum-row total"><div class="k">差引</div><div class="big-num">' + yen(mm.net) + '</div></div>' +
    '</div></div>';

  const months = [];
  let max = 0;
  for (let m = 1; m <= 12; m++) {
    const f = y + '-' + pad2(m) + '-01';
    const t = y + '-' + pad2(m) + '-' + pad2(daysInMonth(y, m));
    const r = moneyOfRange(f, t);
    months.push(r);
    if (r.income > max) max = r.income;
  }
  h += '<div class="card"><div class="sec"><h3>月ごとの売上</h3></div>';
  months.forEach((r, i) => {
    const pct = max > 0 ? Math.round(r.income / max * 100) : 0;
    h += '<div class="bar-row"><div class="m">' + (i + 1) + '月</div>' +
      '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div>' +
      '<div class="v">' + (r.count ? r.count + '件 ' : '') + (r.income ? Number(r.income).toLocaleString('ja-JP') : '') + '</div></div>';
  });
  h += '<div class="sec"><button class="btn wide" data-act="settings">⚙ CSVに書き出す（設定）</button></div></div>';
  return h;
}

/* ---------- やること ---------- */
function taskRowHtml(t) {
  const today = todayStr();
  const sub = [];
  if (isYmd(t.due)) {
    const d = diffDays(today, t.due);
    if (t.done) sub.push(fmtDay(t.due));
    else if (d < 0) sub.push('<span class="over">' + (-d) + '日すぎています（' + fmtDay(t.due) + '）</span>');
    else if (d === 0) sub.push('<span class="today">きょうまで' + (t.dueTime ? ' ' + esc(t.dueTime) : '') + '</span>');
    else sub.push('あと' + d + '日（' + fmtDay(t.due) + '）');
  }
  const ev = t.eventId ? data.events.find(e => e.id === t.eventId) : null;
  if (ev) sub.push(esc(eventLabel(ev)));
  return '<div class="task-row' + (t.done ? ' done' : '') + '">' +
    '<button class="box" data-act="toggle-task" data-id="' + esc(t.id) + '" aria-label="おわった"><i>✓</i></button>' +
    '<div class="tbody" data-act="edit-task" data-id="' + esc(t.id) + '">' +
    '<div class="tt">' + esc(t.title) + '</div>' +
    (sub.length ? '<div class="ts">' + sub.join('　/　') + '</div>' : '') +
    '</div></div>';
}

function renderTasks() {
  const today = todayStr();
  let list = data.tasks.slice();
  if (state.taskFilter === 'open') list = list.filter(t => !t.done);
  else if (state.taskFilter === 'today') list = list.filter(t => !t.done && isYmd(t.due) && t.due <= today);
  else list = list.filter(t => t.done);

  if (!list.length) {
    return '<div class="card"><div class="empty-day"><span class="mark">🫧</span>' +
      (state.taskFilter === 'done' ? 'おわったやることはまだありません' : 'やることはありません') + '</div></div>';
  }

  // 期限が近い順。期限なしは最後
  list.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.title || '') < (b.title || '') ? -1 : 1;
  });

  const groups = [
    { key: 'over', label: '⚠ 期限がすぎています', test: t => !t.done && isYmd(t.due) && t.due < today },
    { key: 'today', label: 'きょうまで', test: t => !t.done && t.due === today },
    { key: 'soon', label: '3日以内', test: t => !t.done && isYmd(t.due) && t.due > today && diffDays(today, t.due) <= 3 },
    { key: 'later', label: 'そのあと', test: t => !t.done && isYmd(t.due) && diffDays(today, t.due) > 3 },
    { key: 'none', label: '期限なし', test: t => !t.done && !isYmd(t.due) },
    { key: 'done', label: 'おわった', test: t => t.done }
  ];
  let h = '<div class="card">';
  for (const g of groups) {
    const items = list.filter(g.test);
    if (!items.length) continue;
    h += '<div class="task-group">' + g.label + '（' + items.length + '）</div>';
    h += items.map(taskRowHtml).join('');
  }
  return h + '</div>';
}

/* ---------- 通知タブ（状況をひと目で） ---------- */
function renderNotify() {
  const n = data.settings.notify;
  const rules = [];
  if (n.rules.d1) rules.push('前日');
  if (n.rules.h2) rules.push('2時間前');
  if (n.rules.m30) rules.push('30分前');

  let h = '<div class="card"><div class="sec"><h3>🔔 通知のようす</h3>';
  h += '<div class="big">' + (n.on ? 'オン' : 'オフ') + '</div>';
  h += '<div class="sub">予定：' + (rules.length ? rules.join('・') : '（どれも選ばれていません）') + '</div>';
  h += '<div class="sub">やること：' + esc(n.taskAt) + '／毎朝のまとめ：' + (n.digestAt ? esc(n.digestAt) : 'なし') + '</div>';
  h += '<div class="sub">通知を受け取る端末：' + data.devices.length + '台</div>';
  h += '<div class="actions"><button class="act" data-act="settings">⚙ 通知の設定をひらく</button></div>';
  h += '</div></div>';

  // 直近に鳴る予定
  const today = todayStr();
  const soon = sortedEvents().filter(e => e.date >= today).slice(0, 5);
  h += '<div class="card"><div class="sec"><h3>これから知らせる予定</h3></div>';
  if (!soon.length) h += '<div class="sec"><div class="sub">これからの予定はありません。</div></div>';
  else h += soon.map(e => {
    const st = eventStartTime(e);
    return '<button class="list-item" data-act="goto" data-date="' + esc(e.date) + '">' +
      '<div class="ld">' + esc(fmtDay(e.date)) + '</div>' +
      '<div class="lb"><div class="lt">' + esc(eventLabel(e)) + '</div>' +
      '<div class="ls">' + (e.remindOff ? '🔕 通知しない' : (st ? st + ' 開始の ' + (rules.join('・') || '—') : '時刻未定 → ' + esc(n.allDayAt))) + '</div></div></button>';
  }).join('');
  h += '</div>';

  if (data.calendarsLast) {
    const at = new Date(data.calendarsLast.at);
    h += '<div class="card"><div class="sec"><h3>カレンダーの取り込み</h3>' +
      '<div class="sub">最終：' + at.toLocaleString('ja-JP') + '</div>' +
      (data.calendarsLast.report || []).map(r =>
        '<div class="sub">' + (r.ok ? '✅' : '⚠️') + ' ' + esc(r.name || '(名前なし)') + '：' +
        (r.ok ? r.count + '件' : esc(r.message)) + '</div>').join('') +
      '</div></div>';
  }
  return h;
}

/* --- 描いたあとに、押したときの動きを付け直す --- */
function bindView() {
  document.querySelectorAll('#view [data-act]').forEach(el => {
    const act = el.dataset.act;
    if (act === 'check-item') {
      el.addEventListener('change', () => toggleItem(el.dataset.id, Number(el.dataset.i)));
      return;
    }
    el.addEventListener('click', () => {
      if (act === 'goto') { state.cursor = el.dataset.date; state.scope = 'day'; state.tab = 'schedule'; render(); scrollTop(); }
      else if (act === 'edit-event') openEventEditor(el.dataset.id);
      else if (act === 'edit-money') openEventEditor(el.dataset.id, 'money');
      else if (act === 'add-event') openEventEditor(null);
      else if (act === 'add-task-for') openTaskEditor(null, el.dataset.id);
      else if (act === 'edit-task') openTaskEditor(el.dataset.id);
      else if (act === 'toggle-task') toggleTask(el.dataset.id);
      else if (act === 'sample') addSample();
      else if (act === 'copy') copyText(el.dataset.text, '住所をコピーしました');
      else if (act === 'settings') openSettings();
    });
  });
}
function scrollTop() { window.scrollTo(0, 0); }

/* =====================================================================
   8. 変更（画面を先に直してから、サーバーへ送る）
   ===================================================================== */

async function saveEvent(ev) {
  const i = data.events.findIndex(e => e.id === ev.id);
  if (i >= 0) data.events[i] = ev; else data.events.push(ev);
  lsSet(LS_CACHE, data);
  render();
  const r = await apiWrite('PUT', '/api/events', ev);
  if (r && r.queued) showToast('保存しました（つながったら送ります）');
  else showToast('保存しました');
}

async function removeEvent(id) {
  data.events = data.events.filter(e => e.id !== id);
  data.tasks = data.tasks.filter(t => t.eventId !== id);
  lsSet(LS_CACHE, data);
  render();
  await apiWrite('DELETE', '/api/events/' + id);
  showToast('消しました');
}

async function saveTask(t) {
  const i = data.tasks.findIndex(x => x.id === t.id);
  if (i >= 0) data.tasks[i] = t; else data.tasks.push(t);
  lsSet(LS_CACHE, data);
  render();
  const r = await apiWrite('PUT', '/api/tasks', t);
  if (r && r.queued) showToast('保存しました（つながったら送ります）');
}

async function removeTask(id) {
  data.tasks = data.tasks.filter(t => t.id !== id);
  lsSet(LS_CACHE, data);
  render();
  await apiWrite('DELETE', '/api/tasks/' + id);
  showToast('消しました');
}

async function toggleTask(id) {
  const t = data.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : 0;
  await saveTask(normalizeTask(t));
}

async function toggleItem(eventId, index) {
  const ev = data.events.find(e => e.id === eventId);
  if (!ev || !ev.items[index]) return;
  ev.items[index].done = !ev.items[index].done;
  await saveEvent(normalizeEvent(ev));
}

async function saveSettings(next) {
  data.settings = normalizeSettings(next);
  lsSet(LS_CACHE, data);
  const r = await apiWrite('PUT', '/api/settings', data.settings);
  if (r && r.settings) data.settings = normalizeSettings(r.settings);
  render();
}

/* =====================================================================
   9. 予定の入力シート
   ===================================================================== */

const val = id => document.getElementById(id).value.trim();
const setVal = (id, v) => { document.getElementById(id).value = v || ''; };

function openEventEditor(id, focusSection) {
  const ev = id ? data.events.find(e => e.id === id) : null;
  editingEventId = ev ? ev.id : null;
  fillEventEditor(ev || Object.assign(blankEvent(), { date: state.cursor }));
  document.getElementById('ev-title').textContent = ev ? '予定を編集' : '予定を追加';
  document.getElementById('ev-delete').style.display = ev ? 'block' : 'none';
  openSheet('sheet-event');
  if (focusSection === 'money') {
    setTimeout(() => document.getElementById('rep-money').scrollIntoView({ block: 'center' }), 60);
  }
}

function fillEventEditor(ev) {
  setVal('f-date', ev.date); setVal('f-title', ev.title);
  setVal('f-arrive', ev.arriveTime); setVal('f-open', ev.openTime); setVal('f-end', ev.endTime);
  setVal('f-place', ev.venue.place); setVal('f-address', ev.venue.address); setVal('f-vnote', ev.venue.note);
  setVal('f-org', ev.contact.org); setVal('f-person', ev.contact.person);
  setVal('f-tel', ev.contact.tel); setVal('f-email', ev.contact.email);
  setVal('f-go-time', ev.travelGo.time); setVal('f-go-mins', ev.travelGo.mins); setVal('f-go-route', ev.travelGo.route);
  setVal('f-back-time', ev.travelBack.time); setVal('f-back-mins', ev.travelBack.mins); setVal('f-back-route', ev.travelBack.route);
  setVal('f-stay-place', ev.stay.place); setVal('f-stay-date', ev.stay.date);
  setVal('f-stay-tel', ev.stay.tel); setVal('f-stay-address', ev.stay.address); setVal('f-stay-note', ev.stay.note);
  setVal('f-audience', ev.content.audience); setVal('f-people', ev.content.people);
  setVal('f-materials', ev.content.materials); setVal('f-cnote', ev.content.note);
  setVal('f-memo', ev.memo);
  document.getElementById('f-remindoff').checked = !!ev.remindOff;

  const sc = document.getElementById('rep-schedule'); sc.innerHTML = '';
  ev.schedule.forEach(r => sc.appendChild(scheduleRow(r.time, r.label)));
  if (!ev.schedule.length) sc.appendChild(scheduleRow('', ''));

  const it = document.getElementById('rep-items'); it.innerHTML = '';
  ev.items.forEach(r => it.appendChild(itemRow(r.text, r.done)));
  if (!ev.items.length) it.appendChild(itemRow('', false));

  const mo = document.getElementById('rep-money'); mo.innerHTML = '';
  ev.money.forEach(r => mo.appendChild(moneyRow(r.kind, r.label, r.amount)));
  if (!ev.money.length) mo.appendChild(moneyRow('in', '', ''));
}

function repRow(children) {
  const row = document.createElement('div');
  row.className = 'rep-row';
  children.forEach(c => row.appendChild(c));
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'del'; del.textContent = '×';
  del.setAttribute('aria-label', 'この行を消す');
  del.addEventListener('click', () => row.parentNode.removeChild(row));
  row.appendChild(del);
  return row;
}
function mkInput(type, placeholder, value, style) {
  const el = document.createElement('input');
  el.type = type; el.placeholder = placeholder || ''; el.value = value || '';
  if (style) el.setAttribute('style', style);
  return el;
}
function scheduleRow(time, label) {
  return repRow([mkInput('time', '', time, 'flex:none;width:118px'), mkInput('text', '例）会場入り', label, 'flex:1')]);
}
function itemRow(text, done) {
  // チェックは指で押せる大きさ（44px）の枠で包む。ボタン自体を44pxにすると大きすぎるため。
  const wrap = document.createElement('label');
  wrap.className = 'cb-wrap';
  const c = document.createElement('input');
  c.type = 'checkbox'; c.checked = !!done;
  wrap.appendChild(c);
  return repRow([wrap, mkInput('text', '例）マイク', text, 'flex:1')]);
}
function moneyRow(kind, label, amount) {
  const sel = document.createElement('select');
  sel.setAttribute('style', 'flex:none;width:72px');
  [['in', '入'], ['out', '出']].forEach(o => {
    const op = document.createElement('option');
    op.value = o[0]; op.textContent = o[1];
    if (kind === o[0]) op.selected = true;
    sel.appendChild(op);
  });
  const a = mkInput('text', '80000', amount === '' || amount == null ? '' : String(amount), 'flex:none;width:96px;text-align:right');
  a.setAttribute('inputmode', 'numeric');
  return repRow([sel, mkInput('text', '例）講演料', label, 'flex:1;min-width:0'), a]);
}

function readEventEditor() {
  const base = editingEventId ? data.events.find(e => e.id === editingEventId) : null;
  const ev = base ? JSON.parse(JSON.stringify(base)) : blankEvent();

  ev.date = val('f-date'); ev.title = val('f-title');
  ev.arriveTime = val('f-arrive'); ev.openTime = val('f-open'); ev.endTime = val('f-end');
  ev.venue = { place: val('f-place'), address: val('f-address'), note: val('f-vnote') };
  ev.contact = { org: val('f-org'), person: val('f-person'), tel: val('f-tel'), email: val('f-email') };
  ev.travelGo = { time: val('f-go-time'), mins: val('f-go-mins'), route: val('f-go-route') };
  ev.travelBack = { time: val('f-back-time'), mins: val('f-back-mins'), route: val('f-back-route') };
  ev.stay = { place: val('f-stay-place'), date: val('f-stay-date'), tel: val('f-stay-tel'), address: val('f-stay-address'), note: val('f-stay-note') };
  ev.content = { audience: val('f-audience'), people: val('f-people'), materials: val('f-materials'), note: document.getElementById('f-cnote').value.trim() };
  ev.memo = document.getElementById('f-memo').value.trim();
  ev.remindOff = document.getElementById('f-remindoff').checked;

  ev.schedule = [];
  document.querySelectorAll('#rep-schedule .rep-row').forEach(row => {
    const i = row.querySelectorAll('input');
    const time = i[0].value.trim(), label = i[1].value.trim();
    if (time || label) ev.schedule.push({ time, label });
  });
  ev.schedule.sort((a, b) => (a.time || '99:99') < (b.time || '99:99') ? -1 : 1);

  ev.items = [];
  document.querySelectorAll('#rep-items .rep-row').forEach(row => {
    const c = row.querySelector('input[type=checkbox]');
    const t = row.querySelector('input[type=text]');
    if (t.value.trim()) ev.items.push({ text: t.value.trim(), done: c.checked });
  });

  ev.money = [];
  document.querySelectorAll('#rep-money .rep-row').forEach(row => {
    const sel = row.querySelector('select');
    const ins = row.querySelectorAll('input[type=text]');
    const label = ins[0].value.trim();
    const amount = Math.abs(Math.round(Number(String(ins[1].value).replace(/[,，\s円]/g, '')) || 0));
    if (label || amount) ev.money.push({ kind: sel.value === 'out' ? 'out' : 'in', label, amount });
  });

  return normalizeEvent(ev);
}

async function saveEventEditor() {
  const ev = readEventEditor();
  if (!isYmd(ev.date)) { showToast('日付を入れてください'); document.getElementById('f-date').focus(); return; }
  closeSheet('sheet-event');
  state.cursor = ev.date; state.scope = 'day'; state.tab = 'schedule';
  await saveEvent(ev);
  scrollTop();
}

/* =====================================================================
   10. やることの入力シート
   ===================================================================== */

function openTaskEditor(id, eventId) {
  const t = id ? data.tasks.find(x => x.id === id) : null;
  editingTaskId = t ? t.id : null;
  const base = t || Object.assign(blankTask(), { eventId: eventId || '', due: state.tab === 'schedule' ? state.cursor : '' });

  setVal('t-title', base.title);
  setVal('t-due', base.due);
  setVal('t-duetime', base.dueTime);
  setVal('t-note', base.note);
  document.getElementById('t-remindoff').checked = !!base.remindOff;

  const sel = document.getElementById('t-event');
  const today = todayStr();
  const choices = sortedEvents().filter(e => e.date >= addDays(today, -60));
  sel.innerHTML = '<option value="">（ひもづけない）</option>' +
    choices.map(e => '<option value="' + esc(e.id) + '"' + (e.id === base.eventId ? ' selected' : '') + '>' +
      esc(fmtDay(e.date) + ' ' + eventLabel(e)) + '</option>').join('');

  document.getElementById('tk-title').textContent = t ? 'やることを編集' : 'やることを追加';
  document.getElementById('tk-delete').style.display = t ? 'block' : 'none';
  openSheet('sheet-task');
}

async function saveTaskEditor() {
  const base = editingTaskId ? data.tasks.find(x => x.id === editingTaskId) : blankTask();
  const t = normalizeTask({
    ...base,
    title: val('t-title'),
    due: val('t-due'),
    dueTime: val('t-duetime'),
    eventId: document.getElementById('t-event').value,
    note: document.getElementById('t-note').value.trim(),
    remindOff: document.getElementById('t-remindoff').checked
  });
  if (!t.title) { showToast('やることの名前を入れてください'); document.getElementById('t-title').focus(); return; }
  closeSheet('sheet-task');
  await saveTask(t);
  showToast('保存しました');
}

/* =====================================================================
   11. 設定
   ===================================================================== */

function openSettings() {
  const s = data.settings, n = s.notify;
  document.getElementById('n-on').checked = n.on;
  document.getElementById('n-d1').checked = n.rules.d1;
  document.getElementById('n-h2').checked = n.rules.h2;
  document.getElementById('n-m30').checked = n.rules.m30;
  setVal('n-digest', n.digestAt); setVal('n-allday', n.allDayAt); setVal('n-task', n.taskAt);
  setVal('n-quiet-from', n.quietFrom); setVal('n-quiet-to', n.quietTo);
  setVal('f-default-items', s.defaultItems.join('\n'));

  const cals = document.getElementById('rep-cals'); cals.innerHTML = '';
  s.calendars.forEach(c => cals.appendChild(calRow(c.name, c.url)));
  if (!s.calendars.length) cals.appendChild(calRow('', ''));

  document.getElementById('ics-url').textContent = data.icsUrl || '（読み込み中）';
  fillCsvYears();
  renderPushStatus();
  renderDevices();
  document.getElementById('about-text').innerHTML =
    'データはインターネット上（Cloudflare）に保管され、スマホとパソコンで同じものが見えます。<br>' +
    'この端末の表示：' + (isStandalone() ? '<b>ホーム画面から起動</b>（通知が使えます）' : 'ブラウザのタブ') + '<br>' +
    '送信待ち：' + lsGet(LS_QUEUE, []).length + '件';
  openSheet('sheet-settings');
}

function calRow(name, url) {
  const n = mkInput('text', '名前（例：Googleカレンダー）', name, 'flex:none;width:130px');
  const u = mkInput('text', 'https://calendar.google.com/calendar/ical/.../basic.ics', url, 'flex:1;min-width:0');
  return repRow([n, u]);
}

function readCals() {
  const out = [];
  document.querySelectorAll('#rep-cals .rep-row').forEach(row => {
    const i = row.querySelectorAll('input');
    const url = i[1].value.trim();
    if (url) out.push({ name: i[0].value.trim() || 'カレンダー', url });
  });
  return out;
}

function fillCsvYears() {
  const sel = document.getElementById('f-csv-year');
  const years = new Set(data.events.filter(e => isYmd(e.date)).map(e => e.date.slice(0, 4)));
  years.add(String(new Date().getFullYear()));
  sel.innerHTML = [...years].sort().reverse().map(y => '<option value="' + y + '">' + y + '年</option>').join('');
}

function renderDevices() {
  const box = document.getElementById('device-list');
  if (!data.devices.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="field"><div class="hint">通知を受け取る端末：' +
    data.devices.map(d => esc(d.label || '端末')).join('、') + '</div></div>';
}

/* =====================================================================
   12. 通知（スマホへのお知らせ）
   ===================================================================== */

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function renderPushStatus() {
  const box = document.getElementById('push-status');
  const btn = document.getElementById('btn-enable-push');
  const test = document.getElementById('btn-test-push');

  if (isIOS() && !isStandalone()) {
    box.innerHTML = '<div class="notice warn"><b>あと1手順だけ必要です</b>' +
      'iPhone・iPadでは、<b>ホーム画面に追加したアイコンから開いたときだけ</b>通知を出せます。' +
      '<ol><li>画面下の <b>共有ボタン</b>（□に↑）を押す</li>' +
      '<li><b>「ホーム画面に追加」</b>を選ぶ</li>' +
      '<li>ホーム画面にできた<b>ポケット秘書のアイコン</b>から開き直す</li>' +
      '<li>もう一度この設定画面を開いて「通知をオンにする」を押す</li></ol></div>';
    btn.disabled = true; test.disabled = true;
    return;
  }
  if (!pushSupported()) {
    box.innerHTML = '<div class="notice err"><b>この端末では通知が使えません</b>' +
      'ブラウザが通知に対応していないようです。Safari（iOS 16.4以降）か Chrome でお試しください。</div>';
    btn.disabled = true; test.disabled = true;
    return;
  }
  const perm = Notification.permission;
  if (perm === 'denied') {
    box.innerHTML = '<div class="notice err"><b>通知が拒否されています</b>' +
      '端末の「設定」→ このアプリ →「通知」を許可に変えてから、もう一度お試しください。</div>';
    btn.disabled = true; test.disabled = true;
    return;
  }
  const registered = data.devices.length > 0;
  box.innerHTML = '<div class="notice ' + (perm === 'granted' && registered ? 'ok' : 'warn') + '">' +
    (perm === 'granted' && registered
      ? '<b>通知はオンです</b>この端末で受け取れます。'
      : '<b>通知はまだオフです</b>下のボタンを押して、許可してください。') + '</div>';
  btn.disabled = false;
  test.disabled = !(perm === 'granted' && registered);
}

function b64urlToUint8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'この端末';
}

async function enablePush() {
  const btn = document.getElementById('btn-enable-push');
  btn.disabled = true; btn.textContent = '準備しています…';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { showToast('通知が許可されませんでした'); renderPushStatus(); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (!data.vapidPublicKey) { showToast('サーバーの準備がまだです。少し待ってからお試しください'); return; }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToUint8(data.vapidPublicKey)
      });
    }
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON(), label: deviceLabel() });
    const r = await api('GET', '/api/bootstrap');
    data.devices = r.devices || [];
    showToast('通知をオンにしました');
  } catch (e) {
    showToast('通知をオンにできませんでした：' + e.message);
  } finally {
    btn.textContent = '通知をオンにする';
    renderPushStatus();
  }
}

/* =====================================================================
   13. 書き出し・見本・コピー
   ===================================================================== */

function downloadFile(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    showToast('書き出せませんでした');
    return false;
  }
}

function copyText(text, okMessage) {
  const done = () => showToast(okMessage || 'コピーしました');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('style', 'position:fixed;top:0;left:0;opacity:0');
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    showToast(ok ? (okMessage || 'コピーしました') : 'コピーできませんでした');
  }
}

function exportCsv() {
  const year = document.getElementById('f-csv-year').value;
  const rows = [['日付', 'セミナー名', '主催', '会場', '種類', '項目', '金額']];
  for (const e of sortedEvents()) {
    if (e.date.slice(0, 4) !== year || !e.money.length) continue;
    for (const m of e.money) {
      rows.push([e.date, e.title, e.contact.org, e.venue.place, m.kind === 'out' ? '経費' : '売上', m.label, String(m.amount)]);
    }
  }
  if (rows.length === 1) { showToast(year + '年のお金の記録がありません'); return; }
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  // 先頭の BOM は、エクセルで開いたときに日本語が化けないようにするための印
  downloadFile('pocket-hisho-money-' + year + '.csv', '﻿' + csv, 'text/csv;charset=utf-8');
  showToast('書き出しました');
}

async function addSample() {
  if (data.events.some(e => e.id.startsWith('sample_'))) { showToast('見本はもう入っています'); return; }
  const base = addDays(todayStr(), 3);
  const s = normalizeEvent({
    id: 'sample_1', date: base,
    title: '（見本）管理職向け コミュニケーション研修',
    arriveTime: '12:30', openTime: '13:30', endTime: '16:30',
    venue: { place: '大阪産業創造館 5Fホール', address: '大阪市中央区本町1-4-5', note: '堺筋本町①出口から徒歩5分' },
    contact: { org: '株式会社サンプル商事', person: '田中 太郎', tel: '06-1234-5678', email: 'tanaka@example.com' },
    schedule: [
      { time: '12:30', label: '会場入り・機材チェック' }, { time: '13:00', label: '開場' },
      { time: '13:30', label: '開演' }, { time: '15:00', label: '休憩（15分）' }, { time: '16:30', label: '終了・撤収' }
    ],
    travelGo: { time: '09:03', mins: '50', route: '名古屋→新大阪 のぞみ21号' },
    travelBack: { time: '18:12', mins: '50', route: '新大阪→名古屋 のぞみ56号' },
    stay: { place: 'サンプルホテル新大阪', date: addDays(base, -1), tel: '06-9999-0000', address: '大阪市淀川区西中島3-1-1', note: '15:00イン／朝食つき' },
    content: { audience: '管理職', people: '40', materials: '資料50部／スライドA', note: '前回は「傾聴」中心。今回は「叱り方」を厚めに。' },
    items: [{ text: 'マイク', done: true }, { text: '資料50部', done: false }, { text: '名刺', done: false }],
    money: [{ kind: 'in', label: '講演料', amount: 80000 }, { kind: 'out', label: '交通費', amount: 28400 }, { kind: 'out', label: '宿泊費', amount: 9800 }],
    memo: 'これは見本です。編集画面の「この予定を消す」で消せます。'
  });
  closeSheet('sheet-settings');
  state.cursor = base; state.scope = 'day'; state.tab = 'schedule';
  await saveEvent(s);
  await saveTask(normalizeTask({ id: 'sample_t1', title: '（見本）資料を50部 印刷する', due: addDays(base, -1), eventId: 'sample_1' }));
  scrollTop();
}

/* =====================================================================
   14. シートの開け閉め
   ===================================================================== */

function openSheet(id) {
  const el = document.getElementById(id);
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); el.scrollTop = 0;
}
function closeSheet(id) {
  const el = document.getElementById(id);
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
}
function closeAllSheets() { ['sheet-event', 'sheet-task', 'sheet-settings'].forEach(closeSheet); }

/* =====================================================================
   15. ボタンのつなぎこみ
   ===================================================================== */

function moveCursor(step) {
  if (state.scope === 'day') state.cursor = addDays(state.cursor, step);
  else if (state.scope === 'week') state.cursor = addDays(state.cursor, step * 7);
  else if (state.scope === 'month') state.cursor = addMonths(state.cursor, step);
  else state.cursor = addYears(state.cursor, step);
  render();
}

function bindOnce() {
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('f-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  document.querySelectorAll('#tabbar button').forEach(b => {
    b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); scrollTop(); });
  });
  document.querySelectorAll('#scope button').forEach(b => {
    b.addEventListener('click', () => { state.scope = b.dataset.scope; render(); });
  });
  document.querySelectorAll('#task-filter button').forEach(b => {
    b.addEventListener('click', () => {
      state.taskFilter = b.dataset.filter;
      document.querySelectorAll('#task-filter button').forEach(x => x.classList.toggle('on', x === b));
      render();
    });
  });
  document.getElementById('btn-prev').addEventListener('click', () => moveCursor(-1));
  document.getElementById('btn-next').addEventListener('click', () => moveCursor(1));
  document.getElementById('btn-today').addEventListener('click', () => { state.cursor = todayStr(); render(); scrollTop(); });
  document.getElementById('btn-add').addEventListener('click', () => {
    if (state.tab === 'task') openTaskEditor(null); else openEventEditor(null);
  });
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  /* 予定シート */
  document.getElementById('ev-cancel').addEventListener('click', () => closeSheet('sheet-event'));
  document.getElementById('ev-save').addEventListener('click', saveEventEditor);
  document.getElementById('ev-delete').addEventListener('click', () => {
    if (!editingEventId) return;
    askConfirm('この予定を消しますか', '消すと元に戻せません。ひもづくやることも一緒に消えます。', '消す', async () => {
      const id = editingEventId;
      closeSheet('sheet-event');
      await removeEvent(id);
    });
  });
  document.getElementById('add-schedule').addEventListener('click', () =>
    document.getElementById('rep-schedule').appendChild(scheduleRow('', '')));
  document.getElementById('add-item').addEventListener('click', () =>
    document.getElementById('rep-items').appendChild(itemRow('', false)));
  document.getElementById('add-money').addEventListener('click', () =>
    document.getElementById('rep-money').appendChild(moneyRow('in', '', '')));
  document.getElementById('add-default-items').addEventListener('click', () => {
    const list = data.settings.defaultItems;
    if (!list.length) { showToast('設定画面で「よく持っていくもの」を登録してください'); return; }
    const box = document.getElementById('rep-items');
    const already = new Set([...box.querySelectorAll('input[type=text]')].map(i => i.value.trim()).filter(Boolean));
    let added = 0;
    for (const t of list) { if (already.has(t)) continue; box.appendChild(itemRow(t, false)); added++; }
    showToast(added ? added + '個 入れました' : 'すべて入っています');
  });

  /* やることシート */
  document.getElementById('tk-cancel').addEventListener('click', () => closeSheet('sheet-task'));
  document.getElementById('tk-save').addEventListener('click', saveTaskEditor);
  document.getElementById('tk-delete').addEventListener('click', () => {
    if (!editingTaskId) return;
    askConfirm('このやることを消しますか', '消すと元に戻せません。', '消す', async () => {
      const id = editingTaskId;
      closeSheet('sheet-task');
      await removeTask(id);
    });
  });

  /* 設定シート */
  document.getElementById('st-close').addEventListener('click', () => closeSheet('sheet-settings'));
  document.getElementById('btn-enable-push').addEventListener('click', enablePush);
  document.getElementById('btn-test-push').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/push/test');
      showToast(r.sent ? r.sent + '台に送りました' : '送れませんでした（登録されている端末がありません）');
    } catch (e) { showToast(e.message); }
  });
  document.getElementById('btn-save-notify').addEventListener('click', async () => {
    await saveSettings({
      ...data.settings,
      notify: {
        on: document.getElementById('n-on').checked,
        rules: {
          d1: document.getElementById('n-d1').checked,
          h2: document.getElementById('n-h2').checked,
          m30: document.getElementById('n-m30').checked
        },
        digestAt: val('n-digest'), allDayAt: val('n-allday'), taskAt: val('n-task'),
        quietFrom: val('n-quiet-from'), quietTo: val('n-quiet-to')
      }
    });
    showToast('通知の設定を保存しました');
  });
  document.getElementById('add-cal').addEventListener('click', () =>
    document.getElementById('rep-cals').appendChild(calRow('', '')));
  document.getElementById('btn-save-cals').addEventListener('click', async () => {
    const box = document.getElementById('cal-status');
    box.innerHTML = '<div class="notice warn">取り込んでいます…</div>';
    try {
      await saveSettings({ ...data.settings, calendars: readCals() });
      const r = await api('POST', '/api/calendar/refresh');
      data.ext = r.ext || [];
      lsSet(LS_CACHE, data);
      box.innerHTML = (r.report || []).map(x =>
        '<div class="notice ' + (x.ok ? 'ok' : 'err') + '">' + esc(x.name) + '：' +
        (x.ok ? x.count + '件 取り込みました' : esc(x.message)) + '</div>').join('') ||
        '<div class="notice warn">取り込むカレンダーがありません</div>';
      render();
    } catch (e) {
      box.innerHTML = '<div class="notice err">' + esc(e.message) + '</div>';
    }
  });
  document.getElementById('btn-copy-ics').addEventListener('click', () => {
    if (data.icsUrl) copyText(data.icsUrl, 'カレンダー用のURLをコピーしました');
  });
  document.getElementById('btn-save-items').addEventListener('click', async () => {
    await saveSettings({
      ...data.settings,
      defaultItems: document.getElementById('f-default-items').value.split('\n').map(s => s.trim()).filter(Boolean)
    });
    showToast('保存しました');
  });
  document.getElementById('btn-csv').addEventListener('click', exportCsv);
  document.getElementById('btn-export').addEventListener('click', () => {
    const payload = { app: 'pocket-hisho', at: new Date().toISOString(), events: data.events, tasks: data.tasks, settings: data.settings };
    if (downloadFile('pocket-hisho-' + todayStr() + '.json', JSON.stringify(payload, null, 2), 'application/json')) {
      showToast('書き出しました');
    }
  });
  document.getElementById('import-file').addEventListener('change', ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch { showToast('バックアップの中身が読めませんでした'); ev.target.value = ''; return; }
      const evs = Array.isArray(parsed.events) ? parsed.events : [];
      const tks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      askConfirm('読み込みますか',
        'いまの 予定' + data.events.length + '件・やること' + data.tasks.length + '件 は消えて、\n' +
        '予定' + evs.length + '件・やること' + tks.length + '件 に置きかわります。', '置きかえる',
        async () => {
          try {
            await api('POST', '/api/restore', parsed);
            await loadAll(true);
            closeSheet('sheet-settings');
            showToast('読み込みました');
          } catch (e) { showToast(e.message); }
        });
      ev.target.value = '';
    };
    reader.onerror = () => { showToast('ファイルが読めませんでした'); ev.target.value = ''; };
    reader.readAsText(file);
  });
  document.getElementById('btn-sample').addEventListener('click', addSample);
  document.getElementById('btn-unlock').addEventListener('click', async () => {
    try { await api('POST', '/api/login/unlock'); showToast('解除しました。もう一度お試しください'); }
    catch (e) { showToast(e.message); }
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
    askConfirm('ログアウトしますか', 'この端末から出ます。データはサーバーに残るので、合言葉を入れればまた見られます。', 'ログアウト', () => logout());
  });

  window.addEventListener('online', () => { setOnline(true); loadAll(false); });
  window.addEventListener('offline', () => setOnline(false));
  // ほかの端末で変えたぶんを取り込む（画面に戻ってきたとき）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.token) loadAll(false);
  });
}

/* =====================================================================
   16. 起動
   ===================================================================== */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/sw.js'); } catch { /* 使えなくても本体は動く */ }
}

/** 通知をタップして開いたときの行き先 */
function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  const d = p.get('d');
  if (isYmd(d)) { state.cursor = d; state.scope = 'day'; state.tab = 'schedule'; }
  if (p.get('tab') === 'task') state.tab = 'task';
  if (p.get('d') || p.get('tab')) history.replaceState(null, '', location.pathname);
}

async function init() {
  bindOnce();
  applyUrlParams();
  setOnline(navigator.onLine);

  if (!state.token) { showScreen('login'); return; }
  showScreen('app');

  // まず手元に残っている内容を出す（つながらなくても真っ白にしない）
  const cached = lsGet(LS_CACHE, null);
  if (cached) { data = { ...data, ...cached }; render(); }

  await registerServiceWorker();
  await loadAll(true);
}

init();

// 動作確認のときだけ使う窓口（ふだんの操作には影響しない）
window.pocketHisho = {
  getData: () => data,
  getState: () => state,
  render,
  reload: () => loadAll(false)
};
