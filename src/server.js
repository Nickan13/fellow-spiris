const app = require("./app");
const env = require("./config/env");
const { runMigrations } = require("./db/migrations");
const { startArticleAutoSync } = require("./services/articleAutoSyncService");
const { startInvoiceRetryWorker } = require("./services/invoiceRetryService");
const { startProductImportWorker } = require("./services/productImportWorkerService");

runMigrations();

app.listen(env.port, () => {
  console.log(`fellow-spiris listening on port ${env.port}`);
  startArticleAutoSync();
  startInvoiceRetryWorker();
  startProductImportWorker();
});