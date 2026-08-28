# 失敗・ハマりポイント集

## 画面用と印刷用でマスを別々に描いていると、片方だけ要素が抜ける

**症状：** ことばかける君で、画面の盤面や解答モードには番号（1・2・3…）が出るのに、
**印刷したものだけ番号が無い**。カギ一覧は「1. ○○」と番号で指しているので、問題として解けない。

**原因：** 画面用 `renderGrid()` と印刷用 `buildPrint()` でマスの描画コードが別々にあり、
印刷側だけ「番号」を描いていなかった。記号（A・B・C…）・色・罫線は両方にあったため気づきにくかった。

**対処：** 印刷側にも番号を足し、**位置の約束も画面とそろえる**（記号＝左上／番号＝右上）。

**再発防止：** 同じものを2か所で描いている箇所は、**片方に要素を足したらもう片方も確認する**。
確認は「画面に出るか」だけでなく、**印刷プレビュー（またはbuildPrintの出力）まで見る**こと。
このツールでは次の4か所が同じ盤面を描いている：
`renderGrid()`（画面）／`buildPrint()`（印刷）／`solveRender()`（解答モード）／`skelPreview`（プレビュー）

**タグ：** #印刷 #重複実装 #見落とし #crossword

---

## ダブルタップ抑止：「2度目を無視する」実装は連続タップまで潰す（危険）

**症状：** ダブルタップ（拡大）を防ぐため、2度目のタップを無効にする handler を書いたら、連続入力（`あんぱんまん`など6字タップ）ができなくなった。

**原因：** よく見かける実装：
```js
let touchCount = 0;
document.addEventListener('touchend', (e) => {
  touchCount++;
  if (touchCount === 2) {
    e.preventDefault();      // ← 2度目を無視する
    touchCount = 0;
  }
}, false);
```
これは「素早い2つのタップを同じ位置にされたら無視」という意図なのに、実装が雑だと**3度目のタップまで無視**されてしまう。または callback の timing ずれで、連続した単純なタップ（異なる位置、目的が違う）まで検出されてしまう。

**対処：** CSS-only ソリューションを使う（JavaScript handler は不要）：
```html
<!-- meta viewport -->
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">

<!-- CSS -->
<style>
  body {
    touch-action: manipulation;  /* ← ダブルタップ拡大のみ無効化、他の touch は通す */
  }
</style>

<!-- ピンチ抑止は必要に応じて -->
<script>
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
</script>
```

**メリット：** 
- ダブルタップ拡大だけをピンポイントで抑止
- 連続タップ（異なる位置）は全て通す
- ドラッグやスワイプに影響しない
- 実装が単純

**タグ：** #iPad #タッチ #CSS #副作用 #セッション149

---

## 変数名がブラウザの機能を隠してしまう（history / location / name など）

**症状：** `history.replaceState is not a function` というエラー。書き方は正しいのに動かない。

**原因：** 同じスクリプト内で `let history = [];`（「元に戻す」用の配列）を定義していたため、
ブラウザ標準の `window.history` が隠されていた（シャドーイング）。

**対処：** ブラウザの機能だと分かるように `window.` を付けて書く。

```js
window.history.replaceState(null, '', url);   // ← history.replaceState だと自作の配列を見てしまう
```

**気をつける名前：** `history` / `location` / `name` / `status` / `top` / `parent` / `origin` / `close` / `open`
これらはグローバルに既にあるので、自作の変数名にすると事故が起きる。
迷ったら `undoHistory` のように具体的な名前にする。

**タグ：** #JavaScript #シャドーイング #命名 #グローバル変数

---

## URLのハッシュを消してから再読み込みするときの落とし穴

**症状：** `#` 以降を消して再読み込みしたつもりが、**古いURL（#つき）のまま**読み直されてしまう。

**原因：** `location.href` への代入は**すぐには反映されない**（予約されるだけ）。
そのため直後の `location.reload()` が、まだ変わっていない古いURLを読み直してしまう。

```js
// ✗ 効かない
location.href = clean;
location.reload();

// ○ replaceState はその場でURLを書き換えるので、続けて reload できる
window.history.replaceState(null, '', clean);
location.reload();
```

**タグ：** #JavaScript #location #URL #リロード

---

## 外部短縮サービスの試行3回失敗→判定フェーズ：データ保管型アーキテクチャへの転換

**背景：** クロスワード配布リンクの短縮問題（セッション138-142）で、複数の外部短縮サービス（is.gd）を試行したが、3回連続で失敗。この経験から「3回失敗したら判定フェーズへ」というCLAUDE.mdのルールが実際に機能することが確認された。

**失敗の経緯：**
1. **セッション140**：`is.gd` API を実装、279字→20字短縮に成功（シミュレーション）。ただし作業環境が外部通信ブロック（HTTP 403）のため、実環境検証ができず
2. **セッション141**：JSONP対応で CORS 問題を解決し、デバッグ・テスト方式の工夫。ただしブラウザのセキュリティ制限で安定性に疑問
3. **セッション142**：実装を完成させたが、「サービス終了リスク」「学校ネットのフィルタリング」「本当に動くかの検証不可」という3つの根本的課題が判明

**判定フェーズの適用：**
CLAUDE.md の「同じ障壁で3回失敗したら判定フェーズへ」ルールに従い、外部短縮サービス依存型は**この方式は不採用と判定**。

**転換：データ保管型アーキテクチャ**
```
従来型（失敗）： [問題データ全部] → URL に詰め込む → 900字
新型（採用）：   [問題データ] → サーバー保存 / [合言葉] → URL に含める → 70字
```

**利点：**
- QRコード可読性の要件（40字程度）をクリア
- Cloudflare Workers KV で無期限保存（「消えるのは嫌」という要望に対応）
- 短いリンク生成後も「問題を直して作り直す」時にリンクが変わらない（セッション140の課題解決）
- サーバー不通時のフォールバック機能で、本番環境前でも安全に運用開始可能

**判定フェーズが価値を生んだ点：**
- 「とりあえず実装してみる」ではなく「3回の実験から本質的な設計課題を見つける」という思考プロセス
- 「できない技術」ではなく「設計を見直す」という発想の転換

**再発防止・ベストプラクティス：**
- 外部API依存設計は初期段階で「サービス終了リスク」を明示的に評価する
- 「できるか」だけでなく「運用コストと安全性」を検討する判定フレーム

**関連セッション：** セッション138-142（5セッション連続の施策と判定フェーズ）

**タグ：** #外部サービス #アーキテクチャ転換 #判定フェーズ #失敗学 #設計思考

---

## 外部APIの「Failed to fetch」は、ネット不通ではなくCORS非対応を疑う

**症状：** ブラウザから `fetch()` で外部APIを呼ぶと `Failed to fetch` になる。
ユーザーは「ネットには間違いなくつながっている」と言う。実際つながっている。

**原因：** 呼び出し先が **CORS（Cross-Origin Resource Sharing）に対応していない**。
別サイトのデータ取得はブラウザ側が安全のため遮断するので、通信自体が成立しない。
`Failed to fetch` はネットワーク不通と区別がつかないメッセージなので誤診しやすい。

**見分け方：** そのAPIのドキュメントに **`callback` パラメータ（JSONP）がある**なら、
CORS非対応の可能性が高い。JSONPはCORSが無い時代の回避策なので、
「わざわざJSONPを用意している＝CORSで取れない」という裏付けになる。

**対処：** `<script>` タグでの読み込み（JSONP）に切り替える。
`<script>` の読み込みはCORSの対象外なので通る。

```js
function jsonpRequest(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cbName = 'cb' + Date.now() + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    let finished = false;
    const cleanup = () => {           // ← 後片付けを必ず行う
      clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
    };
    const timer = setTimeout(() => {  // ← 応答が来ない場合に備えて必須
      if (finished) return; finished = true; cleanup();
      reject(new Error('応答がありません（時間切れ）'));
    }, timeoutMs || 15000);
    window[cbName] = (data) => { if (finished) return; finished = true; cleanup(); resolve(data); };
    script.onerror = () => { if (finished) return; finished = true; cleanup(); reject(new Error('つながりません')); };
    script.src = url + '&callback=' + cbName;
    document.body.appendChild(script);
  });
}
```

**注意点：**
- JSONPは応答が来なくても `onerror` が発火しないことがあるので、**タイムアウトは必須**
- コールバック名は毎回ユニークにし、成功・失敗どちらでも `window` から削除する（グローバル汚染防止）
- JSONPは外部のJSをそのまま実行する方式なので、**信頼できる相手にだけ**使う

**エラー文言の教訓：** 「ネットにつながっていない可能性があります」と書いたせいで、
ユーザーを混乱させた。外部サービス連携の失敗メッセージは
**「サービス側につながらないだけで、ネットの不調とは限りません」**と書くべき。

**タグ：** #CORS #JSONP #fetch #外部API #エラーメッセージ

---

最終更新：2026-08-22（セッション140で新規追記）

新しいエントリは **先頭に追加** する。プロジェクト名を必ず記載。

---

## 環境・ネットワーク制限

### [2026-08-22] crossword — 短縮URL実装後、テスト環境で外部サービス(`is.gd`)の動作確認ができず

**状況：** リンク短縮機能に `is.gd` API を統合し、279文字のリンクを20文字に短縮できる実装を完成させたが、**作業環境で外部通信がHTTP 403でブロック**されているため、実装検証ができない

**問題：**
- `fetch('https://is.gd/create.php?...')` → HTTP 403 Forbidden
- テスト環境での検証は「応答を偽装」で代用（実装ロジックの正しさは証明できるが、実際の短縮結果は未検証）
- 本番環境での動作確認には伊神さんのPC（学校ネットに接続）での実テストが必須

**判断・対応方針：**
- 実装は完成したが「検証待ち」の状態で展開
- フォールバック設計：短縮に失敗しても長いリンク + QRコード を常に表示
- UI に「学校のネットでブロックされる可能性」「サービス終了のリスク」を明記
- **本番運用前に、生徒に配る前に、学校ネットから実際に開けるか確認必須**

**再発防止：**
- 外部サービス依存の機能は、開発環境でのテストに「応答偽装」を使用
- 本番テストは「実際のネットワーク環境で行う」を手順化
- 失敗時の代替手段（QRコード）を必ず用意

**関連セッション：** セッション138（リンク圧縮・gzip実装）→ セッション139（QRコード実装）→ セッション140（外部URL短縮試行・外部通信ブロック発見）

**タグ：** #external-service #network-blocked #deployment #testing #fallback

---

### [2026-08-22] crossword — リンク100文字以内要件が数学的に不可能であることの発見・判定

**症状：** 伊神さんから「100文字以内のリンクにしたい」という要望が出て、複数の短縮案（URL圧縮、辞書化、ハッシュ化）を試みたが、いずれも失敗

**調べ方：** 「学校」の問題を分解分析
```
クロスワード問題データ（URL内埋め込み）
├── カギ（ヒント）12個分：721バイト ← 最大の部分
├── 語と位置のメタデータ：271バイト
├── 合計（gzip圧縮済）：約590バイト
```

**結果：数学的に不可能**
- base64 エンコード後：約787文字（591×4/3）
- gzip + base64：約580文字（既に圧縮済み）
- 辞書化試案：「語を番号に置き換え」で791→746文字（45文字削減のみ）
- テキスト本体が短縮できないため、URL全体を20分の1にする必要性と矛盾

```
https://gamigamiigami.github.io/Workspace/projects/crossword/#
└─ ベースURL だけで既に61文字
残り: 100 - 61 = 39文字 = 約28バイト
必要: 590バイトを28バイトに ← 数学的に不可能
```

**判断・対応方針：**
- **100文字以内は技術的に不可能と判定** → QRコード + 物理媒体配布で解決
- 短縮URL（`is.gd`）は「二次的な便宜」として機能追加（失敗時も長いリンクで対応）
- ユーザーへの説明：「テキスト本体が短縮できないのに、URL全体を圧縮するのは無理」と言語化

**教訓：**
- 「とにかく短くしたい」という要望に対しては、**物理的・数学的に不可能な領域があることを事前に伝える**
- 素朴な短縮よりも、配布方法や代替UI（QRコード）でのUX改善が効率的

**関連セッション：** セッション138（リンク圧縮実装開始）→ セッション139（QRコード実装）→ セッション140（短縮限界の分析・判定）

**タグ：** #requirement-analysis #mathematical-limit #ux-design #qr-code

---

### [2026-08-22] crossword — GitHub案（プライベートリポジトリ運用）を取り下げた理由

**状況：** リンク短縮の課題に対して「**GitHub Org で問題データを一元管理し、生徒用リンクで短い参照URLを発行する**」という案を提案したが、伊神さんに指摘されて取り下げた

**問題：**
- 提案の前提：「**著作権や問題の再利用を管理するため、伊神さん個人のリポジトリで集中管理したい**」という想定
- 実際の用途：「**複数の先生が自分の問題を作って生徒に配る**」 ← ユーザー層を見誤った
- GitHub案だと、他の先生が作った問題を置く仕組みがない → 「伊神さんだけ」の運用に限定される

**判断・対応方針：**
- 設計案を正式に取り下げ、`mistakes.md` に記録（セッション143で記録予定）
- 代替案：各先生が独立して問題を作成・配布できるツール設計に振り直す
- クロスワードサポーターは「ツール＋ QRコード配布」で十分

**教訓：**
- 「セキュリティ・管理がしやすい設計」と「実際のユーザー層」が一致するか、必ず確認する
- 提案前に「誰がこれを使うのか」「他の先生でも使える仕組みか」を明示的に確認する

**タグ：** #requirement #user-research #design-mistake #github

---

### [2026-08-22] crossword — 日本語入力（IME）の変換中の文字が1マスずつ確定されてしまう

**症状：** 配布リンクの解答モードで、PCで「た」と打つと1マス目に「t」、2マス目に「た」が入る。
スマホでは同じ文字が繰り返し入る。

**原因：** 1マス1文字の入力欄で `input` イベントを見て即座に確定していた。
日本語入力は**変換中にも `input` が発火する**ため、ローマ字の途中（t）や予測変換の途中（こ→こく→こくご）が
そのまま確定されてしまう。`maxlength="1"` も変換の文字数を制限してじゃまをしていた。

**対応：**
```js
let composing = false;
si.addEventListener('compositionstart',  () => { composing = true; });
si.addEventListener('compositionupdate', () => { composing = true; });
si.addEventListener('compositionend', (e) => {
  composing = false;
  commitText(e.data || si.value);   // 変換が終わった文字だけを確定する
  si.value = '';
});
si.addEventListener('input', (e) => {
  if (composing || e.isComposing) return;   // 変換中は何もしない
  commitText(si.value); si.value = '';
});
```
- `maxlength="1"` は**外す**（変換のじゃまになる）。文字数は自分で扱う
- 確定が2文字以上（「たけ」）なら、続けて次のマスに入れる → かえって入力が速くなる
- 次のマスが無ければ残りは捨てる（最後のマスを上書きしないため）

**教訓：** 日本語を1文字ずつ受け取るUIは、必ず `compositionstart` / `compositionend` で
変換中を除外する。`input` だけを見ていると、日本語環境でのみ壊れる。

---

## パズル生成・アルゴリズム

### [2026-08-22] crossword — 新しい制約を足したら既存の「最適化」が逆効果になった

**症状：** 盤面の大きさ上限機能を実装した直後、8×8に設定しているのに4×6にしか盤面を使わず、語数が5語に減った。
新機能のバグか？と疑った。

**調べ方：** 同じ語で上限あり／なしの生成結果を並べて見比べた。上限ありのほうが盤面を使わず語数も少ない
→ 盤面を広げるより「なるべく小さくまとめる」が優先されていると分かった。

**結果：** バグではなく、既存の設計との矛盾だった。
- **制限なしの時代**：「小さくまとめる」は美点（印刷用紙に収まるメリット）
- **上限を決めた今**：上限の枠いっぱいに使う方が、語数が増えて質が高まる

**対応：**
- 面積のペナルティを大幅に弱めた（重み付けを10倍以上軽減）
- 結果：同じ語で5語→7語に回復 ✅

**教訓：**
- **制約を追加するときは、既存の報酬関数の定義を見直すこと**
- 「最適化」は制約状況に依存する。制約が変わったら、目的関数も変わる可能性がある
- 特に「小さい＝良い」「大きい＝悪い」といった単純な価値観は、制約追加で反転することがある

**タグ：** #algorithm #constraint #reward-function #optimization

---

## Claude Code 権限・セッション管理

### [2026-07-02] セッション終了処理時に Bash 権限が auto モードで制限される

**状況：** セッション終了フック（Stop hook）が自動的に実行される際、後続の git push を含む自動保存スクリプトが Bash 権限制限に引っかかり、完全実行されない

**問題：**
- セッション107・108・109 の終了処理で、git merge / git push / git add などが permission deny で実行されず
- セッション終了フック内の自動化スクリプトが Bash 権限を要求すると、permission_mode: "auto" の制限により「ユーザー確認待ち」→「タイムアウト」となり、スクリプト中断
- task-diary.md など knowledge/ の変更がローカルに残ったまま、remote に push されない状態が続く

**原因：**
```
Claude Code のセッション終了メカニズム：
├── Stop hook が自動発火（permission_mode: auto）
├── セッション終了処理スクリプト内で Bash を多用
├── Bash の permission_mode: auto により「実行か拒否か」の判定が入る
├── セッション終了フロー中に permission prompt が発生すると、タイムアウト待ち状態に
└── ユーザーが応答できないため、スクリプトが部分実行で終了 → push されず残る
```

**判断・対応方針：**
- セッション終了処理を Bash フル依存から、Read/Edit/Grep/Write などのツールベースに段階的に移行
- git status / git diff は Bash ではなく、スクリプト出力を必要に応じて Glob/Grep で補完
- git push は最後に「ユーザー確認が必要な手動コマンド」として手順化（自動化から除外）

**再発防止：**
- セッション終了フック内のスクリプトは「高頻度 Bash 呼び出し」を避ける
- permission_mode: auto でも実行可能な tool 組み合わせで手順を再設計
- 本格的には permission_mode を「session-level で auto → manual への変更」検討

**関連セッション：** セッション107（初発見）→ セッション108（再現・パターン化）→ セッション109（再現・確認）→ セッション110（継続）→ セッション111（再確認・競合解決処理で顕在化）→ セッション115（マージ競合解決・非破壊的修正成功：knowledge/log.md の `=======` と `>>>>>>> claude/educational-game-middle-school-102jqo` を Edit ツールで除去。Bash 権限不要な Edit/Read/Grep による対応が有効であることを再確認）→ セッション116（Bash 権限制限下でも Read/Grep/Glob/Edit ツールによる状態確認・記録が可能であることを実証）

**タグ：** #claude-code #session-hooks #bash #permission #automation #git-push

---

## GitHub Pages デプロイ

### [2026-06-10] hinshi-panic — GitHub Pages は environment 保護ルールで「許可ブランチ以外」からのデプロイが即失敗する

**状況：** 品詞パニックを GitHub Pages に公開するため、開発ブランチ（`claude/educational-game-middle-school-102jqo`）をデプロイワークフローの `on.push.branches` に追加してプッシュした

**問題：**
- ワークフローは起動したが**3秒で failure**（created 11:10:32 → updated 11:10:35）
- ジョブのログが存在しない（ログ取得が HTTP 404）＝ジョブの中身が一切実行されていない
- 公開URLは404のまま

**原因：**
- `github-pages` environment には**デプロイ許可ブランチの保護ルール**があり、許可外ブランチからの `deploy-pages` は環境チェックの段階で拒否される
- ワークフローYAMLの `branches:` にブランチを足しても、environment 側の許可リストは別物
- このリポジトリで Pages デプロイが許可されているのは運用ブランチ `claude/workspace-knowledge-base-setup-ccVKP` のみ（rough・dashboard の成功実績はすべてこのブランチ）

**解決策：**
- 開発ブランチを運用ブランチ（`claude/workspace-knowledge-base-setup-ccVKP`）にマージしてプッシュ → デプロイ成功
- 公開URL：https://gamigamiigami.github.io/Workspace/hinshi-panic/

**再発防止：**
- **新プロジェクトを Pages 公開するときは、ワークフロー修正だけでなく「運用ブランチへのマージ」までがデプロイ手順**
- 「数秒で failure ＋ ジョブログなし」は environment 保護ルール拒否のサイン（コードのバグではない）
- デプロイ失敗時はまず GitHub Actions の実行一覧で「どのブランチからの実行が成功しているか」を見る

**タグ：** #github-pages #github-actions #environment-protection #deploy #branch

---

## パズル生成・アルゴリズム

### [2026-08-21] crossword — 「共通文字がある＝クロスワードにできる」ではない

**症状：** `きせき・ちゅうがっこう・きゅうしょく・せんせい` の4語。全部が共通文字でつながっているのに、
自動生成が6回とも `せんせい` を置けなかった。生成アルゴリズムのバグを疑った。

**調べ方：** Pythonで**全探索**（最初に置く語4通り × 以降すべての交差配置をDFS）して、
成立する配置が存在するかを確認した。

**結果：バグではなかった。** この4語では、クロスワードとして成立する置き方が**1つも存在しない**。
理由は、`せんせい` が `せ`（＝`きせき`の中央）でしかつながれず、
`きせき` は両端の `き` で他の語と交差するため、`せ` の上下左右が必ず塞がるから。
（クロスワードの基本ルール「交差しないマスの真横に文字を置かない」による）

**対応：**
- 診断を「共通文字がある」から「**実際に組めるかは別**」に言い換え、
  **1種類の文字でしかつながらない語を事前に警告**するようにした
- 入らなかった語には「**つなぐ語をさがす**」を出し、辞書から候補を集めて
  **実際に足して組めるか検証**してから◎印で提案する（例：「しんかんせん」で5語すべて成立）

**教訓：**
- 「アルゴリズムが悪い」と決める前に、**そもそも解が存在するかを全探索で確かめる**
- 存在しないなら、直すべきはアルゴリズムではなく**ユーザーへの説明と代替案の提示**

---

## ブラウザUI・入力

### [2026-08-21] crossword-supporter — pointerdown 内の focus() はブラウザに打ち消される

**症状：** マスをタップしたら記号入力欄（重ねた `<input>`）にフォーカスを当てる実装で、`pointerdown` の中で `input.focus()` を呼んでいるのに、**キー入力がどこにも入らない**（ヘッドレステストでも `state.marks` が空のまま）。

**原因：** `pointerdown` の直後にブラウザが互換の `mousedown` を発火し、その**既定動作がフォーカスを移動させる**（クリックした要素／body へ）。自分で当てたフォーカスがその後に奪われる。

**解決策：** `pointerdown` で `e.preventDefault()` してから `focus()` する。
```js
grid.addEventListener('pointerdown', (e) => {
  e.preventDefault();   // これがないと直後にフォーカスを奪われる
  openMarkInput(r, c);  // 中で input.focus()
});
```

**別解：** `setTimeout(() => input.focus(), 0)` でフォーカス処理を後ろにずらす。ただし preventDefault のほうが確実。

**教訓：** 「重ねた input にフォーカスを当てる」系は、**必ず実際にキー入力まで通して検証する**。focus() が呼ばれたことだけを確認しても動作確認にならない。

---

## 環境・ネットワーク制限

### [2026-06-09] Claude Code 実行環境 — 外部サイトアクセスの全面ブロック（WebFetch/WebSearch 非機能）

**状況：** Rough（ボドゲ会ウェブサイト）のゲームカード画像を、BoardGameGeek（BGG）やAmazonから自動取得するため、WebFetch/WebSearchの複数試行を実施

**問題：**
- WebFetch を使用して `https://www.boardgamegeek.com/xmlapi2/...` にアクセス → HTTP 403 Forbidden
- Amazon.co.jp の商品ページ取得 → HTTP 403 Forbidden
- WebSearch の結果も「外部サイト照会用」で、実データ取得には WebFetch が必須だが全面ブロック
- 実装環境として「WebFetch/WebSearch ツールは定義されているが、実行時のネットワーク設定により全面的に機能しない」

**原因：**
```
Claude Code 実行環境（/home/user/Workspace で実行）
├── ツール定義レベル：WebFetch, WebSearch は Tool として定義済み
├── 実行時ネットワーク：すべての商用サイト（Amazon, BGG, など）への outbound がファイアウォール/プロキシ設定でブロック
└── 代替手段がない：CLI curl/wget での直接実行も同じブロック設定に従う
```

**判断・対応方針：**
- 完全自動取得は技術的に不可能と判定
- 代替実装：UIで「BGG画像URL手動入力フロー」を提供（ユーザーがブラウザで BGG を開く → URL コピペ → フォーム入力）
- 現在のカラーアイコンバッジ実装で十分実用的なため、BGG画像なしで運用継続

**再発防止：**
- 「自動取得が必要な外部API/データ」について、事前に「Claude Code 環境でアクセス可能か」を実証してから設計開始
- WebFetch が必須な実装は初期検討段階で環境制限を確認

**関連セッション：** セッション76（初発見）→ セッション77（カラーアイコン代替案実装）→ セッション79（複数手段再試行して完全ブロック確定）

**タグ：** #claude-code #environment #network-restriction #webfetch #automation #fallback #ux-workaround

---

## SNS/ソーシャルメディア

### [2026-06-08] rakuda-sensei — Facebookメールアドレスロック：Meta Developer認証を進めるうえでの予期しない障壁

**状況：** Instagram/Threads自動化のためのMeta Developer App作成フロー（STEP 3）を進行中、Facebookアカウント側でメール認証を求められた

**問題：** 
- Facebookアカウントの登録メールアドレスが使用不可状態（既に手放したメアド、アクセス困難）
- メールアドレス変更を試みても、変更確認時に「登録元アドレスへ認証コードを送信」という仕様のため、ループに陥る
- アカウント全体が「ほぼ半ロック状態」となり、Facebookログイン→各種認証の進行が完全にストップ

**原因：** 
```
① 既存Facebookアカウントの設計：
   - ユーザーがかつて使用していたメールアドレスでFacebookアカウント登録
   - そのメールアドレスはもはや利用できない状態

② Meta側のセキュリティ仕様：
   - メールアドレス変更時に「登録元メールアドレスへの認証コード送信」が必須
   - メール受信不可 → 認証コード入力不可 → メール変更不可、という設計欠陥的なループ

③ Meta Developer 認証タイミング：
   - Facebookページ作成後ではなく、Meta Developer App作成時に突然この認証が要求される
   - 事前スクリーニングされていない（複数セッションで段階的にFacebookアカウント整備していたため、
     この障壁が最後の段階で露出）
```

**判断・対応方針：** 
- このセッションでは解決困難と判定（ROI悪い）
- 別日に Facebook Help Center（https://www.facebook.com/help/）から「メールアドレスにアクセスできない」で申請
  - 数日〜1週間で解決する可能性が高い
- 並行して以下の対応を検討：
  - **新規Facebookアカウント作成** してMeta連携をリセット
  - またはThreads単独での自動化（Instagramを後日追加）で現在の自動化を先行実装

**再発防止：** 
- Meta Developer App作成前に「Facebookアカウント・メール状態の完全チェックリスト」を実施
  - メールアドレス受信可能か？メール変更が必要か？を事前スクリーニング
- 初回メール設定が重要（セッション33での「副業用メール選択」の段階で、メール受信可能性を確認すべき）
- Meta周辺は複数セッションにわたる作業のため、途中段階で「現在のアカウント状態」を記録しておく

**タグ：** #facebook #meta #authentication #email-recovery #sms-verification

---

## GitHub Actions

### [2026-05-31] addness-side-income — GitHub Actions で issue:write 権限が明示的に必要

**状況：** GitHub Actions ワークフロー（`post-to-x.yml`）内で GitHub Issue を自動作成する機能を実装

**問題：** 
- Issue 作成時に以下のエラーが発生
  ```
  GraphQL: Resource not accessible by integration (createIssue)
  ```
- ワークフロームの `permissions` セクションで権限を指定していない状態

**原因：** 
- GitHub Actions の `GITHUB_TOKEN` はデフォルトで `contents: read` のみ持つ
- Issue 作成（`createIssue` GraphQL mutation）には明示的に `issues: write` 権限が必要
- ワークフロー YAML の `permissions` セクションに `issues: write` を記載していなかった

**解決策：**
```yaml
jobs:
  post-to-x:
    runs-on: ubuntu-latest
    permissions:
      contents: read    # コード読み込み用
      issues: write     # Issue 作成用（これが必須）
    steps:
      - uses: actions/checkout@v3
      - name: Post to X and create issue
        run: python scripts/post_to_x.py
```

**再発防止：**
- GitHub Actions で外部リソース操作が必要な場合は、各操作に対応する `permissions` フラグを事前に調べて記載
- よく使う権限セット：
  - `contents: read` — リポジトリコード参照
  - `contents: write` — コミット、PR作成
  - `issues: write` — Issue作成・更新
  - `pull-requests: write` — PR操作
  - `secrets: read` — Secret参照（デフォルトで有効）

**タグ：** #github-actions #permissions #issue #automation

---

## 自動化・ROI判定

### [2026-06-02] rakuda-sensei — BOOTH完全自動出品：自動化コストが手動運用を上回ったケース

**状況：** BOOTH へのシステム販売品完全自動出品（商品情報入力 → 説明文 → PDF添付 → 出品ボタン押下まで）を 5 セッション（セッション9-13）にわたって自動化しようとした

**問題：** 
- セッション12まで30時間以上を投資
- セッション13で「出品ボタン押下後、実際には出品されていない（サイレント失敗）」という障壁を検出
- PDF自動アップロード、ファイル形式検証、ボタンのアクティブ状態判定など、複数の未知の障壁が次々と発見
- 3回のワークフロー実行で同じ失敗パターン（サイレント失敗）が再現

**原因（複合要因）：** 
```
① 仕様不明確：
   - BOOTH の出品フロー仕様が公開ドキュメント化されていない
   - PDFが必須なのか、どの段階でファイル検証が走るのか不明
   - 複数のUI段階（プルダウン、ラジオボタン、テキスト入力、ファイルアップロード）で
     各々の依存関係・バリデーション順序が不明

② 自動化の複雑性：
   - 複数のページ遷移 + 動的UI + ファイルアップロード + 外部システム連携（BOOTH在庫DB）
   - Playwright でセレクタ検出（複数パターンフォールバック）+ スクショ + ダンプ出力などの
     診断ロジックを実装しても、実際の出品完了まで観測できない
   - テスト環境なし（本番環境のみ、出品実績が留まる）

③ ROI 計算の過小評価：
   - 初期見積：「複数の出品フロー統合で 月50件の自動化」
   - 実績：月3-5件程度（新カリキュラム開発頻度）
   - 実装投資：セッション9-13で 30時間
   - 月次運用コスト（保守・デバッグ）：5時間以上（新障壁検出ごとに対応）
```

**解決策（撤退判断）：** 
```
BOOTH 完全自動化は断念 → 現実的なハイブリッドモデルへ転換：

旧：[AI] → [Playwright自動出品] → [完成]（失敗が頻発）

新：[AI] → [商品HTML生成] → [GitHub Issue自動起票] → [人間2-3分] → [完成]
              ↑完全自動        ↑100%成功                 手動出品フロー
                              （リマインダー機能）      （BOOTH フォーム入力）

時間コスト比較：
- 旧：初期30時間 + 月5時間保守 = 月5時間，ROI逆転点150ヶ月（12年）
- 新：初期5時間（Issue テンプレ） + 月0.2時間（Issue作成） + 月0.5時間（手動出品10分×4週）
     = 月0.7時間，ROI正転状態

差分： 月 4.3時間 削減 = 年 51.6時間 削減
```

**再発防止（自動化 ROI 判定基準）：** 
```
≥ 3回同じ障壁で失敗 → スコープ見直しフェーズへ（自動化完全化を放棄）

判定軸（セッション12-13で実装されるべきだった）：
1. 「技術的に解決可能か」
   - セッション9-11：「実装パターンはある」と判断 → 続行
   - セッション12：失敗から「仕様不明確 + 本番環境のみ」と判明 → 警告レベル「黄」
   - セッション13：3回失敗でテストモルモット状態が確定 → 判定「赤・スコープ縮小へ」

2. ROI が正の領域か
   - 月次利用量 × 自動化で削減される時間 > 初期実装 + 月次保守
   - rakuda-sensei BOOTH：月3-5件 × 3分 = 月15分 < 月5時間保守（大赤字）

3. テスト環境が存在するか
   - note：下書き投稿でテスト可能 → 自動化適性「高」
   - BOOTH：本番在庫システム直結（テスト環境なし） → 自動化適性「低」
   - 要件：「Staging 環境で100回テスト後，本番導入」くらいの余裕が必要
```

**タグ：** #automation #roi #business-judgment #deployment #testing

---

## テンプレート

```
### [YYYY-MM-DD] プロジェクト名 — タイトル

**状況：** どういう実装をしようとしていたか

**問題：** 何が起きたか

**原因：** なぜ起きたか

**解決策：** どう直したか

**再発防止：** 次回から気をつけること

**タグ：** #css #javascript #ios など
```

---

## 自動化の根本的限界

### [2026-05-31] rakuda-sensei — Playwright bot検知回避とクッキー自動取得の根本的限界

**状況：** note.com へのクッキー自動取得を Playwright で実装しようとした（セッション自動化の一環）

**問題：** 
- Playwright での自動クッキー取得を検討したが、実装不可であることが判明
- 過去の「bot検知対策（playwright-stealth）」では解決できない層がある

**原因：** クッキー取得フローには、技術対策では補えない3つの制約がある：
```
① クラウド実行環境からブラウザアクセス不可
   → AI実行環境（クラウドコンテナ）にはGUIがない
   → note.comのログインフォームは JavaScript ベースで人間のブラウザ操作を要求

② IP ベースのブロック
   → データセンター IP は自動的に reCAPTCHA 直撃判定される
   → Playwright の navigator 偽装では IP は偽装不可
   → 複数のbotサイネチャ（headless + IPアドレス）の組み合わせで検知

③ セキュリティ設計の制約
   → クッキー取得にはパスワード/2FA が必要な場合がある
   → AI には本人のパスワード共有は避けるべき（セキュリティポリシー推奨）
```

**解決策：** 
ユーザー（本人）がブラウザでログイン済みの状態を活用する運用フロー：
```
1. ユーザーがブラウザで note.com にログイン
2. Cookie-Editor 拡張機能でクッキーを JSON エクスポート
3. その JSON を GitHub Secrets に登録
4. Playwright スクリプトが Secrets から読み込んで使用
```

**再発防止：** 
- 「自動化できない業務」の判定軸：
  ✗ 本人認証（初回ログイン、2FA、デバイス登録）→ 人間操作必須
  ✗ ブラウザのセッション/クッキー取得 → 本人ブラウザのみ
  ✓ クッキー取得後の操作（投稿、ページ遷移） → Playwright で自動化可能

- 多層防御（IP + 振る舞い + 認証状態）には、すべての層を同時にクリアする必要がある
  → IP 偽装は無理だが、クッキーで既に認証済み状態をシミュレートできる

**タグ：** #automation #security #playwright #bot-detection #cookies

---

## GitHub Actions & 自動投稿

### [2026-05-31] rakuda-sensei — GitHub Actions 自動投稿での Secrets 未登録 / パスワード違いエラー

**状況：** GitHub Actions で BOOTH / note への自動投稿ワークフローを実装し、実行した

**問題：** 
- BOOTH投稿が管理画面に「何も表示されない」状態
- note投稿が管理画面に「何も表示されない」状態

**原因：** 
1. BOOTH：ショップのサブドメイン（`rakuda-sensei`）が設定されていない
2. note：GitHub Secrets で `NOTE_EMAIL` / `NOTE_PASSWORD` が登録されていない、または パスワード相違

**解決策：** 
1. BOOTH の場合：`https://manage.booth.pm/settings` → ショップURL欄に サブドメイン名 を入力して保存 → ワークフロー再実行
2. note の場合：`https://github.com/{owner}/{repo}/settings/secrets/actions` で Secrets登録状況を確認 → `NOTE_EMAIL` / `NOTE_PASSWORD` が存在するか確認 → 存在しない場合は登録 → ワークフロー再実行
3. 詳細なエラーメッセージは GitHub Actions ログの「最後10行」を見る

**トラブルシューティング手順：**
```
① Secrets確認ページを開く
   https://github.com/{owner}/{repo}/settings/secrets/actions

② 「Repository secrets」セクションで以下が表示されているか確認：
   - NOTE_EMAIL
   - NOTE_PASSWORD
   （存在しない場合は New repository secret ボタンで追加）

③ ワークフロー実行ログを確認
   https://github.com/{owner}/{repo}/actions/workflows/post-to-note.yml
   → 最新の run をクリック
   → post ジョブをクリック
   → "Post to note.com" ステップを展開
   → ログの最後10行を確認
   
④ ログに表示される内容で原因確定：
   - "NOTE_EMAIL が設定されていません" → Secrets 未登録
   - "noteログイン失敗" → パスワード相違
   - "✅ noteログイン成功" → 問題なし（投稿は発生している）
```

**再発防止：** 
- 新しい自動投稿ワークフロー追加時は、Secrets登録 → ワークフロー実行 → ログで「成功」確認 を初回セットアップフロー化する
- ログの「最後10行」を見ることが最速の原因特定方法

**タグ：** #github-actions #automation #secrets #troubleshooting

---

### [2026-05-31] rakuda-sensei — Playwright による headless Chrome bot検知の回避策

**状況：** GitHub Actions 上で Playwright を使って自動投稿ワークフローを実装している。note・BOOTH はブラウザからのアクセスを自動化で検知して拒否する可能性がある。

**問題：** 
- Playwright (headless mode) は `navigator.webdriver === true` で検知される
- bot検知エンジンが複数のシグナルを監視している可能性が高い

**原因：** 
Playwright のデフォルト設定では以下が bot と判定される：
```javascript
navigator.webdriver === true  // Playwright特有
chrome.webstore === undefined  // Chromium特有
window.chrome === undefined    // bot検知シグナル
navigator.plugins.length === 0 // bot特性
```

**解決策：** 
Playwright 起動時に以下の偽装を実装：
```python
# post_to_note.py の browser 起動部分
browser = await playwright.chromium.launch(
    headless=True,
    args=[
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check'
    ]
)

context = await browser.new_context(
    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
)

# ページ開く前に偽装スクリプトを注入
await page.add_init_script("""
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });
  window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3],
  });
  Object.defineProperty(navigator, 'languages', {
    get: () => ['ja-JP', 'ja', 'en-US', 'en'],
  });
""")

context = await browser.new_context(...)
page = await context.new_page()
await page.add_init_script(...)  # スクリプト注入
```

**注意点：**
- bot検知ロジックは各サイトで秘匿されている → 完全な防御は不可能
- IP ベースのブロック（GitHub Actions IPが既にブロックリストに入っている場合）には対応不可
- UI 構造の大幅変更には複数セレクタ候補でカバーしきれない可能性がある

**事前診断ワークフロー（check-cookies.yml）の導入：**
- 本番投稿前に「認証テストのみ」を実行するワークフローを追加
- クッキー形式の正規化確認 + ログイン状態確認 + screenshot 取得
- このステップで認証OK → 本番実行時の成功確率が大幅向上
- 失敗時は screenshot artifact で実際の画面が可視化できるため、UI構造の変更検知が容易

**トラブルシューティング手順（ユーザー向け）：**
```
① Cookie-Editorで取得したクッキーを GitHub Secrets に登録
   https://github.com/{owner}/{repo}/settings/secrets/actions
   → NOTE_COOKIES（JSON形式）

② 事前診断ワークフローを実行
   https://github.com/{owner}/{repo}/actions/workflows/check-cookies.yml
   → Run workflow → Artifacts でスクリーンショット確認
   → ✅ ログインOKの確認

③ スクリーンショットで実際の画面確認
   - note・BOOTH の「認証後」画面が表示されているか
   - UI構造に変化があれば、セレクタを修正

④ 本番投稿ワークフロー実行
   https://github.com/{owner}/{repo}/actions/workflows/post-to-note.yml
```

**再発防止：** 
- bot検知は「試してみるしかない」ため、GitHub Actions環境での実機実行が必須
- 「クッキー認証+事前診断」パターンを標準フロー化する
- UI構造変更は定期的に事前診断で監視

**タグ：** #playwright #bot-detection #github-actions #automation #resilience

---

## セッションスクリプト・自動化

### [2026-05-24] workspace-setup — Stop フックは「セッション終了時」ではなく「Claudeの返答後」に毎回発動

**状況：** セッション終了時に自動振り返り・知識追記を行う Stop フック（agent型）を実装しようとした

**問題：** Stop フックが「セッション終了時」ではなく「Claudeの返答後」に毎回発動することに気づいた。1回の会話で何度も振り返り処理が実行されてしまい、トークン無駄遣い・不要な git commit が多発する

**原因：** Claude Code の stop_hook は「セッション終了時」ではなく「AI返答終了時」に呼ばれる設計。つまり「伊神さんが質問→Claude返答→Stop発動」が1ターンあるたびに動く

**解決策：**
- Stop フックを「軽量な commit & push のみ」に限定（AI振り返りなし）
- 知識の振り返り・追記は手動スキル `/wrap-up` として実装
- 伊神さんが「今日終わり」と思ったときだけ `/wrap-up` を呼ぶ運用に変更

| 役割 | 方法 | タイミング |
|---|---|---|
| commit & push（自動） | Stop フック（コマンド型） | 毎ターン後・軽い |
| 知識の振り返り・追記（手動） | `/wrap-up` スキル | 伊神さんが「今日終わり」と思ったとき |

**再発防止：** 自動化スクリプトは「毎回実行→トークン無駄遣い」という落とし穴がある。毎回vs手動のバランスを最初に検討する

**タグ：** #automation #hook #claude-code #workflow

---

## 既知の注意事項（初期登録）

### [2026-05-23] 共通 — 日本語フォントの縦書き指定はブラウザ依存に注意

**状況：** CSS `writing-mode: vertical-rl` で縦書きレイアウトを実装

**問題：** ブラウザ・OS によって文字の向きや行間が異なる表示になる

**原因：** 縦書きのフォントレンダリングはブラウザ実装差が大きい

**解決策：** 縦書きを使う場合は Chrome / Firefox / Safari / iOS Safari の4環境で確認する

**再発防止：** 縦書きレイアウトが必要かどうか事前にユーザーに確認し、代替として横書き＋回転を検討する

**タグ：** #css #font #cross-browser

---

### [2026-05-23] 共通 — iOSでのtouchイベントはpassive:trueが必要な場合あり

**状況：** スクロール中のタッチ操作を `touchstart` / `touchmove` で制御しようとした

**問題：** iOS Safari でスクロールがカクつく、または警告が出る

**原因：** iOS はデフォルトでパッシブイベントを期待しており、`preventDefault()` を呼ぶと競合する

**解決策：**
```javascript
// passiveを明示する
element.addEventListener('touchstart', handler, { passive: true });

// preventDefault()が必要な場合はpassive:falseを明示
element.addEventListener('touchmove', handler, { passive: false });
```

**再発防止：** タッチイベントを使う際は最初から `passive` オプションを意識する

**タグ：** #javascript #ios #touch #performance

---

### [2026-05-23] 共通 — localStorageはプライベートモードで動作しない

**状況：** スコアや進捗を `localStorage` に保存する実装をした

**問題：** プライベート（シークレット）ブラウジングモードでエラーが発生し、ゲームが動かなくなる

**原因：** プライベートモードでは `localStorage` へのアクセスが制限・禁止される場合がある

**解決策：**
```javascript
// localStorage使用前にtry-catchで保護する
function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // プライベートモードや容量超過の場合は無視して続行
    console.warn('保存できませんでした:', e);
  }
}

function loadData(key, defaultValue) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}
```

**再発防止：** `localStorage` を使う場合は必ず try-catch で囲む

**タグ：** #javascript #localstorage #private-mode

---

## 関連リンク

- 成功パターン集 → [patterns.md](./patterns.md)
- コーディング規約 → [rules.md](./rules.md)

## 2026-08-28 activeElement ガードでボタンの再描画まで止まった

**症状**：マイ辞書の「消す」を押してもデータは消えるのに、一覧の行が消えない。

**原因**：入力中の再描画を防ぐために
`if (box.contains(document.activeElement)) return;` と書いた。
ボタンをクリックすると**そのボタン自身が activeElement になる**ため、
削除後の `renderMyDict()` が毎回この行で止まっていた。

**対策**：守りたいのは「文字入力の中断」だけなので、INPUT に限定する。

```js
const act = document.activeElement;
if (act && act.tagName === 'INPUT' && box.contains(act)) return;
```

**教訓**：`contains(document.activeElement)` は「入力中か」ではなく
「その中の何かにフォーカスがあるか」。ボタンもフォーカスを取る。
