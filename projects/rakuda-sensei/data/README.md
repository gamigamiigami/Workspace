# 売上データフォルダ

月初に各管理画面からCSVをダウンロードしてここにcommitする。
月次PDCAレポートが自動生成される（`.github/workflows/monthly-pdca.yml`）。

## フォルダ構成

```
data/
└── {YYYY-MM}/          ← 対象月のフォルダを作って入れる
    ├── note.csv        ← note 売上明細
    ├── booth.csv       ← BOOTH 売上明細
    └── kindle.csv      ← KDP 売上明細
```

## 取得手順

詳細は `knowledge/handoff.md` を参照。

| チャネル | CSV取得場所 | 所要時間 |
|---|---|---|
| note | note.com > クリエイターページ > 売上 | 1分 |
| BOOTH | manage.booth.pm > 売上管理 | 1分 |
| Kindle | KDPセルフサービス > レポート | 2分 |

合計: **月5分**
