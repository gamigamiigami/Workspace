/* ===========================================================================
 * packages.js — 「謎の型」から迷路をまるごと自動で作る
 *
 * ★このファイルが第2弾の主役★
 *   これまでは「できた迷路に条件をあてると、どんな答えになるか」を見る道具だった。
 *   ここでは逆に「こういう謎にしたい」を先に決めて、
 *   その条件を全部満たす迷路のほうを作り出す。
 *
 * 作ったものは必ず MZ.steps.validateAll に通し、
 * 警告が1つでも出たら捨てて作り直す。だから出てきたものは必ず解ける。
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.packages = (function () {
  'use strict';
  const M = MZ.model, E = MZ.engine, G = MZ.generate, O = MZ.ops, ST = MZ.steps;

  /* まわりにまく文字の量 */
  const DENSITY = { few: 0.28, normal: 0.42, many: 0.60 };
  /* わき道（ぐるっと回れる道）の量。既定は「なし」＝道が1本しかない迷路 */
  const LOOPS = { none: 0, some: 0.12, many: 0.32 };

  const BUILD_TRIES = 40;     // 条件を満たすまで作り直す回数
  const CORNER_TRIES = 20;    // 「左上→右下」で長さが足りるかを試す回数（超えたらおまかせに切りかえ）

  /* =======================================================================
   * 型の登録所
   * ===================================================================== */
  const registry = {};
  const order = [];
  function register(def) { registry[def.id] = def; order.push(def.id); return def; }
  function list() { return order.map(function (id) { return registry[id]; }); }
  function get(id) { return registry[id]; }

  function defaults(recipe) {
    const r = Object.assign({
      rows: 12, cols: 12, density: 'normal', sg: 'corners', loops: 'none', texts: {}
    }, recipe || {});
    r.rows = clamp(r.rows, 6, 20);
    r.cols = clamp(r.cols, 6, 20);
    return r;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, isNaN(+v) ? a : +v)); }
  function letters(text) { return Array.from(String(text || '')).filter(function (c) { return !/\s/.test(c); }); }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* =======================================================================
   * 1. 迷路の種をつくる
   *    ・完全迷路（輪っかが無い）を掘る → どの2点も道は必ず1本
   *    ・文章がちょうど載る長さになるように GOAL を選ぶ
   *    ・わき道を足すときも「次に短い道と4マス以上ちがう」ものだけ採用
   * ===================================================================== */
  function seed(rc, minCells, tries) {
    tries = tries || 30;
    for (let t = 0; t < tries; t++) {
      const maze = M.createMaze(rc.rows, rc.cols);
      const start = { r: 0, c: 0 };
      const goal = pickGoalCell(rc, maze, t);
      const route = randomPath(maze, start, goal, minCells);
      if (!route) continue;

      // 「この道が正解になる迷路」を作る（v1からある仕組みをそのまま使う）
      const gen = G.fromRoute(maze, route, { branchiness: LOOPS[rc.loops] || 0 });
      if (!gen.ok || !gen.unique) continue;
      maze.walls = gen.walls;
      maze.starts = [M.makeStart(start.r, start.c)];
      maze.goals = [M.makeGoal(goal.r, goal.c)];

      const chk = E.solve(maze, {});
      if (!chk.ok || chk.count !== 1 || !E.samePath(chk.path, route)) continue;
      if (E.routeMargin(maze, route).margin < E.MARGIN_GOOD) continue;

      maze.routes = [M.makeRoute(route)];
      return { maze: maze, route: route };
    }
    return null;
  }

  /** GOALのマスを決める。STARTから遠いふちのマスにする */
  function pickGoalCell(rc, maze, attempt) {
    const rows = maze.rows, cols = maze.cols;
    if (rc.sg === 'corners' || attempt < 3) return { r: rows - 1, c: cols - 1 };
    const cands = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      if (!(r === 0 || r === rows - 1 || c === 0 || c === cols - 1)) continue;
      if (r + c < Math.round((rows + cols) / 2)) continue;    // STARTに近すぎるマスは使わない
      cands.push({ r: r, c: c });
    }
    return cands.length ? pick(cands) : { r: rows - 1, c: cols - 1 };
  }

  /**
   * ぐねぐね曲がった一本道をつくる（同じマスは2回通らない）
   *
   * まっすぐな道だと「消すと近道になる壁」も「文字を置く場所」も足りない。
   * わざと遠回りさせることで、謎に使える道になる。
   * 行き止まりに入ったら1歩もどってやり直す。
   */
  function randomPath(maze, start, goal, minCells) {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const path = [{ r: start.r, c: start.c }];
    const used = {};
    used[M.cellKey(start.r, start.c)] = true;
    const maxSteps = maze.rows * maze.cols * 30;

    for (let step = 0; step < maxSteps; step++) {
      const cur = path[path.length - 1];
      const atGoal = (cur.r === goal.r && cur.c === goal.c);
      if (atGoal && path.length >= minCells) return path;

      let opts = [];
      dirs.forEach(function (d) {
        const nr = cur.r + d[0], nc = cur.c + d[1];
        if (!M.inside(maze, nr, nc)) return;
        if (used[M.cellKey(nr, nc)]) return;
        opts.push({ r: nr, c: nc });
      });
      // まだ短いうちは GOAL に入らない（長さをかせぐため）
      if (path.length < minCells) {
        const away = opts.filter(function (p) { return !(p.r === goal.r && p.c === goal.c); });
        if (away.length) opts = away;
      } else {
        // 長さが足りたら GOAL のほうへ寄せる
        const near = opts.filter(function (p) {
          return Math.abs(p.r - goal.r) + Math.abs(p.c - goal.c) <
                 Math.abs(cur.r - goal.r) + Math.abs(cur.c - goal.c);
        });
        if (near.length && Math.random() < 0.75) opts = near;
      }

      if (!opts.length) {                       // 行き止まり → 1歩もどる
        const dead = path.pop();
        if (!path.length) return null;
        delete used[M.cellKey(dead.r, dead.c)];
        continue;
      }
      const nxt = pick(opts);
      path.push(nxt);
      used[M.cellKey(nxt.r, nxt.c)] = true;
    }
    return null;
  }

  /* =======================================================================
   * 2. 文字を置く道具
   * ===================================================================== */

  /** 通ったマスを、重複なしの並びにする */
  function uniqueCells(path) {
    const out = [], seen = {};
    (path || []).forEach(function (p) {
      const k = M.cellKey(p.r, p.c);
      if (seen[k]) return;
      seen[k] = true; out.push({ r: p.r, c: p.c });
    });
    return out;
  }

  /** まだ何も置かれていないマスだけを使って、文章を等間隔に置く */
  function placeOnFree(maze, path, text, color) {
    const chs = letters(text);
    if (!chs.length) return false;
    const cells = uniqueCells(path);
    const occupied = {};
    maze.elements.forEach(function (e) { occupied[M.cellKey(e.r, e.c)] = true; });
    const free = [];
    cells.forEach(function (p, i) { if (!occupied[M.cellKey(p.r, p.c)]) free.push(i); });
    if (free.length < chs.length) return false;

    // 等間隔に選び、かぶったら次の空きへずらす
    const used = {}, picked = [];
    for (let i = 0; i < chs.length; i++) {
      const want = free[chs.length === 1 ? 0 : Math.round(i * (free.length - 1) / (chs.length - 1))];
      let j = free.indexOf(want);
      while (j < free.length && used[free[j]]) j++;
      if (j >= free.length) {
        // 後ろが尽きたら前から空きを探す
        j = 0;
        while (j < free.length && used[free[j]]) j++;
        if (j >= free.length) return false;
      }
      used[free[j]] = true;
      picked.push(free[j]);
    }
    picked.sort(function (a, b) { return a - b; });
    const res = O.autoPlaceText(maze, cells, chs.join(''), {
      mode: 'picked', pickedIndices: picked, color: color, overwrite: false
    });
    return !!res.ok;
  }

  /** 通り道の空きマスに、まぎらわしい文字を置く（本命を目立たせないため） */
  function fillGaps(maze, paths, color, ratio, pool) {
    const occupied = {};
    maze.elements.forEach(function (e) { occupied[M.cellKey(e.r, e.c)] = true; });
    const free = [];
    paths.forEach(function (path) {
      uniqueCells(path).forEach(function (p) {
        const k = M.cellKey(p.r, p.c);
        if (occupied[k]) return;
        occupied[k] = true;
        free.push(p);
      });
    });
    shuffle(free);
    const n = Math.round(free.length * ratio);
    const src = (pool && pool.length) ? pool : O.POOLS.hiragana;
    for (let i = 0; i < n; i++) {
      maze.elements.push(M.makeElement(free[i].r, free[i].c, pick(src), { color: color }));
    }
  }

  /** 通り道の外にダミーをまく */
  function scatterOutside(maze, paths, rc, colors) {
    let all = [];
    paths.forEach(function (p) { all = all.concat(p || []); });
    O.scatterDummies(maze, all, {
      density: DENSITY[rc.density] !== undefined ? DENSITY[rc.density] : DENSITY.normal,
      colors: colors
    });
  }

  /** 置いてある文字を、まぎらわし用の文字プールにする */
  function poolFrom(texts) {
    const set = {}, out = [];
    texts.forEach(function (t) {
      letters(t).forEach(function (ch) { if (!set[ch]) { set[ch] = true; out.push(ch); } });
    });
    return out.length >= 4 ? out : O.POOLS.hiragana;
  }

  /* =======================================================================
   * 3. 仕上げ — 検証を通ったものだけ返す
   * ===================================================================== */
  function finish(maze, steps, expect, def, rc) {
    maze.meta.title = def.name;
    maze.meta.instruction = def.instruction(rc);
    const results = ST.runSteps(maze, steps);
    const answer = ST.finalText(results);
    if (answer !== expect) return null;
    const checks = ST.validateAll(maze, steps);
    if (checks.some(function (c) { return c.level !== 'ok'; })) return null;
    return { ok: true, maze: maze, steps: steps, answer: answer, checks: checks };
  }

  /** 何度でも作り直して、条件を満たすものが出るまでねばる */
  function build(recipe) {
    const rc = defaults(recipe);
    const def = get(rc.packageId);
    if (!def) return { ok: false, reason: 'その謎の型は見つかりません' };
    const need = def.check ? def.check(rc) : null;
    if (need) return { ok: false, reason: need };
    for (let t = 0; t < BUILD_TRIES; t++) {
      let out = null;
      try { out = def.make(rc); } catch (e) { out = null; }
      if (out) { out.tries = t + 1; return out; }
    }
    return { ok: false, reason: 'この条件では作れませんでした。文章を短くするか、盤面を大きくしてみてください' };
  }

  /** 文章がその盤面に入りきるか、あらかじめ見ておく */
  function lengthCheck(rc, texts, slack) {
    const need = texts.reduce(function (a, t) { return a + letters(t).length; }, 0);
    const room = rc.rows * rc.cols;
    if (!need) return '文章を入れてください';
    if (need + (slack || 0) > room * 0.6) {
      return '文章が長すぎます（' + need + '文字）。盤面を大きくするか、文章を短くしてください';
    }
    return null;
  }

  /* =======================================================================
   * 4. 謎の型（6つ）
   * ===================================================================== */

  /* ---------- ① ルートの文字を読む ---------- */
  register({
    id: 'read-route', emoji: '🔤', name: 'ルートの文字を読む',
    summary: '最短ルートを通って、通ったマスの文字を順に読む',
    level: 'やさしい',
    inputs: [{ k: 'msg1', label: 'こたえになる文章', example: 'まいにちがんばろう' }],
    instruction: function () {
      return 'STARTからGOALまで、いちばん短い道を通りましょう。通ったマスの文字を、順に読むとこたえになります。';
    },
    check: function (rc) { return lengthCheck(rc, [rc.texts.msg1], 0); },
    make: function (rc) {
      const msg = rc.texts.msg1;
      const s = seed(rc, letters(msg).length + 2);
      if (!s) return null;
      const maze = s.maze;
      if (!placeOnFree(maze, s.route, msg, 'black')) return null;
      scatterOutside(maze, [s.route], rc, ['black']);
      const steps = [
        ST.makeStep('solve', {}),
        ST.makeStep('extract', {}),
        ST.makeStep('answer', { expected: letters(msg).join('') })
      ];
      return finish(maze, steps, letters(msg).join(''), this, rc);
    }
  });

  /* ---------- ② 赤い文字だけ読む ---------- */
  register({
    id: 'read-red', emoji: '🔴', name: '赤い文字だけ読む',
    summary: '最短ルートを通って、通った道の赤い文字だけを読む',
    level: 'ふつう',
    inputs: [{ k: 'msg1', label: 'こたえになる文章', example: 'あかいもじをよめ' }],
    instruction: function () {
      return 'STARTからGOALまで、いちばん短い道を通りましょう。通った道にある赤い文字だけを、順に読むとこたえになります。';
    },
    check: function (rc) { return lengthCheck(rc, [rc.texts.msg1], 4); },
    make: function (rc) {
      const msg = rc.texts.msg1;
      const s = seed(rc, letters(msg).length + 4);
      if (!s) return null;
      const maze = s.maze;
      if (!placeOnFree(maze, s.route, msg, 'red')) return null;
      // 通り道の空きは黒でうめる（赤だけ読む、を成立させるため）
      fillGaps(maze, [s.route], 'black', 1, poolFrom([msg]));
      scatterOutside(maze, [s.route], rc, ['black', 'red', 'blue']);
      const steps = [
        ST.makeStep('solve', {}),
        ST.makeStep('extract', {}),
        ST.makeStep('filter-color', { mode: 'include', colors: ['red'] }),
        ST.makeStep('answer', { expected: letters(msg).join('') })
      ];
      return finish(maze, steps, letters(msg).join(''), this, rc);
    }
  });

  /* ---------- ③ 赤い線を消して2段階 ---------- */
  register({
    id: 'erase-red-wall', emoji: '✂️', name: '赤い線を消して2段階',
    summary: '赤い文字の指示どおり赤い線を消すと、道が変わってもう一度解ける',
    level: 'むずかしい',
    inputs: [
      { k: 'msg1', label: '1段めの指示（赤で置く）', example: 'あかいせんをけせ' },
      { k: 'msg2', label: '2段めのこたえ（青で置く）', example: 'よくできました' }
    ],
    instruction: function () {
      return '① STARTからGOALまで、いちばん短い道を通り、赤い文字だけを読みます。'
           + '② 書いてあるとおりにしてから、もう一度いちばん短い道を通り、青い文字だけを読むとこたえになります。';
    },
    check: function (rc) { return lengthCheck(rc, [rc.texts.msg1, rc.texts.msg2], 6); },
    make: function (rc) {
      const msg1 = rc.texts.msg1, msg2 = rc.texts.msg2;
      const n1 = letters(msg1).length, n2 = letters(msg2).length;
      // 2段階ぶんの文字が入るように、長めの道をつくる
      const s = seed(rc, n1 + n2 + 4);
      if (!s) return null;
      const maze = s.maze;

      // 「消すと近道になる壁」をさがす。
      // 道の上で となり合っているのに 道づたいだと遠い 2マスの間の壁が、それにあたる。
      const shortcut = pickShortcut(maze, s.route);
      if (!shortcut) return null;

      // 赤い線を消したあとの新しい道
      maze.walls[shortcut.key].disabled = true;
      const s2 = E.solve(maze, {});
      const ok2 = s2.ok && s2.count === 1 &&
                  E.routeMargin(maze, s2.path).margin >= E.MARGIN_GOOD &&
                  uniqueCells(s2.path).length >= n2 + 1;
      maze.walls[shortcut.key].disabled = false;
      if (!ok2) return null;

      // 2段めの文章を先に置く（あとから置くと場所が足りなくなるため）
      if (!placeOnFree(maze, s2.path, msg2, 'blue')) return null;
      // 1段めの指示は、残った空きマスに置く
      if (!placeOnFree(maze, s.route, msg1, 'red')) return null;

      // 本命の1本に、消しても答えが変わらない「おとりの赤い線」を足す
      const reds = paintRedWalls(maze, shortcut.key, s2.path, 3);

      fillGaps(maze, [s.route, s2.path], 'black', 1, poolFrom([msg1, msg2]));
      scatterOutside(maze, [s.route, s2.path], rc, ['black', 'red', 'blue']);

      const steps = [
        ST.makeStep('solve', {}),
        ST.makeStep('extract', {}),
        ST.makeStep('filter-color', { mode: 'include', colors: ['red'] }),
        ST.makeStep('remove-walls', { colors: ['red'] }),
        ST.makeStep('solve', {}),
        ST.makeStep('extract', {}),
        ST.makeStep('filter-color', { mode: 'include', colors: ['blue'] }),
        ST.makeStep('answer', { expected: letters(msg2).join('') })
      ];
      return finish(maze, steps, letters(msg2).join(''), this, rc);
    }
  });

  /**
   * 「消すと近道になる壁」をさがす。
   *
   * 迷路の道はぐねぐね曲がっているので、
   * 「となり合っているのに、道づたいだと遠回りしないと行けない2マス」がある。
   * そのあいだの壁を消せば、その遠回りをまるごと飛ばせる＝近道になる。
   * 飛ばせる長さ（gain）が4マス以上あるものだけを使う。
   */
  function pickShortcut(maze, route) {
    const at = {};
    route.forEach(function (p, i) { at[M.cellKey(p.r, p.c)] = i; });
    const found = [];
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    route.forEach(function (p, i) {
      dirs.forEach(function (d) {
        const nr = p.r + d[0], nc = p.c + d[1];
        if (!M.inside(maze, nr, nc)) return;
        const j = at[M.cellKey(nr, nc)];
        if (j === undefined || j - i < E.MARGIN_GOOD + 1) return;   // 近すぎる
        const key = M.edgeBetween(p.r, p.c, nr, nc);
        if (!maze.walls[key]) return;                                // すでに通れる
        found.push({ key: key, gain: (j - i) - 1 });
      });
    });
    if (!found.length) return null;
    found.sort(function (a, b) { return b.gain - a.gain; });
    return pick(found.slice(0, Math.min(3, found.length)));
  }

  /**
   * 本命の赤い線に、「消しても答えが変わらないおとり」を足す。
   * 赤い線が1本だけだと、どこを消せばいいか丸わかりになってしまうため。
   */
  function paintRedWalls(maze, realKey, expectPath, decoys) {
    const chosen = [realKey];
    const keys = shuffle(Object.keys(maze.walls).filter(function (k) {
      return k !== realKey && !M.isBorderKey(maze, k);
    }));
    for (let i = 0; i < keys.length && chosen.length < 1 + decoys; i++) {
      const cand = chosen.concat([keys[i]]);
      cand.forEach(function (k) { maze.walls[k].disabled = true; });
      const res = E.solve(maze, {});
      const same = res.ok && res.count === 1 && E.samePath(res.path, expectPath) &&
                   E.routeMargin(maze, res.path).margin >= E.MARGIN_GOOD;
      cand.forEach(function (k) { maze.walls[k].disabled = false; });
      if (same) chosen.push(keys[i]);
    }
    chosen.forEach(function (k) { maze.walls[k].color = 'red'; });
    return chosen;
  }

  /* ---------- ④ ○を全部通ってから読む ---------- */
  register({
    id: 'visit-circles', emoji: '⭕', name: '○を全部通ってから読む',
    summary: '○のマスを全部通りながらGOALへ。通ったマスの文字を順に読む',
    level: 'ふつう',
    inputs: [{ k: 'msg1', label: 'こたえになる文章', example: 'まるをすべてとおれ' }],
    instruction: function () {
      return '○のマスを全部通って、GOALまでいちばん短く進みましょう。通ったマスの文字を、順に読むとこたえになります。';
    },
    check: function (rc) { return lengthCheck(rc, [rc.texts.msg1], 4); },
    make: function (rc) {
      const msg = rc.texts.msg1;
      const need = letters(msg).length;
      // ○の分の遠回りで道は長くなるので、まっすぐの道は短めでよい
      const s = seed(rc, Math.max(5, Math.round(need * 0.6)));
      if (!s) return null;
      const maze = s.maze;
      const onRoute = {};
      s.route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });

      // ルートから外れたマスを○の候補にする
      const cands = [];
      for (let r = 0; r < maze.rows; r++) for (let c = 0; c < maze.cols; c++) {
        if (onRoute[M.cellKey(r, c)]) continue;
        cands.push({ r: r, c: c });
      }
      if (cands.length < 2) return null;
      shuffle(cands);

      const nCircle = 2 + Math.floor(Math.random() * 2);   // 2〜3個
      const spots = cands.slice(0, nCircle);
      spots.forEach(function (p) {
        maze.elements.push(M.makeElement(p.r, p.c, '○', { role: 'must', color: 'black' }));
      });

      const res = E.solve(maze, { useMust: true });
      if (!res.ok || res.count !== 1) return null;
      // ○のマスは記号でふさがっているので、文章はそれ以外の空きマスに入る必要がある
      const cells = uniqueCells(res.path);
      if (cells.length < need + nCircle + 1) return null;

      maze.routes = [M.makeRoute(res.path)];
      if (!placeOnFree(maze, res.path, msg, 'black')) return null;
      scatterOutside(maze, [res.path], rc, ['black']);

      const steps = [
        ST.makeStep('solve', { useMust: true }),
        // ○の記号そのものは読まない（文字と数字だけ拾う）
        ST.makeStep('extract', { kinds: ['text', 'number'] }),
        ST.makeStep('answer', { expected: letters(msg).join('') })
      ];
      return finish(maze, steps, letters(msg).join(''), this, rc);
    }
  });

  /* ---------- ⑤ ×を避けて進む ---------- */
  register({
    id: 'avoid-cross', emoji: '❌', name: '×を避けて進む',
    summary: '×のマスを通らずにGOALへ。通ったマスの文字を順に読む',
    level: 'ふつう',
    inputs: [{ k: 'msg1', label: 'こたえになる文章', example: 'ばつをさけてすすめ' }],
    instruction: function () {
      return '×のマスを通らずに、GOALまでいちばん短く進みましょう。通ったマスの文字を、順に読むとこたえになります。';
    },
    check: function (rc) { return lengthCheck(rc, [rc.texts.msg1], 4); },
    make: function (rc) {
      const msg = rc.texts.msg1;
      const need = letters(msg).length;
      const s = seed(Object.assign({}, rc, { loops: 'none' }), need + 2);
      if (!s) return null;
      const maze = s.maze;

      // ×でふさいでも進めるように、まわり道を1本ずつ足していく。
      // 一気にたくさん作ると迷路が開けすぎて「同じ長さの道が何本も」になってしまう。
      const inner = s.route.slice(1, s.route.length - 1);
      if (inner.length < 3) return null;
      let placed = null;
      for (let round = 0; round < 6 && !placed; round++) {
        if (!addOneBypass(maze, s.route)) break;
        placed = findCrossSpot(maze, inner, need);
      }
      if (!placed) return null;

      maze.routes = [M.makeRoute(placed.path)];
      if (!placeOnFree(maze, placed.path, msg, 'black')) return null;
      scatterOutside(maze, [placed.path], rc, ['black']);

      const steps = [
        ST.makeStep('solve', {}),
        ST.makeStep('extract', {}),
        ST.makeStep('answer', { expected: letters(msg).join('') })
      ];
      return finish(maze, steps, letters(msg).join(''), this, rc);
    }
  });

  /**
   * まわり道を1本だけ足す（正解ルートが1本の最短のままであることは守る）
   * ×でふさいでも進めるようにするために使う
   */
  function addOneBypass(maze, route) {
    const keys = shuffle(Object.keys(maze.walls).filter(function (k) { return !M.isBorderKey(maze, k); }));
    for (let i = 0; i < keys.length; i++) {
      const saved = maze.walls[keys[i]];
      delete maze.walls[keys[i]];
      if (G.routeIsUniqueShortest(maze, maze.walls, route)) return true;
      maze.walls[keys[i]] = saved;
    }
    return false;
  }

  /** ×を置ける場所をさがす。置いたあとの道が「1本だけ・差4以上」になる所だけ採る */
  function findCrossSpot(maze, inner, need) {
    const spots = shuffle(inner.slice());
    for (let i = 0; i < spots.length; i++) {
      const p = spots[i];
      const el = M.makeElement(p.r, p.c, '×', { role: 'avoid', color: 'black' });
      maze.elements.push(el);
      const res = E.solve(maze, { useAvoid: true });
      const good = res.ok && res.count === 1 &&
                   E.routeMargin(maze, res.path, { useAvoid: true }).margin >= E.MARGIN_GOOD &&
                   uniqueCells(res.path).length >= need + 1;
      if (good) return res;
      maze.elements = maze.elements.filter(function (x) { return x.id !== el.id; });
    }
    return null;
  }

  /* ---------- ⑥ STARTが変わる2段階 ---------- */
  register({
    id: 'move-start', emoji: '⭐', name: 'STARTが変わる2段階',
    summary: '赤い文字の指示で、赤い★から出発しなおしてもう一度解く',
    level: 'むずかしい',
    inputs: [
      { k: 'msg1', label: '1段めの指示（赤で置く）', example: 'あかいほしからあおをよめ' },
      { k: 'msg2', label: '2段めのこたえ（青で置く）', example: 'なぞがとけた' }
    ],
    instruction: function () {
      return '① STARTからGOALまで、いちばん短い道を通り、赤い文字だけを読みます。'
           + '② 書いてあるとおりにしてから、もう一度いちばん短い道を通り、青い文字だけを読むとこたえになります。';
    },
    check: function (rc) { return lengthCheck(rc, [rc.texts.msg1, rc.texts.msg2], 6); },
    make: function (rc) {
      const msg1 = rc.texts.msg1, msg2 = rc.texts.msg2;
      const need2 = letters(msg2).length;
      const s = seed(rc, letters(msg1).length + 3);
      if (!s) return null;
      const maze = s.maze;
      if (!placeOnFree(maze, s.route, msg1, 'red')) return null;

      const onRoute = {};
      s.route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
      const goal = maze.goals[0];

      // ★を置ける場所（そこからGOALまでの道が1本だけ・差も十分・文章が載る長さ）
      const cands = [];
      for (let r = 0; r < maze.rows; r++) for (let c = 0; c < maze.cols; c++) {
        if (onRoute[M.cellKey(r, c)]) continue;
        cands.push({ r: r, c: c });
      }
      shuffle(cands);
      let star = null, route2 = null;
      for (let i = 0; i < cands.length && i < 40; i++) {
        const p = cands[i];
        const res = E.solve(maze, { start: p, goal: { r: goal.r, c: goal.c } });
        if (!res.ok || res.count !== 1) continue;
        if (E.routeMargin(maze, res.path).margin < E.MARGIN_GOOD) continue;
        // ★のマスには★を置くので、文章はそれ以外の空きマスに入る必要がある
        const free = uniqueCells(res.path).filter(function (q) {
          if (q.r === p.r && q.c === p.c) return false;
          return !maze.elements.some(function (e) { return e.r === q.r && e.c === q.c; });
        });
        if (free.length < need2) continue;
        star = p; route2 = res.path; break;
      }
      if (!star) return null;

      maze.elements.push(M.makeElement(star.r, star.c, '★', { color: 'red' }));
      if (!placeOnFree(maze, route2, msg2, 'blue')) return null;
      fillGaps(maze, [s.route, route2], 'black', 1, poolFrom([msg1, msg2]));
      scatterOutside(maze, [s.route, route2], rc, ['black', 'red', 'blue']);

      const steps = [
        ST.makeStep('solve', {}),
        ST.makeStep('extract', {}),
        ST.makeStep('filter-color', { mode: 'include', colors: ['red'] }),
        ST.makeStep('set-start', { symbol: '★', symbolColor: 'red' }),
        ST.makeStep('solve', {}),
        ST.makeStep('extract', {}),
        ST.makeStep('filter-color', { mode: 'include', colors: ['blue'] }),
        ST.makeStep('answer', { expected: letters(msg2).join('') })
      ];
      return finish(maze, steps, letters(msg2).join(''), this, rc);
    }
  });

  return {
    register: register, list: list, get: get, build: build,
    seed: seed, DENSITY: DENSITY, LOOPS: LOOPS, letters: letters,
    placeOnFree: placeOnFree, fillGaps: fillGaps, scatterOutside: scatterOutside
  };
})();
