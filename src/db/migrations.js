const db = require("./database");

function runMigrations() {
  db.serialize(() => {

    db.run(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL UNIQUE,
        name TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS spiris_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL UNIQUE,
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT NOT NULL,
        token_expires_at TEXT,
        spiris_company_id TEXT,
        scopes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS customer_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        customer_type TEXT,
        contact_id TEXT,
        business_id TEXT,
        spiris_customer_id TEXT NOT NULL,
        match_basis TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS invoice_sync (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        opportunity_id TEXT,
        estimate_id TEXT,
        contact_id TEXT,
        business_id TEXT,
        fellow_invoice_id TEXT,
        fellow_invoice_number TEXT,
        spiris_invoice_id TEXT,
        spiris_invoice_number TEXT,
        invoice_amount_minor INTEGER,
        currency TEXT,
        document_status TEXT,
        accounting_status TEXT,
        delivery_status TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS billing_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        estimate_id TEXT NOT NULL,
        estimate_total_minor INTEGER NOT NULL,
        invoiced_total_minor INTEGER NOT NULL DEFAULT 0,
        remaining_total_minor INTEGER NOT NULL,
        billing_status TEXT NOT NULL DEFAULT 'not_invoiced',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(location_id, estimate_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        response_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS article_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        ghl_product_id TEXT,
        ghl_product_name TEXT,
        article_number TEXT NOT NULL,
        spiris_article_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(location_id, article_number)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS spiris_customer_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        spiris_customer_id TEXT NOT NULL,
        fellow_contact_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(location_id, spiris_customer_id)
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_spiris_customer_mappings_location
        ON spiris_customer_mappings(location_id)
    `);

    console.log("Database migrations completed");

  });
}

module.exports = { runMigrations };