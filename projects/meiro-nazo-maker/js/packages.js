/* ===========================================================================
 * packages.js — 「しかけ」を組み合わせて、迷路をまるごと自動で作る
 *
 * ★考え方★
 *   「最短ルートを通る」は謎の土台なので、選ぶものではなく always ON。
 *   そのうえに「しかけ」を好きな数だけ重ねる。
 *
 *     赤い文字だけ読む            → 1段の謎
 *     赤い文字だけ読む ＋ 線を消す → 2段の謎
 *     ＋ STARTが変わる            → 3段の謎
 *
 *   段が増えるごとに、その段の文字の色が 赤 → 青 → 緑 → 紫 と変わる。
 *
 * 作ったものは必ず MZ.steps.validateAll に通し、
 * 警告が1つでも出たら捨てて作り直す。だから出てきたものは必ず解ける。
 * ======================================================================== */
window.MZ = window.MZ || {};

MZ.packages = (function () {
  'use strict';
  const M = MZ.model, E = MZ.engine, G = MZ.generate, O = MZ.ops, ST = MZ.steps;

  /* まわりにまく文字の量（第3弾で1段階ずつ減らした） */
  const DENSITY = { few: 0.15, normal: 0.28, many: 0.42 };
  /* わき道（ぐるっと回れる道）の量。既定は「なし」＝道が1本しかない迷路 */
  const LOOPS = { none: 0, some: 0.12, many: 0.32 };

  /* 段ごとの文字の色。1段め＝赤、2段め＝青、3段め＝緑、4段め＝紫 */
  const STAGE_COLORS = ['red', 'blue', 'green', 'purple'];
  const MAX_STAGES = STAGE_COLORS.length;

  const BUILD_TRIES = 60;
  const CORNER_TRIES = 20;

  /** 色を「あかい」「みどりの」のような言い方にする */
  function colorAdj(c) {
    return { red: 'あかい', blue: 'あおい', yellow: 'きいろい',
             green: 'みどりの', purple: 'むらさきの', black: 'くろい' }[c] || 'その';
  }
  function colorLabel(c) { return M.COLORS[c] ? M.COLORS[c].label : c; }

  /* =======================================================================
   * しかけの部品（かんたん作成のカードになる）
   *   kind: 'read'  … 読み方を変える
   *         'solve' … 道の決まりを変える（全部の段にかかる）
   *         'stage' … 段を1つ増やす
   * ===================================================================== */
  const PARTS = [
    {
      id: 'read-color', kind: 'read', emoji: '🔴', name: '色でしぼって読む',
      summary: '通った道の「赤い文字だけ」を読みます。2回えらぶと 赤→青 と読み直す段が増えます',
      level: 'ふつう'
    },
    {
      id: 'must-circles', kind: 'solve', emoji: '⭕', name: '○を全部通る',
      summary: '○のマスを全部通ってからGOALへ。まっすぐではない道が正解になります',
      level: 'ふつう'
    },
    {
      id: 'avoid-cross', kind: 'solve', emoji: '❌', name: '×を通らない',
      summary: '×のマスを避けて進みます。まっすぐの道がふさがれます',
      level: 'ふつう'
    },
    {
      id: 'erase-wall', kind: 'stage', emoji: '✂️', name: '線を消して次の段へ',
      summary: '読んだ指示どおりに色つきの線を消すと道が変わり、もう一度解きます',
      level: 'むずかしい'
    },
    {
      id: 'move-start', kind: 'stage', emoji: '⭐', name: 'STARTが変わって次の段へ',
      summary: '読んだ指示どおりに★から出発しなおして、もう一度解きます',
      level: 'むずかしい'
    },
    {
      id: 'move-goal', kind: 'stage', emoji: '🎯', name: 'GOALが変わって次の段へ',
      summary: '読んだ指示どおりに☆を新しいGOALにして、もう一度解きます',
      level: 'むずかしい'
    }
  ];

  function part(id) { return PARTS.filter(function (p) { return p.id === id; })[0]; }

  /**
   * 選んだ部品を「段のつなぎ方」の並びに変える。
   * 同じ部品を何回でも選べる。
   *   ・段を足す部品は、選んだ回数だけ段が増える
   *   ・「色でしぼって読む」は、2回目からが段になる（同じ道を色を変えて読み直す）
   *   ・STARTを変える と GOALを変える がとなり合っていたら、1つにまとめて「ほしからほしへ」にする
   */
  function stageParts(parts) {
    const raw = [];
    let colorSeen = 0;
    (parts || []).forEach(function (id) {
      const p = part(id);
      if (!p) return;
      if (p.kind === 'stage') raw.push(id);
      else if (id === 'read-color') { colorSeen++; if (colorSeen > 1) raw.push('next-color'); }
    });
    // となり合った START変更 と GOAL変更 は1つにまとめる
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i], b = raw[i + 1];
      if ((a === 'move-start' && b === 'move-goal') || (a === 'move-goal' && b === 'move-start')) {
        out.push('move-both'); i++;
      } else out.push(a);
    }
    return out.slice(0, MAX_STAGES - 1);
  }
  function stageCount(parts) { return Math.min(MAX_STAGES, stageParts(parts).length + 1); }
  function usesColor(parts) { return (parts || []).indexOf('read-color') >= 0 || stageCount(parts) > 1; }

  /** その部品をあと何個えらべるか */
  function canAdd(parts, id) {
    const p = part(id);
    if (!p) return false;
    if (p.kind === 'solve') return (parts || []).indexOf(id) < 0;        // ○・×は1回だけ
    if (stageCount(parts) >= MAX_STAGES) {
      // 段が上限。ただし「色でしぼって読む」の1個目は段を増やさないので足せる
      if (id === 'read-color' && (parts || []).indexOf('read-color') < 0) return true;
      return false;
    }
    return true;
  }
  function countOf(parts, id) {
    return (parts || []).filter(function (x) { return x === id; }).length;
  }

  /** その段の文章の、はじめから入れておく例 */
  function defaultText(parts, i) {
    const st = stageParts(parts);
    const n = stageCount(parts);
    if (i === n - 1) return 'なぞがとけた';
    const kind = st[i];
    if (kind === 'erase-wall') return colorAdj(STAGE_COLORS[i]) + 'せんをけせ';
    if (kind === 'move-start') return 'ほしからやりなおし';
    if (kind === 'move-goal') return 'ほしまでいけ';
    if (kind === 'move-both') return 'ほしからほしへ';
    if (kind === 'next-color') return colorAdj(STAGE_COLORS[i + 1]) + 'もじだけよめ';
    return 'つぎへすすめ';
  }

  /** 問題用紙にのる「解く人がやること」 */
  function instruction(parts) {
    const st = stageParts(parts);
    const n = stageCount(parts);
    const color = usesColor(parts);
    const lines = [];
    const rule = [];
    if ((parts || []).indexOf('must-circles') >= 0) rule.push('○のマスを全部通り');
    if ((parts || []).indexOf('avoid-cross') >= 0) rule.push('×のマスは通らずに');
    const how = rule.length ? rule.join('、') + '、' : '';

    for (let i = 0; i < n; i++) {
      const head = (n > 1 ? '（' + (i + 1) + '） ' : '');
      const read = color ? colorLabel(STAGE_COLORS[i]) + 'い文字だけ' : '通ったマスの文字を';
      const prev = (i > 0) ? st[i - 1] : null;
      const from = (i === 0) ? 'STARTから'
        : (prev === 'next-color') ? '同じ道をもう一度たどり、'
        : (prev === 'move-goal') ? 'STARTから新しいGOALまで'
        : '新しいSTARTから';
      lines.push(head + from + how + 'GOALまでいちばん短く進み、' +
                 (color ? '通った道の' + colorLabel(STAGE_COLORS[i]) + '色の文字だけ' : '通ったマスの文字') +
                 'を順に読みます。');
      const nc = colorAdj(STAGE_COLORS[i + 1]);
      if (st[i] === 'erase-wall') lines.push('　→ 読めた指示どおりに、' + colorAdj(STAGE_COLORS[i]) + '線を消してください。');
      if (st[i] === 'move-start') lines.push('　→ 読めた指示どおりに、' + nc + '★から出発しなおしてください。');
      if (st[i] === 'move-goal') lines.push('　→ 読めた指示どおりに、' + nc + '☆を新しいGOALにしてください。');
      if (st[i] === 'move-both') lines.push('　→ 読めた指示どおりに、' + nc + '★から ' + nc + '☆まで進みなおしてください。');
      if (st[i] === 'next-color') lines.push('　→ 同じ道をもう一度たどり、今度は' + colorLabel(STAGE_COLORS[i + 1]) + '色の文字だけを読みます。');
    }
    lines.push('最後に読めた言葉がこたえです。');
    lines.push('※ 同じ通路を行って戻ることはありません（交差はします）。');
    return lines.join('');
  }

  /* =======================================================================
   * 共通の道具
   * ===================================================================== */
  function defaults(recipe) {
    const r = Object.assign({
      rows: 12, cols: 12, density: 'normal', sg: 'corners', loops: 'none', parts: [], texts: {}
    }, recipe || {});
    r.rows = clamp(r.rows, 6, 20);
    r.cols = clamp(r.cols, 6, 20);
    return r;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, isNaN(+v) ? a : +v)); }
  function letters(text) { return Array.from(String(text || '')).filter(function (c) { return !/\s/.test(c); }); }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function uniqueCells(path) {
    const out = [], seen = {};
    (path || []).forEach(function (p) {
      const k = M.cellKey(p.r, p.c);
      if (seen[k]) return;
      seen[k] = true; out.push({ r: p.r, c: p.c });
    });
    return out;
  }

  /* -----------------------------------------------------------------------
   * 迷路の種：ぐねぐね曲がった一本道を先に描き、その道が最短になる迷路を作る
   * --------------------------------------------------------------------- */
  function seed(rc, minCells, tries) {
    tries = tries || 30;
    for (let t = 0; t < tries; t++) {
      const maze = M.createMaze(rc.rows, rc.cols);
      const start = { r: 0, c: 0 };
      const goal = pickGoalCell(rc, maze, t);
      const route = randomPath(maze, start, goal, minCells);
      if (!route) continue;

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

  function pickGoalCell(rc, maze, attempt) {
    const rows = maze.rows, cols = maze.cols;
    if (rc.sg === 'corners' || attempt < 3) return { r: rows - 1, c: cols - 1 };
    const cands = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      if (!(r === 0 || r === rows - 1 || c === 0 || c === cols - 1)) continue;
      if (r + c < Math.round((rows + cols) / 2)) continue;
      cands.push({ r: r, c: c });
    }
    return cands.length ? pick(cands) : { r: rows - 1, c: cols - 1 };
  }

  /** ぐねぐね曲がった一本道をつくる（同じマスは2回通らない） */
  function randomPath(maze, start, goal, minCells) {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const path = [{ r: start.r, c: start.c }];
    const used = {};
    used[M.cellKey(start.r, start.c)] = true;
    const maxSteps = maze.rows * maze.cols * 30;

    for (let step = 0; step < maxSteps; step++) {
      const cur = path[path.length - 1];
      if (cur.r === goal.r && cur.c === goal.c && path.length >= minCells) return path;

      let opts = [];
      dirs.forEach(function (d) {
        const nr = cur.r + d[0], nc = cur.c + d[1];
        if (!M.inside(maze, nr, nc)) return;
        if (used[M.cellKey(nr, nc)]) return;
        opts.push({ r: nr, c: nc });
      });
      if (path.length < minCells) {
        const away = opts.filter(function (p) { return !(p.r === goal.r && p.c === goal.c); });
        if (away.length) opts = away;
      } else {
        const near = opts.filter(function (p) {
          return Math.abs(p.r - goal.r) + Math.abs(p.c - goal.c) <
                 Math.abs(cur.r - goal.r) + Math.abs(cur.c - goal.c);
        });
        if (near.length && Math.random() < 0.75) opts = near;
      }
      if (!opts.length) {
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

  /* -----------------------------------------------------------------------
   * 文字を置く
   * --------------------------------------------------------------------- */
  function placeOnFree(maze, path, text, color) {
    const chs = letters(text);
    if (!chs.length) return false;
    const cells = uniqueCells(path);
    const occupied = {};
    maze.elements.forEach(function (e) { occupied[M.cellKey(e.r, e.c)] = true; });
    const free = [];
    cells.forEach(function (p, i) { if (!occupied[M.cellKey(p.r, p.c)]) free.push(i); });
    if (free.length < chs.length) return false;

    const used = {}, picked = [];
    for (let i = 0; i < chs.length; i++) {
      const want = free[chs.length === 1 ? 0 : Math.round(i * (free.length - 1) / (chs.length - 1))];
      let j = free.indexOf(want);
      while (j < free.length && used[free[j]]) j++;
      if (j >= free.length) {
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

  function scatterOutside(maze, paths, rc, colors) {
    let all = [];
    paths.forEach(function (p) { all = all.concat(p || []); });
    O.scatterDummies(maze, all, {
      density: DENSITY[rc.density] !== undefined ? DENSITY[rc.density] : DENSITY.normal,
      colors: colors
    });
  }

  function poolFrom(texts) {
    const set = {}, out = [];
    texts.forEach(function (t) {
      letters(t).forEach(function (ch) { if (!set[ch]) { set[ch] = true; out.push(ch); } });
    });
    return out.length >= 4 ? out : O.POOLS.hiragana;
  }

  /* -----------------------------------------------------------------------
   * 道を変える部品
   * --------------------------------------------------------------------- */

  /** まわり道を1本だけ足す（正解ルートが1本の最短のままなのは守る） */
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

  /**
   * 「消すと近道になる壁」をさがす。
   * 道の上でとなり合っているのに、道づたいだと遠い2マスのあいだの壁がそれにあたる。
   */
  function pickShortcut(maze, route) { const l = listShortcuts(maze, route); return l.length ? pick(l.slice(0, 3)) : null; }

  /** 「消すと近道になる壁」を、良い順に全部あつめる */
  function listShortcuts(maze, route) {
    const at = {};
    route.forEach(function (p, i) { at[M.cellKey(p.r, p.c)] = i; });
    const found = [];
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    route.forEach(function (p, i) {
      dirs.forEach(function (d) {
        const nr = p.r + d[0], nc = p.c + d[1];
        if (!M.inside(maze, nr, nc)) return;
        const j = at[M.cellKey(nr, nc)];
        if (j === undefined || j - i < E.MARGIN_GOOD + 1) return;
        const key = M.edgeBetween(p.r, p.c, nr, nc);
        // すでに無い壁・すでに消してある壁は、消しても何も起きない
        if (!maze.walls[key] || maze.walls[key].disabled) return;
        found.push({ key: key, gain: (j - i) - 1 });
      });
    });
    found.sort(function (a, b) { return b.gain - a.gain; });
    return found;
  }

  /** 本命の線に、消しても答えが変わらない「おとりの線」を足す */
  function paintWalls(work, maze, realKey, expectPath, decoys, color) {
    const chosen = [realKey];
    const keys = shuffle(Object.keys(work.walls).filter(function (k) {
      return k !== realKey && !M.isBorderKey(work, k) && !work.walls[k].disabled;
    }));
    for (let i = 0; i < keys.length && chosen.length < 1 + decoys; i++) {
      const cand = chosen.concat([keys[i]]);
      cand.forEach(function (k) { work.walls[k].disabled = true; });
      const res = E.solve(work, {});
      const same = res.ok && res.count === 1 && E.samePath(res.path, expectPath) &&
                   E.routeMargin(work, res.path).margin >= E.MARGIN_GOOD;
      cand.forEach(function (k) { work.walls[k].disabled = false; });
      if (same) chosen.push(keys[i]);
    }
    chosen.forEach(function (k) {
      work.walls[k].color = color;
      if (maze.walls[k]) maze.walls[k].color = color;
    });
    return chosen;
  }

  /** 道すじが謎として成立しているか（1本だけ・差4以上・なぞり返しなし） */
  function routeIsGood(board, res, needCells) {
    if (!res || !res.ok || res.count !== 1) return false;
    if (E.retracesEdge(res.path)) return false;
    if (E.routeMargin(board, res.path, { useAvoid: true }).margin < E.MARGIN_GOOD) return false;
    if (needCells && uniqueCells(res.path).length < needCells) return false;
    return true;
  }

  /* =======================================================================
   * 組み立て本体
   * ===================================================================== */
  function makeOne(rc) {
    const parts = rc.parts || [];
    const st = stageParts(parts);
    const n = stageCount(parts);
    const color = usesColor(parts);
    const needMust = parts.indexOf('must-circles') >= 0;
    const needAvoid = parts.indexOf('avoid-cross') >= 0;
    const texts = [];
    for (let i = 0; i < n; i++) texts.push(letters(rc.texts['s' + (i + 1)] || '').join(''));

    /* ---- ① 種の迷路 ---- */
    const baseLoops = (needMust || needAvoid) ? 'none' : rc.loops;
    let need0 = texts[0].length;
    for (let j = 0; j < st.length && st[j] === 'next-color'; j++) need0 += texts[j + 1].length;
    // 「線を消して近道を作る」段は、道が長いほど作りやすい（近道になる壁が増える）
    const eraseCount = st.filter(function (k) { return k === 'erase-wall'; }).length;
    const minCells = need0 + (color ? 4 : 2) + eraseCount * 6;
    const s = seed(Object.assign({}, rc, { loops: baseLoops }), minCells);
    if (!s) return null;
    const maze = s.maze;
    const work = M.cloneBoard(maze);      // 段の変化を積み上げていく作業用の盤面

    /* ---- ② ○ / × を置いて、1段めの道を決める ---- */
    let route1 = s.route;
    if (needAvoid || needMust) {
      const built = buildConstrainedRoute(maze, work, s.route, needMust, needAvoid, texts[0].length + 2);
      if (!built) return null;
      route1 = built;
    }
    maze.routes = [M.makeRoute(route1)];

    /* ---- ③ 段を進める ---- */
    const routes = [route1];
    const solveOpts = { useMust: needMust, useAvoid: true };
    const transitions = [];
    for (let i = 0; i < st.length; i++) {
      // その段のあとに「色を変えて読み直す」段が続くなら、同じ道に文字がもっと要る
      let nextNeed = texts[i + 1].length;
      for (let j = i + 1; j < st.length && st[j] === 'next-color'; j++) nextNeed += texts[j + 1].length;
      nextNeed += 1;

      const nc = STAGE_COLORS[i + 1];
      let out = null;
      if (st[i] === 'erase-wall') out = doEraseWall(maze, work, routes[i], STAGE_COLORS[i], solveOpts, nextNeed);
      if (st[i] === 'move-start') out = doMoveStart(maze, work, routes[i], nc, solveOpts, nextNeed);
      if (st[i] === 'move-goal') out = doMoveGoal(maze, work, routes[i], nc, solveOpts, nextNeed);
      if (st[i] === 'move-both') out = doMoveBoth(maze, work, routes[i], nc, solveOpts, nextNeed);
      if (st[i] === 'next-color') {
        // 盤面は変えない。同じ道を、次の色でもう一度読むだけ
        out = { kind: 'next-color', color: nc, path: routes[i] };
      }
      if (!out) return null;
      transitions.push(out);
      routes.push(out.path);
    }

    /* ---- ④ 文字を置く（あとの段ほど空きが少ないので、うしろから置く） ---- */
    for (let i = n - 1; i >= 0; i--) {
      const c = color ? STAGE_COLORS[i] : 'black';
      if (!placeOnFree(maze, routes[i], texts[i], c)) return null;
    }

    /* ---- ⑤ まぎらわしい文字 ---- */
    if (color) {
      fillGaps(maze, routes, 'black', 1, poolFrom(texts));
      const outColors = ['black'].concat(STAGE_COLORS.slice(0, n));
      scatterOutside(maze, routes, rc, outColors);
    } else {
      // 全部読む謎では、道の上に余計な文字を置いてはいけない
      scatterOutside(maze, routes, rc, ['black']);
    }

    /* ---- ⑥ STEPを組む ---- */
    const steps = [];
    // 記号（○ × ★）は読み上げの対象にしない。
    // ★はSTARTの目印として道の上に乗るので、入れてしまうと答えに混ざる。
    const readKinds = ['text', 'number'];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const tr = transitions[i - 1];
        if (tr.kind === 'erase-wall') steps.push(ST.makeStep('remove-walls', { colors: [tr.color] }));
        if (tr.kind === 'move-start') steps.push(ST.makeStep('set-start', { symbol: '★', symbolColor: tr.color }));
        if (tr.kind === 'move-goal') steps.push(ST.makeStep('set-goal', { symbol: '☆', symbolColor: tr.color }));
        if (tr.kind === 'move-both') {
          steps.push(ST.makeStep('set-start', { symbol: '★', symbolColor: tr.color }));
          steps.push(ST.makeStep('set-goal', { symbol: '☆', symbolColor: tr.color }));
        }
        // next-color は盤面を変えないので、変換のSTEPは要らない
      }
      steps.push(ST.makeStep('solve', { useMust: needMust }));
      steps.push(ST.makeStep('extract', { kinds: readKinds }));
      if (color) steps.push(ST.makeStep('filter-color', { mode: 'include', colors: [STAGE_COLORS[i]] }));
    }
    steps.push(ST.makeStep('answer', { expected: texts[n - 1] }));

    /* ---- ⑦ 検証を通ったものだけ返す ---- */
    maze.meta.title = titleOf(parts);
    maze.meta.instruction = instruction(parts);
    const results = ST.runSteps(maze, steps);
    if (ST.finalText(results) !== texts[n - 1]) return null;
    const checks = ST.validateAll(maze, steps);
    if (checks.some(function (c) { return c.level !== 'ok'; })) return null;

    return { ok: true, maze: maze, steps: steps, answer: texts[n - 1], checks: checks, stages: n, routes: routes };
  }

  /** ○ / × を置いて、まっすぐではない道を正解にする */
  function buildConstrainedRoute(maze, work, route, needMust, needAvoid, needCells) {
    const inner = route.slice(1, route.length - 1);
    if (inner.length < 3) return null;

    for (let round = 0; round < 6; round++) {
      if (!addOneBypass(maze, route)) break;
      work.walls = M.cloneBoard(maze).walls;

      // ふさぐマスを1つ選ぶ → まわり道が正解になる
      const spots = shuffle(inner.slice());
      for (let i = 0; i < spots.length; i++) {
        const p = spots[i];
        if (needAvoid) {
          const el = M.makeElement(p.r, p.c, '×', { role: 'avoid', color: 'black' });
          maze.elements.push(el);
          const res = E.solve(maze, { useAvoid: true });
          if (routeIsGood(maze, res, needCells)) {
            if (needMust && !addCircles(maze, res.path, route)) {
              maze.elements = maze.elements.filter(function (x) { return x.id !== el.id; });
              continue;
            }
            const fin = E.solve(maze, { useMust: needMust, useAvoid: true });
            if (routeIsGood(maze, fin, needCells)) { work.walls = M.cloneBoard(maze).walls; return fin.path; }
          }
          maze.elements = maze.elements.filter(function (x) { return x.id !== el.id; });
        } else {
          // ○だけのとき：まわり道の上に○を置いて、そちらを通らせる
          const blocked = M.cloneBoard(maze);
          blocked.elements.push(M.makeElement(p.r, p.c, '×', { role: 'avoid' }));
          const alt = E.solve(blocked, { useAvoid: true });
          if (!alt.ok || E.retracesEdge(alt.path)) continue;
          if (!addCircles(maze, alt.path, route)) continue;
          const fin = E.solve(maze, { useMust: true, useAvoid: true });
          if (fin.ok && fin.count === 1 && !E.retracesEdge(fin.path) &&
              uniqueCells(fin.path).length >= needCells) {
            work.walls = M.cloneBoard(maze).walls;
            return fin.path;
          }
          maze.elements = maze.elements.filter(function (x) { return x.role !== 'must'; });
        }
      }
    }
    return null;
  }

  /** まわり道の上（もとの最短からは外れたマス）に○を置く */
  function addCircles(maze, altPath, baseRoute) {
    const onBase = {};
    baseRoute.forEach(function (p) { onBase[M.cellKey(p.r, p.c)] = true; });
    const cands = uniqueCells(altPath).filter(function (p) {
      if (onBase[M.cellKey(p.r, p.c)]) return false;
      return !maze.elements.some(function (e) { return e.r === p.r && e.c === p.c; });
    });
    if (cands.length < 2) return false;
    shuffle(cands);
    const nC = Math.min(cands.length, 2 + Math.floor(Math.random() * 2));
    for (let i = 0; i < nC; i++) {
      maze.elements.push(M.makeElement(cands[i].r, cands[i].c, '○', { role: 'must', color: 'black' }));
    }
    return true;
  }

  /** 線を消して次の段へ */
  function doEraseWall(maze, work, route, color, solveOpts, needCells) {
    // 近道になりそうな壁を、良い順にいくつも試す（1本だけ試すと作れないことが多い）
    const cands = listShortcuts(work, route).slice(0, 8);
    for (let i = 0; i < cands.length; i++) {
      const sc = cands[i];
      work.walls[sc.key].disabled = true;
      const res = E.solve(work, solveOpts);
      const good = routeIsGood(work, res, needCells);
      work.walls[sc.key].disabled = false;
      if (!good) continue;
      const keys = paintWalls(work, maze, sc.key, res.path, 3, color);
      keys.forEach(function (k) { work.walls[k].disabled = true; });
      return { kind: 'erase-wall', color: color, path: res.path, keys: keys };
    }
    return null;
  }

  /** STARTを★に変えて次の段へ */
  function doMoveStart(maze, work, route, color, solveOpts, needCells) {
    const onRoute = {};
    route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    const goal = work.goals[0];
    const cands = [];
    for (let r = 0; r < work.rows; r++) for (let c = 0; c < work.cols; c++) {
      if (onRoute[M.cellKey(r, c)]) continue;
      if (maze.elements.some(function (e) { return e.r === r && e.c === c; })) continue;
      cands.push({ r: r, c: c });
    }
    shuffle(cands);
    for (let i = 0; i < cands.length && i < 40; i++) {
      const p = cands[i];
      const res = E.solve(work, Object.assign({}, solveOpts, { start: p, goal: { r: goal.r, c: goal.c } }));
      if (!routeIsGood(work, res, needCells + 1)) continue;
      maze.elements.push(M.makeElement(p.r, p.c, '★', { color: color }));
      work.elements.push(M.makeElement(p.r, p.c, '★', { color: color }));
      work.starts = [M.makeStart(p.r, p.c)];
      return { kind: 'move-start', color: color, path: res.path, star: p };
    }
    return null;
  }

  /** GOALを■に変えて次の段へ */
  function doMoveGoal(maze, work, route, color, solveOpts, needCells) {
    const onRoute = {};
    route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    const start = work.starts[0];
    const cands = [];
    for (let r = 0; r < work.rows; r++) for (let c = 0; c < work.cols; c++) {
      if (onRoute[M.cellKey(r, c)]) continue;
      if (maze.elements.some(function (e) { return e.r === r && e.c === c; })) continue;
      cands.push({ r: r, c: c });
    }
    shuffle(cands);
    for (let i = 0; i < cands.length && i < 40; i++) {
      const p = cands[i];
      const res = E.solve(work, Object.assign({}, solveOpts, { start: { r: start.r, c: start.c }, goal: p }));
      if (!routeIsGood(work, res, needCells + 1)) continue;
      maze.elements.push(M.makeElement(p.r, p.c, '☆', { color: color }));
      work.elements.push(M.makeElement(p.r, p.c, '☆', { color: color }));
      work.goals = [M.makeGoal(p.r, p.c)];
      return { kind: 'move-goal', color: color, path: res.path, goal: p };
    }
    return null;
  }

  /** STARTもGOALも変えて次の段へ（★から☆へ） */
  function doMoveBoth(maze, work, route, color, solveOpts, needCells) {
    const onRoute = {};
    route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    const free = [];
    for (let r = 0; r < work.rows; r++) for (let c = 0; c < work.cols; c++) {
      if (onRoute[M.cellKey(r, c)]) continue;
      if (maze.elements.some(function (e) { return e.r === r && e.c === c; })) continue;
      free.push({ r: r, c: c });
    }
    shuffle(free);
    for (let i = 0; i < free.length && i < 30; i++) {
      for (let j = 0; j < free.length && j < 30; j++) {
        if (i === j) continue;
        const a = free[i], b = free[j];
        const res = E.solve(work, Object.assign({}, solveOpts, { start: a, goal: b }));
        if (!routeIsGood(work, res, needCells + 2)) continue;
        maze.elements.push(M.makeElement(a.r, a.c, '★', { color: color }));
        maze.elements.push(M.makeElement(b.r, b.c, '☆', { color: color }));
        work.elements.push(M.makeElement(a.r, a.c, '★', { color: color }));
        work.elements.push(M.makeElement(b.r, b.c, '☆', { color: color }));
        work.starts = [M.makeStart(a.r, a.c)];
        work.goals = [M.makeGoal(b.r, b.c)];
        return { kind: 'move-both', color: color, path: res.path, star: a, goal: b };
      }
    }
    return null;
  }

  function titleOf(parts) {
    const n = stageCount(parts);
    const seen = {}, names = [];
    (parts || []).forEach(function (id) {
      const p = part(id);
      if (!p) return;
      if (seen[id]) { seen[id]++; return; }
      seen[id] = 1; names.push(id);
    });
    const label = names.map(function (id) {
      return part(id).name + (seen[id] > 1 ? ' ×' + seen[id] : '');
    });
    if (!label.length) return '迷路謎（最短ルート）';
    return (n > 1 ? n + '段の迷路謎：' : '迷路謎：') + label.join(' ＋ ');
  }

  /* =======================================================================
   * 入口
   * ===================================================================== */
  function checkRecipe(rc) {
    const n = stageCount(rc.parts);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const t = letters(rc.texts['s' + (i + 1)] || '');
      if (!t.length) return (n > 1 ? (i + 1) + '段めの' : '') + '文章を入れてください';
      total += t.length;
    }
    const room = rc.rows * rc.cols;
    if (total + n * 3 > room * 0.55) {
      return '文章が長すぎます（合計' + total + '文字）。迷路を大きくするか、文章を短くしてください';
    }
    return null;
  }

  function build(recipe) {
    const rc = defaults(recipe);
    const bad = checkRecipe(rc);
    if (bad) return { ok: false, reason: bad };
    for (let t = 0; t < BUILD_TRIES; t++) {
      let out = null;
      try { out = makeOne(rc); } catch (e) { out = null; }
      if (out) { out.tries = t + 1; return out; }
    }
    return { ok: false, reason: 'この組み合わせでは作れませんでした。文章を短くするか、迷路を大きくするか、しかけを減らしてみてください' };
  }

  /* =======================================================================
   * 編集画面から使う：ねらった答えになるように置く
   *   rows = [{ path, color（null なら全部読む）, text }]
   *   空きマスの少ないルートから先に置く
   * ===================================================================== */
  function placeTargets(maze, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return { ok: false, reason: '行がありません' };
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].path || rows[i].path.length < 2) return { ok: false, reason: (i + 1) + '行めのルートが取れませんでした' };
      if (!letters(rows[i].text).length) return { ok: false, reason: (i + 1) + '行めの答えを入れてください' };
    }
    // 対象のルート上にある古い文字を片づける（記号やチェックポイントは残す）
    const onPath = {};
    rows.forEach(function (r) { uniqueCells(r.path).forEach(function (p) { onPath[M.cellKey(p.r, p.c)] = true; }); });
    maze.elements = maze.elements.filter(function (e) {
      if (e.role !== 'none') return true;
      return !onPath[M.cellKey(e.r, e.c)];
    });

    const order = rows.map(function (r, i) { return { r: r, i: i, n: uniqueCells(r.path).length }; })
                      .sort(function (a, b) { return a.n - b.n; });
    for (let k = 0; k < order.length; k++) {
      const row = order[k].r;
      if (!placeOnFree(maze, row.path, row.text, row.color || 'black')) {
        return { ok: false, reason: (order[k].i + 1) + '行め「' + row.text + '」を置く場所が足りません。迷路を大きくするか、文章を短くしてください' };
      }
    }
    // まぎらわしい文字（「全部読む」の行があるルートには置かない）
    const allReadPaths = rows.filter(function (r) { return !r.color; }).map(function (r) { return r.path; });
    const fillable = rows.filter(function (r) { return !!r.color; }).map(function (r) { return r.path; });
    if (opts.fill !== false && fillable.length) {
      const blocked = {};
      allReadPaths.forEach(function (p) { uniqueCells(p).forEach(function (q) { blocked[M.cellKey(q.r, q.c)] = true; }); });
      const safe = fillable.map(function (p) {
        return uniqueCells(p).filter(function (q) { return !blocked[M.cellKey(q.r, q.c)]; });
      });
      fillGaps(maze, safe, 'black', 1, poolFrom(rows.map(function (r) { return r.text; })));
    }
    return { ok: true, placed: rows.length };
  }

  return {
    PARTS: PARTS, part: part, stageParts: stageParts, stageCount: stageCount,
    canAdd: canAdd, countOf: countOf,
    usesColor: usesColor, defaultText: defaultText, instruction: instruction, titleOf: titleOf,
    STAGE_COLORS: STAGE_COLORS, MAX_STAGES: MAX_STAGES, DENSITY: DENSITY, LOOPS: LOOPS,
    build: build, checkRecipe: checkRecipe, seed: seed, letters: letters,
    placeOnFree: placeOnFree, fillGaps: fillGaps, scatterOutside: scatterOutside,
    placeTargets: placeTargets, uniqueCells: uniqueCells, colorAdj: colorAdj
  };
})();
