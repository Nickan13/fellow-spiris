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
  spirisLabelId,
  spirisLabelName,
  fellowCollectionId,
  fellowCollectionName
}) {
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO spiris_article_label_collections (
        location_id,
        spiris_label_id,
        spiris_label_name,
        fellow_collection_id,
        fellow_collection_name,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(location_id, spiris_label_id)
      DO UPDATE SET
        spiris_label_name = excluded.spiris_label_name,
        fellow_collection_id = excluded.fellow_collection_id,
        fellow_collection_name = excluded.fellow_collection_name,
        updated_at = excluded.updated_at
    `,
    [
      locationId,
      spirisLabelId,
      spirisLabelName || null,
      fellowCollectionId,
      fellowCollectionName || null,
      now,
      now
    ]
  );
}

async function getMappingBySpirisLabelId(locationId, spirisLabelId) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        spiris_label_id,
        spiris_label_name,
        fellow_collection_id,
        fellow_collection_name,
        created_at,
        updated_at
      FROM spiris_article_label_collections
      WHERE location_id = ?
        AND spiris_label_id = ?
      LIMIT 1
    `,
    [locationId, spirisLabelId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    spirisLabelId: row.spiris_label_id,
    spirisLabelName: row.spiris_label_name,
    fellowCollectionId: row.fellow_collection_id,
    fellowCollectionName: row.fellow_collection_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listMappingsByLocation(locationId) {
  const rows = await all(
    `
      SELECT
        id,
        location_id,
        spiris_label_id,
        spiris_label_name,
        fellow_collection_id,
        fellow_collection_name,
        created_at,
        updated_at
      FROM spiris_article_label_collections
      WHERE location_id = ?
      ORDER BY id DESC
    `,
    [locationId]
  );

  return rows.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    spirisLabelId: row.spiris_label_id,
    spirisLabelName: row.spiris_label_name,
    fellowCollectionId: row.fellow_collection_id,
    fellowCollectionName: row.fellow_collection_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

module.exports = {
  upsertMapping,
  getMappingBySpirisLabelId,
  listMappingsByLocation
};