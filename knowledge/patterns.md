# 成功パターン集

最終更新：2026-05-24

新しいパターンは **先頭に追加** する。プロジェクト名を必ず記載。
複数プロジェクトで使えると判明したパターンには `[汎用]` タグをつける。

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
