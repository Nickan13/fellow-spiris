const AppError = require("../utils/AppError");
const express = require("express");
const router = express.Router();

const env = require("../config/env");
const invoiceOrchestrator = require("../services/invoiceOrchestrator");
const draftMappingStore = require("../services/draftMappingStore");
const ghlService = require("../services/ghlService");
const ghlWritebackStore = require("../services/ghlWritebackStore");
const { validateCreateDraftInput } = require("../utils/validators");

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