/* =====================================================================
   ICS（カレンダーのやりとりに使う共通の形式）の 組み立て と 読み取り

   ・組み立て … アプリの予定を「購読用URL」で配るため
   ・読み取り … Googleカレンダーの「シークレットアドレス(iCal形式)」を
                取り込んで、アプリ側でも並べて見られるようにするため

   時差について：このアプリは日本で使う前提なので、
   ・末尾が Z のもの（世界標準時）は正しく日本時間へ変換する
   ・TZID が付いているものは、そのカレンダーに書かれている時差(TZOFFSETTO)を読む
   ・何も付いていないものは日本時間として扱う
   夏時間が切り替わる国のカレンダーは、切り替え前後で最大1時間ずれることがある。
   ===================================================================== */

import {
  jstParts, jstToMs, toMs, ymdOf, hmOf, pad2, isYmd, isHm,
  splitYmd, addDays, weekdayOf, daysInMonth
} from '../web/shared-date.js';

/* =====================================================================
   1. 組み立て（アプリ → カレンダー）
   ===================================================================== */

/** ICS の中で意味を持つ記号を打ち消す */
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 1行は75バイトまでという決まりがあるので、超える分を折り返す */
function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {                      // 文字単位で見る（日本語を途中で割らない）
    const n = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;   // 2行目以降は先頭の空白1バイト分を引く
    if (curBytes + n > limit) { out.push(cur); cur = ''; curBytes = 0; }
    cur += ch; curBytes += n;
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
}

/** 世界標準時のミリ秒 → ICS の 20260925T043000Z 形式 */
export function icsStampUtc(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
         pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}
/** 'YYYY-MM-DD' → ICS の 20260925 形式（終日予定用） */
function icsDate(dateStr) { return dateStr.replace(/-/g, ''); }

/**
 * 予定の一覧から ICS の文字列を作る。
 * @param {Array} events {id, date, title, openTime, endTime, venue:{place,address}, memo}
 * @param {object} opts  {calName, now}
 */
export function buildIcs(events, opts = {}) {
  const calName = opts.calName || 'ポケット秘書';
  const stamp = icsStampUtc(opts.now == null ? Date.now() : opts.now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//pocket-hisho//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(calName),
    'X-WR-TIMEZONE:Asia/Tokyo'
  ];

  for (const ev of events) {
    if (!isYmd(ev.date)) continue;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + escapeText(ev.id) + '@pocket-hisho');
    lines.push('DTSTAMP:' + stamp);

    if (isHm(ev.openTime)) {
      const startMs = toMs(ev.date, ev.openTime);
      // 終了時刻が無い・開始より前なら、1時間の予定として出す
      let endMs = isHm(ev.endTime) ? toMs(ev.date, ev.endTime) : NaN;
      if (!(endMs > startMs)) endMs = startMs + 60 * 60 * 1000;
      lines.push('DTSTART:' + icsStampUtc(startMs));
      lines.push('DTEND:' + icsStampUtc(endMs));
    } else {
      // 時刻が決まっていない予定は「終日」として出す（DTENDは翌日＝決まりごと）
      lines.push('DTSTART;VALUE=DATE:' + icsDate(ev.date));
      lines.push('DTEND;VALUE=DATE:' + icsDate(addDays(ev.date, 1)));
    }

    const title = ev.title || (ev.venue && ev.venue.place) || '予定';
    lines.push(foldLine('SUMMARY:' + escapeText(title)));

    const place = ev.venue && (ev.venue.place || ev.venue.address);
    if (place) {
      const loc = [ev.venue.place, ev.venue.address].filter(Boolean).join(' ');
      lines.push(foldLine('LOCATION:' + escapeText(loc)));
    }

    const desc = [];
    if (ev.contact && ev.contact.org) desc.push('主催: ' + ev.contact.org);
    if (ev.contact && ev.contact.person) desc.push('担当: ' + ev.contact.person + ' さん');
    if (ev.contact && ev.contact.tel) desc.push('電話: ' + ev.contact.tel);
    if (isHm(ev.arriveTime)) desc.push('会場入り: ' + ev.arriveTime);
    if (ev.memo) desc.push(ev.memo);
    if (desc.length) lines.push(foldLine('DESCRIPTION:' + escapeText(desc.join('\n'))));

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/* =====================================================================
   2. 読み取り（カレンダー → アプリ）
   ===================================================================== */

/** 折り返された行を1本に戻す */
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/** 'DTSTART;TZID=Asia/Tokyo:20260925T133000' を 名前・パラメータ・値 に分ける */
function parseLine(line) {
  const colon = findUnquoted(line, ':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq < 0) continue;
    params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}
/** 引用符の中のコロンを無視して探す */
function findUnquoted(s, ch) {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') q = !q;
    else if (!q && s[i] === ch) return i;
  }
  return -1;
}

function unescapeText(s) {
  return String(s).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/**
 * 日時の値を「日本時間の日付と時刻」に変える。
 * @param value  20260925T043000Z / 20260925T133000 / 20260925
 * @param params {VALUE, TZID}
 * @param tzOffsets VTIMEZONE から読み取った {TZID: 分} の表
 */
function parseDateValue(value, params, tzOffsets) {
  const v = String(value).trim();
  const mDate = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (mDate || (params.VALUE || '').toUpperCase() === 'DATE') {
    const m = mDate || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { date: m[1] + '-' + m[2] + '-' + m[3], time: '', allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], hh = +m[4], mi = +m[5];
  let ms;
  if (m[7] === 'Z') {
    ms = Date.UTC(y, mo - 1, d, hh, mi, 0);                     // 世界標準時そのもの
  } else if (params.TZID && tzOffsets && tzOffsets[params.TZID] != null) {
    ms = Date.UTC(y, mo - 1, d, hh, mi, 0) - tzOffsets[params.TZID] * 60000;
  } else {
    ms = jstToMs(y, mo, d, hh, mi);                             // 時差の指定なし → 日本時間
  }
  return { date: ymdOf(ms), time: hmOf(ms), allDay: false, ms };
}

/** VTIMEZONE から {TZID: 時差(分)} を読む（夏時間がある地域は標準時のほうを採る） */
function readTimezones(lines) {
  const out = {};
  let inTz = false, tzid = null, offset = null, inStandard = false, standardOffset = null;
  for (const raw of lines) {
    const up = raw.toUpperCase();
    if (up === 'BEGIN:VTIMEZONE') { inTz = true; tzid = null; offset = null; standardOffset = null; continue; }
    if (up === 'END:VTIMEZONE') {
      if (tzid) out[tzid] = standardOffset != null ? standardOffset : offset;
      inTz = false; continue;
    }
    if (!inTz) continue;
    if (up === 'BEGIN:STANDARD') { inStandard = true; continue; }
    if (up === 'END:STANDARD') { inStandard = false; continue; }
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === 'TZID') tzid = p.value.trim();
    if (p.name === 'TZOFFSETTO') {
      const m = /^([+-])(\d{2})(\d{2})$/.exec(p.value.trim());
      if (m) {
        const mins = (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
        if (inStandard) standardOffset = mins; else if (offset == null) offset = mins;
      }
    }
  }
  return out;
}

/**
 * ICS の文字列から予定を取り出す（まだ繰り返しは展開しない）。
 * @returns {Array} {uid, date, startTime, endTime, allDay, title, location, desc, rrule, exdates}
 */
export function parseIcs(text) {
  const lines = unfold(text).split('\n').map(s => s.trim()).filter(Boolean);
  const tzOffsets = readTimezones(lines);
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const up = raw.toUpperCase();
    if (up === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (up === 'END:VEVENT') {
      if (cur && cur.date) out.push(normalizeParsed(cur));
      cur = null; continue;
    }
    if (!cur) continue;
    const p = parseLine(raw);
    if (!p) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value.trim(); break;
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'DESCRIPTION': cur.desc = unescapeText(p.value); break;
      case 'STATUS': cur.status = p.value.trim().toUpperCase(); break;
      case 'RRULE': cur.rrule = p.value.trim(); break;
      case 'DTSTART': {
        const v = parseDateValue(p.value, p.params, tzOffsets);
        if (v) { cur.date = v.date; cur.startTime = v.allDay ? '' : v.time; cur.allDay = v.allDay; }
        break;
      }
      case 'DTEND': {
        const v = parseDateValue(p.value, p.params, tzOffsets);
        if (v) { cur.endDate = v.date; cur.endTime = v.allDay ? '' : v.time; }
        break;
      }
      case 'EXDATE': {
        for (const one of p.value.split(',')) {
          const v = parseDateValue(one, p.params, tzOffsets);
          if (v) cur.exdates.push(v.date);
        }
        break;
      }
      default: break;
    }
  }
  return out;
}

function normalizeParsed(c) {
  return {
    uid: c.uid || '',
    date: c.date,
    startTime: c.startTime || '',
    endTime: c.endTime || '',
    allDay: !!c.allDay,
    title: c.title || '(名前なし)',
    location: c.location || '',
    desc: c.desc || '',
    status: c.status || '',
    rrule: c.rrule || '',
    exdates: c.exdates || []
  };
}

/* ---------------------------------------------------------------------
   繰り返し予定の展開
   よく使われる形（毎日・毎週・毎月・毎年／間隔／回数／終了日／曜日指定）だけを
   扱う。対応していない書き方のときは、最初の1回だけを返す。
   --------------------------------------------------------------------- */

const BYDAY_NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRrule(s) {
  const out = {};
  for (const part of String(s).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

/**
 * 期間を区切って繰り返しを展開する。
 * @param {Array} parsed parseIcs の結果
 * @param {string} fromYmd 展開しはじめる日
 * @param {string} toYmd   展開しおわる日
 * @param {number} maxPerEvent 1つの予定から作る最大の回数（暴走よけ）
 */
export function expandRecurrences(parsed, fromYmd, toYmd, maxPerEvent = 400) {
  const out = [];
  for (const ev of parsed) {
    if (ev.status === 'CANCELLED') continue;
    if (!ev.rrule) {
      if (ev.date >= fromYmd && ev.date <= toYmd) out.push(occurrence(ev, ev.date));
      continue;
    }
    const r = parseRrule(ev.rrule);
    const freq = (r.FREQ || '').toUpperCase();
    const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1);
    const count = r.COUNT ? parseInt(r.COUNT, 10) : null;
    let until = null;
    if (r.UNTIL) {
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(r.UNTIL);
      if (m) until = m[1] + '-' + m[2] + '-' + m[3];
    }
    const byday = r.BYDAY ? r.BYDAY.split(',').map(s => s.replace(/^[+-]?\d+/, '').toUpperCase()) : null;

    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
      if (ev.date >= fromYmd && ev.date <= toYmd) out.push(occurrence(ev, ev.date));
      continue;
    }

    const exset = new Set(ev.exdates);
    let made = 0, emitted = 0;
    let cursor = ev.date;
    const hardStop = 2000;                       // どんな設定でもここで必ず止まる
    for (let step = 0; step < hardStop; step++) {
      if (count != null && made >= count) break;
      if (until && cursor > until) break;
      if (cursor > toYmd) break;

      let dates = [cursor];
      if (freq === 'WEEKLY' && byday && byday.length) {
        // その週の、指定された曜日すべて
        const monday = addDays(cursor, ((weekdayOf(cursor) === 0 ? 6 : weekdayOf(cursor) - 1) * -1));
        dates = byday
          .filter(d => BYDAY_NUM[d] != null)
          .map(d => addDays(monday, BYDAY_NUM[d] === 0 ? 6 : BYDAY_NUM[d] - 1))
          .sort();
      }
      for (const dt of dates) {
        if (dt < ev.date) continue;
        if (until && dt > until) continue;
        if (count != null && made >= count) break;
        made++;
        if (dt < fromYmd || dt > toYmd) continue;
        if (exset.has(dt)) continue;
        out.push(occurrence(ev, dt));
        emitted++;
        if (emitted >= maxPerEvent) break;
      }
      if (emitted >= maxPerEvent) break;

      if (freq === 'DAILY') cursor = addDays(cursor, interval);
      else if (freq === 'WEEKLY') cursor = addDays(cursor, 7 * interval);
      else if (freq === 'MONTHLY') cursor = addMonthsKeepDay(cursor, interval, ev.date);
      else cursor = addMonthsKeepDay(cursor, 12 * interval, ev.date);
    }
  }
  return out;
}

/** 月おくり。元の「日」を覚えておき、その月に無ければ最終日にそろえる */
function addMonthsKeepDay(dateStr, n, originalStr) {
  const cur = splitYmd(dateStr);
  const org = splitYmd(originalStr) || cur;
  if (!cur) return dateStr;
  const total = cur.y * 12 + (cur.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  const day = Math.min(org.d, daysInMonth(y, m));
  return y + '-' + pad2(m) + '-' + pad2(day);
}

function occurrence(ev, dateStr) {
  return {
    uid: ev.uid + (dateStr === ev.date ? '' : '_' + dateStr.replace(/-/g, '')),
    date: dateStr,
    startTime: ev.startTime,
    endTime: ev.endTime,
    allDay: ev.allDay,
    title: ev.title,
    location: ev.location
  };
}

export { parseRrule as _parseRrule, readTimezones as _readTimezones };
