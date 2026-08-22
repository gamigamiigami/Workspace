/**
 * クロスワードサポーター 問題保存サーバー（Cloudflare Workers 用）
 *
 * 役割：問題データをあずかって、短い合言葉（ID）を返す。
 *       配布URLには、この合言葉だけを入れる。
 *
 * 使えるところ：
 *   POST   /p        問題を新しく保存する      → { id, token }
 *   PUT    /p/{id}   保存した問題を上書きする   → { id }（ヘッダ x-token が必要）
 *   GET    /p/{id}   問題を取り出す            → 問題データそのもの
 *
 * 保存先は KV（Cloudflare の保存領域）。**期限は設定していないので、勝手に消えることはない。**
 *
 * 設置手順は同じフォルダの README.md を参照。
 */

// 1件あたりの上限（いたずらで大量のデータを置かれないようにするため）
const MAX_BYTES = 200 * 1024; // 200KB。ふつうのクロスワードは2KB程度なので十分すぎる余裕がある

// 合言葉（ID）に使う文字。見まちがえやすい文字（0/o、1/l など）は最初から入れていない
const ID_CHARS = '23456789abcdefghijkmnpqrstuvwxyz';

function makeId(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < len; i++) s += ID_CHARS[bytes[i] % ID_CHARS.length];
  return s;
}

function makeToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// どのページからでも呼べるようにする（CORS）。これが無いとブラウザが通信を止めてしまう
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-token',
  'Access-Control-Max-Age': '86400'
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

export default {
  async fetch(request, env) {
    // ブラウザが本番の通信前に送ってくる「事前確認」に答える
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // 例: ['p', 'ab3x9k']

    if (parts[0] !== 'p') {
      return json({ error: 'ここはクロスワードの問題保存サーバーです。' }, 404);
    }

    const id = parts[1] || '';

    // ---- 問題を取り出す ----
    if (request.method === 'GET') {
      if (!id) return json({ error: '合言葉がありません。' }, 400);
      const stored = await env.PUZZLES.get('p:' + id);
      if (!stored) return json({ error: 'この問題は見つかりませんでした。' }, 404);
      let rec;
      try { rec = JSON.parse(stored); } catch (e) { return json({ error: 'データが壊れています。' }, 500); }
      return json(rec.data);
    }

    // ---- 新しく保存する ----
    if (request.method === 'POST') {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'データが大きすぎます。' }, 413);
      let data;
      try { data = JSON.parse(text); } catch (e) { return json({ error: '読めないデータです。' }, 400); }

      // すでに使われている合言葉と重ならないように、空いているものを探す
      let newId = '';
      for (let i = 0; i < 6; i++) {
        const cand = makeId(6);
        if (!(await env.PUZZLES.get('p:' + cand))) { newId = cand; break; }
      }
      if (!newId) return json({ error: '合言葉を作れませんでした。もう一度お試しください。' }, 503);

      const token = makeToken();
      const now = Date.now();
      // 有効期限（expirationTtl）はあえて指定しない ＝ ずっと残る
      await env.PUZZLES.put('p:' + newId, JSON.stringify({ data, token, createdAt: now, updatedAt: now }));
      return json({ id: newId, token });
    }

    // ---- 保存した問題を上書きする（配ったリンクを変えずに直せるようにするため） ----
    if (request.method === 'PUT') {
      if (!id) return json({ error: '合言葉がありません。' }, 400);
      const stored = await env.PUZZLES.get('p:' + id);
      if (!stored) return json({ error: 'この問題は見つかりませんでした。' }, 404);

      let rec;
      try { rec = JSON.parse(stored); } catch (e) { return json({ error: 'データが壊れています。' }, 500); }

      const token = request.headers.get('x-token') || '';
      // 他人の問題を書き換えられないよう、保存したときの合鍵を確認する
      if (!token || token !== rec.token) return json({ error: 'この問題を書き換える権限がありません。' }, 403);

      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'データが大きすぎます。' }, 413);
      let data;
      try { data = JSON.parse(text); } catch (e) { return json({ error: '読めないデータです。' }, 400); }

      rec.data = data;
      rec.updatedAt = Date.now();
      await env.PUZZLES.put('p:' + id, JSON.stringify(rec));
      return json({ id });
    }

    return json({ error: 'その操作には対応していません。' }, 405);
  }
};
