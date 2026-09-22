/* =====================================================================
   ポケット秘書 — サーバー本体（Cloudflare Worker）

   役割は4つだけ：
     ① アプリの画面（web/ の中身）を配る
     ② 予定とタスクを保管し、スマホとパソコンの両方に同じものを見せる
     ③ 1分ごとに見回って、時刻が来た予定の通知をスマホへ送る
     ④ カレンダーとやりとりする（購読用URLを配る／外部カレンダーを取り込む）

   お金はかかりません（すべて Cloudflare の無料枠の中で動きます）。
   ===================================================================== */

import { generateVapidKeys, sendPush } from './push.js';
import { buildIcs, parseIcs, expandRecurrences } from './ics.js';
import { computeDueNotifications } from './remind.js';
import { todayStr, addDays, ymdOf, hmOf } from '../web/shared-date.js';
import {
  normalizeEvent, normalizeTask, normalizeSettings, defaultSettings
} from '../web/shared-model.js';

/* =====================================================================
   小道具
   ===================================================================== */

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
});
const bad = (message, status = 400) => json({ error: message }, status);

function randomHex(bytes = 24) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** 文字の比較にかかる時間を一定にして、合言葉を1文字ずつ当てられないようにする */
function safeEqual(a, b) {
  const ab = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

/* --- 小さな設定の保管庫（kv テーブル） --- */
async function kvGet(env, key) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  if (!row) return null;
  try { return JSON.parse(row.v); } catch { return null; }
}
async function kvPut(env, key, value) {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, JSON.stringify(value)).run();
}

/* --- 通知に使う鍵。無ければ1度だけ作って保管する --- */
async function ensureVapid(env) {
  let v = await kvGet(env, 'vapid');
  if (v && v.publicKey && v.privateJwk) return v;
  const keys = await generateVapidKeys(crypto.subtle);
  v = { ...keys, subject: 'mailto:pocket-hisho@example.com' };
  await kvPut(env, 'vapid', v);
  return v;
}

/* --- カレンダー購読用の合言葉つきURL。無ければ1度だけ作る --- */
async function ensureIcsKey(env) {
  let k = await kvGet(env, 'ics_key');
  if (typeof k === 'string' && k.length >= 24) return k;
  k = randomHex(24);
  await kvPut(env, 'ics_key', k);
  return k;
}

/* =====================================================================
   ログイン（使う人は1人なので、合言葉ひとつ）
   ===================================================================== */

const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const now = Date.now();

  const fails = (await kvGet(env, 'login_fails')) || { count: 0, until: 0 };
  if (fails.until > now) {
    return bad('しばらく試せません。' + Math.ceil((fails.until - now) / 60000) + '分ほどお待ちください。', 429);
  }
  if (!env.APP_PASS) {
    return bad('サーバーに合言葉が設定されていません（セットアップ手順の APP_PASS をご確認ください）', 500);
  }
  if (!safeEqual(body.pass, env.APP_PASS)) {
    const count = fails.count + 1;
    await kvPut(env, 'login_fails', { count, until: count >= MAX_FAILS ? now + LOCK_MS : 0 });
    return bad('合言葉がちがいます', 401);
  }

  await kvPut(env, 'login_fails', { count: 0, until: 0 });
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token, created_at, last_seen) VALUES (?, ?, ?)')
    .bind(token, now, now).run();
  return json({ token });
}

/** リクエストに付いている合言葉つきの札を確かめる */
async function requireAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const row = await env.DB.prepare('SELECT token FROM sessions WHERE token = ?').bind(token).first();
  if (!row) return null;
  // 最終利用を記録（1日1回程度でよいので、書き込みは間引く）
  await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token = ? AND last_seen < ?')
    .bind(Date.now(), token, Date.now() - 6 * 3600 * 1000).run();
  return token;
}

/* =====================================================================
   予定・タスク・設定の読み書き
   ===================================================================== */

async function loadEvents(env, fromYmd, toYmd) {
  const q = (fromYmd && toYmd)
    ? env.DB.prepare('SELECT data FROM events WHERE deleted = 0 AND date BETWEEN ? AND ? ORDER BY date').bind(fromYmd, toYmd)
    : env.DB.prepare('SELECT data FROM events WHERE deleted = 0 ORDER BY date');
  const { results } = await q.all();
  return (results || []).map(r => normalizeEvent(safeParse(r.data)));
}
async function loadTasks(env) {
  const { results } = await env.DB.prepare('SELECT data FROM tasks WHERE deleted = 0').all();
  return (results || []).map(r => normalizeTask(safeParse(r.data)));
}
async function loadSettings(env) {
  return normalizeSettings((await kvGet(env, 'settings')) || defaultSettings());
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function putEvent(env, raw) {
  const ev = normalizeEvent(raw);
  if (!ev.date) return { error: '日付を入れてください' };
  await env.DB.prepare(
    `INSERT INTO events (id, date, data, updated_at, deleted) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET date = excluded.date, data = excluded.data,
                                   updated_at = excluded.updated_at, deleted = 0`)
    .bind(ev.id, ev.date, JSON.stringify(ev), Date.now()).run();
  return { event: ev };
}
async function putTask(env, raw) {
  const t = normalizeTask(raw);
  if (!t.title) return { error: 'やることの名前を入れてください' };
  await env.DB.prepare(
    `INSERT INTO tasks (id, due, done, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET due = excluded.due, done = excluded.done, data = excluded.data,
                                   updated_at = excluded.updated_at, deleted = 0`)
    .bind(t.id, t.due || null, t.done ? 1 : 0, JSON.stringify(t), Date.now()).run();
  return { task: t };
}

/* =====================================================================
   外部カレンダーの取り込み（Googleカレンダーのシークレットアドレスなど）
   ===================================================================== */

async function refreshCalendars(env) {
  const st = await loadSettings(env);
  const today = todayStr();
  const from = addDays(today, -60);
  const to = addDays(today, 400);
  const report = [];

  /* 設定から外されたカレンダーの予定を消す。
     これをしないと、取り込みをやめたカレンダーの予定が
     いつまでも画面に残り続ける。 */
  const keep = st.calendars.map(c => c.url);
  if (keep.length) {
    const marks = keep.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM ext_events WHERE source NOT IN (${marks})`).bind(...keep).run();
  } else {
    await env.DB.prepare('DELETE FROM ext_events').run();
  }

  for (const cal of st.calendars) {
    const url = cal.url.replace(/^webcal:\/\//i, 'https://');
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'pocket-hisho/1.0' },
        cf: { cacheTtl: 300 }
      });
      if (!res.ok) { report.push({ name: cal.name, ok: false, message: 'HTTP ' + res.status }); continue; }
      const text = await res.text();
      if (text.length > 4_000_000) { report.push({ name: cal.name, ok: false, message: 'カレンダーが大きすぎます' }); continue; }

      const parsed = parseIcs(text);
      const occurrences = expandRecurrences(parsed, from, to);
      const source = cal.url;

      // 取り込みは「いったん全部消して入れ直す」。消えた予定が残らないようにするため。
      const stmts = [env.DB.prepare('DELETE FROM ext_events WHERE source = ?').bind(source)];
      for (const o of occurrences.slice(0, 2000)) {
        stmts.push(env.DB.prepare(
          `INSERT INTO ext_events (uid, date, start_time, end_time, title, location, all_day, source, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(uid) DO UPDATE SET date=excluded.date, start_time=excluded.start_time,
             end_time=excluded.end_time, title=excluded.title, location=excluded.location,
             all_day=excluded.all_day, source=excluded.source, fetched_at=excluded.fetched_at`)
          .bind(source + '|' + o.uid, o.date, o.startTime || null, o.endTime || null,
                o.title, o.location || null, o.allDay ? 1 : 0, source, Date.now()));
      }
      await env.DB.batch(stmts);
      report.push({ name: cal.name, ok: true, count: occurrences.length });
    } catch (e) {
      report.push({ name: cal.name, ok: false, message: String(e && e.message || e) });
    }
  }
  await kvPut(env, 'calendars_last', { at: Date.now(), report });
  return report;
}

async function loadExtEvents(env, fromYmd, toYmd) {
  const { results } = await env.DB.prepare(
    'SELECT uid, date, start_time, end_time, title, location, all_day FROM ext_events WHERE date BETWEEN ? AND ? ORDER BY date')
    .bind(fromYmd, toYmd).all();
  return (results || []).map(r => ({
    uid: r.uid, date: r.date, startTime: r.start_time || '', endTime: r.end_time || '',
    title: r.title || '', location: r.location || '', allDay: r.all_day === 1
  }));
}

/* =====================================================================
   通知の送信
   ===================================================================== */

async function loadSubs(env) {
  const { results } = await env.DB.prepare('SELECT * FROM subs').all();
  return results || [];
}

/** 1件の通知を、登録されているすべての端末へ送る */
async function pushToAll(env, payload) {
  const vapid = await ensureVapid(env);
  const subs = await loadSubs(env);
  let sent = 0, gone = 0;
  for (const s of subs) {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      const r = await sendPush(crypto.subtle, subscription, payload, vapid);
      if (r.ok) {
        sent++;
        await env.DB.prepare('UPDATE subs SET last_ok = ? WHERE id = ?').bind(Date.now(), s.id).run();
      } else if (r.gone) {
        gone++;
        await env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(s.id).run();
      }
    } catch (e) {
      // 1台で失敗しても、ほかの端末への送信は続ける
    }
  }
  return { sent, gone, devices: subs.length };
}

/** 1分ごとの見回り。送るべき通知を出して、送って、送ったことを記録する */
export async function runReminderSweep(env, now = Date.now()) {
  const settings = await loadSettings(env);
  if (!settings.notify.on) return { skipped: 'notify-off' };

  const today = todayStr(now);
  const events = await loadEvents(env, addDays(today, -2), addDays(today, 3));
  const tasks = await loadTasks(env);

  const due = computeDueNotifications({ events, tasks, settings, now });
  if (!due.length) return { due: 0 };

  // すでに送ったものを外す
  const keys = due.map(d => d.key);
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT key FROM sent WHERE key IN (${placeholders})`).bind(...keys).all();
  const already = new Set((results || []).map(r => r.key));
  const todo = due.filter(d => !already.has(d.key));
  if (!todo.length) return { due: due.length, sent: 0 };

  let sentCount = 0;
  for (const item of todo) {
    // 先に「送った」と記録してから送る。送信でつまずいても、同じ通知を何度も出さないため。
    await env.DB.prepare('INSERT OR IGNORE INTO sent (key, sent_at) VALUES (?, ?)').bind(item.key, now).run();
    const r = await pushToAll(env, {
      title: item.title,
      body: String(item.body).slice(0, 300),
      url: item.url,
      tag: item.key.split(':').slice(0, 2).join(':')      // 同じ予定の通知は1つにまとまる
    });
    if (r.sent > 0) sentCount++;
  }
  return { due: due.length, sent: sentCount };
}

/* =====================================================================
   受け口（ルーティング）
   ===================================================================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      /* --- カレンダー購読用URL（ログイン不要。推測できない合言葉つき） --- */
      const icsMatch = /^\/ics\/([0-9a-f]{24,})\.ics$/.exec(path);
      if (icsMatch) return await handleIcs(env, icsMatch[1]);

      /* --- ここから下はアプリとのやりとり --- */
      if (path === '/api/ping') return json({ ok: true, now: Date.now(), today: todayStr() });

      if (path === '/api/login' && request.method === 'POST') return await handleLogin(request, env);

      if (path.startsWith('/api/')) {
        const token = await requireAuth(request, env);
        if (!token) return bad('ログインしてください', 401);
        return await handleApi(request, env, url, path, ctx);
      }

      /* --- それ以外はアプリの画面ファイル --- */
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: 'サーバーでエラーが起きました', detail: String(e && e.message || e) }, 500);
    }
  },

  /* --- 1分ごとの見回り（Cron Triggers から呼ばれる） --- */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const now = Date.now();
      await ensureVapid(env);
      await runReminderSweep(env, now);

      const minute = new Date(now).getUTCMinutes();
      // 外部カレンダーの取り込みは15分おきでじゅうぶん
      if (minute % 15 === 0) await refreshCalendars(env);
      // 古い「送った記録」を片づける（30日より前）
      if (minute === 7) {
        await env.DB.prepare('DELETE FROM sent WHERE sent_at < ?').bind(now - 30 * 86400000).run();
      }
    })());
  }
};

/* --- 購読用カレンダーを返す --- */
async function handleIcs(env, key) {
  const real = await kvGet(env, 'ics_key');
  if (!real || !safeEqual(key, real)) return new Response('Not found', { status: 404 });
  const st = await loadSettings(env);
  if (!st.icsEnabled) return new Response('Not found', { status: 404 });

  const today = todayStr();
  const events = await loadEvents(env, addDays(today, -370), addDays(today, 400));
  const body = buildIcs(events, { calName: 'ポケット秘書' + (st.ownerName ? '（' + st.ownerName + '）' : '') });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="pocket-hisho.ics"',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/* --- ログイン後のやりとり --- */
async function handleApi(request, env, url, path, ctx) {
  const method = request.method;

  /* いちどに必要なものをまとめて返す（アプリの起動を1往復で終わらせる） */
  if (path === '/api/bootstrap' && method === 'GET') {
    const today = todayStr();
    const [events, tasks, settings, vapid, icsKey] = await Promise.all([
      loadEvents(env), loadTasks(env), loadSettings(env), ensureVapid(env), ensureIcsKey(env)
    ]);
    const ext = await loadExtEvents(env, addDays(today, -60), addDays(today, 400));
    const calLast = await kvGet(env, 'calendars_last');
    const subs = await loadSubs(env);
    return json({
      events, tasks, settings, ext,
      vapidPublicKey: vapid.publicKey,
      icsUrl: settings.icsEnabled ? url.origin + '/ics/' + icsKey + '.ics' : '',
      devices: subs.map(s => ({ id: s.id, label: s.label, createdAt: s.created_at, lastOk: s.last_ok })),
      calendarsLast: calLast,
      serverNow: Date.now(),
      today
    });
  }

  /* 予定 */
  if (path === '/api/events' && method === 'PUT') {
    const r = await putEvent(env, await request.json().catch(() => ({})));
    return r.error ? bad(r.error) : json(r);
  }
  const evDel = /^\/api\/events\/([\w-]+)$/.exec(path);
  if (evDel && method === 'DELETE') {
    await env.DB.prepare('UPDATE events SET deleted = 1, updated_at = ? WHERE id = ?').bind(Date.now(), evDel[1]).run();
    // その予定にひもづくタスクも一緒に片づける
    await env.DB.prepare('UPDATE tasks SET deleted = 1, updated_at = ? WHERE id IN (SELECT id FROM tasks WHERE deleted = 0 AND json_extract(data, \'$.eventId\') = ?)')
      .bind(Date.now(), evDel[1]).run();
    return json({ ok: true });
  }

  /* タスク */
  if (path === '/api/tasks' && method === 'PUT') {
    const r = await putTask(env, await request.json().catch(() => ({})));
    return r.error ? bad(r.error) : json(r);
  }
  const tkDel = /^\/api\/tasks\/([\w-]+)$/.exec(path);
  if (tkDel && method === 'DELETE') {
    await env.DB.prepare('UPDATE tasks SET deleted = 1, updated_at = ? WHERE id = ?').bind(Date.now(), tkDel[1]).run();
    return json({ ok: true });
  }

  /* 合言葉を何度もまちがえてかかった鍵を外す。
     すでにログインできている端末からだけ行えるので、他人には使えない。
     （スマホで打ちまちがえて入れなくなったとき、パソコンから助けられる） */
  if (path === '/api/login/unlock' && method === 'POST') {
    await kvPut(env, 'login_fails', { count: 0, until: 0 });
    return json({ ok: true });
  }

  /* 設定 */
  if (path === '/api/settings' && method === 'PUT') {
    const st = normalizeSettings(await request.json().catch(() => ({})));
    await kvPut(env, 'settings', st);
    return json({ settings: st });
  }

  /* まとめて入れ直す（バックアップの復元） */
  if (path === '/api/restore' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const events = Array.isArray(body.events) ? body.events.map(normalizeEvent).filter(e => e.date) : [];
    const tasks = Array.isArray(body.tasks) ? body.tasks.map(normalizeTask).filter(t => t.title) : [];
    if (!events.length && !tasks.length) return bad('中身がからっぽでした');
    const now = Date.now();
    const stmts = [
      env.DB.prepare('UPDATE events SET deleted = 1 WHERE deleted = 0'),
      env.DB.prepare('UPDATE tasks SET deleted = 1 WHERE deleted = 0')
    ];
    for (const e of events) {
      stmts.push(env.DB.prepare(
        `INSERT INTO events (id, date, data, updated_at, deleted) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET date=excluded.date, data=excluded.data, updated_at=excluded.updated_at, deleted=0`)
        .bind(e.id, e.date, JSON.stringify(e), now));
    }
    for (const t of tasks) {
      stmts.push(env.DB.prepare(
        `INSERT INTO tasks (id, due, done, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET due=excluded.due, done=excluded.done, data=excluded.data, updated_at=excluded.updated_at, deleted=0`)
        .bind(t.id, t.due || null, t.done ? 1 : 0, JSON.stringify(t), now));
    }
    if (body.settings) stmts.push(env.DB.prepare(
      'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .bind('settings', JSON.stringify(normalizeSettings(body.settings))));
    await env.DB.batch(stmts);
    return json({ ok: true, events: events.length, tasks: tasks.length });
  }

  /* 通知のあて先を登録する */
  if (path === '/api/push/subscribe' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return bad('通知の登録内容が足りません');
    }
    const id = await sha256Hex(sub.endpoint);
    await env.DB.prepare(
      `INSERT INTO subs (id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, label=excluded.label`)
      .bind(id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(body.label || '').slice(0, 40), Date.now()).run();
    return json({ ok: true, id });
  }
  if (path === '/api/push/unsubscribe' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (body.endpoint) {
      await env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(await sha256Hex(body.endpoint)).run();
    }
    return json({ ok: true });
  }
  if (path === '/api/push/test' && method === 'POST') {
    const r = await pushToAll(env, {
      title: 'ポケット秘書',
      body: 'テスト通知です。これが見えていれば、通知の設定はできています。',
      url: '/', tag: 'test'
    });
    return json(r);
  }

  /* いま送るべき通知を確認する（動作確認用。実際には送らない） */
  if (path === '/api/reminders/preview' && method === 'GET') {
    const now = Number(url.searchParams.get('now')) || Date.now();
    const today = todayStr(now);
    const [events, tasks, settings] = await Promise.all([
      loadEvents(env, addDays(today, -2), addDays(today, 3)), loadTasks(env), loadSettings(env)
    ]);
    return json({ now, due: computeDueNotifications({ events, tasks, settings, now }) });
  }

  /* 外部カレンダーをいま取り込む */
  if (path === '/api/calendar/refresh' && method === 'POST') {
    const report = await refreshCalendars(env);
    const today = todayStr();
    return json({ report, ext: await loadExtEvents(env, addDays(today, -60), addDays(today, 400)) });
  }

  /* 見回りをいま動かす（動作確認用） */
  if (path === '/api/sweep' && method === 'POST') {
    return json(await runReminderSweep(env, Date.now()));
  }

  return bad('そのような操作はありません', 404);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
