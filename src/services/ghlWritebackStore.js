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

async function createWritebackLog({
  locationId,
  opportunityId,
  estimateId,
  spirisDraftId,
  status,
  request,
  response,
  errorText
}) {
  await run(
    `
      INSERT INTO ghl_writeback_logs (
        location_id,
        opportunity_id,
        estimate_id,
        spiris_draft_id,
        status,
        request_json,
        response_json,
        error_text
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      locationId,
      opportunityId,
      estimateId,
      spirisDraftId,
      status,
      JSON.stringify(request),
      response ? JSON.stringify(response) : null,
      errorText || null
    ]
  );
}

async function getSuccessfulWriteback({
  locationId,
  opportunityId,
  estimateId,
  spirisDraftId
}) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        opportunity_id,
        estimate_id,
        spiris_draft_id,
        status,
        request_json,
        response_json,
        error_text,
        created_at
      FROM ghl_writeback_logs
      WHERE location_id = ?
        AND opportunity_id = ?
        AND estimate_id = ?
        AND spiris_draft_id = ?
        AND status = 'success'
      ORDER BY id DESC
      LIMIT 1
    `,
    [locationId, opportunityId, estimateId, spirisDraftId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    opportunityId: row.opportunity_id,
    estimateId: row.estimate_id,
    spirisDraftId: row.spiris_draft_id,
    status: row.status,
    request: JSON.parse(row.request_json),
    response: row.response_json ? JSON.parse(row.response_json) : null,
    errorText: row.error_text,
    createdAt: row.created_at
  };
}

module.exports = {
  createWritebackLog,
  getSuccessfulWriteback
};