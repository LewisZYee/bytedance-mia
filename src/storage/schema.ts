export const schema = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS slack_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  user_id TEXT,
  username TEXT,
  text TEXT NOT NULL,
  ts TEXT NOT NULL,
  thread_ts TEXT,
  event_type TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, ts)
);

CREATE TABLE IF NOT EXISTS customer_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'slack',
  channel_id TEXT,
  thread_ts TEXT,
  message_ts TEXT,
  customer_name TEXT,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner TEXT,
  due_date TEXT,
  priority TEXT DEFAULT 'normal',
  source_link TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meeting_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'manual',
  customer_name TEXT,
  title TEXT NOT NULL,
  meeting_time TEXT,
  transcript TEXT,
  summary TEXT,
  action_items_json TEXT,
  source_link TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_slack_messages_channel_ts
ON slack_messages(channel_id, ts);

CREATE INDEX IF NOT EXISTS idx_customer_issues_status
ON customer_issues(status);

CREATE INDEX IF NOT EXISTS idx_customer_issues_channel
ON customer_issues(channel_id);
`;
