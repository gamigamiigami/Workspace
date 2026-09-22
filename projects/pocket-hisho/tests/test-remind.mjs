/* ポケット秘書 — 「いつ通知するか」の検証
   実行: node tests/test-remind.mjs                                      */

import { toMs, ymdOf, hmOf } from '../web/shared-date.js';
import { normalizeEvent, normalizeTask, defaultSettings, normalizeSettings, inQuietHours } from '../web/shared-model.js';
import { computeDueNotifications, ruleFireAt, buildDigest, CATCHUP_MS } from '../src/remind.js';

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

const DAY = '2026-09-25';
const ev = (o) => normalizeEvent({ id: 'e1', date: DAY, title: '管理職研修', openTime: '13:30', arriveTime: '12:30', venue: { place: '大阪産業創造館' }, ...o });
const st = (o) => normalizeSettings({ ...defaultSettings(), ...o });
const at = (d, t) => toMs(d, t);
/** その時刻に鳴る通知の一覧（ルールのid だけ取り出す） */
function firedAt(dateStr, timeStr, opts = {}) {
  const now = at(dateStr, timeStr);
  const list = computeDueNotifications({
    events: opts.events || [ev()],
    tasks: opts.tasks || [],
    settings: opts.settings || st(),
    now
  });
  return list;
}
const ids = list => list.map(x => x.key.split(':').slice(0, 3).join(':'));

/* =================================================================== */
console.log('\n【1】予定の通知が、決めた時刻に鳴るか');
/* =================================================================== */

eq('30分前（13:00）に鳴る', ids(firedAt(DAY, '13:00')), ['ev:e1:m30']);
eq('2時間前（11:30）に鳴る', ids(firedAt(DAY, '11:30')), ['ev:e1:h2']);
eq('前日（9/24 13:30）に鳴る', ids(firedAt('2026-09-24', '13:30')), ['ev:e1:d1']);
eq('関係ない時刻（10:00）は鳴らない', ids(firedAt(DAY, '10:00')), []);
eq('予定が過ぎたあと（15:00）は鳴らない', ids(firedAt(DAY, '15:00')), []);

// 見回りが少し遅れても届く／遅れすぎたら今さらなので送らない
eq('10分遅れ（13:10）でもまだ届く', ids(firedAt(DAY, '13:10')), ['ev:e1:m30']);
eq('14分遅れ（13:14）でもまだ届く', ids(firedAt(DAY, '13:14')), ['ev:e1:m30']);
eq('20分遅れ（13:20）は、今さらなので送らない', ids(firedAt(DAY, '13:20')), []);
eq('猶予は15分', CATCHUP_MS, 15 * 60 * 1000);

/* =================================================================== */
console.log('\n【2】通知を切る／個別に止める');
/* =================================================================== */

eq('通知ぜんぶオフなら鳴らない', ids(firedAt(DAY, '13:00', { settings: st({ notify: { ...defaultSettings().notify, on: false } }) })), []);
eq('30分前だけオフにできる',
  ids(firedAt(DAY, '13:00', { settings: st({ notify: { ...defaultSettings().notify, rules: { d1: true, h2: true, m30: false } } }) })), []);
eq('その予定だけ通知しない設定', ids(firedAt(DAY, '13:00', { events: [ev({ remindOff: true })] })), []);
eq('2時間前は残る（30分前だけ切った場合）',
  ids(firedAt(DAY, '11:30', { settings: st({ notify: { ...defaultSettings().notify, rules: { d1: true, h2: true, m30: false } } }) })), ['ev:e1:h2']);

/* =================================================================== */
console.log('\n【3】時刻が決まっていない予定');
/* =================================================================== */

const noTime = ev({ openTime: '', arriveTime: '' });
// 「何分前」は意味を持たないので、1日につき1回にまとめる
eq('当日の朝8時に、1回だけ鳴る', ids(firedAt(DAY, '08:00', { events: [noTime] })), ['ev:e1:day0']);
eq('前日の朝8時にも、1回だけ鳴る', ids(firedAt('2026-09-24', '08:00', { events: [noTime] })), ['ev:e1:day1']);
ok('※同じ通知が2回来ないこと（2時間前と30分前が同じ時刻になる問題）',
  firedAt(DAY, '08:00', { events: [noTime] }).length === 1,
  JSON.stringify(firedAt(DAY, '08:00', { events: [noTime] }).map(x => x.key)));
eq('知らせる時刻は設定で変えられる（9:15）',
  ids(firedAt(DAY, '09:15', { events: [noTime], settings: st({ notify: { ...defaultSettings().notify, allDayAt: '09:15' } }) })), ['ev:e1:day0']);
eq('30分前だけ切っても、当日のお知らせは残る',
  ids(firedAt(DAY, '08:00', { events: [noTime], settings: st({ notify: { ...defaultSettings().notify, rules: { d1: true, h2: true, m30: false } } }) })), ['ev:e1:day0']);
eq('当日のお知らせを全部切る（前日だけ残す）',
  ids(firedAt(DAY, '08:00', { events: [noTime], settings: st({ notify: { ...defaultSettings().notify, rules: { d1: true, h2: false, m30: false } } }) })), []);
const allDayBody0 = firedAt(DAY, '08:00', { events: [noTime] })[0];
ok('当日のお知らせに「30分前」とは書かない', !allDayBody0.body.includes('30分前'), allDayBody0.body);
ok('当日のお知らせは「きょうの予定」と会場が入る',
  allDayBody0.body.includes('きょうの予定') && allDayBody0.body.includes('大阪産業創造館'), allDayBody0.body);
eq('開演が無くても会場入りがあればそれを使う',
  ids(firedAt(DAY, '12:00', { events: [ev({ openTime: '' })] })), ['ev:e1:m30']);

/* =================================================================== */
console.log('\n【4】静かにしておく時間帯（22:00〜翌6:30）');
/* =================================================================== */

ok('22:30 は静かな時間', inQuietHours('22:30', '22:00', '06:30'));
ok('02:00 は静かな時間（日をまたぐ）', inQuietHours('02:00', '22:00', '06:30'));
ok('06:29 は静かな時間', inQuietHours('06:29', '22:00', '06:30'));
ok('06:30 は静かな時間ではない', !inQuietHours('06:30', '22:00', '06:30'));
ok('12:00 は静かな時間ではない', !inQuietHours('12:00', '22:00', '06:30'));

// 深夜0:30開演の予定を作って、前日通知と直前通知の扱いを見る
const midnight = ev({ date: '2026-09-26', openTime: '00:30', arriveTime: '' });
eq('前日のお知らせが静かな時間に当たると、送らない',
  ids(firedAt('2026-09-25', '00:30', { events: [midnight] })), []);
eq('直前（30分前）のお知らせは、静かな時間でも送る',
  ids(firedAt('2026-09-26', '00:00', { events: [midnight] })), ['ev:e1:m30']);
eq('2時間前のお知らせも、静かな時間でも送る',
  ids(firedAt('2026-09-25', '22:30', { events: [midnight] })), ['ev:e1:h2']);

/* =================================================================== */
console.log('\n【5】タスクの期限');
/* =================================================================== */

const task = (o) => normalizeTask({ id: 't1', title: '資料を50部刷る', due: DAY, ...o });
eq('期限の日の朝8時に鳴る', ids(firedAt(DAY, '08:00', { events: [], tasks: [task()] })), ['task:t1:2026-09-25T08']);
eq('終わったタスクは鳴らない', ids(firedAt(DAY, '08:00', { events: [], tasks: [task({ done: true })] })), []);
eq('期限なしのタスクは鳴らない', ids(firedAt(DAY, '08:00', { events: [], tasks: [task({ due: '' })] })), []);
eq('時刻を決めたタスクは、その時刻に鳴る',
  ids(firedAt(DAY, '15:00', { events: [], tasks: [task({ dueTime: '15:00' })] })), ['task:t1:2026-09-25T15']);
// 使う人が自分で決めた時刻は、静かな時間帯でも握りつぶさない（設定した意味が無くなるため）
eq('タスクの通知時刻は設定で変えられる（早朝でも届く）',
  ids(firedAt(DAY, '06:00', { events: [], tasks: [task()], settings: st({ notify: { ...defaultSettings().notify, taskAt: '06:00' } }) })), ['task:t1:2026-09-25T06']);
eq('タスクごとに決めた時刻も、静かな時間帯で消えない',
  ids(firedAt(DAY, '23:00', { events: [], tasks: [task({ dueTime: '23:00' })] })), ['task:t1:2026-09-25T23']);
const tnotify = firedAt(DAY, '08:00', { events: [], tasks: [task()] })[0];
eq('タスク通知の中身', [tnotify.title, tnotify.body], ['きょうが期限', '資料を50部刷る']);

/* =================================================================== */
console.log('\n【6】毎朝のまとめ');
/* =================================================================== */

let d = firedAt(DAY, '07:00', { events: [ev()], tasks: [task(), normalizeTask({ id: 't2', title: '請求書', due: '2026-09-20' })] });
eq('7時にまとめが1件出る', d.map(x => x.key), ['digest:2026-09-25']);
ok('まとめに今日の予定が入る', d[0].body.includes('13:30 管理職研修'), JSON.stringify(d[0].body));
ok('まとめに期限ぎれの件数が入る', d[0].body.includes('期限ぎれのタスク 1件'), JSON.stringify(d[0].body));
ok('まとめに今日が期限の件数が入る', d[0].body.includes('きょう期限のタスク 1件'), JSON.stringify(d[0].body));
eq('まとめの題名', d[0].title, 'きょうの予定（9/25(金)）');

eq('予定もタスクも無い日は、まとめを送らない', firedAt(DAY, '07:00', { events: [], tasks: [] }).map(x => x.key), []);
ok('予定が無くてもタスクがあれば送る',
  firedAt(DAY, '07:00', { events: [], tasks: [task()] }).length === 1);
ok('予定が無い日は「予定はありません」と書く',
  buildDigest([], [normalizeTask({ id: 't3', title: 'あ', due: DAY })], DAY).body.includes('セミナーの予定はありません'));
eq('まとめを空にすればオフにできる',
  firedAt(DAY, '07:00', { events: [ev()], settings: st({ notify: { ...defaultSettings().notify, digestAt: '' } }) }).map(x => x.key), []);

/* =================================================================== */
console.log('\n【7】同じ通知を二度出さないための「かぎ」');
/* =================================================================== */

const k1 = firedAt(DAY, '13:00')[0].key;
const k2 = firedAt(DAY, '13:05')[0].key;
eq('同じ通知は、見回りが何度来ても同じかぎになる', k1, k2);
ok('かぎに予定のIDと種類と時刻が入る', k1 === 'ev:e1:m30:2026-09-25T13:00', k1);

const twoEvents = [ev(), ev({ id: 'e2', openTime: '13:30', title: '午後の部' })];
const both = firedAt(DAY, '13:00', { events: twoEvents });
eq('同じ時刻に2件あれば2件とも鳴る', both.length, 2);
ok('予定ごとに別のかぎになる', new Set(both.map(x => x.key)).size === 2, JSON.stringify(both.map(x => x.key)));

// 日付が変われば別の通知
const nextDay = firedAt('2026-09-26', '13:00', { events: [ev({ date: '2026-09-26' })] });
ok('日がちがえば別のかぎ', nextDay[0].key !== k1, nextDay[0].key);

/* =================================================================== */
console.log('\n【8】通知の中身');
/* =================================================================== */

const m30 = firedAt(DAY, '13:00')[0];
eq('30分前：題名は予定の名前', m30.title, '管理職研修');
ok('30分前：本文に時刻と会場が入る', m30.body.includes('30分前') && m30.body.includes('13:30 開演') && m30.body.includes('大阪産業創造館'), m30.body);
eq('タップするとその日が開く', m30.url, '/?d=2026-09-25');

const d1 = firedAt('2026-09-24', '13:30')[0];
eq('前日：題名に日付が入る', d1.title, '明日は 9/25(金)');
ok('前日：本文に会場入りの時刻も入る', d1.body.includes('会場入り 12:30'), d1.body);

const noName = firedAt(DAY, '13:00', { events: [ev({ title: '', venue: { place: '' }, contact: { org: '' } })] })[0];
eq('名前が空でも、題名が空にならない', noName.title, '（名前未入力）');

/* =================================================================== */
console.log('\n【9】通知の時刻の計算そのもの');
/* =================================================================== */

eq('13:30 の30分前は 13:00', hmOf(ruleFireAt(DAY, '13:30', 30, '08:00')), '13:00');
eq('13:30 の24時間前は 前日13:30', [ymdOf(ruleFireAt(DAY, '13:30', 1440, '08:00')), hmOf(ruleFireAt(DAY, '13:30', 1440, '08:00'))], ['2026-09-24', '13:30']);
eq('00:30 の2時間前は 前日22:30', [ymdOf(ruleFireAt('2026-09-26', '00:30', 120, '08:00')), hmOf(ruleFireAt('2026-09-26', '00:30', 120, '08:00'))], ['2026-09-25', '22:30']);
ok('日付がおかしいと計算しない', Number.isNaN(ruleFireAt('へんな日付', '13:30', 30, '08:00')));

console.log('\n────────────────────────────');
console.log('合格 ' + pass + ' ／ 不合格 ' + fail);
if (failures.length) { console.log('\n不合格の一覧:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
