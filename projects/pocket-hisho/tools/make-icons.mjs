/* ポケット秘書 — アプリのアイコン（PNG）を作る
   外部ライブラリは使わない（Nodeに最初から入っている zlib だけで PNG を書く）。
   作り直したいとき: node tools/make-icons.mjs                             */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'web', 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* --- PNG を書き出す最小限の仕組み --- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** 幅・高さ・RGBAの並び → PNGファイルの中身 */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                       // 各行の先頭は「加工なし」の印
    rgba.copy
      ? rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
      : Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // 1色あたり8ビット
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --- 絵を描く --- */

const NAVY = [0x1f, 0x3a, 0x5f];
const GOLD = [0x9a, 0x6d, 0x2f];
const PAPER = [0xff, 0xff, 0xff];
const LINE = [0x1f, 0x3a, 0x5f];

function makeCanvas(size) {
  return { size, px: new Uint8Array(size * size * 4) };
}
function fill(c, x0, y0, x1, y1, color, radius = 0) {
  const s = c.size;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(s, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(s, Math.ceil(x1)); x++) {
      if (radius > 0 && !insideRounded(x + 0.5, y + 0.5, x0, y0, x1, y1, radius)) continue;
      const i = (y * s + x) * 4;
      c.px[i] = color[0]; c.px[i + 1] = color[1]; c.px[i + 2] = color[2]; c.px[i + 3] = 255;
    }
  }
}
function insideRounded(px, py, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** 大きく描いてから縮める＝輪郭がなめらかになる */
function downsample(c, factor) {
  const s = c.size / factor;
  const out = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * c.size + (x * factor + dx)) * 4;
          r += c.px[i]; g += c.px[i + 1]; b += c.px[i + 2]; a += c.px[i + 3];
        }
      }
      const n = factor * factor, o = (y * s + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return { size: s, buf: out };
}

/**
 * 手帳のアイコンを描く。
 * @param size   仕上がりの大きさ
 * @param inset  中身を内側へ寄せる割合（maskable用。角が切られても欠けないように）
 * @param round  背景の角まるめ（maskable は 0＝四角のまま。OSが丸く切るため）
 */
function drawIcon(size, inset = 0, round = 0.22) {
  const F = 3;                                  // 3倍で描いてから縮める
  const c = makeCanvas(size * F);
  const S = size * F;

  fill(c, 0, 0, S, S, NAVY, round * S);

  // 中身の置き場所（inset のぶん内側に寄せる）
  const pad = inset * S;
  const bx0 = pad, by0 = pad, bx1 = S - pad, by1 = S - pad;
  const bw = bx1 - bx0, bh = by1 - by0;

  const top = by0 + bh * 0.20;
  const bottom = by0 + bh * 0.80;
  const spineX0 = bx0 + bw * 0.22;
  const spineX1 = bx0 + bw * 0.31;
  const pageX1 = bx0 + bw * 0.78;

  fill(c, spineX0, top, pageX1, bottom, PAPER, bw * 0.035);   // 紙
  fill(c, spineX0, top, spineX1, bottom, GOLD, bw * 0.03);    // 背표紙（金）

  // 罫線3本
  const lx0 = bx0 + bw * 0.37, lh = bh * 0.035;
  const widths = [0.34, 0.34, 0.22];
  widths.forEach((w, i) => {
    const y = by0 + bh * (0.33 + i * 0.145);
    fill(c, lx0, y, lx0 + bw * w, y + lh, LINE, lh / 2);
  });

  return downsample(c, F);
}

/* --- 書き出す --- */

const jobs = [
  { file: 'icon-192.png', size: 192, inset: 0, round: 0.22 },
  { file: 'icon-512.png', size: 512, inset: 0, round: 0.22 },
  { file: 'icon-180.png', size: 180, inset: 0, round: 0.22 },   // iPhone のホーム画面用
  { file: 'icon-maskable-512.png', size: 512, inset: 0.12, round: 0 }
];

for (const j of jobs) {
  const img = drawIcon(j.size, j.inset, j.round);
  const png = encodePng(img.size, img.size, img.buf);
  fs.writeFileSync(path.join(OUT, j.file), png);
  console.log('作成: web/icons/' + j.file + '  (' + img.size + 'x' + img.size + ', ' + png.length + ' バイト)');
}
