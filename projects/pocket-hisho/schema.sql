-- ポケット秘書 — データベースの形（Cloudflare D1 / SQLite）
-- 作り直すとき： npm run db:init        （本番）
--                npm run db:init:local  （手元の確認用）
-- 何度実行しても壊れないように、すべて IF NOT EXISTS で書いてある。

-- 小さな設定の保管庫（通知の鍵・購読用URLの合言葉・設定・取り込みの記録）
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- 予定（セミナー1件＝1行）
-- 中身（会場・連絡先・持ち物・お金…）は data に JSON でまとめて入れる。
-- あとから項目を足しても、テーブルを作り直さずに済むため。
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,          -- 'YYYY-MM-DD'（日本時間）。絞り込みに使うので列に出す
  data        TEXT NOT NULL,          -- JSON
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events (date) WHERE deleted = 0;

-- タスク（やること）
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  due         TEXT,                   -- 'YYYY-MM-DD'（期限なしは NULL）
  done        INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL,          -- JSON
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks (due) WHERE deleted = 0;

-- 通知のあて先（スマホ1台＝1行。パソコンからも登録できる）
CREATE TABLE IF NOT EXISTS subs (
  id          TEXT PRIMARY KEY,       -- あて先を short にしたもの（同じ端末を二重登録しない）
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,          -- その端末の公開鍵
  auth        TEXT NOT NULL,          -- その端末の合言葉
  label       TEXT,
  created_at  INTEGER NOT NULL,
  last_ok     INTEGER
);

-- 「もう送った通知」の記録。同じ通知を二度出さないための印。
CREATE TABLE IF NOT EXISTS sent (
  key      TEXT PRIMARY KEY,
  sent_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sent_at ON sent (sent_at);

-- 外部カレンダー（Googleカレンダーなど）から取り込んだ予定。読み取り専用。
CREATE TABLE IF NOT EXISTS ext_events (
  uid         TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  title       TEXT,
  location    TEXT,
  all_day     INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ext_date ON ext_events (date);
CREATE INDEX IF NOT EXISTS idx_ext_source ON ext_events (source);

-- ログインした端末の札
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);
