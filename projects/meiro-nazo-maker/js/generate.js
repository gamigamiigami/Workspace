/* ===========================================================================
 * generate.js — 迷路をつくる担当
 *
 * このツールの心臓部。ふつうの迷路メーカーと逆のことをする。
 *
 *   ふつう : 迷路をランダムに作る → 答えは作ってみないと分からない
 *   これ   : 先に「正解ルート」を描く → そのルートが正解になる迷路を作る
 *
 * しくみ（かんたんに言うと）
 *   1. いったん全部のマスのあいだに壁を立てる
 *   2. 描いてもらったルートの上だけ壁をこわして道にする
 *   3. 残りのマスを「すでに道になっているところから枝分かれさせる」形で掘る
 *      → 一度も輪っか（ぐるっと回れる道）ができない
 *      → どの2点をとっても道は必ず1本だけ
 *      → つまり描いたルートが自動的に「たった1つの最短ルート」になる
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.generate = (function () {
  'use strict';
  const M = MZ.model;

  /* -----------------------------------------------------------------------
   * 描いてもらったルートが使える形か調べる
   * --------------------------------------------------------------------- */
  function checkRoute(maze, cells) {
    if (!cells || cells.length < 2) {
      return { ok: false, reason: 'ルートが短すぎます。2マス以上つなげてください' };
    }
    const seenCell = {}, seenEdge = {};
    let crosses = false;
    for (let i = 0; i < cells.length; i++) {
      const p = cells[i];
      if (!M.inside(maze, p.r, p.c)) return { ok: false, reason: 'ルートが盤面の外に出ています' };
      const k = M.cellKey(p.r, p.c);
      if (seenCell[k]) crosses = true;        // 交差そのものは反則ではない
      seenCell[k] = true;
      if (i > 0) {
        const q = cells[i - 1];
        if (Math.abs(p.r - q.r) + Math.abs(p.c - q.c) !== 1) {
          return { ok: false, reason: 'ルートがとぎれています。となり合ったマスでつないでください' };
        }
        const ek = M.edgeBetween(q.r, q.c, p.r, p.c);
        if (seenEdge[ek]) return { ok: false, reason: '同じ通路を2回なぞっています。交差はできますが、行って戻るのはできません' };
        seenEdge[ek] = true;
      }
    }
    return { ok: true, crosses: crosses };
  }

  /* 検算用のかんたんな盤面を作る（探索エンジンに渡すため） */
  function makeProbe(maze, walls) {
    return {
      rows: maze.rows, cols: maze.cols,
      walls: walls, oneways: maze.oneways || {},
      elements: [], starts: [], goals: [], cellColors: {}
    };
  }

  /** その壁の並びで、ルートが「たった1本の最短ルート」になっているか */
  function routeIsUniqueShortest(maze, walls, cells) {
    const probe = makeProbe(maze, walls);
    const res = MZ.engine.solve(probe, {
      start: cells[0], goal: cells[cells.length - 1],
      useMust: false, useAvoid: false, useWarp: false
    });
    return res.ok && res.count === 1 && MZ.engine.samePath(res.path, cells);
  }

  /**
   * 「1本だけ」に加えて「次に短い道との差」も足りているか
   * 差が小さいと、解く人が どっちが最短か 数えないと分からなくなる
   */
  function routeIsClearlyShortest(maze, walls, cells, needMargin) {
    if (!routeIsUniqueShortest(maze, walls, cells)) return false;
    if (!needMargin) return true;
    const probe = makeProbe(maze, walls);
    probe.starts = [{ id: 's', r: cells[0].r, c: cells[0].c, label: 'S', color: 'black' }];
    probe.goals = [{ id: 'g', r: cells[cells.length - 1].r, c: cells[cells.length - 1].c, label: 'G', color: 'black' }];
    return MZ.engine.routeMargin(probe, cells).margin >= needMargin;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* -----------------------------------------------------------------------
   * 迷路を掘る本体
   *   seedCells … 最初から「道」として扱うマス（正解ルート）。空なら1マスから始める
   * --------------------------------------------------------------------- */
  function carve(maze, seedCells) {
    const walls = {};
    // 1. まず全部の壁を立てる
    for (let r = 0; r <= maze.rows; r++)
      for (let c = 0; c < maze.cols; c++) walls[M.hKey(r, c)] = M.makeWall();
    for (let r = 0; r < maze.rows; r++)
      for (let c = 0; c <= maze.cols; c++) walls[M.vKey(r, c)] = M.makeWall();

    const visited = {};
    const frontier = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    function addFrontier(r, c) {
      for (let i = 0; i < dirs.length; i++) {
        const nr = r + dirs[i][0], nc = c + dirs[i][1];
        if (!M.inside(maze, nr, nc)) continue;
        if (visited[M.cellKey(nr, nc)]) continue;
        frontier.push({ fr: r, fc: c, tr: nr, tc: nc });
      }
    }

    // 2. ルートの上の壁をこわして道にする
    const seeds = (seedCells && seedCells.length) ? seedCells
      : [{ r: Math.floor(Math.random() * maze.rows), c: Math.floor(Math.random() * maze.cols) }];
    seeds.forEach(function (p) { visited[M.cellKey(p.r, p.c)] = true; });
    for (let i = 0; i + 1 < seeds.length; i++) {
      const key = M.edgeBetween(seeds[i].r, seeds[i].c, seeds[i + 1].r, seeds[i + 1].c);
      if (key) delete walls[key];
    }
    seeds.forEach(function (p) { addFrontier(p.r, p.c); });

    // 3. 残りを枝分かれで掘る（輪っかを作らないので道は必ず1本になる）
    while (frontier.length) {
      const i = Math.floor(Math.random() * frontier.length);
      const e = frontier[i];
      frontier[i] = frontier[frontier.length - 1];
      frontier.pop();
      if (visited[M.cellKey(e.tr, e.tc)]) continue;
      const key = M.edgeBetween(e.fr, e.fc, e.tr, e.tc);
      if (key) delete walls[key];
      visited[M.cellKey(e.tr, e.tc)] = true;
      addFrontier(e.tr, e.tc);
    }
    return walls;
  }

  /* -----------------------------------------------------------------------
   * 行き止まりを減らして「ぐるっと回れる道」を少し足す
   * 足すたびに検算して、正解ルートが1本のままのときだけ採用する
   * --------------------------------------------------------------------- */
  function addLoops(maze, walls, cells, amount, needMargin) {
    if (!amount || amount <= 0 || !cells || cells.length < 2) return 0;
    const candidates = [];
    Object.keys(walls).forEach(function (k) {
      if (!M.isBorderKey(maze, k)) candidates.push(k);
    });
    shuffle(candidates);
    const tries = Math.min(candidates.length, Math.round(candidates.length * amount));
    let added = 0;
    for (let i = 0; i < tries; i++) {
      const k = candidates[i];
      const saved = walls[k];
      delete walls[k];
      if (routeIsClearlyShortest(maze, walls, cells, needMargin)) {
        added++;
      } else {
        walls[k] = saved;   // 正解が崩れた（または差が縮んだ）ので元に戻す
      }
    }
    return added;
  }

  /* -----------------------------------------------------------------------
   * 入口1：正解ルートから迷路を作る
   * --------------------------------------------------------------------- */
  function fromRoute(maze, cells, opts) {
    opts = opts || {};
    const chk = checkRoute(maze, cells);
    if (!chk.ok) return chk;
    // 交差している道は、交差点で角を切られてしまうので「いちばん短い道」にはできない
    if (chk.crosses) {
      return { ok: false, reason: '交差しているルートは最短にできません（交差点で近道されてしまいます）。交差を使いたいときは「○を全部通る」などのしかけと組み合わせてください' };
    }

    const need = (opts.margin === undefined) ? MZ.engine.MARGIN_GOOD : opts.margin;
    const walls = carve(maze, cells);
    const loops = addLoops(maze, walls, cells, opts.branchiness || 0, need);
    const okUnique = routeIsUniqueShortest(maze, walls, cells);

    // できあがった迷路で「次に短い道」との差を測って報告する
    const probe = makeProbe(maze, walls);
    probe.starts = [{ id: 's', r: cells[0].r, c: cells[0].c, label: 'S', color: 'black' }];
    probe.goals = [{ id: 'g', r: cells[cells.length - 1].r, c: cells[cells.length - 1].c, label: 'G', color: 'black' }];
    const mg = MZ.engine.routeMargin(probe, cells).margin;

    return {
      ok: true,
      walls: walls,
      loops: loops,
      unique: okUnique,
      margin: mg,
      message: okUnique
        ? '正解ルート（' + cells.length + 'マス）が、たった1本の最短ルートになりました（' + MZ.engine.marginText(mg) + '）'
        : '迷路はできましたが、最短ルートが正解と一致していません。もう一度お試しください'
    };
  }

  /* -----------------------------------------------------------------------
   * 入口2：ふつうに迷路を自動生成する（正解ルートを決めていないとき）
   * --------------------------------------------------------------------- */
  function random(maze, opts) {
    opts = opts || {};
    const walls = carve(maze, null);
    return { ok: true, walls: walls, loops: 0, unique: true, message: '迷路を作りました' };
  }

  /* -----------------------------------------------------------------------
   * 入口3：今の迷路はそのままで、ルートの上だけ通れるようにする
   * （すでに作った迷路に、あとから道を1本足したいとき）
   * --------------------------------------------------------------------- */
  function openRoute(maze, cells) {
    const chk = checkRoute(maze, cells);
    if (!chk.ok) return chk;
    let opened = 0;
    for (let i = 0; i + 1 < cells.length; i++) {
      const key = M.edgeBetween(cells[i].r, cells[i].c, cells[i + 1].r, cells[i + 1].c);
      if (key && maze.walls[key]) { delete maze.walls[key]; opened++; }
    }
    return { ok: true, opened: opened, message: opened + 'か所の壁をこわして道にしました' };
  }

  /* =======================================================================
   * ルートを遠回りにする
   *
   * なぜ要るか：
   *   2段めまで作ったあと、3段めで「もっと短い道」を作りたいことがある。
   *   でも今の道がすでにギリギリ短いと、壁を消しても近道の余地がない。
   *   そこで、置いてある文字の並び順は崩さずに、道だけを長くしておく。
   *
   * やり方：
   *   ① 文字が乗っていない区間 route[i..j] をえらぶ
   *   ② その区間を、文字の無い空きマスを通る「もっと長い迂回路」に置きかえる
   *   ③ 迂回路の壁をあけ、もとの近道のまん中を1本ふさぐ
   *   ④ 「1本だけの最短・差4以上・なぞり返しなし・全マスに行ける」を確かめる
   *      ＋ 呼び出し側が渡した accept()（例：STEPの答えが変わっていないか）も通す
   *   だめなら元にもどして、別の場所で試す。
   * ===================================================================== */
  function lengthenRoute(maze, route, opts) {
    opts = opts || {};
    const accept = opts.accept || function () { return true; };
    const tries = opts.tries || 300;
    if (!route || route.length < 4) return { ok: false, reason: 'ルートが短すぎます' };

    // 迂回路の途中に使えるのは「ルートの外」かつ「何も置いていない」マスだけ
    const blocked = {};
    maze.elements.forEach(function (e) { blocked[M.cellKey(e.r, e.c)] = true; });
    maze.starts.concat(maze.goals).forEach(function (p) { blocked[M.cellKey(p.r, p.c)] = true; });
    const onRoute = {};
    route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    const pool = maze.elements.filter(function (e) { return e.role === 'none'; })
                              .map(function (e) { return e.value; });

    for (let t = 0; t < tries; t++) {
      const i = Math.floor(Math.random() * (route.length - 3));
      const span = 2 + Math.floor(Math.random() * 5);
      const j = Math.min(route.length - 1, i + span);
      if (j - i < 2) continue;

      // 区間にある「置いたもの」を集める。○×★などの役つき記号があるところは動かさない
      const moving = [];
      let hasRole = false;
      for (let k = i + 1; k < j; k++) {
        const cell = route[k];
        const here = maze.elements.filter(function (e) { return e.r === cell.r && e.c === cell.c; });
        if (here.some(function (e) { return e.role !== 'none'; })) { hasRole = true; break; }
        if (here.length) moving.push(here);
      }
      if (hasRole) continue;

      // 迂回路をさがす（区間より2マス以上長いもの）
      const detour = findDetour(maze, route[i], route[j], onRoute, blocked, (j - i) + 3);
      if (!detour) continue;
      const inner = detour.slice(1, detour.length - 1);
      if (inner.length < moving.length) continue;

      const backupWalls = JSON.stringify(maze.walls);
      const backupEls = JSON.stringify(maze.elements);
      const backupRoutes = JSON.stringify(maze.routes);

      // ① 迂回路の壁をあける（しかけに使っている色つきの壁にはさわらない）
      const detourKeys = [];
      let touchedColored = false;
      for (let k = 0; k + 1 < detour.length; k++) {
        const key = M.edgeBetween(detour[k].r, detour[k].c, detour[k + 1].r, detour[k + 1].c);
        const w = maze.walls[key];
        if (w && w.color && w.color !== 'black') { touchedColored = true; break; }
        detourKeys.push(key);
      }

      let done = false;
      if (!touchedColored) {
        {
          // ② 区間に置いてあった文字を、迂回路の上へ順番どおりに移す
          //    （これをしないと、読める文字の並びが変わってしまう）
          const spots = [];
          for (let m = 0; m < moving.length; m++) {
            const at = (moving.length === 1) ? 0 : Math.round(m * (inner.length - 1) / (moving.length - 1));
            spots.push(inner[at]);
          }
          moving.forEach(function (group, m) {
            group.forEach(function (e) { e.r = spots[m].r; e.c = spots[m].c; });
          });
          // 空いたマスには、まぎらわし用の文字を入れておく（見た目をそろえる）
          if (pool.length) {
            for (let k = i + 1; k < j; k++) {
              const cell = route[k];
              if (maze.elements.some(function (e) { return e.r === cell.r && e.c === cell.c; })) continue;
              maze.elements.push(M.makeElement(cell.r, cell.c,
                pool[Math.floor(Math.random() * pool.length)], { color: 'black' }));
            }
          }

          const newRoute = route.slice(0, i + 1).concat(inner).concat(route.slice(j));
          // ③ 迂回路をあけて、輪っかが残らないように迷路を組み直す
          rewireAsTree(maze, newRoute, detourKeys);
          maze.routes = [M.makeRoute(newRoute)];
          if (checkLengthened(maze, newRoute) && accept(maze, newRoute)) {
            return { ok: true, route: newRoute, gain: newRoute.length - route.length, moved: moving.length };
          }
        }
      }
      maze.walls = JSON.parse(backupWalls);
      maze.elements = JSON.parse(backupEls);
      maze.routes = JSON.parse(backupRoutes);
      if (done) break;
    }
    return { ok: false, reason: '遠回りにできる場所が見つかりませんでした。迷路を大きくするか、まわりの文字を減らしてみてください' };
  }

  /**
   * 迂回路をあけたあと、迷路を「輪っかの無い形」に作り直す。
   *
   * 迂回路をあけただけだと、あちこちにぐるっと回れる道ができてしまう。
   * そこで、新しいルートの通路を最優先で残しながら全域木を組み直し、
   * 余った通路には壁を立てる。こうすると
   *   ・新しいルートが「たった1本の道」になる
   *   ・どのマスにも行ける（孤立しない）
   *   ・しかけに使っている色つきの壁は閉じたまま
   * が同時に守れる。
   */
  function rewireAsTree(maze, newRoute, extraOpen) {
    const n = maze.rows * maze.cols;
    const idx = function (r, c) { return r * maze.cols + c; };
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = function (x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = function (a, b) { const ra = find(a), rb = find(b); if (ra === rb) return false; parent[ra] = rb; return true; };

    // いま通れる辺をぜんぶ集める（＋今回あけた迂回路の辺）
    const open = {};
    for (let r = 0; r < maze.rows; r++) for (let c = 0; c < maze.cols; c++) {
      [[0, 1], [1, 0]].forEach(function (d) {
        const nr = r + d[0], nc = c + d[1];
        if (!M.inside(maze, nr, nc)) return;
        const key = M.edgeBetween(r, c, nr, nc);
        if (!maze.walls[key]) open[key] = true;
      });
    }
    (extraOpen || []).forEach(function (k) { open[k] = true; });

    // ① 新しいルートの通路を最優先で残す
    const keep = {};
    for (let i = 0; i + 1 < newRoute.length; i++) {
      const key = M.edgeBetween(newRoute[i].r, newRoute[i].c, newRoute[i + 1].r, newRoute[i + 1].c);
      keep[key] = true;
      union(idx(newRoute[i].r, newRoute[i].c), idx(newRoute[i + 1].r, newRoute[i + 1].c));
    }
    // ② 残りは、輪っかにならないものだけ残す
    const rest = shuffle(Object.keys(open).filter(function (k) { return !keep[k]; }));
    rest.forEach(function (key) {
      const e = M.edgeCells(key);
      if (!M.inside(maze, e.a.r, e.a.c) || !M.inside(maze, e.b.r, e.b.c)) return;
      if (union(idx(e.a.r, e.a.c), idx(e.b.r, e.b.c))) keep[key] = true;
    });
    // ③ 残さなかった通路には壁を立てる
    Object.keys(open).forEach(function (key) {
      if (!keep[key]) maze.walls[key] = M.makeWall('black');
    });
    Object.keys(keep).forEach(function (key) { delete maze.walls[key]; });
  }

  /** 遠回りにしたあとの迷路が、謎として成立しているか */
  function checkLengthened(maze, newRoute) {
    const res = MZ.engine.solve(maze, { useAvoid: true });
    if (!res.ok || res.count !== 1) return false;
    if (!MZ.engine.samePath(res.path, newRoute)) return false;
    if (MZ.engine.retracesEdge(res.path)) return false;
    if (MZ.engine.routeMargin(maze, res.path).margin < MZ.engine.MARGIN_GOOD) return false;
    // どのマスにも行けること（ぽつんと孤立した場所を作らない）
    const reach = MZ.engine.reachableCount(maze, maze.starts[0], { useAvoid: false });
    return reach === maze.rows * maze.cols;
  }

  /**
   * from から to まで、ルート外・文字なしの空きマスを通る遠回りの道をさがす。
   * 壁は無視してよい（あとで開けるため）。
   */
  function findDetour(maze, from, to, onRoute, hasLetter, minLen) {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const path = [{ r: from.r, c: from.c }];
    const used = {};
    used[M.cellKey(from.r, from.c)] = true;
    const maxSteps = maze.rows * maze.cols * 8;

    for (let step = 0; step < maxSteps; step++) {
      const cur = path[path.length - 1];
      if (cur.r === to.r && cur.c === to.c) {
        return path.length >= minLen ? path : null;
      }
      let opts = [];
      dirs.forEach(function (d) {
        const nr = cur.r + d[0], nc = cur.c + d[1];
        if (!M.inside(maze, nr, nc)) return;
        const k = M.cellKey(nr, nc);
        if (used[k]) return;
        const isGoalCell = (nr === to.r && nc === to.c);
        if (!isGoalCell && (onRoute[k] || hasLetter[k])) return;   // 途中は空きマスだけ
        opts.push({ r: nr, c: nc });
      });
      if (path.length < minLen) {
        const away = opts.filter(function (p) { return !(p.r === to.r && p.c === to.c); });
        if (away.length) opts = away;
      } else {
        const near = opts.filter(function (p) {
          return Math.abs(p.r - to.r) + Math.abs(p.c - to.c) <
                 Math.abs(cur.r - to.r) + Math.abs(cur.c - to.c);
        });
        if (near.length && Math.random() < 0.8) opts = near;
      }
      if (!opts.length) {
        const dead = path.pop();
        if (!path.length) return null;
        delete used[M.cellKey(dead.r, dead.c)];
        continue;
      }
      const nxt = opts[Math.floor(Math.random() * opts.length)];
      path.push(nxt);
      used[M.cellKey(nxt.r, nxt.c)] = true;
    }
    return null;
  }

  return {
    checkRoute: checkRoute,
    lengthenRoute: lengthenRoute,
    fromRoute: fromRoute,
    random: random,
    openRoute: openRoute,
    carve: carve,
    addLoops: addLoops,
    makeProbe: makeProbe,
    routeIsUniqueShortest: routeIsUniqueShortest,
    routeIsClearlyShortest: routeIsClearlyShortest
  };
})();
