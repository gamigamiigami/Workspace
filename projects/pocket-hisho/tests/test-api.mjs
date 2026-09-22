/* ポケット秘書 — サーバー全体の検証（wrangler dev を動かした状態で実行する）
   実行:
     npx wrangler dev --config wrangler.test.toml --local --port 8788 &
     node tests/test-api.mjs                                                */

import http from 'node:http';
import { decryptPayloadForTest, b64urlToBytes, bytesToB64url } from '../src/push.js';
import { toMs, todayStr, addDays } from '../web/shared-date.js';

const BASE = process.env.PH_BASE || 'http://127.0.0.1:8788';
/* 通知は「一度送ったものは二度送らない」ので、
   テストを続けて流しても引っかからないよう、毎回ちがうIDを使う */
const RUN = Math.random().toString(36).slice(2, 8);
const ID_NOW = 'tk_now_' + RUN;
const ID_CRON = 'tk_cron_' + RUN;
const PASS = 'test-pass-1234';
const subtle = globalThis.crypto.subtle;

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

let token = '';
async function call(method, path, body, useToken = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(useToken && token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { /* 本文がJSONでないこともある */ }
  return { status: res.status, json };
}

/* ---------------------------------------------------------------
   偽の「通知サーバー」。本物の Apple/Google の代わりに受け取って、
   届いた中身をそのまま見られるようにする。
   --------------------------------------------------------------- */
const received = [];
const pushServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(201); res.end();
  });
});
/* 取り込み用の偽カレンダー（Googleカレンダーの代わり） */
let icsToServe = '';
const calServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
  res.end(icsToServe);
});

await new Promise(r => pushServer.listen(8799, '127.0.0.1', r));
await new Promise(r => calServer.listen(8798, '127.0.0.1', r));

/* =================================================================== */
console.log('\n【1】起動と入口');
/* =================================================================== */

const ping = await call('GET', '/api/ping', undefined, false);
eq('/api/ping が返る', ping.status, 200);
ok('サーバーの今日の日付が返る', /^\d{4}-\d{2}-\d{2}$/.test(ping.json.today), JSON.stringify(ping.json));

const noAuth = await call('GET', '/api/bootstrap', undefined, false);
eq('ログインしていないと中身は見えない', noAuth.status, 401);

const wrong = await call('POST', '/api/login', { pass: 'ちがう合言葉' }, false);
eq('合言葉がちがうと入れない', wrong.status, 401);
ok('理由が日本語で返る', String(wrong.json.error).includes('合言葉'), JSON.stringify(wrong.json));

const login = await call('POST', '/api/login', { pass: PASS }, false);
eq('正しい合言葉で入れる', login.status, 200);
ok('札（トークン）がもらえる', typeof login.json.token === 'string' && login.json.token.length >= 32);
token = login.json.token;

const bad = await call('GET', '/api/bootstrap', undefined, false);
eq('札が無ければやはり見えない', bad.status, 401);

/* =================================================================== */
console.log('\n【2】いったん空にしてから始める');
/* =================================================================== */

await call('POST', '/api/restore', { events: [{ id: 'reset_marker', date: '2020-01-01', title: 'reset' }], tasks: [] });
await call('DELETE', '/api/events/reset_marker');
let boot = await call('GET', '/api/bootstrap');
eq('予定が空になった', boot.json.events.length, 0);
eq('やることも空', boot.json.tasks.length, 0);
ok('通知の鍵が自動で作られている', typeof boot.json.vapidPublicKey === 'string' && b64urlToBytes(boot.json.vapidPublicKey).length === 65,
  String(boot.json.vapidPublicKey).slice(0, 20));
ok('カレンダー購読用のURLが作られている', /\/ics\/[0-9a-f]{24,}\.ics$/.test(boot.json.icsUrl), boot.json.icsUrl);

/* =================================================================== */
console.log('\n【3】予定の保存・読み出し・消去');
/* =================================================================== */

const DAY = addDays(todayStr(), 3);
const ev1 = {
  id: 'ev_test1', date: DAY, title: '管理職研修',
  arriveTime: '12:30', openTime: '13:30', endTime: '16:30',
  venue: { place: '大阪産業創造館', address: '大阪市中央区本町1-4-5', note: '' },
  contact: { org: 'サンプル商事', person: '田中', tel: '06-1234-5678', email: '' },
  items: [{ text: 'マイク', done: false }],
  money: [{ kind: 'in', label: '講演料', amount: 80000 }, { kind: 'out', label: '交通費', amount: 28400 }],
  memo: 'テスト'
};
const put1 = await call('PUT', '/api/events', ev1);
eq('予定を保存できる', put1.status, 200);
eq('保存された金額が正しい', put1.json.event.money, [{ kind: 'in', label: '講演料', amount: 80000 }, { kind: 'out', label: '交通費', amount: 28400 }]);

const noDate = await call('PUT', '/api/events', { id: 'ev_bad', title: '日付なし' });
eq('日付がない予定は断られる', noDate.status, 400);

boot = await call('GET', '/api/bootstrap');
eq('保存した予定が1件見える', boot.json.events.length, 1);
eq('中身がそのまま戻る', boot.json.events[0].venue.place, '大阪産業創造館');

// 同じIDで上書き
await call('PUT', '/api/events', { ...ev1, title: '管理職研修（改）' });
boot = await call('GET', '/api/bootstrap');
eq('上書きしても件数は増えない', boot.json.events.length, 1);
eq('上書きの内容が反映される', boot.json.events[0].title, '管理職研修（改）');

// 変な値を送りこんでも形がそろう
const dirty = await call('PUT', '/api/events', {
  id: 'ev_dirty', date: DAY, title: 123, openTime: 'あさ', money: [{ kind: 'x', label: 'a', amount: -500 }],
  items: 'これは配列ではない', venue: null
});
eq('変な値でも保存は通る', dirty.status, 200);
eq('数字の題名は文字になる', dirty.json.event.title, '123');
eq('時刻になっていない文字は空になる', dirty.json.event.openTime, '');
eq('マイナスの金額はプラスに直る', dirty.json.event.money[0], { kind: 'in', label: 'a', amount: 500 });
eq('配列でないものは空の配列になる', dirty.json.event.items, []);
eq('欠けている入れ物は既定で埋まる', dirty.json.event.venue, { place: '', address: '', note: '' });
await call('DELETE', '/api/events/ev_dirty');

/* =================================================================== */
console.log('\n【4】やること');
/* =================================================================== */

const t1 = await call('PUT', '/api/tasks', { id: 'tk1', title: '資料を50部 印刷する', due: addDays(todayStr(), 1), eventId: 'ev_test1' });
eq('やることを保存できる', t1.status, 200);
const tNoTitle = await call('PUT', '/api/tasks', { id: 'tk_bad', title: '' });
eq('名前がないやることは断られる', tNoTitle.status, 400);

await call('PUT', '/api/tasks', { id: 'tk2', title: 'ひもづかないやること' });
boot = await call('GET', '/api/bootstrap');
eq('やることが2件', boot.json.tasks.length, 2);

// 予定を消すと、ひもづくやることも消える
await call('DELETE', '/api/events/ev_test1');
boot = await call('GET', '/api/bootstrap');
eq('予定を消すと0件', boot.json.events.length, 0);
eq('ひもづいたやることも消える', boot.json.tasks.map(t => t.id), ['tk2']);

// 戻す
await call('PUT', '/api/events', ev1);
await call('PUT', '/api/tasks', { id: 'tk1', title: '資料を50部 印刷する', due: addDays(todayStr(), 1), eventId: 'ev_test1' });

/* =================================================================== */
console.log('\n【5】設定');
/* =================================================================== */

const s1 = await call('PUT', '/api/settings', {
  ownerName: 'テスト講師',
  notify: { on: true, rules: { d1: true, h2: false, m30: true }, digestAt: '07:30', allDayAt: '09:00', taskAt: '08:30', quietFrom: '23:00', quietTo: '06:00' },
  defaultItems: ['マイク', '名刺', ''],
  calendars: [{ name: 'だめなURL', url: 'ftp://example.com/x.ics' }]
});
eq('設定を保存できる', s1.status, 200);
eq('2時間前を切った設定が入る', s1.json.settings.notify.rules, { d1: true, h2: false, m30: true });
eq('空行は持ち物から落ちる', s1.json.settings.defaultItems, ['マイク', '名刺']);
eq('http以外のカレンダーURLは受けつけない', s1.json.settings.calendars, []);
boot = await call('GET', '/api/bootstrap');
eq('設定が残っている', boot.json.settings.notify.digestAt, '07:30');

/* =================================================================== */
console.log('\n【6】カレンダー① アプリ → 購読用URL');
/* =================================================================== */

const icsUrl = boot.json.icsUrl;
const icsRes = await fetch(icsUrl);
const icsText = await icsRes.text();
eq('購読用URLが開ける', icsRes.status, 200);
eq('カレンダー形式で返る', icsRes.headers.get('content-type'), 'text/calendar; charset=utf-8');
ok('中身がカレンダーになっている', icsText.startsWith('BEGIN:VCALENDAR'), icsText.slice(0, 40));
ok('保存した予定が入っている', icsText.includes('管理職研修'), icsText.slice(0, 300));
ok('会場が入っている', icsText.includes('LOCATION:'));
ok('カレンダー名に持ち主の名前が入る', icsText.includes('テスト講師'));

const icsBadKey = await fetch(BASE + '/ics/' + 'f'.repeat(48) + '.ics');
eq('合言葉がちがうURLでは見えない', icsBadKey.status, 404);

/* =================================================================== */
console.log('\n【7】カレンダー② 外部 → アプリ に取り込む');
/* =================================================================== */

const extDay = addDays(todayStr(), 5);
const extDayCompact = extDay.replace(/-/g, '');
icsToServe = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo',
  'BEGIN:STANDARD', 'TZOFFSETTO:+0900', 'END:STANDARD', 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'UID:ext-1@test', 'SUMMARY:歯医者',
  'DTSTART;TZID=Asia/Tokyo:' + extDayCompact + 'T100000',
  'DTEND;TZID=Asia/Tokyo:' + extDayCompact + 'T110000', 'LOCATION:近所', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:ext-2@test', 'SUMMARY:毎週の打合せ',
  'DTSTART;TZID=Asia/Tokyo:' + extDayCompact + 'T160000',
  'RRULE:FREQ=WEEKLY;COUNT=4', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

await call('PUT', '/api/settings', { ...boot.json.settings, calendars: [{ name: 'テスト暦', url: 'http://127.0.0.1:8798/cal.ics' }] });
const refresh = await call('POST', '/api/calendar/refresh');
eq('取り込みが成功する', refresh.status, 200);
eq('取り込み結果が返る', refresh.json.report[0].ok, true);
ok('単発1件＋毎週4件＝5件を取り込む', refresh.json.report[0].count === 5, JSON.stringify(refresh.json.report));

boot = await call('GET', '/api/bootstrap');
const ext = boot.json.ext;
ok('取り込んだ予定が見える', ext.some(e => e.title === '歯医者' && e.date === extDay && e.startTime === '10:00'),
  JSON.stringify(ext.slice(0, 3)));
eq('くり返しが展開されている', ext.filter(e => e.title === '毎週の打合せ').length, 4);

// もう一度取り込んでも増えない（消えた予定が残らないよう、毎回入れ直す作りの確認）
await call('POST', '/api/calendar/refresh');
boot = await call('GET', '/api/bootstrap');
eq('二度取り込んでも件数は同じ', boot.json.ext.length, ext.length);

// 取り込み元から1件消えたら、アプリ側からも消える
icsToServe = icsToServe.replace(/BEGIN:VEVENT\r\nUID:ext-1@test[\s\S]*?END:VEVENT\r\n/, '');
await call('POST', '/api/calendar/refresh');
boot = await call('GET', '/api/bootstrap');
ok('もとのカレンダーで消した予定は、アプリからも消える',
  !boot.json.ext.some(e => e.title === '歯医者'), JSON.stringify(boot.json.ext.map(e => e.title)));

// 取り込みをやめたカレンダーの予定は、アプリから消えること
boot = await call('GET', '/api/bootstrap');
ok('この時点では取り込んだ予定がある', boot.json.ext.length > 0, String(boot.json.ext.length));
await call('PUT', '/api/settings', { ...boot.json.settings, calendars: [] });
await call('POST', '/api/calendar/refresh');
boot = await call('GET', '/api/bootstrap');
eq('カレンダーを設定から外すと、取り込んだ予定も消える', boot.json.ext.length, 0);

// つながらないURLでも落ちない
await call('PUT', '/api/settings', { ...boot.json.settings, calendars: [{ name: '死んでるURL', url: 'http://127.0.0.1:9/none.ics' }] });
const deadRefresh = await call('POST', '/api/calendar/refresh');
eq('つながらないカレンダーでもサーバーは落ちない', deadRefresh.status, 200);
eq('失敗として報告される', deadRefresh.json.report[0].ok, false);
await call('PUT', '/api/settings', { ...boot.json.settings, calendars: [] });
await call('POST', '/api/calendar/refresh');

/* =================================================================== */
console.log('\n【8】通知 — 端末の登録から、暗号化して届くまで');
/* =================================================================== */

// スマホ側の鍵（本番ではブラウザが作るもの）
const uaPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublicRaw = new Uint8Array(await subtle.exportKey('raw', uaPair.publicKey));
const authSecret = globalThis.crypto.getRandomValues(new Uint8Array(16));
const subscription = {
  endpoint: 'http://127.0.0.1:8799/push/device-1',
  keys: { p256dh: bytesToB64url(uaPublicRaw), auth: bytesToB64url(authSecret) }
};

const badSub = await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://x' } });
eq('中身が足りない登録は断られる', badSub.status, 400);

const sub = await call('POST', '/api/push/subscribe', { subscription, label: 'テスト端末' });
eq('通知のあて先を登録できる', sub.status, 200);
boot = await call('GET', '/api/bootstrap');
eq('登録した端末が1台見える', boot.json.devices.length, 1);
eq('端末の名前が入る', boot.json.devices[0].label, 'テスト端末');

await call('POST', '/api/push/subscribe', { subscription, label: 'テスト端末' });
boot = await call('GET', '/api/bootstrap');
eq('同じ端末を二重に登録しない', boot.json.devices.length, 1);

received.length = 0;
const test = await call('POST', '/api/push/test');
eq('テスト通知の送信が成功する', test.status, 200);
eq('1台に送ったと返る', test.json.sent, 1);
await new Promise(r => setTimeout(r, 300));
eq('偽の通知サーバーが1件受け取った', received.length, 1);

const got = received[0];
ok('身元証明（VAPID）が付いている', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(got.headers.authorization || ''), got.headers.authorization);
eq('暗号化の方式が宣言されている', got.headers['content-encoding'], 'aes128gcm');
ok('TTLが付いている', !!got.headers.ttl, JSON.stringify(got.headers.ttl));

const decrypted = await decryptPayloadForTest(subtle, got.body, uaPair.privateKey, uaPublicRaw, authSecret);
const payload = JSON.parse(decrypted);
eq('端末の鍵で復号すると、通知の中身が読める', payload.title, 'ポケット秘書');
ok('本文が入っている', payload.body.includes('テスト通知'), payload.body);
eq('タップ先が入っている', payload.url, '/');

// 身元証明の署名が本物か、公開鍵で確かめる
const jwt = got.headers.authorization.slice('vapid t='.length).split(', k=')[0];
const [h64, p64, s64] = jwt.split('.');
const verifyKey = await subtle.importKey('raw', b64urlToBytes(boot.json.vapidPublicKey),
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const sigOk = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey,
  b64urlToBytes(s64), new TextEncoder().encode(h64 + '.' + p64));
ok('身元証明の署名が、公開鍵で検証できる', sigOk);
const vapidPayload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p64)));
eq('宛先が通知サーバーの出どころになっている', vapidPayload.aud, 'http://127.0.0.1:8799');

/* =================================================================== */
console.log('\n【9】見回り — 時刻が来た予定を拾えるか');
/* =================================================================== */

// 予定は「今日から3日後の 13:30 開演」。その30分前をのぞいてみる
const at30 = toMs(DAY, '13:00');
const preview = await call('GET', '/api/reminders/preview?now=' + at30);
eq('30分前に1件出る', preview.json.due.length, 1);
ok('その予定の通知になっている', preview.json.due[0].key.startsWith('ev:ev_test1:m30'), preview.json.due[0].key);

const at2h = toMs(DAY, '11:30');
const preview2 = await call('GET', '/api/reminders/preview?now=' + at2h);
eq('2時間前は設定で切ってあるので出ない', preview2.json.due.length, 0);

const atNothing = toMs(DAY, '03:00');
eq('関係ない時刻には何も出ない', (await call('GET', '/api/reminders/preview?now=' + atNothing)).json.due.length, 0);

/* 実際に見回りを動かす（いま鳴る通知があれば送られる） */
received.length = 0;
const sweep1 = await call('POST', '/api/sweep');
eq('見回りが動く', sweep1.status, 200);

/* 同じ通知が二度送られないことを確かめる。
   いま鳴る通知を作るため、1分後が期限のやることを入れる。 */
const nowMs = Date.now();
const nowDate = todayStr(nowMs);
const nowHm = new Date(nowMs + 9 * 3600000).toISOString().slice(11, 16);
await call('PUT', '/api/tasks', { id: ID_NOW, title: 'いま鳴るはずのやること', due: nowDate, dueTime: nowHm });
received.length = 0;
const sweepA = await call('POST', '/api/sweep');
await new Promise(r => setTimeout(r, 300));
const firstCount = received.length;
ok('いま期限のやることが通知される', firstCount >= 1, JSON.stringify(sweepA.json));
if (firstCount >= 1) {
  const p = JSON.parse(await decryptPayloadForTest(subtle, received[received.length - 1].body, uaPair.privateKey, uaPublicRaw, authSecret));
  ok('通知の中身が、そのやることになっている', p.body.includes('いま鳴るはずのやること'), JSON.stringify(p));
}
received.length = 0;
await call('POST', '/api/sweep');
await new Promise(r => setTimeout(r, 300));
eq('もう一度見回っても、同じ通知は送られない', received.length, 0);
await call('DELETE', '/api/tasks/' + ID_NOW);

/* 通知をオフにすると止まる */
boot = await call('GET', '/api/bootstrap');
await call('PUT', '/api/settings', { ...boot.json.settings, notify: { ...boot.json.settings.notify, on: false } });
eq('通知をオフにすると、見回りが何もしない', (await call('POST', '/api/sweep')).json.skipped, 'notify-off');
await call('PUT', '/api/settings', { ...boot.json.settings, notify: { ...boot.json.settings.notify, on: true } });

/* あて先が無効になったら、登録から消える（404を返す偽サーバーで試す） */
const goneServer = http.createServer((req, res) => { res.writeHead(410); res.end(); });
await new Promise(r => goneServer.listen(8797, '127.0.0.1', r));
await call('POST', '/api/push/subscribe', {
  subscription: { endpoint: 'http://127.0.0.1:8797/dead', keys: subscription.keys }, label: '死んだ端末'
});
boot = await call('GET', '/api/bootstrap');
eq('いったん2台になる', boot.json.devices.length, 2);
await call('POST', '/api/push/test');
await new Promise(r => setTimeout(r, 300));
boot = await call('GET', '/api/bootstrap');
eq('受け取れない端末は、登録から自動で消える', boot.json.devices.length, 1);
goneServer.close();

const unsub = await call('POST', '/api/push/unsubscribe', { endpoint: subscription.endpoint });
eq('自分で登録を外せる', unsub.status, 200);
boot = await call('GET', '/api/bootstrap');
eq('端末が0台になる', boot.json.devices.length, 0);

/* =================================================================== */
console.log('\n【9b】本番と同じ経路（1分ごとのCron → 通知）');
/* =================================================================== */

// ここまでで端末の登録を外しているので、登録し直す
await call('POST', '/api/push/subscribe', { subscription, label: 'Cron確認用' });
const nowMs2 = Date.now();
const nowHm2 = new Date(nowMs2 + 9 * 3600000).toISOString().slice(11, 16);
await call('PUT', '/api/tasks', { id: ID_CRON, title: 'Cronで鳴るはずのやること', due: todayStr(nowMs2), dueTime: nowHm2 });

received.length = 0;
// Cloudflare が1分ごとに叩くのと同じ入口（wrangler が用意している確認用のURL）
const cronRes = await fetch(BASE + '/cdn-cgi/local/scheduled');
eq('Cronの入口がエラーにならない', cronRes.status, 200);
await new Promise(r => setTimeout(r, 1200));
ok('Cronから通知が実際に送られる', received.length >= 1, '受け取り数=' + received.length);
if (received.length) {
  const p = JSON.parse(await decryptPayloadForTest(subtle, received[received.length - 1].body, uaPair.privateKey, uaPublicRaw, authSecret));
  ok('Cronで送られた通知の中身が正しい', p.body.includes('Cronで鳴るはずのやること'), JSON.stringify(p));
}
received.length = 0;
await fetch(BASE + '/cdn-cgi/local/scheduled');
await new Promise(r => setTimeout(r, 1200));
eq('Cronが二度動いても、同じ通知は送られない', received.length, 0);
await call('DELETE', '/api/tasks/' + ID_CRON);
await call('POST', '/api/push/unsubscribe', { endpoint: subscription.endpoint });

/* =================================================================== */
console.log('\n【10】バックアップの読み込み');
/* =================================================================== */

const restore = await call('POST', '/api/restore', {
  events: [{ id: 'r1', date: DAY, title: '復元した予定' }],
  tasks: [{ id: 'rt1', title: '復元したやること' }]
});
eq('読み込みが成功する', restore.status, 200);
boot = await call('GET', '/api/bootstrap');
eq('予定が置きかわる', boot.json.events.map(e => e.title), ['復元した予定']);
eq('やることも置きかわる', boot.json.tasks.map(t => t.title), ['復元したやること']);
eq('からっぽの読み込みは断られる', (await call('POST', '/api/restore', { events: [], tasks: [] })).status, 400);

/* =================================================================== */
console.log('\n【11】アプリの画面ファイルが配られるか');
/* =================================================================== */

for (const [path, must] of [
  ['/', '<title>ポケット秘書</title>'],
  ['/index.html', 'id="screen-login"'],
  ['/app.js', 'pocketHisho'],
  ['/style.css', '--on-navy'],
  ['/sw.js', 'addEventListener(\'push\''],
  ['/shared-date.js', 'JST_OFFSET_MS'],
  ['/shared-model.js', 'normalizeEvent'],
  ['/manifest.webmanifest', '"display": "standalone"']
]) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  ok('配られる: ' + path, r.status === 200 && text.includes(must), 'status=' + r.status);
}
const icon = await fetch(BASE + '/icons/icon-192.png');
const iconBuf = Buffer.from(await icon.arrayBuffer());
ok('アイコンが配られる', icon.status === 200 && iconBuf.slice(1, 4).toString() === 'PNG', 'status=' + icon.status);

const unknown = await fetch(BASE + '/どこにもないページ');
const unknownText = await unknown.text();
ok('知らないURLでもアプリが立ち上がる', unknown.status === 200 && unknownText.includes('ポケット秘書'), 'status=' + unknown.status);

const noApi = await call('GET', '/api/そんな操作はない');
eq('知らないAPIは404', noApi.status, 404);

/* =================================================================== */
console.log('\n【12】合言葉の総当たり対策（※これは最後に行う）');
/* =================================================================== */

let lockedAt = 0;
for (let i = 1; i <= 10; i++) {
  const r = await call('POST', '/api/login', { pass: 'はずれ' + i }, false);
  if (r.status === 429) { lockedAt = i; break; }
}
ok('8回まちがえると、しばらく試せなくなる', lockedAt === 8 || lockedAt === 9, 'lockedAt=' + lockedAt);
const afterLock = await call('POST', '/api/login', { pass: PASS }, false);
eq('鍵がかかっている間は、正しい合言葉でも入れない', afterLock.status, 429);
ok('待ち時間が案内される', String(afterLock.json.error).includes('分'), JSON.stringify(afterLock.json));
eq('すでに持っている札は使えたまま', (await call('GET', '/api/bootstrap')).status, 200);

// 入れている端末から、鍵を外せる（打ちまちがえて閉め出されたときの助け）
const unlockNoAuth = await fetch(BASE + '/api/login/unlock', { method: 'POST' });
eq('ログインしていない人は鍵を外せない', unlockNoAuth.status, 401);
eq('入っている端末からは外せる', (await call('POST', '/api/login/unlock')).status, 200);
eq('外したあとは、正しい合言葉で入れる', (await call('POST', '/api/login', { pass: PASS }, false)).status, 200);

console.log('\n────────────────────────────');
console.log('合格 ' + pass + ' ／ 不合格 ' + fail);
if (failures.length) { console.log('\n不合格の一覧:'); failures.forEach(f => console.log('  - ' + f)); }
pushServer.close(); calServer.close();
process.exit(fail ? 1 : 0);
