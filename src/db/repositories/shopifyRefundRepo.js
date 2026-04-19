const db = require("../database");

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function getRefundMapping(locationId, shopifyRefundId) {
  return await get(
    `SELECT * FROM shopify_refund_mappings WHERE location_id = ? AND shopify_refund_id = ? LIMIT 1`,
    [locationId, shopifyRefundId]
  );
}

async function createRefundMapping({ locationId, shopifyOrderId, shopifyRefundId, spirisCreditInvoiceId }) {
  await run(
    `INSERT OR IGNORE INTO shopify_refund_mappings (location_id, shopify_order_id, shopify_refund_id, spiris_credit_invoice_id)
     VALUES (?, ?, ?, ?)`,
    [locationId, shopifyOrderId, shopifyRefundId, spirisCreditInvoiceId || null]
  );
}

module.exports = {
  getRefundMapping,
  createRefundMapping
};