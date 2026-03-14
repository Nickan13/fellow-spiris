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

async function getBySpirisCustomerId(locationId, spirisCustomerId) {
  const row = await get(
    `
    SELECT *
    FROM spiris_customer_mappings
    WHERE location_id = ?
    AND spiris_customer_id = ?
    LIMIT 1
    `,
    [locationId, spirisCustomerId]
  );

  return row
    ? {
        id: row.id,
        locationId: row.location_id,
        spirisCustomerId: row.spiris_customer_id,
        fellowContactId: row.fellow_contact_id
      }
    : null;
}

async function createMapping({
  locationId,
  spirisCustomerId,
  fellowContactId
}) {
  await run(
    `
    INSERT INTO spiris_customer_mappings (
      location_id,
      spiris_customer_id,
      fellow_contact_id
    )
    VALUES (?, ?, ?)
    `,
    [locationId, spirisCustomerId, fellowContactId]
  );
}

//funktion för att delete'a kontakter när jag testat importen
async function deleteByLocationId(locationId) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const result = await run(
    `
    DELETE FROM spiris_customer_mappings
    WHERE location_id = ?
    `,
    [locationId]
  );

  return {
    locationId,
    deletedRows: result.changes || 0
  };
}

async function countByLocationId(locationId) {
  const row = await get(
    `
    SELECT COUNT(*) AS count
    FROM spiris_customer_mappings
    WHERE location_id = ?
    `,
    [locationId]
  );

  return row ? row.count : 0;
}

module.exports = {
  getBySpirisCustomerId,
  createMapping,
  countByLocationId,
  deleteByLocationId
};