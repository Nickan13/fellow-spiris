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

async function getByLocationAndFellowInvoiceId(locationId, fellowInvoiceId) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        fellow_invoice_id,
        spiris_invoice_id,
        spiris_customer_id,
        source_event_type,
        request_json,
        response_json,
        created_at,
        updated_at
      FROM spiris_invoice_mappings
      WHERE location_id = ?
        AND fellow_invoice_id = ?
      LIMIT 1
    `,
    [locationId, fellowInvoiceId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    fellowInvoiceId: row.fellow_invoice_id,
    spirisInvoiceId: row.spiris_invoice_id,
    spirisCustomerId: row.spiris_customer_id,
    sourceEventType: row.source_event_type,
    request: JSON.parse(row.request_json),
    response: JSON.parse(row.response_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createMapping({
  locationId,
  fellowInvoiceId,
  spirisInvoiceId,
  spirisCustomerId,
  sourceEventType,
  request,
  response
}) {
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO spiris_invoice_mappings (
        location_id,
        fellow_invoice_id,
        spiris_invoice_id,
        spiris_customer_id,
        source_event_type,
        request_json,
        response_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      locationId,
      fellowInvoiceId,
      spirisInvoiceId,
      spirisCustomerId || null,
      sourceEventType || null,
      JSON.stringify(request),
      JSON.stringify(response),
      now,
      now
    ]
  );
}

async function countByLocationId(locationId) {
  const row = await get(
    `
    SELECT COUNT(*) AS count
    FROM spiris_invoice_mappings
    WHERE location_id = ?
    `,
    [locationId]
  );

  return row ? row.count : 0;
}

module.exports = {
  getByLocationAndFellowInvoiceId,
  createMapping,
  countByLocationId
};