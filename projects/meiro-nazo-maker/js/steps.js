/* ===========================================================================
 * steps.js — STEPをつなげる担当（連鎖のしくみ）
 *
 * ★大事な考え方★
 *   設計図（Maze）は編集でしか変わらない。
 *   STEPを走らせるときは、設計図を毎回まるごとコピーしてから変換をかける。
 *   だから「STEP3をいじったらSTEP1が壊れた」は起きない。
 *
 *   STEP1 → 盤面A・ルートA・文字A
 *   STEP2 → 盤面B（Aから壁を消した）
 *   STEP3 → 盤面Bのルート …というように、前の結果を次に渡していく。
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.steps = (function () {
  'use strict';
  const M = MZ.model;

  /* 前のSTEPから次に受けわたすもの */
  const FLOW = ['board', 'path', 'chars', 'text', 'shape'];

  function makeStep(type, params) {
    const op = MZ.ops.get(type);
    return {
      id: M.newId('sp'),
      type: type,
      params: Object.assign({}, (op && op.defaults) || {}, params || {}),
      note: ''
    };
  }

  /** STEPの見出し（一覧に出す短い説明） */
  function describe(step) {
    const op = MZ.ops.get(step.type);
    if (!op) return '不明なギミック';
    try { return op.describe ? op.describe(step.params || {}) : op.label; }
    catch (e) { return op.label; }
  }

  /* -----------------------------------------------------------------------
   * STEPを順に走らせる
   * --------------------------------------------------------------------- */
  function runSteps(maze, steps) {
    let ctx = {
      board: M.cloneBoard(maze),
      path: null, chars: null, text: null, shape: null
    };
    const results = [{
      index: -1, step: null, title: '最初の盤面',
      board: ctx.board, path: null, chars: null, text: null, shape: null, log: '', warn: null, error: null
    }];

    (steps || []).forEach(function (st, i) {
      const op = MZ.ops.get(st.type);
      if (!op) {
        results.push({ index: i, step: st, title: '不明なギミック', board: ctx.board, error: '「' + st.type + '」というギミックは見つかりません' });
        return;
      }
      const params = Object.assign({}, op.defaults || {}, st.params || {});
      let out;
      try {
        out = op.run(ctx, params) || {};
      } catch (e) {
        out = { error: 'ギミックの中でエラーが起きました：' + (e && e.message ? e.message : e) };
      }
      const next = Object.assign({}, ctx);
      FLOW.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(out, k)) next[k] = out[k]; });
      // 盤面が作りかえられたら、前に読んだ文字は無効にする（古い情報を持ち越さない）
      if (Object.prototype.hasOwnProperty.call(out, 'board') && out.board !== ctx.board) {
        if (!Object.prototype.hasOwnProperty.call(out, 'chars')) { next.chars = null; next.text = null; }
      }
      ctx = next;
      results.push({
        index: i, step: st, title: describe(st),
        board: ctx.board, path: ctx.path, chars: ctx.chars, text: ctx.text, shape: ctx.shape,
        cells: out.cells || null,
        log: out.log || '', warn: out.warn || null, error: out.error || null,
        info: out.info || null
      });
    });
    return results;
  }

  /** 最後に出てきた文字（＝こたえ） */
  function finalText(results) {
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].text) return results[i].text;
    }
    return '';
  }

  /* -----------------------------------------------------------------------
   * 自動検証 — 「謎として成立しているか」を機械にチェックさせる
   * 返すのは { level:'ok'|'warn'|'ng', text } の一覧
   * --------------------------------------------------------------------- */
  function validateAll(maze, steps) {
    const out = [];
    const ok = function (t) { out.push({ level: 'ok', text: t }); };
    const warn = function (t) { out.push({ level: 'warn', text: t }); };
    const ng = function (t) { out.push({ level: 'ng', text: t }); };

    /* --- START / GOAL --- */
    if (!maze.starts.length) { ng('STARTが置かれていません'); return out; }
    if (!maze.goals.length) { ng('GOALが置かれていません'); return out; }

    const base = MZ.engine.solve(maze, { useAvoid: true });
    if (!base.ok) { ng(base.reason); }
    else {
      ok('STARTからGOALへ到達できます（最短 ' + base.dist + 'マス）');
      if (base.multiple) warn('最短ルートが' + (base.capped ? 'たくさん' : base.count + '通り') + '存在します');
      else ok('最短ルートは1本だけです');
    }

    /* --- 描いた正解ルート --- */
    const rt = maze.routes[0];
    if (rt && rt.cells.length > 1) {
      const walkable = MZ.engine.pathIsWalkable(maze, rt.cells, { useAvoid: true });
      if (!walkable) ng('描いた正解ルートは、今の壁では通れません（「このルートを正解にする」を押してください）');
      else {
        ok('描いた正解ルートは通れます（' + (rt.cells.length - 1) + 'マス）');
        if (base.ok) {
          if (rt.cells.length - 1 === base.dist) {
            if (MZ.engine.samePath(base.path, rt.cells) && !base.multiple) ok('正解ルートは最短です（ほかに同じ長さの道はありません）');
            else if (base.multiple) warn('正解ルートは最短ですが、同じ長さの別の道もあります');
            else warn('同じ長さの別の道が最短として見つかりました');
          } else if (rt.cells.length - 1 > base.dist) {
            warn('正解ルートより短い道（' + base.dist + 'マス）があります。プレイヤーはそちらを通ってしまいます');
          }
        }
      }
    } else {
      warn('正解ルートがまだ描かれていません');
    }

    /* --- ○を通る / ×を避ける --- */
    const musts = M.cellsWithRole(maze, 'must');
    const avoids = M.cellsWithRole(maze, 'avoid');
    if (musts.length) {
      if (musts.length > MZ.engine.MUST_LIMIT) {
        warn('必ず通る○が多すぎます（' + MZ.engine.MUST_LIMIT + '個まで）。順番を決める設定にしてください');
      } else {
        const r = MZ.engine.solve(maze, { useMust: true, useAvoid: true });
        if (r.ok) ok('指定した○（' + musts.length + '個）をすべて通れます（' + r.dist + 'マス）');
        else ng('指定した○をすべて通ることができません');
        const r2 = MZ.engine.solve(maze, { useMust: true, ordered: true, useAvoid: true });
        if (musts.some(function (m) { return m.order; })) {
          if (r2.ok) ok('決めた順番で○を通れます（' + r2.dist + 'マス）');
          else ng('決めた順番では○を通れません');
        }
      }
    }
    if (avoids.length) {
      const r = MZ.engine.solve(maze, { useAvoid: true });
      if (r.ok) ok('×（' + avoids.length + '個）を避けてGOALまで行けます');
      else ng('×を避けるとGOALまで行けません');
    }

    /* --- 一方通行で詰んでいないか --- */
    const oneCount = Object.keys(maze.oneways || {}).filter(function (k) {
      const w = maze.walls[k]; return !w || w.disabled;
    }).length;
    if (oneCount) {
      const total = maze.rows * maze.cols;
      const reach = MZ.engine.reachableCount(maze, maze.starts[0], { useAvoid: true });
      if (reach === total) ok('一方通行があっても、すべてのマスに行けます');
      else warn('一方通行のせいで ' + (total - reach) + 'マスに行けなくなっています（意図した通りか確認してください）');
    }

    /* --- ワープ --- */
    const warps = M.cellsWithRole(maze, 'warp');
    if (warps.length) {
      const withWarp = MZ.engine.solve(maze, { useWarp: true, useAvoid: true });
      if (withWarp.ok && base.ok && withWarp.dist < base.dist) {
        warn('ワープを使うと ' + withWarp.dist + 'マスの近道ができます（ワープなしは ' + base.dist + 'マス）');
      } else if (withWarp.ok) {
        ok('ワープを入れても最短ルートは変わりません');
      }
    }

    /* --- STEPの連鎖 --- */
    if (steps && steps.length) {
      const results = runSteps(maze, steps);
      let prevBoardStr = null;
      results.forEach(function (r) {
        if (r.index < 0) { prevBoardStr = JSON.stringify(r.board); return; }
        const no = 'STEP' + (r.index + 1) + '「' + r.title + '」';
        if (r.error) { ng(no + '：' + r.error); }
        else if (r.warn) { warn(no + '：' + r.warn); }
        else {
          const op = MZ.ops.get(r.step.type);
          if (op && op.group === 'かえる') {
            const now = JSON.stringify(r.board);
            if (now === prevBoardStr) warn(no + '：盤面が何も変わっていません');
            else ok(no + '：盤面の変化が成立しています');
          } else {
            ok(no + '：' + (r.log || 'OK'));
          }
        }
        if (r.board) prevBoardStr = JSON.stringify(r.board);
      });
      const last = results[results.length - 1];
      if (last && last.step && last.step.type === 'answer') {
        const exp = (last.step.params || {}).expected;
        if (exp) {
          if (last.text === exp) ok('最終こたえが想定どおりです（' + exp + '）');
          else ng('最終こたえが想定と違います（出てきたのは「' + (last.text || '') + '」）');
        }
      }
    } else {
      warn('STEPがまだ1つも作られていません');
    }

    return out;
  }

  return {
    makeStep: makeStep, describe: describe, runSteps: runSteps,
    finalText: finalText, validateAll: validateAll
  };
})();
