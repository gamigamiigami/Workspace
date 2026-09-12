# failures Skill

## Overview
過去にハマった失敗・原因・対処の記録（67項目）。実装前とデバッグ時に見る。

## 使い方（トークン節約・この順で）
1. 索引 `knowledge/failures.md`（約80行）を読む
2. 関係しそうな項目だけ行番号で読む → `sed -n '133,173p' knowledge/details/failures.md`
3. 症状で探す → `grep -n "キーワード" knowledge/details/failures.md`

**`knowledge/details/failures.md`（1,800行）を全文読まないこと。**

## よく効く定番（毎回思い出すもの）
- `localStorage` は必ず try-catch で囲む（プライベートモードで例外）
- iOS の touch イベントは `{ passive: true/false }` を明示する
- 縦書き `writing-mode: vertical-rl` はブラウザ差異が大きい。実機確認する

## 追記するとき
1. `knowledge/details/failures.md` の先頭に「症状／原因／対処」で追記
2. `bash knowledge/details/build-index.sh` で索引を作り直す
