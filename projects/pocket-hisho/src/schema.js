/* =====================================================================
   データベースの表の形（Cloudflare D1 / SQLite）

   サーバーが起動したとき、表が無ければ自動で作る。
   → セットアップで「SQLを貼って実行する」手順が要らない。

   すべて IF NOT EXISTS なので、何度実行しても壊れない。
   表の形を変えたいときは、ここだけを直すこと（ほかに同じ定義を置かない）。
   ===================================================================== */

export const SCHEMA = [
  // 小さな設定の保管庫（通知の鍵・購読用URLの合言葉・合言葉のハッシュ・設定など）
  `CREATE TABLE IF NOT EXISTS kv (
     k TEXT PRIMARY KEY,
     v TEXT NOT NULL
   )`,

  // 予定（セミナー1件＝1行）。中身は data に JSON でまとめて入れる
  `CREATE TABLE IF NOT EXISTS events (
     id          TEXT PRIMARY KEY,
     date        TEXT NOT NULL,
     data        TEXT NOT NULL,
     updated_at  INTEGER NOT NULL,
     deleted     INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_events_date ON events (date) WHERE deleted = 0`,

  // やること
  `CREATE TABLE IF NOT EXISTS tasks (
     id          TEXT PRIMARY KEY,
     due         TEXT,
     done        INTEGER NOT NULL DEFAULT 0,
     data        TEXT NOT NULL,
     updated_at  INTEGER NOT NULL,
     deleted     INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks (due) WHERE deleted = 0`,

  // 通知のあて先（スマホ1台＝1行）
  `CREATE TABLE IF NOT EXISTS subs (
     id          TEXT PRIMARY KEY,
     endpoint    TEXT NOT NULL,
     p256dh      TEXT NOT NULL,
     auth        TEXT NOT NULL,
     label       TEXT,
     created_at  INTEGER NOT NULL,
     last_ok     INTEGER
   )`,

  // もう送った通知の印（同じ通知を二度出さない）
  `CREATE TABLE IF NOT EXISTS sent (
     key      TEXT PRIMARY KEY,
     sent_at  INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sent_at ON sent (sent_at)`,

  // 外部カレンダーから取り込んだ予定（読み取り専用）
  `CREATE TABLE IF NOT EXISTS ext_events (
     uid         TEXT PRIMARY KEY,
     date        TEXT NOT NULL,
     start_time  TEXT,
     end_time    TEXT,
     title       TEXT,
     location    TEXT,
     all_day     INTEGER NOT NULL DEFAULT 0,
     source      TEXT NOT NULL,
     fetched_at  INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ext_date ON ext_events (date)`,
  `CREATE INDEX IF NOT EXISTS idx_ext_source ON ext_events (source)`,

  // ログインした端末の札。via は「どうやって入ったか」（setup / pass / invite / handoff）
  `CREATE TABLE IF NOT EXISTS sessions (
     token       TEXT PRIMARY KEY,
     created_at  INTEGER NOT NULL,
     last_seen   INTEGER,
     via         TEXT
   )`,

  // 合言葉なしで入るための札（招待リンク・ホーム画面への引き継ぎ番号）
  `CREATE TABLE IF NOT EXISTS codes (
     code        TEXT PRIMARY KEY,
     kind        TEXT NOT NULL,
     expires_at  INTEGER NOT NULL,
     uses_left   INTEGER NOT NULL,
     created_at  INTEGER NOT NULL
   )`
];

/* 以前の版で作られた表に、あとから足した列を加える（すでにあれば何もしない） */
export const UPGRADES = [
  { table: 'sessions', column: 'via', sql: `ALTER TABLE sessions ADD COLUMN via TEXT` }
];

let ready = false;   // 同じ入れ物（isolate）の中では1回だけ行う

/** 表が無ければ作る。リクエストのたびに呼んでよい（2回目からは何もしない） */
export async function ensureSchema(db) {
  if (ready) return;
  await db.batch(SCHEMA.map(sql => db.prepare(sql)));
  for (const u of UPGRADES) {
    const { results } = await db.prepare(`PRAGMA table_info(${u.table})`).all();
    if (!(results || []).some(r => r.name === u.column)) await db.prepare(u.sql).run();
  }
  ready = true;
}
