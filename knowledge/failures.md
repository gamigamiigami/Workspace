# 失敗・ハマりポイント集

最終更新：2026-06-08

新しいエントリは **先頭に追加** する。プロジェクト名を必ず記載。

---

### [2026-06-08] addness-side-income — note SNSプロモ自動投稿と post_note_promo.py の X 投稿が二重に走っていた

**状況：** note 記事を publish した時点で、note の「SNSプロモ連携」が自動的に著者の X アカウントから告知ツイートを投稿する（`twitter_status_posted` フラッシュキーで検知）。にもかかわらず `post_note_promo.py` でも独自に X compose 経由でツイートを送っていた。

**問題：**
- 同じ note 記事に対して、note 純正の自動投稿 + post_note_promo.py の投稿 = **2回ツイート**
- X 側のセレクタ修正・post_to_x.py 流用などのデバッグ工数が無駄になっていた
- 真の責務分離が見えていなかった

**正しい責務分担：**
- **X (note 記事告知)**: note の SNSプロモ連携が publish 時に自動投稿（人間/AI 介入不要）
- **X (日次運用ツイート)**: `post_to_x.py` が cron で `weekly/*-x-posts.md` から抽出して投稿
- **Threads**: note が対応していないので `post_note_promo.py` が Meta Graph API で投稿
- **post_note_promo.py の X 機能**: ❌ 削除（重複投稿の原因）

**教訓：**
- 「自動化が部分的に動いてる」状態で別経路の自動化を追加する前に、**先に重複していないか確認**
- ベンダー (note) が標準で持つ機能を、自前で再実装しない
- 「投稿ボタンが見つからない」エラーは、まず「そもそも投稿する必要があるか」を疑う

**対応：** post_note_promo.py から X 関連コード一式を削除。post-note-promo.yml の X_SESSION_COOKIE secret も外した。

---

### [2026-06-07] addness-side-income — note 公開後の後続クロスポスト（post_note_promo.py, post_to_x.py）が部分失敗

**状況：** note 記事の公開が成功したが、GitHub Actions ワークフロー（RUN_ID: 27107153214）内で、その後の「クロスポスト追加投稿」機能が失敗

**問題：**
1. **post_note_promo.py の失敗（Threads への投稿）**
   - 元記事URL置換が失敗：`https://note.com/large_pika8608/n/n96918f980528?flash_message_key=twitter_status_posted%3Fapp_launch%3Dfalse` というクエリパラメータ付き URL が「URL形式が正しくありません」で弾かれた
   - x-variants.md から本文抽出失敗：X 用バリエーション本文が構造マッチしなかった
   - THREADS_ACCESS_TOKEN 未設定で Threads スキップ

2. **post_to_x.py の週次X投稿が失敗**
   - 6/8(月) 朝のツイート本文を `2026-06-01-x-posts.md` に見つけられず
   - 同ファイルは 6/1-6/7 分しか含まない（6/8以降のコンテンツが未生成）
   - weekly-content-pipeline は毎週日曜深夜実行のため、月曜朝の投稿分が事前生成されていなかった

**原因：**
1. **URL形式検証の過度な厳密化**：replace_article_url.py が `?flash_message_key=...` のクエリパラメータを含む URL を拒否（本来は受け入れるべき）
2. **x-variants.md の構造仕様が不明確**：「X 用バリエーション」セクションの Markdown 形式が、正規表現マッチと相性が悪い
3. **weekly-content-pipeline の範囲設定**：「前週分」を生成すべきだが、「今週分のみ」生成する実装になっている

**影響度：**
- ✅ メイン動線（note 公開 → X への自動拡散）は完全に機能（SNSプロモ機能経由）
- ❌ 補助的なクロスポスト追加投稿（X単独ツイート / Threads 投稿）は失敗
- → 記事公開～X拡散の主要フロー自体は損なわれず

**解決策：**
1. `replace_article_url.py` のURL検証：クエリパラメータを許可するよう拡張
   ```python
   # 修正前：`https://note.com/...` の形式のみ許可（クエリパラメータ拒否）
   # 修正後：`https://note.com/.../n/[ID](\?.*)?` で パラメータを削除後に利用
   import urllib.parse
   parsed = urllib.parse.urlparse(url)
   clean_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))
   ```

2. `x-variants.md` の構造統一：Markdown セクションの命名・形式を明確化
   - 現在：セクション名が `## X向けバリエーション` / `### X用本文` など混在
   - 改善案：常に `## X バリエーション` で統一 → 正規表現マッチ率向上

3. `weekly-content-pipeline` の日程範囲：「次の週分」ではなく「前週分も含める」実装
   ```python
   # 修正案：月曜朝の投稿分は前週時点で生成済みとするため、
   # 「今日から過去7日分」ではなく「今日から過去14日分を再スキャン」
   ```

**教訓：** 複数のワークフロー連鎖（note公開 → X拡散 → クロスポスト追加）では、各々の境界責任を明確にすべき
- note公開直後の「SNSプロモによるX自動投稿」はメイン動線（note ネイティブ機能利用）
- クロスポスト追加投稿は「オプション」として位置づけ、失敗しても記事公開に影響を与えない設計

**再発防止：**
- URL形式の柔軟化（クエリパラメータ許可）を全フロー共通化
- x-variants.md など、複数スクリプトが参照する Markdown 形式は「スキーマ定義書」を別途作成
- ワークフロー連鎖時の「失敗の層別」：メイン機能が失敗したら即座に止める、補助機能は失敗時も継続する

**タグ：** #github-actions #note-api #cross-post #url-parsing #markdown-schema

---

## 記事公開・投稿

### [2026-06-04] addness-side-income — Note 有料エリア設定：「有料エリア設定」ボタン押下後の手動ステップが必須

**状況：** post_to_note.py で note 記事の有料エリア設定を自動化しようとした
- スクリプト：「有料エリア設定」ボタンのクリック機能を実装
- 期待：ボタン押下で自動的にペイウォール位置が確定
- 実際：ボタン押下後、ユーザーに「本文に戻された状態」になり、**ユーザーが手動で段落をクリック** して位置を確定する必要がある

**原因：** note の公式UX仕様
- 「有料エリア設定」ボタンをクリック → 本文に戻る
- → 有料ラインのカーソルが表示される
- → **ユーザーが「有料にしたい段落をクリック」して位置を確定**する必要がある
- （参考：https://www.help-note.com/hc/ja/articles/360008882894-有料記事を書く-有料ラインの設定#h_01GMCRSAJKJM3VGZWCD331BYYT）

**解決策（セッション73）：** 
- JSで本文内の 📥 マーカー段落を検出
- getBoundingClientRect() で座標取得
- page.mouse.click() でプログラム的にクリック
- これにより段落位置への自動ペイウォール設定が可能に

**教訓：** ブラウザ自動化では「ボタン押下後の状態変化」だけでなく、「次に何をユーザーに要求するのか」を UI ドキュメントで確認すべき

---

### [2026-06-08] rakuda-sensei — SNS プロモ設定のページ遷移タイミング：有料エリア設定前に設定が必須

**状況：** post_to_note.py で note 記事のSNSプロモ設定（RT文・割引価格）を自動化
- 初期実装：ペイウォール位置確定後に SNSプロモ設定を試行
- 期待：有料エリア設定完了後、次ページで SNSプロモ radio を選択・設定
- 実際：ページ遷移後、セール section の radio が DOM から消えており、設定不可

**原因：** note の公式 UI フロー設計
- ページ1（設定パネル）：価格入力 ＋ **SNSプロモ設定** → 「有料エリア設定」ボタン
- ページ1→ページ2遷移（ボタン押下）
- ページ2（エリア設定パネル）：ペイウォール位置選択
- **ページ遷移により、ページ1の radio DOM が削除される** → SNSプロモが設定不可

**解決策（セッション82）：** 
- SNSプロモブロックを「価格設定の直後・有料エリア設定ボタン押下の直前」に実装
- セール section 展開 → twitter_retweet radio 直接クリック → RT文 textarea 入力 → 割引価格 #discountedPrice 設定
- この順序でブロックを実装することで、ページ遷移前に確実に設定完了

**コード変更：** 
```python
# ❌ 旧実装（失敗パターン）：ペイウォール位置確定後に SNSプロモ設定
# → ページ遷移後に radio DOM が消える

# ✅ 新実装（成功パターン）：有料エリア設定ボタン押下の直前に SNSプロモ設定
# セール section 展開 → radio 選択 → RT文・割引価格入力 → 「有料エリア設定」ボタン
```

**教訓：** note の複数ページ自動化では、各ページでの `input` / `radio` / `textarea` のライフサイクル（DOM削除タイミング）を注意深く観察するべき

**参考：** update_sns_promo.py で既に実証済みの動く版フロー（セッション79）を post_to_note.py にも統一

---

### [2026-06-04] addness-side-income — Note 記事が 404 で返るが exit code は成功の問題

**状況：** post_to_note.py + GitHub Actions ワークフローで note 記事を自動投稿
- ワークフロー実行：成功（トリガーファイル削除、exit 0）
- .last-published-url.txt に新URL が記録される
- しかし実際にブラウザで URL を開くと 404

**問題（セッション58-62で繰り返し発生）：** 
- セッション58：URL 不変 → 次セッションで 404 判明
- セッション59：ボタン押下ロジック再検証が必要とされるが、exit 0 で終了
- セッション60-61：ワークフロー完了待機
- セッション62：新URL 生成も、また 404 発生

**原因（推測）：** 
```
① ボタン押下ロジック失敗：
   - post_to_note.py:1380-1450 の「公開ボタン」を探索・クリック
   - Playwright による locate や click が失敗しているが、エラーハンドリングがなく exit 0
   - 実際には「下書き保存のみ」で公開ボタンが押せていない

② 公開ボタンが存在しない状態で実行：
   - 編集画面での「有料エリア設定」後、公開ボタンが UI に現れるまでの遅延
   - JavaScript 実行待機不足

③ Note 側の UI 変更：
   - ボタンの ID/selector が変わった
   - セッション55-56 の修正が最新版 note UI に対応していない

④ note アカウント側の問題：
   - 記事が自動削除・ゴミ箱移動
   - アカウント認証が下書き保存時は OK だが、公開ボタンでは NG
```

**検証方法：** 
```
1. Browser devtools で実際にボタンが存在・可視化されているか確認
2. post_to_note.py に exception/logging を追加、ワークフロー実行ログで詳細確認
3. note マイページで下書き・ゴミ箱・公開記事を確認
4. selector/locator を最新 note UI に合わせて update
```

**次回実装案：** 
- post_to_note.py にスクリーンショット機能を追加（ボタン押下前後を保存）
- try/except で公開ボタン失敗時は詳細 log + screenshot
- GitHub Actions のアーティファクトに保存

**セッション65での対応（2026-06-04）：**
- **有料ライン位置を構造保証**：記事末尾から2段落上に固定 → 末尾の`---`削除 → 有料パート1段落に圧縮
  - 目的：「最後のボタンが📥（ダウンロード提供）の直前」を保証
- **本文スラッシュコマンド撤廃**：`/有料` 挿入をやめ、リテラル混入を防止
- **本文クリア追加**：既存ドラフトの累積を防止
- **ボタン押下戦略を4つに多層化**：
  1. 最後のボタン（`.modal-button:last-of-type`）
  2. 最後から2番目（`.modal-button:nth-last-of-type(2)`）
  3. 座標方式（`evaluate()` で button rect 取得 → 座標クリック）
  4. 最後から3番目（fallback）
- **三重打ち実装**：JS dispatch + mouse.click + Playwright locator で耐障害性向上
- **全戦略失敗時の安全装置**：強制 save_draft（公開事故防止）

**次のセッションでの検証：**
- 実機実行：ワークフロー実行 → attempt 0 で成功率測定
- 失敗パターン分析：どの戦略（1-4）で成功するか確認
- セッション62 の 404 エラーとの関連確認

---

## 認証・API連携

### [2026-06-03] addness-side-income — クッキーベース認証が複数ドメイン間で失効する問題

**状況：** Note.com の自動投稿ワークフローで、ブラウザのセッションクッキーを JSON 化して GitHub Secrets に登録し、GitHub Actions 上で Playwright を実行

**問題：** 
- クッキーが有効な状態でも、note.com での認証が失敗
- `https://note.com/login?redirectPath=...` にリダイレクトされてしまう
- ローカルテスト環境（localhost）では機能するが、GitHub Actions（ubuntu-latest）では失敗

**原因（複合要因）：** 
```
① ドメイン隔離：
   - note.com は複数のサブドメインを使用（note.com, editor.note.com, developer.note.com など）
   - Cookie-Editor で export したクッキーが単一ドメイン（note.com）のみの可能性
   - editor.note.com でのクッキーが含まれていない場合、エディタ画面での認証に失敗

② クッキー有効期限・セキュリティ属性：
   - HttpOnly + Secure フラグが設定されたクッキーは、JSON export で情報喪失
   - ドメイン・パス・有効期限属性が JSON に含まれていても、ブラウザ外（Python/Playwright）での有効性が異なる
   - AWS / GitHub Actions の外部実行環境でクッキーが無効化される可能性

③ 環境依存：
   - ローカル（Chrome/Firefox）では動作するが、GitHub Actions（Chromium）では失敗
   - Cookie-Editor が複数タブ/ウィンドウのクッキーを完全キャプチャしていない可能性
```

**解決策（フォールバック実装）：** 
```
クッキー認証 → メール/パスワード認証の2段階フォールバック体制：

① クッキー認証を試す
   - GitHub Secrets に `NOTE_SESSION_COOKIE` を登録
   - Playwright で JSON を読み込み、setCookie() で設定
   - /login を含むURLが検出されたら → 次ステップへ

② ログイン状態判定を改善
   - _is_editor_url(url): /login を含む URL はエディタ未到達と判定
   - 未到達の場合 → 次ステップへ

③ メール/パスワード認証にフォールバック
   - GitHub Secrets に `NOTE_EMAIL` + `NOTE_PASSWORD` を新規追加
   - login_to_note() 関数を実装
   - 実際にログインフォーム（メール入力 → 確認コード入力 → パスワード入力）を実行
   - 成功後、compose_urls を再試行

実装例（Python + Playwright）：
```python
# クッキー認証失敗時の判定
if "/login" in page.url:
    logger.warning("Cookie authentication failed, falling back to email/password")
    await login_to_note(page, email, password)  # フォールバック
    await page.goto(target_url, wait_until="load")  # リトライ
```

**再発防止：** 
- クッキーベース認証は複数ドメイン・複数デバイス環境では脆弱
- 本番環境（GitHub Actions）での自動化には、**メール/パスワード認証を第1選択肢**とする
- クッキーは手動テスト用に限定
- 認証が必須なサービス自動化では、最初から OAuth / API トークン / メール認証を用意する

**タグ：** #cookie #authentication #note #playwright #github-actions #multi-domain #fallback

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
