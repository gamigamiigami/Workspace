/* =====================================================================
   「いま送るべき通知」を決める

   1分ごとに呼ばれて、予定とタスクを見て、送るべき通知の一覧を返すだけ。
   実際の送信はしないので、テストで結果をそのまま確かめられる。

   送ったかどうかは key（通知ごとに決まる文字列）で記録する。
   同じ key の通知は二度と送らないので、見回りが遅れても重複しない。
   ===================================================================== */

import {
  ymdOf, hmOf, todayStr, addDays, toMs, isHm, isYmd, fmtDay, diffDays
} from '../web/shared-date.js';
import { EVENT_RULES, eventStartTime, eventLabel, inQuietHours } from '../web/shared-model.js';

/** 見回りが少し遅れても届くようにする猶予。これより古い通知は「今さら」なので送らない */
export const CATCHUP_MS = 15 * 60 * 1000;

/**
 * @param {object} o {events, tasks, settings, now, catchupMs}
 * @returns {Array} [{key, title, body, url, at}]
 */
export function computeDueNotifications(o) {
  const events = o.events || [];
  const tasks = o.tasks || [];
  const st = o.settings;
  const now = o.now;
  const catchup = o.catchupMs == null ? CATCHUP_MS : o.catchupMs;
  const out = [];
  if (!st || !st.notify || !st.notify.on) return out;

  const n = st.notify;
  const today = todayStr(now);

  /** 送信の窓に入っているか（過ぎていて、かつ古すぎない） */
  const inWindow = at => Number.isFinite(at) && at <= now && at > now - catchup;
  /** 静かにしておく時間帯か（急ぎでない通知にだけ効かせる） */
  const isQuiet = at => inQuietHours(hmOf(at), n.quietFrom, n.quietTo);

  /* --- ① 予定の通知 --- */
  for (const ev of events) {
    if (!isYmd(ev.date) || ev.remindOff) continue;
    // 前後2日ぶんだけ見れば足りる（前日通知＝最大24時間前のため）
    if (diffDays(today, ev.date) < -1 || diffDays(today, ev.date) > 2) continue;

    const startTime = eventStartTime(ev);

    if (isHm(startTime)) {
      /* 開始時刻が決まっている予定 … 「前日／2時間前／30分前」をそれぞれ出す */
      for (const rule of EVENT_RULES) {
        if (!n.rules[rule.id]) continue;
        const at = ruleFireAt(ev.date, startTime, rule.beforeMin, n.allDayAt);
        if (!inWindow(at)) continue;
        // 前日のお知らせは急ぎではないので、静かな時間帯にあたるなら送らない
        // （2時間前・30分前は急ぎなので、夜中でも送る）
        if (rule.id === 'd1' && isQuiet(at)) continue;

        out.push({
          key: 'ev:' + ev.id + ':' + rule.id + ':' + ymdOf(at) + 'T' + hmOf(at),
          at,
          title: rule.id === 'd1' ? '明日は ' + fmtDay(ev.date) : eventLabel(ev),
          body: eventBody(ev, rule),
          url: '/?d=' + ev.date
        });
      }
    } else {
      /* 開始時刻が決まっていない予定 … 「何分前」が意味を持たない。
         そのまま3つのルールを当てると2時間前と30分前が同じ時刻になり、
         同じ通知が2回届いてしまう。so 「何日前か」でまとめて1日1回にする。 */
      const dayOffsets = new Set();
      for (const rule of EVENT_RULES) {
        if (!n.rules[rule.id]) continue;
        dayOffsets.add(Math.floor(rule.beforeMin / (60 * 24)));
      }
      for (const daysBefore of [...dayOffsets].sort((a, b) => a - b)) {
        const at = ruleFireAt(ev.date, '', daysBefore * 24 * 60, n.allDayAt);
        if (!inWindow(at)) continue;
        out.push({
          key: 'ev:' + ev.id + ':day' + daysBefore + ':' + ymdOf(at) + 'T' + hmOf(at),
          at,
          title: daysBefore === 0 ? eventLabel(ev) : '明日は ' + fmtDay(ev.date),
          body: allDayBody(ev, daysBefore),
          url: '/?d=' + ev.date
        });
      }
    }
  }

  /* --- ② タスクの期限 --- */
  for (const t of tasks) {
    if (t.done || t.remindOff || !isYmd(t.due)) continue;
    if (diffDays(today, t.due) < -1 || diffDays(today, t.due) > 1) continue;
    const time = isHm(t.dueTime) ? t.dueTime : (isHm(n.taskAt) ? n.taskAt : '08:00');
    const at = toMs(t.due, time);
    if (!inWindow(at)) continue;
    // ここでは静かな時間帯を見ない。時刻は使う人が自分で決めたものなので、
    // 勝手に握りつぶすとバグに見える（時刻を早朝にした意味が無くなる）。
    out.push({
      key: 'task:' + t.id + ':' + t.due + 'T' + time,
      at,
      title: 'きょうが期限',
      body: t.title || '（名前のないタスク）',
      url: '/?tab=task'
    });
  }

  /* --- ③ 毎朝のまとめ --- */
  if (isHm(n.digestAt)) {
    const at = toMs(today, n.digestAt);
    if (inWindow(at)) {
      const d = buildDigest(events, tasks, today);
      if (d) {
        out.push({ key: 'digest:' + today, at, title: d.title, body: d.body, url: '/?d=' + today });
      }
    }
  }

  // 同じ時刻に複数あるときは、早い順に並べる
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** 通知を送る時刻を決める。時刻が決まっていない予定は「決めた時刻」に寄せる */
export function ruleFireAt(dateStr, startTime, beforeMin, allDayAt) {
  if (!isYmd(dateStr)) return NaN;
  if (isHm(startTime)) return toMs(dateStr, startTime) - beforeMin * 60000;
  const at = isHm(allDayAt) ? allDayAt : '08:00';
  const daysBefore = Math.floor(beforeMin / (60 * 24));
  return toMs(addDays(dateStr, -daysBefore), at);
}

/** 開始時刻が決まっていない予定の本文 */
function allDayBody(ev, daysBefore) {
  const parts = [];
  parts.push(daysBefore === 0 ? 'きょうの予定' : eventLabel(ev));
  if (ev.venue.place) parts.push(ev.venue.place);
  if (ev.arriveTime) parts.push('会場入り ' + ev.arriveTime);
  return parts.join('／');
}

function eventBody(ev, rule) {
  const parts = [];
  const startTime = eventStartTime(ev);
  if (rule.id === 'd1') {
    parts.push(eventLabel(ev));
    if (startTime) parts.push(startTime + (ev.openTime ? ' 開演' : ' 会場入り'));
  } else {
    parts.push(rule.label);
    if (startTime) parts.push(startTime + (ev.openTime ? ' 開演' : ' 会場入り'));
  }
  if (ev.venue.place) parts.push(ev.venue.place);
  if (rule.id !== 'm30' && ev.arriveTime && ev.openTime) parts.push('会場入り ' + ev.arriveTime);
  return parts.join('／');
}

/** 毎朝のまとめ本文。出すものが何も無い日は送らない（null を返す） */
export function buildDigest(events, tasks, today) {
  const todays = events.filter(e => e.date === today);
  const due = tasks.filter(t => !t.done && isYmd(t.due) && t.due <= today);
  const soon = tasks.filter(t => !t.done && isYmd(t.due) && t.due > today && diffDays(today, t.due) <= 3);
  if (!todays.length && !due.length && !soon.length) return null;

  const lines = [];
  if (todays.length) {
    for (const e of todays) {
      const st = eventStartTime(e);
      lines.push('・' + (st ? st + ' ' : '') + eventLabel(e) + (e.venue.place ? '（' + e.venue.place + '）' : ''));
    }
  } else {
    lines.push('・セミナーの予定はありません');
  }
  const overdue = due.filter(t => t.due < today);
  if (overdue.length) lines.push('⚠ 期限ぎれのタスク ' + overdue.length + '件');
  const dueToday = due.filter(t => t.due === today);
  if (dueToday.length) lines.push('☑ きょう期限のタスク ' + dueToday.length + '件');
  if (soon.length) lines.push('・3日以内のタスク ' + soon.length + '件');

  return {
    title: 'きょうの予定（' + fmtDay(today) + '）',
    body: lines.join('\n')
  };
}
