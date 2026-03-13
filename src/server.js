const app = require("./app");
const env = require("./config/env");
const { runMigrations } = require("./db/migrations");
const { startArticleAutoSync } = require("./services/articleAutoSyncService");

runMigrations();

app.listen(env.port, () => {
  console.log(`fellow-spiris listening on port ${env.port}`);
  startArticleAutoSync();
});