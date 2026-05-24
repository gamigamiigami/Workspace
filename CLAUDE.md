# CLAUDE.md — ワークスペース運用ルール

このファイルはClaude Codeが自律的に更新・改善してよい。
改善点に気づいた場合は確認なしで更新すること。

---

## ディレクトリ構成

```
Workspace/
├── CLAUDE.md
├── .claude/
│   ├── settings.json          # セッション開始hookの設定
│   └── skills/
│       ├── coding-rules/      # HTML/CSS/JS規約・テンプレート
│       ├── ui-components/     # 再利用UIパーツ
│       ├── patterns/          # 成功パターン集
│       ├── failures/          # 失敗・ハマりポイント集
│       ├── semiretire/        # セミリタイア・副業コンテキスト
│       └── defuddle/          # Web取得ツール（トークン節約）
├── knowledge/
│   ├── profile.md             # 基本情報（hook で自動読み込み）
│   ├── mistakes.md            # AIのミス記録（hook で自動読み込み）
│   ├── rules.md               # coding-rules スキルの詳細参照元
│   ├── patterns.md            # patterns スキルの詳細参照元
│   ├── failures.md            # failures スキルの詳細参照元
│   ├── ui-components.md       # ui-components スキルの詳細参照元
│   ├── semiretire.md          # semiretire スキルの詳細参照元
│   ├── task-diary.md          # セッションごとの学びログ（Stop hookが自動記録）
│   └── log.md                 # 作業ログ（作業終了時のみ書く）
└── projects/
    └── {project-name}/        # kebab-case
        ├── README.md
        └── *.html
```

---

## 作業開始

`profile.md` と `mistakes.md` はセッション開始時に hook が自動で読み込む。

### タスクに応じてスキルを使う

| タスクの種類 | 使うスキル |
|---|---|
| HTML・コード作成 | `coding-rules` → `patterns` → `failures` |
| UIパーツが必要 | `ui-components` |
| 副業・販売ツール | `semiretire` |
| 外部URL参照 | `defuddle` |

単発の質問・雑談はスキルをスキップしてよい。

---

## 書き込みルール

「後で書く」はしない。該当したらその場で書く。

| 書くファイル | 書くタイミング |
|---|---|
| knowledge/patterns.md | うまくいった実装パターンが出た |
| knowledge/failures.md | ハマりの原因と解決策がわかった |
| knowledge/ui-components.md | 再利用できるUIパーツができた |
| knowledge/mistakes.md | ユーザーから訂正を受け、下記3条件を満たす場合のみ |
| knowledge/task-diary.md | Stop hookが毎セッション自動記録（手動書き込み不要） |
| knowledge/log.md | 作業が完了・中断した |

### mistakes.md への追記条件（3つすべて満たす時のみ）
1. ユーザーからの明示的な訂正
2. 繰り返し起こり得るパターン
3. 「する/しない」で具体的に書ける

```
YYYY-MM-DD: [一言で何を間違えたか]
NG: 実際にやってしまったこと
OK: 次回からの正しい対応
場面: このルールが適用される状況
```

### ファイルサイズのルール
- 1ファイルが **100行を超えたら分割を検討** する
- log.md は **直近3ヶ月分のみ** 保持（古いものは `knowledge/log-archive/` へ）

---

## 完成基準

- [ ] iPad（タブレット縦持ち）での表示確認済み
- [ ] HTMLコメント記載済み（主要ブロックに説明あり）
- [ ] `knowledge/log.md` に記録済み
- [ ] `projects/{name}/README.md` の完了基準チェック済み

---

## 命名規則

| 対象 | 規則 | 例 |
|------|------|----|
| プロジェクトフォルダ | kebab-case | `word-sort-game` / `kanji-quiz` |
| HTMLファイル | kebab-case | `main.html` / `result-page.html` |
| CSSクラス | kebab-case | `.answer-button` / `.score-display` |
| JS変数 | camelCase | `currentScore` / `questionList` |

---

## エージェントとしての行動原則

- 不明点は作業開始前に一度にまとめて質問する
- 確信が持てない情報は「確認が必要です」と明示する
- 推測で実装した箇所は `<!-- 要確認: 理由 -->` とコメントする
- 指示が非効率と判断した場合は代替案を先に提示する
- ユーザーはプログラミング完全初心者。専門用語には必ず補足説明を入れる

---

## 報告ルール

knowledge/ や skills/ を読み書きしたら必ず報告する：
- 「skills: coding-rules を参照しました」
- 「knowledge: failures.md に書き込みました」

サイレントで読み書きしない。

---

## 自己改善メモ

| 日付 | 改善内容 |
|------|----------|
| 2026-05-23 | 初版作成 |
| 2026-05-24 | 選択的読み込み・mistakes.md・hookによる自動読み込みに刷新 |
| 2026-05-24 | skillsシステム導入・CLAUDE.mdをスリム化 |
| 2026-05-24 | Task Diary導入・Stopフックで自動振り返り・パターン昇華ルール追加 |
