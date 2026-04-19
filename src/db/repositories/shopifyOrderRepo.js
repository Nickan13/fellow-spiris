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

// Skapa mapping (eller ignorera om redan finns)
async function createOrderMapping({
  locationId,
  shopifyOrderId,
  shopifyOrderGid,
  shopifyOrderName,
  shopifyOrderNumber,
  shopifyShopDomain,
  currency,
  orderTotal,
  financialStatus,
  fulfillmentStatus,
  payloadJson
}) {
  const sql = `
    INSERT OR IGNORE INTO shopify_order_mappings (
      location_id,
      shopify_order_id,
      shopify_order_gid,
      shopify_order_name,
      shopify_order_number,
      shopify_shop_domain,
      currency,
      order_total,
      financial_status,
      fulfillment_status,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await run(sql, [
    locationId,
    shopifyOrderId,
    shopifyOrderGid,
    shopifyOrderName,
    shopifyOrderNumber,
    shopifyShopDomain,
    currency,
    orderTotal,
    financialStatus,
    fulfillmentStatus,
    payloadJson
  ]);
}

// Hämta mapping
async function getOrderMapping(locationId, shopifyOrderId) {
  const sql = `
    SELECT *
    FROM shopify_order_mappings
    WHERE location_id = ? AND shopify_order_id = ?
    LIMIT 1
  `;

  return await get(sql, [locationId, shopifyOrderId]);
}

// Uppdatera med Spiris-faktura
async function setSpirisInvoice({
  locationId,
  shopifyOrderId,
  spirisInvoiceId,
  spirisInvoiceNumber
}) {
  const sql = `
    UPDATE shopify_order_mappings
    SET
      spiris_invoice_id = ?,
      spiris_invoice_number = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE location_id = ? AND shopify_order_id = ?
  `;

  await run(sql, [
    spirisInvoiceId,
    spirisInvoiceNumber,
    locationId,
    shopifyOrderId
  ]);
}

async function setSpirisData(locationId, shopifyOrderId, spirisInvoiceId, spirisCustomerId) {
  await run(
    `
      UPDATE shopify_order_mappings
      SET spiris_invoice_id = ?, spiris_customer_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE location_id = ?
        AND shopify_order_id = ?
    `,
    [spirisInvoiceId, spirisCustomerId, locationId, shopifyOrderId]
  );
}

async function getRecentOrderMappings(limit = 20) {
  const sql = `
    SELECT *
    FROM shopify_order_mappings
    ORDER BY id DESC
    LIMIT ?
  `;

  return await all(sql, [limit]);
}

module.exports = {
  createOrderMapping,
  getOrderMapping,
  setSpirisData,
  setSpirisInvoice,
  getRecentOrderMappings
};