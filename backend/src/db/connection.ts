import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

// Ensure data directory exists
const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.database.path);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

export function initializeDatabase(): void {
  // Providers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      address TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      max_diem_capacity INTEGER NOT NULL DEFAULT 100000,
      rate_per_diem INTEGER NOT NULL DEFAULT 1000,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Credits table
  db.exec(`
    CREATE TABLE IF NOT EXISTS credits (
      id TEXT PRIMARY KEY,
      credit_id INTEGER UNIQUE,
      provider_id TEXT NOT NULL,
      buyer_address TEXT NOT NULL,
      total_diem_amount INTEGER NOT NULL,
      actual_usage INTEGER,
      duration_days INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      api_key TEXT,
      api_key_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      confirmed_at TEXT,
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    )
  `);

  // Usage reports table
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_reports (
      id TEXT PRIMARY KEY,
      credit_id TEXT NOT NULL,
      reporter TEXT NOT NULL CHECK (reporter IN ('provider', 'buyer')),
      usage_amount INTEGER NOT NULL,
      reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (credit_id) REFERENCES credits(id)
    )
  `);

  // API keys table (for tracking Venice keys)
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      credit_id TEXT NOT NULL,
      venice_key_id TEXT,
      key_hash TEXT NOT NULL,
      spend_limit INTEGER,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      FOREIGN KEY (credit_id) REFERENCES credits(id)
    )
  `);

  // Webhook deliveries table
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      event TEXT NOT NULL,
      success INTEGER NOT NULL,
      response TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_credits_provider ON credits(provider_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_credits_buyer ON credits(buyer_address)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status)`);
}
