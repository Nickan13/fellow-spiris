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
      CREATE TABLE IF NOT EXISTS spiris_article_label_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        spiris_label_id TEXT NOT NULL,
        spiris_label_name TEXT,
        fellow_collection_id TEXT NOT NULL,
        fellow_collection_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(location_id, spiris_label_id)
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_spiris_article_label_collections_location
        ON spiris_article_label_collections(location_id)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_spiris_customer_mappings_location
        ON spiris_customer_mappings(location_id)
    `);

        db.run(`
      CREATE TABLE IF NOT EXISTS product_import_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        import_all INTEGER NOT NULL DEFAULT 0,
        requested_limit INTEGER,
        article_fetch_limit INTEGER,
        result_json TEXT,
        last_error_text TEXT,
        locked_at TEXT,
        processed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_product_import_jobs_location
        ON product_import_jobs(location_id)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_product_import_jobs_status
        ON product_import_jobs(status)
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS shopify_order_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL,
      shopify_order_id TEXT NOT NULL,
      event_type TEXT,
      payload_json TEXT,
      status TEXT DEFAULT 'pending',
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 5,
      next_retry_at TEXT,
      last_error_text TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS shopify_order_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL,
    shopify_order_id TEXT NOT NULL,
    shopify_order_gid TEXT,
    shopify_order_name TEXT,
    shopify_order_number TEXT,
    shopify_shop_domain TEXT,
    spiris_invoice_id TEXT,
    spiris_invoice_number TEXT,
    spiris_customer_id TEXT,
    currency TEXT,
    order_total REAL,
    financial_status TEXT,
    fulfillment_status TEXT,
    payload_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

    db.run(`
      CREATE TABLE IF NOT EXISTS shopify_order_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        shopify_order_id TEXT NOT NULL,
        shopify_transaction_id TEXT NOT NULL,
        shopify_parent_id TEXT,
        shopify_order_name TEXT,
        kind TEXT,
        status TEXT,
        gateway TEXT,
        payment_date TEXT,
        currency TEXT,
        amount REAL,
        raw_payload_json TEXT,
        spiris_invoice_id TEXT,
        spiris_customer_id TEXT,
        payout_booking_status TEXT NOT NULL DEFAULT 'pending',
        payout_booking_error_text TEXT,
        bank_voucher_number TEXT,
        bank_voucher_year TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(location_id, shopify_transaction_id)
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_shopify_order_transactions_location
        ON shopify_order_transactions(location_id)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_shopify_order_transactions_order
        ON shopify_order_transactions(location_id, shopify_order_id)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_shopify_order_transactions_booking_status
        ON shopify_order_transactions(location_id, payout_booking_status)
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS shopify_payouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        shopify_payout_id TEXT NOT NULL,
        status TEXT,
        payout_date TEXT,
        currency TEXT,
        amount REAL,
        charges_gross REAL,
        charges_fee REAL,
        refunds_gross REAL,
        accounting_status TEXT DEFAULT 'pending',
        last_error_text TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(location_id, shopify_payout_id)
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_shopify_payouts_location
        ON shopify_payouts(location_id)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_shopify_payouts_status
        ON shopify_payouts(accounting_status)
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS shopify_refund_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        shopify_order_id TEXT NOT NULL,
        shopify_refund_id TEXT NOT NULL,
        spiris_credit_invoice_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(location_id, shopify_refund_id)
      )
    `);

    console.log("Database migrations completed");

  });
}

module.exports = { runMigrations };