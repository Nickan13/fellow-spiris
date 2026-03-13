const db = require("../database");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_app_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_platform_app_tokens_location
    ON platform_app_tokens(location_id)
  `);
});

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

async function saveToken({
  locationId,
  accessToken,
  refreshToken,
  expiresAt,
  raw
}) {
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO platform_app_tokens (
        location_id,
        access_token,
        refresh_token,
        expires_at,
        raw_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(location_id)
      DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `,
    [
      locationId,
      accessToken,
      refreshToken || null,
      expiresAt || null,
      JSON.stringify(raw),
      now,
      now
    ]
  );
}

async function getTokenByLocationId(locationId) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        access_token,
        refresh_token,
        expires_at,
        raw_json,
        created_at,
        updated_at
      FROM platform_app_tokens
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
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    raw: JSON.parse(row.raw_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  saveToken,
  getTokenByLocationId
};