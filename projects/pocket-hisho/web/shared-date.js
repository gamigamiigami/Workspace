/* =====================================================================
   日付と時刻の計算（サーバーとアプリ画面の両方から使う「1本だけ」の実装）

   ・このアプリは日本で使うので、日付はすべて **日本時間（JST, UTC+9）** で数える。
     サーバーは世界標準時(UTC)で動くので、ここを通さないと日付が1日ずれる。
   ・日本には夏時間が無いので、ずれは常に +9時間ちょうど。
   ・「日付」は 'YYYY-MM-DD'、「時刻」は 'HH:MM' の文字で持つ。
     数字の型にすると、端末の時差設定で意味が変わってしまうため。
   ===================================================================== */

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

/* --- 基本：世界標準時のミリ秒 ⇔ 日本時間の「年月日時分」 --- */

/** 世界標準時のミリ秒 → 日本時間の各部品 */
export function jstParts(ms) {
  const d = new Date(ms + JST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    w: d.getUTCDay()            // 0=日曜
  };
}

/** 日本時間の「年月日時分」 → 世界標準時のミリ秒 */
export function jstToMs(y, m, d, hh = 0, mm = 0) {
  return Date.UTC(y, m - 1, d, hh, mm, 0, 0) - JST_OFFSET_MS;
}

/** 'YYYY-MM-DD' と 'HH:MM' → 世界標準時のミリ秒（時刻なしなら0時0分として扱う） */
export function toMs(dateStr, timeStr) {
  const p = splitYmd(dateStr);
  if (!p) return NaN;
  const t = splitHm(timeStr);
  return jstToMs(p.y, p.m, p.d, t ? t.hh : 0, t ? t.mm : 0);
}

/* --- 文字の形を確かめる・分解する --- */

export function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
export function isHm(s) { return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s); }

export function splitYmd(s) {
  if (!isYmd(s)) return null;
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
}
export function splitHm(s) {
  if (!isHm(s)) return null;
  return { hh: Number(s.slice(0, 2)), mm: Number(s.slice(3, 5)) };
}

/* --- 作る --- */

export function pad2(n) { return String(n).padStart(2, '0'); }

/** 世界標準時のミリ秒 → 日本時間の 'YYYY-MM-DD' */
export function ymdOf(ms) {
  const p = jstParts(ms);
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
}
/** 世界標準時のミリ秒 → 日本時間の 'HH:MM' */
export function hmOf(ms) {
  const p = jstParts(ms);
  return pad2(p.hh) + ':' + pad2(p.mm);
}
/** いま（日本時間）の日付 */
export function todayStr(now = Date.now()) { return ymdOf(now); }

/* --- 動かす --- */

/** n日ぶん進める／戻す */
export function addDays(dateStr, n) {
  const p = splitYmd(dateStr);
  if (!p) return dateStr;
  return ymdOf(jstToMs(p.y, p.m, p.d, 12, 0) + n * 86400000);   // 昼を基準にして丸め誤差を避ける
}

/** nか月ぶん進める／戻す。その月に無い日は、その月の最終日にそろえる（1/31→2/28） */
export function addMonths(dateStr, n) {
  const p = splitYmd(dateStr);
  if (!p) return dateStr;
  const total = (p.y * 12) + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  const last = daysInMonth(y, m);
  return y + '-' + pad2(m) + '-' + pad2(Math.min(p.d, last));
}

/** n年ぶん。うるう日 2/29 の扱いを月おくりと共通にするため、12か月ぶんとして計算する */
export function addYears(dateStr, n) { return addMonths(dateStr, n * 12); }

export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** その日が含まれる週の月曜日 */
export function mondayOf(dateStr) {
  const w = weekdayOf(dateStr);
  const back = (w === 0) ? 6 : w - 1;
  return addDays(dateStr, -back);
}

/** 曜日（0=日曜） */
export function weekdayOf(dateStr) {
  const p = splitYmd(dateStr);
  if (!p) return 0;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

/** 日付どうしの差（日数） */
export function diffDays(fromStr, toStr) {
  const a = splitYmd(fromStr), b = splitYmd(toStr);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

/* --- 見せる --- */

export function fmtDay(dateStr) {
  const p = splitYmd(dateStr);
  if (!p) return dateStr || '';
  return p.m + '/' + p.d + '(' + WEEKDAY[weekdayOf(dateStr)] + ')';
}
export function fmtFull(dateStr) {
  const p = splitYmd(dateStr);
  if (!p) return dateStr || '';
  return p.y + '年' + p.m + '月' + p.d + '日(' + WEEKDAY[weekdayOf(dateStr)] + ')';
}

/* --- 通知の時刻を決める --------------------------------------------
   「予定の何分前に知らせるか」を、実際に通知を送る世界標準時のミリ秒に変える。
   予定に開始時刻が無い日は、設定した「時刻未定の予定を知らせる時刻」を使う。
   ------------------------------------------------------------------ */

/**
 * @param {string} dateStr  予定の日 'YYYY-MM-DD'
 * @param {string} timeStr  予定の開始時刻 'HH:MM'（空でもよい）
 * @param {number} beforeMin 何分前に知らせるか（0なら開始ちょうど）
 * @param {string} allDayAt  時刻が無い予定を知らせる時刻 'HH:MM'（既定 08:00）
 * @returns {number} 世界標準時のミリ秒
 */
export function reminderAt(dateStr, timeStr, beforeMin, allDayAt = '08:00') {
  if (!isYmd(dateStr)) return NaN;
  if (isHm(timeStr)) return toMs(dateStr, timeStr) - beforeMin * 60000;
  // 時刻が決まっていない予定は「何分前」が意味を持たないので、
  // 前日以前に知らせたい場合だけ日をずらし、時刻は allDayAt に固定する。
  const daysBefore = Math.floor(beforeMin / (60 * 24));
  return toMs(addDays(dateStr, -daysBefore), allDayAt);
}
