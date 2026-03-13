const env = require("../config/env");
const tokenService = require("./tokenService");
const articleSyncService = require("./articleSyncService");

const runningLocations = new Set();

async function syncSingleLocation(locationId) {
  if (!locationId) {
    return;
  }

  if (runningLocations.has(locationId)) {
    console.log(`[article-auto-sync] skipping ${locationId}, sync already running`);
    return;
  }

  runningLocations.add(locationId);

  try {
    console.log(`[article-auto-sync] starting sync for ${locationId}`);

    const accessToken = await tokenService.getAccessTokenForLocation(locationId);

    const result = await articleSyncService.syncArticlesForLocation({
      locationId,
      accessToken,
      pageSize: 50
    });

    console.log(
      `[article-auto-sync] completed sync for ${locationId}: ` +
      `syncedCount=${result.syncedCount}, totalPages=${result.totalPages}`
    );
  } catch (err) {
    console.error(
      `[article-auto-sync] failed sync for ${locationId}:`,
      err.response?.data || err.message
    );
  } finally {
    runningLocations.delete(locationId);
  }
}

async function runAllLocationsOnce() {
  const locationIds = env.spirisArticleSyncLocationIds;

  if (!Array.isArray(locationIds) || locationIds.length === 0) {
    console.log("[article-auto-sync] no locationIds configured");
    return;
  }

  for (const locationId of locationIds) {
    await syncSingleLocation(locationId);
  }
}

function startArticleAutoSync() {
  if (!env.spirisArticleSyncEnabled) {
    console.log("[article-auto-sync] disabled");
    return;
  }

  if (!Array.isArray(env.spirisArticleSyncLocationIds) || env.spirisArticleSyncLocationIds.length === 0) {
    console.log("[article-auto-sync] enabled, but no locationIds configured");
    return;
  }

  const intervalMs = env.spirisArticleSyncIntervalMs;

  console.log(
    `[article-auto-sync] enabled for ${env.spirisArticleSyncLocationIds.length} location(s), ` +
    `interval=${intervalMs}ms`
  );

  runAllLocationsOnce().catch((err) => {
    console.error("[article-auto-sync] initial run failed:", err.message);
  });

  setInterval(() => {
    runAllLocationsOnce().catch((err) => {
      console.error("[article-auto-sync] scheduled run failed:", err.message);
    });
  }, intervalMs);
}

module.exports = {
  startArticleAutoSync
};