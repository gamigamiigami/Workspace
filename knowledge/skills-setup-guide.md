# スキル（/コマンド）をどのセッションでも使えるようにする方法

最終更新：2026-06-10

---

## 仕組みの全体像

```
リポジトリ
└── .claude/
    ├── settings.json       ← SessionStartフックの定義
    └── skills/             ← スキルの本体（ここが唯一の正）
        ├── coding-rules/
        ├── my-tool-maker/
        └── ...

        ↓ セッション開始時に自動コピー

コンテナ（セッションごとにリセット）
└── ~/.claude/
    └── skills/             ← ここにコピーされて初めて使える
```

**ポイント：** コンテナは毎セッション白紙になる。  
だから「リポジトリに入れて、毎回コピーする」が唯一の解。

---

## ✅ 正常に動く条件（3つ全部必要）

1. **セッションがこのリポジトリ（gamigamiigami/Workspace）を使っている**
2. **ブランチが `claude/workspace-knowledge-base-setup-ccVKP`（または main）**
   → `.claude/settings.json` が存在するブランチであること
3. **SessionStartフックが実行された**
   → セッション開始時に「knowledge/ 自動読み込み」というメッセージが出ていれば成功

---

## 🔍 スキルが使えない時のチェック方法

チャットに以下を貼って確認：

```
ls ~/.claude/skills/
```

- **ずらっとフォルダが出る** → フック成功。スキルは使える
- **session-start-hook だけ** → フックが動いていない（下の手動修復を実行）
- **何も出ない** → 同上

---

## 🔧 手動修復コマンド（フックが動かなかった時）

チャットに貼るだけでOK：

```
mkdir -p ~/.claude/skills && cp -r /home/user/Workspace/.claude/skills/. ~/.claude/skills/
```

これを実行すれば `/coding-rules` `/my-tool-maker` などが即座に使えるようになる。

---

## 📋 使えるスキル一覧

| コマンド | 用途 |
|---|---|
| `/coding-rules` | HTML/CSS/JS規約・テンプレート |
| `/ui-components` | 再利用UIパーツ確認 |
| `/patterns` | 成功パターン集 |
| `/failures` | ハマりポイント集 |
| `/my-tool-maker` | ツール制作 |
| `/my-website-maker` | Webサイト制作 |
| `/my-lp-maker` | LP制作 |
| `/note-writer` | note記事執筆 |
| `/semiretire` | 副業・セミリタイアコンテキスト |
| `/defuddle` | Web取得（トークン節約） |

---

## ⚠️ 「どのリポジトリでも使いたい」場合

現状は **このリポジトリ専用**。  
別のリポジトリで使いたい場合は、そのリポジトリにも `.claude/settings.json` と `.claude/skills/` をコピーするか、上記の手動修復コマンドをそのセッションで実行する。

---

## スキルを新規追加・編集する時

1. `/home/user/Workspace/.claude/skills/` に追加・編集する
2. コミット・プッシュする
3. 次のセッションから自動で使えるようになる

既存スキルの中身は `knowledge/` 配下の `.md` ファイルを参照。
