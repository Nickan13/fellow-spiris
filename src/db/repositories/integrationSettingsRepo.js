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

async function getByLocationId(locationId) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        spiris_invoice_mode,
        created_at,
        updated_at
      FROM integration_settings
      WHERE location_id = ?
      LIMIT 1
    `,
    [locationId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    spirisInvoiceMode: row.spiris_invoice_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getInvoiceModeByLocationId(locationId) {
  const settings = await getByLocationId(locationId);

  if (!settings || !settings.spirisInvoiceMode) {
    return "booked";
  }

  return settings.spirisInvoiceMode;
}

async function upsertInvoiceMode(locationId, spirisInvoiceMode) {
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO integration_settings (
        location_id,
        spiris_invoice_mode,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(location_id)
      DO UPDATE SET
        spiris_invoice_mode = excluded.spiris_invoice_mode,
        updated_at = excluded.updated_at
    `,
    [locationId, spirisInvoiceMode, now, now]
  );

  return getByLocationId(locationId);
}

module.exports = {
  getByLocationId,
  getInvoiceModeByLocationId,
  upsertInvoiceMode
};