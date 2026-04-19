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

async function getPayoutByShopifyId(locationId, shopifyPayoutId) {
  return await get(
    `SELECT * FROM shopify_payouts WHERE location_id = ? AND shopify_payout_id = ?`,
    [locationId, String(shopifyPayoutId)]
  );
}

async function createPayout({
  locationId, shopifyPayoutId, status, payoutDate,
  currency, amount, chargesGross, chargesFee, refundsGross
}) {
  await run(`
    INSERT INTO shopify_payouts (
      location_id, shopify_payout_id, status, payout_date,
      currency, amount, charges_gross, charges_fee, refunds_gross, accounting_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `, [locationId, String(shopifyPayoutId), status, payoutDate,
      currency, amount, chargesGross, chargesFee, refundsGross]);
}

async function markAccountingDone(locationId, shopifyPayoutId) {
  await run(`
    UPDATE shopify_payouts
    SET accounting_status = 'done', updated_at = CURRENT_TIMESTAMP
    WHERE location_id = ? AND shopify_payout_id = ?
  `, [locationId, String(shopifyPayoutId)]);
}

async function markAccountingFailed(locationId, shopifyPayoutId, errorText) {
  await run(`
    UPDATE shopify_payouts
    SET accounting_status = 'failed', last_error_text = ?, updated_at = CURRENT_TIMESTAMP
    WHERE location_id = ? AND shopify_payout_id = ?
  `, [errorText, locationId, String(shopifyPayoutId)]);
}

async function getPendingPayouts(locationId) {
  return await all(`
    SELECT * FROM shopify_payouts
    WHERE location_id = ? AND accounting_status = 'pending' AND status = 'paid'
    ORDER BY payout_date ASC
  `, [locationId]);
}

module.exports = {
  getPayoutByShopifyId, createPayout,
  markAccountingDone, markAccountingFailed, getPendingPayouts
};