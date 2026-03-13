const db = require("../db/database");

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

async function getByLocationAndEstimateId(locationId, estimateId) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        estimate_id,
        spiris_draft_id,
        spiris_customer_id,
        request_json,
        response_json,
        created_at,
        updated_at
      FROM spiris_draft_mappings
      WHERE location_id = ?
        AND estimate_id = ?
      LIMIT 1
    `,
    [locationId, estimateId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    estimateId: row.estimate_id,
    spirisDraftId: row.spiris_draft_id,
    spirisCustomerId: row.spiris_customer_id,
    request: JSON.parse(row.request_json),
    response: JSON.parse(row.response_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createMapping({
  locationId,
  estimateId,
  spirisDraftId,
  spirisCustomerId,
  request,
  response
}) {
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO spiris_draft_mappings (
        location_id,
        estimate_id,
        spiris_draft_id,
        spiris_customer_id,
        request_json,
        response_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      locationId,
      estimateId,
      spirisDraftId,
      spirisCustomerId || null,
      JSON.stringify(request),
      JSON.stringify(response),
      now,
      now
    ]
  );
}

module.exports = {
  getByLocationAndEstimateId,
  createMapping
};