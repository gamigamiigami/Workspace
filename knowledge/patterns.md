# 成功パターン集

最終更新：2026-12-22

新しいパターンは **先頭に追加** する。プロジェクト名を必ず記載。
複数プロジェクトで使えると判明したパターンには `[汎用]` タグをつける。

---

## API 統合・外部プラットフォーム連携

### [汎用] 複数ステップの外部認証フローを段階的にガイダンスする「ハンドオフパターン」

**用途：** Meta Developer、Google Cloud、GitHub OAuth など、複数のプラットフォーム認証・登録が必要な場合、1セッションですべてを完結させず、各ステップを独立させて実行順序の柔軟性を確保する方法

**背景：**
- Instagram/Threads API 統合において、(1)Facebook ページ作成、(2)Meta Developer Portal 登録、(3)Instagram Graph API 申請 の3ステップが必要
- 各ステップが相互に依存しているが、実際には並行実施可能なものがある
- 1つのステップで失敗しても、他のステップは継続可能な設計にすることで、ユーザーの挫折を減らす

**実装パターン：**

```
セッション単位の切り方
├── セッション N：現状分析＋ステップ 1（Facebook ページ作成）ガイダンス
│   └── ハンドオフ：「ページ作成完了したら報告」という明確な待機条件
├── セッション N+1：ステップ 1 結果ハンドリング＋ステップ 2/3 ガイダンス（並行可能）
│   ├── Facebook ページ作成に失敗した場合 → 別パターン提示（Threads 単独運用など）
│   └── Meta Developer App 作成は ステップ 1 結果に関わらず実施可能と明示
└── セッション N+2：ステップ 2/3 の進捗確認＋次段階へ

段階的ガイダンスの構成
├── 「なぜこのステップが必要か」（背景と目的）
├── 「何をしないでいいか」（過剰な設定を除外）
├── 「何分で完了するか」（時間を明示）
└── 「次のステップは何か」（期待値の設定）
```

**成功指標：**
- 各セッションで「1つの明確な待機条件」を設定し、ユーザーの心理的負担を軽減
- 複数の前提条件がある場合、「条件 A と条件 B は並行実施可能」と明示することで、ユーザーの自由度を確保
- セッション間の「何もしていない時間」を正当化（結果待ちのための設計）

**実装例：**
- rakuda-sensei：Instagram/Threads API 統合フロー
  - セッション 33：Facebook アカウント作成ガイダンス
  - セッション 34：Facebook ページ作成エラー対処＋Threads 単独パターンの提示
  - セッション 35：Meta Developer App 作成ガイダンス（ページ成功/失敗に関わらず実施）

**ポイント：**
- **依存関係の明確化**：どのステップが他のステップに依存しているか、視覚的に整理
- **待機条件の明確化**：セッション終了時に「何を報告したら次に進むか」を明示
- **代替パターンの先制提示**：「もしステップ 1 が失敗したら、ステップ 1.5 という方法があります」と柔軟性を確保
- **心理的負担の軽減**：「5分で完了」「簡潔な手順」「プロフィール写真は不要」など、ユーザーの心理的ハードルを低くする

**タグ：** #API 統合 #外部認証 #ハンドオフ #セッション管理 #ユーザーエクスペリエンス #Instagram #Threads

---

## 商品開発・デジタルコンテンツ販売

### [汎用] テンプレート統一による商品開発スケーリングパターン

**用途：** 複数の教育教材・デジタルコンテンツを短期間にスケーリング販売する際、「毎回ゼロから設計」ではなく「統一テンプレ」を確立することで、AI自動生成部分と人間手作業部分を分離する方法

**背景：**
- BOOTH で 11 個のワークシート商品を立ち上げる際、毎回設計がぶれるとQAが煩雑化
- note 有料記事で「テンプレ系（Excel・チェックリスト・コード）」と「読み物系」の構成を使い分ける必要性
- 「自動化すればすべて効率化」という幻想から、実際は「人間がやるべき部分」と「AI がやるべき部分」の線引きが重要

**統一テンプレパターン（BOOTH ワークシート編）：**

```
中学国語ワークシート 統一構成（全11商品共通）
├── 基礎問題 5問
│   ├── 易易易易易（段階的難度上昇）
│   └── 正答率の目安 80-90%
├── 応用問題 5問
│   ├── 易中中中難
│   └── 正答率の目安 50-70%
├── 発展問題 5問
│   ├── 難難難難難
│   └── 正答率の目安 20-40%
├── 解答・解説
├── 採点ルーブリック（3段階評価）
└── ダウンロードコンテンツ化
   └── PDF + 答え別紙 + 指導案（任意）
```

**AI 自動化可能部分（99% 自動生成で OK）：**
- 各段階の問題文・正答・解説
- ルーブリック項目の文言
- HTML / PDF レイアウト生成

**人間が必ずやる部分（品質保証）：**
- 各問題の実際の正答率検証（実際に中学生10-20名に解かせて測定）
- 学習指導要領の適合性確認（教育行政の制約）
- 指導案のオプション化判断

**売上試算への組み込み：**
- テンプレ統一により「1商品あたり AI 生成 15分 + 人間レビュー 5分 = 20分」で可能
- 人間の実施時間が「月8時間（52商品分）」で収まる
- スケーリング時に「テンプレ変更で全商品に波及」が容易

**note 有料記事での応用：**

| 商品タイプ | 成果物テンプレ | 自動化度 | 人間手作業 |
|-----------|--------------|--------|---------|
| テンプレ系（Excel・ツール） | 配分表 × n / 関数式 / マクロ | 40-60% | 実物エクセル作成・検証 |
| 読み物系（コラム・解説） | タイトル・目次・3段落構成 | 80-90% | 実例・数値の信頼性確認 |
| チェックリスト | 項目一覧・チェックボックス | 95%+ | 順序・粒度の最終確認 |

**実装例：**
- rakuda-sensei：BOOTH 11商品を統一テンプレで管理予定
  - 初期 1ヶ月で「Excel テンプレ実物」5-6個を伊神さんが作成
  - 以降は「実物テンプレ × AI 自動配置」でスケーリング可能
  - 月10万到達ラインまで人間作業は月20-30時間以内に収まる設計

**ポイント：**
- 「完全自動化」を求めると品質が落ちる。**テンプレ統一 + AI + 人間の3段階設計**が現実的
- 人間の瓶頸（Excel テンプレ作成）を認識することで、初期投資を集中できる
- テンプレ化による効果：意思決定の高速化・品質のばらつき削減・スケーリング時間の短縮

**タグ：** #デジタルコンテンツ販売 #自動化 #テンプレート統一 #booth #note #教育教材 #スケーリング

---

## SNS運用・コンテンツ発信

### [汎用] 「投稿数 vs 質」の時系列最適化パターン

**用途：** 複数のSNSプラットフォーム（X/Twitter、note、Threads等）で、「投稿数を増やすべきか、厳選すべきか」という経営判断に迷う場合の意思決定フレームワーク

**背景：**
- SNS運用初心者は「質か量か」という二項択一に陥りやすい
- AI自動生成を導入した場合、「量を増やすと質が落ちるのでは？」という不安が出現
- 実は時系列段階により最適解が異なる

**段階別最適解：**

| 段階 | 特性 | 最適戦略 | 優先度 | 質の実現方法 |
|------|------|---------|--------|------------|
| **初期（新規アカウント）** | フォロワー少ない・発見性が課題 | **量優先**（朝昼夜3回推奨） | 発見性 > 質 | 事前チェック + 自己学習で担保 |
| **中間（フォロワー50-500）** | 両立可能な段階 | **量 × 質**（自動化で質確保） | 両立 | quality_check 機能で自動審査 |
| **成熟（フォロワー1000+）** | 固定ファンがいる・質が投資効果になる | **質優先**（週2-3回精選） | 質 > 量 | 熟考型・エディトリアル判断 |

**初期段階での「量優先」の根拠：**
1. **アルゴリズム評価**：時間帯分散（朝・昼・夜）がXの推奨アルゴリズムに有利（単一時間帯への集中投稿より）
2. **発見性**：フォロワーが少ないうちは「検索引っかかる頻度」が唯一の集客源
3. **AI質低下リスク**：事前・事後チェック（quality_check_article + 自己学習）で大幅軽減可能（完全排除不可だが許容度向上）
4. **疲労ライン確認**：1日3回投稿は人間の疲労ライン下（完全自動化なら運用コスト <100分/週）

**判定基準（1ヶ月後に計測）：**
- ✅ フォロワー増（週+20以上）→ 量優先策が有効、継続
- ✅ エンゲージレート維持・上昇 → 質が保たれている
- ✅ 投稿全体インプレッション総和が増加 → アルゴリズム評価が上昇
- ❌ フォロワー減（週-5以下）→ 投稿数を戻す（可逆設計）
- ❌ エンゲージレート半減 → 質が損なわれている、調整検討

**実装例：**
- rakuda-sensei：初期段階につき週14本 → 週21本（1日3回）に増加を決定
  - 朝(7:00) / 昼(12:30) / 夜(21:00) JST の3スロット
  - 3本柱（ICT時短・資産形成・教育ゲーム制作）の配分を明示
  - 1ヶ月後（2027-01-26）に判定基準でデータ計測予定

**ポイント：**
- 「質 vs 量」は永遠の二項択一ではなく、**ステージに応じた動的な判断**
- AI自動生成導入時は「量増加 = 質低下」ではなく、「仕組みで質を担保」という発想の転換が重要
- 判定基準を事前に明示して、意思決定を「勘」から「データ」に転換

**タグ：** #sns-運用 #x-twitter #note #コンテンツ発信 #自動化 #初期段階 #増客

---

## Playwright / Web 自動化

### [汎用] SPA 対応：networkidle 回避と部分的遅延確認パターン

**用途：** Playwright で SPA（Single Page Application）環境下での自動化。`networkidle` ウェイト条件は通信が止まらないため無限タイムアウトになり、代替として `domcontentloaded` + 手動遅延確認の組み合わせが有効

**問題背景：**
- X（Twitter）・Discord・Slack など、リアルタイム通信を常時行うSPAアプリケーションでは `networkidle` が機能しない
- Playwright のデフォルト `wait_until="networkidle"` では以下が発生：
  ```
  ERROR: Page.goto: Timeout 30000ms exceeded.
  navigating to "https://x.com/compose/post", waiting until "networkidle"
  ```
- 単なる `domcontentloaded` だけではページが不安定な状態で要素選択を行うリスクが高まる

**解決策：2段階ウェイト戦略**
```python
# ステップ1: DOM 準備完了まで待機
page.goto(url, wait_until="domcontentloaded", timeout=20000)

# ステップ2: 特定の主要要素が stable になるまで待機
try:
    page.locator("input[placeholder*='何が起きてますか']").wait_for(
        timeout=5000, state="visible"
    )
    # DOM が安定していることの簡易確認
    page.wait_for_timeout(1000)  # 1秒の余裕持ち
except Exception:
    print("Compose 入力欄が見つかりません")
    raise
```

**URL の複数候補も並行対応：**
```python
compose_urls = [
    "https://x.com/compose/post",
    "https://x.com/home?compose_target=post",
    "https://x.com/i/compose/post",
]

for url in compose_urls:
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=15000)
        # ここでDOM安定性を確認
        page.locator("textarea").first.wait_for(timeout=3000, state="visible")
        print(f"✅ Compose 到達: {url}")
        break
    except Exception:
        continue
```

**ポイント：**
- `wait_until="networkidle"` は SPA では使用しない（代わりに `domcontentloaded` を基本）
- `domcontentloaded` 後に「主要な入力要素が visible」状態を確認（セレクタ複数候補）
- 手動で 1秒程度の遅延を挟んでから要素操作（レンダリング完成待ち）
- 複数 URL 候補 × セレクタ複数候補の組み合わせでロバスト性を大幅向上

**使用プロジェクト：** addness-side-income（post-to-x.yml）

**タグ：** #playwright #spa #networkidle #web-automation #x-twitter

---

## コンテンツ販売・記事生成

### [汎用] 有料記事の「3点セット」強制構成による市場適合性向上

**用途：** note・BOOTH等での有料デジタルコンテンツ（記事・テンプレ・ワークシート）販売において、読者が「買ったら得する感」「確実に再利用できる」という心理的安心感を得るための構成テンプレ

**背景：**
- 同じネタでも「読み物だけ」→「使える成果物+手順+数値」の3点セット化により、売上が大幅向上
- 教員・会社員ユーザーは「コピペで使える」「手順が明確」「信頼性が数値で証明」の3軸で購買判断

**構成：**
1. **コピペ可能な成果物**：テンプレ（Excel・スプレッドシート）、チェックリスト、コード、ワークシートなど
2. **手順チェックリスト**：「〇〇を開く」→「△△に記入」→「確認」という実行フロー
3. **数値表・配分表**：具体例データ、検証結果表、比較表など客観性を与える要素

**効果：**
- リピート購入率向上
- 他プロダクト比較時に「実装されてる」=「本気度が高い」という評価につながる
- 読みやすさも向上（セクション区切りが明確になる）

**例：**
- rakuda-sensei の「CHU1ワークシート」：Excel + 手順書 + 家計表サンプル
- 投資記事：テンプレ（家計簿フォーム）+ 貯金フロー図 + 現金管理ルール表

---

### [汎用] Sales Playbook による「嘘ゼロ運用」と自動改善ループ

**用途：** AI記事生成を複数回実行する際、ユーザーの実体データ（実際の支出・投資配分・体験）を一度 sales-playbook.md に記録することで、以降の全記事生成が「推測の嘘」ではなく「実データベース」で進む仕組み

**背景：**
- 初回の記事生成時、AIはユーザー背景を知らないため「月30万貯金」「オルカン80%」といった推測で埋める
- その後 voice-and-style.md に誘導型パラメータを追加しても、販売記事には誤情報が残存
- 既存8記事を全て手動修正するのは非効率

**仕組み：**
1. ユーザーが「実は〇〇です」と背景情報を一度提供
2. その情報を sales-playbook.md の「ユーザー実体」セクションに記録
3. generate_note_article.py が sales-playbook.md を参照するプロンプト生成
4. improve-articles.yml が sales-playbook.md 更新を検知 → 過去記事を自動で -v2 版に再生成
5. 既存記事も自動で訂正版に差し替え

**効果：**
- 「何もしなくても知識資産が時間とともに正確性が向上する」仕組み
- セッションの振り返りが「実体反映」になり、ユーザーの信頼性向上
- 新規テーマ追加時も sales-playbook に1行追記するだけで全記事が自動適応

**実装例：**
- rakuda-sensei では、投資体験情報（NISA15万+米株、米国70%+全世界20%+レバ6%）を記録し、improve-articles.yml で自動トリガー

---

### [汎用] 「4つの鉄板テーマ」による購買心理の共感最大化

**用途：** 教員・会社員向けのお金・キャリア・副業記事で、複数の実例・体験ネタがある場合、その中から「黄金の購買理由」になるテーマを意識的に選択・構成する戦略

**背景：**
- 同じ「資産形成」テーマでも、記事構成により購買心理の動き方が大きく異なる
- rakuda-sensei の実例から、以下の4テーマが特に「共感 → 購買」につながることが判明

**4つのテーマ：**
1. **「先取り投資→生活→貯金」フロー**：「まず投資に回して、残りで生活する」という逆転の発想が、読者に「あ、自分もできるかも」という黄金の購買理由になる
2. **固定費の洗い出し**：「家計改善の第一歩」という位置づけが、「やることが明確だから買う」という信頼につながる
3. **家計簿で変動費把握**：テンプレコピペで即実行できる感が、「本当に使えそう」という確信を生む
4. **投信10銘柄カオスの経緯**：「最初は混乱していた」というリアルな体験が、「同じく失敗した人が言ってるなら信用できる」という共感を生む

**効果：**
- テンプレ記事（型番いくつ分散 → リスク減）よりも、「人間の迷いと回復」の方が心理的説得力が高い
- 3回以上同じテーマが articles/ に出現すると「ユーザーが何を欲しているか」が見える
- 新規テーマ設計時は、必ずこの4テーマ + ユーザー固有体験の組み合わせを検討

**実装例：**
- 記事タイトル設計時に「この記事は4テーマのどれを軸にするか」を明記
- sales-playbook.md に「人間臭いエピソード」を積極的に記録

---

## Playwright / Web 自動化

### [汎用] Playwright セレクタの複数パターンフォールバック戦略

**用途：** Webブラウザ自動化（BOOTH・note等への自動投稿）で、単一セレクタだと環境差異・フレームワーク更新・複数ページ仕様に対応できない場合、複数候補セレクタを段階的に試行する

**問題背景：**
- 単一セレクタ（例：`input[name="item[name]"]`）のみだと「ページ仕様変更」「複数ページ形式」「レンダリング差異」で失敗
- GitHub Actions環境とローカル環境で異なるDOM構造になることもある
- note・BOOTH は複数年のプロダクト更新で段組み・要素命名が異なる

**解決策：複数セレクタの並列トライ（フォールバック）**
```python
# 例：商品名入力
name_selectors = [
    'input[name="item[name]"]',           # 標準的な属性ベース
    'input[name*="name"][type="text"]',   # 属性部分一致
    'input[name*="title"]',               # タイトル名称
    'input[placeholder*="商品名"]',       # プレースホルダ
    'input[id*="name"]',                  # ID属性
    'textarea[name*="name"]',             # テキストエリア
    '[data-testid*="name"] input',        # data-testid
    'form input[type="text"]:first-of-type',  # CSS疑似セレクタ
]

name_filled = False
for sel in name_selectors:
    try:
        el = page.locator(sel).first
        el.wait_for(timeout=3000, state="visible")
        el.fill(value)
        print(f"✅ 入力完了 (selector: {sel})")
        name_filled = True
        break
    except Exception:
        continue

if not name_filled:
    print("ERROR: 全セレクタ不一致", file=sys.stderr)
    return False
```

**URL候補のトライも同様に対応：**
```python
new_item_urls = [
    "https://manage.booth.pm/items/new",
    "https://manage.booth.pm/products/new",
    "https://manage.booth.pm/items/add",
]

page_loaded = False
for url in new_item_urls:
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
        if "login" in page.url.lower():  # ログインへのリダイレクト検知
            continue
        page_loaded = True
        break
    except Exception:
        continue
```

**セレクタ戦略の階層（堅牢性の順）：**
1. **属性完全一致** (`input[name="item[name]"]`) — 仕様変更に弱い
2. **属性部分一致** (`input[name*="name"]`) — やや堅牢
3. **プレースホルダ** (`input[placeholder*="商品名"]`) — UI テキストベースで堅牢
4. **ID属性** (`input[id*="name"]`) — フレームワーク由来、中程度堅牢
5. **data-testid** (`[data-testid*="name"]`) — テスト駆動開発のサイトなら最強
6. **疑似セレクタ** (`form input:first-of-type`) — 最後の手段

**失敗ログの診断スクリーンショット：**
```python
try:
    page.screenshot(path="booth-01-newitem-page.png")  # 到達時点
except Exception:
    pass

if not name_filled:
    try:
        page.screenshot(path="booth-02-name-not-found.png")  # 失敗時点
    except Exception:
        pass
```

**ポイント：**
- 複数候補は「すべて試す」のではなく「成功したら break」（効率性）
- タイムアウト値を短めに（3秒程度）して、不一致時の判定を素早く
- ログに「どのセレクタで成功したか」を記録すれば、次の修正が早い
- スクリーンショットの命名を細分化（01・02・03）することで、どの段階で失敗したか可視化
- GitHub Actions Artifacts でスクショを保存すれば、エージェントも人間も原因特定が容易

**使用プロジェクト：** rakuda-sensei（post_to_booth.py, post_to_note.py）

**タグ：** #playwright #web-automation #resilience #selector #fallback

---

### [汎用] Playwright セレクタ不一致時の自動診断：ページ状態情報の構造化抽出

**用途：** Playwright でセレクタが見つからず自動化が失敗した場合、原因特定のために「ページ全体の状態」を構造化してダンプ出力する。「なぜセレクタが効かないのか」を GitHub Actions ログから即座に判断できるようにする

**問題背景：**
- セレクタが不一致でも「選択されませんでした」というログだけでは、原因が「ページが読み込まれていない」なのか「DOM構造が想定と異なる」なのか「ログイン画面にリダイレクト」なのか不明
- BOOTH・note等の管理画面は複数バージョンのUI共存、リダイレクト遷移、動的レンダリングが複雑で、単なるスクリーンショットでは対応不足
- 「どの画面にいるのか」「何が入力可能なのか」「何がブロッキング要因か」が不明確だと、次の対応が決まらない

**解決策：構造化情報の自動抽出ダンプ**
```python
async def dump_page_state_on_failure(page, output_prefix="booth-dump"):
    """セレクタ不一致時に、ページ全体の状態を自動出力"""
    
    try:
        # 1. ページタイトルと URL
        title = await page.title()
        url = page.url
        print(f"\n📍 ページ状態ダンプ: {title}")
        print(f"   URL: {url}")
        
        # 2. 見出し（h1/h2/h3）を全て抽出
        headings = await page.locator("h1, h2, h3").all_text_contents()
        if headings:
            print(f"\n📋 見出し:")
            for heading in headings:
                print(f"   - {heading[:100]}")
        
        # 3. 可視テキスト先頭2000字
        body_text = await page.locator("body").text_content()
        if body_text:
            visible_text = body_text[:2000]
            print(f"\n📄 可視テキスト（先頭2000字）:")
            print(visible_text)
            print("...")
        
        # 4. 阻害要因のキーワード検出
        blocking_keywords = ["ショップ設定", "カテゴリ", "本人確認", "振込先", "利用規約", "ログイン", "accounts.pixiv"]
        detected_keywords = [kw for kw in blocking_keywords if kw in body_text]
        if detected_keywords:
            print(f"\n⚠️  阻害要因キーワード検出:")
            for kw in detected_keywords:
                print(f"   - {kw}")
        
        # 5. 全 input 要素の属性
        inputs = await page.locator("input, textarea").all()
        if inputs:
            print(f"\n⌨️  入力要素 ({len(inputs)}個):")
            for i, inp in enumerate(inputs[:20]):  # 最初の20個に制限
                input_type = await inp.get_attribute("type") or "text"
                input_name = await inp.get_attribute("name") or "(no name)"
                input_placeholder = await inp.get_attribute("placeholder") or ""
                print(f"   {i+1}. type={input_type} name={input_name} placeholder='{input_placeholder}'")
        
        # 6. クリック可能要素（a, button, [role="button"]）
        clickables = await page.locator("a, button, [role='button']").all()
        if clickables:
            print(f"\n🔘 クリック可能要素 ({len(clickables)}個、最初10個):")
            for i, el in enumerate(clickables[:10]):
                text = (await el.text_content()).strip()[:50]
                href = await el.get_attribute("href") or ""
                print(f"   {i+1}. {text} {f'({href})' if href else ''}")
        
        # 7. スクリーンショット保存
        await page.screenshot(path=f"{output_prefix}-state.png")
        print(f"\n📸 スクリーンショット保存: {output_prefix}-state.png")
        
    except Exception as e:
        print(f"⚠️  ダンプ中にエラー: {e}")
```

**GitHub Actions ログでの活用例：**
```
📍 ページ状態ダンプ: BOOTH 商品編集
   URL: https://manage.booth.pm/items/123/edit

📋 見出し:
   - 商品情報
   - 在庫・価格設定

📄 可視テキスト（先頭2000字）:
   商品名 商品説明 商品タイプ...

⚠️  阻害要因キーワード検出:
   - ショップ設定
   - 本人確認

⌨️  入力要素 (15個):
   1. type=text name=item[name] placeholder='商品名を入力'
   2. type=hidden name=_token placeholder=''
   3. type=text name=item[description] placeholder=''
   ...

🔘 クリック可能要素 (8個、最初10個):
   1. 保存する (/items/123/edit)
   2. プレビュー
   3. 削除する
   ...

📸 スクリーンショット保存: booth-dump-state.png
```

**ポイント：**
- ページ遷移時にこのダンプを自動実行することで、「到達した画面」が即座に見える
- 見出し + キーワード検出により「何の画面か」が数秒で判断可能
- input 要素一覧から「利用可能なセレクタ候補」が直ちに得られる
- クリック可能要素から「次に遷移するべき画面」の候補が見える
- スクリーンショット + 構造化情報の組み合わせで、GitHub Actions ログから完全に原因特定可能

**実装箇所：**
- rakuda-sensei の `post_to_booth.py` セレクタ不一致時の exception handler
- `post_to_note.py` の note 管理画面ナビゲーション失敗時

**プロジェクト実装例（post_to_booth.py）：**
```python
try:
    # セレクタ試行フロー...
    if not name_filled:
        await dump_page_state_on_failure(page, "booth-01-name-input")
        return False
except Exception as e:
    await dump_page_state_on_failure(page, f"booth-error-{str(e)[:20]}")
    raise
```

**タグ：** #playwright #web-automation #diagnosis #debugging #structured-output

---

## Web 自動化 / ブラウザ認証

### [汎用] Playwright stealth + クッキー認証による Bot 検出回避

**用途：** Web サイト（特に X/Twitter などの Bot 検出厳格なサイト）への自動ログインで、Playwright 単体では bot として検出・ブロックされる場合、`playwright-stealth` プラグイン + 複数クッキーの正規化で人間のアクセスを偽装

**問題背景：**
- Playwright は自動化ツールとしてブラウザに認識される（User-Agent、各種JS実行パターン）
- X.com は reCAPTCHA + Cloudflare bot 管理で厳格に bot 検出・ブロック
- 単なる User-Agent 変更や JavaScript 無効化では対応不足
- セッションクッキーの形式が正規化されていないと、セッション無効判定される

**解決策1：playwright-stealth の導入**
```python
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

async with async_playwright() as p:
    browser = await p.chromium.launch(headless=True)
    context = await browser.new_context()
    page = await context.new_page()
    
    # Stealth プラグインを適用（bot 検出回避）
    await stealth_async(page)
    
    # 以降の操作は人間のブラウザに見える
    await page.goto("https://x.com")
```

**解決策2：複数クッキーの正規化と登録**

X.com の重要クッキー（セッション16で確認）：
```python
import json
import os

# ユーザーが Cookie-Editor で Export した JSON をパース
cookies_json = os.getenv("X_SESSION_COOKIE")  # GitHub Secret から読み込み
cookies_list = json.loads(cookies_json)

# 必須クッキー（9個）の存在確認と正規化
required_cookies = {
    "auth_token",      # セッション ID
    "ct0",             # CSRF トークン
    "twid",            # ユーザー ID
    "personalization_id",
    "guest_id",
    "kdt",
    "external_user_id",
    "mbox",
    "__cf_bm",         # Cloudflare bot 管理
}

for cookie in cookies_list:
    if cookie["name"] in required_cookies:
        # 形式検証：domain, path, secure, httpOnly を確認
        if not all(k in cookie for k in ["name", "value", "domain"]):
            raise ValueError(f"Invalid cookie format: {cookie['name']}")

# コンテキストに適用
context = await browser.new_context()
await context.add_cookies(cookies_list)
```

**重要なクッキーの役割：**
| クッキー | 役割 | 有効期限 |
|---------|------|---------|
| `auth_token` | セッション認証（最重要） | 数ヶ月 |
| `ct0` | CSRF トークン | セッション中 |
| `twid` | ユーザー ID 特定 | 数ヶ月 |
| `__cf_bm` | Cloudflare bot 検出回避 | 30分 |
| `personalization_id` | ユーザー追跡 | 数年 |

**セキュリティ考慮：**
```python
# ❌ 平文で Secret に保存してはいけない
COOKIE_JSON = "auth_token=abc123&ct0=def456..."  # 危険

# ✅ JSON 形式で Secret に保存（GitHub Secret として自動暗号化）
X_SESSION_COOKIE = """[
  {"name": "auth_token", "value": "abc123...", "domain": ".x.com", "path": "/", "secure": true, "httpOnly": true},
  {"name": "ct0", "value": "def456...", "domain": ".x.com", "path": "/", "secure": true},
  ...
]"""

# ワークフロー内で復号化して使用
cookies_list = json.loads(os.getenv("X_SESSION_COOKIE"))
```

**実装ポイント：**
- Stealth プラグインは `page.goto()` の前に必ず適用（ページ読み込み前にJS検出回避を有効化）
- クッキーは `context.new_page()` ではなく `context = new_context(cookies=...)` の段階で登録
- `__cf_bm` は Cloudflare が要求に応じて自動更新するため、定期的な re-export が必要（月1回程度推奨）
- セッション有効期限の監視：Issue 自動起票で「クッキーが古い可能性」をユーザーに通知

**検証方法（ローカル）：**
```python
# Cookie-Editor (Chrome拡張) で Export → JSON で保存
# → GitHub Secret `X_SESSION_COOKIE` に貼り付け
# → ワークフロー実行 → X タイムラインで投稿確認

# 失敗時のログ確認：
# - Page タイトルが「X / Twitter」か「log in」か
# - Artifacts に保存されたスクショで「投稿ボタン」が見えるか
```

**実装例（post-to-x.yml）：**
```yaml
- name: X に自動投稿（Playwright + Stealth）
  run: |
    python3 -c "
    import asyncio, json, os
    from playwright.async_api import async_playwright
    from playwright_stealth import stealth_async
    
    async def post():
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()
            page = await context.new_page()
            await stealth_async(page)  # Bot 検出回避
            
            # クッキー登録
            cookies = json.loads(os.getenv('X_SESSION_COOKIE'))
            await context.add_cookies(cookies)
            
            # 投稿処理...
            await page.goto('https://x.com/compose/post', wait_until='domcontentloaded')
            # ...
    
    asyncio.run(post())
    "
  env:
    X_SESSION_COOKIE: \${{ secrets.X_SESSION_COOKIE }}
```

**ポイント：**
- セッション16・17・18にわたって実機で継続稼働が実証（3セッション以上の成功 = パターン化確定）
- 初回セットアップ（Cookie-Editor export）は人間作業だが、以降は完全自動
- クッキー有効期間内での安定投稿を実現（本番稼働のベース）
- `__cf_bm` など動的クッキーも含めた複数クッキー構成がロバスト性の鍵

**注意：**
- クッキー有効期限切れ時はユーザーが再 export して Secret を更新する必要あり
- X がセッション管理を変更すると対応が必要（3ヶ月ごとの確認推奨）

**使用プロジェクト：** addness-side-income（post-to-x.yml, セッション16・17・18で本番稼働開始）

**タグ：** #playwright #web-automation #stealth #cookie #authentication #bot-detection #x-twitter

---

## GitHub Actions

### [汎用] GitHub Actions ワークフロー権限管理の必須セクション（permissions）

**用途：** GitHub Actions ワークフロー内で GitHub API 操作（Issue 作成、PR merge、Secret アクセスなど）を行う場合、`permissions` セクションで明示的に権限を指定しないと「Permission denied」エラーで失敗

**問題背景：**
- GitHub Actions のデフォルト権限は最小限（読み取りのみ）
- Issue 作成・PR merge・コメント投稿などの書き込み操作は明示的な権限指定が必須
- ワークフロー実行時に権限不足でエラーが発生してから気づくケースが多い
- セッション17で X 自動投稿ワークフローが「Issue 作成権限不足」で失敗

**解決策：ワークフロース最上部に `permissions` セクションを追加**

```yaml
name: Post to X

on:
  schedule:
    - cron: '0 7 * * *'  # 毎日 7:00 UTC
  workflow_dispatch:

permissions:
  contents: read          # リポジトリコンテンツ読み取り
  issues: write           # Issue 作成・更新
  pull-requests: write    # PR 操作
  id-token: write         # OIDC（Optional、Cloud services の認証用）

jobs:
  post-to-x:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Post to X
        run: python3 scripts/post_to_x.py
        env:
          X_SESSION_COOKIE: ${{ secrets.X_SESSION_COOKIE }}
      
      - name: Create issue on failure
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 X 自動投稿に失敗',
              body: `ワークフロー: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`
            })
```

**権限フィールド一覧：**

| 権限 | 用途 | デフォルト |
|------|------|----------|
| `contents: read` | リポジトリコンテンツ読み取り | ✅ 有効 |
| `contents: write` | git commit・push | ❌ 無効 |
| `issues: write` | Issue 作成・コメント・ラベル | ❌ 無効 |
| `pull-requests: write` | PR 操作・コメント・review | ❌ 無効 |
| `packages: write` | Docker イメージ push | ❌ 無効 |
| `id-token: write` | OIDC Token 発行（AWS・GCP認証用） | ❌ 無効 |

**実装ポイント：**
1. 必要な権限のみを指定（セキュリティ最小権限の原則）
2. ワークフロー実行前にログから「Permission denied」を探す癖をつける
3. 複数ジョブがある場合は、`jobs.<job-name>.permissions` で ジョブ単位のオーバーライドも可能

**ジョブ単位でのオーバーライド例：**
```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read  # check ジョブは読み取り専用
    steps:
      - run: echo "Checking..."
  
  post:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # post ジョブだけ書き込み可能
      issues: write
    steps:
      - run: python3 post.py
```

**デバッグ方法：**
```bash
# ローカルで権限エラーが出たら、ワークフロー YAML に以下を追加
- name: Debug permissions
  run: |
    echo "Current token scopes:"
    curl -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
         https://api.github.com/user
```

**ポイント：**
- セッション17で「GitHub Issue 作成権限不足」→「`permissions: issues: write` 追加」で解決した具体例
- デフォルトで権限がないため「実装 → テスト → エラー発見 → 権限追加」のサイクルが発生しやすい
- 実装フェーズで「何の API を呼ぶか」を事前に洗い出し、必要な権限を先制的に指定する習慣が重要

**使用プロジェクト：** addness-side-income（post-to-x.yml, post-to-note.yml, improve-articles.yml など複数ワークフロー）

**タグ：** #github-actions #permissions #security #api #debugging

---

### [汎用] GitHub Actions の条件式制限と回避策

**用途：** GitHub Actions ワークフロー内で複雑な条件（モジュロ演算など）を使う場合、native な条件式では対応不可なため、ロジックを簡潔化するか外部スクリプト呼び出しに委譲する

**制限一覧：**
- ❌ モジュロ演算（`%`）：非対応
- ❌ 複雑な数値演算：非対応
- ✅ 単純な比較（`==`, `!=`, `>`, `<`）：対応
- ✅ 論理演算（`&&`, `||`, `!`）：対応

**回避策1：ロジックを簡潔化（推奨）**
```yaml
# 旧：隔週で生成（モジュロが必要で失敗）
if: ${{ github.event.schedule && (github.run_number % 2 == 0) }}

# 新：スケジュール実行時は常に生成
if: ${{ github.event_name == 'schedule' }}
```

**回避策2：Python スクリプトに委譲（複雑な場合）**
```yaml
- name: Determine action
  id: action_decider
  run: |
    week_num=$(($(date +%V) % 2))
    if [ $week_num -eq 0 ]; then
      echo "generate_booth=true" >> $GITHUB_OUTPUT
    else
      echo "generate_booth=false" >> $GITHUB_OUTPUT
    fi

- name: Run BOOTH generation
  if: steps.action_decider.outputs.generate_booth == 'true'
  run: python3 generate_booth.py
```

**ポイント：**
- GitHub Actions の条件式は intentionally シンプル設計（デバッグ性重視）
- 複雑なビジネスロジックは Python/Bash スクリプト層で実装すべき
- ワークフローは「どのスクリプトをいつ呼ぶか」に徹する設計が保守性を上げる

**使用プロジェクト：** rakuda-sensei（weekly-content-pipeline.yml）

**タグ：** #github-actions #yaml #debugging #conditional-logic

---

### [汎用] GitHub Actions での並列ジョブの git push 競合解消

**用途：** 複数ジョブが並列実行され、それぞれが git push する際に「リモートに新しいcommitがある」エラーが発生する場合、順次実行化と再試行ロジックで解決

**問題：** 
```
Error: failed to push some refs to 'https://github.com/.../repo.git'
hint: Updates were rejected because the remote contains work that you do
hint: not have locally. This is usually caused by another process pushing
```
→ 並列実行の複数ジョブが同時に push しようとして競合発生

**解決策1：ジョブの順次実行化（推奨）**
```yaml
jobs:
  generate-all:
    runs-on: ubuntu-latest
    steps:
      - name: Generate X content
        run: python3 generate_x.py
      
      - name: Generate note content
        run: python3 generate_note.py
      
      - name: Generate BOOTH content
        run: python3 generate_booth.py
      
      - name: Push all at once
        run: |
          git add -A
          git commit -m "chore: auto-generate content"
          git push origin HEAD
```

**解決策2：並列ジョブの場合は pull-rebase 再試行（5回、指数バックオフ）**
```yaml
- name: Push with retry
  run: |
    for i in {1..5}; do
      git push origin HEAD && break
      echo "Push failed. Retrying in $(($i * 2)) seconds..."
      sleep $(($i * 2))
      git pull --rebase origin main
    done
```

**ポイント：**
- 複数ジョブの git操作は「最終的に同期が取れれば良い」という柔軟性が重要
- 順次実行は遅いが確実；並列実行は速いが再試行ロジックが必須
- 指数バックオフ（2秒→4秒→6秒）で、リモートの変更を拾う時間を稼ぐ

**使用プロジェクト：** rakuda-sensei（weekly-content-pipeline.yml, post-to-x.yml, post-to-threads.yml, daily-instagram.yml）

**タグ：** #github-actions #git #parallelism #concurrency

---

## テンプレート

```
### [汎用 or プロジェクト名] パターン名

**用途：** どういう場面で使うか

**コード：**
（コードスニペット）

**ポイント：** なぜこの実装が良いか、注意点

**使用プロジェクト：** プロジェクト名1, プロジェクト名2

**タグ：** #quiz #animation #accessibility など
```

---

## 自動化・スクリプト

### [汎用] 複数ワークフロー統合による無料クラウドコンピュート実現

**用途：** GitHub Actions の月2,000分無料枠を活用し、複数の自動生成・投稿ワークフローをスケジュール競合なく統合運用する

**パターン：** 
1. 複数の自動化ワークフロー（X投稿、note投稿、BOOTH教材生成など）を個別のワークフローファイルとして実装
2. 親ワークフロー（`workflow_dispatch` + `schedule` トリガー）で統合管理し、スケジュール重複を回避
3. GitHub Models（gpt-4o-mini）で全コンテンツ生成（無料、トークン上限あり）
4. Meta Graph API + Playwright でプラットフォーム投稿を自動化（API課金なし）
5. Issue 自動起票 + メール通知で24時間監視・障害検知を実現

**実装例（workflow_dispatch + schedule の併用）：**
```yaml
name: Weekly Content Pipeline

on:
  workflow_dispatch:  # 手動テスト用
    inputs:
      debug_mode:
        description: 'Enable debug output'
        required: false
        default: 'false'
  schedule:
    - cron: '0 21 * * 0'  # 毎週日曜 21:00 UTC

jobs:
  generate-and-post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Generate content
        run: |
          # GitHub Models + Claude で生成
          echo "Generating content..."
      - name: Post to X
        run: python3 automation/post_x.py
      - name: Post to note
        run: python3 automation/post_note.py
```

**セキュリティ考慮（PyNaCl による Secret 暗号化）：**
- 自動延長トークンを AES-256 で暗号化して Secret に保存
- 毎月1日の定期実行時に復号化・延長・再暗号化を自動実行
- ワークフロー失敗時は Issue 自動起票で人間に通知

**ポイント：**
- 月2,000分（約33時間）で、毎週100本超のコンテンツを永久に回し続けられる
- 初期セットアップ（アカウント作成・Secret登録）は人間必須だが、以降は完全自動
- `workflow_dispatch` で本番前にいつでも手動テスト可能
- Issue 自動起票により、エージェントが人間に24時間報告可能

**注意：**
- GitHub Models のトークン上限に注意（月間制限あり）
- ワークフロー実行時刻は UTC ベース（日本時間への変換が必須）
- Secret の暗号化キーは環境変数として管理（リポジトリに平文保存しない）

**使用プロジェクト：** rakuda-sensei（副業自動化システム）

**タグ：** #github-actions #automation #free #api #cron #security

---

### [汎用] settings.json での自動 commit & push フック

**用途：** セッション終了時に自動で git 操作を実行し、push 忘れを防ぐ

**コード（settings.json）：**
```json
{
  "stop_hook": {
    "type": "command",
    "script": [
      {
        "condition": "file_changed",
        "command": "git add -A && git commit -m 'chore: セッション終了 - 自動保存' && git push origin HEAD || true"
      }
    ]
  }
}
```

**使用例：**
- 毎セッション終了時に変更を自動保存
- push 忘れの救済
- 複数ファイル変更時の一括 commit

**ポイント：**
- `|| true` で失敗時もエラーを無視（変更がない場合も考慮）
- `file_changed` 条件で「変更がある場合のみ」実行可能（トークン節約）
- commit メッセージを統一するとログが見やすい

**注意：** Stop フックは「セッション終了」ではなく「Claudeの返答後」に毎回発動するため、AI処理（振り返りなど）をここに入れてはいけない。軽量な git コマンドのみに限定する

**使用プロジェクト：** workspace-setup

**タグ：** #automation #git #hook #claude-code #workflow

---

## 初期パターン集

### [汎用] クイズ問題のシャッフル表示

**用途：** 問題リストをランダム順で出題する

**コード：**
```javascript
// Fisher-Yatesアルゴリズムによるシャッフル
function shuffle(array) {
  const arr = [...array]; // 元の配列を変更しないようコピー
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 使用例
const questions = shuffle(questionList);
```

**ポイント：** 元の配列を破壊しないよう `[...array]` でコピーしてから処理する

**使用プロジェクト：** （初期登録）

**タグ：** #javascript #quiz #array

---

### [汎用] 正解・不正解フィードバック表示

**用途：** 答え合わせ後に視覚的フィードバックを表示する

**コード：**
```javascript
function showFeedback(isCorrect, correctAnswer) {
  const feedback = document.getElementById('feedback');
  if (isCorrect) {
    feedback.textContent = '✓ 正解！';
    feedback.className = 'feedback correct';
  } else {
    feedback.textContent = `✗ 不正解。正解は「${correctAnswer}」`;
    feedback.className = 'feedback incorrect';
  }
}
```

```css
.feedback {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 18px;
  font-weight: bold;
  text-align: center;
  margin: 16px 0;
}
.feedback.correct   { background: #d4edda; color: #155724; border: 2px solid #28a745; }
.feedback.incorrect { background: #f8d7da; color: #721c24; border: 2px solid #dc3545; }
```

**ポイント：** 色だけでなくアイコン（✓/✗）とテキストで区別する（色覚アクセシビリティ対応）

**使用プロジェクト：** （初期登録）

**タグ：** #javascript #css #quiz #accessibility #feedback

---

### [汎用] スコア表示と進捗バー

**用途：** 現在の問題番号・スコアを常に表示する

**コード：**
```html
<div class="progress-bar">
  <div class="progress-fill" id="progressFill"></div>
</div>
<p class="score-text">問題 <span id="currentQ">1</span> / <span id="totalQ">10</span> ｜ スコア: <span id="score">0</span></p>
```

```css
.progress-bar {
  height: 12px;
  background: #e9ecef;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}
.progress-fill {
  height: 100%;
  background: #28a745;
  border-radius: 6px;
  transition: width 0.3s ease;
}
.score-text { font-size: 14px; color: #666; text-align: right; }
```

```javascript
function updateProgress(current, total, score) {
  document.getElementById('progressFill').style.width = `${(current / total) * 100}%`;
  document.getElementById('currentQ').textContent = current;
  document.getElementById('totalQ').textContent = total;
  document.getElementById('score').textContent = score;
}
```

**ポイント：** `transition` でアニメーションを付けると達成感が出る

**使用プロジェクト：** （初期登録）

**タグ：** #css #javascript #quiz #progress #ux

---

### [汎用] 画面遷移なしのページ切り替え（シングルページ方式）

**用途：** HTMLを1ファイルにまとめ、セクションの表示/非表示で画面遷移を再現する

**コード：**
```html
<!-- 各画面をsectionで定義 -->
<section id="screen-start"  class="screen active">スタート画面</section>
<section id="screen-quiz"   class="screen">クイズ画面</section>
<section id="screen-result" class="screen">結果画面</section>
```

```css
.screen { display: none; }
.screen.active { display: block; }
```

```javascript
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// 使用例
showScreen('screen-quiz');
```

**ポイント：** ファイルが1つで済むため配布・共有が簡単。ページ遷移なしで動作も高速

**使用プロジェクト：** （初期登録）

**タグ：** #javascript #css #spa #single-file

---

## 関連リンク

- 失敗・注意点 → [failures.md](./failures.md)
- コーディング規約 → [rules.md](./rules.md)
- UIコンポーネント → [ui-components.md](./ui-components.md)
