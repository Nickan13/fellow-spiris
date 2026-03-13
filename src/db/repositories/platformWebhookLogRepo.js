const db = require("../database");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      location_id TEXT,
      invoice_id TEXT,
      payload_json TEXT NOT NULL,
      headers_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_platform_webhook_logs_event
    ON platform_webhook_logs(event_type)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_platform_webhook_logs_location
    ON platform_webhook_logs(location_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_platform_webhook_logs_invoice
    ON platform_webhook_logs(invoice_id)
  `);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function createLog({
  eventType,
  locationId,
  invoiceId,
  payload,
  headers
}) {
  await run(
    `
      INSERT INTO platform_webhook_logs (
        event_type,
        location_id,
        invoice_id,
        payload_json,
        headers_json
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      eventType || null,
      locationId || null,
      invoiceId || null,
      JSON.stringify(payload || {}),
      JSON.stringify(headers || {})
    ]
  );
}

module.exports = {
  createLog
};