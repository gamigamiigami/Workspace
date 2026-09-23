/* =====================================================================
   ポケット秘書 — Service Worker（サービスワーカー）

   ブラウザの裏で静かに動き続ける小さなプログラム。役割は2つ：
     ① アプリの見た目を端末に置いておき、電波が無くても画面を出す
     ② アプリを閉じていても、サーバーからの通知を受け取って表示する

   ②があるので、iPhoneでは「ホーム画面に追加したアイコンから開く」ことが
   通知の条件になる（ブラウザのタブのままでは、この仕組みが使えない）。
   ===================================================================== */

const CACHE = 'pocket-hisho-v2';     // 中身を変えたら数字を上げる（古い取り置きを消すため）
const SHELL_URL = '/';          // アプリの画面そのもの

/* 最初に端末へ置いておくファイル。
   ※ '/index.html' は入れない。サーバーが '/' へ転送するため、
     取っておいた応答に「転送された」印が付いてしまい、
     画面をひらく用途には使えなくなる（下の shellResponse の説明を参照）。 */
const SHELL = [
  SHELL_URL,
  '/style.css',
  '/app.js',
  '/shared-date.js',
  '/shared-model.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つ失敗しても残りは入れる（アイコンの取りこぼしで全部やり直しにしない）
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // サーバーとのやりとりは、必ず本物を取りに行く（古い予定を見せないため）
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ics/')) return;

  /* --- 画面をひらく要求 ---
     ネットを先に試すが、2.5秒で見切りをつけて、取っておいた画面を出す。
     移動中の弱い電波で、いつまでも白い画面を見せないため。 */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await withTimeout(fetch(req), 2500);
        if (isUsable(res)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(SHELL_URL, copy)).catch(() => {});
          return res;
        }
      } catch (e) { /* つながらない・時間切れ → 下の取り置きへ */ }
      return (await shellResponse()) || Response.error();
    })());
    return;
  }

  /* --- それ以外のファイルも、ネット優先・2.5秒で見切ってから手元の取り置き。
     「手元を先に出す」方式にすると、新しい画面と古いプログラムが
     混ざって動く瞬間ができ、画面が壊れることがあるため。 --- */
  event.respondWith((async () => {
    try {
      const res = await withTimeout(fetch(req), 2500);
      if (isUsable(res)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }
    } catch (e) { /* つながらない → 取り置きへ */ }
    return (await caches.match(req)) || Response.error();
  })());
});

/**
 * 取っておいたアプリ画面を、画面をひらく要求に使える形にして返す。
 *
 * ここが大事なところ：
 *   取っておいた応答が「転送された結果」（redirected）だと、
 *   ブラウザは画面をひらく用途に使うことを拒み、画面が真っ白になる。
 *   `/index.html` はサーバーが `/` へ転送するので、まさにこれに当たる。
 *   そのため中身だけを取り出して、新しい応答として作り直している。
 */
async function shellResponse() {
  const hit = (await caches.match(SHELL_URL)) || (await caches.match('/index.html'));
  if (!hit) return null;
  return new Response(hit.body, {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': hit.headers.get('Content-Type') || 'text/html; charset=utf-8' }
  });
}

/** 受け取った応答が、画面に出して大丈夫なものかを確かめる。
    つながらないときは「例外」ではなく「中身のない応答」が返ることがある。 */
function isUsable(res) {
  return !!res && res.type !== 'error' && res.status !== 0;
}

/** 指定した時間で見切りをつける（弱い電波で固まらないようにする） */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

/* --- 通知が届いたとき --- */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }

  const title = payload.title || 'ポケット秘書';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'pocket-hisho',
    renotify: true,
    data: { url: payload.url || '/' }
  };
  // 通知を必ず1つ出すこと。出さないと、端末が「無駄な通知」とみなして
  // 次から受け取りを止めてしまう（とくに iPhone）。
  event.waitUntil(self.registration.showNotification(title, options));
});

/* --- 通知をタップしたとき --- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      // すでに開いているなら、そこへ行き先を伝えて前面に出す
      if ('focus' in client) {
        await client.navigate(new URL(target, self.location.origin).href).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
