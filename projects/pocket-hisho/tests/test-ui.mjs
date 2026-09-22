/* ポケット秘書 — アプリ画面の検証（wrangler dev を動かした状態で実行する）
   実行:
     npx wrangler dev --config wrangler.test.toml --local --port 8788 &
     node tests/test-ui.mjs                                                */

import { chromium } from 'playwright';
import { todayStr, addDays, fmtFull } from '../web/shared-date.js';
import { defaultSettings } from '../web/shared-model.js';

const BASE = process.env.PH_BASE || 'http://127.0.0.1:8788';
const PASS = 'test-pass-1234';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

/* 読みやすさ（コントラスト比）を測る */
function parseRgb(s) { const m = String(s).match(/(\d+(?:\.\d+)?)/g); return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0]; }
function lum(rgb) {
  const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const la = lum(parseRgb(a)), lb = lum(parseRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  serviceWorkers: 'allow'
});
const page = await ctx.newPage();
/* 本物のJSエラー（プログラムが落ちた）と、通信の失敗ログは分けて数える。
   「電波を切ったので通信に失敗した」は想定どおりの出来事で、不具合ではない。 */
const jsErrors = [];
const httpFails = [];
page.on('pageerror', e => jsErrors.push(String(e)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon/i.test(t)) return;
  if (/Failed to load resource/i.test(t)) return;   // 通信ログ。下の httpFails で別に見る
  jsErrors.push('console: ' + t);
});
page.on('requestfailed', r => httpFails.push('失敗 ' + new URL(r.url()).pathname + ' … ' + (r.failure() && r.failure().errorText)));
page.on('response', r => { if (r.status() >= 400) httpFails.push(r.status() + ' ' + new URL(r.url()).pathname); });

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const adminToken = (await api('POST', '/api/login', { pass: PASS })).json.token;

/* どの順番で流しても同じ結果になるよう、はじめに中身を空にする
   （前に流したテストの予定やカレンダーが残っていると、数が合わなくなる） */
await api('POST', '/api/restore', {
  events: [{ id: 'ui_reset_marker', date: '2020-01-01', title: 'reset' }],
  tasks: [], settings: defaultSettings()
}, adminToken);
await api('DELETE', '/api/events/ui_reset_marker', undefined, adminToken);
await api('POST', '/api/calendar/refresh', undefined, adminToken);   // 取り込み済みの予定も消す
const startState = (await api('GET', '/api/bootstrap', undefined, adminToken)).json;
if (startState.events.length || startState.tasks.length || startState.ext.length) {
  console.log('⚠ 開始時に中身が残っています:', startState.events.length, startState.tasks.length, startState.ext.length);
}

/* =================================================================== */
console.log('\n【1】ログイン画面');
/* =================================================================== */

await page.goto(BASE);
await page.waitForTimeout(600);
ok('ログイン画面が出る', await page.isVisible('#screen-login'));
ok('アプリ画面はまだ隠れている', !(await page.isVisible('#screen-app')));

await page.click('#btn-login');
await page.waitForTimeout(300);
ok('合言葉が空なら案内が出る', (await page.textContent('#login-msg')).includes('合言葉'));

await page.fill('#f-pass', 'まちがい');
await page.click('#btn-login');
await page.waitForTimeout(800);
ok('まちがった合言葉では入れない', await page.isVisible('#screen-login'));
ok('まちがいの理由が出る', (await page.textContent('#login-msg')).includes('合言葉'), await page.textContent('#login-msg'));

await page.fill('#f-pass', PASS);
await page.click('#btn-login');
await page.waitForTimeout(1500);
ok('正しい合言葉で入れる', await page.isVisible('#screen-app'));
ok('合言葉の入力欄は空に戻る', (await page.inputValue('#f-pass')) === '');
ok('予定が無いので案内が出る', (await page.textContent('#view')).includes('まだ予定がありません'));

/* =================================================================== */
console.log('\n【2】予定を入れる');
/* =================================================================== */

const DAY = addDays(todayStr(), 3);
await page.click('#btn-add');
await page.waitForTimeout(400);
ok('入力シートが開く', await page.isVisible('#sheet-event'));

await page.fill('#f-date', '');
await page.click('#ev-save');
await page.waitForTimeout(300);
ok('日付なしでは保存されない', await page.isVisible('#sheet-event'));
ok('理由が画面に出る', (await page.textContent('#toast')).includes('日付'));

await page.fill('#f-date', DAY);
await page.fill('#f-title', '管理職向け コミュニケーション研修');
await page.fill('#f-open', '13:30');
await page.fill('#f-arrive', '12:30');
await page.fill('#f-place', '大阪産業創造館 5Fホール');
await page.fill('#f-address', '大阪市中央区本町1-4-5');
await page.fill('#f-tel', '06-1234-5678');
await page.$eval('#rep-money .rep-row', r => {
  r.querySelectorAll('input[type=text]')[0].value = '講演料';
  r.querySelectorAll('input[type=text]')[1].value = '80,000';
});
await page.click('#ev-save');
await page.waitForTimeout(1200);
ok('保存するとシートが閉じる', !(await page.isVisible('#sheet-event')));

const dayText = await page.textContent('#view');
ok('その日へ移動して予定が出る', dayText.includes('管理職向け'), dayText.slice(0, 120));
ok('会場が出る', dayText.includes('大阪産業創造館'));
ok('カウントダウンが出る', dayText.includes('あと3日'));
ok('カンマ入りの金額が数として入る', dayText.includes('80,000円'));
eq('日付の見出しが合っている', await page.textContent('#date-label'), fmtFull(DAY));

// サーバー側にも入っているか
const onServer = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('サーバーにも1件保存されている', onServer.json.events.length, 1);
eq('サーバー側の題名も一致', onServer.json.events[0].title, '管理職向け コミュニケーション研修');

/* =================================================================== */
console.log('\n【3】別の端末から見えるか（同期）');
/* =================================================================== */

const page2 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page2.goto(BASE);
await page2.waitForTimeout(500);
await page2.fill('#f-pass', PASS);
await page2.click('#btn-login');
await page2.waitForTimeout(1500);
await page2.evaluate(d => { const s = window.pocketHisho.getState(); s.cursor = d; s.scope = 'day'; window.pocketHisho.render(); }, DAY);
await page2.waitForTimeout(300);
ok('パソコン側でも同じ予定が見える', (await page2.textContent('#view')).includes('管理職向け'));
const ovfPc = await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('パソコン幅でも横スクロールが出ない', ovfPc <= 0, 'overflow=' + ovfPc);

/* =================================================================== */
console.log('\n【4】日・週・月・年');
/* =================================================================== */

for (const [scope, must, mustNot] of [
  ['week', '大阪産業創造館', '06-1234-5678'],
  ['month', '1件', '会場入り'],
  ['year', '80,000円', '大阪市中央区']
]) {
  await page.click('#scope button[data-scope="' + scope + '"]');
  await page.waitForTimeout(300);
  const t = await page.textContent('#view');
  ok(scope + '：必要な情報が出る', t.includes(must), t.slice(0, 100));
  ok(scope + '：詳細は出さない', !t.includes(mustNot));
}
await page.click('#scope button[data-scope="month"]');
await page.waitForTimeout(300);
const dots = await page.$$eval('#view .cal-cell .dot.sem', d => d.length);
eq('カレンダーにセミナーの印が1つ', dots, 1);
await page.click('#view .cal-cell .dot.sem >> xpath=../..');
await page.waitForTimeout(400);
ok('印をタップすると日の画面に着地する', (await page.textContent('#view')).includes('管理職向け'));

/* =================================================================== */
console.log('\n【5】やること');
/* =================================================================== */

await page.click('#tabbar button[data-tab="task"]');
await page.waitForTimeout(300);
ok('やることタブに切りかわる', (await page.textContent('#view')).includes('やることはありません'));
ok('日付バーは隠れる', !(await page.isVisible('#bar-schedule')));
ok('絞りこみバーが出る', await page.isVisible('#bar-task'));

await page.click('#btn-add');
await page.waitForTimeout(400);
ok('やることの入力シートが開く', await page.isVisible('#sheet-task'));
await page.click('#tk-save');
await page.waitForTimeout(300);
ok('名前が空なら保存されない', await page.isVisible('#sheet-task'));

await page.fill('#t-title', '資料を50部 印刷する');
await page.fill('#t-due', addDays(todayStr(), 1));
const opts = await page.$$eval('#t-event option', os => os.map(o => o.textContent));
ok('ひもづけ先に、いまの予定がならぶ', opts.some(o => o.includes('管理職向け')), JSON.stringify(opts));
await page.selectOption('#t-event', { index: 1 });
await page.click('#tk-save');
await page.waitForTimeout(1000);

const taskText = await page.textContent('#view');
ok('やることが一覧に出る', taskText.includes('資料を50部'));
ok('期限が「あと1日」と出る', taskText.includes('あと1日'), taskText.slice(0, 200));
eq('下のナビに残り件数が出る', await page.textContent('#task-badge'), '1');

// 終わりにする
await page.click('#view .task-row .box');
await page.waitForTimeout(800);
ok('終わったやることは「のこり」から消える', !(await page.textContent('#view')).includes('資料を50部'));
ok('残り件数の印が消える', await page.isHidden('#task-badge'));
await page.click('#task-filter button[data-filter="done"]');
await page.waitForTimeout(300);
ok('「おわった」で見つかる', (await page.textContent('#view')).includes('資料を50部'));

// 予定の画面にも、ひもづいたやることが出る
await page.click('#task-filter button[data-filter="open"]');
await page.click('#tabbar button[data-tab="schedule"]');
await page.waitForTimeout(400);
ok('予定の画面に、ひもづくやることが出る', (await page.textContent('#view')).includes('資料を50部'));

/* 予定を消すと、ひもづくやることも消える（サーバー側の動きが画面にも反映されるか） */
await page.click('#view button[data-act="edit-event"]');
await page.waitForTimeout(400);
await page.click('#ev-delete');
await page.waitForTimeout(300);
await page.click('#modal-yes');
await page.waitForTimeout(1000);
const afterDelete = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('サーバーから予定が消える', afterDelete.json.events.length, 0);
eq('ひもづくやることも消える', afterDelete.json.tasks.length, 0);
await page.click('#tabbar button[data-tab="task"]');
await page.waitForTimeout(300);
ok('画面のやることも消えている', !(await page.textContent('#view')).includes('資料を50部'));

/* =================================================================== */
console.log('\n【6】通知タブ・設定');
/* =================================================================== */

await page.click('#tabbar button[data-tab="notify"]');
await page.waitForTimeout(400);
const notifyText = await page.textContent('#view');
ok('通知のようすが出る', notifyText.includes('通知のようす'));
ok('オン・オフが出る', /オン|オフ/.test(notifyText));
ok('追加ボタンは隠れる', await page.isHidden('#btn-add'));

await page.click('#btn-settings');
await page.waitForTimeout(600);
ok('設定が開く', await page.isVisible('#sheet-settings'));
const icsUrl = await page.textContent('#ics-url');
ok('カレンダー購読用のURLが出ている', /\/ics\/[0-9a-f]{24,}\.ics$/.test(icsUrl), icsUrl);

// 通知の設定を変えて保存
await page.uncheck('#n-h2');
await page.fill('#n-digest', '06:45');
await page.click('#btn-save-notify');
await page.waitForTimeout(900);
const st = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('2時間前を切った設定が保存される', st.json.settings.notify.rules.h2, false);
eq('毎朝のまとめの時刻が保存される', st.json.settings.notify.digestAt, '06:45');

// 持ち物のひな形
await page.fill('#f-default-items', 'マイク\n名刺\n電源タップ');
await page.click('#btn-save-items');
await page.waitForTimeout(800);
const st2 = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('よく持っていくものが保存される', st2.json.settings.defaultItems, ['マイク', '名刺', '電源タップ']);

/* パソコンのブラウザでは、通知の案内がどう出るか */
const pushBox = await page.textContent('#push-status');
ok('通知の状態が案内される', pushBox.length > 5, pushBox.slice(0, 80));

await page.click('#st-close');
await page.waitForTimeout(300);

/* 持ち物のひな形が、予定の入力で使えるか */
await page.click('#tabbar button[data-tab="schedule"]');
await page.click('#btn-add');
await page.waitForTimeout(400);
await page.click('#add-default-items');
await page.waitForTimeout(300);
const itemVals = await page.$$eval('#rep-items input[type=text]', is => is.map(i => i.value).filter(Boolean));
eq('よく持っていくものが入る', itemVals, ['マイク', '名刺', '電源タップ']);
await page.click('#add-default-items');
await page.waitForTimeout(300);
const itemVals2 = await page.$$eval('#rep-items input[type=text]', is => is.map(i => i.value).filter(Boolean));
eq('二度押しても重複しない', itemVals2.length, 3);
await page.click('#ev-cancel');
await page.waitForTimeout(300);

/* =================================================================== */
console.log('\n【7】オフラインでも使えるか');
/* =================================================================== */

// 見本を入れてから
await page.click('#btn-settings');
await page.waitForTimeout(400);
await page.click('#btn-sample');
await page.waitForTimeout(1500);
ok('見本が入る', (await page.textContent('#view')).includes('管理職向け'));

// サービスワーカーが登録されているか
const swReady = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'なし';
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? 'あり' : 'まだ';
});
ok('サービスワーカーが登録されている', swReady === 'あり', swReady);
await page.waitForTimeout(1500);   // 画面ファイルが端末に取り込まれるのを待つ

/* ここは一度つまずいた場所。
   取っておいた画面が「転送された結果」だと、ブラウザは画面をひらく用途に使えず
   オフラインで真っ白になる。取り置きが転送ぬきであることを確かめておく。 */
const shellInfo = await page.evaluate(async () => {
  const r = await caches.match('/');
  return r ? { status: r.status, redirected: r.redirected, type: r.type } : null;
});
ok('アプリ画面が端末に取っておかれている', !!shellInfo, JSON.stringify(shellInfo));
ok('取り置きが「転送された結果」になっていない', shellInfo && shellInfo.redirected === false, JSON.stringify(shellInfo));

await ctx.setOffline(true);
await page.reload();
await page.waitForTimeout(1500);
ok('電波が無くても画面が出る（真っ白にならない）', await page.isVisible('#screen-app'));
ok('つながっていない印が出る', await page.isVisible('#net-bar'));
const offlineText = await page.textContent('#view');
ok('前に見ていた予定が出る', offlineText.includes('管理職向け'), offlineText.slice(0, 120));

// オフラインのまま編集 → ためておく
await page.click('#btn-add');
await page.waitForTimeout(400);
await page.fill('#f-date', addDays(todayStr(), 10));
await page.fill('#f-title', '電波が無いときに入れた予定');
await page.click('#ev-save');
await page.waitForTimeout(1000);
ok('オフラインでも保存できる', (await page.textContent('#view')).includes('電波が無いときに入れた予定'));
const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('ph:queue') || '[]').length);
ok('送れなかったぶんが取ってある', queued >= 1, 'queue=' + queued);

// つながったら送られる
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(2500);
const afterOnline = await api('GET', '/api/bootstrap', undefined, adminToken);
ok('つながったら、ためた分がサーバーに届く',
  afterOnline.json.events.some(e => e.title === '電波が無いときに入れた予定'),
  JSON.stringify(afterOnline.json.events.map(e => e.title)));
const queuedAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('ph:queue') || '[]').length);
eq('送り終えたら、ためた分は空になる', queuedAfter, 0);
ok('つながっていない印が消える', await page.isHidden('#net-bar'));

/* =================================================================== */
console.log('\n【8】スマホでの触りやすさ・見やすさ');
/* =================================================================== */

await page.evaluate(d => { const s = window.pocketHisho.getState(); s.cursor = d; s.scope = 'day'; s.tab = 'schedule'; window.pocketHisho.render(); }, addDays(todayStr(), 3));
await page.waitForTimeout(400);

/* チェックボックスは、それを包んでいる <label> が押せる場所になる。
   見た目の四角ではなく「実際に指が当たる範囲」で測る。 */
const small = await page.$$eval('button, a.act, .btn, select, input[type=checkbox]', els => {
  const target = e => (e.type === 'checkbox' && e.closest('label')) ? e.closest('label') : e;
  return els.map(e => {
    const t = target(e);
    const r = t.getBoundingClientRect();
    return { id: (e.id || e.className || e.tagName), w: Math.round(r.width), h: Math.round(r.height) };
  }).filter(o => o.w > 0 && o.h > 0 && (o.h < 44 || o.w < 44));
});
ok('タップ領域が44px未満のボタンがない', small.length === 0,
  small.slice(0, 4).map(o => o.id + ' ' + o.w + 'x' + o.h).join(' / '));

const tiny = await page.$$eval('#view *', els =>
  els.filter(e => e.children.length === 0 && e.textContent.trim())
    .map(e => ({ t: e.textContent.trim().slice(0, 10), s: parseFloat(getComputedStyle(e).fontSize) }))
    .filter(o => o.s < 12));
ok('本文に12px未満の文字がない', tiny.length === 0, JSON.stringify(tiny));

for (const w of [390, 768, 1280]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(250);
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(w + 'px で横スクロールが出ない', o <= 0, 'overflow=' + o);
}
await page.setViewportSize({ width: 390, height: 844 });

// 入力シートもはみ出さないか
await page.click('#btn-add');
await page.waitForTimeout(400);
const ovfSheet = await page.evaluate(() => { const s = document.getElementById('sheet-event'); return s.scrollWidth - s.clientWidth; });
ok('入力シートが横にはみ出さない', ovfSheet <= 0, 'overflow=' + ovfSheet);
const timeW = await page.$$eval('#f-arrive, #f-open, #f-end', els => els.map(e => Math.round(e.getBoundingClientRect().width)));
ok('時刻の入力欄が130px以上（文字が切れない）', timeW.length === 3 && timeW.every(w => w >= 130), JSON.stringify(timeW));
await page.click('#ev-cancel');
await page.waitForTimeout(300);

// 下のナビに隠れないか
const hidden = await page.evaluate(() => {
  const bar = document.getElementById('tabbar').getBoundingClientRect();
  const last = document.querySelector('#view .card:last-child');
  if (!last) return false;
  window.scrollTo(0, document.body.scrollHeight);
  const r = last.getBoundingClientRect();
  return r.bottom > bar.top + 1;
});
ok('いちばん下までスクロールしても、下のナビに内容が隠れない', !hidden);

/* =================================================================== */
console.log('\n【9】色の読みやすさ（明るい画面・暗い画面）');
/* =================================================================== */

for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => {
    // 背景が透明な要素は、実際に後ろに見えている色（親をさかのぼった色）で測る
    const bgOf = el => {
      let n = el;
      while (n && n !== document.documentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        const m = bg.match(/[\d.]+/g);
        if (m && (m.length < 4 || parseFloat(m[3]) > 0.01)) return bg;
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const g = el => el ? { bg: bgOf(el), ink: getComputedStyle(el).color } : null;
    return {
      head: g(document.querySelector('.hero h2')),
      sub: g(document.querySelector('.sec .sub')),
      fab: g(document.getElementById('btn-add')),
      tab: g(document.querySelector('#scope button.on')),
      nav: g(document.querySelector('#tabbar button.on')),
      navOff: g(document.querySelector('#tabbar button:not(.on)'))
    };
  });
  for (const [label, pair] of [['見出し', c.head], ['補助文字', c.sub], ['＋ボタン', c.fab],
                               ['選んだタブ', c.tab], ['下ナビ（選択中）', c.nav], ['下ナビ（未選択）', c.navOff]]) {
    const r = contrast(pair.bg, pair.ink);
    ok(scheme + '：' + label + 'が読める（4.5以上）', r >= 4.5, 'ratio=' + r.toFixed(2));
  }
}
await page.emulateMedia({ colorScheme: 'light' });

/* =================================================================== */
console.log('\n【10】ログアウトと再ログイン');
/* =================================================================== */

await page.click('#btn-settings');
await page.waitForTimeout(400);
await page.click('#btn-logout');
await page.waitForTimeout(300);
await page.click('#modal-yes');
await page.waitForTimeout(600);
ok('ログアウトするとログイン画面に戻る', await page.isVisible('#screen-login'));
const leftover = await page.evaluate(() => localStorage.getItem('ph:token'));
ok('この端末から札が消える', !leftover, String(leftover));

await page.fill('#f-pass', PASS);
await page.click('#btn-login');
await page.waitForTimeout(1800);
ok('入り直せる', await page.isVisible('#screen-app'));
ok('データは残っている', (await page.textContent('#view')).includes('つぎのセミナー') || (await page.textContent('#view')).includes('管理職向け'),
  (await page.textContent('#view')).slice(0, 80));

/* =================================================================== */
console.log('\n【11】JSエラーと通信');
/* =================================================================== */
ok('JSエラーが1件も出ていない', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

/* 通信の失敗のうち、このテストが自分で起こしたものは想定内：
     ・電波を切っている間の失敗
     ・【1】でわざと入れた、まちがった合言葉（401 /api/login）      */
const expectedLoginFails = httpFails.filter(f => f === '401 /api/login').length;
eq('わざと失敗させたログインは1回だけ', expectedLoginFails, 1);
const unexpected = httpFails.filter(f =>
  !/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_FAILED/.test(f) && f !== '401 /api/login');
ok('それ以外に、想定外の通信エラー（4xx・5xx）が出ていない', unexpected.length === 0, unexpected.slice(0, 5).join(' / '));

console.log('\n────────────────────────────');
console.log('合格 ' + pass + ' ／ 不合格 ' + fail);
if (failures.length) { console.log('\n不合格の一覧:'); failures.forEach(f => console.log('  - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
