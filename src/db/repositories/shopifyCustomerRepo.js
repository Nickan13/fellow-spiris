const db = require("../index");

// Hämta mapping via Shopify customer ID
async function getByShopifyCustomerId(locationId, shopifyCustomerId) {
  const sql = `
    SELECT *
    FROM shopify_customer_mappings
    WHERE location_id = ? AND shopify_customer_id = ?
    LIMIT 1
  `;

  return await db.get(sql, [locationId, shopifyCustomerId]);
}

// Hämta mapping via e-post (fallback)
async function getByEmail(locationId, email) {
  const sql = `
    SELECT *
    FROM shopify_customer_mappings
    WHERE location_id = ? AND email = ?
    LIMIT 1
  `;

  return await db.get(sql, [locationId, email]);
}

// Skapa mapping
async function createMapping({
  locationId,
  shopifyCustomerId,
  email,
  spirisCustomerId
}) {
  const sql = `
    INSERT OR IGNORE INTO shopify_customer_mappings (
      location_id,
      shopify_customer_id,
      email,
      spiris_customer_id
    )
    VALUES (?, ?, ?, ?)
  `;

  await db.run(sql, [
    locationId,
    shopifyCustomerId,
    email,
    spirisCustomerId
  ]);
}

// Uppdatera e-post om den ändrats
async function updateEmail(locationId, shopifyCustomerId, email) {
  const sql = `
    UPDATE shopify_customer_mappings
    SET
      email = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE location_id = ? AND shopify_customer_id = ?
  `;

  await db.run(sql, [email, locationId, shopifyCustomerId]);
}

module.exports = {
  getByShopifyCustomerId,
  getByEmail,
  createMapping,
  updateEmail
};
