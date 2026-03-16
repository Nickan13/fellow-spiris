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

function toIsoNow() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    status: row.status,
    importAll: Number(row.import_all) === 1,
    requestedLimit: row.requested_limit,
    articleFetchLimit: row.article_fetch_limit,
    result: parseJson(row.result_json, null),
    lastErrorText: row.last_error_text,
    lockedAt: row.locked_at,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createJob({
  locationId,
  importAll = false,
  requestedLimit = null,
  articleFetchLimit = null
}) {
  const now = toIsoNow();

  await run(
    `
      INSERT INTO product_import_jobs (
        location_id,
        status,
        import_all,
        requested_limit,
        article_fetch_limit,
        result_json,
        last_error_text,
        locked_at,
        processed_at,
        created_at,
        updated_at
      )
      VALUES (?, 'pending', ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
    `,
    [
      locationId,
      importAll ? 1 : 0,
      requestedLimit,
      articleFetchLimit,
      now,
      now
    ]
  );

  const row = await get(
    `
      SELECT
        id,
        location_id,
        status,
        import_all,
        requested_limit,
        article_fetch_limit,
        result_json,
        last_error_text,
        locked_at,
        processed_at,
        created_at,
        updated_at
      FROM product_import_jobs
      WHERE id = last_insert_rowid()
    `
  );

  return mapRow(row);
}

async function getById(id) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        status,
        import_all,
        requested_limit,
        article_fetch_limit,
        result_json,
        last_error_text,
        locked_at,
        processed_at,
        created_at,
        updated_at
      FROM product_import_jobs
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );

  return mapRow(row);
}

async function getLatestByLocationId(locationId) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        status,
        import_all,
        requested_limit,
        article_fetch_limit,
        result_json,
        last_error_text,
        locked_at,
        processed_at,
        created_at,
        updated_at
      FROM product_import_jobs
      WHERE location_id = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [locationId]
  );

  return mapRow(row);
}

async function markAsProcessing(id) {
  const now = toIsoNow();

  await run(
    `
      UPDATE product_import_jobs
      SET
        status = 'processing',
        locked_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [now, now, id]
  );

  return getById(id);
}

async function markAsCompleted(id, result) {
  const now = toIsoNow();

  await run(
    `
      UPDATE product_import_jobs
      SET
        status = 'completed',
        result_json = ?,
        last_error_text = NULL,
        locked_at = NULL,
        processed_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [
      JSON.stringify(result || {}),
      now,
      now,
      id
    ]
  );

  return getById(id);
}

async function markAsFailed(id, errorText) {
  const now = toIsoNow();

  await run(
    `
      UPDATE product_import_jobs
      SET
        status = 'failed',
        last_error_text = ?,
        locked_at = NULL,
        processed_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [
      errorText || null,
      now,
      now,
      id
    ]
  );

  return getById(id);
}

module.exports = {
  createJob,
  getById,
  getLatestByLocationId,
  markAsProcessing,
  markAsCompleted,
  markAsFailed
};