# らくだ先生 プロフィールアイコン仕様書

作成日：2026-05-24
対応Addnessゴール：`5f79b547`

---

## 用途

X / note / BOOTH / Kindle 著者アイコン（全チャネルで同じ画像を使用してブランディング統一）。

---

## 推奨：3つの入手方法

### 方法1：AI画像生成（即時・無料〜数百円）

**Midjourney / DALL-E 3 / Stable Diffusion** で生成。
推奨プロンプト（コピペで使用可）：

#### 英語プロンプト（Midjourney / DALL-E）
```
A cute friendly cartoon camel character wearing round glasses, sitting relaxed with a slightly tired but content expression, simple flat illustration style, beige sandy body color with light blue accent on glasses, plain solid pastel background, centered composition, profile icon style, no text, square format

--ar 1:1 --style raw --v 6
```

#### 日本語プロンプト（ChatGPT/DALL-E用）
```
かわいいフラットイラスト調のラクダのキャラクター。
丸い眼鏡をかけて、リラックスした姿勢でちょっと疲れているけど満足そうな表情。
体は砂色（ベージュ）、眼鏡は薄い青のアクセント。
背景は単色のパステル系（薄いベージュやクリーム色）。
中央配置のプロフィールアイコン用、テキストなし、正方形。
ライン少なめのシンプルなデザイン。
```

#### Stable Diffusion（無料）の場合
- モデル：`AnythingV5`、`Counterfeit`、`Flat2D` などのキャラ系
- ネガティブプロンプト：`realistic, photo, text, watermark, complex background, multiple characters`

**コスト：** ChatGPT Plus (¥3,000/月)あり、Midjourney $10/月、無料はStable Diffusion (ローカル)

### 方法2：ココナラ等で発注（1〜2週間・¥3,000〜¥5,000）

**おすすめ：ココナラの「アイコン作成」カテゴリ**
- 検索キーワード：「アイコン イラスト 動物 シンプル」
- 評価★4.5以上、納期1週間以内のクリエイターを選定

**発注書テンプレ（コピペでメッセージ送信）：**
```
お世話になります。
SNS（X、note、BOOTH、Amazon）で使うプロフィールアイコンの制作をお願いしたく、ご相談です。

【依頼内容】
ラクダのキャラクターを使ったプロフィールアイコン1点

【イメージ】
- 親しみやすい、可愛い、デフォルメ系
- 表情：リラックスして少し疲れているけど満足そう
- アクセサリー：丸い眼鏡（任意で本やペン）
- 体の色：砂色／ベージュ系
- 背景：単色（パステル系）
- スタイル：フラットイラスト調、線少なめ

【コンセプト】
「残業嫌いの中学校教員」をモチーフにしたキャラクター。
「ラクだ＝らくだ」のダジャレで、時短・働き方をテーマに発信するアカウントです。

【納品形式】
- 1024×1024 px PNG
- 背景透過版もあれば嬉しいです

【納期】
2週間以内希望

【予算】
¥3,000〜¥5,000

ご検討よろしくお願いします。
```

### 方法3：フリー素材で代用（即時・¥0）

**イラストAC・ぱくたそ等で「ラクダ イラスト」検索**
- 商用利用OKを確認
- 差別化弱いので暫定的に使う場合のみ
- 後で方法1/2に切り替え推奨

---

## 仕様（最終納品物の要件）

| 項目 | 要件 |
|------|------|
| サイズ | 最小 512×512 px、推奨 1024×1024 px |
| 形式 | PNG（背景透過版もあれば◎） |
| ファイル名 | `rakuda-sensei-icon-v1.png` |
| 配色 | 砂色/ベージュ + アクセント1色（青or緑推奨） |
| 構図 | 中央配置（クロップ耐性） |
| テキスト | なし（汎用性のため） |
| 保存先 | `projects/rakuda-sensei/assets/` |

---

## 検収チェックリスト

入手後の確認：
- [ ] 正方形である
- [ ] 解像度が512px以上ある
- [ ] 中央クロップしても主要要素が切れない
- [ ] X/note/BOOTH/KindleそれぞれのプロフィールでテストUP→違和感ない
- [ ] PNGとして保存できる
- [ ] persona.md のキャラトーンと合っている（親しみやすい・疲れ気味）

---

## 関連リンク

- ペルソナ → [knowledge/persona.md](../../../knowledge/persona.md)
- プロジェクト概要 → [../README.md](../README.md)
