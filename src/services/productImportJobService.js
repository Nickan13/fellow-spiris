const productImportJobRepo = require("../db/repositories/productImportJobRepo");
const fellowProductImportService = require("./fellowProductImportService");

async function runProductImportJob({
  locationId,
  importAll = false,
  requestedLimit = null,
  articleFetchLimit = null
}) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const job = await productImportJobRepo.createJob({
    locationId,
    importAll,
    requestedLimit,
    articleFetchLimit
  });

  await productImportJobRepo.markAsProcessing(job.id);

  try {
    const result = await fellowProductImportService.importProductsForLocation({
      locationId,
      limit: importAll ? null : requestedLimit,
      articleFetchLimit
    });

    const completedJob = await productImportJobRepo.markAsCompleted(
      job.id,
      result
    );

    return {
      job: completedJob,
      result
    };
  } catch (err) {
    const errorText = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;

    const failedJob = await productImportJobRepo.markAsFailed(
      job.id,
      errorText
    );

    return {
      job: failedJob,
      result: null
    };
  }
}

module.exports = {
  runProductImportJob
};