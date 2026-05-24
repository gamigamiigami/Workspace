# 作業ログ（全プロジェクト横断）

新しいエントリは **先頭に追加** する。

---

## テンプレート

```
### [YYYY-MM-DD] プロジェクト名

**作業内容：**
- 箇条書きで具体的に

**結果：** 成功 / 部分完了 / 失敗

**成果物：** `projects/{name}/ファイル名.html`

**気づき・メモ：**
- 次回に活かせること
```

---

## ログ

### [2026-05-24] workspace-setup（このワークスペース）

**作業内容：**
- `.claude/skills/` ディレクトリを作成し、skillsシステムを導入
- `coding-rules` / `ui-components` / `patterns` / `failures` / `semiretire` / `defuddle` の6スキルを作成
- `CLAUDE.md` をスリム化（知識参照をスキル経由に移行）

**結果：** 成功

**成果物：**
- `.claude/skills/coding-rules/SKILL.md`
- `.claude/skills/ui-components/SKILL.md`
- `.claude/skills/patterns/SKILL.md`
- `.claude/skills/failures/SKILL.md`
- `.claude/skills/semiretire/SKILL.md`
- `.claude/skills/defuddle/SKILL.md`
- `CLAUDE.md`（更新）

**気づき・メモ：**
- CLAUDE.mdが157行→約110行にスリム化（毎セッションのトークン消費削減）
- コーディング詳細はスキル経由でオンデマンド読み込みになった
- defuddleは `npm install -g defuddle-cli` が必要（環境によってはインストール済み確認が必要）

---

### [2026-05-23] workspace-setup（このワークスペース）

**作業内容：**
- ワークスペース全体のフォルダ構成を作成
- `knowledge/` 配下のナレッジベースファイルを初期化
- `CLAUDE.md` に作業規約・行動原則を記載
- 既知の注意事項（日本語フォント縦書き、iOS touchイベント、localStorage）を登録

**結果：** 成功

**成果物：**
- `CLAUDE.md`
- `knowledge/rules.md`
- `knowledge/patterns.md`
- `knowledge/failures.md`
- `knowledge/ui-components.md`
- `knowledge/log.md`
- `projects/` ディレクトリ

**気づき・メモ：**
- 初回セットアップのため既存プロジェクトなし
- 次回プロジェクト開始時にこのログの使い方を確認すること
