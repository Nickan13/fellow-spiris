const invoiceJobRepo = require("../db/repositories/invoiceJobRepo");
const { processInvoiceJob } = require("./invoiceJobProcessor");

let intervalHandle = null;
let isRunning = false;

async function processNextRunnableJob() {
  if (isRunning) {
    return { processed: false, reason: "already-running" };
  }

  isRunning = true;

  try {
    const job = await invoiceJobRepo.getNextRunnableJob();
    return await processInvoiceJob(job);
  } finally {
    isRunning = false;
  }
}

function startInvoiceRetryWorker(intervalMs = 30000) {
  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(async () => {
    try {
      const result = await processNextRunnableJob();

      if (result.processed) {
        console.log("[invoice-retry-worker]", result);
      }
    } catch (err) {
      console.error("[invoice-retry-worker] unhandled error:", err.message);
    }
  }, intervalMs);

  console.log(`[invoice-retry-worker] started with interval ${intervalMs}ms`);
}

module.exports = {
  processNextRunnableJob,
  startInvoiceRetryWorker
};