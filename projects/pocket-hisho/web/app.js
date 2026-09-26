/* =====================================================================
   ポケット秘書 — アプリ本体

   ・データはサーバーに置く（スマホとパソコンで同じものが見える）
   ・電波が無いときは、この端末に覚えておいて、つながったらまとめて送る
   ・入力中は画面を描きなおさない（日本語入力の変換がとぎれるため）
   ・使う人は設定が苦手な前提。できることはアプリが自動でやり、
     人の手が要るところは「はじめの準備」で1手順ずつ案内する
   ===================================================================== */

import {
  todayStr, addDays, addMonths, addYears, mondayOf, weekdayOf, diffDays,
  fmtDay, fmtFull, isYmd, splitYmd, pad2, WEEKDAY, daysInMonth
} from './shared-date.js';
import {
  blankEvent, normalizeEvent, blankTask, normalizeTask,
  defaultSettings, normalizeSettings, eventLabel, eventStartTime, costOf, toYen, buildCostCsv
} from './shared-model.js';

/* =====================================================================
   1. 保存しておく場所（この端末の中）
   ===================================================================== */

const LS_TOKEN = 'ph:token';
const LS_CACHE = 'ph:cache';
const LS_QUEUE = 'ph:queue';
const LS_PUSH_OK = 'ph:push-ok';          // この端末で通知の登録まで済んだか
const LS_CAL_DONE = 'ph:cal-done';        // カレンダーのボタンを押したか
const LS_GUIDE_SEEN = 'ph:guide-seen';    // はじめの準備を自動で開いたことがあるか

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
  handoff: null,              // iPhone のホーム画面へ渡す6けたの番号 {code, expiresAt}
  gDraft: { clientId: '', clientSecret: '' }   // Google の身分証の書きかけ（描きなおしても消えないように）
};

let data = {
  events: [], tasks: [], settings: defaultSettings(), ext: [],
  vapidPublicKey: '', icsUrl: '', devices: [], calendarsLast: null,
  via: '', invite: null, passFromEnv: false,
  google: null                 // Googleカレンダーとのつながり {configured, connected, account, lastSyncAt, ...}
};

let editingEventId = null;
let editingTaskId = null;

/* Android の Chrome では「ホーム画面に追加」をアプリのボタンから出せる。
   その合図を取っておき、案内のボタンで使う。 */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (document.getElementById('sheet-guide').classList.contains('open')) renderGuide();
});
window.addEventListener('appinstalled', () => { installPrompt = null; renderGuideBanner(); });

/* =====================================================================
   3. 端末の見分け
   ===================================================================== */

const UA = navigator.userAgent;
function isIOS() { return /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isAndroid() { return /Android/.test(UA); }
function isMobile() { return isIOS() || isAndroid(); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
/** LINE などアプリの中のブラウザ（ここではホーム画面に追加できない） */
function isInAppBrowser() { return /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(UA); }
function isIOSSafari() { return isIOS() && /Safari/.test(UA) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(UA) && !isInAppBrowser(); }
function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function pushReady() {
  return pushSupported() && Notification.permission === 'granted' && lsGet(LS_PUSH_OK, false) === true;
}
function deviceLabel() {
  if (/iPhone/.test(UA)) return 'iPhone';
  if (/iPad/.test(UA)) return 'iPad';
  if (/Android/.test(UA)) return 'Android';
  if (/Mac/.test(UA)) return 'Mac';
  if (/Windows/.test(UA)) return 'Windows';
  return 'この端末';
}

/* =====================================================================
   4. サーバーとのやりとり
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
  if (res.status === 401 && state.token) { logout(true); throw new Error('ログインしてください'); }
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
      queue.shift(); lsSet(LS_QUEUE, queue); done++;
    } catch (e) {
      if (isNetworkError(e)) break;          // まだつながらない → 次の機会に
      queue.shift(); lsSet(LS_QUEUE, queue); // 内容が悪くて通らないものは捨てる（詰まり続けないため）
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

async function loadAll(showSpinner) {
  if (showSpinner) document.getElementById('head-sub').textContent = '読み込み中…';
  try {
    await flushQueue();
    const r = await api('GET', '/api/bootstrap');
    const wasConnected = !!(data.google && data.google.connected);
    data = {
      events: (r.events || []).map(normalizeEvent),
      tasks: (r.tasks || []).map(normalizeTask),
      settings: normalizeSettings(r.settings),
      ext: r.ext || [],
      vapidPublicKey: r.vapidPublicKey || '',
      icsUrl: r.icsUrl || '',
      devices: r.devices || [],
      calendarsLast: r.calendarsLast || null,
      via: r.via || 'pass',
      invite: r.invite || null,
      passFromEnv: !!r.passFromEnv,
      google: r.google || null,
      appLabel: r.appLabel || ''
    };
    applyAppLabel(data.appLabel);
    lsSet(LS_CACHE, data);
    setOnline(true);
    // Googleの許可画面から戻ってきたとき：つながったことを知らせ、案内を描きなおす
    if (!wasConnected && data.google && data.google.connected && state.token) {
      showToast('Googleカレンダーとつながりました');
      refreshGuideViews();
    }
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
   5. 入口（はじめての合言葉／合言葉／6けたの番号／招待リンク）
   ===================================================================== */

async function publicPost(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || '入れませんでした');
  return json;
}

function showLoginMode(mode, message) {
  for (const m of ['setup', 'pass', 'code']) document.getElementById('login-' + m).hidden = (m !== mode);
  document.getElementById('login-auto').hidden = (mode !== 'auto');
  const msg = document.getElementById('login-msg');
  msg.hidden = !message;
  msg.textContent = message || '';
  if (mode === 'code' && isStandalone()) {
    document.getElementById('code-hint').innerHTML =
      'ホーム画面のアイコンから開いたので、<b>もう一度だけ</b>入り直します。<br>' +
      'Safari の「はじめの準備」に出ていた<b>6けたの番号</b>を入れてください。<br>' +
      '番号が見当たらないときは、Safari でこのアプリを開くと新しい番号が出ます。';
  }
}

/**
 * テスト用など、同じアプリを2つ公開しているときの印。
 * ヘッダー・タブの題名・ホーム画面に追加したときの名前に付けて、講師用と取りちがえないようにする。
 */
function applyAppLabel(label) {
  const badge = document.getElementById('app-label');
  badge.hidden = !label;
  badge.textContent = label;
  if (!label) return;
  document.title = 'ポケット秘書（' + label + '）';
  const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (meta) meta.setAttribute('content', 'ポケット秘書' + label);
  // ホーム画面用の説明書も、名前に印が付いたもの（サーバーが作る）に差しかえる
  const link = document.getElementById('manifest-link');
  if (!/app\.webmanifest/.test(link.getAttribute('href'))) link.setAttribute('href', '/app.webmanifest');
}

/** ログインしていないとき、どの入口を見せるか決める */
async function showLogin(message) {
  showScreen('login');
  let setup = false;
  try {
    const res = await fetch('/api/setup-status');
    const st = await res.json();
    setup = st.needsSetup === true;
    applyAppLabel(st.appLabel || '');
  } catch { /* つながらないときは合言葉の画面を出しておく */ }
  if (setup) showLoginMode('setup', message);
  else if (isIOS() && isStandalone()) showLoginMode('code', message);   // Safari と保存場所が別なので番号で入り直す
  else showLoginMode('pass', message);
}

async function finishLogin(token) {
  state.token = token;
  lsSet(LS_TOKEN, token);
  ['f-pass', 'f-code', 'f-newpass', 'f-newpass2'].forEach(id => { document.getElementById(id).value = ''; });
  showScreen('app');
  await loadAll(true);
  await registerServiceWorker();
  ensurePushSubscription();
  maybePrepareHandoff();
  maybeOpenGuide();
}

async function withButton(btnId, busyText, fn) {
  const btn = document.getElementById(btnId);
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = busyText;
  try { await fn(); }
  catch (e) {
    const msg = document.getElementById('login-msg');
    msg.textContent = isNetworkError(e) ? 'インターネットにつながっていないようです' : e.message;
    msg.hidden = false;
  } finally { btn.disabled = false; btn.textContent = label; }
}

async function doSetup() {
  const p1 = document.getElementById('f-newpass').value;
  const p2 = document.getElementById('f-newpass2').value;
  const msg = document.getElementById('login-msg');
  if (p1.length < 8) { msg.textContent = '合言葉は8文字以上にしてください'; msg.hidden = false; return; }
  if (p1 !== p2) { msg.textContent = '2回入れた合言葉がちがいます'; msg.hidden = false; return; }
  await withButton('btn-setup', '準備しています…', async () => {
    const r = await publicPost('/api/setup', { pass: p1 });
    await finishLogin(r.token);
  });
}

async function doLogin() {
  const pass = document.getElementById('f-pass').value;
  const msg = document.getElementById('login-msg');
  if (!pass) { msg.textContent = '合言葉を入れてください'; msg.hidden = false; return; }
  await withButton('btn-login', '確認しています…', async () => {
    const r = await publicPost('/api/login', { pass });
    await finishLogin(r.token);
  });
}

async function doCodeLogin() {
  const code = document.getElementById('f-code').value.replace(/\D/g, '');
  const msg = document.getElementById('login-msg');
  if (code.length !== 6) { msg.textContent = '6けたの数字を入れてください'; msg.hidden = false; return; }
  await withButton('btn-code', '確認しています…', async () => {
    const r = await publicPost('/api/redeem', { code });
    await finishLogin(r.token);
  });
}

function logout(silent) {
  state.token = '';
  [LS_TOKEN, LS_CACHE, LS_QUEUE, LS_PUSH_OK].forEach(lsDel);
  closeAllSheets();
  showLogin(silent ? '' : 'ログアウトしました');
}

function showScreen(which) {
  document.getElementById('screen-login').hidden = (which !== 'login');
  document.getElementById('screen-app').hidden = (which !== 'app');
}

/* =====================================================================
   6. 予定・タスクの取り出し
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
function nextEventFrom(dateStr) { return sortedEvents().find(e => e.date >= dateStr) || null; }

/** 期間の中の件数と、かかったお金の合計 */
function costOfRange(fromStr, toStr) {
  const sum = { count: 0, fare: 0, hotel: 0, other: 0, total: 0 };
  for (const e of sortedEvents()) {
    if (e.date < fromStr || e.date > toStr) continue;
    const c = costOf(e);
    sum.count++; sum.fare += c.fare; sum.hotel += c.hotel; sum.other += c.other; sum.total += c.total;
  }
  return sum;
}

/* =====================================================================
   7. 画面に出すための小道具
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
  showToast._t = setTimeout(() => el.classList.remove('show'), duration || 2600);
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
   8. はじめの準備（1手順ずつ案内する）
   ----------------------------------------------------------------
   使う人は設定が苦手な前提。できることはアプリが先回りしてやり、
   人の手が要るところだけを、いまやる1手順として大きく見せる。
   終わったかどうかは、できるだけアプリが自分で見分ける。
   ===================================================================== */

function isOwner() { return data.via === 'setup' || data.via === 'pass'; }

function googleReady() { return !!(data.google && data.google.configured); }
function googleOn() { return !!(data.google && data.google.connected); }

function guideSteps() {
  const steps = [];
  if (isOwner()) {
    // 講師の方が「Googleカレンダーとつなぐ」を押せるように、先に身分証を登録しておく
    steps.push({ id: 'gsetup', title: 'Googleカレンダーとつなぐ準備をする', sub: 'Google Cloud で作る「クライアントID」を登録します（最初の1回だけ・30分ほど）', done: googleReady() });
    steps.push({ id: 'invite', title: '講師の方に招待リンクを送る', sub: 'LINEで送れます。合言葉を伝えなくても入ってもらえます', done: !!data.invite });
  }
  if (isMobile()) {
    steps.push({ id: 'install', title: 'ホーム画面に追加する', sub: 'アプリのように、1タップで開けるようにします', done: isStandalone() });
  }
  steps.push({
    id: 'notify', title: '通知をオンにする', sub: '時間が来たら、スマホにお知らせが届きます',
    done: pushReady(), optional: !isMobile() || isOwner()
  });
  // Googleとつなぐのは講師の方。ただしテスト用のアプリでは、伊神さんが自分のGoogleでつないで試す
  if (!isOwner() || data.appLabel) {
    if (googleReady() || googleOn() || (data.google && data.google.needsReconnect)) {
      steps.push({ id: 'google', title: 'Googleカレンダーとつなぐ', sub: 'アプリ・Googleカレンダー・iPhoneのカレンダーの予定が、1つにまとまります', done: googleOn() });
    } else {
      steps.push({ id: 'calendar', title: 'いつものカレンダーにも表示する', sub: 'なくても大丈夫です', done: lsGet(LS_CAL_DONE, false) === true, optional: true });
    }
  }
  return steps;
}
function remainingRequired() { return guideSteps().filter(s => !s.done && !s.optional); }

function maybeOpenGuide() {
  if (!remainingRequired().length) return;
  if (lsGet(LS_GUIDE_SEEN, false)) return;     // 自動で開くのは、この端末で1回だけ（あとは上の帯で知らせる）
  lsSet(LS_GUIDE_SEEN, true);
  openGuide();
}
function openGuide() { renderGuide(); openSheet('sheet-guide'); }

function renderGuideBanner() {
  const box = document.getElementById('guide-banner');
  const left = remainingRequired();
  if (!state.token || !left.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<button class="guide-banner" id="guide-banner-btn">' +
    '<span>🚀</span><span class="gbt"><b>はじめの準備 あと' + left.length + 'つ</b>' + esc(left[0].title) + '</span>' +
    '<span class="gbgo">つづける ›</span></button>';
  document.getElementById('guide-banner-btn').addEventListener('click', openGuide);
}

function renderGuide() {
  const steps = guideSteps();
  const nowIndex = steps.findIndex(s => !s.done);
  let h = '<p class="guide-intro">' +
    (nowIndex < 0 ? '🎉 <b>準備はぜんぶ終わりました。</b>あとは予定を入れるだけです。'
      : '上から順に進めてください。<b>むずかしいところは、アプリが自動でやります。</b>') + '</p>';

  steps.forEach((s, i) => {
    const cls = s.done ? 'done' : (i === nowIndex ? 'now' : 'todo');
    h += '<div class="guide-step ' + cls + '"><div class="gh">' +
      '<div class="num">' + (s.done ? '✓' : (i + 1)) + '</div>' +
      '<div><div class="gt">' + esc(s.title) + (s.optional ? '（なくてもOK）' : '') + '</div>' +
      '<div class="gs">' + esc(s.done ? 'できています' : s.sub) + '</div></div></div>';
    if (!s.done || s.id === 'notify' || s.id === 'invite' || s.id === 'google') h += '<div class="gb">' + guideBody(s) + '</div>';
    h += '</div>';
  });
  h += '<button class="btn wide" data-g="close">' + (nowIndex < 0 ? 'はじめる' : 'あとでやる') + '</button>';

  const body = document.getElementById('guide-body');
  body.innerHTML = h;
  bindGuide(body);
}

function guideBody(step) {
  if (step.id === 'install') return installBody();
  if (step.id === 'notify') return notifyBody(step.done);
  if (step.id === 'calendar') return calendarButtonsHtml();
  if (step.id === 'invite') return inviteHtml();
  if (step.id === 'gsetup') return googleSetupHtml();
  if (step.id === 'google') return googleConnectHtml();
  return '';
}

/* --- ① ホーム画面に追加 --- */
function installBody() {
  if (isInAppBrowser()) {
    return 'いまは <b>LINE などのアプリの中</b>で開いています。ここではホーム画面に追加できません。' +
      '<ol><li>画面の右上（または右下）の <b>︙</b> や <b>共有</b> を押す</li>' +
      '<li><b>「ブラウザで開く」</b>（iPhoneは「Safariで開く」）を選ぶ</li></ol>' +
      '<button class="btn wide" data-g="copy-url">このページのリンクをコピーする</button>';
  }
  if (isAndroid()) {
    if (installPrompt) {
      return '<button class="btn primary wide" data-g="install">ホーム画面に追加する</button>' +
        '<div class="gs" style="margin-top:6px">押すと確認が出るので「インストール」または「追加」を押してください。</div>';
    }
    return '<ol><li>右上の <b>︙</b> を押す</li><li><b>「ホーム画面に追加」</b>（または「アプリをインストール」）を押す</li>' +
      '<li>ホーム画面にできた <b>ポケット秘書</b> のアイコンから開き直す</li></ol>';
  }
  // iPhone / iPad
  let h = '';
  if (!isIOSSafari()) h += '<div class="notice warn">いまのブラウザより、<b>Safari</b> で開くのが確実です。</div>';
  h += '<ol>' +
    '<li>画面の下（または上）にある <b>共有ボタン</b> <span class="share-ic" aria-hidden="true"></span> を押す</li>' +
    '<li>下へずらして <b>「ホーム画面に追加」</b> を押す</li>' +
    '<li>右上の <b>「追加」</b> を押す</li>' +
    '<li>ホーム画面にできた <b>ポケット秘書</b> のアイコンから開く</li></ol>';
  if (state.handoff) {
    h += '<div class="gs" style="margin-top:8px">ホーム画面のアプリで「番号」を聞かれたら、これを入れてください（24時間有効）：</div>' +
      '<div class="big-code" id="handoff-code">' + esc(state.handoff.code.slice(0, 3) + ' ' + state.handoff.code.slice(3)) + '</div>' +
      '<div class="gs">※ ふつうは自動で入れるので、聞かれないこともあります。</div>' +
      '<button class="btn wide" data-g="new-handoff">番号を出し直す</button>';
  } else {
    h += '<div class="gs" style="margin-top:8px">ホーム画面のアプリに入るための番号を用意しています…</div>';
  }
  return h;
}

/* --- ② 通知 --- */
function notifyBody(done) {
  if (done) {
    return '<div class="notice ok"><b>通知はオンです</b>この端末で受け取れます。</div>' +
      '<button class="btn wide" data-g="test-push">テスト通知を送る</button>';
  }
  if (isIOS() && !isStandalone()) {
    return '<div class="notice warn"><b>先に「ホーム画面に追加」をしてください</b>' +
      'iPhone は、ホーム画面のアイコンから開いたときだけ通知をオンにできます。</div>';
  }
  if (!pushSupported()) {
    return '<div class="notice err"><b>このブラウザは通知に対応していません</b>' +
      'iPhone は Safari（iOS 16.4以降）、Android は Chrome でお試しください。</div>';
  }
  if (Notification.permission === 'denied') {
    return '<div class="notice err"><b>通知が「許可しない」になっています</b>' +
      (isIOS() ? '「設定」アプリ →「通知」→「ポケット秘書」→「通知を許可」をオンにして、もう一度ここを押してください。'
        : 'アドレスバーの 🔒 や ⓘ → 「通知」→「許可」に変えて、もう一度ここを押してください。') + '</div>' +
      '<button class="btn primary wide" data-g="enable-push">もう一度ためす</button>';
  }
  return '<button class="btn primary wide" data-g="enable-push">通知をオンにする</button>' +
    '<div class="gs" style="margin-top:6px">確認が出たら<b>「許可」</b>を押してください。そのあと、自動でテスト通知を送ります。</div>';
}

/* --- ③ カレンダー（ボタン1つで登録画面まで連れていく） --- */
function calendarLinks() {
  if (!data.icsUrl) return null;
  const webcal = data.icsUrl.replace(/^https?:\/\//, 'webcal://');
  return {
    apple: webcal,                                                           // iPhone・Mac：押すと「照会しますか」が出る
    google: 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal)   // Googleカレンダーの追加画面が開く
  };
}
function calendarButtonsHtml() {
  const l = calendarLinks();
  if (!l) return '<div class="gs">つながったときに、ボタンが出ます。</div>';
  const apple = '<a class="btn wide" data-g="cal" href="' + esc(l.apple) + '">📅 iPhoneのカレンダーに表示</a>';
  const google = '<a class="btn wide" data-g="cal" target="_blank" rel="noopener" href="' + esc(l.google) + '">🗓 Googleカレンダーに表示</a>';
  return '<div class="gs" style="margin-bottom:6px">ふだん見ているカレンダーの方を<b>1つだけ</b>押してください' +
    '（両方押すと、同じ予定が2つずつ出ることがあります）。</div>' +
    (isAndroid() ? google + apple : apple + google) +
    '<div class="gs" style="margin-top:6px">開いた画面で<b>「照会」</b>（iPhone）か<b>「追加」</b>（Google）を押せば終わり。' +
    '<b>やるのは最初の1回だけ</b>で、あとは自動で並びます（iPhoneは15分〜1時間、Googleは数時間〜1日ほどで反映）。</div>';
}

/* --- ⑤ Googleカレンダー（アプリ・Google・iPhoneの予定を1つにする） --- */
const GOOGLE_SETUP_DOC = 'https://github.com/gamigamiigami/Workspace/blob/claude/new-tool-creation-klodhg/projects/pocket-hisho/SETUP.md';

/** 伊神さん用：Google Cloud で作った身分証（クライアントID・シークレット）を登録する欄 */
function googleSetupHtml() {
  if (!state.online) return '<div class="gs">つながったときに登録できます。</div>';
  const g = data.google || {};
  const d = state.gDraft;
  return '<div class="gs" style="margin-bottom:6px">アプリが講師の方のGoogleカレンダーに書きこむための「身分証」を、Googleで作って登録します。' +
    '<b>お金はかかりません。</b>手順は<a href="' + GOOGLE_SETUP_DOC + '" target="_blank" rel="noopener">手順書（SETUP.md）の⑦</a>にあります。</div>' +
    '<ol class="g-steps">' +
    '<li><a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud</a> でプロジェクトを作る</li>' +
    '<li>「Google Calendar API」を<b>有効</b>にする</li>' +
    '<li>同意画面を作り、<b>「本番環境」に公開</b>する（しないと7日でつながりが切れます）</li>' +
    '<li>「OAuth クライアント ID」を<b>ウェブ アプリケーション</b>で作り、下の<b>リダイレクトURI</b>を登録する</li>' +
    '<li>できた<b>クライアントID</b>と<b>シークレット</b>を下に貼って「保存する」</li></ol>' +
    '<div class="field"><label>リダイレクトURI（コピーして Google Cloud に貼る）</label>' +
    '<div class="copybox"><code>' + esc(g.redirectUri || '') + '</code><button class="btn" data-g="g-copy-redirect">コピー</button></div></div>' +
    '<div class="field"><label>クライアントID</label>' +
    '<input type="text" class="g-in" data-gd="clientId" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
    'placeholder="1234…apps.googleusercontent.com" value="' + esc(d.clientId || g.clientId || '') + '"></div>' +
    '<div class="field"><label>クライアントシークレット</label>' +
    '<input type="password" class="g-in" data-gd="clientSecret" autocomplete="off" spellcheck="false" ' +
    'placeholder="' + (g.configured ? '（登録済み。変えるときだけ貼る）' : 'GOCSPX-…') + '" value="' + esc(d.clientSecret || '') + '"></div>' +
    '<button class="btn primary wide" data-g="g-save">保存する</button>';
}

/** 講師の方用：つなぐボタン・つながっているときの様子 */
function googleConnectHtml() {
  const g = data.google || {};
  if (!state.online) return '<div class="gs">つながったときに操作できます。</div>';
  if (g.connected) {
    const t = g.lastSyncAt ? new Date(g.lastSyncAt) : null;
    return '<div class="notice ok"><b>Googleカレンダーとつながっています</b>' + esc(g.account || '') +
      (t ? '<br>最後に同期：' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : '') + '</div>' +
      (g.error ? '<div class="notice warn">' + esc(g.error) + '</div>' : '') +
      '<div class="gs">アプリで入れた予定は<b>数秒で</b>Googleに、Google・iPhoneで入れた予定は<b>1分以内に</b>アプリに入ります。</div>' +
      '<button class="btn wide" data-g="g-sync">いま同期する</button>' +
      '<details class="g-more"><summary>iPhoneのカレンダーにも出すには</summary><div class="gs">' +
      'iPhoneの「設定」→「カレンダー」→「アカウント」に <b>Google</b> が入っていれば、そのまま出ます。' +
      '入っていなければ「アカウントを追加」→「Google」で、このGoogleアカウントを入れてください。<br>' +
      '前に「iPhoneのカレンダーに表示」「Googleカレンダーに表示」を押していたら、そのカレンダーは消してください（同じ予定が2つずつ出るため）。</div></details>' +
      '<button class="btn danger wide" data-g="g-disconnect">Googleとのつながりを切る</button>';
  }
  if (!g.configured && !g.needsReconnect) {
    return '<div class="gs">伊神さんの準備（Google Cloud の設定）がすむと、ここでGoogleカレンダーとつなげます。</div>';
  }
  let h = '';
  if (g.needsReconnect) h += '<div class="notice err"><b>Googleとのつながりが切れました</b>' + esc(g.error || 'もう一度つないでください') + '</div>';
  // テスト用のアプリでは、伊神さんが自分のGoogleでつないで試す
  const ownerOnly = isOwner() && !data.appLabel;
  if (ownerOnly) {
    h += '<div class="notice warn"><b>このボタンは、講師の方のスマホで押してもらうものです</b>' +
      '伊神さんのGoogleでつなぐと、伊神さんのカレンダーの予定が講師の方のアプリに入ってしまいます。</div>';
  } else if (isOwner()) {
    h += '<div class="notice ok"><b>' + esc(data.appLabel) + 'のアプリです</b>伊神さん自身のGoogleでつないで試して大丈夫です（講師の方のアプリとは別のデータです）。</div>';
  }
  h += '<button class="btn ' + (ownerOnly ? '' : 'primary ') + 'wide" data-g="g-connect">' + (g.needsReconnect ? 'もう一度つなぐ' : 'Googleカレンダーとつなぐ') + '</button>';
  if (ownerOnly) return h;                       // 手順は講師の方の画面にだけ出す
  h += '<div class="gs" style="margin-top:6px">Googleの画面が開きます。' +
    '<ol class="g-steps">' +
    '<li>いつも使っている <b>Googleアカウント</b> を選ぶ</li>' +
    '<li>「<b>このアプリは Google で確認されていません</b>」と出たら、<b>「詳細」</b>→<b>「ポケット秘書（安全ではないページ）に移動」</b>' +
    '（伊神さんが作った個人用のアプリで、Googleの審査を受けていないという意味です）</li>' +
    '<li><b>「カレンダーの予定の表示と編集」にチェック</b>を入れて「続行」</li>' +
    '<li>「つながりました」と出たら、その画面を閉じてアプリに戻る</li></ol></div>';
  return h;
}

/* --- ④ 招待リンク --- */
function inviteMessage(url) {
  return 'ポケット秘書の招待です。\n下のリンクを押すと、合言葉なしで入れます（14日間有効）。\n' + url +
    '\n開いたら、画面の「はじめの準備」にそって進めてください。';
}
function inviteHtml() {
  if (!state.online) return '<div class="gs">つながったときに作れます。</div>';
  if (!data.invite) {
    return '<button class="btn primary wide" data-g="invite-new">招待リンクを作る</button>';
  }
  const until = new Date(data.invite.expiresAt);
  return '<div class="copybox"><code>' + esc(data.invite.url) + '</code></div>' +
    '<div class="gs">' + (until.getMonth() + 1) + '月' + until.getDate() + '日まで使えます</div>' +
    '<a class="btn primary wide" data-g="invite-line" target="_blank" rel="noopener" href="https://line.me/R/share?text=' +
    encodeURIComponent(inviteMessage(data.invite.url)) + '">LINEで送る</a>' +
    '<button class="btn wide" data-g="invite-copy">リンクをコピーする</button>' +
    '<button class="btn wide" data-g="invite-new">新しいリンクに作り直す</button>' +
    '<button class="btn danger wide" data-g="invite-revoke">このリンクを使えなくする</button>';
}

/** 案内の中のボタン（はじめの準備と設定画面の両方で使う） */
function bindGuide(root) {
  root.querySelectorAll('[data-g]').forEach(el => {
    const g = el.dataset.g;
    el.addEventListener('click', async (ev) => {
      if (g === 'close') { closeSheet('sheet-guide'); renderGuideBanner(); }
      else if (g === 'install' && installPrompt) {
        installPrompt.prompt();
        const r = await installPrompt.userChoice.catch(() => null);
        installPrompt = null;
        if (r && r.outcome === 'accepted') showToast('ホーム画面に追加しました。そこから開き直してください');
        refreshGuideViews();
      }
      else if (g === 'copy-url') copyText(location.origin + '/', 'リンクをコピーしました');
      else if (g === 'new-handoff') { await prepareHandoff(true); refreshGuideViews(); }
      else if (g === 'enable-push') { await enablePush(); refreshGuideViews(); }
      else if (g === 'test-push') sendTestPush();
      else if (g === 'cal') { lsSet(LS_CAL_DONE, true); setTimeout(refreshGuideViews, 400); }
      else if (g === 'invite-new') { await makeInvite(); refreshGuideViews(); }
      else if (g === 'g-copy-redirect') { if (data.google) copyText(data.google.redirectUri, 'リダイレクトURIをコピーしました'); }
      else if (g === 'g-save') await saveGoogleApp(root);
      else if (g === 'g-connect') await connectGoogle();
      else if (g === 'g-sync') await syncGoogle();
      else if (g === 'g-disconnect') {
        askConfirm('Googleとのつながりを切りますか', 'アプリの予定は残ります。切ったあとに入れた予定は、Googleには出なくなります。', '切る', async () => {
          try { data.google = await api('POST', '/api/google/disconnect'); lsSet(LS_CACHE, data); showToast('つながりを切りました'); refreshGuideViews(); }
          catch (e) { showToast(e.message); }
        });
      }
      else if (g === 'invite-copy') { if (data.invite) copyText(inviteMessage(data.invite.url), '招待の文とリンクをコピーしました'); }
      else if (g === 'invite-line') { /* リンクがそのまま開く */ }
      else if (g === 'invite-revoke') {
        ev.preventDefault();
        askConfirm('招待リンクを使えなくしますか', 'すでに入っている人は、そのまま使えます。', '使えなくする', async () => {
          try { await api('DELETE', '/api/invite'); data.invite = null; showToast('使えなくしました'); refreshGuideViews(); }
          catch (e) { showToast(e.message); }
        });
      }
    });
  });
}

/* 書きかけの身分証を覚えておく（描きなおしても消えないように） */
document.addEventListener('input', (e) => {
  const k = e.target && e.target.dataset && e.target.dataset.gd;
  if (k) state.gDraft[k] = e.target.value;
});

async function saveGoogleApp(root) {
  const val = k => { const el = root.querySelector('[data-gd="' + k + '"]'); return el ? el.value.trim() : ''; };
  try {
    data.google = await api('PUT', '/api/google/app', { clientId: val('clientId'), clientSecret: val('clientSecret') });
    state.gDraft = { clientId: '', clientSecret: '' };
    lsSet(LS_CACHE, data);
    showToast('登録しました。講師の方のスマホで「Googleカレンダーとつなぐ」を押してもらってください', 5000);
    refreshGuideViews();
  } catch (e) { showToast(e.message, 5000); }
}

async function connectGoogle() {
  try {
    const r = await api('POST', '/api/google/auth');
    location.href = r.url;                      // Googleの許可画面へ（終わったら戻ってくる）
  } catch (e) { showToast(e.message, 5000); }
}

async function syncGoogle() {
  try {
    const r = await api('POST', '/api/google/sync');
    data.events = (r.events || []).map(normalizeEvent);
    data.google = r.google || data.google;
    lsSet(LS_CACHE, data);
    const p = r.pull || {};
    showToast(p.added || p.changed || p.removed
      ? '同期しました（新しく' + (p.added || 0) + '件・直った' + (p.changed || 0) + '件・消えた' + (p.removed || 0) + '件）'
      : '同期しました（変わったところはありません）');
    render();
    refreshGuideViews();
  } catch (e) { showToast(e.message); }
}

/** 案内が出ている場所をまとめて描きなおす */
function refreshGuideViews() {
  if (document.getElementById('sheet-guide').classList.contains('open')) renderGuide();
  if (document.getElementById('sheet-settings').classList.contains('open')) renderSettingsLive();
  renderGuideBanner();
}

async function makeInvite() {
  try {
    const r = await api('POST', '/api/invite');
    data.invite = { url: r.url, expiresAt: r.expiresAt };
    lsSet(LS_CACHE, data);
    showToast('招待リンクを作りました。「LINEで送る」から送れます');
  } catch (e) { showToast(e.message); }
}

/* --- iPhone：ホーム画面のアプリへログインを引き継ぐ ---
   ホーム画面に追加したアプリは Safari と保存場所が別なので、そのままだと
   もう一度ログインが要る。そこで6けたの番号を用意して、
   ① ページのURL と ② ホーム画面用の説明書（manifest）の開始URL の両方に入れておく。
   ホーム画面から開いた瞬間にその番号で自動的に入れる。
   うまく渡らなかったときは、画面に出ている番号を手で入れてもらう。 */
function maybePrepareHandoff() {
  if (isIOS() && !isStandalone() && state.token && state.online) prepareHandoff(false);
}
async function prepareHandoff(force) {
  try {
    if (force || !state.handoff || state.handoff.expiresAt < Date.now() + 3600000) {
      state.handoff = await api('POST', '/api/handoff');
    }
    history.replaceState(null, '', '/?h=' + state.handoff.code);
    document.getElementById('manifest-link').setAttribute('href', '/app.webmanifest?h=' + state.handoff.code);
    if (document.getElementById('sheet-guide').classList.contains('open')) renderGuide();
  } catch { /* つながらないときは、あとでもう一度 */ }
}

/* =====================================================================
   9. 描画
   ===================================================================== */

function render() {
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  document.getElementById('bar-schedule').hidden = (state.tab !== 'schedule');
  document.getElementById('bar-task').hidden = (state.tab !== 'task');
  document.getElementById('btn-add').hidden = (state.tab === 'notify');
  renderGuideBanner();

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
    '入れるのは<strong>日付だけ</strong>でかまいません。会場や運賃は、分かったときに足せます。</div>' +
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
    html += '<div class="card"><div class="sec"><h3>☑️ この日が期限のやること</h3></div>' + tks.map(taskRowHtml).join('') + '</div>';
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
    h += '<div class="sec"><h3>📝 話す内容</h3>';
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

  const linked = data.tasks.filter(t => t.eventId === ev.id);
  if (linked.length) h += '<div class="sec"><h3>☑️ この予定のやること</h3></div>' + linked.map(taskRowHtml).join('');

  /* かかったお金（運賃・ホテル代・その他） */
  const c = costOf(ev);
  h += '<div class="sec"><h3>💴 かかったお金</h3>';
  if (c.total) {
    h += '<div class="rows">';
    if (c.fare) h += '<div class="cost-row"><span>🚄 運賃</span><span class="y">' + yen(c.fare) + '</span></div>';
    if (c.hotel) h += '<div class="cost-row"><span>🏨 ホテル代</span><span class="y">' + yen(c.hotel) + '</span></div>';
    if (c.other) h += '<div class="cost-row"><span>💴 ' + esc(ev.cost.otherNote || 'その他') + '</span><span class="y">' + yen(c.other) + '</span></div>';
    h += '</div><div class="total-line"><div>合計</div><div>' + yen(c.total) + '</div></div>';
  } else {
    h += '<div class="sub">まだ入っていません。</div>';
  }
  h += '<div class="actions"><button class="act" data-act="edit-cost" data-id="' + esc(ev.id) + '">' +
    (c.total ? '✏️ 金額を直す' : '🚄 運賃・ホテル代を入れる') + '</button></div></div>';

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
  const c = costOfRange(start, addDays(start, 6));
  h += '<div class="card"><div class="sec"><h3>この週</h3><div class="big">' + c.count + '件' +
    (c.total ? '　かかったお金 ' + yen(c.total) : '') + '</div></div></div>';
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
    if (i === 34) { const nx = splitYmd(addDays(gridStart, 35)); if (nx.m !== p.m || nx.y !== p.y) break; }
  }
  h += '</div><div class="legend">' +
    '<span><i class="dot sem"></i>セミナー</span><span><i class="dot ext"></i>カレンダー</span>' +
    '<span><i class="dot stay"></i>宿泊</span><span><i class="dot task"></i>やること</span></div></div>';

  const c = costOfRange(first, last);
  h += '<div class="card"><div class="sec"><h3>' + p.m + '月のまとめ</h3>' +
    '<div class="big">' + c.count + '件' + (c.total ? '　かかったお金 ' + yen(c.total) : '') + '</div>' +
    (c.total ? '<div class="sub">運賃 ' + yen(c.fare) + '／ホテル代 ' + yen(c.hotel) + (c.other ? '／その他 ' + yen(c.other) : '') + '</div>' : '') +
    '</div>' + listHtml(first, last) + '</div>';
  return h;
}

function listHtml(fromStr, toStr) {
  const list = sortedEvents().filter(e => e.date >= fromStr && e.date <= toStr);
  if (!list.length) return '<div class="sec"><div class="sub">予定はありません。</div></div>';
  return list.map(e => {
    const c = costOf(e);
    const sub = [];
    if (has(e.contact.org)) sub.push(esc(e.contact.org));
    if (c.total) sub.push('<span class="amt">' + yen(c.total) + '</span>');
    return '<button class="list-item" data-act="goto" data-date="' + esc(e.date) + '">' +
      '<div class="ld">' + esc(fmtDay(e.date)) + '</div>' +
      '<div class="lb"><div class="lt">' + esc(e.venue.place || eventLabel(e)) + '</div>' +
      '<div class="ls">' + sub.join('　/　') + '</div></div></button>';
  }).join('');
}

/* ---------- 年 ---------- */
function renderYear() {
  const y = splitYmd(state.cursor).y;
  const c = costOfRange(y + '-01-01', y + '-12-31');
  let h = '<div class="card"><div class="sum-grid">' +
    '<div class="sum-row"><div class="k">セミナー</div><div class="v">' + c.count + '件</div></div>' +
    '<div class="sum-row"><div class="k">🚄 運賃</div><div class="v">' + yen(c.fare) + '</div></div>' +
    '<div class="sum-row"><div class="k">🏨 ホテル代</div><div class="v">' + yen(c.hotel) + '</div></div>' +
    (c.other ? '<div class="sum-row"><div class="k">💴 その他</div><div class="v">' + yen(c.other) + '</div></div>' : '') +
    '<div class="sum-row total"><div class="k">かかったお金</div><div class="big-num">' + yen(c.total) + '</div></div>' +
    '</div></div>';

  const months = [];
  let max = 0;
  for (let m = 1; m <= 12; m++) {
    const r = costOfRange(y + '-' + pad2(m) + '-01', y + '-' + pad2(m) + '-' + pad2(daysInMonth(y, m)));
    months.push(r);
    if (r.total > max) max = r.total;
  }
  h += '<div class="card"><div class="sec"><h3>月ごとの件数と、かかったお金</h3></div>';
  months.forEach((r, i) => {
    const pct = max > 0 ? Math.round(r.total / max * 100) : 0;
    h += '<div class="bar-row"><div class="m">' + (i + 1) + '月</div>' +
      '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div>' +
      '<div class="v">' + (r.count ? r.count + '件 ' : '') + (r.total ? Number(r.total).toLocaleString('ja-JP') : '') + '</div></div>';
  });
  h += '<div class="sec"><button class="btn wide" data-act="csv-year" data-year="' + y + '">📄 この年の表を書き出す（エクセル用）</button></div></div>';
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
      (state.taskFilter === 'done' ? 'おわったやることはまだありません' : 'やることはありません') +
      (state.taskFilter === 'open' ? '<div class="sub" style="margin-top:6px">右下の「＋」で足せます</div>' : '') + '</div></div>';
  }
  list.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.due || '9999-99-99', bd = b.due || '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.title || '') < (b.title || '') ? -1 : 1;
  });
  const groups = [
    { label: '⚠ 期限がすぎています', test: t => !t.done && isYmd(t.due) && t.due < today },
    { label: 'きょうまで', test: t => !t.done && t.due === today },
    { label: '3日以内', test: t => !t.done && isYmd(t.due) && t.due > today && diffDays(today, t.due) <= 3 },
    { label: 'そのあと', test: t => !t.done && isYmd(t.due) && diffDays(today, t.due) > 3 },
    { label: '期限なし', test: t => !t.done && !isYmd(t.due) },
    { label: 'おわった', test: t => t.done }
  ];
  let h = '<div class="card">';
  for (const g of groups) {
    const items = list.filter(g.test);
    if (!items.length) continue;
    h += '<div class="task-group">' + g.label + '（' + items.length + '）</div>' + items.map(taskRowHtml).join('');
  }
  return h + '</div>';
}

/* ---------- 通知タブ ---------- */
function renderNotify() {
  const n = data.settings.notify;
  const rules = [];
  if (n.rules.d1) rules.push('前日');
  if (n.rules.h2) rules.push('2時間前');
  if (n.rules.m30) rules.push('30分前');

  let h = '';
  if (!pushReady()) {
    h += '<div class="card"><div class="sec"><h3>🔔 この端末</h3>' +
      '<div class="big">まだ通知が届かない状態です</div>' +
      '<div class="sub">「はじめの準備」で、1手順ずつ案内します。</div>' +
      '<div class="actions"><button class="act" data-act="guide">🚀 はじめの準備をひらく</button></div></div></div>';
  }
  h += '<div class="card"><div class="sec"><h3>🔔 通知のようす</h3>';
  h += '<div class="big">' + (n.on ? 'オン' : 'オフ') + (pushReady() ? '（この端末に届きます）' : '') + '</div>';
  h += '<div class="sub">予定：' + (rules.length ? rules.join('・') : '（どれも選ばれていません）') + '</div>';
  h += '<div class="sub">やること：' + esc(n.taskAt) + '／毎朝のまとめ：' + (n.digestAt ? esc(n.digestAt) : 'なし') + '</div>';
  h += '<div class="sub">通知を受け取る端末：' + data.devices.length + '台</div>';
  h += '<div class="actions"><button class="act" data-act="settings">⚙ 設定をひらく</button></div>';
  h += '</div></div>';

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

  if (data.calendarsLast && (data.calendarsLast.report || []).length) {
    const at = new Date(data.calendarsLast.at);
    h += '<div class="card"><div class="sec"><h3>カレンダーの取り込み</h3>' +
      '<div class="sub">最終：' + at.toLocaleString('ja-JP') + '</div>' +
      (data.calendarsLast.report || []).map(r =>
        '<div class="sub">' + (r.ok ? '✅' : '⚠️') + ' ' + esc(r.name || '(名前なし)') + '：' +
        (r.ok ? r.count + '件' : esc(r.message)) + '</div>').join('') + '</div></div>';
  }
  return h;
}

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
      else if (act === 'edit-cost') openEventEditor(el.dataset.id, 'cost');
      else if (act === 'add-event') openEventEditor(null);
      else if (act === 'add-task-for') openTaskEditor(null, el.dataset.id);
      else if (act === 'edit-task') openTaskEditor(el.dataset.id);
      else if (act === 'toggle-task') toggleTask(el.dataset.id);
      else if (act === 'sample') addSample();
      else if (act === 'copy') copyText(el.dataset.text, '住所をコピーしました');
      else if (act === 'settings') openSettings();
      else if (act === 'guide') openGuide();
      else if (act === 'csv-year') exportCsv(el.dataset.year);
    });
  });
}
function scrollTop() { window.scrollTo(0, 0); }

/* =====================================================================
   10. 変更（画面を先に直してから、サーバーへ送る）
   ===================================================================== */

async function saveEvent(ev, quiet) {
  const i = data.events.findIndex(e => e.id === ev.id);
  if (i >= 0) data.events[i] = ev; else data.events.push(ev);
  lsSet(LS_CACHE, data);
  render();
  const r = await apiWrite('PUT', '/api/events', ev);
  if (!quiet) showToast(r && r.queued ? '保存しました（つながったら送ります）' : '保存しました');
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
  await saveEvent(normalizeEvent(ev), true);
}
async function saveSettings(next) {
  data.settings = normalizeSettings(next);
  lsSet(LS_CACHE, data);
  const r = await apiWrite('PUT', '/api/settings', data.settings);
  if (r && r.settings) data.settings = normalizeSettings(r.settings);
  render();
}

/* =====================================================================
   11. 予定の入力シート
   ===================================================================== */

const val = id => document.getElementById(id).value.trim();
const setVal = (id, v) => { document.getElementById(id).value = (v === 0 ? '' : (v || '')); };

/* たたみ式の欄。中身が入っていれば開いておき、見出しの横に中身の一部を出す */
const FOLDS = [
  { id: 'fold-travel', hint: 'sum-travel', of: ev => ev.cost.fare ? yen(ev.cost.fare) : (ev.travelGo.route || ev.travelBack.route || '') },
  { id: 'fold-stay', hint: 'sum-stay', of: ev => ev.cost.hotel ? yen(ev.cost.hotel) : ev.stay.place },
  { id: 'fold-other', hint: 'sum-other', of: ev => ev.cost.other ? yen(ev.cost.other) + (ev.cost.otherNote ? '（' + ev.cost.otherNote + '）' : '') : '' },
  { id: 'fold-contact', hint: 'sum-contact', of: ev => ev.contact.org || ev.contact.person || ev.contact.tel || ev.venue.note },
  { id: 'fold-schedule', hint: 'sum-schedule', of: ev => ev.schedule.length ? ev.schedule.length + '行' : '' },
  { id: 'fold-content', hint: 'sum-content', of: ev => ev.content.audience || ev.content.materials || (ev.content.note ? 'メモあり' : '') },
  { id: 'fold-items', hint: 'sum-items', of: ev => ev.items.length ? ev.items.length + '個' : '' },
  { id: 'fold-memo', hint: 'sum-memo', of: ev => (ev.memo ? 'メモあり' : '') + (ev.remindOff ? (ev.memo ? '・' : '') + '通知しない' : '') }
];

function openEventEditor(id, focus) {
  const ev = id ? data.events.find(e => e.id === id) : null;
  editingEventId = ev ? ev.id : null;
  fillEventEditor(ev || Object.assign(blankEvent(), { date: state.cursor }));
  document.getElementById('ev-title').textContent = ev ? '予定を編集' : '予定を追加';
  document.getElementById('ev-delete').style.display = ev ? '' : 'none';
  openSheet('sheet-event');
  if (focus === 'cost') {
    document.getElementById('fold-travel').open = true;
    document.getElementById('fold-stay').open = true;
    setTimeout(() => {
      const f = document.getElementById('f-fare');
      f.scrollIntoView({ block: 'center' });
      f.focus({ preventScroll: true });
    }, 80);
  }
}

function fillEventEditor(ev) {
  setVal('f-date', ev.date); setVal('f-title', ev.title);
  setVal('f-arrive', ev.arriveTime); setVal('f-open', ev.openTime); setVal('f-end', ev.endTime);
  setVal('f-place', ev.venue.place); setVal('f-address', ev.venue.address); setVal('f-vnote', ev.venue.note);
  setVal('f-org', ev.contact.org); setVal('f-person', ev.contact.person);
  setVal('f-tel', ev.contact.tel); setVal('f-email', ev.contact.email);
  setVal('f-fare', ev.cost.fare); setVal('f-hotel', ev.cost.hotel);
  setVal('f-other', ev.cost.other); setVal('f-other-note', ev.cost.otherNote);
  setVal('f-go-time', ev.travelGo.time); setVal('f-go-route', ev.travelGo.route);
  setVal('f-back-time', ev.travelBack.time); setVal('f-back-route', ev.travelBack.route);
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

  for (const f of FOLDS) {
    const hint = f.of(ev) || '';
    document.getElementById(f.hint).textContent = hint ? '… ' + hint : '';
    document.getElementById(f.id).open = !!hint;
  }
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

function readEventEditor() {
  const base = editingEventId ? data.events.find(e => e.id === editingEventId) : null;
  const ev = base ? JSON.parse(JSON.stringify(base)) : blankEvent();

  ev.date = val('f-date'); ev.title = val('f-title');
  ev.arriveTime = val('f-arrive'); ev.openTime = val('f-open'); ev.endTime = val('f-end');
  ev.venue = { place: val('f-place'), address: val('f-address'), note: val('f-vnote') };
  ev.contact = { org: val('f-org'), person: val('f-person'), tel: val('f-tel'), email: val('f-email') };
  ev.travelGo = { time: val('f-go-time'), mins: (base && base.travelGo.mins) || '', route: val('f-go-route') };
  ev.travelBack = { time: val('f-back-time'), mins: (base && base.travelBack.mins) || '', route: val('f-back-route') };
  ev.stay = { place: val('f-stay-place'), date: val('f-stay-date'), tel: val('f-stay-tel'), address: val('f-stay-address'), note: val('f-stay-note') };
  ev.content = { audience: val('f-audience'), people: val('f-people'), materials: val('f-materials'), note: document.getElementById('f-cnote').value.trim() };
  ev.cost = { fare: toYen(val('f-fare')), hotel: toYen(val('f-hotel')), other: toYen(val('f-other')), otherNote: val('f-other-note') };
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
  delete ev.money;
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
   12. やることの入力シート
   ===================================================================== */

function openTaskEditor(id, eventId) {
  const t = id ? data.tasks.find(x => x.id === id) : null;
  editingTaskId = t ? t.id : null;
  const base = t || Object.assign(blankTask(), { eventId: eventId || '', due: state.tab === 'schedule' ? state.cursor : '' });
  setVal('t-title', base.title); setVal('t-due', base.due); setVal('t-duetime', base.dueTime); setVal('t-note', base.note);
  document.getElementById('t-remindoff').checked = !!base.remindOff;

  const sel = document.getElementById('t-event');
  const choices = sortedEvents().filter(e => e.date >= addDays(todayStr(), -60));
  sel.innerHTML = '<option value="">（ひもづけない）</option>' +
    choices.map(e => '<option value="' + esc(e.id) + '"' + (e.id === base.eventId ? ' selected' : '') + '>' +
      esc(fmtDay(e.date) + ' ' + eventLabel(e)) + '</option>').join('');

  document.getElementById('tk-title').textContent = t ? 'やることを編集' : 'やることを追加';
  document.getElementById('tk-delete').style.display = t ? '' : 'none';
  openSheet('sheet-task');
}

async function saveTaskEditor() {
  const base = editingTaskId ? data.tasks.find(x => x.id === editingTaskId) : blankTask();
  const t = normalizeTask({
    ...base, title: val('t-title'), due: val('t-due'), dueTime: val('t-duetime'),
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
   13. 設定
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

  document.getElementById('ics-url').textContent = data.icsUrl || '（つながったときに出ます）';
  document.getElementById('pass-area').hidden = !!data.passFromEnv;
  fillCsvYears();
  document.getElementById('about-text').innerHTML =
    'データはインターネット上（Cloudflare）に保管され、スマホとパソコンで同じものが見えます。<br>' +
    'この端末の表示：' + (isStandalone() ? '<b>ホーム画面から起動</b>' : 'ブラウザ') + '<br>' +
    '送信待ち：' + lsGet(LS_QUEUE, []).length + '件';
  renderSettingsLive();
  // 「くわしい設定」は開くたびに閉じた状態から（ふだん使う項目だけが見えるように）
  document.getElementById('fold-advanced').open = false;
  openSheet('sheet-settings');
}

/** 設定画面のうち、状況で中身が変わる部分（通知・カレンダー・招待） */
function renderSettingsLive() {
  renderPushStatus();
  // Googleカレンダー：伊神さんには準備の欄、講師の方には「つなぐ」ボタン
  const ga = document.getElementById('google-area');
  ga.innerHTML = (isOwner() && !googleReady())
    ? googleSetupHtml()
    : googleConnectHtml() + (isOwner()
        ? '<details class="g-more"><summary>身分証（クライアントID）を登録し直す</summary>' + googleSetupHtml() + '</details>' : '');
  bindGuide(ga);
  // Googleとつなぐなら、購読（照会）のボタンは要らない（同じ予定が2つずつ出てしまう）
  document.getElementById('cal-box').hidden = googleReady() || googleOn();
  const cal = document.getElementById('cal-buttons');
  cal.innerHTML = calendarButtonsHtml();
  bindGuide(cal);
  const inv = document.getElementById('invite-area');
  inv.innerHTML = inviteHtml();
  bindGuide(inv);
  const devices = document.getElementById('device-list');
  devices.innerHTML = data.devices.length
    ? '<div class="field"><div class="hint">通知を受け取る端末：' + data.devices.map(d => esc(d.label || '端末')).join('、') + '</div></div>' : '';
}

function calRow(name, url) {
  return repRow([mkInput('text', '名前', name, 'flex:none;width:110px'),
    mkInput('text', 'https://calendar.google.com/calendar/ical/.../basic.ics', url, 'flex:1;min-width:0')]);
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

/* =====================================================================
   14. 通知
   ===================================================================== */

function renderPushStatus() {
  const box = document.getElementById('push-status');
  const btn = document.getElementById('btn-enable-push');
  const test = document.getElementById('btn-test-push');
  if (pushReady()) {
    box.innerHTML = '<div class="notice ok"><b>通知はオンです</b>この端末で受け取れます。</div>';
    btn.hidden = true; test.hidden = false; test.disabled = false;
    return;
  }
  box.innerHTML = notifyBody(false);
  bindGuide(box);
  btn.hidden = true;                    // ボタンは案内の中に出している
  test.hidden = true;
}

function b64urlToUint8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 通知の宛先を作って、サーバーに登録する。できたら true */
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    if (!data.vapidPublicKey) throw new Error('サーバーの準備がまだです。少し待ってからお試しください');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToUint8(data.vapidPublicKey) });
  }
  await api('POST', '/api/push/subscribe', { subscription: sub.toJSON(), label: deviceLabel() });
  lsSet(LS_PUSH_OK, true);
  return true;
}

/** ボタンから：許可をもらって登録し、すぐにテスト通知を送る */
async function enablePush() {
  if (!pushSupported()) { showToast('このブラウザは通知に対応していません'); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { lsSet(LS_PUSH_OK, false); showToast('通知が許可されませんでした'); return; }
    await subscribePush();
    await refreshDevices();
    await sendTestPush(true);
  } catch (e) {
    lsSet(LS_PUSH_OK, false);
    showToast('通知をオンにできませんでした：' + e.message);
  }
}

/** 起動のたびに、そっと登録し直す。
    端末が通知の宛先を作り直したり、サーバー側で消えたりしても、
    使う人が何もしなくても届くようにするため。 */
async function ensurePushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  if (isIOS() && !isStandalone()) return;
  if (!state.online) return;
  try { await subscribePush(); await refreshDevices(); }
  catch { lsSet(LS_PUSH_OK, false); }
  renderGuideBanner();
}

async function refreshDevices() {
  try { const r = await api('GET', '/api/bootstrap'); data.devices = r.devices || []; lsSet(LS_CACHE, data); }
  catch { /* 表示用なので失敗してもよい */ }
}

async function sendTestPush(auto) {
  try {
    const r = await api('POST', '/api/push/test');
    showToast(r.sent ? (auto ? '通知をオンにしました。テスト通知を送ったので、届いたか見てください' : 'テスト通知を送りました')
      : '送れませんでした（登録されている端末がありません）', 4000);
  } catch (e) { showToast(e.message); }
}

/* =====================================================================
   15. 書き出し・見本・コピー
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
  } catch { showToast('書き出せませんでした'); return false; }
}

function copyText(text, okMessage) {
  const done = () => showToast(okMessage || 'コピーしました');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
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

function exportCsv(year) {
  const y = year || document.getElementById('f-csv-year').value;
  const csv = buildCostCsv(sortedEvents(), y);
  if (!csv) { showToast(y + '年の運賃・ホテル代の記録がありません'); return; }
  // 先頭の BOM は、エクセルで開いたときに日本語が化けないようにするための印
  downloadFile('pocket-hisho-' + y + '.csv', '﻿' + csv, 'text/csv;charset=utf-8');
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
    travelGo: { time: '09:03', route: '名古屋→新大阪 のぞみ21号' },
    travelBack: { time: '18:12', route: '新大阪→名古屋 のぞみ56号' },
    stay: { place: 'サンプルホテル新大阪', date: addDays(base, -1), tel: '06-9999-0000', address: '大阪市淀川区西中島3-1-1', note: '15:00イン／朝食つき' },
    content: { audience: '管理職', people: '40', materials: '資料50部／スライドA', note: '前回は「傾聴」中心。今回は「叱り方」を厚めに。' },
    items: [{ text: 'マイク', done: true }, { text: '資料50部', done: false }, { text: '名刺', done: false }],
    cost: { fare: 28400, hotel: 9800, other: 0, otherNote: '' },
    memo: 'これは見本です。編集画面の「この予定を消す」で消せます。'
  });
  closeAllSheets();
  state.cursor = base; state.scope = 'day'; state.tab = 'schedule';
  await saveEvent(s);
  await saveTask(normalizeTask({ id: 'sample_t1', title: '（見本）資料を50部 印刷する', due: addDays(base, -1), eventId: 'sample_1' }));
  scrollTop();
}

/* =====================================================================
   16. シートの開け閉め
   ===================================================================== */

function openSheet(id) {
  const el = document.getElementById(id);
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); el.scrollTop = 0;
}
function closeSheet(id) {
  const el = document.getElementById(id);
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
}
function closeAllSheets() { ['sheet-event', 'sheet-task', 'sheet-settings', 'sheet-guide'].forEach(closeSheet); }

/* =====================================================================
   17. ボタンのつなぎこみ
   ===================================================================== */

function moveCursor(step) {
  if (state.scope === 'day') state.cursor = addDays(state.cursor, step);
  else if (state.scope === 'week') state.cursor = addDays(state.cursor, step * 7);
  else if (state.scope === 'month') state.cursor = addMonths(state.cursor, step);
  else state.cursor = addYears(state.cursor, step);
  render();
}

function onEnter(id, fn) {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) fn(); });
}

function bindOnce() {
  /* 入口 */
  document.getElementById('btn-setup').addEventListener('click', doSetup);
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('btn-code').addEventListener('click', doCodeLogin);
  document.getElementById('btn-to-code').addEventListener('click', () => showLoginMode('code'));
  document.getElementById('btn-to-pass').addEventListener('click', () => showLoginMode('pass'));
  onEnter('f-newpass2', doSetup);
  onEnter('f-pass', doLogin);
  onEnter('f-code', doCodeLogin);

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
  document.getElementById('guide-close').addEventListener('click', () => { closeSheet('sheet-guide'); renderGuideBanner(); });

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
  document.getElementById('add-default-items').addEventListener('click', () => {
    const list = data.settings.defaultItems;
    if (!list.length) { showToast('設定の「くわしい設定」で、よく持っていくものを登録できます'); return; }
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
  document.getElementById('btn-open-guide').addEventListener('click', () => { closeSheet('sheet-settings'); openGuide(); });
  document.getElementById('btn-enable-push').addEventListener('click', async () => { await enablePush(); refreshGuideViews(); });
  document.getElementById('btn-test-push').addEventListener('click', () => sendTestPush(false));
  document.getElementById('btn-save-notify').addEventListener('click', async () => {
    await saveSettings({
      ...data.settings,
      notify: {
        on: document.getElementById('n-on').checked,
        rules: { d1: document.getElementById('n-d1').checked, h2: document.getElementById('n-h2').checked, m30: document.getElementById('n-m30').checked },
        digestAt: val('n-digest'), allDayAt: val('n-allday'), taskAt: val('n-task'),
        quietFrom: val('n-quiet-from'), quietTo: val('n-quiet-to')
      }
    });
    showToast('通知の設定を保存しました');
  });
  document.getElementById('add-cal').addEventListener('click', () => document.getElementById('rep-cals').appendChild(calRow('', '')));
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
    } catch (e) { box.innerHTML = '<div class="notice err">' + esc(e.message) + '</div>'; }
  });
  document.getElementById('btn-copy-ics').addEventListener('click', () => { if (data.icsUrl) copyText(data.icsUrl, 'カレンダー用のURLをコピーしました'); });
  document.getElementById('btn-save-items').addEventListener('click', async () => {
    await saveSettings({ ...data.settings, defaultItems: document.getElementById('f-default-items').value.split('\n').map(s => s.trim()).filter(Boolean) });
    showToast('保存しました');
  });
  document.getElementById('btn-csv').addEventListener('click', () => exportCsv());
  document.getElementById('btn-export').addEventListener('click', () => {
    const payload = { app: 'pocket-hisho', at: new Date().toISOString(), events: data.events, tasks: data.tasks, settings: data.settings };
    if (downloadFile('pocket-hisho-' + todayStr() + '.json', JSON.stringify(payload, null, 2), 'application/json')) showToast('書き出しました');
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
          try { await api('POST', '/api/restore', parsed); await loadAll(true); closeSheet('sheet-settings'); showToast('読み込みました'); }
          catch (e) { showToast(e.message); }
        });
      ev.target.value = '';
    };
    reader.onerror = () => { showToast('ファイルが読めませんでした'); ev.target.value = ''; };
    reader.readAsText(file);
  });
  document.getElementById('btn-pass-change').addEventListener('click', async () => {
    const next = document.getElementById('f-pass-next').value;
    if (next.length < 8) { showToast('合言葉は8文字以上にしてください'); return; }
    try { await api('POST', '/api/pass', { next }); document.getElementById('f-pass-next').value = ''; showToast('合言葉を変えました'); }
    catch (e) { showToast(e.message); }
  });
  document.getElementById('btn-sample').addEventListener('click', addSample);
  document.getElementById('btn-unlock').addEventListener('click', async () => {
    try { await api('POST', '/api/login/unlock'); showToast('解除しました。もう一度お試しください'); }
    catch (e) { showToast(e.message); }
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
    askConfirm('ログアウトしますか', 'この端末から出ます。データはサーバーに残るので、また入れば見られます。', 'ログアウト', () => logout());
  });

  window.addEventListener('online', () => { setOnline(true); if (state.token) loadAll(false); });
  window.addEventListener('offline', () => setOnline(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.token) return;
    loadAll(false);
    renderGuideBanner();          // 設定アプリで通知を許可して戻ってきたとき等に、案内を合わせる
  });
}

/* =====================================================================
   18. 起動
   ===================================================================== */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/sw.js'); } catch { /* 使えなくても本体は動く */ }
}

/** URLについてきたものを読み、アドレス欄からは消しておく */
function readUrlParams() {
  const p = new URLSearchParams(location.search);
  const out = { invite: p.get('invite') || '', handoff: p.get('h') || '' };
  const d = p.get('d');
  if (isYmd(d)) { state.cursor = d; state.scope = 'day'; state.tab = 'schedule'; }
  if (p.get('tab') === 'task') state.tab = 'task';
  if ([...p.keys()].length) history.replaceState(null, '', location.pathname);
  return out;
}

async function init() {
  bindOnce();
  const params = readUrlParams();
  setOnline(navigator.onLine);

  /* 招待リンク・引き継ぎ番号で開かれたら、そのまま自動で入る */
  const code = params.invite || params.handoff;
  if (code && !state.token) {
    showScreen('login');
    showLoginMode('auto');
    try {
      const r = await publicPost('/api/redeem', { code });
      await finishLogin(r.token);
      showToast(params.invite ? 'ようこそ。招待リンクで入りました' : 'ホーム画面のアプリに入りました');
      return;
    } catch (e) {
      await showLogin(e.message);
      return;
    }
  }

  if (!state.token) { await showLogin(); return; }
  showScreen('app');

  // まず手元に残っている内容を出す（つながらなくても真っ白にしない）
  const cached = lsGet(LS_CACHE, null);
  if (cached) { data = { ...data, ...cached }; render(); }

  await registerServiceWorker();
  await loadAll(true);
  ensurePushSubscription();
  maybePrepareHandoff();
  maybeOpenGuide();
}

init();

// 動作確認のときだけ使う窓口（ふだんの操作には影響しない）
window.pocketHisho = {
  getData: () => data,
  getState: () => state,
  render,
  reload: () => loadAll(false),
  guideSteps,
  openGuide
};
