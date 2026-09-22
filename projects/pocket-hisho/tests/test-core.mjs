/* ポケット秘書 — 土台の検証（日付・ICS・通知の暗号化）
   実行: node tests/test-core.mjs                                        */

import {
  jstParts, jstToMs, toMs, ymdOf, hmOf, todayStr, addDays, addMonths, addYears,
  mondayOf, weekdayOf, diffDays, fmtDay, fmtFull, reminderAt, isYmd
} from '../web/shared-date.js';
import { buildIcs, parseIcs, expandRecurrences, icsStampUtc } from '../src/ics.js';
import {
  generateVapidKeys, makeVapidHeader, encryptPayload, decryptPayloadForTest,
  b64urlToBytes, bytesToB64url
} from '../src/push.js';

const subtle = globalThis.crypto.subtle;
let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

/* =================================================================== */
console.log('\n【1】日付 — 日本時間で数えられているか');
/* =================================================================== */

// 日本時間 2026-09-25 00:30 は、世界標準時では前日 15:30
const ms = jstToMs(2026, 9, 25, 0, 30);
eq('日本の 9/25 00:30 → 世界標準時は 9/24 15:30', new Date(ms).toISOString(), '2026-09-24T15:30:00.000Z');
eq('その時刻を日本時間で見ると 9/25', ymdOf(ms), '2026-09-25');
eq('その時刻の日本時間の時計', hmOf(ms), '00:30');
eq('部品に分けても日本時間', jstParts(ms), { y: 2026, m: 9, d: 25, hh: 0, mm: 30, w: 5 });

// 世界標準時の深夜は、日本ではもう昼すぎ＝日付がずれる代表例
eq('世界標準時 9/24 23:00 は 日本では 9/25', ymdOf(Date.parse('2026-09-24T23:00:00Z')), '2026-09-25');
eq('世界標準時 9/25 14:59 は 日本では 9/25', ymdOf(Date.parse('2026-09-25T14:59:00Z')), '2026-09-25');
eq('世界標準時 9/25 15:00 は 日本では 9/26', ymdOf(Date.parse('2026-09-25T15:00:00Z')), '2026-09-26');

eq('月末：1/31 の翌月は 2/28', addMonths('2026-01-31', 1), '2026-02-28');
eq('月末：3/31 の前月は 2/28', addMonths('2026-03-31', -1), '2026-02-28');
eq('うるう：2028-02-29 の翌年は 2029-02-28', addYears('2028-02-29', 1), '2029-02-28');
eq('うるう年の 2/29 は存在する', addDays('2028-02-28', 1), '2028-02-29');
eq('年またぎ：12/31 の翌日', addDays('2026-12-31', 1), '2027-01-01');
eq('年またぎ：1/1 の前日', addDays('2027-01-01', -1), '2026-12-31');
eq('週のはじめ：金曜 2027-01-01 の月曜は前年', mondayOf('2027-01-01'), '2026-12-28');
eq('週のはじめ：日曜は前の月曜', mondayOf('2026-09-27'), '2026-09-21');
eq('週のはじめ：月曜はその日', mondayOf('2026-09-21'), '2026-09-21');
eq('曜日：2026-09-25 は金曜(5)', weekdayOf('2026-09-25'), 5);
eq('日数の差', diffDays('2026-09-22', '2026-09-25'), 3);
eq('日数の差（逆向き）', diffDays('2026-09-25', '2026-09-22'), -3);
eq('表示（短い）', fmtDay('2026-09-25'), '9/25(金)');
eq('表示（長い）', fmtFull('2026-09-25'), '2026年9月25日(金)');

// リマインドの時刻
eq('30分前の通知（13:30開演 → 13:00）',
  hmOf(reminderAt('2026-09-25', '13:30', 30)), '13:00');
eq('2時間前の通知（13:30開演 → 11:30）',
  hmOf(reminderAt('2026-09-25', '13:30', 120)), '11:30');
eq('前日の通知は日付も前日になる（13:30開演の24時間前）',
  ymdOf(reminderAt('2026-09-25', '13:30', 24 * 60)), '2026-09-24');
eq('時刻のない予定は、決めた時刻に通知（当日8時）',
  [ymdOf(reminderAt('2026-09-25', '', 0)), hmOf(reminderAt('2026-09-25', '', 0))], ['2026-09-25', '08:00']);
eq('時刻のない予定の前日通知は、前日の8時',
  [ymdOf(reminderAt('2026-09-25', '', 24 * 60)), hmOf(reminderAt('2026-09-25', '', 24 * 60))], ['2026-09-24', '08:00']);
eq('日をまたぐ通知（00:30開演の2時間前は前日22:30）',
  [ymdOf(reminderAt('2026-09-25', '00:30', 120)), hmOf(reminderAt('2026-09-25', '00:30', 120))], ['2026-09-24', '22:30']);

/* =================================================================== */
console.log('\n【2】ICS — アプリ → カレンダー（購読用URLの中身）');
/* =================================================================== */

const sample = [{
  id: 'e1', date: '2026-09-25', title: '管理職向け コミュニケーション研修',
  arriveTime: '12:30', openTime: '13:30', endTime: '16:30',
  venue: { place: '大阪産業創造館 5Fホール', address: '大阪市中央区本町1-4-5' },
  contact: { org: '株式会社サンプル商事', person: '田中 太郎', tel: '06-1234-5678' },
  // ICSで特別な意味を持つ半角記号（; , \ 改行）を、わざと入れて試す
  memo: '控室は3F; 駐車券は受付で,もらう\n\\印は搬入口'
}, {
  id: 'e2', date: '2026-10-08', title: '時刻未定の打合せ',
  venue: { place: '仙台市民会館', address: '' }, contact: {}, memo: ''
}];

const ics = buildIcs(sample, { now: Date.parse('2026-09-22T03:00:00Z') });
ok('ICSの形になっている', ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trimEnd().endsWith('END:VCALENDAR'));
ok('行の区切りは CRLF', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
ok('開演 13:30(日本) が 04:30Z で入る', ics.includes('DTSTART:20260925T043000Z'), ics.match(/DTSTART[^\r]*/g));
ok('終了 16:30(日本) が 07:30Z で入る', ics.includes('DTEND:20260925T073000Z'));
ok('時刻のない予定は終日になる', ics.includes('DTSTART;VALUE=DATE:20261008'));
ok('終日の終わりは翌日', ics.includes('DTEND;VALUE=DATE:20261009'));
ok('半角記号が打ち消されている（; , \\）', ics.includes('\\;') && ics.includes('\\,') && ics.includes('\\\\'));
ok('改行が \\n になっている', ics.includes('DESCRIPTION:') && /DESCRIPTION:[^\r]*\\n/.test(ics.replace(/\r\n /g, '')));
// 折り返しの決まり：どの行も75バイト以内
const tooLong = ics.split('\r\n').filter(l => new TextEncoder().encode(l).length > 75);
ok('75バイトを超える行がない（折り返せている）', tooLong.length === 0, JSON.stringify(tooLong.slice(0, 2)));

/* =================================================================== */
console.log('\n【3】ICS — カレンダー → アプリ（読み取り）');
/* =================================================================== */

// 自分が出したものを読み戻せるか
const back = parseIcs(ics);
eq('2件とも読み戻せる', back.length, 2);
eq('日付が一致', back[0].date, '2026-09-25');
eq('開始時刻が日本時間で戻る', back[0].startTime, '13:30');
eq('終了時刻も日本時間で戻る', back[0].endTime, '16:30');
eq('題名が元に戻る', back[0].title, '管理職向け コミュニケーション研修');
eq('場所が元に戻る', back[0].location, '大阪産業創造館 5Fホール 大阪市中央区本町1-4-5');
ok('打ち消した記号が元どおりに戻る', back[0].desc.includes('控室は3F; 駐車券は受付で,もらう\n\\印は搬入口'), JSON.stringify(back[0].desc));
eq('終日の予定は allDay になる', back[1].allDay, true);

// Googleカレンダーが実際に出す形（VTIMEZONE + TZID + 折り返し）
const googleLike = [
  'BEGIN:VCALENDAR', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0',
  'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:テスト',
  'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'DTSTART:19700101T000000',
  'END:STANDARD', 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'DTSTART;TZID=Asia/Tokyo:20261110T140000', 'DTEND;TZID=Asia/Tokyo:20261110T153000',
  'UID:abc123@google.com', 'SUMMARY:日本時間で入った予定', 'LOCATION:名古屋', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261112T010000Z', 'DTEND:20261112T020000Z',
  'UID:utc1@google.com', 'SUMMARY:世界標準時で入った予定', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261121',
  'UID:allday@google.com', 'SUMMARY:終日の予定', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;TZID=Asia/Tokyo:20261201T090000', 'UID:cancel@google.com',
  'SUMMARY:取り消された予定', 'STATUS:CANCELLED', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;TZID=Asia/Tokyo:20261210T100000', 'UID:fold@google.com',
  'SUMMARY:とても長い題名のテストでありここは折り返される想定の行で', ' す。続きの部分',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const g = parseIcs(googleLike);
eq('Googleの形から5件読める', g.length, 5);
eq('TZID=Asia/Tokyo はそのまま日本時間', [g[0].date, g[0].startTime, g[0].endTime], ['2026-11-10', '14:00', '15:30']);
eq('末尾Zの世界標準時は日本時間へ直る（01:00Z→10:00）', [g[1].date, g[1].startTime], ['2026-11-12', '10:00']);
eq('終日の予定', [g[2].date, g[2].allDay], ['2026-11-20', true]);
eq('折り返された題名が1本につながる', g[4].title, 'とても長い題名のテストでありここは折り返される想定の行です。続きの部分');

const gx = expandRecurrences(g, '2026-11-01', '2026-12-31');
eq('取り消された予定は展開されない', gx.filter(e => e.title === '取り消された予定').length, 0);
eq('取り消し以外の4件は出る', gx.length, 4);

// 時差が日本以外のカレンダー
const nyLike = [
  'BEGIN:VCALENDAR',
  'BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:STANDARD', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT', 'DTSTART;TZID=America/New_York:20261201T200000', 'UID:ny@x', 'SUMMARY:NY', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');
const ny = parseIcs(nyLike);
eq('ニューヨーク 12/1 20:00 は 日本の 12/2 10:00', [ny[0].date, ny[0].startTime], ['2026-12-02', '10:00']);

/* =================================================================== */
console.log('\n【4】ICS — くり返し予定の展開');
/* =================================================================== */

function rr(rrule, dtstart, extra = '') {
  return parseIcs([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:r@x', 'SUMMARY:くり返し',
    'DTSTART;TZID=Asia/Tokyo:' + dtstart, 'RRULE:' + rrule, extra,
    'END:VEVENT', 'END:VCALENDAR'
  ].filter(Boolean).join('\r\n'));
}

let x = expandRecurrences(rr('FREQ=DAILY;COUNT=5', '20261101T090000'), '2026-11-01', '2026-12-31');
eq('毎日5回', x.map(e => e.date), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);

x = expandRecurrences(rr('FREQ=DAILY;INTERVAL=3;COUNT=4', '20261101T090000'), '2026-11-01', '2026-12-31');
eq('3日おきに4回', x.map(e => e.date), ['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10']);

x = expandRecurrences(rr('FREQ=WEEKLY;COUNT=3', '20261105T090000'), '2026-11-01', '2026-12-31');
eq('毎週3回（木曜）', x.map(e => e.date), ['2026-11-05', '2026-11-12', '2026-11-19']);

x = expandRecurrences(rr('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261116T000000Z', '20261102T090000'), '2026-11-01', '2026-12-31');
eq('毎週 月・水（11/16まで）', x.map(e => e.date),
  ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11', '2026-11-16']);

x = expandRecurrences(rr('FREQ=MONTHLY;COUNT=4', '20261231T090000'), '2026-12-01', '2027-12-31');
eq('毎月：12/31 から4回（無い月は末日）', x.map(e => e.date),
  ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);

x = expandRecurrences(rr('FREQ=YEARLY;COUNT=3', '20280229T090000'), '2028-01-01', '2031-12-31');
eq('毎年：うるう日から3回', x.map(e => e.date), ['2028-02-29', '2029-02-28', '2030-02-28']);

x = expandRecurrences(rr('FREQ=DAILY;COUNT=5', '20261101T090000', 'EXDATE;TZID=Asia/Tokyo:20261103T090000'), '2026-11-01', '2026-12-31');
eq('除外した日は出ない', x.map(e => e.date), ['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05']);

x = expandRecurrences(rr('FREQ=DAILY', '20261101T090000'), '2026-11-10', '2026-11-12');
eq('終わりのない毎日でも、見たい期間だけ返る', x.map(e => e.date), ['2026-11-10', '2026-11-11', '2026-11-12']);

x = expandRecurrences(rr('FREQ=HOURLY;COUNT=5', '20261101T090000'), '2026-11-01', '2026-12-31');
eq('対応していない繰り返しは1回だけ返す（落ちない）', x.map(e => e.date), ['2026-11-01']);

const started = expandRecurrences(rr('FREQ=DAILY;COUNT=3', '20261101T090000'), '2026-11-01', '2026-12-31');
ok('展開した回ごとに別のIDが付く', new Set(started.map(e => e.uid)).size === 3, JSON.stringify(started.map(e => e.uid)));
eq('時刻は各回で保たれる', started[2].startTime, '09:00');

/* =================================================================== */
console.log('\n【5】通知の暗号化 — 自分で復号して確かめる');
/* =================================================================== */

// スマホ側の鍵の組を用意する（本番ではブラウザが作るもの）
const uaPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublicRaw = new Uint8Array(await subtle.exportKey('raw', uaPair.publicKey));
const authSecret = globalThis.crypto.getRandomValues(new Uint8Array(16));
const subscription = {
  endpoint: 'https://web.push.apple.com/abcdef',
  keys: { p256dh: bytesToB64url(uaPublicRaw), auth: bytesToB64url(authSecret) }
};

const message = JSON.stringify({ title: 'つぎのセミナー', body: '13:30 開演／大阪産業創造館', url: '/?d=2026-09-25' });
const packed = await encryptPayload(subtle, subscription, message);
ok('送信用のかたまりができる', packed.body instanceof Uint8Array && packed.body.length > 100, String(packed.body && packed.body.length));
eq('中身の形式が正しく宣言されている', packed.headers['Content-Encoding'], 'aes128gcm');
eq('先頭16バイトのあとに記録の大きさが入る',
  new DataView(packed.body.buffer, packed.body.byteOffset).getUint32(16, false), 4096);
eq('鍵の長さは65バイト', packed.body[20], 65);

const decrypted = await decryptPayloadForTest(subtle, packed.body, uaPair.privateKey, uaPublicRaw, authSecret);
eq('暗号化 → 復号 で、元の文がそのまま戻る', decrypted, message);

const packed2 = await encryptPayload(subtle, subscription, message);
ok('毎回ちがう暗号文になる（使い捨ての鍵が効いている）',
  bytesToB64url(packed.body) !== bytesToB64url(packed2.body));

// 日本語とあふれる長さ
const longMsg = JSON.stringify({ title: '長いお知らせ', body: 'あ'.repeat(600) });
const packedLong = await encryptPayload(subtle, subscription, longMsg);
eq('日本語の長い本文も、そのまま戻る',
  await decryptPayloadForTest(subtle, packedLong.body, uaPair.privateKey, uaPublicRaw, authSecret), longMsg);

// 別の端末の鍵では復号できない（＝他人には読めない）
const otherPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
let leaked = false;
try {
  await decryptPayloadForTest(subtle, packed.body, otherPair.privateKey, uaPublicRaw, authSecret);
  leaked = true;
} catch (e) { /* 復号できないのが正しい */ }
ok('他人の鍵では中身を読めない', !leaked);

/* =================================================================== */
console.log('\n【6】身元証明（VAPID）の署名');
/* =================================================================== */

const vapid = await generateVapidKeys(subtle);
ok('公開鍵は65バイト', b64urlToBytes(vapid.publicKey).length === 65, String(b64urlToBytes(vapid.publicKey).length));
ok('秘密鍵はJWK形式で取り出せる', vapid.privateJwk && vapid.privateJwk.kty === 'EC' && !!vapid.privateJwk.d);

const now = Date.parse('2026-09-22T03:00:00Z');
const header = await makeVapidHeader(
  subtle, vapid.privateJwk, vapid.publicKey, 'https://web.push.apple.com', 'mailto:owner@example.com', now);
ok('Authorization ヘッダの形が正しい', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(header.Authorization), header.Authorization);

const jwt = header.Authorization.slice('vapid t='.length).split(', k=')[0];
const [h64, p64, s64] = jwt.split('.');
const head = JSON.parse(new TextDecoder().decode(b64urlToBytes(h64)));
const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p64)));
eq('署名の方式は ES256', head, { typ: 'JWT', alg: 'ES256' });
eq('宛先は送信先の出どころ', payload.aud, 'https://web.push.apple.com');
eq('連絡先が入っている', payload.sub, 'mailto:owner@example.com');
eq('有効期限は12時間後', payload.exp, Math.floor(now / 1000) + 12 * 3600);

// 公開鍵で署名を検証する（＝通知サーバーがやることと同じ）
const verifyKey = await subtle.importKey(
  'raw', b64urlToBytes(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const valid = await subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, verifyKey,
  b64urlToBytes(s64), new TextEncoder().encode(h64 + '.' + p64));
ok('公開鍵で署名を検証できる', valid);

const tampered = h64 + '.' + bytesToB64url(new TextEncoder().encode(JSON.stringify({ ...payload, aud: 'https://evil.example' })));
const validTampered = await subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b64urlToBytes(s64), new TextEncoder().encode(tampered));
ok('中身を書きかえた証明書は検証に落ちる', !validTampered);

/* =================================================================== */
console.log('\n────────────────────────────');
console.log('合格 ' + pass + ' ／ 不合格 ' + fail);
if (failures.length) { console.log('\n不合格の一覧:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
