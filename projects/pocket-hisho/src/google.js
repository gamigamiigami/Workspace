/* =====================================================================
   Googleカレンダーとの同期（Googleカレンダーを「本物の置き場所」にする）

   ・アプリで保存した予定は、その場で Googleカレンダーに書きこむ（数秒）
   ・Googleカレンダー（パソコン・Googleのアプリ・Googleアカウントを入れたiPhone）で
     入れた・直した・消した予定は、1分ごとの見回りで取りこむ（アプリを開いたときはその場で）

   Googleに入れるのは「題名・日時・場所・メモ」。
   運賃・持ち物・連絡先などの細かい中身はアプリ側に持ち、Googleのメモ欄には要約を書く
   （要約は「ポケット秘書より」の線から下。ここはアプリが毎回書き直す）。

   ログインのしくみ（OAuth）：
     伊神さんが Google Cloud で「アプリの身分証（クライアントID・シークレット）」を作ってアプリに登録
     → 講師の方が「Googleカレンダーとつなぐ」を押して、自分のGoogleで許可する
     → Googleから「合鍵（リフレッシュトークン）」が届くので、サーバーに保管して使い続ける
   お金はかからない（Google Calendar API は無料）。
   ===================================================================== */

import { ymdOf, hmOf, toMs, addDays, todayStr, isYmd, isHm } from '../web/shared-date.js';
import { normalizeEvent, blankEvent, eventStartTime } from '../web/shared-model.js';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/* 本物の Google の宛先。テストのときだけ、Cloudflare の変数で偽物に差しかえられる */
function endpoints(env) {
  return {
    auth: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    token: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    revoke: env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
    api: env.GOOGLE_API_BASE || 'https://www.googleapis.com/calendar/v3'
  };
}

const CAL = 'primary';                     // 講師の方の「いつものカレンダー」
const WINDOW_PAST_DAYS = 14;               // 取りこむ範囲：2週間前〜
const WINDOW_FUTURE_DAYS = 365;            //               〜1年先
const FULL_EVERY_MS = 6 * 3600 * 1000;     // 6時間ごとに「全部見直し」（取りこぼし・消えた予定の確認）
const MARK = '―― ポケット秘書より（この線から下はアプリが書き直します）――';
// 1回の見回りで新しく取りこむのは150件まで。Cloudflare の無料枠は1回あたりの計算時間が短い（10ミリ秒）ため、
// はじめての同期で何百件もあるときは、何回かの見回りに分けて取りこむ（600件なら4分ほど）
const MAX_NEW_PER_RUN = 150;
// Googleに「この欄だけ送って」と頼む（送られてくる量が半分ほどになり、読むのが速い）
const LIST_FIELDS = 'nextPageToken,summary,items(id,status,summary,location,description,start,end,updated,eventType,extendedProperties)';

/* =====================================================================
   1. アプリの予定 ⇄ Googleの予定 の変換（通信なし・テストしやすい部分）
   ===================================================================== */

/** 会場の文字（Googleの「場所」欄） */
export function locationOf(ev) {
  return [ev.venue.place, ev.venue.address].filter(Boolean).join(' ');
}

/** Googleのメモ欄に書く、細かい中身の要約（アプリ → Google の一方通行） */
export function detailsOf(ev) {
  const d = [];
  if (isHm(ev.arriveTime)) d.push('会場入り：' + ev.arriveTime);
  if (ev.contact.org) d.push('主催：' + ev.contact.org);
  if (ev.contact.person) d.push('担当：' + ev.contact.person + ' さん');
  if (ev.contact.tel) d.push('電話：' + ev.contact.tel);
  const trip = (label, t) => {
    const s = [t.time && t.time + '発', t.route, t.mins && '約' + t.mins + '分'].filter(Boolean).join(' ');
    if (s) d.push(label + '：' + s);
  };
  trip('行き', ev.travelGo);
  trip('帰り', ev.travelBack);
  if (ev.stay.place) d.push('宿泊：' + ev.stay.place + (ev.stay.tel ? '（' + ev.stay.tel + '）' : ''));
  const items = ev.items.filter(i => !i.done).map(i => i.text);
  if (items.length) d.push('持ち物：' + items.join('、'));
  return d.join('\n');
}

/** メモ欄を「人が書いたところ」と「アプリが書いたところ」に分ける */
export function splitDescription(desc) {
  const text = htmlToText(desc || '');
  const i = text.indexOf(MARK);
  return (i >= 0 ? text.slice(0, i) : text).replace(/\s+$/, '').replace(/^\s+/, '');
}

/** Googleカレンダーの画面で書いたメモは HTML（<br> など）になっていることがあるので、ふつうの文字に戻す */
export function htmlToText(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** 'YYYY-MM-DD' と 'HH:MM'（日本時間）→ Googleの時刻の書き方 */
function rfcJst(ms) {
  return ymdOf(ms) + 'T' + hmOf(ms) + ':00+09:00';
}

/** アプリの予定の「開始・終了」を Google の形にする。時刻が無ければ終日 */
export function timesOf(ev) {
  const st = eventStartTime(ev);
  if (isHm(st)) {
    const s = toMs(ev.date, st);
    let e = isHm(ev.endTime) ? toMs(ev.date, ev.endTime) : NaN;
    if (!(e > s)) e = s + 60 * 60 * 1000;             // 終了が無い・開始より前なら1時間の予定
    return {
      start: { dateTime: rfcJst(s), timeZone: 'Asia/Tokyo', date: null },
      end: { dateTime: rfcJst(e), timeZone: 'Asia/Tokyo', date: null }
    };
  }
  return {
    start: { date: ev.date, dateTime: null, timeZone: null },
    end: { date: addDays(ev.date, 1), dateTime: null, timeZone: null }
  };
}

/** アプリの予定 → Googleに送る中身（書きかえ用。null は「その欄を空にする」の意味） */
export function toGoogle(ev) {
  const details = detailsOf(ev);
  const desc = [ev.memo.trim(), details ? MARK + '\n' + details : ''].filter(Boolean).join('\n\n');
  return {
    summary: ev.title || ev.venue.place || '予定',
    location: locationOf(ev),
    description: desc,
    ...timesOf(ev),
    extendedProperties: { private: { phId: ev.id } }
  };
}

/** Googleの予定の日時を、日本時間の「日付・開始・終了」にする */
export function whenOf(item) {
  const s = item.start || {}, e = item.end || {};
  if (s.date) return { date: s.date, start: '', end: '', allDay: true };
  const sm = Date.parse(s.dateTime), em = Date.parse(e.dateTime);
  if (!Number.isFinite(sm)) return null;
  const date = ymdOf(sm);
  return {
    date, start: hmOf(sm),
    end: Number.isFinite(em) && ymdOf(em) === date && em > sm ? hmOf(em) : '',
    allDay: false
  };
}

/** アプリの予定を、Google で直された内容に合わせる（細かい中身は残す） */
export function applyGoogleToEvent(ev, item) {
  const out = normalizeEvent(ev);
  out.title = item.summary || '';
  const w = whenOf(item);
  if (w) {
    // 同じ日時なら触らない（アプリの「会場入り」「開演」の使い分けを崩さないため）
    const mine = timesOf(out), theirs = { start: item.start || {}, end: item.end || {} };
    const same = w.allDay
      ? (!mine.start.dateTime && mine.start.date === w.date)
      : (mine.start.dateTime && Date.parse(mine.start.dateTime) === Date.parse(theirs.start.dateTime) &&
         Date.parse(mine.end.dateTime) === Date.parse(theirs.end.dateTime));
    if (!same) {
      out.date = w.date;
      if (w.allDay) { out.openTime = ''; out.arriveTime = ''; out.endTime = ''; }
      else { out.openTime = w.start; out.endTime = w.end; }
    }
  }
  const loc = item.location || '';
  if (loc !== locationOf(out)) { out.venue.place = loc; out.venue.address = ''; }
  out.memo = splitDescription(item.description);
  return out;
}

/** Googleにしかない予定から、アプリの予定を作る */
export function eventFromGoogle(item) {
  if (isNoise(item)) return null;
  const w = whenOf(item);
  if (!w || !isYmd(w.date)) return null;
  const ev = blankEvent();
  ev.id = appIdFor(item.id);
  ev.title = item.summary || '';
  ev.date = w.date;
  ev.openTime = w.start;
  ev.endTime = w.end;
  ev.venue.place = item.location || '';
  ev.memo = splitDescription(item.description);
  return normalizeEvent(ev);
}

/** Googleが自動で入れる「誕生日」「勤務場所」は予定として取りこまない（通知がうるさくなるため） */
export function isNoise(item) {
  return item && (item.eventType === 'birthday' || item.eventType === 'workingLocation');
}

/** Googleの予定IDから、アプリで使うIDを作る（URLに入れても安全な文字だけ） */
export function appIdFor(gid) {
  return 'g_' + String(gid).replace(/[^\w-]/g, '').slice(0, 120);
}

/* =====================================================================
   2. 身分証（クライアントID）と合鍵（トークン）
   ===================================================================== */

async function kvGet(env, key) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  if (!row) return null;
  try { return JSON.parse(row.v); } catch { return null; }
}
async function kvPut(env, key, value) {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, JSON.stringify(value)).run();
}
function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function redirectUriFor(origin) { return origin + '/api/google/callback'; }

/** 画面に出す「いまの状態」。シークレットは絶対に返さない */
export async function googleStatus(env, origin) {
  const app = await kvGet(env, 'google_app');
  const g = await kvGet(env, 'google');
  return {
    configured: !!(app && app.clientId && app.clientSecret),
    clientId: app && app.clientId ? app.clientId : '',
    redirectUri: redirectUriFor(origin),
    connected: !!(g && g.refreshToken && !g.needsReconnect),
    needsReconnect: !!(g && g.needsReconnect),
    account: g ? (g.account || '') : '',
    lastSyncAt: g ? (g.lastPullAt || 0) : 0,
    error: g ? (g.error || '') : ''
  };
}

/** 伊神さんが Google Cloud で作った身分証を登録する */
export async function saveGoogleApp(env, body) {
  const clientId = String(body.clientId || '').trim();
  let clientSecret = String(body.clientSecret || '').trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    return { error: 'クライアントIDの形がちがいます。「〜.apps.googleusercontent.com」で終わる文字をそのまま貼ってください' };
  }
  const prev = await kvGet(env, 'google_app');
  if (!clientSecret && prev && prev.clientId === clientId) clientSecret = prev.clientSecret;   // シークレットは空なら前のまま
  if (!clientSecret || clientSecret.length < 10 || /\s/.test(clientSecret)) {
    return { error: 'クライアントシークレットを貼ってください（「GOCSPX-」で始まる文字のことが多いです）' };
  }
  await kvPut(env, 'google_app', { clientId, clientSecret, savedAt: Date.now() });
  return { ok: true };
}

/** 「Googleカレンダーとつなぐ」を押したとき：Googleの許可画面のURLを作る */
export async function startAuth(env, origin) {
  const app = await kvGet(env, 'google_app');
  if (!app || !app.clientId) return { error: 'まだ Google とつなぐ準備ができていません（伊神さんの設定待ち）' };
  const state = randomHex(16);
  await env.DB.prepare('INSERT INTO codes (code, kind, expires_at, uses_left, created_at) VALUES (?, ?, ?, 1, ?)')
    .bind(state, 'gstate', Date.now() + 15 * 60 * 1000, Date.now()).run();
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUriFor(origin),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',        // 合鍵（リフレッシュトークン）をもらう
    prompt: 'consent',             // 2回目以降も必ず合鍵をもらうため
    include_granted_scopes: 'true',
    state
  });
  return { url: endpoints(env).auth + '?' + q.toString() };
}

/** Googleの許可画面から戻ってきたとき（ログインなしで呼ばれるので、state で本人確認する） */
export async function handleCallback(env, url, ctx) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const err = url.searchParams.get('error') || '';
  if (err) return page('つなげませんでした', err === 'access_denied'
    ? 'Googleの画面で「キャンセル」が押されました。もう一度アプリから「Googleカレンダーとつなぐ」を押してください。'
    : 'Googleから次の理由が返ってきました：' + err, false);

  const row = state && await env.DB.prepare(
    "SELECT code FROM codes WHERE code = ? AND kind = 'gstate' AND expires_at > ? AND uses_left > 0").bind(state, Date.now()).first();
  if (!row || !code) return page('つなげませんでした', '時間が経ちすぎたか、別の画面から開かれました。アプリからもう一度「Googleカレンダーとつなぐ」を押してください。', false);
  await env.DB.prepare('DELETE FROM codes WHERE code = ?').bind(state).run();

  const app = await kvGet(env, 'google_app');
  if (!app) return page('つなげませんでした', 'Google とつなぐ準備（クライアントID）が消えています。', false);

  const res = await fetch(endpoints(env).token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: app.clientId, client_secret: app.clientSecret,
      redirect_uri: redirectUriFor(url.origin), grant_type: 'authorization_code'
    })
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) {
    return page('つなげませんでした', 'Googleから合鍵を受け取れませんでした（' + (tok.error || res.status) + '）。' +
      'Google Cloud の「リダイレクトURI」が、アプリの設定画面に出ているものと同じか確かめてください。', false);
  }
  if (tok.scope && !String(tok.scope).split(' ').includes(GOOGLE_SCOPE)) {
    return page('あと少しです', 'Googleの画面で「カレンダーの予定の表示と編集」に<b>チェックが入っていませんでした</b>。' +
      'アプリからもう一度「Googleカレンダーとつなぐ」を押して、チェックを入れて「続行」を押してください。', false);
  }

  const prev = (await kvGet(env, 'google')) || {};
  const g = {
    refreshToken: tok.refresh_token || prev.refreshToken || '',
    accessToken: tok.access_token,
    expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
    connectedAt: Date.now(),
    account: '', lastPullAt: 0, lastFullAt: 0, error: '', needsReconnect: false
  };
  if (!g.refreshToken) {
    return page('つなげませんでした', 'Googleから長く使える合鍵が届きませんでした。アプリからもう一度つないでください。', false);
  }
  await kvPut(env, 'google', g);

  // はじめての同期（Googleの予定を取りこみ、アプリにだけある予定をGoogleに書きこむ）は裏で進める
  const job = firstSync(env).catch(e => noteError(env, e));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;

  return page('Googleカレンダーとつながりました', 'これで、アプリ・Googleカレンダー・iPhoneのカレンダーの予定が1つにまとまります。<br>' +
    '<b>この画面を閉じて、アプリに戻ってください。</b>', true);
}

/** Googleから戻ってきたときに見せる小さな画面 */
function page(title, body, ok) {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,-apple-system,"Hiragino Sans",sans-serif;margin:0;padding:32px 20px;background:#eef1f5;color:#1b2430}
  .card{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
  h1{font-size:20px;margin:0 0 12px}.icon{font-size:40px}
  p{line-height:1.7;font-size:16px}
  a{display:block;text-align:center;background:#1f3a5f;color:#fff;text-decoration:none;padding:14px;border-radius:12px;font-weight:700;margin-top:16px}
  @media (prefers-color-scheme:dark){body{background:#12171d;color:#e6ebf0}.card{background:#1c232b}a{background:#8ab4e8;color:#10161d}}
</style></head><body><div class="card"><div class="icon">${ok ? '✅' : '⚠️'}</div><h1>${title}</h1><p>${body}</p>
<a href="/">アプリにもどる</a></div></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** つながりを切る（Googleにも合鍵の取り消しを伝える） */
export async function disconnect(env) {
  const g = await kvGet(env, 'google');
  if (g && g.refreshToken) {
    await fetch(endpoints(env).revoke, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: g.refreshToken })
    }).catch(() => {});
  }
  await env.DB.prepare("DELETE FROM kv WHERE k = 'google'").run();
  return { ok: true };
}

async function noteError(env, e) {
  const g = await kvGet(env, 'google');
  if (!g) return;
  g.error = String(e && e.message || e).slice(0, 200);
  g.errorAt = Date.now();
  await kvPut(env, 'google', g);
}

/** 使える短期の鍵（アクセストークン）を返す。切れていれば合鍵で取り直す */
async function accessToken(env) {
  const g = await kvGet(env, 'google');
  if (!g || !g.refreshToken || g.needsReconnect) return null;
  if (g.accessToken && g.expiresAt > Date.now() + 60 * 1000) return g.accessToken;
  const app = await kvGet(env, 'google_app');
  if (!app) return null;
  const res = await fetch(endpoints(env).token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId, client_secret: app.clientSecret,
      refresh_token: g.refreshToken, grant_type: 'refresh_token'
    })
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) {
    if (tok.error === 'invalid_grant' || tok.error === 'unauthorized_client' || tok.error === 'invalid_client') {
      // 合鍵が取り消された・期限切れ → つなぎ直してもらう
      g.needsReconnect = true;
      g.error = 'Googleとのつながりが切れました。もう一度「Googleカレンダーとつなぐ」を押してください';
      await kvPut(env, 'google', g);
    }
    return null;
  }
  g.accessToken = tok.access_token;
  g.expiresAt = Date.now() + (Number(tok.expires_in) || 3600) * 1000;
  await kvPut(env, 'google', g);
  return g.accessToken;
}

/** Googleカレンダーへの問い合わせ */
async function gapi(env, method, path, body, retried) {
  const token = await accessToken(env);
  if (!token) return { status: 0, json: null, noAuth: true };
  const res = await fetch(endpoints(env).api + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && !retried) {
    // 短期の鍵が先に切れていた → 捨てて取り直し、1回だけやり直す
    const g = await kvGet(env, 'google');
    if (g) { g.accessToken = ''; g.expiresAt = 0; await kvPut(env, 'google', g); }
    return gapi(env, method, path, body, true);
  }
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  return { status: res.status, json: j };
}

export async function isConnected(env) {
  const g = await kvGet(env, 'google');
  return !!(g && g.refreshToken && !g.needsReconnect);
}

/* =====================================================================
   3. アプリ → Google（書きこみ）
   ===================================================================== */

const evPath = gid => '/calendars/' + CAL + '/events/' + encodeURIComponent(gid);

/** 書きこむべき予定か（見本の予定・ずっと前の予定は Google に書かない） */
function shouldPush(row, today) {
  if (String(row.id).startsWith('sample_')) return false;
  if (row.google_id) return true;
  return row.date >= addDays(today, -WINDOW_PAST_DAYS);
}

/** 1件を Google に書きこむ。成功・書かなくてよい → true、あとでやり直す → false */
async function pushRow(env, row, today) {
  if (!shouldPush(row, today)) {
    await env.DB.prepare('UPDATE events SET g_dirty = 0 WHERE id = ?').bind(row.id).run();
    return true;
  }
  const ev = normalizeEvent(JSON.parse(row.data));
  const body = toGoogle(ev);
  let r;
  if (row.google_id) {
    r = await gapi(env, 'PATCH', evPath(row.google_id), body);
    if (r.status === 404 || r.status === 410) {
      // Google側で消されていた → アプリで直したほうを、新しいIDで書きこみ直す
      r = await insert(env, body, 'ph' + randomHex(15));
    }
  } else {
    r = await insert(env, body, await stableGid(ev.id));
  }
  if (r.noAuth) return false;
  if (r.status >= 200 && r.status < 300 && r.json && r.json.id) {
    await env.DB.prepare('UPDATE events SET google_id = ?, g_updated = ?, g_dirty = 0, g_error = NULL WHERE id = ?')
      .bind(r.json.id, r.json.updated || '', row.id).run();
    return true;
  }
  if (r.status === 403 || r.status === 400) {
    // 招待された予定など、こちらからは書きかえられないもの。アプリ側の中身だけ残す
    await env.DB.prepare('UPDATE events SET g_dirty = 0, g_error = ? WHERE id = ?')
      .bind('Googleで書きかえられない予定です（' + r.status + '）', row.id).run();
    return true;
  }
  return false;                                    // 通信の失敗・混雑など → 次の見回りでやり直す
}

/** 新しく作るときは「空にする」の印（null）を外す */
function stripNulls(o) {
  if (Array.isArray(o) || o === null || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== null) out[k] = stripNulls(v);
  return out;
}

/**
 * アプリの予定IDから、Googleでの予定IDを決める（いつも同じになる）。
 * 保存直後の書きこみと1分ごとの見回りが同時に走っても、2回目は「もうある」と返るので
 * Googleに同じ予定が2つできない。（Googleの予定IDに使える文字は 0-9 と a-v）
 */
export async function stableGid(appId) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pocket-hisho:' + appId));
  return 'ph' + [...new Uint8Array(buf)].slice(0, 15).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function insert(env, body, gid) {
  const r = await gapi(env, 'POST', '/calendars/' + CAL + '/events', { id: gid, ...stripNulls(body) });
  if (r.status !== 409) return r;
  // もうある（同時に書きこんだ・前に消した）→ 書きかえる。消されていたら新しいIDで作り直す
  const p = await gapi(env, 'PATCH', evPath(gid), { ...body, status: 'confirmed' });
  if (p.status === 404 || p.status === 410) {
    return gapi(env, 'POST', '/calendars/' + CAL + '/events', { id: 'ph' + randomHex(15), ...stripNulls(body) });
  }
  return p;
}

/** 書きこみ待ちを片づける（アプリで保存・削除した直後と、1分ごとの見回りで呼ぶ） */
export async function pushPending(env, only) {
  if (!(await isConnected(env))) return { skipped: true };
  const today = todayStr();
  const onlyId = typeof only === 'string' ? only : '';
  const deletesOnly = !!(only && only.deletesOnly);
  const q = onlyId
    ? env.DB.prepare('SELECT id, date, data, google_id FROM events WHERE id = ? AND g_dirty = 1 AND deleted = 0').bind(onlyId)
    : env.DB.prepare('SELECT id, date, data, google_id FROM events WHERE g_dirty = 1 AND deleted = 0 LIMIT 20');
  const { results } = deletesOnly ? { results: [] } : await q.all();
  let pushed = 0, failed = 0;
  for (const row of results || []) {
    if (await pushRow(env, row, today)) pushed++; else failed++;
  }
  const dels = await env.DB.prepare('SELECT google_id FROM g_deletes LIMIT 20').all();
  let deleted = 0;
  for (const d of dels.results || []) {
    const r = await gapi(env, 'DELETE', evPath(d.google_id));
    if (r.noAuth) break;
    if ((r.status >= 200 && r.status < 300) || r.status === 404 || r.status === 410 || r.status === 403) {
      await env.DB.prepare('DELETE FROM g_deletes WHERE google_id = ?').bind(d.google_id).run();
      deleted++;
    }
  }
  return { pushed, failed, deleted };
}

/* =====================================================================
   4. Google → アプリ（取りこみ）
   ===================================================================== */

function windowRange(now) {
  const today = todayStr(now);
  return {
    timeMin: addDays(today, -WINDOW_PAST_DAYS) + 'T00:00:00+09:00',
    timeMax: addDays(today, WINDOW_FUTURE_DAYS) + 'T00:00:00+09:00',
    from: addDays(today, -WINDOW_PAST_DAYS), to: addDays(today, WINDOW_FUTURE_DAYS)
  };
}

/**
 * Googleカレンダーの変化を取りこむ。
 *   ふだん … 前回から後に直された予定だけ（updatedMin）。消えた予定もここで分かる
 *   6時間ごと・はじめて … 範囲の中を全部見直す（消えた予定の取りこぼしも直す）
 */
export async function pullFromGoogle(env, opts = {}) {
  const g = await kvGet(env, 'google');
  if (!g || !g.refreshToken || g.needsReconnect) return { skipped: true };
  const now = Date.now();
  const full = !!opts.full || !!g.needFull || !g.lastPullAt || !g.lastFullAt || now - g.lastFullAt > FULL_EVERY_MS ||
               now - g.lastPullAt > 20 * 86400000;
  const w = windowRange(now);

  const items = [];
  let pageToken = '', calName = '';
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({
      singleEvents: 'true', maxResults: '250', timeMin: w.timeMin, timeMax: w.timeMax, fields: LIST_FIELDS
    });
    if (full) q.set('showDeleted', 'false');
    else q.set('updatedMin', new Date(g.lastPullAt - 2 * 60 * 1000).toISOString());   // 2分の重なりで取りこぼさない
    if (pageToken) q.set('pageToken', pageToken);
    const r = await gapi(env, 'GET', '/calendars/' + CAL + '/events?' + q.toString());
    if (r.noAuth) return { skipped: true };
    if (r.status === 410) return pullFromGoogle(env, { full: true });              // 古すぎる → 全部見直し
    if (r.status !== 200 || !r.json) { await noteError(env, 'Googleから読めませんでした（' + r.status + '）'); return { error: r.status }; }
    if (r.json.summary) calName = r.json.summary;
    items.push(...(r.json.items || []));
    pageToken = r.json.nextPageToken || '';
    if (!pageToken) break;
  }

  // Googleとつながっている予定を、まとめて読んでおく（中身 data は、直すときだけ1件ずつ読む＝軽くする）
  const { results } = await env.DB.prepare(
    'SELECT id, date, google_id, g_updated, g_dirty, deleted FROM events WHERE google_id IS NOT NULL').all();
  const byGid = new Map((results || []).map(r => [r.google_id, r]));
  const pendingDel = new Set(((await env.DB.prepare('SELECT google_id FROM g_deletes').all()).results || []).map(r => r.google_id));

  const stmts = [];
  let added = 0, changed = 0, removed = 0, capped = false;
  const seen = new Set();
  for (const item of items) {
    if (!item || !item.id || isNoise(item)) continue;
    seen.add(item.id);
    const row = byGid.get(item.id);
    if (item.status === 'cancelled') {
      if (row && !row.deleted && !row.g_dirty) {
        stmts.push(env.DB.prepare('UPDATE events SET deleted = 1, updated_at = ? WHERE id = ?').bind(now, row.id));
        removed++;
      }
      continue;
    }
    if (pendingDel.has(item.id)) continue;                       // アプリで消した直後（Googleへの削除待ち）
    if (row) {
      if (row.deleted || row.g_dirty) continue;                   // アプリで直したほうを先に書きこむ
      if (row.g_updated && Date.parse(item.updated) <= Date.parse(row.g_updated)) continue;   // 自分が書いたものの戻り・変化なし
      const cur = await env.DB.prepare('SELECT data FROM events WHERE id = ?').bind(row.id).first();
      if (!cur) continue;
      const next = applyGoogleToEvent(JSON.parse(cur.data), item);
      if (!isYmd(next.date)) continue;
      stmts.push(env.DB.prepare('UPDATE events SET date = ?, data = ?, updated_at = ?, g_updated = ? WHERE id = ?')
        .bind(next.date, JSON.stringify(next), now, item.updated || '', row.id));
      changed++;
    } else {
      // アプリで作って書きこんだ予定が、IDの記録より先に戻ってきた場合（phId で見分ける）
      const phId = item.extendedProperties && item.extendedProperties.private && item.extendedProperties.private.phId;
      if (phId) {
        const own = await env.DB.prepare('SELECT id, google_id FROM events WHERE id = ?').bind(phId).first();
        if (own) {
          if (!own.google_id) stmts.push(env.DB.prepare('UPDATE events SET google_id = ?, g_updated = ? WHERE id = ?')
            .bind(item.id, item.updated || '', phId));
          continue;
        }
      }
      if (added >= MAX_NEW_PER_RUN) { capped = true; continue; }       // 残りは次の見回りで
      const ev = eventFromGoogle(item);
      if (!ev) continue;
      stmts.push(env.DB.prepare(
        `INSERT INTO events (id, date, data, updated_at, deleted, google_id, g_updated, g_dirty)
         VALUES (?, ?, ?, ?, 0, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET date = excluded.date, data = excluded.data, updated_at = excluded.updated_at,
           deleted = 0, google_id = excluded.google_id, g_updated = excluded.g_updated, g_dirty = 0`)
        .bind(ev.id, ev.date, JSON.stringify(ev), now, item.id, item.updated || ''));
      added++;
    }
  }

  // 全部見直しのとき：範囲の中にあるはずなのに Google に無い予定は、Googleで消されたもの
  if (full) {
    for (const row of results || []) {
      if (row.deleted || row.g_dirty || seen.has(row.google_id)) continue;
      if (row.date < w.from || row.date >= w.to) continue;
      stmts.push(env.DB.prepare('UPDATE events SET deleted = 1, updated_at = ? WHERE id = ?').bind(now, row.id));
      removed++;
    }
  }

  // 一度にたくさん書くと重いので、100件ずつ
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  const g2 = (await kvGet(env, 'google')) || g;
  g2.lastPullAt = now;
  // 取りこみきれなかったときは、次の見回りでもう一度「全部見直し」をして続きを入れる
  g2.needFull = capped;
  if (full && !capped) g2.lastFullAt = now;
  if (calName) g2.account = calName;
  g2.error = '';
  await kvPut(env, 'google', g2);
  return { full, fetched: items.length, added, changed, removed, more: capped };
}

/** つないだ直後：Googleの予定を取りこみ、アプリにだけある予定を Google に書きこむ */
export async function firstSync(env) {
  await pullFromGoogle(env, { full: true });
  const today = todayStr();
  await env.DB.prepare(
    "UPDATE events SET g_dirty = 1 WHERE deleted = 0 AND google_id IS NULL AND date >= ? AND id NOT LIKE 'sample\\_%' ESCAPE '\\'")
    .bind(addDays(today, -WINDOW_PAST_DAYS)).run();
  // 20件ずつ。残りは1分ごとの見回りで続ける
  return pushPending(env);
}

/** 見回り・「いま同期する」ボタン・アプリを開いたとき に呼ぶ */
export async function syncNow(env, opts = {}) {
  if (!(await isConnected(env))) return { skipped: true };
  try {
    const push = await pushPending(env);
    const pull = await pullFromGoogle(env, opts);
    return { push, pull };
  } catch (e) {
    await noteError(env, e);
    return { error: String(e && e.message || e) };
  }
}

/** 最後に取りこんでから何ミリ秒たったか（アプリを開いたときに、取りこむかどうかの判断に使う） */
export async function msSinceLastPull(env) {
  const g = await kvGet(env, 'google');
  if (!g || !g.refreshToken || g.needsReconnect) return -1;
  return Date.now() - (g.lastPullAt || 0);
}
