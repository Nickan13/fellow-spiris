const AppError = require("../utils/AppError");
const express = require("express");
const router = express.Router();
const platformWebhookLogRepo = require("../db/repositories/platformWebhookLogRepo");
const spirisInvoiceMappingRepo = require("../db/repositories/spirisInvoiceMappingRepo");

const env = require("../config/env");
const invoiceOrchestrator = require("../services/invoiceOrchestrator");
const draftMappingStore = require("../services/draftMappingStore");
const ghlService = require("../services/ghlService");
const ghlWritebackStore = require("../services/ghlWritebackStore");
const { validateCreateDraftInput } = require("../utils/validators");

router.post("/platform", async (req, res) => {
  try {
    const body = req.body || {};

    const eventType =
      body.type ||
      body.event ||
      body.webhookType ||
      req.header("x-ghl-event") ||
      "unknown";

    const locationId =
      body.locationId ||
      body.companyId ||
      body.data?.locationId ||
      body.data?.companyId ||
      null;

    const invoiceId =
      body._id ||
      body.id ||
      body.invoiceId ||
      body.data?._id ||
      body.data?.id ||
      body.data?.invoiceId ||
      null;

    await platformWebhookLogRepo.createLog({
      eventType,
      locationId,
      invoiceId,
      payload: body,
      headers: {
        "user-agent": req.header("user-agent") || null,
        "x-wh-signature": req.header("x-wh-signature") || null,
        "x-ghl-signature": req.header("x-ghl-signature") || null,
        "x-ghl-event": req.header("x-ghl-event") || null
      }
    });

    if (eventType !== "InvoiceSent") {
      return res.status(200).json({
        ok: true,
        received: true,
        ignored: true,
        reason: "Only InvoiceSent is processed",
        eventType,
        locationId,
        invoiceId
      });
    }

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId missing in platform webhook"
      });
    }

    if (!invoiceId) {
      return res.status(400).json({
        ok: false,
        error: "invoiceId missing in platform webhook"
      });
    }

    const existingMapping = await spirisInvoiceMappingRepo.getByLocationAndFellowInvoiceId(
      locationId,
      invoiceId
    );

    if (existingMapping) {
      return res.status(200).json({
        ok: true,
        received: true,
        reused: true,
        eventType,
        locationId,
        fellowInvoiceId: invoiceId,
        spirisInvoiceId: existingMapping.spirisInvoiceId
      });
    }

    const result = await invoiceOrchestrator.createInvoiceFromPlatformPayload(body);

    await spirisInvoiceMappingRepo.createMapping({
      locationId,
      fellowInvoiceId: invoiceId,
      spirisInvoiceId: result.invoice.Id,
      spirisCustomerId: result.customer.Id,
      sourceEventType: eventType,
      request: result.payload,
      response: result.invoice
    });

    return res.status(200).json({
      ok: true,
      received: true,
      reused: false,
      eventType,
      locationId,
      fellowInvoiceId: invoiceId,
      spirisInvoiceId: result.invoice.Id
    });
  } catch (err) {
    console.error("[platform-webhook] error:", err.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: err.message,
      response: err.response?.data || null
    });
  }
});

router.post("/invoice/create-draft", async (req, res) => {
  try {
    const apiKey = req.header("x-api-key");

    if (apiKey !== env.webhookApiKey) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    const input = req.body;

    validateCreateDraftInput(input);

    let result;
    let reused = false;

    const existingMapping = await draftMappingStore.getByLocationAndEstimateId(
      input.locationId,
      input.estimateId
    );

    if (existingMapping) {
      reused = true;

      result = {
        customer: {
          Id: existingMapping.spirisCustomerId
        },
        draft: {
          Id: existingMapping.spirisDraftId
        },
        payload: existingMapping.request
      };
    } else {
      const created = await invoiceOrchestrator.createInvoiceDraftFromSimpleInput(input);

      await draftMappingStore.createMapping({
        locationId: input.locationId,
        estimateId: input.estimateId,
        spirisDraftId: created.draft.Id,
        spirisCustomerId: created.customer.Id,
        request: created.payload,
        response: created.draft
      });

      result = created;
    }

    try {
      const existingSuccessfulWriteback = await ghlWritebackStore.getSuccessfulWriteback({
        locationId: input.locationId,
        opportunityId: input.opportunityId,
        estimateId: input.estimateId,
        spirisDraftId: result.draft.Id
      });

      if (existingSuccessfulWriteback) {
        return res.json({
          ok: true,
          reused,
          estimateId: input.estimateId,
          opportunityId: input.opportunityId,
          customerId: result.customer.Id,
          draftId: result.draft.Id,
          payload: result.payload,
          writeback: {
            ok: true,
            reused: true
          }
        });
      }

      const writebackResult = await ghlService.updateOpportunityWithSpirisDraftId({
        locationId: input.locationId,
        opportunityId: input.opportunityId,
        spirisDraftId: result.draft.Id
      });

      await ghlWritebackStore.createWritebackLog({
        locationId: input.locationId,
        opportunityId: input.opportunityId,
        estimateId: input.estimateId,
        spirisDraftId: result.draft.Id,
        status: "success",
        request: writebackResult.request,
        response: writebackResult.response,
        errorText: null
      });

      return res.json({
        ok: true,
        reused,
        estimateId: input.estimateId,
        opportunityId: input.opportunityId,
        customerId: result.customer.Id,
        draftId: result.draft.Id,
        payload: result.payload,
        writeback: {
          ok: true,
          reused: false
        }
      });
    } catch (writebackErr) {
      await ghlWritebackStore.createWritebackLog({
        locationId: input.locationId,
        opportunityId: input.opportunityId,
        estimateId: input.estimateId,
        spirisDraftId: result.draft.Id,
        status: "failed",
        request: {
          opportunityId: input.opportunityId,
          spirisDraftId: result.draft.Id
        },
        response: writebackErr.response?.data || null,
        errorText: writebackErr.message
      });

      return res.status(502).json({
        ok: false,
        error: "Draft created in Spiris but HighLevel writeback failed",
        reused,
        estimateId: input.estimateId,
        opportunityId: input.opportunityId,
        customerId: result.customer.Id,
        draftId: result.draft.Id,
        payload: result.payload,
        writeback: {
          ok: false,
          error: writebackErr.message,
          response: writebackErr.response?.data || null
        }
      });
    }
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        ok: false,
        error: err.message,
        code: err.code
      });
    }

    if (err.response?.data) {
      return res.status(502).json({
        ok: false,
        error: "External API error",
        providerResponse: err.response.data
      });
    }

    console.error("Unhandled error:", err);

    return res.status(500).json({
      ok: false,
      error: "Internal server error"
    });
  }
});

module.exports = router;