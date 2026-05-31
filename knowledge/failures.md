# 失敗・ハマりポイント集

最終更新：2026-05-24

新しいエントリは **先頭に追加** する。プロジェクト名を必ず記載。

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
