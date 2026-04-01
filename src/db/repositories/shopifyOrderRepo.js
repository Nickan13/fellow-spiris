const db = require("../index");

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

  await db.run(sql, [
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

  return await db.get(sql, [locationId, shopifyOrderId]);
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

  await db.run(sql, [
    spirisInvoiceId,
    spirisInvoiceNumber,
    locationId,
    shopifyOrderId
  ]);
}

module.exports = {
  createOrderMapping,
  getOrderMapping,
  setSpirisInvoice
};
