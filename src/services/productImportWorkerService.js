const productImportJobRepo = require("../db/repositories/productImportJobRepo");
const fellowProductImportService = require("./fellowProductImportService");

let intervalHandle = null;
let isTickRunning = false;

async function processNextProductImportJob() {
  const job = await productImportJobRepo.getNextPendingJob();

  if (!job) {
    return null;
  }

  const hasRunningJob =
    await productImportJobRepo.hasRunningJobForLocation(job.locationId);

  if (hasRunningJob) {
    return null;
  }

  await productImportJobRepo.markAsProcessing(job.id);

  try {
    const result = await fellowProductImportService.importProductsForLocation({
      locationId: job.locationId,
      limit: job.importAll ? null : job.requestedLimit,
      articleFetchLimit: job.articleFetchLimit
    });

    await productImportJobRepo.markAsCompleted(job.id, result);

    return {
      jobId: job.id,
      status: "completed",
      locationId: job.locationId
    };
  } catch (err) {
    const errorText = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;

    await productImportJobRepo.markAsFailed(job.id, errorText);

    return {
      jobId: job.id,
      status: "failed",
      locationId: job.locationId,
      error: errorText
    };
  }
}

async function tickProductImportWorker() {
  if (isTickRunning) {
    return;
  }

  isTickRunning = true;

  try {
    await processNextProductImportJob();
  } catch (err) {
    console.error("product import worker tick error:", err.message);
  } finally {
    isTickRunning = false;
  }
}

function startProductImportWorker(intervalMs = 5000) {
  if (intervalHandle) {
    return intervalHandle;
  }

  intervalHandle = setInterval(() => {
    tickProductImportWorker();
  }, intervalMs);

  tickProductImportWorker();

  console.log(`Product import worker started (interval ${intervalMs} ms)`);

  return intervalHandle;
}

module.exports = {
  processNextProductImportJob,
  startProductImportWorker
};