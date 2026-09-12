# deploy-pages Skill

## Overview
GitHub Pages への公開手順と、公開ページのリンクを壊さないためのルール。

## When to use
- 新しいサイトを公開するとき
- 公開ページのURL・ワークフローをさわるとき
- 運用ブランチへマージするとき

---

## 絶対に守ること

1. **既存の公開リンクを壊さない**
   - 旧URL `https://gamigamiigami.github.io/Workspace/kaeriten-quest/` は生徒に配布済み。404にする変更は禁止。
   - 新URL `/projects/kaeriten-quest/` も併せて維持する。
2. **全公開サイトは新旧URL両対応を保つ**
   - `deploy-pages.yml` は各サイトを `_site/<名前>/`（旧）と `_site/projects/<名前>/`（新）の両方に配置している。この両配置を消さない。
3. **公開係のワークフローは `deploy-pages.yml` の1本だけ**
   - 旧 `deploy-dashboard.yml` は自動実行停止済み。復活させて二重化すると404の原因になる。
4. **機密は公開しない**
   - `knowledge/` `CLAUDE.md` `rakuda-sensei` 等を `PUBLIC_DIRS` に入れない。

---

## 新サイト公開の手順

1. `projects/<名前>/` に作る
2. `deploy-pages.yml` の `PUBLIC_DIRS` に `<名前>` を追加
3. `site/index.html`（作品一覧トップ）にカードを1枚追加
4. 運用ブランチ `claude/workspace-knowledge-base-setup-ccVKP` にマージして push（ここからのみ Pages 公開される）
5. GitHub Actions の `deploy-pages.yml` が成功したことを確認してから完了報告

---

## 運用ブランチへのマージ（確認不要・2026-08-31 オーナー承認、以後ずっと有効）

作業ブランチでの作業が終わり検証まで通ったら、運用ブランチへのマージと push まで確認なしで実行してよい。

手順：`git fetch origin <運用ブランチ>` → 作業ブランチに取りこんで衝突解消 → 運用ブランチへマージ（早送りできるなら早送り）→ push → 作業ブランチにもどる。

**例外（必ず確認する）**：衝突が出たとき／公開ページを消す・404にする変更のとき。

**git が権限制限を受ける環境では** GitHub PR API を使う（`mcp__github__*` ツール）。2026-08-31 セッション175で PR 作成・マージが正常に機能することを実証済み。
