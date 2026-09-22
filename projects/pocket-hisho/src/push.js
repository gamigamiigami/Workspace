/* =====================================================================
   Webプッシュ通知の送信（アプリを閉じていてもスマホに通知を出す仕組み）

   仕組みを一言でいうと：
     ① スマホが「通知の宛先（endpoint）と鍵」をアプリに預ける
     ② サーバーは通知の本文を **その鍵で暗号化** して、宛先に送る
     ③ Apple/Google の通知サーバーが中身を読めないまま、スマホへ届ける
     ④ スマホの中で復号され、通知として表示される

   だから途中の会社にも中身は見えない。そのかわり、暗号化の手順（RFC 8291）と
   身元証明の署名（VAPID / RFC 8292）を、こちらで正しく作る必要がある。

   このファイルは「暗号化して詰める」ところまでを独立させてあるので、
   テストで自分で復号し直して、正しく作れているか確かめられる。
   ===================================================================== */

/* --- 文字と数値の変換（base64url = URLに入れても安全な並べ方） --- */

export function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(bytes) {
  let bin = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const a of arrays) { out.set(a, at); at += a.length; }
  return out;
}
const enc = new TextEncoder();

/* --- 鍵の生成（初回に1度だけ。以後は保管庫に入れて使い回す） --- */

/**
 * VAPID（身元証明）用の鍵の組を作る。
 * @returns {{publicKey:string, privateJwk:object}} publicKey は base64url の65バイト
 */
export async function generateVapidKeys(subtle) {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: bytesToB64url(rawPub), privateJwk: jwk };
}

/* --- 身元証明（VAPID の JWT） --- */

/**
 * 通知サーバーに「私は正規の送り主です」と示す署名つきの短い証明書を作る。
 * @param audience 送り先の出どころ（例 https://web.push.apple.com）
 * @param subject  連絡先（mailto: か https:）
 */
export async function makeVapidHeader(subtle, privateJwk, publicKeyB64, audience, subject, nowMs = Date.now()) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(nowMs / 1000) + 12 * 60 * 60,   // 12時間だけ有効
    sub: subject
  };
  const signingInput = bytesToB64url(enc.encode(JSON.stringify(header))) + '.' +
                       bytesToB64url(enc.encode(JSON.stringify(payload)));
  const key = await subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)));
  const jwt = signingInput + '.' + bytesToB64url(sig);
  return { Authorization: 'vapid t=' + jwt + ', k=' + publicKeyB64 };
}

/* --- 本文の暗号化（RFC 8291 aes128gcm） --- */

async function hmacSha256(subtle, keyBytes, dataBytes) {
  const key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', key, dataBytes));
}
/** HKDF を1ブロックぶんだけ行う（必要な長さが32バイト以下なのでこれで足りる） */
async function hkdf(subtle, salt, ikm, info, length) {
  const prk = await hmacSha256(subtle, salt, ikm);
  const okm = await hmacSha256(subtle, prk, concatBytes(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/**
 * 通知の本文を、その端末だけが読める形に暗号化して、送信用のかたまりにする。
 * @param subscription {endpoint, keys:{p256dh, auth}}
 * @param payloadText  通知の中身（JSON文字列）
 * @param opts {salt, ephemeralKeys} … テストで結果を固定したいときだけ渡す
 * @returns {{body:Uint8Array, headers:object}}
 */
export async function encryptPayload(subtle, subscription, payloadText, opts = {}) {
  const uaPublicRaw = b64urlToBytes(subscription.keys.p256dh);   // 端末の公開鍵 65バイト
  const authSecret = b64urlToBytes(subscription.keys.auth);      // 端末の秘密の合言葉 16バイト

  // 今回かぎりの鍵の組を作る（使い捨て）
  const ephemeral = opts.ephemeralKeys || await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey));

  // 端末の公開鍵と、こちらの使い捨て秘密鍵から、二者だけが知る共有の値を作る
  const uaPublicKey = await subtle.importKey(
    'raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, ephemeral.privateKey, 256));

  // 共有の値から、実際に使う鍵を導く（手順は仕様で決まっている）
  const keyInfo = concatBytes(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(subtle, authSecret, ecdhSecret, keyInfo, 32);

  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(subtle, salt, ikm, concatBytes(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(subtle, salt, ikm, concatBytes(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  // 本文のうしろに 0x02 を付ける決まり（「これで最後の固まりです」の印）
  const plaintext = concatBytes(enc.encode(payloadText), new Uint8Array([2]));
  const aesKey = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));

  // 送信用の並び： salt(16) + 記録の大きさ(4) + 鍵の長さ(1) + 使い捨て公開鍵(65) + 暗号文
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const body = concatBytes(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw, ciphertext);

  return {
    body,
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream'
    }
  };
}

/** テスト用：暗号化したものを、端末側の鍵で復号して中身を取り出す */
export async function decryptPayloadForTest(subtle, body, uaPrivateKey, uaPublicRaw, authSecret) {
  const b = new Uint8Array(body);
  const salt = b.slice(0, 16);
  const idlen = b[20];
  const asPublicRaw = b.slice(21, 21 + idlen);
  const ciphertext = b.slice(21 + idlen);

  const asPublicKey = await subtle.importKey(
    'raw', asPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: asPublicKey }, uaPrivateKey, 256));

  const keyInfo = concatBytes(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(subtle, authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(subtle, salt, ikm, concatBytes(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(subtle, salt, ikm, concatBytes(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const aesKey = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext));
  // うしろに付いている 0x02（と、あれば詰め物の0）を取りのぞく
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  if (end > 0 && plain[end - 1] === 2) end--;
  return new TextDecoder().decode(plain.slice(0, end));
}

/* --- 実際に送る --- */

/**
 * 1台のスマホに通知を1件送る。
 * @returns {{ok:boolean, status:number, gone:boolean}} gone=true は「この宛先はもう無効」
 */
export async function sendPush(subtle, subscription, payloadObject, vapid, opts = {}) {
  const url = new URL(subscription.endpoint);
  const audience = url.origin;
  const auth = await makeVapidHeader(
    subtle, vapid.privateJwk, vapid.publicKey, audience, vapid.subject, opts.now);
  const { body, headers } = await encryptPayload(subtle, subscription, JSON.stringify(payloadObject), opts);

  const doFetch = opts.fetchImpl || fetch;
  const res = await doFetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      ...headers,
      ...auth,
      TTL: String(opts.ttl == null ? 12 * 60 * 60 : opts.ttl),
      Urgency: opts.urgency || 'normal'
    },
    body
  });

  // 404 / 410 は「その端末はもう受け取れない」＝ 登録を消してよい合図
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
