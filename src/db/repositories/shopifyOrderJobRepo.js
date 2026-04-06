const db = require("../database");

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
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

async function createJob({
  locationId,
  shopifyOrderId,
  eventType,
  payloadJson
}) {
  const sql = `
    INSERT INTO shopify_order_jobs (
      location_id,
      shopify_order_id,
      event_type,
      payload_json,
      status,
      attempt_count,
      max_attempts
    )
    VALUES (?, ?, ?, ?, 'pending', 0, 5)
  `;

  await run(sql, [
    locationId,
    shopifyOrderId,
    eventType,
    payloadJson
  ]);
}

async function getPendingJobs(limit = 20) {
  const sql = `
    SELECT *
    FROM shopify_order_jobs
    WHERE status IN ('pending', 'retry')
      AND (
        next_retry_at IS NULL
        OR next_retry_at <= CURRENT_TIMESTAMP
      )
    ORDER BY id ASC
    LIMIT ?
  `;

  return await all(sql, [limit]);
}

async function markProcessing(jobId) {
  const sql = `
    UPDATE shopify_order_jobs
    SET
      status = 'processing',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  await run(sql, [jobId]);
}

async function markCompleted(jobId) {
  const sql = `
    UPDATE shopify_order_jobs
    SET
      status = 'completed',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  await run(sql, [jobId]);
}

async function markFailed(jobId, errorText) {
  const sql = `
    UPDATE shopify_order_jobs
    SET
      status = 'failed',
      last_error_text = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  await run(sql, [errorText, jobId]);
}

async function markRetry(jobId, errorText, attemptCount, nextRetryAt) {
  const sql = `
    UPDATE shopify_order_jobs
    SET
      status = 'retry',
      last_error_text = ?,
      attempt_count = ?,
      next_retry_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  await run(sql, [
    errorText,
    attemptCount,
    nextRetryAt,
    jobId
  ]);
}

module.exports = {
  createJob,
  getPendingJobs,
  markProcessing,
  markCompleted,
  markFailed,
  markRetry
};