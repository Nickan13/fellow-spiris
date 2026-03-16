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

async function upsertMapping({
  locationId,
  fellowProductId,
  spirisArticleNumber
}) {
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO fellow_product_mappings (
        location_id,
        fellow_product_id,
        spiris_article_number,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(location_id, fellow_product_id)
      DO UPDATE SET
        spiris_article_number = excluded.spiris_article_number,
        updated_at = excluded.updated_at
    `,
    [
      locationId,
      fellowProductId,
      spirisArticleNumber,
      now,
      now
    ]
  );
}

async function getMappingByProductId(locationId, fellowProductId) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        fellow_product_id,
        spiris_article_number,
        created_at,
        updated_at
      FROM fellow_product_mappings
      WHERE location_id = ?
        AND fellow_product_id = ?
      LIMIT 1
    `,
    [locationId, fellowProductId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    fellowProductId: row.fellow_product_id,
    spirisArticleNumber: row.spiris_article_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getMappingBySpirisArticleNumber(locationId, spirisArticleNumber) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        fellow_product_id,
        spiris_article_number,
        created_at,
        updated_at
      FROM fellow_product_mappings
      WHERE location_id = ?
        AND spiris_article_number = ?
      LIMIT 1
    `,
    [locationId, spirisArticleNumber]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    fellowProductId: row.fellow_product_id,
    spirisArticleNumber: row.spiris_article_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function deleteMappingBySpirisArticleNumber(locationId, spirisArticleNumber) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!spirisArticleNumber) {
    throw new Error("spirisArticleNumber is required");
  }

  await run(
    `
      DELETE FROM fellow_product_mappings
      WHERE location_id = ?
        AND spiris_article_number = ?
    `,
    [locationId, spirisArticleNumber]
  );

  return {
    locationId,
    spirisArticleNumber
  };
}

async function listMappingsByLocation(locationId) {
  const rows = await all(
    `
      SELECT
        id,
        location_id,
        fellow_product_id,
        spiris_article_number,
        created_at,
        updated_at
      FROM fellow_product_mappings
      WHERE location_id = ?
      ORDER BY id DESC
    `,
    [locationId]
  );

  return rows.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    fellowProductId: row.fellow_product_id,
    spirisArticleNumber: row.spiris_article_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function countByLocationId(locationId) {
  const row = await get(
    `
    SELECT COUNT(*) AS count
    FROM fellow_product_mappings
    WHERE location_id = ?
    `,
    [locationId]
  );

  return row ? row.count : 0;
}

module.exports = {
  upsertMapping,
  getMappingByProductId,
  getMappingBySpirisArticleNumber,
  deleteMappingBySpirisArticleNumber,
  listMappingsByLocation,
  countByLocationId
};