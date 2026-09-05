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
    const seen = {};
    for (let i = 0; i < cells.length; i++) {
      const p = cells[i];
      if (!M.inside(maze, p.r, p.c)) return { ok: false, reason: 'ルートが盤面の外に出ています' };
      const k = M.cellKey(p.r, p.c);
      if (seen[k]) return { ok: false, reason: '同じマスを2回通っています。ルートは枝分かれ・交差しない一本道にしてください' };
      seen[k] = true;
      if (i > 0) {
        const q = cells[i - 1];
        if (Math.abs(p.r - q.r) + Math.abs(p.c - q.c) !== 1) {
          return { ok: false, reason: 'ルートがとぎれています。となり合ったマスでつないでください' };
        }
      }
    }
    return { ok: true };
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

  return {
    checkRoute: checkRoute,
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
