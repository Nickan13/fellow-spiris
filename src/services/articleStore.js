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

function normalizeArticleNumber(articleNumber) {
  return String(articleNumber).trim().toUpperCase();
}

async function upsertArticle(locationId, article) {
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO spiris_articles (
        location_id,
        spiris_article_id,
        article_number,
        name,
        unit_price,
        raw_json,
        changed_utc,
        last_synced_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(location_id, article_number)
      DO UPDATE SET
        spiris_article_id = excluded.spiris_article_id,
        name = excluded.name,
        unit_price = excluded.unit_price,
        raw_json = excluded.raw_json,
        changed_utc = excluded.changed_utc,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at
    `,
    [
      locationId,
      article.spirisArticleId,
      normalizeArticleNumber(article.articleNumber),
      article.name || null,
      article.unitPrice ?? null,
      JSON.stringify(article.raw),
      article.changedUtc || null,
      now,
      now
    ]
  );
}

async function getArticleByNumber(locationId, articleNumber) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        spiris_article_id,
        article_number,
        name,
        unit_price,
        raw_json,
        changed_utc,
        last_synced_at,
        created_at,
        updated_at
      FROM spiris_articles
      WHERE location_id = ?
        AND article_number = ?
      LIMIT 1
    `,
    [locationId, normalizeArticleNumber(articleNumber)]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    spirisArticleId: row.spiris_article_id,
    articleNumber: row.article_number,
    name: row.name,
    unitPrice: row.unit_price,
    raw: JSON.parse(row.raw_json),
    changedUtc: row.changed_utc,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  upsertArticle,
  getArticleByNumber
};