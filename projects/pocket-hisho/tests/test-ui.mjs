/* ポケット秘書 — アプリ画面の検証（wrangler dev を動かした状態で実行する）
   実行:
     npx wrangler dev --local --port 8788 &
     node tests/test-ui.mjs

   伊神さん（作った人・パソコン）と、講師の方（招待された人・スマホ）の
   両方の流れを、画面を実際に操作して確かめる。                          */

import http from 'node:http';
import { chromium } from 'playwright';
import { todayStr, addDays, fmtFull } from '../web/shared-date.js';
import { defaultSettings } from '../web/shared-model.js';
import { decryptPayloadForTest, bytesToB64url } from '../src/push.js';

const BASE = process.env.PH_BASE || 'http://127.0.0.1:8788';
const PASS = 'test-pass-1234';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPHONE_LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.3.0';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const subtle = globalThis.crypto.subtle;

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
const wait = ms => new Promise(r => setTimeout(r, ms));

/* 読みやすさ（コントラスト比） */
function parseRgb(s) { const m = String(s).match(/(\d+(?:\.\d+)?)/g); return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0]; }
function lum(rgb) {
  const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) { const la = lum(parseRgb(a)), lb = lum(parseRgb(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/* --- 準備：作った人の合言葉を決めておき、中身を空にする（どの順番で流しても同じ結果にするため） --- */
if ((await api('GET', '/api/setup-status')).json.needsSetup) await api('POST', '/api/setup', { pass: PASS });
let adminToken = (await api('POST', '/api/login', { pass: PASS })).json.token;
await api('POST', '/api/login/unlock', undefined, adminToken);
await api('POST', '/api/restore', { events: [{ id: 'ui_reset', date: '2020-01-01', title: 'reset' }], tasks: [], settings: defaultSettings() }, adminToken);
await api('DELETE', '/api/events/ui_reset', undefined, adminToken);
await api('DELETE', '/api/invite', undefined, adminToken);
await api('DELETE', '/api/google/app', undefined, adminToken);      // Googleとつなぐ準備も、まだの状態から
await api('POST', '/api/calendar/refresh', undefined, adminToken);

/* --- 偽の通知サーバーと、偽の「通知の宛先」 ---
   ヘッドレスのブラウザは本物の通知サーバーにつながらないので、
   ブラウザの「宛先づくり」を差しかえて、宛先をこの偽サーバーに向ける。
   サーバーから届いた本文は、端末役の鍵で復号して中身を確かめる。 */
const received = [];
const pushServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { received.push({ url: req.url, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); });
});
await new Promise(r => pushServer.listen(8796, '127.0.0.1', r));
const uaPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublicRaw = new Uint8Array(await subtle.exportKey('raw', uaPair.publicKey));
const authSecret = globalThis.crypto.getRandomValues(new Uint8Array(16));
const fakeSub = { endpoint: 'http://127.0.0.1:8796/push/phone-1', p256dh: bytesToB64url(uaPublicRaw), auth: bytesToB64url(authSecret) };

function fakePushScript(sub) {
  if (!window.PushManager) return;
  const obj = {
    endpoint: sub.endpoint,
    toJSON() { return { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }; },
    unsubscribe: async () => { localStorage.removeItem('test:fake-sub'); return true; }
  };
  PushManager.prototype.subscribe = async function () { localStorage.setItem('test:fake-sub', '1'); return obj; };
  PushManager.prototype.getSubscription = async function () { return localStorage.getItem('test:fake-sub') ? obj : null; };
}
/* ホーム画面から開いた状態のふり（iPhone） */
function standaloneScript() {
  Object.defineProperty(window.navigator, 'standalone', { get: () => true });
  const orig = window.matchMedia.bind(window);
  window.matchMedia = q => /display-mode:\s*standalone/.test(q)
    ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
    : orig(q);
}

const browser = await chromium.launch({ executablePath: CHROME });
const jsErrors = [];
const httpFails = [];
function watch(page, who) {
  page.on('pageerror', e => jsErrors.push(who + ': ' + String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource/i.test(t)) return;
    jsErrors.push(who + ' console: ' + t);
  });
  page.on('response', r => { if (r.status() >= 400) httpFails.push(r.status() + ' ' + new URL(r.url()).pathname); });
}

/* =================================================================== */
console.log('\n【1】作った人（伊神さん）：パソコンで合言葉を入れる');
/* =================================================================== */

const pcCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'allow' });
const pc = await pcCtx.newPage();
watch(pc, 'PC');
await pc.goto(BASE);
await wait(700);
ok('合言葉の画面が出る', await pc.isVisible('#login-pass'));
ok('「はじめての合言葉」の画面は出ない（もう決まっているため）', !(await pc.isVisible('#login-setup')));

await pc.click('#btn-login');
await wait(200);
ok('空のまま押すと案内が出る', (await pc.textContent('#login-msg')).includes('合言葉'));
await pc.fill('#f-pass', 'まちがい');
await pc.click('#btn-login');
await wait(700);
ok('まちがった合言葉では入れない', await pc.isVisible('#screen-login'));
await pc.fill('#f-pass', PASS);
await pc.press('#f-pass', 'Enter');
await wait(1800);
ok('正しい合言葉で入れる', await pc.isVisible('#screen-app'));

/* =================================================================== */
console.log('\n【2】作った人：はじめの準備が自動で開き、招待リンクを作れる');
/* =================================================================== */

ok('はじめの準備が自動で開く', await pc.isVisible('#sheet-guide'));
const pcGuide = await pc.textContent('#guide-body');
ok('いちばん上は「Googleカレンダーとつなぐ準備」、次に「招待リンクを送る」',
  pcGuide.indexOf('つなぐ準備') >= 0 && pcGuide.indexOf('つなぐ準備') < pcGuide.indexOf('招待リンクを送る') &&
  pcGuide.indexOf('招待リンクを送る') < pcGuide.indexOf('通知'), pcGuide.slice(0, 160));
ok('準備の欄に、Google Cloud に貼るリダイレクトURIが出る', pcGuide.includes(BASE + '/api/google/callback'));
for (const scheme of ['light', 'dark']) {
  await pc.emulateMedia({ colorScheme: scheme });
  await wait(200);
  const lc = await pc.$eval('#guide-body .g-steps a', a => {
    let bg = 'rgba(0, 0, 0, 0)', el = a;
    while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(el).backgroundColor; el = el.parentElement; }
    return { ink: getComputedStyle(a).color, bg };
  });
  const r = contrast(lc.bg, lc.ink);
  ok(scheme + '：準備の手順の中のリンクが読める（4.5以上）', r >= 4.5, 'ratio=' + r.toFixed(2) + ' ' + JSON.stringify(lc));
}
await pc.emulateMedia({ colorScheme: 'light' });
ok('パソコンでは「ホーム画面に追加」は出さない', !pcGuide.includes('ホーム画面に追加する'));
ok('パソコンでは通知は「なくてもOK」', /通知をオンにする（なくてもOK）/.test(pcGuide), pcGuide.slice(0, 300));

await pc.click('#guide-body [data-g="invite-new"]');
await wait(900);
const lineHref = await pc.getAttribute('#guide-body a[data-g="invite-line"]', 'href');
ok('「LINEで送る」ボタンが出る', !!lineHref && lineHref.startsWith('https://line.me/R/share?text='), lineHref);
const lineText = decodeURIComponent((lineHref || '').split('text=')[1] || '');
ok('LINEの文面に招待リンクが入る', /\/\?invite=[0-9a-f]{24}&openExternalBrowser=1/.test(lineText), lineText);
ok('LINEの文面に「合言葉なしで入れる」と書いてある', lineText.includes('合言葉なし'));
const inviteUrl = lineText.match(/https?:\/\/\S+invite=\S+/)[0];
ok('招待を作ると「できています」になる', (await pc.textContent('#guide-body')).includes('できています'));

await pc.click('#guide-body [data-g="close"]');
await wait(300);
ok('はじめの準備を閉じられる', !(await pc.isVisible('#sheet-guide')));
ok('Googleの準備が残っているので、上の帯で知らせる', (await pc.textContent('#guide-banner')).includes('つなぐ準備'));

await pc.reload();
await wait(1500);
ok('開き直しても、はじめの準備は勝手に開かない（1回だけ）', !(await pc.isVisible('#sheet-guide')));

/* =================================================================== */
console.log('\n【3】予定を入れる（運賃・ホテル代）');
/* =================================================================== */

const DAY = addDays(todayStr(), 3);
await pc.click('#btn-add');
await wait(400);
ok('入力画面が開く', await pc.isVisible('#sheet-event'));
ok('いつも使う「きほん」「ばしょ」は開いている', await pc.isVisible('#f-date') && await pc.isVisible('#f-place'));
ok('運賃の欄は、はじめは閉じている（画面を短く見せる）', !(await pc.isVisible('#f-fare')));
const foldCount = await pc.$$eval('#sheet-event details.fold', d => d.length);
ok('ほかの欄は、押すと開く形になっている', foldCount >= 6, String(foldCount));

await pc.fill('#f-date', '');
await pc.click('#ev-save');
await wait(300);
ok('日付なしでは保存されない', await pc.isVisible('#sheet-event'));

await pc.fill('#f-date', DAY);
await pc.fill('#f-title', '管理職向け コミュニケーション研修');
await pc.fill('#f-open', '13:30');
await pc.fill('#f-place', '大阪産業創造館 5Fホール');
await pc.fill('#f-address', '大阪市中央区本町1-4-5');
await pc.click('#fold-travel summary');
await wait(200);
ok('押すと運賃の欄が開く', await pc.isVisible('#f-fare'));
await pc.fill('#f-fare', '2万8400');
await pc.click('#fold-stay summary');
await pc.fill('#f-hotel', '9,800円');
await pc.fill('#f-stay-place', 'サンプルホテル');
await pc.click('#ev-save');
await wait(1200);
ok('保存するとシートが閉じる', !(await pc.isVisible('#sheet-event')));

let dayText = await pc.textContent('#view');
ok('その日の画面に予定が出る', dayText.includes('管理職向け'));
ok('「かかったお金」に運賃が出る（2万8400 → 28,400円）', dayText.includes('28,400円'), dayText.slice(dayText.indexOf('かかったお金'), dayText.indexOf('かかったお金') + 80));
ok('ホテル代が出る', dayText.includes('9,800円'));
ok('合計が出る（38,200円）', dayText.includes('38,200円'));
ok('「講演料」「売上」「差引」は出さない', !/講演料|売上|差引/.test(dayText));
eq('日付の見出しが合っている', await pc.textContent('#date-label'), fmtFull(DAY));

let srv = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('サーバーにも運賃・ホテル代が保存されている', srv.json.events[0].cost, { fare: 28400, hotel: 9800, other: 0, otherNote: 'サンプルホテル'.slice(0, 0) });

// 編集を開くと、中身の入っている欄だけ開いている
await pc.click('#view button[data-act="edit-event"]');
await wait(400);
ok('中身がある欄（運賃）は開いた状態で出る', await pc.isVisible('#f-fare'));
ok('見出しの横に中身が出る', (await pc.textContent('#sum-travel')).includes('28,400円'));
ok('中身がない欄（話す内容）は閉じたまま', !(await pc.isVisible('#f-audience')));
await pc.click('#ev-cancel');
await wait(300);

// 「運賃・ホテル代を入れる／直す」ボタンは、運賃の欄を開いて連れていく
await pc.click('#view button[data-act="edit-cost"]');
await wait(500);
ok('金額のボタンから、運賃の欄へ直接行ける', await pc.isVisible('#f-fare'));
const focused = await pc.evaluate(() => document.activeElement && document.activeElement.id);
eq('運賃の欄に入力の印（カーソル）がある', focused, 'f-fare');
await pc.click('#ev-cancel');
await wait(300);

/* =================================================================== */
console.log('\n【4】日・週・月・年（お金は運賃・ホテル代だけ）');
/* =================================================================== */

for (const [scope, must, mustNot] of [
  ['week', 'かかったお金 38,200円', '06-1234'],
  ['month', '運賃 28,400円', '会場入り'],
  ['year', '28,400円', '大阪市中央区']
]) {
  await pc.click('#scope button[data-scope="' + scope + '"]');
  await wait(300);
  const t = await pc.textContent('#view');
  ok(scope + '：必要な情報が出る', t.includes(must), t.slice(0, 160));
  ok(scope + '：詳細は出さない', !t.includes(mustNot));
  ok(scope + '：売上・差引は出さない', !/売上|差引/.test(t));
}
const yearText = await pc.textContent('#view');
ok('年の画面に 運賃・ホテル代・かかったお金 が並ぶ', /運賃/.test(yearText) && /ホテル代/.test(yearText) && /かかったお金/.test(yearText));
ok('年の画面から表（CSV）を書き出せる', await pc.isVisible('#view button[data-act="csv-year"]'));
const dl = pc.waitForEvent('download', { timeout: 5000 }).catch(() => null);
await pc.click('#view button[data-act="csv-year"]');
const download = await dl;
ok('押すとファイルが保存される', !!download);
if (download) {
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(path, 'utf8');
  ok('表の先頭にエクセル用の印（BOM）', text.charCodeAt(0) === 0xFEFF);
  ok('表に運賃とホテル代の列がある', text.includes('"運賃","ホテル代"'));
  ok('表に今回の金額が入る', text.includes('"28400","9800"'), text.slice(0, 200));
}
await pc.click('#scope button[data-scope="day"]');

/* =================================================================== */
console.log('\n【5】講師の方：LINEの招待リンクから、iPhoneで入る');
/* =================================================================== */

const phoneCtx = await browser.newContext({
  userAgent: UA_IPHONE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'allow'
});
const phone = await phoneCtx.newPage();
watch(phone, 'iPhone(Safari)');
await phone.goto(inviteUrl);
await wait(2500);
ok('招待リンクを開くだけで入れる（合言葉を聞かれない）', await phone.isVisible('#screen-app'));
ok('アドレス欄から招待のしるしが消えている', !(await phone.evaluate(() => location.search.includes('invite'))));
ok('はじめの準備が自動で開く', await phone.isVisible('#sheet-guide'));

await wait(800);   // 引き継ぎ番号を用意し終わるのを待つ
const phoneGuide = await phone.textContent('#guide-body');
ok('講師の方には「招待リンクを送る」は出ない', !phoneGuide.includes('招待リンクを送る'));
ok('1つめは「ホーム画面に追加する」', /ホーム画面に追加する/.test(phoneGuide));
ok('iPhone用の手順（共有ボタン → ホーム画面に追加）', phoneGuide.includes('共有ボタン') && phoneGuide.includes('「ホーム画面に追加」'));
ok('通知は「先にホーム画面に追加して」と案内される', phoneGuide.includes('先に「ホーム画面に追加」'));
const bigCode = (await phone.textContent('#handoff-code') || '').replace(/\s/g, '');
ok('ホーム画面のアプリへ渡す6けたの番号が大きく出る', /^\d{6}$/.test(bigCode), bigCode);
const pageUrl = await phone.evaluate(() => location.href);
ok('ページのURLにその番号が入っている（ホーム画面に追加したとき一緒に渡る）', pageUrl.endsWith('/?h=' + bigCode), pageUrl);
const mfHref = await phone.getAttribute('#manifest-link', 'href');
eq('ホーム画面用の説明書も、その番号入りに差しかわっている', mfHref, '/app.webmanifest?h=' + bigCode);
const mf = await (await fetch(BASE + mfHref)).json();
eq('説明書の起動URLに番号が入っている', mf.start_url, '/?h=' + bigCode);

// カレンダーのボタン
const appleHref = await phone.getAttribute('#guide-body a[data-g="cal"]:first-of-type', 'href');
ok('iPhoneのカレンダー用ボタン（webcal://）', !!appleHref && appleHref.startsWith('webcal://' + new URL(BASE).host + '/ics/') && /\/ics\/[0-9a-f]{24,}\.ics$/.test(appleHref), appleHref);
const googleHref = await phone.$$eval('#guide-body a[data-g="cal"]', as => as.map(a => a.getAttribute('href')).find(h => h.includes('google')));
ok('Googleカレンダー用ボタン（追加画面を直接ひらく）', googleHref && googleHref.startsWith('https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2F'), googleHref);

await phone.click('#guide-body [data-g="close"]');
await wait(300);
const banner = await phone.textContent('#guide-banner');
ok('あとにすると、上に「はじめの準備 あと○つ」の帯が出る', /はじめの準備 あと\d+つ/.test(banner), banner);
await phone.click('#guide-banner-btn');
await wait(300);
ok('帯を押すと、はじめの準備がまた開く', await phone.isVisible('#sheet-guide'));
await phone.click('#guide-body [data-g="close"]');

// 招待された人にも、伊神さんが入れた予定が見える
await phone.evaluate(d => { const s = window.pocketHisho.getState(); s.cursor = d; s.scope = 'day'; window.pocketHisho.render(); }, DAY);
await wait(300);
ok('講師の方のスマホにも同じ予定が見える', (await phone.textContent('#view')).includes('管理職向け'));

/* =================================================================== */
console.log('\n【6】講師の方：ホーム画面のアイコンから開く（番号で自動的に引き継ぐ）');
/* =================================================================== */

const homeCtx = await browser.newContext({
  userAgent: UA_IPHONE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'allow'
});
await homeCtx.addInitScript(standaloneScript);
await homeCtx.addInitScript(fakePushScript, fakeSub);
await homeCtx.grantPermissions(['notifications'], { origin: BASE });
const home = await homeCtx.newPage();
watch(home, 'iPhone(ホーム画面)');
await home.goto(BASE + mf.start_url);        // ホーム画面のアイコン＝説明書の起動URLで開く
await wait(2500);
ok('ホーム画面から開くと、番号で自動的に入れる（Safariと保存場所が別でも）', await home.isVisible('#screen-app'));
ok('はじめの準備が自動で開く（この端末でははじめてなので）', await home.isVisible('#sheet-guide'));
let homeGuide = await home.textContent('#guide-body');
ok('「ホーム画面に追加」は、できている扱い', /ホーム画面に追加する[\s\S]*できています/.test(homeGuide), homeGuide.slice(0, 200));
ok('いまやるのは「通知をオンにする」', await home.isVisible('#guide-body .guide-step.now [data-g="enable-push"]'));

received.length = 0;
await home.click('#guide-body [data-g="enable-push"]');
await wait(2500);
homeGuide = await home.textContent('#guide-body');
ok('ボタン1つで通知がオンになる', homeGuide.includes('通知はオンです'), homeGuide.slice(0, 300));
ok('オンにしたら、自動でテスト通知が送られる', received.length >= 1, '受け取り=' + received.length);
if (received.length) {
  const p = JSON.parse(await decryptPayloadForTest(subtle, received[received.length - 1].body, uaPair.privateKey, uaPublicRaw, authSecret));
  ok('テスト通知の中身が、そのスマホで読める', p.body.includes('テスト通知'), JSON.stringify(p));
}
srv = await api('GET', '/api/bootstrap', undefined, adminToken);
ok('サーバーに端末（iPhone）が登録されている', srv.json.devices.some(d => d.label === 'iPhone'), JSON.stringify(srv.json.devices));
ok('通知タブの案内も「届く」に変わる', await (async () => {
  await home.click('#guide-body [data-g="close"]');
  await home.click('#tabbar button[data-tab="notify"]');
  await wait(300);
  return (await home.textContent('#view')).includes('この端末に届きます');
})());
ok('準備が終わったので、上の帯は消える（カレンダーは任意）', await home.isHidden('#guide-banner'));

// 端末側で宛先が消えても、次に開いたときに自動で登録し直す
await api('POST', '/api/push/unsubscribe', { endpoint: fakeSub.endpoint }, adminToken);
srv = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('（サーバーから登録を消してみる）', srv.json.devices.length, 0);
await home.reload();
await wait(2500);
srv = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('アプリを開き直すだけで、何もしなくても登録し直される', srv.json.devices.length, 1);

/* =================================================================== */
console.log('\n【7】番号が自動で渡らなかったとき（手で入れる）');
/* =================================================================== */

const home2Ctx = await browser.newContext({
  userAgent: UA_IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow'
});
await home2Ctx.addInitScript(standaloneScript);
const home2 = await home2Ctx.newPage();
watch(home2, 'iPhone(番号手入力)');
await home2.goto(BASE + '/');
await wait(1500);
ok('ホーム画面から開いて番号が無いときは「番号で入る」画面になる', await home2.isVisible('#login-code'));
ok('「もう一度だけ入り直します」と理由が書いてある', (await home2.textContent('#code-hint')).includes('もう一度だけ'));
await home2.fill('#f-code', '000000');
await home2.click('#btn-code');
await wait(800);
ok('まちがった番号では入れない', await home2.isVisible('#screen-login'));
ok('理由が出る', (await home2.textContent('#login-msg')).includes('番号'));
const freshCode = (await api('POST', '/api/handoff', undefined, adminToken)).json.code;
await home2.fill('#f-code', freshCode.slice(0, 3) + ' ' + freshCode.slice(3));
await home2.press('#f-code', 'Enter');
await wait(1800);
ok('Safariに出ていた番号を入れれば入れる（空白入りでもOK）', await home2.isVisible('#screen-app'));
await home2Ctx.close();

/* =================================================================== */
console.log('\n【8】LINEの中で開いてしまったとき・Androidのとき');
/* =================================================================== */

const lineCtx = await browser.newContext({ userAgent: UA_IPHONE_LINE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const linePage = await lineCtx.newPage();
watch(linePage, 'LINE内');
const inv2 = (await api('POST', '/api/invite', undefined, adminToken)).json.url;
await linePage.goto(inv2);
await wait(2200);
ok('LINEの中のブラウザでも入れる', await linePage.isVisible('#screen-app'));
const lineGuide = await linePage.textContent('#guide-body');
ok('「LINEの中なので、ブラウザで開いて」と案内する', lineGuide.includes('LINE') && lineGuide.includes('ブラウザで開く'), lineGuide.slice(0, 200));
await lineCtx.close();

const andCtx = await browser.newContext({ userAgent: UA_ANDROID, viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
const android = await andCtx.newPage();
watch(android, 'Android');
await android.goto(inv2);
await wait(2200);
let andGuide = await android.textContent('#guide-body');
ok('Androidには Android 用の手順（︙ → ホーム画面に追加）', andGuide.includes('︙') && andGuide.includes('ホーム画面に追加'));
ok('Androidでは番号の引き継ぎは要らない（出さない）', !(await android.isVisible('#handoff-code')));
// Chrome が「ホーム画面に追加」を出せる状態になったら、ボタン1つにする
await android.evaluate(() => {
  const e = new Event('beforeinstallprompt');
  e.prompt = () => { window.__prompted = true; };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
});
await wait(300);
ok('追加できる状態になると「ホーム画面に追加する」ボタンに変わる', await android.isVisible('#guide-body [data-g="install"]'));
await android.click('#guide-body [data-g="install"]');
await wait(400);
ok('ボタンを押すと、ブラウザの「追加しますか」が出る', await android.evaluate(() => window.__prompted === true));
await andCtx.close();

/* =================================================================== */
console.log('\n【9】やること');
/* =================================================================== */

await pc.click('#tabbar button[data-tab="task"]');
await wait(300);
ok('やることタブ', (await pc.textContent('#view')).includes('やることはありません'));
await pc.click('#btn-add');
await wait(400);
await pc.fill('#t-title', '資料を50部 印刷する');
await pc.fill('#t-due', addDays(todayStr(), 1));
await pc.selectOption('#t-event', { index: 1 });
await pc.click('#tk-save');
await wait(900);
ok('やることが一覧に出る', (await pc.textContent('#view')).includes('資料を50部'));
eq('下のナビに残り件数が出る', await pc.textContent('#task-badge'), '1');
await pc.click('#view .task-row .box');
await wait(800);
ok('終わったら「のこり」から消える', !(await pc.textContent('#view')).includes('資料を50部'));
await pc.click('#tabbar button[data-tab="schedule"]');

/* =================================================================== */
console.log('\n【10】設定（よく使うものが上、細かい設定はたたんである）');
/* =================================================================== */

await pc.click('#btn-settings');
await wait(600);
ok('設定の上に「はじめの準備をひらく」', await pc.isVisible('#btn-open-guide'));
ok('設定に「カレンダーに表示する」ボタンがある', await pc.isVisible('#cal-buttons a[data-g="cal"]'));
ok('設定に招待リンクの欄がある', (await pc.textContent('#invite-area')).length > 0);
ok('細かい設定は、はじめは閉じている', !(await pc.isVisible('#n-h2')));
await pc.click('#fold-advanced summary');
await wait(200);
await pc.uncheck('#n-h2');
await pc.fill('#n-digest', '06:45');
await pc.click('#btn-save-notify');
await wait(900);
srv = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('通知の設定が保存される', [srv.json.settings.notify.rules.h2, srv.json.settings.notify.digestAt], [false, '06:45']);
await pc.click('#st-close');
await wait(300);

/* =================================================================== */
console.log('\n【10b】Googleカレンダーとつなぐ（伊神さんが準備 → 講師の方がつなぐ）');
/* =================================================================== */

await pc.click('#btn-settings');
await wait(400);
ok('伊神さんの設定に、Googleとつなぐ準備の欄がある', await pc.isVisible('#google-area [data-gd="clientId"]'));
eq('リダイレクトURIを見せる', (await pc.textContent('#google-area .copybox code')).trim(), BASE + '/api/google/callback');
await pc.fill('#google-area [data-gd="clientId"]', 'まちがい');
await pc.fill('#google-area [data-gd="clientSecret"]', 'GOCSPX-ui-test-secret');
await pc.click('#google-area [data-g="g-save"]');
await wait(600);
ok('形のちがうクライアントIDは、理由を出して断る', (await pc.textContent('#toast')).includes('クライアントID'));
await pc.fill('#google-area [data-gd="clientId"]', '999-uitest.apps.googleusercontent.com');
await pc.click('#st-close');
await wait(300);
await pc.click('#btn-settings');
await wait(400);
eq('書きかけの内容は、設定を開き直しても消えない', await pc.inputValue('#google-area [data-gd="clientId"]'), '999-uitest.apps.googleusercontent.com');
await pc.click('#google-area [data-g="g-save"]');
await wait(800);
ok('保存すると「講師の方のスマホで押してもらって」と出る', (await pc.textContent('#google-area')).includes('講師の方のスマホで押してもらう'));
ok('伊神さんの画面では「つなぐ」は主役のボタンにしない', !(await pc.$eval('#google-area [data-g="g-connect"]', b => b.classList.contains('primary'))));
ok('Googleとつなぐなら、購読（照会）のボタンは隠す', await pc.isHidden('#cal-box'));
await pc.click('#st-close');
await wait(300);
ok('準備が終わったので、伊神さんの上の帯は消える', await pc.isHidden('#guide-banner'));

// 講師の方（ホーム画面のアプリ）：開き直すと「Googleカレンダーとつなぐ」が次の手順になる
await home.reload();
await wait(2000);
ok('講師の方の上の帯に「Googleカレンダーとつなぐ」', (await home.textContent('#guide-banner')).includes('Googleカレンダーとつなぐ'));
await home.click('#guide-banner-btn');
await wait(400);
const hg = await home.textContent('#guide-body');
ok('講師の方には「つなぐ」が主役のボタンで出る', await home.$eval('#guide-body [data-g="g-connect"]', b => b.classList.contains('primary')));
ok('「確認されていません」と出たときの進み方を先に書いてある', hg.includes('このアプリは Google で確認されていません') && hg.includes('詳細'));
ok('「カレンダーの予定の表示と編集」にチェック、と書いてある', hg.includes('カレンダーの予定の表示と編集'));
ok('講師の方の案内から、購読（照会）のボタンは消える', !(await home.$('#guide-body a[data-g="cal"]')));
let googleUrl = '';
await home.route('https://accounts.google.com/**', route => { googleUrl = route.request().url(); route.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }); });
await home.click('#guide-body [data-g="g-connect"]');
await wait(1200);
const gu = googleUrl ? new URL(googleUrl) : null;
ok('押すと Google の許可画面へ行く', !!gu && gu.origin + gu.pathname === 'https://accounts.google.com/o/oauth2/v2/auth', googleUrl);
eq('許可画面に渡すもの（ID・戻り先・カレンダーの権限・長く使える合鍵）', gu && [gu.searchParams.get('client_id'), gu.searchParams.get('redirect_uri'),
  gu.searchParams.get('scope'), gu.searchParams.get('access_type')],
  ['999-uitest.apps.googleusercontent.com', BASE + '/api/google/callback', 'https://www.googleapis.com/auth/calendar.events', 'offline']);
await home.unroute('https://accounts.google.com/**');
await home.goto(BASE + '/');
await wait(2000);

/* =================================================================== */
console.log('\n【11】オフライン（講師の方のスマホで）');
/* =================================================================== */

await home.bringToFront();
await home.evaluate(d => { const s = window.pocketHisho.getState(); s.cursor = d; s.scope = 'day'; s.tab = 'schedule'; window.pocketHisho.render(); }, DAY);
await wait(1500);
const shellInfo = await home.evaluate(async () => {
  const r = await caches.match('/');
  return r ? { redirected: r.redirected } : null;
});
ok('アプリ画面が端末に取っておかれている（転送ぬき）', shellInfo && shellInfo.redirected === false, JSON.stringify(shellInfo));
await homeCtx.setOffline(true);
await home.reload();
await wait(2500);
ok('電波が無くても画面が出る', await home.isVisible('#screen-app'));
ok('つながっていない印が出る', await home.isVisible('#net-bar'));
await home.evaluate(d => { const s = window.pocketHisho.getState(); s.cursor = d; s.scope = 'day'; window.pocketHisho.render(); }, DAY);
ok('前に見ていた予定が出る', (await home.textContent('#view')).includes('管理職向け'));
await home.click('#view button[data-act="edit-cost"]');
await wait(400);
await home.fill('#f-fare', '30000');
await home.click('#ev-save');
await wait(800);
ok('電波が無くても運賃を直せる', (await home.textContent('#view')).includes('30,000円'));
await homeCtx.setOffline(false);
await home.evaluate(() => window.dispatchEvent(new Event('online')));
await wait(2500);
srv = await api('GET', '/api/bootstrap', undefined, adminToken);
eq('つながったら、直した運賃がサーバーに届く', srv.json.events.find(e => e.title.includes('管理職向け')).cost.fare, 30000);
ok('つながっていない印が消える', await home.isHidden('#net-bar'));

/* =================================================================== */
console.log('\n【12】スマホでの触りやすさ・見やすさ');
/* =================================================================== */

async function checkTouch(page, label) {
  const small = await page.$$eval('button, a.act, a.btn, .btn, select, input[type=checkbox], summary', els => {
    const target = e => (e.type === 'checkbox' && e.closest('label')) ? e.closest('label') : e;
    return els.map(e => { const r = target(e).getBoundingClientRect(); return { id: e.id || e.className || e.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(o => o.w > 0 && o.h > 0 && (o.h < 44 || o.w < 44));
  });
  ok(label + '：押す場所が44px未満のものがない', small.length === 0, small.slice(0, 4).map(o => o.id + ' ' + o.w + 'x' + o.h).join(' / '));
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(label + '：横にはみ出さない', o <= 0, 'overflow=' + o);
}
await checkTouch(home, '日の画面');
await home.evaluate(() => window.pocketHisho.openGuide());
await wait(400);
await checkTouch(home, 'はじめの準備');
const ovfGuide = await home.evaluate(() => { const s = document.getElementById('sheet-guide'); return s.scrollWidth - s.clientWidth; });
ok('はじめの準備：シートの中でも横にはみ出さない', ovfGuide <= 0, String(ovfGuide));
await home.click('#guide-close');
await home.click('#btn-add');
await wait(400);
const ovfSheet = await home.evaluate(() => { const s = document.getElementById('sheet-event'); return s.scrollWidth - s.clientWidth; });
ok('入力画面：横にはみ出さない', ovfSheet <= 0, String(ovfSheet));
const timeW = await home.$$eval('#f-arrive, #f-open, #f-end', els => els.map(e => Math.round(e.getBoundingClientRect().width)));
ok('時刻の欄が130px以上（文字が切れない）', timeW.every(w => w >= 130), JSON.stringify(timeW));
await home.click('#ev-cancel');

/* =================================================================== */
console.log('\n【13】色の読みやすさ（明るい画面・暗い画面）');
/* =================================================================== */

// 帯と大きな番号も見るため、Safari側の iPhone で測る
for (const scheme of ['light', 'dark']) {
  await phone.emulateMedia({ colorScheme: scheme });
  await phone.evaluate(() => window.pocketHisho.openGuide());
  await wait(400);
  const c = await phone.evaluate(() => {
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
      stepTitle: g(document.querySelector('#guide-body .guide-step.now .gt')),
      stepSub: g(document.querySelector('#guide-body .guide-step .gs')),
      num: g(document.querySelector('#guide-body .guide-step.now .num')),
      code: g(document.getElementById('handoff-code')),
      primary: g(document.querySelector('#guide-body .btn')),
      banner: g(document.querySelector('.guide-banner .gbt'))
    };
  });
  for (const [label, pair] of Object.entries(c)) {
    if (!pair) continue;
    const r = contrast(pair.bg, pair.ink);
    ok(scheme + '：' + label + ' が読める（4.5以上）', r >= 4.5, 'ratio=' + r.toFixed(2));
  }
  await phone.click('#guide-body [data-g="close"]');
}
await phone.emulateMedia({ colorScheme: 'light' });

/* =================================================================== */
console.log('\n【14】ログアウトと、入り直し');
/* =================================================================== */

await pc.click('#btn-settings');
await wait(400);
ok('設定を開きなおすと、くわしい設定は閉じている', !(await pc.evaluate(() => document.getElementById('fold-advanced').open)));
await pc.click('#fold-advanced summary');
await pc.click('#btn-logout');
await wait(300);
await pc.click('#modal-yes');
await wait(800);
ok('ログアウトすると入口に戻る', await pc.isVisible('#screen-login'));
ok('札が消える', !(await pc.evaluate(() => localStorage.getItem('ph:token'))));
await pc.fill('#f-pass', PASS);
await pc.click('#btn-login');
await wait(1800);
ok('入り直せる', await pc.isVisible('#screen-app'));

/* =================================================================== */
console.log('\n【15】JSエラーと通信');
/* =================================================================== */
ok('JSエラーが1件も出ていない', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
/* テストがわざと起こしたもの：まちがった合言葉（401 /api/login）・まちがった番号（401 /api/redeem） */
/* ＋ わざと形のちがうクライアントIDを保存した（400 /api/google/app） */
const unexpected = httpFails.filter(f => f !== '401 /api/login' && f !== '401 /api/redeem' && f !== '400 /api/google/app');
ok('想定外の通信エラー（4xx・5xx）が出ていない', unexpected.length === 0, unexpected.slice(0, 5).join(' / '));
eq('わざと失敗させたのは2回だけ（合言葉1・番号1）', httpFails.filter(f => f.startsWith('401')).length, 2);

console.log('\n────────────────────────────');
console.log('合格 ' + pass + ' ／ 不合格 ' + fail);
if (failures.length) { console.log('\n不合格の一覧:'); failures.forEach(f => console.log('  - ' + f)); }
/* あとかたづけ：テスト用の端末の登録と、ロックを消す（ほかのテストの数え方に影響させないため） */
const endToken = (await api('POST', '/api/login', { pass: PASS })).json.token;
await api('POST', '/api/push/unsubscribe', { endpoint: fakeSub.endpoint }, endToken);
await api('DELETE', '/api/google/app', undefined, endToken);
await api('POST', '/api/login/unlock', undefined, endToken);
await browser.close();
pushServer.close();
process.exit(fail ? 1 : 0);
