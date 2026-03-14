const sqlite3 = require("sqlite3").verbose();
const env = require("../config/env");
const path = require("path");
const fs = require("fs");

const dbPath = path.resolve(env.sqlitePath);

// säkerställ att mappen finns
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("SQLite connection error:", err.message);
  } else {
    console.log("Connected to SQLite database:", dbPath);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS spiris_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      spiris_article_id TEXT NOT NULL,
      article_number TEXT NOT NULL,
      name TEXT,
      unit_price REAL,
      raw_json TEXT NOT NULL,
      changed_utc TEXT,
      last_synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(location_id, article_number),
      UNIQUE(location_id, spiris_article_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_spiris_articles_location_number
    ON spiris_articles(location_id, article_number)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_spiris_articles_location_spiris_id
    ON spiris_articles(location_id, spiris_article_id)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS spiris_draft_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      estimate_id TEXT NOT NULL,
      spiris_draft_id TEXT NOT NULL,
      spiris_customer_id TEXT,
      request_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(location_id, estimate_id),
      UNIQUE(location_id, spiris_draft_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_spiris_draft_mappings_location_estimate
    ON spiris_draft_mappings(location_id, estimate_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_spiris_draft_mappings_location_draft
    ON spiris_draft_mappings(location_id, spiris_draft_id)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ghl_writeback_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      estimate_id TEXT NOT NULL,
      spiris_draft_id TEXT NOT NULL,
      status TEXT NOT NULL,
      request_json TEXT NOT NULL,
      response_json TEXT,
      error_text TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_ghl_writeback_logs_location_estimate
    ON ghl_writeback_logs(location_id, estimate_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_ghl_writeback_logs_location_opportunity
    ON ghl_writeback_logs(location_id, opportunity_id)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS fellow_product_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      fellow_product_id TEXT NOT NULL,
      spiris_article_number TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(location_id, fellow_product_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_fellow_product_mappings_location_product
    ON fellow_product_mappings(location_id, fellow_product_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_fellow_product_mappings_location_article
    ON fellow_product_mappings(location_id, spiris_article_number)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS spiris_invoice_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      fellow_invoice_id TEXT NOT NULL,
      spiris_invoice_id TEXT NOT NULL,
      spiris_customer_id TEXT,
      source_event_type TEXT,
      request_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(location_id, fellow_invoice_id),
      UNIQUE(location_id, spiris_invoice_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_spiris_invoice_mappings_location_invoice
    ON spiris_invoice_mappings(location_id, fellow_invoice_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_spiris_invoice_mappings_location_spiris_invoice
    ON spiris_invoice_mappings(location_id, spiris_invoice_id)
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS integration_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      spiris_invoice_mode TEXT NOT NULL DEFAULT 'booked',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(location_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_integration_settings_location
    ON integration_settings(location_id)
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS invoice_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      fellow_invoice_id TEXT NOT NULL,
      source_event_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_retry_at TEXT,
      last_error_text TEXT,
      locked_at TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(location_id, fellow_invoice_id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_invoice_jobs_status_next_retry
    ON invoice_jobs(status, next_retry_at)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_invoice_jobs_location_invoice
    ON invoice_jobs(location_id, fellow_invoice_id)
  `);

});

module.exports = db;