# CLAUDE.md — ワークスペース運用ルール

このファイルはClaude Codeが自律的に更新・改善してよい。改善点に気づいたら確認なしで更新すること。
**このファイルは毎セッション全文が読まれる。詳細はスキル・knowledge に置き、ここは80行以内に保つ。**

---

## ディレクトリ構成

```
Workspace/
├── CLAUDE.md
├── .claude/
│   ├── settings.json     # セッション開始・終了 hook（詳細: knowledge/session-hooks.md）
│   └── skills/           # coding-rules / ui-components / patterns / failures /
│                         # semiretire / note-writer / defuddle / deploy-pages /
│                         # my-tool-maker / my-lp-maker
├── knowledge/            # 各スキルの詳細参照元・ログ・記録
└── projects/{name}/      # kebab-case・README.md + *.html
```

セッション開始時に `knowledge/context.md`（オーナー情報＋ミス防止ルールの要約）が hook で自動読み込みされる。
詳細が要るときだけ `profile.md` / `mistakes.md` を明示的に読む。

---

## タスクに応じてスキルを使う

| タスク | スキル |
|---|---|
| HTML・コード作成 | `coding-rules` → `patterns` → `failures` |
| UIパーツが必要 | `ui-components` |
| 副業・販売ツール | `semiretire` |
| note記事・有料記事 | `note-writer` |
| GitHub Pages 公開・運用ブランチへのマージ | `deploy-pages` |
| 外部URL参照 | `defuddle` |

単発の質問・雑談はスキルをスキップしてよい。
自動化プロジェクトの継続/撤退で迷ったら `knowledge/scope-decision.md`（3回同じ障壁で失敗＝スコープ縮小）。

---

## 書き込みルール

「後で書く」はしない。該当したらその場で書く。

| ファイル | タイミング |
|---|---|
| `knowledge/patterns.md` | うまくいった実装パターンが出た |
| `knowledge/failures.md` | ハマりの原因と解決策がわかった |
| `knowledge/ui-components.md` | 再利用できるUIパーツができた |
| `knowledge/mistakes.md` | ユーザーの明示的訂正 かつ 再発しうる かつ「する/しない」で書ける（3条件すべて）。書いたら `knowledge/context.md` の行動ルールにも1行で反映する |
| `knowledge/log.md` | 作業が完了・中断した（直近3ヶ月分のみ保持。古いものは `knowledge/log-archive/` へ） |
| `knowledge/task-diary.md` | セッション終了処理時（毎セッション必須） |

mistakes.md の形式：`YYYY-MM-DD: 一言` / `NG:` / `OK:` / `場面:`
1ファイルが100行を超えたら分割を検討する。

**報告ルール：** knowledge/ や skills/ を読み書きしたら必ず報告する（例「knowledge: failures.md に書き込みました」）。サイレントで読み書きしない。

---

## 完成基準

- [ ] iPad（タブレット縦持ち）での表示確認済み
- [ ] HTMLコメント記載済み（主要ブロックに説明あり）
- [ ] `knowledge/log.md` に記録済み
- [ ] `projects/{name}/README.md` の完了基準チェック済み

**iPad実機確認はAIには不可能**なので、完成時は log.md の「次のアクション」に「iPad実機テスト待ち（〇〇の確認）」と必ず書き、次セッションの冒頭でそのフィードバックを確認してから新規タスクに入る。

---

## 命名規則

プロジェクトフォルダ・HTMLファイル・CSSクラスは **kebab-case**（`word-sort-game` / `main.html` / `.answer-button`）、JS変数は **camelCase**（`currentScore`）。

---

## 💰 お金のルール（絶対厳守）

- **有料サービスへの新規課金は一切禁止。今も今後も。**
- 実装提案時は「無料か有料か」を必ず明記し、無料手段を先に検討する。
- 有料が避けられない機能は「実装しない」「半自動運用で代用」を選ぶ。「¥500/月なら安い」と感じても、オーナーの明示OKなしに有料化しない。
- 使用中の無料サービス一覧 → `projects/rakuda-sensei/automation/README.md`

## 🌐 GitHub Pages（絶対厳守）

**既存の公開リンクを絶対に壊さない**（特に旧URL `/Workspace/kaeriten-quest/` は生徒に配布済み）。公開・マージの手順は `deploy-pages` スキルを読むこと。

## Gitコミット前の必須設定

```bash
git config user.email noreply@anthropic.com && git config user.name Claude
```

---

## エージェントとしての行動原則

- 不明点は作業開始前に一度にまとめて質問する。確信が持てない情報は「確認が必要です」と明示する。
- 推測で実装した箇所は `<!-- 要確認: 理由 -->` とコメントする。
- 指示が非効率と判断したら代替案を先に提示する。
- ユーザーはプログラミング完全初心者。専門用語には必ず補足説明を入れる。
- 会話が長くなったら `/compact`、話題を変えるときは `/clear`（ナレッジは消えない）。
