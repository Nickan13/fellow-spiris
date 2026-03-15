const invoiceJobRepo = require("../db/repositories/invoiceJobRepo");
const spirisInvoiceMappingRepo = require("../db/repositories/spirisInvoiceMappingRepo");
const invoiceOrchestrator = require("./invoiceOrchestrator");

function getNextRetryAt(attemptCount) {
  const retryDelaysInMinutes = [5, 15, 60, 180, 720];
  const index = Math.min(Math.max(attemptCount, 0), retryDelaysInMinutes.length - 1);
  const delayMinutes = retryDelaysInMinutes[index];

  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

function isRequiresActionError(err) {
  const message = String(err?.message || "");

  return (
    message.includes("No product mapping found") ||
    message.includes("No synced Spiris article found")
  );
}

async function processInvoiceJob(job) {
  if (!job) {
    return { processed: false, reason: "no-job" };
  }

  const existingMapping = await spirisInvoiceMappingRepo.getByLocationAndFellowInvoiceId(
    job.locationId,
    job.fellowInvoiceId
  );

  if (existingMapping) {
    await invoiceJobRepo.markAsCompleted(job.id);

    return {
      processed: true,
      status: "completed",
      reason: "mapping-already-exists",
      locationId: job.locationId,
      fellowInvoiceId: job.fellowInvoiceId,
      spirisInvoiceId: existingMapping.spirisInvoiceId
    };
  }

  await invoiceJobRepo.markAsProcessing(job.id);

  try {
    const result = await invoiceOrchestrator.createInvoiceFromPlatformPayload(job.payload);

    await spirisInvoiceMappingRepo.createMapping({
      locationId: job.locationId,
      fellowInvoiceId: job.fellowInvoiceId,
      spirisInvoiceId: result.invoice.Id,
      spirisCustomerId: result.customer.Id,
      sourceEventType: job.sourceEventType,
      request: result.payload,
      response: result.invoice
    });

    await invoiceJobRepo.markAsCompleted(job.id);

    return {
      processed: true,
      status: "completed",
      reason: "invoice-created",
      locationId: job.locationId,
      fellowInvoiceId: job.fellowInvoiceId,
      spirisInvoiceId: result.invoice.Id
    };
    } catch (err) {
    if (isRequiresActionError(err)) {
      await invoiceJobRepo.markAsRequiresAction(job.id, err.message);

      return {
        processed: true,
        status: "requires_action",
        reason: "user-action-required",
        locationId: job.locationId,
        fellowInvoiceId: job.fellowInvoiceId,
        error: err.message
      };
    }

    const refreshedJob = await invoiceJobRepo.getByLocationAndFellowInvoiceId(
      job.locationId,
      job.fellowInvoiceId
    );

    const currentAttemptCount = refreshedJob?.attemptCount || 0;
    const maxAttempts = refreshedJob?.maxAttempts || 5;
    const nextAttemptNumber = currentAttemptCount + 1;

    if (nextAttemptNumber >= maxAttempts) {
      await invoiceJobRepo.markAsFailed(job.id, err.message);

      return {
        processed: true,
        status: "failed",
        reason: "max-attempts-reached",
        locationId: job.locationId,
        fellowInvoiceId: job.fellowInvoiceId,
        error: err.message
      };
    }

    const nextRetryAt = getNextRetryAt(currentAttemptCount);

    await invoiceJobRepo.markAsRetry(job.id, err.message, nextRetryAt);

    return {
      processed: true,
      status: "retry",
      reason: "processing-error",
      locationId: job.locationId,
      fellowInvoiceId: job.fellowInvoiceId,
      error: err.message,
      nextRetryAt
    };
  }

module.exports = {
  processInvoiceJob
};