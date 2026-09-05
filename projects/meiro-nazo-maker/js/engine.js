/* ===========================================================================
 * engine.js — 迷路をたどる担当
 *
 * 「STARTからGOALまでの一番みじかい道」を調べるところ。
 * 壁・一方通行・○を通る・×を避ける・ワープを全部ここで面倒を見る。
 *
 * 使う側は MZ.engine.solve(board, 条件) を呼ぶだけでよい。
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.engine = (function () {
  'use strict';
  const M = MZ.model;

  const COUNT_CAP = 1e12;   // 道の本数がこれを超えたら「たくさん」とだけ言う

  function idxOf(board, r, c) { return r * board.cols + c; }
  function rcOf(board, i) { return { r: Math.floor(i / board.cols), c: i % board.cols }; }

  /* -----------------------------------------------------------------------
   * 2つのマスのあいだを通れるか
   *   壁がある（無効化されていない）→ 通れない
   *   一方通行が逆向き            → 通れない
   * --------------------------------------------------------------------- */
  function canPass(board, r1, c1, r2, c2) {
    const key = M.edgeBetween(r1, c1, r2, c2);
    if (!key) return false;
    const w = board.walls[key];
    if (w && !w.disabled) return false;          // 壁が生きている
    const ow = board.oneways[key];
    if (ow) {
      // 壁キーの a 側＝上または左、b 側＝下または右
      const e = M.edgeCells(key);
      const goingA2B = (r1 === e.a.r && c1 === e.a.c);
      if (ow === 'a2b' && !goingA2B) return false;
      if (ow === 'b2a' && goingA2B) return false;
    }
    return true;
  }

  /** 探索の下ごしらえ（通れないマス・ワープ表をまとめて作る） */
  function makeContext(board, opts) {
    opts = opts || {};
    const blocked = {};
    if (opts.useAvoid !== false) {
      M.cellsWithRole(board, 'avoid').forEach(function (e) { blocked[M.cellKey(e.r, e.c)] = true; });
    }
    const warpGroups = {};
    if (opts.useWarp) {
      M.cellsWithRole(board, 'warp').forEach(function (e) {
        const g = e.warpGroup || e.value || '*';
        (warpGroups[g] = warpGroups[g] || []).push({ r: e.r, c: e.c });
      });
    }
    // マス → ワープ先の一覧
    const warpFrom = {};
    Object.keys(warpGroups).forEach(function (g) {
      const list = warpGroups[g];
      list.forEach(function (a) {
        warpFrom[M.cellKey(a.r, a.c)] = list.filter(function (b) { return !(b.r === a.r && b.c === a.c); });
      });
    });
    return { blocked: blocked, warpFrom: warpFrom, hasWarp: Object.keys(warpFrom).length > 0 };
  }

  /** そのマスから行ける先の一覧 */
  function neighbors(board, r, c, ctx) {
    const out = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let i = 0; i < dirs.length; i++) {
      const nr = r + dirs[i][0], nc = c + dirs[i][1];
      if (!M.inside(board, nr, nc)) continue;
      if (ctx.blocked[M.cellKey(nr, nc)]) continue;
      if (!canPass(board, r, c, nr, nc)) continue;
      out.push({ r: nr, c: nc, warp: false });
    }
    const wf = ctx.warpFrom[M.cellKey(r, c)];
    if (wf) {
      for (let i = 0; i < wf.length; i++) {
        if (ctx.blocked[M.cellKey(wf[i].r, wf[i].c)]) continue;
        out.push({ r: wf[i].r, c: wf[i].c, warp: true });
      }
    }
    return out;
  }

  /* -----------------------------------------------------------------------
   * いちばん短い道をさがす（同時に「何通りあるか」も数える）
   * --------------------------------------------------------------------- */
  function bfs(board, start, ctx) {
    const n = board.rows * board.cols;
    const dist = new Int32Array(n).fill(-1);
    const cnt = new Float64Array(n);
    const par = new Int32Array(n).fill(-1);
    const si = idxOf(board, start.r, start.c);
    dist[si] = 0; cnt[si] = 1;
    const queue = [si];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const p = rcOf(board, u);
      const ns = neighbors(board, p.r, p.c, ctx);
      for (let i = 0; i < ns.length; i++) {
        const v = idxOf(board, ns[i].r, ns[i].c);
        if (dist[v] === -1) {
          dist[v] = dist[u] + 1;
          cnt[v] = cnt[u];
          par[v] = u;
          queue.push(v);
        } else if (dist[v] === dist[u] + 1) {
          cnt[v] = Math.min(COUNT_CAP, cnt[v] + cnt[u]);
        }
      }
    }
    return { dist: dist, cnt: cnt, par: par };
  }

  function tracePath(board, res, goalIdx) {
    const path = [];
    let cur = goalIdx;
    let guard = 0;
    while (cur !== -1 && guard++ < 100000) {
      path.push(rcOf(board, cur));
      cur = res.par[cur];
    }
    return path.reverse();
  }

  /* -----------------------------------------------------------------------
   * ○を全部通る（順番は自由）— 通ったかどうかを覚えながらさがす
   * ○は 8個までを想定（それ以上は時間がかかるので順番指定を使ってもらう）
   * --------------------------------------------------------------------- */
  const MUST_LIMIT = 8;

  function solveWithMust(board, start, goal, mustCells, ctx) {
    const k = mustCells.length;
    const full = (1 << k) - 1;
    const n = board.rows * board.cols;
    const size = n * (1 << k);
    const dist = new Int32Array(size).fill(-1);
    const cnt = new Float64Array(size);
    const par = new Int32Array(size).fill(-1);
    const maskAt = {};
    mustCells.forEach(function (m, i) {
      const key = M.cellKey(m.r, m.c);
      maskAt[key] = (maskAt[key] || 0) | (1 << i);
    });

    const si = idxOf(board, start.r, start.c);
    const startMask = maskAt[M.cellKey(start.r, start.c)] || 0;
    const s0 = si * (1 << k) + startMask;
    dist[s0] = 0; cnt[s0] = 1;
    const queue = [s0];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const ui = Math.floor(u / (1 << k));
      const umask = u % (1 << k);
      const p = rcOf(board, ui);
      const ns = neighbors(board, p.r, p.c, ctx);
      for (let i = 0; i < ns.length; i++) {
        const vi = idxOf(board, ns[i].r, ns[i].c);
        const vmask = umask | (maskAt[M.cellKey(ns[i].r, ns[i].c)] || 0);
        const v = vi * (1 << k) + vmask;
        if (dist[v] === -1) {
          dist[v] = dist[u] + 1; cnt[v] = cnt[u]; par[v] = u; queue.push(v);
        } else if (dist[v] === dist[u] + 1) {
          cnt[v] = Math.min(COUNT_CAP, cnt[v] + cnt[u]);
        }
      }
    }
    const gi = idxOf(board, goal.r, goal.c);
    const gs = gi * (1 << k) + full;
    if (dist[gs] === -1) return null;
    // 道すじを戻す
    const path = [];
    let cur = gs, guard = 0;
    while (cur !== -1 && guard++ < 200000) {
      path.push(rcOf(board, Math.floor(cur / (1 << k))));
      cur = par[cur];
    }
    return { dist: dist[gs], count: cnt[gs], path: path.reverse() };
  }

  /* -----------------------------------------------------------------------
   * 決めた順番で○を通る — 区間ごとに最短をつないでいく
   * --------------------------------------------------------------------- */
  function solveOrdered(board, start, goal, mustCells, ctx) {
    const pts = [start].concat(mustCells.map(function (m) { return { r: m.r, c: m.c }; })).concat([goal]);
    let total = 0, count = 1, path = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const res = bfs(board, pts[i], ctx);
      const gi = idxOf(board, pts[i + 1].r, pts[i + 1].c);
      if (res.dist[gi] === -1) return null;
      total += res.dist[gi];
      count = Math.min(COUNT_CAP, count * res.cnt[gi]);
      const leg = tracePath(board, res, gi);
      path = path.concat(i === 0 ? leg : leg.slice(1));
    }
    return { dist: total, count: count, path: path };
  }

  /* -----------------------------------------------------------------------
   * 入口：最短ルートを調べる
   *   opts = { start, goal, useMust, ordered, useAvoid, useWarp }
   *   start / goal は {r,c} でも、START/GOALのID文字列でもよい
   * --------------------------------------------------------------------- */
  function resolvePoint(board, spec, list) {
    if (!spec) return null;
    if (typeof spec === 'string') {
      const f = M.findById(list, spec);
      return f ? { r: f.r, c: f.c } : null;
    }
    if (spec.r !== undefined) return { r: spec.r, c: spec.c };
    return null;
  }

  function solve(board, opts) {
    opts = opts || {};
    const start = resolvePoint(board, opts.start, board.starts) ||
                  (board.starts[0] ? { r: board.starts[0].r, c: board.starts[0].c } : null);
    const goal = resolvePoint(board, opts.goal, board.goals) ||
                 (board.goals[0] ? { r: board.goals[0].r, c: board.goals[0].c } : null);
    if (!start) return { ok: false, reason: 'STARTが置かれていません' };
    if (!goal) return { ok: false, reason: 'GOALが置かれていません' };

    const ctx = makeContext(board, opts);
    if (ctx.blocked[M.cellKey(start.r, start.c)]) return { ok: false, reason: 'STARTが「通らないマス（×）」になっています' };
    if (ctx.blocked[M.cellKey(goal.r, goal.c)]) return { ok: false, reason: 'GOALが「通らないマス（×）」になっています' };

    let must = opts.useMust ? M.cellsWithRole(board, 'must') : [];
    let result = null;
    let note = '';

    if (must.length && opts.ordered) {
      must = must.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      result = solveOrdered(board, start, goal, must, ctx);
      note = '決めた順番で○を通る条件つき';
    } else if (must.length) {
      if (must.length > MUST_LIMIT) {
        return { ok: false, reason: '必ず通る○が多すぎます（' + MUST_LIMIT + '個まで）。順番を決める設定に切り替えてください' };
      }
      result = solveWithMust(board, start, goal, must, ctx);
      note = '○をすべて通る条件つき';
    } else {
      const res = bfs(board, start, ctx);
      const gi = idxOf(board, goal.r, goal.c);
      if (res.dist[gi] !== -1) {
        result = { dist: res.dist[gi], count: res.cnt[gi], path: tracePath(board, res, gi) };
      }
      // 行けないマスの数（一方通行で詰んでいないかの確認に使う）
      let unreachable = 0;
      for (let i = 0; i < res.dist.length; i++) if (res.dist[i] === -1) unreachable++;
      if (result) result.unreachable = unreachable;
    }

    if (!result) {
      return { ok: false, reason: must.length ? '条件を満たしてGOALまで行ける道がありません' : 'STARTからGOALまで行けません' };
    }
    return {
      ok: true,
      dist: result.dist,
      count: result.count,
      capped: result.count >= COUNT_CAP,
      multiple: result.count > 1,
      path: result.path,
      unreachable: result.unreachable,
      note: note
    };
  }

  /* -----------------------------------------------------------------------
   * 「次に短い道」との差を測る
   *
   * 解く人が「最短はこっちだ」と自信を持てるように、正解ルートと
   * 2番目に短い道の差（マス数）を出す。差が4以上あれば見て分かる。
   *
   * さがし方（ヤンの方法の考え方）
   *   正解ルートを S=p0 → p1 → … → pn=G とする。
   *   正解と違う道は、必ずどこか pi で「正解とは別の方向」に分かれる。
   *   そこで pi ごとに
   *     ・pi → pi+1 の辺を通れなくする
   *     ・p0〜pi-1 のマスを通れなくする（同じ所を2回通る「歩き方」を別の道と数えないため）
   *   として pi から GOAL までの最短を測り、i を足す。その最小が2番目に短い道。
   *
   * 一方通行は無視して数える（無視したほうが差は小さく出る＝控えめな見積もり）。
   * --------------------------------------------------------------------- */
  function buildUndirectedAdj(board, ctx) {
    const n = board.rows * board.cols;
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = [];
    for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) {
      if (ctx.blocked[M.cellKey(r, c)]) continue;
      const i = idxOf(board, r, c);
      [[0, 1], [1, 0]].forEach(function (d) {
        const nr = r + d[0], nc = c + d[1];
        if (!M.inside(board, nr, nc) || ctx.blocked[M.cellKey(nr, nc)]) return;
        const w = board.walls[M.edgeBetween(r, c, nr, nc)];
        if (w && !w.disabled) return;
        const j = idxOf(board, nr, nc);
        adj[i].push(j); adj[j].push(i);
      });
    }
    return adj;
  }

  /** src から dst までの最短。banned のマスと、1本の辺は通らない */
  function bfsBlocked(adj, n, src, dst, banned, skipA, skipB) {
    const dist = new Int32Array(n).fill(-1);
    dist[src] = 0;
    const q = [src]; let h = 0;
    while (h < q.length) {
      const u = q[h++];
      if (u === dst) return dist[u];
      const list = adj[u];
      for (let k = 0; k < list.length; k++) {
        const v = list[k];
        if (dist[v] !== -1) continue;
        if (banned[v]) continue;
        if ((u === skipA && v === skipB) || (u === skipB && v === skipA)) continue;
        dist[v] = dist[u] + 1;
        q.push(v);
      }
    }
    return dist[dst];
  }

  function routeMargin(board, route, opts) {
    opts = opts || {};
    if (!route || route.length < 2) return { margin: Infinity, alt: Infinity, d0: 0, weakEdge: null };
    const n = board.rows * board.cols;
    const ctx = makeContext(board, { useAvoid: opts.useAvoid !== false, useWarp: false });
    const adj = buildUndirectedAdj(board, ctx);
    const goalIdx = idxOf(board, route[route.length - 1].r, route[route.length - 1].c);
    const d0 = route.length - 1;
    const banned = new Uint8Array(n);
    let best = Infinity, weak = null;

    for (let i = 0; i < route.length - 1; i++) {
      const from = idxOf(board, route[i].r, route[i].c);
      const to = idxOf(board, route[i + 1].r, route[i + 1].c);
      const d = bfsBlocked(adj, n, from, goalIdx, banned, from, to);
      if (d >= 0 && i + d < best) {
        best = i + d;
        weak = M.edgeBetween(route[i].r, route[i].c, route[i + 1].r, route[i + 1].c);
      }
      banned[from] = 1;
    }
    return { margin: best === Infinity ? Infinity : best - d0, alt: best, d0: d0, weakEdge: weak };
  }

  /** 差を人に見せる文にする */
  function marginText(m) {
    if (m === Infinity) return 'ほかに行ける道がないので、まちがえようがありません';
    return '次に短い道より ' + m + 'マス 短い';
  }

  /** STARTから行けるマスの数（一方通行の詰まり確認用） */
  function reachableCount(board, start, opts) {
    const ctx = makeContext(board, opts || {});
    const res = bfs(board, start, ctx);
    let n = 0;
    for (let i = 0; i < res.dist.length; i++) if (res.dist[i] !== -1) n++;
    return n;
  }

  /** 2つの道すじが同じかどうか */
  function samePath(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i].r !== b[i].r || a[i].c !== b[i].c) return false;
    return true;
  }

  /** その道すじが本当に通れるか（壁をすり抜けていないか）を確かめる */
  function pathIsWalkable(board, path, opts) {
    if (!path || path.length < 2) return path && path.length === 1;
    const ctx = makeContext(board, opts || {});
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (ctx.blocked[M.cellKey(b.r, b.c)]) return false;
      const adjacent = (Math.abs(a.r - b.r) + Math.abs(a.c - b.c)) === 1;
      if (adjacent) {
        if (!canPass(board, a.r, a.c, b.r, b.c)) return false;
      } else {
        // となり合っていないなら、ワープでつながっているか
        const wf = ctx.warpFrom[M.cellKey(a.r, a.c)] || [];
        const ok = wf.some(function (w) { return w.r === b.r && w.c === b.c; });
        if (!ok) return false;
      }
    }
    return true;
  }

  return {
    canPass: canPass, neighbors: neighbors, makeContext: makeContext,
    solve: solve, bfs: bfs, tracePath: tracePath,
    reachableCount: reachableCount, samePath: samePath, pathIsWalkable: pathIsWalkable,
    routeMargin: routeMargin, marginText: marginText, MARGIN_GOOD: 4,
    idxOf: idxOf, rcOf: rcOf, MUST_LIMIT: MUST_LIMIT
  };
})();
