# セッション開始・終了フックの仕組み

設定ファイル：`.claude/settings.json`

## Hook 実行タイプの使い分け（重要）

- `"type": "command"` — シェルが直接実行 → 端末の権限で動く → `git push` などが可能
- `"type": "agent"` — Claude が実行 → AI の権限に限定される → `git push` は不可（セキュリティ上正しい挙動）

## SessionStart

`knowledge/context.md`（オーナー情報＋ミス防止ルールの要約）を出力して自動読み込みする。
詳細版が必要になったら `knowledge/profile.md` `knowledge/mistakes.md` を明示的に読む。

トークン節約のため、**hook で読み込むのは要約1ファイルだけにする**。ここにファイルを足すと全セッションのコストが増える。

## Stop（セッション終了）

1. `type: agent` — task-diary.md への振り返り追記、パターン昇華チェック、log.md 更新
2. `type: command` — `git add -A && git commit && git push`（シェル実行）

## 注意

自動生成された記録は、コミット前に必ず中身を読んで実際の作業と突き合わせる。
過去に、やっていない作業（架空のセッション番号・架空の実装内容）が書かれたことがある。
