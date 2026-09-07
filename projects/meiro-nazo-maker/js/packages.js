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

  /* 段ごとの文字の色。1段め＝赤、2段め＝青、3段め＝黄、4段め＝緑、5段め＝紫。
   * 色は5つしか無いので、読み直す段が6つ以上続くとまた赤から使い回す
   * （そのぶん avoidSet は「直前の段」だけでなく「同じ色を使った段すべて」を見て、
   *   一周して同じ色に戻っても前の段の文字を拾わないようにしている）。 */
  const STAGE_COLORS = ['red', 'blue', 'yellow', 'green', 'purple'];
  /* 段の上限。STARTやGOALを変える段は色を使い回せるので、色の数より多く積める */
  const MAX_STAGES = 7;
  /* STARTやGOALが変わる段が2回め以降のときに使う目印セット（★☆の使い回しで
   * 見分けがつかなくなるのを防ぐ）。段は最大7つ＝STARTGOAL変更は最大6回なので、
   * 6セット用意して、同じ記号が2回使われることが無いようにする。 */
  const MARKER_SETS = [
    { start: '★', goal: '☆' },
    { start: '■', goal: '□' },
    { start: '▲', goal: '△' },
    { start: '◆', goal: '◇' },
    { start: '●', goal: '♪' },
    { start: '↑', goal: '→' }
  ];
  function markerFor(occurrence) { return MARKER_SETS[Math.min(occurrence, MARKER_SETS.length - 1)]; }

  /* 読む順番。'route'（通った順）が既定で、カードで選ぶとここから1つ使う */
  const ORDERS = [
    { key: 'reverse', label: 'うしろから', word: 'うしろから順に' },
    { key: 'lr',      label: '左 → 右',    word: '左にあるものから順に' },
    { key: 'rl',      label: '右 → 左',    word: '右にあるものから順に' },
    { key: 'tb',      label: '上 → 下',    word: '上にあるものから順に' },
    { key: 'bt',      label: '下 → 上',    word: '下にあるものから順に' }
  ];
  const ORDER_KEYS = ORDERS.map(function (o) { return o.key; });
  function orderWord(key) {
    const o = ORDERS.filter(function (x) { return x.key === key; })[0];
    return o ? o.word : '通った順に';
  }

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
      id: 'read-not-color', kind: 'read', emoji: '🚫', name: '色いがいを読む',
      summary: '「赤い文字いがいを読め」の言い方にします。2回えらぶと読み直す段が増えます',
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
    },
    {
      id: 'move-both', kind: 'stage', emoji: '🌟', name: 'STARTもGOALも変わって次の段へ',
      summary: '読んだ指示どおりに★から☆へ、出発点も終点も変えなおして、もう一度解きます',
      level: 'むずかしい'
    },
    {
      id: 'read-order', kind: 'order', emoji: '🔃', name: '読む順番を変える',
      summary: '通った順ではなく「うしろから」「左 → 右」などの順に読ませます',
      level: 'むずかしい',
      option: { key: 'read-order', label: '読む順', def: 'reverse', list: ORDERS }
    }
  ];

  function part(id) { return PARTS.filter(function (p) { return p.id === id; })[0]; }

  function isRead(id) { const p = part(id); return !!p && p.kind === 'read'; }
  function readIds(parts) { return (parts || []).filter(isRead); }

  /**
   * 選んだ部品を「段のつなぎ方」の並びに変える。
   * 同じ部品を何回でも選べる。
   *   ・段を足す部品は、選んだ回数だけ段が増える
   *   ・読み方の部品は、2回目からが段になる（同じ道を色を変えて読み直す）
   *   ・STARTを変える と GOALを変える がとなり合っていたら、1つにまとめて「ほしからほしへ」にする
   */
  function stageParts(parts) {
    const raw = [];
    let readSeen = 0;
    (parts || []).forEach(function (id) {
      const p = part(id);
      if (!p) return;
      if (p.kind === 'stage') raw.push(id);
      else if (p.kind === 'read') { readSeen++; if (readSeen > 1) raw.push('next-read'); }
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
  function usesColor(parts) { return readMode(parts) !== 'all'; }

  /**
   * 段ごとに「読む色」を割りあてる、既定のルール。
   *   ・「色を変えて読み直す（next-read）」のときは、次の色へ進む
   *     （赤→青→黄…と、あたらしい色で読み直したいので）。
   *   ・「STARTが変わる」「GOALが変わる」「STARTもGOALも変わる」は、
   *     新しい道は前の道と重ならない場所を選ぶ構造になっているので、
   *     同じ色のままでも紙の上で見分けがつかなくなる心配が無い。
   *     場面が切りかわる区切りとして、既定では赤にもどす
   *     （直前がすでに赤なら、それはそのまま「前の色を引き継ぐ」になる）。
   *   ・「線を消す（erase-wall）」だけは例外。近道は前の道の一部を
   *     かならず使いまわす構造になっている（そうでなければ「近道」にならない）ので、
   *     直前と同じ色のままだと前の段の文字と新しい段の文字が紙の上で見分けられない。
   *     このときだけ、直前がすでに赤なら次の色に進める。
   */
  function nextAutoColor(prevColor, kind) {
    const prevIdx = Math.max(0, STAGE_COLORS.indexOf(prevColor));
    if (kind === 'next-read') return STAGE_COLORS[Math.min(prevIdx + 1, STAGE_COLORS.length - 1)];
    if (kind === 'erase-wall' && prevIdx === 0) return STAGE_COLORS[Math.min(prevIdx + 1, STAGE_COLORS.length - 1)];
    return STAGE_COLORS[0];
  }
  /**
   * 段ごとの色。opts.stageColor[段番号] があれば、既定のルールより優先してそれを使う
   * （場面ごとに色を変えたいときの個別指定）。
   */
  function stageColors(parts, opts) {
    const st = stageParts(parts);
    const n = stageCount(parts);
    const override = (opts || {}).stageColor || {};
    function pick(i, auto) {
      const v = override[i];
      return (v && STAGE_COLORS.indexOf(v) >= 0) ? v : auto;
    }
    const out = [pick(0, STAGE_COLORS[0])];
    st.forEach(function (kind) {
      const i = out.length;
      out.push(pick(i, nextAutoColor(out[out.length - 1], kind)));
    });
    return out.slice(0, n);
  }

  /**
   * 読み方。
   *   'all'     … 通ったマスの文字をぜんぶ読む（しかけ無しの1段のときだけ）
   *   'include' … その段の色の文字「だけ」読む
   *   'exclude' … その段以外の色の文字を読まない＝「○色いがいを読め」の言い方
   * 「色でしぼって読む」と「色いがいを読む」は言い方が正反対なので、混ぜて選べないようにしている。
   */
  function readMode(parts) {
    const r = readIds(parts);
    if (r.length) return r[0] === 'read-not-color' ? 'exclude' : 'include';
    return stageCount(parts) > 1 ? 'include' : 'all';
  }

  /** 段 i で「読まない」色の一覧（exclude のときだけ使う）。同じ色の段が複数あっても重複させない */
  function excludeColors(i, parts, opts) {
    const sc = stageColors(parts, opts);
    if (sc.length <= 1) return [sc[0]];
    const seen = {}, out = [];
    sc.forEach(function (c) { if (c !== sc[i] && !seen[c]) { seen[c] = true; out.push(c); } });
    return out;
  }

  /** 段 i の文字の色（exclude で1段だけのときは、こたえを黒にしてまぎれを赤にする） */
  function answerColor(mode, i, parts, opts) {
    if (mode === 'all') return 'black';
    const ov = (opts || {}).stageColor || {};
    if (ov[i] && STAGE_COLORS.indexOf(ov[i]) >= 0) return ov[i];
    if (mode === 'exclude' && stageCount(parts) === 1) return 'black';
    return stageColors(parts, opts)[i];
  }
  /** ルートの上にまく「読まない文字」の色（null なら まかない） */
  function noiseColor(mode, parts, opts) {
    if (mode === 'include') return 'black';
    if (mode === 'exclude') return stageCount(parts) === 1 ? stageColors(parts, opts)[0] : null;
    return null;
  }

  /**
   * 読む順（'route' なら通った順のまま）。
   * opts.stageOrder[段番号] があれば、その段だけカードの設定より優先する
   * （「そのステップだけ右から」のような個別指定）。
   */
  function readOrder(parts, opts, i) {
    if ((parts || []).indexOf('read-order') < 0) return 'route';
    const o = opts || {};
    if (i !== undefined && o.stageOrder && ORDER_KEYS.indexOf(o.stageOrder[i]) >= 0) return o.stageOrder[i];
    const v = o['read-order'];
    return ORDER_KEYS.indexOf(v) >= 0 ? v : 'reverse';
  }

  /** その部品をあと1つ足せるか */
  function canAdd(parts, id) {
    const p = part(id);
    if (!p) return false;
    if (p.kind === 'solve' || p.kind === 'order') return (parts || []).indexOf(id) < 0;
    if (p.kind === 'read') {
      // 「だけ読む」と「いがいを読む」は反対の言い方なので、どちらか片方だけ
      const cur = readIds(parts);
      if (cur.length && cur[0] !== id) return false;
    }
    if (stageCount(parts) >= MAX_STAGES) {
      // 段が上限。ただし読み方の1個目は段を増やさないので足せる
      if (p.kind === 'read' && !readIds(parts).length) return true;
      return false;
    }
    return true;
  }
  /** 足せない理由（画面に出すため） */
  function whyNot(parts, id) {
    const p = part(id);
    if (!p) return '';
    if (p.kind === 'solve') return 'この しかけ は1回だけ選べます';
    if (p.kind === 'order') return '読む順番は1つだけ選べます';
    if (p.kind === 'read') {
      const cur = readIds(parts);
      if (cur.length && cur[0] !== id) {
        return '「' + part(cur[0]).name + '」と反対の言い方なので、いっしょには選べません（先にそちらを減らしてください）';
      }
    }
    return '段は' + MAX_STAGES + 'つまでです。ほかの しかけ を減らしてから選んでください';
  }
  function countOf(parts, id) {
    return (parts || []).filter(function (x) { return x === id; }).length;
  }

  /** 「○○だけよめ」「○○いがいをよめ」の短い言い方 */
  function readPhrase(mode, i, parts, opts) {
    if (mode === 'exclude') {
      return excludeColors(i, parts, opts).map(colorAdj).join('と') + 'もじいがいをよめ';
    }
    return colorAdj(stageColors(parts, opts)[i]) + 'もじだけよめ';
  }

  /** その段の文章の、はじめから入れておく例 */
  function defaultText(parts, i, opts) {
    const st = stageParts(parts);
    const n = stageCount(parts);
    const sc = stageColors(parts, opts);
    if (i === n - 1) return 'なぞがとけた';
    const kind = st[i];
    if (kind === 'erase-wall') return colorAdj(sc[i]) + 'せんをけせ';
    if (kind === 'move-start') return 'ほしからやりなおし';
    if (kind === 'move-goal') return 'ほしまでいけ';
    if (kind === 'move-both') return 'ほしからほしへ';
    if (kind === 'next-read') return readPhrase(readMode(parts), i + 1, parts, opts);
    return 'つぎへすすめ';
  }

  /** 段 i で読むものの言い方（問題用紙むけ） */
  function readTarget(mode, i, parts, opts) {
    if (mode === 'all') return '通ったマスの文字';
    if (mode === 'exclude') {
      return '通った道の' + excludeColors(i, parts, opts).map(colorLabel).join('と') + '色いがいの文字';
    }
    return '通った道の' + colorLabel(stageColors(parts, opts)[i]) + '色の文字だけ';
  }

  /** 問題用紙にのる「解く人がやること」 */
  function instruction(parts, opts) {
    const st = stageParts(parts);
    const n = stageCount(parts);
    const sc = stageColors(parts, opts);
    const mode = readMode(parts);
    const lines = [];
    const rule = [];
    if ((parts || []).indexOf('must-circles') >= 0) rule.push('○のマスを全部通り');
    if ((parts || []).indexOf('avoid-cross') >= 0) rule.push('×のマスは通らずに');
    const how = rule.length ? rule.join('、') + '、' : '';

    for (let i = 0; i < n; i++) {
      const order = readOrder(parts, opts, i);
      const way = (order === 'route') ? '順に' : orderWord(order);
      const head = (n > 1 ? '（' + (i + 1) + '） ' : '');
      const prev = (i > 0) ? st[i - 1] : null;
      if (prev === 'next-read') {
        // 道は変わらないので「進む」は書かず、読み直しだけを言う
        lines.push(head + '同じ道をもう一度たどり、' + readTarget(mode, i, parts, opts) + 'を' + way + '読みます。');
      } else {
        const from = (i === 0) ? 'STARTから'
          : (prev === 'move-goal') ? 'STARTから新しいGOALまで'
          : '新しいSTARTから';
        lines.push(head + from + how + 'GOALまでいちばん短く進み、' +
                   readTarget(mode, i, parts, opts) + 'を' + way + '読みます。');
      }
      const nc = colorAdj(sc[i + 1]);
      if (st[i] === 'erase-wall') lines.push('　→ 読めた指示どおりに、' + colorAdj(sc[i]) + '線を消してください。');
      if (st[i] === 'move-start') lines.push('　→ 読めた指示どおりに、' + nc + '★から出発しなおしてください。');
      if (st[i] === 'move-goal') lines.push('　→ 読めた指示どおりに、' + nc + '☆を新しいGOALにしてください。');
      if (st[i] === 'move-both') lines.push('　→ 読めた指示どおりに、' + nc + '★から ' + nc + '☆まで進みなおしてください。');
      if (st[i] === 'next-read') lines.push('　→ 同じ道をもう一度たどり、今度は' + readTarget(mode, i + 1, parts, opts) + 'を読みます。');
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
      rows: 12, cols: 12, density: 'normal', sg: 'corners', loops: 'none', parts: [], texts: {}, opts: {}
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

  /**
   * sc（段ごとの読む色）は既定では「読み直す」ときだけ進むので、同じ色の段は
   * ふつう連続する。ただし段ごとの色を個別に上書きできるようになったので、
   * 連続していなくても同じ色を使っている段をすべて拾えるようにしておく
   * （そうしないと、離れた場所で同じ色を使い回したときに前の段の文字が
   *   隠されず・避けられずに残ってしまう）。
   * 段iと同じ色を使っている、それより前／後の段の番号をすべて返す。
   */
  function sameColorBefore(sc, i) {
    const out = [];
    for (let j = 0; j < i; j++) if (sc[j] === sc[i]) out.push(j);
    return out;
  }
  function sameColorAfter(sc, i) {
    const out = [];
    for (let j = i + 1; j < sc.length; j++) if (sc[j] === sc[i]) out.push(j);
    return out;
  }

  /** 道が使っているマスの集合（"r:c" キー）。同じ色の段どうしで重なりを避けるのに使う */

  function routeCellSet(path) {
    const set = {};
    uniqueCells(path).forEach(function (p) { set[M.cellKey(p.r, p.c)] = true; });
    return set;
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
  /** 盤面上のマス目のあらさ（角も含めた距離）。0＝同じマス、1＝隣接／斜め隣接（紙の上ではくっついて見える） */
  function gridDist(a, b) { return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)); }

  /**
   * ルートの空いているマスに、文章をだいたい均等に置く。
   * order を渡すと「その順で読んだときに文章になる」ように置く。
   * （読むときと同じ並べかえを、置くときにも通しているので必ず一致する）
   *
   * ★盤面の上でくっついて見えないようにする★
   * 道の「通った順」だけで均等に置くと、道が折り返しているところでは
   * 文字どうしが紙の上ではすぐ隣に来てしまうことがあった
   * （伊神さんの指摘：「答えの文字が連続して固まりすぎる」）。
   * 「盤面の上でとなり合わせにしない、いちばんゆるい距離Dはいくつか」を
   * 大きいほうから順に試し、見つかった距離Dで「その距離を保てる、いちばん
   * 手前のマス」から順にどんどん置いていく（早取り）。
   * ちょうど均等である必要はないので、これで十分。
   *
   * avoidSet を渡すと、そのマス（"r:c" のキー）には置かない。
   * 前の段と同じ色で読ませるとき、前の段の道と重なるマスを避けるために使う
   * （重ねてしまうと、前の段の道を歩いたときに次の段の文字まで見えてしまう）。
   *
   * extraNear を渡すと、そのマスからも離す（D以上にする）。
   * 同じ色の前の段・あとの段は道こそ避けているが、盤面の上ではすぐ近くを
   * 通ることがあるので、すでに置いてある同じ色の文字からも離しておかないと
   * 印刷した紙の上で「別の段の文字なのに隣どうし」に見えてしまう。
   *
   * 戻り値：置いた文字の要素idの配列（失敗したら null）。
   * このidは、色を変えずに次の段へ進むときに「もう使い終えた文字」を
   * 消す（disable する）ために使う。
   */
  function placeOnFree(maze, path, text, color, order, avoidSet, extraNear) {
    const chs = letters(text);
    if (!chs.length) return null;
    const cells = uniqueCells(path);
    const occupied = {};
    maze.elements.forEach(function (e) { occupied[M.cellKey(e.r, e.c)] = true; });
    const free = [];
    cells.forEach(function (p, i) {
      const k = M.cellKey(p.r, p.c);
      if (occupied[k]) return;
      if (avoidSet && avoidSet[k]) return;
      free.push(i);
    });
    if (free.length < chs.length) return null;
    const near = extraNear || [];

    // 均等にならべたときの、だいたいの目あて位置
    function wantIdx(i) { return chs.length === 1 ? 0 : Math.round(i * (free.length - 1) / (chs.length - 1)); }

    /**
     * 距離Dを守れるかどうか。
     * 守れるなら、その中で「均等にならべた目あて位置にいちばん近いマス」を選んで置く
     * （手前から早取りするだけだと、前のほうで距離をかせぎすぎて、
     *   あとの文字がまとめて隅に押しこまれることがあった）。
     */
    function tryFit(D) {
      const picked = [], placedCells = [];
      let lastIdx = -1;
      for (let i = 0; i < chs.length; i++) {
        const lo = lastIdx + 1;
        const maxIdx = free.length - 1 - (chs.length - 1 - i);   // 残りの文字ぶんの場所を必ず残す
        const want = wantIdx(i);
        let bestJ = -1, bestDiff = Infinity;
        for (let j = lo; j <= maxIdx; j++) {
          const p = cells[free[j]];
          const farEnough = placedCells.every(function (q) { return gridDist(p, q) >= D; }) &&
                             near.every(function (q) { return gridDist(p, q) >= D; });
          if (!farEnough) continue;
          const diff = Math.abs(j - want);
          if (diff < bestDiff) { bestDiff = diff; bestJ = j; }
        }
        if (bestJ < 0) return null;
        picked.push(bestJ);
        placedCells.push(cells[free[bestJ]]);
        lastIdx = bestJ;
      }
      return picked;
    }

    // 出せるいちばん大きい距離をさがす。
    // ★D=1（隣どうし・斜めどなりもOK）は認めない。伊神さんの指摘：
    //   「あおい」のように答えの文字どうしがくっついて見えると、答えがバレやすく読みにくい。
    // D=2未満でしか置けないときは失敗にする。呼び出し側（makeOne/build）が
    // 迷路をまるごと作り直すか、置く側（placeTargets）が理由つきで断る。
    let picked = null;
    for (let D = 5; D >= 2 && !picked; D--) picked = tryFit(D);
    if (!picked) return null;

    // 通った順にならんだマスを、読む順にならべかえてから1文字ずつ入れる
    const spots = picked.map(function (idx) { return { r: cells[free[idx]].r, c: cells[free[idx]].c }; });
    const seq = O.applyOrder(spots, order || 'route', 'all');
    if (seq.length !== chs.length) return null;
    const ids = [];
    for (let i = 0; i < chs.length; i++) {
      const el = M.makeElement(seq[i].r, seq[i].c, chs[i], { color: color });
      maze.elements.push(el);
      ids.push(el.id);
    }
    return ids;
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

  function scatterOutside(maze, paths, rc, colors, pool) {
    let all = [];
    paths.forEach(function (p) { all = all.concat(p || []); });
    O.scatterDummies(maze, all, {
      density: curDensity(rc.density),
      colors: colors,
      pool: pool
    });
  }

  /** その設定の名前（few/normal/many）を、実際のこさ（0〜1）にする */
  function curDensity(key) { return DENSITY[key] !== undefined ? DENSITY[key] : DENSITY.normal; }

  /**
   * まぎれ文字の材料。
   * ★以前は「答えで使われている字だけ」を材料にしていた（=いちばん紛れると考えていた）が、
   *   字の種類が4〜8個しかないと、まぎれ文字が答えとそっくりな字ばかりになってしまい、
   *   「カモフラージュがみんな答えに似ている」と伊神さんから指摘を受けた。
   * → 土台はひらがな46字すべてにして、答えが漢字・カタカナ・数字を含むときだけ
   *   その字を少し混ぜる（種類がゼロにならないように）。
   */
  function poolFrom(texts) {
    const set = {}, base = O.POOLS.hiragana.slice();
    base.forEach(function (ch) { set[ch] = true; });
    const extra = [];
    texts.forEach(function (t) {
      letters(t).forEach(function (ch) { if (!set[ch]) { set[ch] = true; extra.push(ch); } });
    });
    return base.concat(extra);
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

  /**
   * 文字を離して置く（D≧2）には、文字数ぴったりの空きマスでは足りない。
   * 経験上、文字数の1.6倍＋2マスあれば、たいていどこかに離して置ける組み合わせが見つかる。
   */
  function spacingNeed(n) { return Math.ceil(n * 1.6) + 2; }

  /**
   * 道すじが謎として成立しているか（1本だけ・差4以上・なぞり返しなし）。
   *
   * excludeSet／excludeNeed を渡すと、excludeSet に含まれるマスを除いた
   * 「正味の新しいマス」が excludeNeed 以上あることも求める。
   * STARTやGOALが変わる段は、木構造の迷路だと新しい道もGOAL側でたいてい前の道と
   * 合流して重なる。needCells（道ぜんたいの長さ）だけを見ていると、
   * 合流でかさ増しされた長さを「文字を置ける場所」と誤解してしまい、
   * 実際に前の道と重ならないマスが少なすぎて、文字を離して置けなくなる。
   */
  function routeIsGood(board, res, needCells, excludeSet, excludeNeed) {
    if (!res || !res.ok || res.count !== 1) return false;
    if (E.retracesEdge(res.path)) return false;
    if (E.routeMargin(board, res.path, { useAvoid: true }).margin < E.MARGIN_GOOD) return false;
    const cells = uniqueCells(res.path);
    if (needCells && cells.length < needCells) return false;
    if (excludeSet && excludeNeed) {
      const avail = cells.filter(function (p) { return !excludeSet[M.cellKey(p.r, p.c)]; }).length;
      if (avail < excludeNeed) return false;
    }
    return true;
  }

  /* =======================================================================
   * 組み立て本体
   * ===================================================================== */
  function makeOne(rc) {
    const parts = rc.parts || [];
    const st = stageParts(parts);
    const n = stageCount(parts);
    const mode = readMode(parts);           // ぜんぶ読む／その色だけ／その色いがい
    const color = (mode !== 'all');
    const sc = stageColors(parts, rc.opts); // 段ごとの読む色（既定は「読み直す」で進む・「スタゴル/線けし」で赤にもどる。個別上書き可）
    const noise = noiseColor(mode, parts, rc.opts);  // ルートの上にまく「読まれない文字」の色
    const needMust = parts.indexOf('must-circles') >= 0;
    const needAvoid = parts.indexOf('avoid-cross') >= 0;
    const texts = [];
    for (let i = 0; i < n; i++) texts.push(letters(rc.texts['s' + (i + 1)] || '').join(''));

    /* ---- ① 種の迷路 ---- */
    const baseLoops = (needMust || needAvoid) ? 'none' : rc.loops;
    let need0 = texts[0].length;
    for (let j = 0; j < st.length && st[j] === 'next-read'; j++) need0 += texts[j + 1].length;
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
    let moveCount = 0;   // STARTGOALの変更が何回めか（★☆→■□→▲△→◆◇ と目印を変える）
    for (let i = 0; i < st.length; i++) {
      // その段のあとに「色を変えて読み直す」段が続くなら、同じ道に文字がもっと要る
      let nextNeed = texts[i + 1].length;
      for (let j = i + 1; j < st.length && st[j] === 'next-read'; j++) nextNeed += texts[j + 1].length;
      nextNeed += 1;

      // move-start/move-goal/move-bothは色を引き継ぐので、次の段（i+1）自身の文字は
      // 「これまでの同じ色の段ぜんぶの道」と重ならない場所に置かなければならない
      // （同じ色の使い回し防止。STARTGOAL変更が2回以上つづくと、直前の1本だけでなく
      //   それより前の道とも重ならない必要があるので、ここで先まで合わせて渡しておく。
      //   そうしないと、ここでは足りると判定したのに、実際に文字を置く段になって
      //   「前の前の道」まで避けたら場所が足りない、ということが起きる）。
      // 「前の道と重ならない、正味の新しいマス」がその文字数ぶん離して置けるだけ要る。
      const ownNeed = spacingNeed(texts[i + 1].length);
      const nc = sc[i + 1];
      const before = sameColorBefore(sc, i + 1).filter(function (j) { return j !== i; });
      let priorRoute = routes[i].slice();
      before.forEach(function (j) { priorRoute = priorRoute.concat(routes[j]); });
      let out = null;
      if (st[i] === 'erase-wall') out = doEraseWall(maze, work, routes[i], sc[i], solveOpts, nextNeed);
      if (st[i] === 'move-start') out = doMoveStart(maze, work, priorRoute, nc, solveOpts, nextNeed, ownNeed, markerFor(moveCount++));
      if (st[i] === 'move-goal') out = doMoveGoal(maze, work, priorRoute, nc, solveOpts, nextNeed, ownNeed, markerFor(moveCount++));
      if (st[i] === 'move-both') out = doMoveBoth(maze, work, priorRoute, nc, solveOpts, nextNeed, ownNeed, markerFor(moveCount++));
      if (st[i] === 'next-read') {
        // 盤面は変えない。同じ道を、次の色でもう一度読むだけ
        out = { kind: 'next-read', color: nc, path: routes[i] };
      }
      if (!out) return null;
      transitions.push(out);
      routes.push(out.path);
    }

    /* ---- ④ 文字を置く（あとの段ほど空きが少ないので、うしろから置く） ----
     * 前の段と同じ色で読ませるときは、前の段の道と重なるマスを避けて置く。
     * そうしないと、前の段を歩いたときに次の段の文字まで見えてしまい、
     * 前の段の読み方が狂う（紙は最初から全部印刷ずみなので、あとの段の
     * インクが先に置いてあることになる。逆に、前の段のインクがあとの段の道に
     * 乗っているぶんには、読み終わった段の文字は「読み終わり」の見た目にする
     * 仕組み側で対処ずみなので問題ない）。
     * ★色は既定では「読み直す（next-read）」か「スタゴル/線けし（直前が赤のとき）」でしか
     *   進まないので、同じ色の段はふつう連続する。個別に色を上書きした場合は
     *   連続しないこともあるので、同じ色を使っている段は連続の有無にかかわらずすべて拾う。 */
    const stageIds = [];
    for (let i = n - 1; i >= 0; i--) {
      const before = sameColorBefore(sc, i), after = sameColorAfter(sc, i);
      let avoid = null, near = null;
      if (before.length) {
        avoid = {};
        before.forEach(function (j) { Object.assign(avoid, routeCellSet(routes[j])); });
      }
      if (after.length) {
        // あとの段（すでに後ろから置いてあるので位置が分かる）とは、道の重なりまでは
        // 避けなくてよいが、盤面の上でくっついて見えるのは避けたい（紙の見やすさのため）。
        near = [];
        after.forEach(function (j) {
          if (!stageIds[j]) return;
          stageIds[j].forEach(function (id) {
            const el = maze.elements.filter(function (e) { return e.id === id; })[0];
            if (el) near.push({ r: el.r, c: el.c });
          });
        });
      }
      const ids = placeOnFree(maze, routes[i], texts[i], answerColor(mode, i, parts, rc.opts), readOrder(parts, rc.opts, i), avoid, near);
      if (!ids) return null;
      stageIds[i] = ids;
    }

    /* ---- ⑤ まぎらわしい文字 ----
     * 大事な約束：ルートの上にまく文字は、その段で「読まれない色」でなければならない。
     * 読まれる色でまくと、答えの中に関係ない文字がまざってしまう。
     * ★以前はルートの空きマスを必ず100%埋めていたので、まわり（こさ設定ぶんしか埋めない）
     *   と比べて答えルートだけ文字がびっしり詰まって見えてしまっていた。
     *   ルートの内側も、まわりと同じ「こさ」で埋める。 */
    const dummyPool = poolFrom(texts);
    if (noise) fillGaps(maze, routes, noise, curDensity(rc.density), dummyPool);
    if (color) {
      const outColors = ['black'].concat(sc.filter(function (c, idx) { return sc.indexOf(c) === idx; }));
      scatterOutside(maze, routes, rc, outColors, dummyPool);
    } else {
      // 全部読む謎では、道の上に余計な文字を置いてはいけない
      scatterOutside(maze, routes, rc, ['black'], dummyPool);
    }

    /* ---- ⑥ STEPを組む ---- */
    const steps = [];
    const checkpoint = [];    // checkpoint[i] = 段iの読み方が確定するSTEPの番号
    // 記号（○ × ★）は読み上げの対象にしない。
    // ★はSTARTの目印として道の上に乗るので、入れてしまうと答えに混ざる。
    const readKinds = ['text', 'number'];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const tr = transitions[i - 1];
        // 色を変えずに次の段へ進むとき（STARTが変わる・線を消す、など）は、
        // 前の段の文字が新しい道の上に残っていると、次の段で「同じ色だけ読む」ときに
        // 消化ずみのはずの前の文字まで拾ってしまう。読み終えた文字はここで消しておく。
        // 同じ色の段が3つ以上つづくこともあるので、直前の1段だけでなく
        // 同じ色の段ぜんぶ（この時点までに読み終えた分。連続していなくても拾う）を消す。
        const before = sameColorBefore(sc, i);
        if (before.length) {
          let ids = [];
          before.forEach(function (j) { if (stageIds[j] && stageIds[j].length) ids = ids.concat(stageIds[j]); });
          if (ids.length) steps.push(ST.makeStep('remove-elements', { ids: ids, mode: 'disable' }));
        }
        // 壁は色ではなく、この段で消すと決めた壁そのもの（キー）を指定する。
        // 別の段が同じ色を使っていると、色だけでは「まだ消してはいけない壁」まで
        // いっしょに消えてしまうことがあった。
        if (tr.kind === 'erase-wall') steps.push(ST.makeStep('remove-walls', { keys: tr.keys, colors: [tr.color] }));
        if (tr.kind === 'move-start') steps.push(ST.makeStep('set-start', { symbol: tr.startSymbol, symbolColor: tr.color }));
        if (tr.kind === 'move-goal') steps.push(ST.makeStep('set-goal', { symbol: tr.goalSymbol, symbolColor: tr.color }));
        if (tr.kind === 'move-both') {
          steps.push(ST.makeStep('set-start', { symbol: tr.startSymbol, symbolColor: tr.color }));
          steps.push(ST.makeStep('set-goal', { symbol: tr.goalSymbol, symbolColor: tr.color }));
        }
        // next-read は盤面を変えないので、変換のSTEPは要らない
      }
      steps.push(ST.makeStep('solve', { useMust: needMust }));
      steps.push(ST.makeStep('extract', { kinds: readKinds }));
      if (mode === 'include') steps.push(ST.makeStep('filter-color', { mode: 'include', colors: [sc[i]] }));
      if (mode === 'exclude') steps.push(ST.makeStep('filter-color', { mode: 'exclude', colors: excludeColors(i, parts, rc.opts) }));
      // 色でしぼったあとに並べかえる（まぎれ文字を巻きこまないため、この順でなければならない）
      const order = readOrder(parts, rc.opts, i);
      if (order !== 'route') steps.push(ST.makeStep('reorder', { order: order, parity: 'all' }));
      checkpoint[i] = steps.length - 1;
    }
    steps.push(ST.makeStep('answer', { expected: texts[n - 1] }));

    /* ---- ⑦ 検証を通ったものだけ返す ---- */
    maze.meta.title = titleOf(parts);
    maze.meta.instruction = instruction(parts, rc.opts);
    const results = ST.runSteps(maze, steps);
    // 最終こたえが合っているだけでは足りない。道が重なって前後の段の文字が
    // まざっていないか、段ごとの読み方もひとつずつ確かめる
    // （results[0] は「最初の盤面」なので、STEPの番号 k は results[k+1] に対応する）。
    for (let i = 0; i < n; i++) {
      if ((results[checkpoint[i] + 1] || {}).text !== texts[i]) return null;
    }
    const checks = ST.validateAll(maze, steps);
    if (checks.some(function (c) { return c.level !== 'ok'; })) return null;

    return { ok: true, maze: maze, steps: steps, answer: texts[n - 1], checks: checks, stages: n, routes: routes, stageIds: stageIds };
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

  /**
   * 線を消して次の段へ。
   * ★候補は「近道の長さ」だけでなく「元のルートとどれだけ別の道になるか」も見て、
   *   いちばん元のルートから離れる候補を選ぶ。近道になる壁はいくつもあるが、
   *   「壁を1本だけ消して、あとはほとんど元のルートのまま」を選んでしまうと
   *   拾う文字も景色もほとんど変わらずつまらない（伊神さんの指摘）。
   */
  function doEraseWall(maze, work, route, color, solveOpts, needCells) {
    const onRoute = {};
    route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    // 近道になりそうな壁を、良い順にいくつも試す（1本だけ試すと作れないことが多い）
    const cands = listShortcuts(work, route).slice(0, 20);
    let best = null, bestScore = -1;
    for (let i = 0; i < cands.length; i++) {
      const sc = cands[i];
      work.walls[sc.key].disabled = true;
      const res = E.solve(work, solveOpts);
      const good = routeIsGood(work, res, needCells);
      work.walls[sc.key].disabled = false;
      if (!good) continue;
      const score = uniqueCells(res.path).filter(function (p) { return !onRoute[M.cellKey(p.r, p.c)]; }).length;
      if (score > bestScore) { bestScore = score; best = { key: sc.key, res: res }; }
    }
    if (!best) return null;
    const keys = paintWalls(work, maze, best.key, best.res.path, 3, color);
    keys.forEach(function (k) { work.walls[k].disabled = true; });
    return { kind: 'erase-wall', color: color, path: best.res.path, keys: keys };
  }

  /**
   * 候補を総当たりし、「前の道と重ならない正味のマス」がいちばん多い候補を選ぶ。
   * ★木構造の迷路は、新しい道もGOAL側でたいてい前の道と合流してしまうので、
   *   ランダムに40個ためすだけだと、たまたま合流の浅い（＝重ならない場所が多い）
   *   候補を引き当てられず、離して置く場所が足りないまま採用してしまっていた。
   *   盤面のマス数ぶんしか候補が無いので、全部ためしても遅くはならない。
   * needCells（道ぜんたいの長さ）を満たさない候補はそもそも除外するが、
   * ownNeed（前の道と重ならない正味のマス）はここでは判定しない、
   * 呼び出し側がだめならlengthenRouteで足りない分を積み増す。
   */
  function bestNonOverlap(work, onRoute, needCells, solveFn) {
    let best = null, bestScore = -1;
    for (let r = 0; r < work.rows; r++) for (let c = 0; c < work.cols; c++) {
      if (onRoute[M.cellKey(r, c)]) continue;
      const res = solveFn(r, c);
      if (!res || !res.ok || res.count !== 1) continue;
      if (E.retracesEdge(res.path)) continue;
      if (E.routeMargin(work, res.path, { useAvoid: true }).margin < E.MARGIN_GOOD) continue;
      const cells = uniqueCells(res.path);
      if (needCells && cells.length < needCells) continue;
      const score = cells.filter(function (p) { return !onRoute[M.cellKey(p.r, p.c)]; }).length;
      if (score > bestScore) { bestScore = score; best = { r: r, c: c, res: res, score: score }; }
    }
    return best;
  }

  /**
   * 前の道と重ならない正味のマスが ownNeed に足りないとき、その道を
   * 迂回路で伸ばして使えるマスを増やす（伊神さんの指摘：「マス数が足りず
   * こさが高くなるなら、寄り道させて使えるマスを増やして対応」）。
   * work（STARTやGOALをすでに動かした状態の作業用盤面）の上で試し、
   * うまくいったら同じ壁の変更を maze（本番の盤面）にも反映する。
   * すでに壁を色つき（線を消すギミック使用ずみ）にしている迷路では、
   * 壁の構造が maze と work とでずれてしまうおそれがあるので試さない。
   */
  function tryLengthenForRoom(maze, work, best, onRoute, ownNeed) {
    if (best.score >= ownNeed) return best;
    if (Object.keys(work.walls).some(function (k) { return work.walls[k].color && work.walls[k].color !== 'black'; })) return best;
    const res = G.lengthenRoute(work, best.res.path, { avoidSet: onRoute, tries: 200,
      accept: function (m, newRoute) {
        return uniqueCells(newRoute).filter(function (p) { return !onRoute[M.cellKey(p.r, p.c)]; }).length >= ownNeed;
      } });
    if (!res.ok) return best;
    maze.walls = JSON.parse(JSON.stringify(work.walls));
    const score = uniqueCells(res.route).filter(function (p) { return !onRoute[M.cellKey(p.r, p.c)]; }).length;
    return { r: best.r, c: best.c, res: { path: res.route }, score: score };
  }

  /** STARTを★（複数回めは■▲◆）に変えて次の段へ */
  function doMoveStart(maze, work, route, color, solveOpts, needCells, ownNeed, marker) {
    const sym = (marker || MARKER_SETS[0]).start;
    const onRoute = {};
    route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    const occupied = {};
    maze.elements.forEach(function (e) { occupied[M.cellKey(e.r, e.c)] = true; });
    const goal = work.goals[0];
    let best = bestNonOverlap(work, onRoute, needCells, function (r, c) {
      if (occupied[M.cellKey(r, c)]) return null;
      return E.solve(work, Object.assign({}, solveOpts, { start: { r: r, c: c }, goal: { r: goal.r, c: goal.c } }));
    });
    if (!best) return null;
    const p = { r: best.r, c: best.c };
    // lengthenRouteの中の checkLengthened は work.starts/goals を見て解き直すので、
    // 迂回路を試す前に候補のSTARTへ動かしておく必要がある
    work.elements.push(M.makeElement(p.r, p.c, sym, { color: color }));
    work.starts = [M.makeStart(p.r, p.c)];
    best = tryLengthenForRoom(maze, work, best, onRoute, ownNeed);
    if (best.score < ownNeed) return null;
    maze.elements.push(M.makeElement(p.r, p.c, sym, { color: color }));
    return { kind: 'move-start', color: color, path: best.res.path, star: p, startSymbol: sym };
  }

  /** GOALを☆（複数回めは□△◇）に変えて次の段へ */
  function doMoveGoal(maze, work, route, color, solveOpts, needCells, ownNeed, marker) {
    const sym = (marker || MARKER_SETS[0]).goal;
    const onRoute = {};
    route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    const occupied = {};
    maze.elements.forEach(function (e) { occupied[M.cellKey(e.r, e.c)] = true; });
    const start = work.starts[0];
    let best = bestNonOverlap(work, onRoute, needCells, function (r, c) {
      if (occupied[M.cellKey(r, c)]) return null;
      return E.solve(work, Object.assign({}, solveOpts, { start: { r: start.r, c: start.c }, goal: { r: r, c: c } }));
    });
    if (!best) return null;
    const p = { r: best.r, c: best.c };
    work.elements.push(M.makeElement(p.r, p.c, sym, { color: color }));
    work.goals = [M.makeGoal(p.r, p.c)];
    best = tryLengthenForRoom(maze, work, best, onRoute, ownNeed);
    if (best.score < ownNeed) return null;
    maze.elements.push(M.makeElement(p.r, p.c, sym, { color: color }));
    return { kind: 'move-goal', color: color, path: best.res.path, goal: p, goalSymbol: sym };
  }

  /** STARTもGOALも変えて次の段へ（★から☆へ。複数回めは■→□など） */
  function doMoveBoth(maze, work, route, color, solveOpts, needCells, ownNeed, marker) {
    const mk = marker || MARKER_SETS[0];
    const onRoute = {};
    route.forEach(function (p) { onRoute[M.cellKey(p.r, p.c)] = true; });
    const occupied = {};
    maze.elements.forEach(function (e) { occupied[M.cellKey(e.r, e.c)] = true; });
    const free = [];
    for (let r = 0; r < work.rows; r++) for (let c = 0; c < work.cols; c++) {
      if (onRoute[M.cellKey(r, c)]) continue;
      if (occupied[M.cellKey(r, c)]) continue;
      free.push({ r: r, c: c });
    }
    shuffle(free);
    let best = null, bestScore = -1, bestAB = null;
    const capI = Math.min(free.length, 30), capJ = Math.min(free.length, 30);
    outer:
    for (let i = 0; i < capI; i++) {
      for (let j = 0; j < capJ; j++) {
        if (i === j) continue;
        const a = free[i], b = free[j];
        const res = E.solve(work, Object.assign({}, solveOpts, { start: a, goal: b }));
        if (!res || !res.ok || res.count !== 1) continue;
        if (E.retracesEdge(res.path)) continue;
        if (E.routeMargin(work, res.path, { useAvoid: true }).margin < E.MARGIN_GOOD) continue;
        const cells = uniqueCells(res.path);
        if (cells.length < needCells) continue;
        const score = cells.filter(function (p) { return !onRoute[M.cellKey(p.r, p.c)]; }).length;
        if (score > bestScore) {
          bestScore = score; best = { r: a.r, c: a.c, res: res, score: score }; bestAB = { a: a, b: b };
          // ownNeed を満たす候補が見つかったら、それ以上ぜんぶの組を試さなくてよい
          // （厳密な最良より、はやく見つかることのほうが大事）
          if (bestScore >= ownNeed) break outer;
        }
      }
    }
    if (!best) return null;
    const a = bestAB.a, b = bestAB.b;
    work.elements.push(M.makeElement(a.r, a.c, mk.start, { color: color }));
    work.elements.push(M.makeElement(b.r, b.c, mk.goal, { color: color }));
    work.starts = [M.makeStart(a.r, a.c)];
    work.goals = [M.makeGoal(b.r, b.c)];
    best = tryLengthenForRoom(maze, work, best, onRoute, ownNeed);
    if (best.score < ownNeed) return null;
    maze.elements.push(M.makeElement(a.r, a.c, mk.start, { color: color }));
    maze.elements.push(M.makeElement(b.r, b.c, mk.goal, { color: color }));
    return { kind: 'move-both', color: color, path: best.res.path, star: a, goal: b, startSymbol: mk.start, goalSymbol: mk.goal };
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

  /**
   * STARTGOALの変更を2回以上重ねるなど、「同じ色で読み直す段」がいくつも続くと、
   * 指定の大きさのままでは、前の段ぜんぶと重ならない場所がどうしても足りないことがある
   * （伊神さんの指摘：「スタゴルを2回使うと作れないと出る。できるようにしてほしい」）。
   * 指定の大きさで作れなければ、盤面を少しずつ大きくしながら作り直す。
   * 大きさは自動で決めてよいとのことなので、確認なしで広げる。
   */
  function build(recipe) {
    const rc = defaults(recipe);
    const bad = checkRecipe(rc);
    if (bad) return { ok: false, reason: bad };
    const grows = [0, 2, 4, 6, 8];
    let totalTries = 0;
    let lastRows = null, lastCols = null;
    for (let s = 0; s < grows.length; s++) {
      const rows = clamp(rc.rows + grows[s], 6, 20), cols = clamp(rc.cols + grows[s], 6, 20);
      if (rows === lastRows && cols === lastCols) continue;   // もう上限で広げられない
      lastRows = rows; lastCols = cols;
      const tryRc = (grows[s] === 0) ? rc : Object.assign({}, rc, { rows: rows, cols: cols });
      const attempts = (s === 0) ? BUILD_TRIES : Math.ceil(BUILD_TRIES / 2);
      for (let t = 0; t < attempts; t++) {
        totalTries++;
        let out = null;
        try { out = makeOne(tryRc); } catch (e) { out = null; }
        if (out) {
          out.tries = totalTries;
          if (grows[s] > 0) out.grownTo = rows + '×' + cols;
          return out;
        }
      }
    }
    return { ok: false, reason: 'この組み合わせでは作れませんでした。文章を短くするか、迷路を大きくするか、しかけを減らしてみてください' };
  }

  /* =======================================================================
   * 編集画面から使う：ねらった答えになるように置く
   *   rows = [{ path, color（null なら全部読む）, text }]
   *   空きマスの少ないルートから先に置く
   * ===================================================================== */

  /** 2つの行が「同じ文字を読んでしまう」関係か（色なし＝全部読む はどの色ともぶつかる） */
  function colorsClash(a, b) { return !a || !b || a === b; }

  /** 2つのルートが1マスでも重なっているか */
  function sharesCell(p1, p2) {
    const seen = {};
    uniqueCells(p1).forEach(function (p) { seen[M.cellKey(p.r, p.c)] = true; });
    return uniqueCells(p2).some(function (p) { return seen[M.cellKey(p.r, p.c)]; });
  }

  /**
   * どの行にも読まれない色を1つ返す（まぎれ文字用）。
   * ★ここが第4弾までのバグの原因だった★
   *   読む色と同じ色でまぎれ文字をまいていたので、答えに関係ない文字がまざっていた。
   */
  function unreadColor(rows) {
    const read = {};
    rows.forEach(function (r) { if (r.color) read[r.color] = true; });
    const order = ['black'].concat(M.COLOR_KEYS);
    for (let i = 0; i < order.length; i++) if (!read[order[i]]) return order[i];
    return null;
  }

  /** その行のとおりに読んでみる（画面の確認と、置いたあとの自己チェックで同じものを使う） */
  function readRow(board, row) {
    let chars = O.collectOnPath(board, row.path, { kinds: ['text', 'number'] });
    if (row.color) chars = O.filters.includeColors(chars, [row.color]);
    if (row.order && row.order !== 'route') chars = O.applyOrder(chars, row.order, 'all');
    return O.charsToText(chars);
  }

  function placeTargets(maze, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return { ok: false, reason: '行がありません' };
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].path || rows[i].path.length < 2) return { ok: false, reason: (i + 1) + '行めのルートが取れませんでした' };
      if (!letters(rows[i].text).length) return { ok: false, reason: (i + 1) + '行めの答えを入れてください' };
    }

    /* ---- ① 先にぶつかりを見る ----
     * 同じ色を読む行どうしでルートが重なっていると、
     * おたがいの文字が相手の答えにまざりこんでしまい、どう置いても直らない。 */
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (!colorsClash(rows[i].color, rows[j].color)) continue;
        if (!sharesCell(rows[i].path, rows[j].path)) continue;
        const nm = function (r) { return r.color ? M.COLORS[r.color].label + 'だけ' : '全部の文字'; };
        return { ok: false, reason: (i + 1) + '行め（' + nm(rows[i]) + '）と' + (j + 1) + '行め（' + nm(rows[j]) +
          '）は同じ文字を読んでしまい、ルートも重なっています。どちらかの「読む色」を変えてください' };
      }
    }

    // 対象のルート上にある古い文字を片づける（記号やチェックポイントは残す）
    const onPath = {};
    rows.forEach(function (r) { uniqueCells(r.path).forEach(function (p) { onPath[M.cellKey(p.r, p.c)] = true; }); });
    maze.elements = maze.elements.filter(function (e) {
      if (e.role !== 'none') return true;
      return !onPath[M.cellKey(e.r, e.c)];
    });

    /* ---- ② 空きマスの少ないルートから順に置く ---- */
    const seq = rows.map(function (r, i) { return { r: r, i: i, n: uniqueCells(r.path).length }; })
                    .sort(function (a, b) { return a.n - b.n; });
    for (let k = 0; k < seq.length; k++) {
      const row = seq[k].r;
      if (!placeOnFree(maze, row.path, row.text, row.color || 'black', row.order)) {
        return { ok: false, reason: (seq[k].i + 1) + '行め「' + row.text + '」を置く場所が足りません。迷路を大きくするか、文章を短くしてください' };
      }
    }

    /* ---- ③ まぎらわしい文字は「どの行にも読まれない色」でだけまく ---- */
    const fill = unreadColor(rows);
    const allReadPaths = rows.filter(function (r) { return !r.color; }).map(function (r) { return r.path; });
    const fillable = rows.filter(function (r) { return !!r.color; }).map(function (r) { return r.path; });
    let fillNote = '';
    if (opts.fill !== false && fillable.length) {
      if (!fill) {
        fillNote = '（6色ぜんぶを読んでいるので、まぎれ文字はまきませんでした）';
      } else {
        const blocked = {};
        allReadPaths.forEach(function (p) { uniqueCells(p).forEach(function (q) { blocked[M.cellKey(q.r, q.c)] = true; }); });
        const safe = fillable.map(function (p) {
          return uniqueCells(p).filter(function (q) { return !blocked[M.cellKey(q.r, q.c)]; });
        });
        fillGaps(maze, safe, fill, curDensity(opts.density), poolFrom(rows.map(function (r) { return r.text; })));
        if (fill !== 'black') fillNote = '（まぎれ文字は' + M.COLORS[fill].label + 'にしました。読む色とぶつからないようにするためです）';
      }
    }

    /* ---- ④ 置いたら必ず読み直して確かめる ---- */
    const ng = [];
    rows.forEach(function (r, i) {
      const got = readRow(maze, r);
      if (got !== letters(r.text).join('')) ng.push((i + 1) + '行め：「' + got + '」');
    });
    if (ng.length) {
      return { ok: false, reason: '置いてみましたが、読み直すと ' + ng.join('／') +
        ' になってしまいました。ルートが最短になっているか（②）を確かめてください' };
    }
    return { ok: true, placed: rows.length, fill: fill, note: fillNote };
  }

  return {
    PARTS: PARTS, part: part, stageParts: stageParts, stageCount: stageCount,
    canAdd: canAdd, whyNot: whyNot, countOf: countOf,
    usesColor: usesColor, readMode: readMode, readOrder: readOrder,
    excludeColors: excludeColors, answerColor: answerColor, noiseColor: noiseColor, stageColors: stageColors,
    defaultText: defaultText, instruction: instruction, titleOf: titleOf,
    ORDERS: ORDERS, ORDER_KEYS: ORDER_KEYS, orderWord: orderWord,
    STAGE_COLORS: STAGE_COLORS, MAX_STAGES: MAX_STAGES, DENSITY: DENSITY, LOOPS: LOOPS,
    build: build, checkRecipe: checkRecipe, seed: seed, letters: letters,
    placeOnFree: placeOnFree, fillGaps: fillGaps, scatterOutside: scatterOutside,
    placeTargets: placeTargets, readRow: readRow, unreadColor: unreadColor,
    uniqueCells: uniqueCells, colorAdj: colorAdj
  };
})();
