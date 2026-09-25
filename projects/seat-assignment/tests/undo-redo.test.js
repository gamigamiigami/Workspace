process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const { createElement, buildDocument, registerInTree } = require('./domstub.js');
const { parseHtml } = require('./htmlparse.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
const { root, scripts } = parseHtml(bodyMatch[1], createElement, registerInTree);
root.tagName = 'BODY';

global.document = buildDocument(root);
global.document.activeElement = { tagName: 'BODY' };
let store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.alertLog = [];
global.alert = (msg) => { global.alertLog.push(msg); };
global.confirmNext = true;
global.confirm = () => global.confirmNext;
global.window = { innerHeight: 900, addEventListener() {}, print() {} };

eval(scripts[0].replace("'use strict';", ''));

function assert(label, cond, extra) {
  console.log((cond ? 'PASS  ' : '**FAIL**  ') + label + (extra !== undefined ? '  → ' + extra : ''));
  if (!cond) process.exitCode = 1;
}
function byId(id) { return global.document.getElementById(id); }

console.log('===== 元に戻す・やり直す：🎲席替え実行 =====');
{
  const cr = getActiveClassroom();
  cr.rows = 3; cr.cols = 4; cr.students = []; cr.ngPairs = []; cr.history = [];
  cr.deskMeta = {}; cr.currentSeats = null; cr.tempFixed = {}; cr.checkerGender = false;
  for (let i = 0; i < 12; i++) {
    cr.students.push({ id: 's' + i, name: '生徒' + i, inactive: false, gender: (i % 2 === 0 ? 'm' : 'f'), number: null });
  }
  saveState();
  renderAll();

  assert('最初は元に戻すボタンが押せない', byId('btnUndoSeat').disabled === true);

  byId('btnRunShuffle').dispatch('click');
  const after1 = Object.assign({}, cr.currentSeats);
  assert('席替え実行で座席ができる', Object.keys(after1).length === 12);
  assert('元に戻すボタンが押せるようになる', byId('btnUndoSeat').disabled === false);
  assert('やり直すボタンはまだ押せない', byId('btnRedoSeat').disabled === true);

  byId('btnRunShuffle').dispatch('click');
  const after2 = Object.assign({}, cr.currentSeats);

  byId('btnUndoSeat').dispatch('click');
  assert('元に戻すと1回前（after1）の配置にもどる',
    JSON.stringify(cr.currentSeats) === JSON.stringify(after1));
  assert('やり直すボタンが押せるようになる', byId('btnRedoSeat').disabled === false);

  byId('btnRedoSeat').dispatch('click');
  assert('やり直すと2回目の配置（after2）にもどる',
    JSON.stringify(cr.currentSeats) === JSON.stringify(after2));
}

console.log('');
console.log('===== 元に戻す：入れかえ（🔀）・今回だけ固定（📌） =====');
{
  const cr = getActiveClassroom();
  byId('btnRunShuffle').dispatch('click');
  const beforeSwap = Object.assign({}, cr.currentSeats);

  setShuffleTool('swap');
  const keys = Object.keys(cr.currentSeats);
  onShuffleSeatTap(keys[0]);
  onShuffleSeatTap(keys[1]);
  assert('2人が入れかわる', cr.currentSeats[keys[0]] === beforeSwap[keys[1]]);

  byId('btnUndoSeat').dispatch('click');
  assert('元に戻すと入れかえ前にもどる', JSON.stringify(cr.currentSeats) === JSON.stringify(beforeSwap));

  // 📌固定のundo
  setShuffleTool('pin');
  onShuffleSeatTap(keys[0]);
  assert('📌固定される', cr.tempFixed[keys[0]] === beforeSwap[keys[0]]);
  byId('btnUndoSeat').dispatch('click');
  assert('📌固定も元に戻せる', cr.tempFixed[keys[0]] === undefined, JSON.stringify(cr.tempFixed));
  setShuffleTool('none');
}

console.log('');
console.log('===== 元に戻す：🔁男女を逆に・🧹空にする =====');
{
  const cr = getActiveClassroom();
  cr.tempFixed = {};
  byId('btnRunShuffle').dispatch('click');
  const before = Object.assign({}, cr.currentSeats);

  byId('btnInvertGender').dispatch('click');
  assert('男女を逆にすると配置が変わる', JSON.stringify(cr.currentSeats) !== JSON.stringify(before));
  byId('btnUndoSeat').dispatch('click');
  assert('男女を逆にした操作も元に戻せる', JSON.stringify(cr.currentSeats) === JSON.stringify(before));

  byId('btnInvertGender').dispatch('click'); // redoスタックをクリアする意味もかねて、もう一度
  global.confirmNext = true;
  byId('btnClearSeats').dispatch('click');
  assert('空にすると座席がなくなる', !cr.currentSeats || Object.keys(cr.currentSeats).length === 0);
  byId('btnUndoSeat').dispatch('click');
  assert('空にする操作も元に戻せる', cr.currentSeats && Object.keys(cr.currentSeats).length === 12);
}

console.log('');
console.log('===== 新しい変更をすると、やり直し（redo）はできなくなる =====');
{
  const cr = getActiveClassroom();
  byId('btnRunShuffle').dispatch('click');
  byId('btnRunShuffle').dispatch('click');
  byId('btnUndoSeat').dispatch('click');
  assert('元に戻したあとはやり直しができる', byId('btnRedoSeat').disabled === false);
  byId('btnRunShuffle').dispatch('click'); // 新しい変更
  assert('新しい変更をすると、やり直しができなくなる', byId('btnRedoSeat').disabled === true);
}

console.log('');
console.log('===== Ctrl+Z / Ctrl+Y のキーボード操作 =====');
{
  const cr = getActiveClassroom();
  byId('btnRunShuffle').dispatch('click');
  const before = Object.assign({}, cr.currentSeats);
  byId('btnRunShuffle').dispatch('click');
  const after = Object.assign({}, cr.currentSeats);

  global.document.activeElement = { tagName: 'BODY' };
  global.document.dispatchEvent({ type: 'keydown', ctrlKey: true, key: 'z', preventDefault() {} });
  assert('Ctrl+Z で元に戻る', JSON.stringify(cr.currentSeats) === JSON.stringify(before));

  global.document.dispatchEvent({ type: 'keydown', ctrlKey: true, key: 'y', preventDefault() {} });
  assert('Ctrl+Y でやり直す', JSON.stringify(cr.currentSeats) === JSON.stringify(after));

  // 入力欄にフォーカスがあるときは、Ctrl+Zをアプリ側で奪わない
  byId('btnRunShuffle').dispatch('click');
  const before2 = Object.assign({}, cr.currentSeats);
  byId('btnRunShuffle').dispatch('click');
  global.document.activeElement = { tagName: 'INPUT' };
  global.document.dispatchEvent({ type: 'keydown', ctrlKey: true, key: 'z', preventDefault() {} });
  assert('入力欄にフォーカス中はCtrl+Zで席替えを元に戻さない',
    JSON.stringify(cr.currentSeats) !== JSON.stringify(before2));
  global.document.activeElement = { tagName: 'BODY' };
}

console.log('');
console.log('===== NG設定タブの黒板の向きが、席替えタブと連動する =====');
{
  const cr = getActiveClassroom();
  cr.viewFlipped = false;
  renderNgGrid();
  assert('黒板が上のとき、NG設定のroomにflippedがつかない', !byId('ngRoom').classList.contains('flipped'));

  cr.viewFlipped = true;
  renderNgGrid();
  assert('席替えタブで黒板を下にすると、NG設定にも反映される', byId('ngRoom').classList.contains('flipped'));

  // 実際にボタン経由でも連動するか
  cr.viewFlipped = false;
  renderShuffleTab();
  byId('btnFlipView').dispatch('click');
  assert('黒板の向きボタンで viewFlipped が変わる', cr.viewFlipped === true);
  renderNgGrid();
  assert('ボタンで変えたあと、NG設定タブにもすぐ反映される', byId('ngRoom').classList.contains('flipped'));
}

console.log('');
console.log('===== NG警告：座席表を左に寄せるためのクラス付け外し =====');
{
  const cr = getActiveClassroom();
  cr.rows = 1; cr.cols = 4; cr.students = []; cr.ngPairs = []; cr.history = [];
  cr.deskMeta = {}; cr.tempFixed = {};
  for (let i = 0; i < 4; i++) cr.students.push({ id: 's' + i, name: '生徒' + i, inactive: false, gender: 'm', number: null });
  cr.currentSeats = { '0-0': 's0', '0-1': 's1', '0-2': 's2', '0-3': 's3' };
  cr.ngPairs = [{ id: 'n1', a: 's0', b: 's1', reason: '' }];
  getDeskMeta(cr, 0, 0);
  getDeskMeta(cr, 0, 1);

  renderHardAlert(cr);
  assert('NG違反があるとき document.body に has-ng-alert クラスがつく',
    global.document.body.classList.contains('has-ng-alert'));
  assert('警告リストの項目に title 属性（全文）がついている',
    /title="/.test(byId('hardAlert').innerHTML));

  cr.ngPairs = [];
  renderHardAlert(cr);
  assert('NG違反がなくなったら has-ng-alert クラスも消える',
    !global.document.body.classList.contains('has-ng-alert'));
}

console.log('');
console.log(process.exitCode ? '❌ 失敗したテストがあります' : '✅ すべてのテストに合格しました');
