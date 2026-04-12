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

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function createOrIgnoreTransaction({
  locationId,
  shopifyOrderId,
  shopifyTransactionId,
  shopifyParentId,
  shopifyOrderName,
  kind,
  status,
  gateway,
  paymentDate,
  currency,
  amount,
  rawPayloadJson,
  spirisInvoiceId,
  spirisCustomerId
}) {
  const sql = `
    INSERT OR IGNORE INTO shopify_order_transactions (
      location_id,
      shopify_order_id,
      shopify_transaction_id,
      shopify_parent_id,
      shopify_order_name,
      kind,
      status,
      gateway,
      payment_date,
      currency,
      amount,
      raw_payload_json,
      spiris_invoice_id,
      spiris_customer_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await run(sql, [
    locationId,
    shopifyOrderId,
    shopifyTransactionId,
    shopifyParentId,
    shopifyOrderName,
    kind,
    status,
    gateway,
    paymentDate,
    currency,
    amount,
    rawPayloadJson,
    spirisInvoiceId,
    spirisCustomerId
  ]);
}

async function getByTransactionId(locationId, shopifyTransactionId) {
  const sql = `
    SELECT *
    FROM shopify_order_transactions
    WHERE location_id = ? AND shopify_transaction_id = ?
    LIMIT 1
  `;

  return await get(sql, [locationId, shopifyTransactionId]);
}

async function listRecentByLocationId(locationId, limit = 20) {
  const sql = `
    SELECT *
    FROM shopify_order_transactions
    WHERE location_id = ?
    ORDER BY id DESC
    LIMIT ?
  `;

  return await all(sql, [locationId, limit]);
}

async function markPayoutBooked({
  id,
  bankVoucherNumber,
  bankVoucherYear
}) {
  const sql = `
    UPDATE shopify_order_transactions
    SET
      payout_booking_status = 'booked',
      payout_booking_error_text = NULL,
      bank_voucher_number = ?,
      bank_voucher_year = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  await run(sql, [bankVoucherNumber, bankVoucherYear, id]);
}

async function markPayoutFailed(id, errorText) {
  const sql = `
    UPDATE shopify_order_transactions
    SET
      payout_booking_status = 'failed',
      payout_booking_error_text = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  await run(sql, [errorText, id]);
}

module.exports = {
  createOrIgnoreTransaction,
  getByTransactionId,
  listRecentByLocationId,
  markPayoutBooked,
  markPayoutFailed
};