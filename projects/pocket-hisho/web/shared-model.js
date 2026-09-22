/* =====================================================================
   データの形（サーバーとアプリ画面の両方が使う「1つだけ」の定義）

   入口が2つ以上ある（アプリからの保存／バックアップの読み込み／古い保存ぶん）ので、
   形をそろえる処理はこのファイルの normalize*() だけに集める。
   項目を足すときは blank*() と normalize*() の両方に足すこと。
   ===================================================================== */

import { isYmd, isHm } from './shared-date.js';

/* --- 小道具 --- */
const str = v => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : ''));
const arr = v => (Array.isArray(v) ? v : []);
const pick = (o, k) => (o && typeof o === 'object' ? o[k] : undefined);
const posInt = v => Math.abs(Math.round(Number(v) || 0));

export function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* =====================================================================
   予定（セミナー1件）
   ===================================================================== */

export function blankEvent() {
  return {
    id: newId('e'),
    date: '', title: '',
    arriveTime: '', openTime: '', endTime: '',
    venue: { place: '', address: '', note: '' },
    contact: { org: '', person: '', tel: '', email: '' },
    schedule: [],                          // [{time, label}] 当日のながれ
    travelGo: { time: '', mins: '', route: '' },
    travelBack: { time: '', mins: '', route: '' },
    stay: { place: '', date: '', tel: '', address: '', note: '' },
    content: { audience: '', people: '', materials: '', note: '' },
    items: [],                             // [{text, done}] 持ち物
    money: [],                             // [{kind:'in'|'out', label, amount}]
    memo: '',
    remindOff: false                       // この予定だけ通知しない
  };
}

export function normalizeEvent(e) {
  const b = blankEvent();
  if (!e || typeof e !== 'object') return b;
  if (str(e.id)) b.id = str(e.id);
  b.date = isYmd(e.date) ? e.date : '';
  b.title = str(e.title);
  b.arriveTime = isHm(e.arriveTime) ? e.arriveTime : '';
  b.openTime = isHm(e.openTime) ? e.openTime : '';
  b.endTime = isHm(e.endTime) ? e.endTime : '';
  b.venue = { place: str(pick(e.venue, 'place')), address: str(pick(e.venue, 'address')), note: str(pick(e.venue, 'note')) };
  b.contact = {
    org: str(pick(e.contact, 'org')), person: str(pick(e.contact, 'person')),
    tel: str(pick(e.contact, 'tel')), email: str(pick(e.contact, 'email'))
  };
  b.schedule = arr(e.schedule)
    .map(r => ({ time: isHm(pick(r, 'time')) ? pick(r, 'time') : '', label: str(pick(r, 'label')) }))
    .filter(r => r.time || r.label);
  b.travelGo = { time: isHm(pick(e.travelGo, 'time')) ? pick(e.travelGo, 'time') : '', mins: str(pick(e.travelGo, 'mins')), route: str(pick(e.travelGo, 'route')) };
  b.travelBack = { time: isHm(pick(e.travelBack, 'time')) ? pick(e.travelBack, 'time') : '', mins: str(pick(e.travelBack, 'mins')), route: str(pick(e.travelBack, 'route')) };
  b.stay = {
    place: str(pick(e.stay, 'place')), date: isYmd(pick(e.stay, 'date')) ? pick(e.stay, 'date') : '',
    tel: str(pick(e.stay, 'tel')), address: str(pick(e.stay, 'address')), note: str(pick(e.stay, 'note'))
  };
  b.content = {
    audience: str(pick(e.content, 'audience')), people: str(pick(e.content, 'people')),
    materials: str(pick(e.content, 'materials')), note: str(pick(e.content, 'note'))
  };
  b.items = arr(e.items).map(r => ({ text: str(pick(r, 'text')), done: pick(r, 'done') === true })).filter(r => r.text);
  b.money = arr(e.money)
    .map(r => ({ kind: pick(r, 'kind') === 'out' ? 'out' : 'in', label: str(pick(r, 'label')), amount: posInt(pick(r, 'amount')) }))
    .filter(r => r.label || r.amount);
  b.memo = str(e.memo);
  b.remindOff = e.remindOff === true;
  return b;
}

/** その予定の「始まる時刻」。開演が無ければ会場入りを使う */
export function eventStartTime(ev) {
  return ev.openTime || ev.arriveTime || '';
}

/** 画面に出すときの名前（題名が空でも何か出す） */
export function eventLabel(ev) {
  return ev.title || ev.venue.place || ev.contact.org || '（名前未入力）';
}

export function moneyOf(ev) {
  let income = 0, expense = 0;
  for (const m of ev.money) { if (m.kind === 'out') expense += m.amount; else income += m.amount; }
  return { income, expense, net: income - expense };
}

/* =====================================================================
   タスク（やること）
   ===================================================================== */

export function blankTask() {
  return {
    id: newId('t'),
    title: '',
    due: '',              // 'YYYY-MM-DD'（空なら期限なし）
    dueTime: '',          // 'HH:MM'（空なら朝に知らせる）
    done: false,
    doneAt: 0,
    eventId: '',          // どの予定にひもづくか（空なら単独のタスク）
    note: '',
    remindOff: false
  };
}

export function normalizeTask(t) {
  const b = blankTask();
  if (!t || typeof t !== 'object') return b;
  if (str(t.id)) b.id = str(t.id);
  b.title = str(t.title);
  b.due = isYmd(t.due) ? t.due : '';
  b.dueTime = isHm(t.dueTime) ? t.dueTime : '';
  b.done = t.done === true;
  b.doneAt = Number(t.doneAt) || 0;
  b.eventId = str(t.eventId);
  b.note = str(t.note);
  b.remindOff = t.remindOff === true;
  return b;
}

/* =====================================================================
   設定（通知のしかた・カレンダー・持ち物のひな形）
   ===================================================================== */

/** 予定の通知タイミング。id は「もう送ったか」の記録に使うので変えないこと */
export const EVENT_RULES = [
  { id: 'd1', beforeMin: 24 * 60, label: '前日' },
  { id: 'h2', beforeMin: 120, label: '2時間前' },
  { id: 'm30', beforeMin: 30, label: '30分前' }
];

export function defaultSettings() {
  return {
    ownerName: '',
    notify: {
      on: true,
      rules: { d1: true, h2: true, m30: true },   // 予定の通知（上の3種類）
      allDayAt: '08:00',                          // 時刻未定の予定を知らせる時刻
      taskAt: '08:00',                            // タスクの期限を知らせる時刻
      digestAt: '07:00',                          // 毎朝のまとめ（空文字でオフ）
      // 静かにしておく時間帯。「前日のお知らせ」だけをここで止める。
      // 2時間前・30分前は急ぎなので夜中でも送るし、
      // 上の allDayAt / taskAt / digestAt は使う人が自分で決めた時刻なので止めない。
      quietFrom: '22:00',
      quietTo: '06:30'
    },
    calendars: [],                                // [{name, url}] 取り込む外部カレンダー
    defaultItems: [],                             // よく持っていくもの
    icsEnabled: true                              // 購読用URLを有効にするか
  };
}

export function normalizeSettings(s) {
  const b = defaultSettings();
  if (!s || typeof s !== 'object') return b;
  b.ownerName = str(s.ownerName);
  const n = pick(s, 'notify') || {};
  b.notify.on = n.on !== false;
  for (const r of EVENT_RULES) {
    const v = pick(n.rules, r.id);
    b.notify.rules[r.id] = (v === undefined) ? b.notify.rules[r.id] : (v === true);
  }
  b.notify.allDayAt = isHm(n.allDayAt) ? n.allDayAt : b.notify.allDayAt;
  b.notify.taskAt = isHm(n.taskAt) ? n.taskAt : b.notify.taskAt;
  b.notify.digestAt = (n.digestAt === '' || isHm(n.digestAt)) ? n.digestAt : b.notify.digestAt;
  b.notify.quietFrom = (n.quietFrom === '' || isHm(n.quietFrom)) ? n.quietFrom : b.notify.quietFrom;
  b.notify.quietTo = (n.quietTo === '' || isHm(n.quietTo)) ? n.quietTo : b.notify.quietTo;
  b.calendars = arr(s.calendars)
    .map(c => ({ name: str(pick(c, 'name')), url: str(pick(c, 'url')) }))
    .filter(c => /^https?:\/\//i.test(c.url) || /^webcal:\/\//i.test(c.url))
    .slice(0, 5);                                  // 取り込みは5本まで（取得に時間がかかるため）
  b.defaultItems = arr(s.defaultItems).map(str).filter(Boolean).slice(0, 50);
  b.icsEnabled = s.icsEnabled !== false;
  return b;
}

/* =====================================================================
   通知を「いま送るべきか」の判定に使う共通部分
   ===================================================================== */

/** 静かにしておく時間帯かどうか（22:00〜06:30 のように日をまたぐ指定に対応） */
export function inQuietHours(hm, from, to) {
  if (!isHm(hm) || !isHm(from) || !isHm(to)) return false;
  if (from === to) return false;
  return (from < to) ? (hm >= from && hm < to) : (hm >= from || hm < to);
}
