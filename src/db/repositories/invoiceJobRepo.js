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

function toIsoNow() {
  return new Date().toISOString();
}

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    locationId: row.location_id,
    fellowInvoiceId: row.fellow_invoice_id,
    sourceEventType: row.source_event_type,
    status: row.status,
    payload: JSON.parse(row.payload_json),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at,
    lastErrorText: row.last_error_text,
    lockedAt: row.locked_at,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getByLocationAndFellowInvoiceId(locationId, fellowInvoiceId) {
  const row = await get(
    `
      SELECT
        id,
        location_id,
        fellow_invoice_id,
        source_event_type,
        status,
        payload_json,
        attempt_count,
        max_attempts,
        next_retry_at,
        last_error_text,
        locked_at,
        processed_at,
        created_at,
        updated_at
      FROM invoice_jobs
      WHERE location_id = ?
        AND fellow_invoice_id = ?
      LIMIT 1
    `,
    [locationId, fellowInvoiceId]
  );

    return mapRow(row);
}

async function createJob({
  locationId,
  fellowInvoiceId,
  sourceEventType,
  payload,
  status = "pending",
  nextRetryAt = null,
  maxAttempts = 5
}) {
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO invoice_jobs (
        location_id,
        fellow_invoice_id,
        source_event_type,
        status,
        payload_json,
        attempt_count,
        max_attempts,
        next_retry_at,
        last_error_text,
        locked_at,
        processed_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL, ?, ?)
    `,
    [
      locationId,
      fellowInvoiceId,
      sourceEventType || null,
      status,
      JSON.stringify(payload || {}),
      maxAttempts,
      nextRetryAt,
      now,
      now
    ]
  );

  return getByLocationAndFellowInvoiceId(locationId, fellowInvoiceId);
}

async function markAsProcessing(id) {
  const now = toIsoNow();

  await run(
    `
      UPDATE invoice_jobs
      SET
        status = 'processing',
        locked_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [now, now, id]
  );
}

async function markAsCompleted(id) {
  const now = toIsoNow();

  await run(
    `
      UPDATE invoice_jobs
      SET
        status = 'completed',
        attempt_count = attempt_count + 1,
        locked_at = NULL,
        next_retry_at = NULL,
        last_error_text = NULL,
        processed_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [now, now, id]
  );
}

async function markAsRetry(id, errorText, nextRetryAt) {
  const now = toIsoNow();

  await run(
    `
      UPDATE invoice_jobs
      SET
        status = 'retry',
        attempt_count = attempt_count + 1,
        locked_at = NULL,
        last_error_text = ?,
        next_retry_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [errorText || null, nextRetryAt || null, now, id]
  );
}

async function markAsFailed(id, errorText) {
  const now = toIsoNow();

  await run(
    `
      UPDATE invoice_jobs
      SET
        status = 'failed',
        attempt_count = attempt_count + 1,
        locked_at = NULL,
        last_error_text = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [errorText || null, now, id]
  );
}

async function getNextRunnableJob() {
  const now = toIsoNow();

  const row = await get(
    `
      SELECT
        id,
        location_id,
        fellow_invoice_id,
        source_event_type,
        status,
        payload_json,
        attempt_count,
        max_attempts,
        next_retry_at,
        last_error_text,
        locked_at,
        processed_at,
        created_at,
        updated_at
      FROM invoice_jobs
      WHERE (
        status = 'pending'
        OR (
          status = 'retry'
          AND next_retry_at IS NOT NULL
          AND next_retry_at <= ?
        )
      )
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [now]
  );

  return mapRow(row);
}

module.exports = {
  getByLocationAndFellowInvoiceId,
  getNextRunnableJob,
  createJob,
  markAsProcessing,
  markAsCompleted,
  markAsRetry,
  markAsFailed
};