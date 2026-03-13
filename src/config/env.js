require("dotenv").config();

function parseCsv(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT || 3100),
  webhookApiKey: process.env.WEBHOOK_API_KEY,
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
  sqlitePath: process.env.SQLITE_PATH,

  ghlApiBase: process.env.GHL_API_BASE,
  ghlApiVersion: process.env.GHL_API_VERSION || "2021-07-28",
  ghlClientId: process.env.GHL_CLIENT_ID,
  ghlClientSecret: process.env.GHL_CLIENT_SECRET,
  ghlWritebackLocationId: process.env.GHL_WRITEBACK_LOCATION_ID,
  ghlSubaccountPit: process.env.GHL_SUBACCOUNT_PIT,
  ghlSpirisDraftFieldKey: process.env.GHL_SPIRIS_DRAFT_FIELD_KEY,

  platformAppClientId: process.env.PLATFORM_APP_CLIENT_ID,
  platformAppClientSecret: process.env.PLATFORM_APP_CLIENT_SECRET,
  platformAppRedirectUri: process.env.PLATFORM_APP_REDIRECT_URI,
  platformAppTokenBase: process.env.PLATFORM_APP_TOKEN_BASE || "https://services.leadconnectorhq.com",

  spirisAuthBase: process.env.SPIRIS_AUTH_BASE,
  spirisApiBase: process.env.SPIRIS_API_BASE,
  spirisClientId: process.env.SPIRIS_CLIENT_ID,
  spirisClientSecret: process.env.SPIRIS_CLIENT_SECRET,
  spirisRedirectUri: process.env.SPIRIS_REDIRECT_URI,

  spirisArticleSyncEnabled: String(process.env.SPIRIS_ARTICLE_SYNC_ENABLED || "false").toLowerCase() === "true",
  spirisArticleSyncLocationIds: parseCsv(process.env.SPIRIS_ARTICLE_SYNC_LOCATION_IDS),
  spirisArticleSyncIntervalMs: Number(process.env.SPIRIS_ARTICLE_SYNC_INTERVAL_MS || 3600000)
};