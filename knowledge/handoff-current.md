# 🐪 引き継ぎノート – 次セッション再開用

最終更新: 2026-06-08
作業ブランチ: `claude/addness-side-income-7cjy2`

---

## 1. 現状サマリー（30秒で読める）

note 副業の販売記事3本と無料SEO集客記事1本を立てた段階。

| 記事 | 役割 | URL | 状態 |
|---|---|---|---|
| 002-side-fire-sheet | 有料 ¥1,500・サイドFIRE計画シート | <https://note.com/large_pika8608/n/n96918f980528> | ✅ 公開済 |
| 003-saki-tori-flow | 有料 ¥1,500・先取り投資フロー（伊神流FP） | <https://note.com/large_pika8608/n/nc431a85fe938> | ✅ 公開済（要：添付Excel手動差し替え） |
| 004-free-koumuin-15man-nisa | 無料 SEO 集客（公務員 NISA いくら） | <https://note.com/large_pika8608/n/n72b79d2a6a17> | ✅ 公開済 |

X週次（6/8-6/14）20本投入済。本日 21:00 JST から自動投稿開始予定。

---

## 2. 戦略の確定事項（絶対覚えておく）

### 商品設計
- **デジタル資産はzipでまとめず、1有料記事=1ファイルで売る**
- 1つの有料記事 = その1ファイルの唯一のダウンロード経路
- 無料関連記事を多数作って、各有料記事に集中送客するファネル設計

### 4つの売り物 → それぞれ専用の有料記事を持たせる
| アイテム | 有料記事 |
|---|---|
| ① 伊神流FP 家計と先取り貯金テンプレ.xlsx | **003-saki-tori-flow** ✅ |
| ② 夫婦で実践 サイドFIRE計画シート.xlsx | **002-side-fire-sheet** ✅ |
| ③ 中学校教員ToDo＆時間割テンプレ.xlsx | （未作成） |
| ④ 通知表所見 AIプロンプト完全版.md | （未作成） |

### 価格・SNSプロモ
- 価格: 全有料記事 ¥1,500
- 拡散割引: ¥500
- 拡散RT文は各記事のメタデータに記載済（note の SNSプロモ連携が publish 時に X 自動投稿）

### 自動化フロー
- note publish 時に note 純正の SNSプロモ機能が X に著者アカウントから自動ツイート
- `post_note_promo.py` は Threads のみ担当（X 重複投稿は削除済）

---

## 3. ユーザーへの待ちタスク（バックログ）

### 🟡 即対応必要
- [ ] **003 の note 編集画面で添付差し替え**
  - 旧（zip or saki-tori-money-flow）→ 新 `iga-fp-saki-tori-template-2026.xlsx`
  - 「ここから先で渡すもの」セクションも repo の最新MDに合わせる

### 🟡 30分タスク（やれば露出 2.4倍）
- [ ] **Meta API トークン取得 → GitHub Secrets 5個登録**
  - 詳細: `projects/rakuda-sensei/automation/setup/INSTA-THREADS-SETUP-NOW.md`
  - 必要 secrets: `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`, `META_ACCESS_TOKEN`, `IG_USER_ID`, `GH_PAT`

---

## 4. 次セッションで進めるべき作業（優先順）

### 優先1: ③ 中学校教員ToDo＆時間割テンプレの有料記事 005
- 柱 A（ICT時短）
- ターゲット: 「中学校教員 時間割 効率化」「ToDo 教員 自動化」
- 価格 ¥1,500
- 構成は 002/003 と同じ：
  - 失敗談先出し（残業60h時代の話）
  - 結論（ToDo＆時間割の使い方）
  - 実数値（席替え2h→30分、テスト1h→15分、提出物30分→10分）
  - ペイウォール後に xlsx 添付
- サムネ: `build_thumbnail_005.py` を 003 のスタイル流用で

### 優先2: ④ 通知表所見 AIプロンプト の有料記事 006
- 柱 A（AI活用）
- ターゲット: 「通知表 所見 ChatGPT」「教員 AI 通知表」
- 価格 ¥1,500
- 既存 md ファイル `通知表所見｜AIプロンプト完全版.md` が deliverable

### 優先3: 無料関連記事の量産（各有料記事に 3-5本ずつ送客）
- 002 向け: 「公務員 FIRE ロードマップ」「夫婦で家計を話す方法」など
- 003 向け: 「先取り貯金 やり方」「公務員 NISA 月額 リアル」など（004 はすでに兼用）
- 005/006 向け: 005/006 完成後に着手

### 優先4: PDCA
- 6/15(月) に X 1週間の反応・note の閲覧数/購入数を集計
- 売れない場合 → タイトル/サムネのリライト

---

## 5. 重要な制約・ルール（NG事項）

- ❌ **有料サービスへの新規課金は一切禁止**（無料ツールだけで完結させる）
- ❌ **全角縦線「｜」を区切り記号として使わない**（mistakes.md準拠）
- ❌ **PR を勝手に作らない**（明示指示があるまで）
- ❌ **作業ブランチ `claude/addness-side-income-7cjy2` 以外に push しない**
- ✅ コミットメッセージは具体的に（fix/feat/chore/refactor のプレフィックス）
- ✅ ユーザーはプログラミング完全初心者。専門用語には補足

---

## 6. 進行中の自動化（cron で勝手に動く）

| ワークフロー | スケジュール | 内容 |
|---|---|---|
| `post-to-x.yml` | 朝07:00 / 昼12:30 / 夜21:00 JST | X 自動投稿 |
| `post-to-threads.yml` | 同上 | Threads（secrets 設定後に稼働） |
| `daily-instagram.yml` | 毎日 19:00 JST | Instagram（secrets 設定後に稼働） |
| `refresh-tokens.yml` | 1日 / 15日 | Meta トークン自動延長 |
| `weekly-content-pipeline.yml` | 日曜 21:00 UTC | 次週分 X14本＋note記事1本＋クロスポスト自動生成 |

---

## 7. 直前セッションのコミット履歴

```
79e05f8 feat(sns): IG/Threads 連携を自動稼働可能な状態に仕上げ
0892974 chore(auto): launch-trigger消化 + 公開URL反映 (004 publish)
7bc10fb feat(article-004): 無料SEO集客記事 + 002/003 への送客動線
7ed9833 feat(weekly-x): 6/8-6/14 X週次 20本投入 (002/003 集中送客)
3857ec7 refactor(003): zipバンドル路線を撤回、① 単品売りに
4bc3d12 feat(asset-003): zip バンドル添付 (後で撤回された)
4605fb3 feat(asset-003): 自作 Excel を「3項目入れるだけ」設計に刷新 (撤回)
cba4137 chore(auto): launch-trigger消化 + 公開URL反映 (003 publish)
1a16511 feat(article): 003 先取り投資フロー記事 + サムネ
```

---

## 8. 次セッション開始時の最初の一言（テンプレ）

```
knowledge/handoff-current.md を読んで現状把握して。
今日やりたいのは [優先1=005作成 / 優先2=006作成 / 優先3=無料記事量産 / 優先4=PDCA] のどれか。
```

このまま貼れば即再開できる。
