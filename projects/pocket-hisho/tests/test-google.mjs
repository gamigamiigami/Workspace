/* ポケット秘書 — Googleカレンダー同期の検証
   実行: node tests/test-google.mjs
   （このテストは自分で wrangler dev を別のポートで起動し、偽の Google を立てて確かめる。
     本物の Google には一切つながない）

   確かめること：
     ・身分証（クライアントID・シークレット）の登録と、シークレットを画面に返さないこと
     ・Googleの許可画面 → 戻り先（callback）→ 合鍵の保管、本人確認（state）の使い回し防止
     ・Google → アプリ：取りこみ（日時・場所・メモ）、直した・消したの反映、誕生日などを入れない
     ・アプリ → Google：書きこみ、直した・消したの反映、見本は書かない、同じ予定が2つできない
     ・通信の失敗のやり直し、書きかえられない予定（403）、鍵の取り直し、取り消されたときの案内 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { todayStr, addDays } from '../web/shared-date.js';
import {
  toGoogle, whenOf, applyGoogleToEvent, eventFromGoogle, splitDescription, htmlToText,
  stableGid, appIdFor, timesOf
} from '../src/google.js';
import { normalizeEvent } from '../web/shared-model.js';

const PORT = 8793, GPORT = 8795;
const BASE = 'http://127.0.0.1:' + PORT;
const G = 'http://127.0.0.1:' + GPORT;
const PASS = 'test-pass-1234';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CLIENT_ID = '1234567890-abcdefg.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-test-secret-value';

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
const wait = ms => new Promise(r => setTimeout(r, ms));

/* =================================================================== */
console.log('\n【1】変換（通信なし）');
/* =================================================================== */
{
  const ev = normalizeEvent({
    id: 'e_1', date: '2026-10-05', title: '管理職研修', arriveTime: '12:30', openTime: '13:30', endTime: '16:30',
    venue: { place: '大阪産業創造館', address: '大阪市中央区本町1-4-5' },
    contact: { org: 'サンプル商事', person: '田中', tel: '06-1234-5678' },
    travelGo: { time: '09:03', route: 'のぞみ21号', mins: '50' },
    items: [{ text: 'マイク', done: true }, { text: '名刺', done: false }],
    cost: { fare: 28400 }, memo: '控室は3F'
  });
  const g = toGoogle(ev);
  eq('題名', g.summary, '管理職研修');
  eq('場所は「会場名 住所」', g.location, '大阪産業創造館 大阪市中央区本町1-4-5');
  eq('開始は開演（日本時間）', g.start.dateTime, '2026-10-05T13:30:00+09:00');
  eq('終了', g.end.dateTime, '2026-10-05T16:30:00+09:00');
  ok('終日の印は消す（時刻つきにするとき）', g.start.date === null);
  ok('メモの先頭は人が書いたメモ', g.description.startsWith('控室は3F'));
  ok('線から下にアプリの要約（会場入り・主催・行き・持ち物）',
    /ポケット秘書より[\s\S]*会場入り：12:30[\s\S]*主催：サンプル商事[\s\S]*行き：09:03発 のぞみ21号 約50分[\s\S]*持ち物：名刺/.test(g.description), g.description);
  ok('済んだ持ち物は書かない', !g.description.includes('マイク'));
  ok('お金は Google に書かない', !g.description.includes('28400') && !g.description.includes('28,400'));
  eq('アプリのIDを印として持たせる', g.extendedProperties.private.phId, 'e_1');

  const allDay = timesOf(normalizeEvent({ id: 'x', date: '2026-10-05' }));
  eq('時刻なし → 終日（終わりは翌日）', [allDay.start.date, allDay.end.date], ['2026-10-05', '2026-10-06']);
  const onlyArrive = timesOf(normalizeEvent({ id: 'x', date: '2026-10-05', arriveTime: '09:00' }));
  eq('開演が無ければ会場入りで始まり、1時間の予定', [onlyArrive.start.dateTime, onlyArrive.end.dateTime],
    ['2026-10-05T09:00:00+09:00', '2026-10-05T10:00:00+09:00']);
  const late = timesOf(normalizeEvent({ id: 'x', date: '2026-10-05', openTime: '23:30' }));
  eq('夜遅い予定の終わりは翌日にまたがる', late.end.dateTime, '2026-10-06T00:30:00+09:00');

  eq('世界標準時の予定 → 日本時間', whenOf({ start: { dateTime: '2026-10-05T01:00:00Z' }, end: { dateTime: '2026-10-05T02:30:00Z' } }),
    { date: '2026-10-05', start: '10:00', end: '11:30', allDay: false });
  eq('日をまたぐ予定の終わりは空（開始日だけに出す）', whenOf({ start: { dateTime: '2026-10-05T22:00:00+09:00' }, end: { dateTime: '2026-10-06T01:00:00+09:00' } }).end, '');
  eq('終日の予定', whenOf({ start: { date: '2026-10-07' }, end: { date: '2026-10-08' } }), { date: '2026-10-07', start: '', end: '', allDay: true });

  eq('HTMLのメモをふつうの文字に', htmlToText('1行目<br>2行目&amp;<b>太字</b>'), '1行目\n2行目&太字');
  eq('線から下（アプリの要約）はメモに戻さない', splitDescription('人のメモ\n\n' + g.description.slice(g.description.indexOf('――'))), '人のメモ');

  // Googleで題名と時刻を直した → 細かい中身（運賃・持ち物）は残る
  const fromG = applyGoogleToEvent(ev, { summary: '管理職研修（改）', location: g.location, description: g.description,
    start: { dateTime: '2026-10-05T14:00:00+09:00' }, end: { dateTime: '2026-10-05T17:00:00+09:00' } });
  eq('Googleで直した題名が入る', fromG.title, '管理職研修（改）');
  eq('Googleで直した時刻が入る', [fromG.openTime, fromG.endTime], ['14:00', '17:00']);
  eq('運賃は残る', fromG.cost.fare, 28400);
  eq('会場入りは残る', fromG.arriveTime, '12:30');
  eq('住所は残る（場所が同じとき）', fromG.venue.address, '大阪市中央区本町1-4-5');
  eq('メモは線より上だけ', fromG.memo, '控室は3F');
  const same = applyGoogleToEvent(normalizeEvent({ id: 'y', date: '2026-10-05', arriveTime: '09:00' }),
    { summary: 'a', start: { dateTime: '2026-10-05T09:00:00+09:00' }, end: { dateTime: '2026-10-05T10:00:00+09:00' } });
  eq('日時が同じなら「会場入り／開演」の使い分けを崩さない', [same.arriveTime, same.openTime], ['09:00', '']);

  eq('誕生日は取りこまない', eventFromGoogle({ id: 'b1', eventType: 'birthday', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }), null);
  eq('アプリのIDはURLに安全な文字だけ', appIdFor('abc_20261005T010000Z'), 'g_abc_20261005T010000Z');
  const gid = await stableGid('e_1');
  ok('Googleの予定IDは 0-9a-v だけ・いつも同じ', /^[0-9a-v]{5,1024}$/.test(gid) && gid === await stableGid('e_1') && gid !== await stableGid('e_2'), gid);
}

/* =================================================================== */
/* 偽の Google                                                          */
/* =================================================================== */
const fake = {
  events: new Map(), revoked: false, tokenN: 0, validTokens: new Set(), log: [],
  failNext: {},             // { 'PATCH': 500 } のように、次の1回だけ失敗させる
  forbid: new Set(),        // この予定は書きかえ禁止（招待された予定のまね）
  clock: Date.now()
};
function stamp() { fake.clock = Math.max(fake.clock + 5, Date.now()); return new Date(fake.clock).toISOString(); }
function gEvent(id, o) {
  const ev = { id, status: 'confirmed', updated: stamp(), ...o };
  fake.events.set(id, ev);
  return ev;
}
function startMs(e) { return Date.parse(e.start.dateTime || (e.start.date + 'T00:00:00+09:00')); }
function mergeDeep(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v === null) delete dst[k];
    else if (typeof v === 'object' && !Array.isArray(v) && typeof dst[k] === 'object' && dst[k]) mergeDeep(dst[k], v);
    else dst[k] = (typeof v === 'object' && v && !Array.isArray(v)) ? mergeDeep({}, v) : v;
  }
  return dst;
}
async function readBody(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
const gServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, G);
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  const body = await readBody(req);
  fake.log.push(req.method + ' ' + u.pathname);

  if (u.pathname === '/token') {
    const f = new URLSearchParams(body);
    if (f.get('client_id') !== CLIENT_ID || f.get('client_secret') !== CLIENT_SECRET) return send(401, { error: 'invalid_client' });
    if (f.get('grant_type') === 'authorization_code') {
      if (f.get('redirect_uri') !== BASE + '/api/google/callback') return send(400, { error: 'redirect_uri_mismatch' });
      const code = f.get('code');
      if (code !== 'code-ok' && code !== 'code-noscope') return send(400, { error: 'invalid_grant' });
      fake.revoked = false;
      const at = 'at-' + (++fake.tokenN); fake.validTokens.add(at);
      return send(200, { access_token: at, expires_in: 3600, refresh_token: 'rt-1', token_type: 'Bearer',
        scope: code === 'code-ok' ? SCOPE : 'openid' });
    }
    if (f.get('grant_type') === 'refresh_token') {
      if (fake.revoked || f.get('refresh_token') !== 'rt-1') return send(400, { error: 'invalid_grant' });
      const at = 'at-' + (++fake.tokenN); fake.validTokens.add(at);
      return send(200, { access_token: at, expires_in: 3600, token_type: 'Bearer' });
    }
    return send(400, { error: 'unsupported_grant_type' });
  }
  if (u.pathname === '/revoke') { fake.revoked = true; fake.validTokens.clear(); return send(200, {}); }

  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!fake.validTokens.has(auth)) return send(401, { error: { code: 401, message: 'Invalid Credentials' } });

  const m = /^\/calendar\/v3\/calendars\/primary\/events(?:\/([^/]+))?$/.exec(u.pathname);
  if (!m) return send(404, { error: 'no route' });
  const id = m[1] ? decodeURIComponent(m[1]) : '';
  if (fake.failNext[req.method]) { const st = fake.failNext[req.method]; delete fake.failNext[req.method]; return send(st, { error: 'forced' }); }

  if (req.method === 'GET' && !id) {
    fake.lastFields = u.searchParams.get('fields');
    const tMin = Date.parse(u.searchParams.get('timeMin')), tMax = Date.parse(u.searchParams.get('timeMax'));
    const upd = u.searchParams.get('updatedMin');
    const showDeleted = u.searchParams.get('showDeleted') === 'true' || !!upd;
    let list = [...fake.events.values()].filter(e => {
      if (e.status === 'cancelled' && !showDeleted) return false;
      if (upd && Date.parse(e.updated) < Date.parse(upd)) return false;
      const s = startMs(e);
      return !(s < tMin - 86400000 || s >= tMax);
    });
    list.sort((a, b) => a.id < b.id ? -1 : 1);
    const max = Number(u.searchParams.get('maxResults')) || 250;
    const off = Number(u.searchParams.get('pageToken') || 0);
    const page = list.slice(off, off + max);
    return send(200, { summary: 'lecturer@example.com', items: page, ...(off + max < list.length ? { nextPageToken: String(off + max) } : {}) });
  }
  if (req.method === 'POST' && !id) {
    const b = JSON.parse(body);
    if (fake.events.has(b.id)) return send(409, { error: { code: 409, message: 'The requested identifier already exists.' } });
    if (!/^[0-9a-v]{5,1024}$/.test(b.id)) return send(400, { error: 'bad id' });
    return send(200, gEvent(b.id, b));
  }
  const cur = fake.events.get(id);
  if (req.method === 'PATCH') {
    if (!cur) return send(404, { error: 'not found' });
    if (fake.forbid.has(id)) return send(403, { error: { code: 403, message: 'forbiddenForNonOrganizer' } });
    const b = JSON.parse(body);
    if (cur.status === 'cancelled' && b.status !== 'confirmed') return send(410, { error: 'deleted' });
    mergeDeep(cur, b); cur.updated = stamp();
    return send(200, cur);
  }
  if (req.method === 'DELETE') {
    if (!cur) return send(404, { error: 'not found' });
    if (cur.status === 'cancelled') return send(410, { error: 'deleted' });
    cur.status = 'cancelled'; cur.updated = stamp();
    return send(204);
  }
  return send(405, {});
});
await new Promise(r => gServer.listen(GPORT, '127.0.0.1', r));

/* --- このテスト専用のサーバー（まっさらな保管庫・偽の Google に向ける） --- */
const STATE = new URL('../.wrangler/test-google-state', import.meta.url).pathname;
fs.rmSync(STATE, { recursive: true, force: true });
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE,
  '--var', 'GOOGLE_AUTH_URL:' + G + '/auth',
  '--var', 'GOOGLE_TOKEN_URL:' + G + '/token',
  '--var', 'GOOGLE_REVOKE_URL:' + G + '/revoke',
  '--var', 'GOOGLE_API_BASE:' + G + '/calendar/v3'], {
  cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'], detached: true
});
let devLog = '';
dev.stdout.on('data', d => { devLog += d; });
dev.stderr.on('data', d => { devLog += d; });
async function stop() { try { process.kill(-dev.pid, 'SIGTERM'); } catch {} gServer.close(); }
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE + '/api/ping')).ok) break; } catch {}
  await wait(1000);
}

let token = '';
async function call(method, path, body, useToken = true) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(useToken && token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const byPh = appId => [...fake.events.values()].filter(e => e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.phId === appId);

try {
  /* =================================================================== */
  console.log('\n【2】Google とつなぐ準備（伊神さんの身分証の登録）');
  /* =================================================================== */
  await call('POST', '/api/setup', { pass: PASS }, false);
  token = (await call('POST', '/api/login', { pass: PASS }, false)).json.token;
  let boot = (await call('GET', '/api/bootstrap')).json;
  eq('はじめは準備前', [boot.google.configured, boot.google.connected], [false, false]);
  eq('Google Cloud に登録するリダイレクトURIを教える', boot.google.redirectUri, BASE + '/api/google/callback');
  eq('準備前に「つなぐ」を押すと理由が出る', (await call('POST', '/api/google/auth')).status, 400);
  eq('形のちがうクライアントIDは断る', (await call('PUT', '/api/google/app', { clientId: 'abc', clientSecret: CLIENT_SECRET })).status, 400);
  eq('シークレットが無ければ断る', (await call('PUT', '/api/google/app', { clientId: CLIENT_ID, clientSecret: '' })).status, 400);
  const saved = await call('PUT', '/api/google/app', { clientId: '  ' + CLIENT_ID + ' ', clientSecret: CLIENT_SECRET });
  eq('身分証を登録できる（前後の空白は取る）', [saved.status, saved.json.configured, saved.json.clientId], [200, true, CLIENT_ID]);
  ok('シークレットは画面に返さない', !saved.text.includes(CLIENT_SECRET) && !(await call('GET', '/api/bootstrap')).text.includes(CLIENT_SECRET));
  eq('シークレットを空で送ると前のまま（IDだけ直せる）', (await call('PUT', '/api/google/app', { clientId: CLIENT_ID, clientSecret: '' })).status, 200);
  eq('ログインしていなければ登録できない', (await call('PUT', '/api/google/app', { clientId: CLIENT_ID, clientSecret: 'x' }, false)).status, 401);

  /* --- つなぐ前にアプリで入れた予定（つないだら Google に書きこまれるはず） --- */
  const T = todayStr();
  await call('PUT', '/api/events', { id: 'e_before', date: addDays(T, 5), title: 'つなぐ前の予定', openTime: '13:00', endTime: '15:00',
    venue: { place: '名古屋国際会議場' }, cost: { fare: 12000 } });
  await call('PUT', '/api/events', { id: 'sample_1', date: addDays(T, 6), title: '（見本）' });
  await call('PUT', '/api/events', { id: 'e_old', date: addDays(T, -60), title: 'ずっと前の予定' });
  await wait(300);
  eq('つなぐ前は Google に何も書かない', fake.events.size, 0);

  /* --- Google にもともとある予定 --- */
  const d1 = addDays(T, 2), d3 = addDays(T, 3);
  gEvent('gtimed1', { summary: '打ち合わせ（Googleで入れた）', location: '東京駅 丸の内口',
    description: '資料を持参<br>担当：佐藤さん', start: { dateTime: d1 + 'T01:00:00Z' }, end: { dateTime: d1 + 'T02:30:00Z' } });
  gEvent('gallday1', { summary: '移動日', start: { date: d3 }, end: { date: addDays(d3, 1) } });
  gEvent('gbday', { summary: '誕生日', eventType: 'birthday', start: { date: d3 }, end: { date: addDays(d3, 1) } });
  gEvent('gpast', { summary: 'ずっと前', start: { dateTime: addDays(T, -100) + 'T01:00:00Z' }, end: { dateTime: addDays(T, -100) + 'T02:00:00Z' } });
  gEvent('ginvited', { summary: '招待された会議', start: { dateTime: addDays(T, 4) + 'T05:00:00Z' }, end: { dateTime: addDays(T, 4) + 'T06:00:00Z' } });
  fake.forbid.add('ginvited');

  /* =================================================================== */
  console.log('\n【3】講師の方が「Googleカレンダーとつなぐ」を押す');
  /* =================================================================== */
  const auth = await call('POST', '/api/google/auth');
  const authUrl = new URL(auth.json.url);
  eq('Googleの許可画面へ行く', authUrl.origin + authUrl.pathname, G + '/auth');
  eq('許可画面に必要なもの', [authUrl.searchParams.get('client_id'), authUrl.searchParams.get('redirect_uri'),
    authUrl.searchParams.get('scope'), authUrl.searchParams.get('access_type'), authUrl.searchParams.get('prompt')],
    [CLIENT_ID, BASE + '/api/google/callback', SCOPE, 'offline', 'consent']);
  const state = authUrl.searchParams.get('state');
  ok('本人確認の印（state）が付いている', /^[0-9a-f]{32}$/.test(state || ''));

  const noState = await call('GET', '/api/google/callback?code=code-ok&state=0000', undefined, false);
  eq('知らない state では受けつけない', noState.status, 400);
  const denied = await call('GET', '/api/google/callback?error=access_denied&state=' + state, undefined, false);
  ok('「キャンセル」されたときは理由を出す', denied.status === 400 && denied.text.includes('キャンセル'));

  // カレンダーのチェックを外して許可された場合
  const st2 = new URL((await call('POST', '/api/google/auth')).json.url).searchParams.get('state');
  const noscope = await call('GET', '/api/google/callback?code=code-noscope&state=' + st2, undefined, false);
  ok('カレンダーのチェックが外れていたら、入れ直すよう案内する', noscope.status === 400 && noscope.text.includes('チェック'), noscope.text.slice(0, 200));

  const cb = await call('GET', '/api/google/callback?code=code-ok&state=' + state, undefined, false);
  ok('つながったら「アプリに戻って」の画面', cb.status === 200 && cb.text.includes('つながりました') && cb.text.includes('href="/"'));
  const again = await call('GET', '/api/google/callback?code=code-ok&state=' + state, undefined, false);
  eq('同じ state は二度使えない', again.status, 400);
  await wait(1500);

  /* =================================================================== */
  console.log('\n【4】はじめての同期（Google ⇄ アプリ）');
  /* =================================================================== */
  boot = (await call('GET', '/api/bootstrap')).json;
  eq('つながっている', [boot.google.connected, boot.google.account], [true, 'lecturer@example.com']);
  const gt = boot.events.find(e => e.id === 'g_gtimed1');
  ok('Googleで入れた予定がアプリに入る', !!gt);
  eq('日時は日本時間で入る', gt && [gt.date, gt.openTime, gt.endTime], [d1, '10:00', '11:30']);
  eq('場所が入る', gt && gt.venue.place, '東京駅 丸の内口');
  eq('メモが入る（<br> は改行に）', gt && gt.memo, '資料を持参\n担当：佐藤さん');
  const ga = boot.events.find(e => e.id === 'g_gallday1');
  eq('終日の予定は時刻なしで入る', ga && [ga.date, ga.openTime], [d3, '']);
  ok('誕生日は入らない', !boot.events.some(e => e.id === 'g_gbday'));
  ok('範囲外（ずっと前）の予定は入らない', !boot.events.some(e => e.id === 'g_gpast'));

  const before = byPh('e_before');
  eq('つなぐ前にアプリで入れた予定が Google に書きこまれる', before.length, 1);
  eq('題名・場所・時刻', before[0] && [before[0].summary, before[0].location, before[0].start.dateTime],
    ['つなぐ前の予定', '名古屋国際会議場', addDays(T, 5) + 'T13:00:00+09:00']);
  eq('Googleでの予定IDはアプリのIDから決まる（同じ予定が2つできない）', before[0] && before[0].id, await stableGid('e_before'));
  eq('見本の予定は Google に書かない', byPh('sample_1').length, 0);
  eq('ずっと前の予定は Google に書かない', byPh('e_old').length, 0);
  eq('書きこんだ予定が、アプリに2つ目として戻ってこない', boot.events.filter(e => e.title === 'つなぐ前の予定').length, 1);

  /* =================================================================== */
  console.log('\n【5】アプリで入れる・直す → Google にすぐ出る');
  /* =================================================================== */
  const dNew = addDays(T, 8);
  await call('PUT', '/api/events', { id: 'e_new', date: dNew, title: '福岡セミナー', arriveTime: '12:00', openTime: '13:00', endTime: '16:00',
    venue: { place: '福岡国際会議場', address: '福岡市博多区石城町2-1' }, contact: { org: '九州人材開発', tel: '092-000-0000' },
    items: [{ text: 'プロジェクター', done: false }], memo: '控室あり' });
  await wait(700);
  let gNew = byPh('e_new')[0];
  ok('保存して1秒以内に Google に出る', !!gNew);
  ok('Googleのメモに人のメモと要約', gNew && gNew.description.startsWith('控室あり') && gNew.description.includes('会場入り：12:00') && gNew.description.includes('主催：九州人材開発'), gNew && gNew.description);

  await call('PUT', '/api/events', { id: 'e_new', date: dNew, title: '福岡セミナー（2日目追加）', arriveTime: '12:00', openTime: '14:00', endTime: '17:00',
    venue: { place: '福岡国際会議場', address: '福岡市博多区石城町2-1' }, contact: { org: '九州人材開発', tel: '092-000-0000' },
    items: [{ text: 'プロジェクター', done: false }], memo: '控室あり', cost: { fare: 42000, hotel: 9800 } });
  await wait(700);
  gNew = byPh('e_new');
  eq('直しても Google の予定は1つのまま', gNew.length, 1);
  eq('直した題名と時刻が Google に出る', [gNew[0].summary, gNew[0].start.dateTime], ['福岡セミナー（2日目追加）', dNew + 'T14:00:00+09:00']);

  let sync = (await call('POST', '/api/google/sync')).json;
  eq('自分が書いた変更は「Googleで直された」と数えない', sync.pull && sync.pull.changed, 0);
  const e_new_app = sync.events.find(e => e.id === 'e_new');
  eq('運賃・ホテル代はアプリに残る', e_new_app && [e_new_app.cost.fare, e_new_app.cost.hotel], [42000, 9800]);

  /* =================================================================== */
  console.log('\n【6】Google（やiPhone）で入れる・直す・消す → アプリに入る');
  /* =================================================================== */
  gEvent('gnew2', { summary: 'iPhoneで入れた予定', start: { dateTime: addDays(T, 9) + 'T00:00:00Z' }, end: { dateTime: addDays(T, 9) + 'T01:00:00Z' } });
  const fromApp = fake.events.get(gNew[0].id);
  fromApp.summary = '福岡セミナー（Googleで直した）';
  fromApp.start = { dateTime: dNew + 'T06:00:00Z', timeZone: 'Asia/Tokyo' };
  fromApp.end = { dateTime: dNew + 'T09:00:00Z', timeZone: 'Asia/Tokyo' };
  fromApp.description = '控室は2F\n\n' + fromApp.description.slice(fromApp.description.indexOf('――'));
  fromApp.updated = stamp();
  fake.events.get('gallday1').status = 'cancelled';
  fake.events.get('gallday1').updated = stamp();

  sync = (await call('POST', '/api/google/sync')).json;
  ok('新しい予定が入る', sync.events.some(e => e.id === 'g_gnew2' && e.openTime === '09:00'));
  const fe = sync.events.find(e => e.id === 'e_new');
  eq('Googleで直した題名・時刻・メモがアプリに入る', fe && [fe.title, fe.openTime, fe.endTime, fe.memo],
    ['福岡セミナー（Googleで直した）', '15:00', '18:00', '控室は2F']);
  eq('アプリだけの中身（運賃・会場入り・持ち物・住所）は残る', fe && [fe.cost.fare, fe.arriveTime, fe.items.length, fe.venue.address],
    [42000, '12:00', 1, '福岡市博多区石城町2-1']);
  ok('Googleで消した予定はアプリからも消える', !sync.events.some(e => e.id === 'g_gallday1'));

  // Googleからまるごと消えた（取り消しの知らせが来ない）場合は、6時間ごとの全部見直しで気づく
  fake.events.delete('gnew2');
  sync = (await call('POST', '/api/google/sync', { full: true })).json;
  ok('全部見直しで、Googleに無くなった予定を消す', !sync.events.some(e => e.id === 'g_gnew2'), JSON.stringify(sync.pull));

  /* =================================================================== */
  console.log('\n【7】アプリで消す → Google からも消える');
  /* =================================================================== */
  const gidNew = byPh('e_new')[0].id;
  await call('DELETE', '/api/events/e_new');
  await wait(700);
  eq('Google 側も取り消しになる', fake.events.get(gidNew).status, 'cancelled');
  sync = (await call('POST', '/api/google/sync')).json;
  ok('消した予定がアプリに戻ってこない', !sync.events.some(e => e.id === 'e_new'));

  /* =================================================================== */
  console.log('\n【8】失敗したときのやり直し・書きかえられない予定');
  /* =================================================================== */
  fake.failNext.PATCH = 503;
  await call('PUT', '/api/events', { id: 'e_before', date: addDays(T, 5), title: 'つなぐ前の予定（直した）', openTime: '13:00', endTime: '15:00',
    venue: { place: '名古屋国際会議場' }, cost: { fare: 12000 } });
  await wait(700);
  eq('Googleが混んでいて失敗 → まだ前の題名', byPh('e_before')[0].summary, 'つなぐ前の予定');
  await call('POST', '/api/google/sync');
  eq('次の同期で書きこみ直される', byPh('e_before')[0].summary, 'つなぐ前の予定（直した）');

  const inv = (await call('GET', '/api/bootstrap')).json.events.find(e => e.id === 'g_ginvited');
  await call('PUT', '/api/events', { ...inv, cost: { fare: 5000 }, memo: '自分用メモ' });
  await wait(700);
  const inv2 = (await call('POST', '/api/google/sync')).json.events.find(e => e.id === 'g_ginvited');
  eq('招待された予定（Googleで書きかえ不可）でも、アプリの中身は残る', inv2 && [inv2.cost.fare, inv2.memo], [5000, '自分用メモ']);
  eq('書きかえ不可の予定を何度も送り直さない', fake.log.filter(l => l === 'PATCH /calendar/v3/calendars/primary/events/ginvited').length, 1);

  /* 同時に保存と同期が走っても、Google に同じ予定が2つできない */
  const dRace = addDays(T, 11);
  await Promise.all([
    call('PUT', '/api/events', { id: 'e_race', date: dRace, title: '同時' }),
    call('POST', '/api/google/sync'), call('POST', '/api/google/sync')
  ]);
  await wait(800);
  await call('POST', '/api/google/sync');
  eq('保存と同期が同時でも、Googleの予定は1つ', byPh('e_race').length, 1);

  /* =================================================================== */
  console.log('\n【8b】1分ごとの見回り（本番と同じ経路）でも取りこむ・書きこむ');
  /* =================================================================== */
  gEvent('gcron', { summary: '見回りで入る予定', start: { dateTime: addDays(T, 10) + 'T03:00:00Z' }, end: { dateTime: addDays(T, 10) + 'T04:00:00Z' } });
  fake.failNext.POST = 500;
  await call('PUT', '/api/events', { id: 'e_cron', date: addDays(T, 10), title: '見回りで書きこまれる予定' });
  await wait(600);
  eq('（Googleが失敗して、まだ書きこまれていない）', byPh('e_cron').length, 0);
  const cronRes = await fetch(BASE + '/cdn-cgi/local/scheduled');
  await wait(1500);
  eq('見回りが動く', cronRes.status, 200);
  eq('見回りで、書きこみ待ちの予定が Google に書きこまれる', byPh('e_cron').length, 1);
  const afterCron = (await call('GET', '/api/bootstrap')).json.events;
  ok('見回りで、Googleで入れた予定がアプリに入る', afterCron.some(e => e.id === 'g_gcron' && e.openTime === '12:00'));

  /* =================================================================== */
  console.log('\n【8c】Googleに予定がたくさんあるとき（無料枠の計算時間に収めるため、分けて取りこむ）');
  /* =================================================================== */
  for (let i = 0; i < 400; i++) {
    const d = addDays(T, 20 + (i % 200));
    gEvent('gbulk' + String(i).padStart(3, '0'), { summary: 'たくさん' + i, start: { dateTime: d + 'T00:00:00Z' }, end: { dateTime: d + 'T01:00:00Z' } });
  }
  const bulkCount = evs => evs.filter(e => e.id.startsWith('g_gbulk')).length;
  const s1 = (await call('POST', '/api/google/sync')).json;
  eq('1回目は150件まで', [bulkCount(s1.events), s1.pull.more], [150, true]);
  const s2 = (await call('POST', '/api/google/sync')).json;
  eq('2回目で続きを取りこむ', bulkCount(s2.events), 300);
  const s3 = (await call('POST', '/api/google/sync')).json;
  eq('3回目で全部そろう', [bulkCount(s3.events), s3.pull.more], [400, false]);
  const s4 = (await call('POST', '/api/google/sync')).json;
  eq('そろったあとは増えない（二重にならない）', [bulkCount(s4.events), s4.pull.added], [400, 0]);
  eq('Googleに「必要な欄だけ」を頼んでいる', fake.lastFields, 'nextPageToken,summary,items(id,status,summary,location,description,start,end,updated,eventType,extendedProperties)');

  /* =================================================================== */
  console.log('\n【9】鍵の取り直し・つながりが切れたとき・切るとき');
  /* =================================================================== */
  fake.validTokens.clear();                  // 短期の鍵だけが先に切れた
  gEvent('gafter', { summary: '鍵が切れたあとに入れた予定', start: { date: addDays(T, 12) }, end: { date: addDays(T, 13) } });
  sync = (await call('POST', '/api/google/sync')).json;
  ok('短期の鍵が切れても、自動で取り直して続ける', sync.events.some(e => e.id === 'g_gafter'), JSON.stringify(sync).slice(0, 200));

  fake.revoked = true; fake.validTokens.clear();   // 講師の方がGoogle側で許可を取り消した
  await call('POST', '/api/google/sync');
  boot = (await call('GET', '/api/bootstrap')).json;
  eq('取り消されたら「つなぎ直して」と案内する', [boot.google.connected, boot.google.needsReconnect], [false, true]);
  ok('理由が画面に出る', /もう一度/.test(boot.google.error), boot.google.error);
  ok('それまでの予定はアプリに残る', boot.events.some(e => e.id === 'g_gtimed1'));

  // つなぎ直す
  const st3 = new URL((await call('POST', '/api/google/auth')).json.url).searchParams.get('state');
  await call('GET', '/api/google/callback?code=code-ok&state=' + st3, undefined, false);
  await wait(1200);
  boot = (await call('GET', '/api/bootstrap')).json;
  eq('つなぎ直せる', [boot.google.connected, boot.google.needsReconnect], [true, false]);
  eq('つなぎ直しても予定は増えない（二重にならない）', boot.events.filter(e => e.id === 'g_gtimed1').length, 1);

  const disc = (await call('POST', '/api/google/disconnect')).json;
  eq('つながりを切れる', disc.connected, false);
  ok('Googleにも合鍵の取り消しを伝える', fake.log.includes('POST /revoke'));
  await call('PUT', '/api/events', { id: 'e_offline', date: addDays(T, 14), title: '切ったあとの予定' });
  await wait(500);
  eq('切ったあとは Google に書きこまない', byPh('e_offline').length, 0);
} catch (e) {
  fail++; failures.push('例外: ' + (e && e.stack || e));
  console.log('  ❌ 例外', e);
  console.log(devLog.slice(-2000));
} finally {
  await stop();
}

console.log('\n────────────────────────────');
console.log('合格 ' + pass + ' ／ 不合格 ' + fail);
if (failures.length) { console.log('\n不合格の一覧:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
