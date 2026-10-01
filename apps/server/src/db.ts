import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config, ensureDataDir } from "./config.js";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  input_cost REAL NOT NULL DEFAULT 0,
  output_cost REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS aliases (
  alias TEXT PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  upstream_model TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_health (
  provider_id INTEGER PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown',
  cooldown_until INTEGER,
  last_error TEXT,
  last_checked_at INTEGER,
  requests INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  probe_pending INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  history_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, position);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT,
  model TEXT NOT NULL,
  provider_id INTEGER,
  provider_name TEXT,
  status INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  streaming INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost REAL NOT NULL DEFAULT 0,
  error TEXT,
  failover TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const DEFAULT_SETTINGS: Record<string, string> = {
  routing_strategy: "round_robin", // round_robin | priority | least_used
  retry_count: "2", // extra attempts across the provider chain
  timeout_ms: "120000",
  cooldown_429_ms: "30000",
  cooldown_5xx_ms: "10000",
  cooldown_timeout_ms: "15000",
  cooldown_auth_ms: "60000",
  rate_limit_rpm: "0", // 0 = off
  health_check_interval_ms: "60000", // background provider pings, 0 = off
  default_model: "",
};

export function openDb(dbPath = config.dbPath): Db {
  if (dbPath !== ":memory:") {
    ensureDataDir();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // migrate pre-existing databases: add columns introduced after first release
  const healthCols = db.pragma("table_info(provider_health)") as { name: string }[];
  if (!healthCols.some((c) => c.name === "probe_pending")) {
    db.exec("ALTER TABLE provider_health ADD COLUMN probe_pending INTEGER NOT NULL DEFAULT 0");
  }

  const insertSetting = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

  return db;
}

export function getSetting(db: Db, key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key] ?? "";
}

export function getSettings(db: Db): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSettings(db: Db, values: Record<string, string | number | undefined>): void {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) stmt.run(k, String(v));
  });
  tx(
    Object.entries(values).filter(([, v]) => v !== undefined) as [string, string][]
  );
}

export function getNumericSetting(db: Db, key: string): number {
  const raw = getSetting(db, key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[key] ?? 0);
}
