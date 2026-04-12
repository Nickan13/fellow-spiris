const AppError = require("../utils/AppError");
const express = require("express");
const router = express.Router();
const platformWebhookLogRepo = require("../db/repositories/platformWebhookLogRepo");
const spirisInvoiceMappingRepo = require("../db/repositories/spirisInvoiceMappingRepo");
const invoiceJobRepo = require("../db/repositories/invoiceJobRepo");
const crypto = require("crypto");
const shopifyOrderRepo = require("../db/repositories/shopifyOrderRepo");
const shopifyOrderTransactionRepo = require("../db/repositories/shopfyOrderTransactionRepo");
const shopifyService = require("../services/shopifyService");
const shopifyCustomerMetricsService = require("../services/shopifyCustomerMetricsService");

const env = require("../config/env");
const invoiceOrchestrator = require("../services/invoiceOrchestrator");
const { processInvoiceJob } = require("../services/invoiceJobProcessor");
const draftMappingStore = require("../services/draftMappingStore");
const ghlService = require("../services/ghlService");
const ghlWritebackStore = require("../services/ghlWritebackStore");
const { validateCreateDraftInput } = require("../utils/validators");

function getNextRetryAt(attemptCount) {
  const retryDelaysInMinutes = [5, 15, 60, 180, 720];
  const index = Math.min(Math.max(attemptCount, 0), retryDelaysInMinutes.length - 1);
  const delayMinutes = retryDelaysInMinutes[index];

  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

router.post("/platform", async (req, res) => {

  console.log("FELLOW INVOICE WEBHOOK PAYLOAD:");
  console.log(JSON.stringify(req.body, null, 2));

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

    let job = await invoiceJobRepo.getByLocationAndFellowInvoiceId(locationId, invoiceId);

    if (!job) {
      job = await invoiceJobRepo.createJob({
        locationId,
        fellowInvoiceId: invoiceId,
        sourceEventType: eventType,
        payload: body,
        status: "pending"
      });
    }

    if (job.status === "completed") {
      return res.status(200).json({
        ok: true,
        received: true,
        reused: true,
        eventType,
        locationId,
        fellowInvoiceId: invoiceId,
        jobStatus: job.status
      });
    }

    if (job.status === "processing") {
      return res.status(202).json({
        ok: true,
        received: true,
        queued: true,
        eventType,
        locationId,
        fellowInvoiceId: invoiceId,
        jobStatus: job.status
      });
    }

    const result = await processInvoiceJob(job);

if (result.status === "completed") {
  return res.status(200).json({
    ok: true,
    received: true,
    reused: false,
    eventType,
    locationId,
    fellowInvoiceId: invoiceId,
    spirisInvoiceId: result.spirisInvoiceId,
    jobStatus: "completed"
  });
}

if (result.status === "retry") {
  return res.status(502).json({
    ok: false,
    error: result.error,
    nextRetryAt: result.nextRetryAt
  });
}

if (result.status === "failed") {
  return res.status(502).json({
    ok: false,
    error: result.error,
    reason: "max-attempts-reached"
  });
}

return res.status(202).json({
  ok: true,
  received: true,
  jobStatus: "processing"
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

//Ny kod 2026-04-01 för att synka nya kontakter i Sjöbergs Godas Shopify till Sjöbergs Godas Fellow
async function getShopifyCustomerWithBirthday(customerId) {
  const query = `
    query GetCustomer($id: ID!) {
      customer(id: $id) {
        email
        firstName
        lastName
        createdAt
        metafield(namespace: "facts", key: "birth_date") {
          value
        }
      }
    }
  `;

  const res = await fetch("https://e10270-9c.myshopify.com/admin/api/2026-01/graphql.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN
    },
    body: JSON.stringify({
      query,
      variables: {
        id: `gid://shopify/Customer/${customerId}`
      }
    })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  if (data.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  const customer = data?.data?.customer || null;

  if (!customer) {
    return null;
  }

  return {
    ...customer,
    customerSince: customer.createdAt ? customer.createdAt.split("T")[0] : ""
  };
}

async function upsertShopifyCustomerToFellow(customer) {
  if (!customer?.email) return;

  const birthDate = customer?.metafield?.value || "";

  const payload = {
    locationId: "FZK53zttFssaKFsCr9jl",
    email: customer.email,
    firstName: customer.firstName || "",
    lastName: customer.lastName || ""
  };

  if (/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    payload.dateOfBirth = birthDate;
  }

  const upsertRes = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GHL_SUBACCOUNT_PIT}`,
      "Version": "2021-07-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const upsertData = await upsertRes.json();

  if (!upsertRes.ok) {
    throw new Error(`HighLevel upsert HTTP ${upsertRes.status}: ${JSON.stringify(upsertData)}`);
  }

  const contactId = upsertData?.contact?.id;

  if (!contactId) {
    throw new Error("No contact id returned from HighLevel upsert");
  }

  const customFields = [];

  if (/^\d{4}-\d{2}-\d{2}$/.test(customer.customerSince || "")) {
    customFields.push({
      id: "h0tMu3xB2CJk7n8kCvr1",
      field_value: customer.customerSince
    });
  }

  if (customFields.length === 0) {
    return upsertData;
  }

  const updateRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${process.env.GHL_SUBACCOUNT_PIT}`,
      "Version": "2021-07-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ customFields })
  });

  const updateData = await updateRes.json();

  if (!updateRes.ok) {
    throw new Error(`HighLevel update HTTP ${updateRes.status}: ${JSON.stringify(updateData)}`);
  }

  return updateData;
}

function verifyShopifyWebhook(req) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");

  if (!secret) {
    throw new Error("Missing SHOPIFY_WEBHOOK_SECRET");
  }

  if (!hmacHeader) {
    return false;
  }

  if (!req.rawBody) {
    throw new Error("Missing rawBody for Shopify webhook verification");
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("base64");

  const safeHeader = Buffer.from(hmacHeader, "utf8");
  const safeDigest = Buffer.from(digest, "utf8");

  if (safeHeader.length !== safeDigest.length) {
    return false;
  }

  return crypto.timingSafeEqual(safeHeader, safeDigest);
}

router.post("/shopify/customer-webhook", async (req, res) => {
  try {
    const isValid = verifyShopifyWebhook(req);

    if (!isValid) {
      console.error("[shopify customer webhook] invalid HMAC");
      return res.status(401).send("invalid signature");
    }

    const shopifyCustomerId = req.body?.id;

    if (!shopifyCustomerId) {
      return res.status(200).send("ok");
    }

    const customer = await getShopifyCustomerWithBirthday(shopifyCustomerId);
    await upsertShopifyCustomerToFellow(customer);

    console.log(`[shopify customer webhook] synced customer profile ${shopifyCustomerId}`);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("[shopify customer webhook] error:", err);
    return res.status(500).send("error");
  }
});

router.post("/shopify/orders/create", async (req, res) => {
  console.log("[SHOPIFY ORDER WEBHOOK HIT]");

  try {
    const isValid = verifyShopifyWebhook(req);

    if (!isValid) {
      console.error("[shopify order webhook] invalid HMAC");
      return res.status(401).send("invalid signature");
    }

    const payload = req.body || {};

    const locationId = "FZK53zttFssaKFsCr9jl";
    const shopifyOrderId = String(payload.id || "");
    const email = String(payload.email || payload.customer?.email || "").trim().toLowerCase();

    const shopifyOrderJobRepo = require("../db/repositories/shopifyOrderJobRepo");

    const existing = await shopifyOrderRepo.getOrderMapping(
      locationId,
      String(shopifyOrderId)
    );

    if (existing) {
      console.log("[WEBHOOK] order already exists, skipping Spiris job:", shopifyOrderId);
    } else {
      await shopifyOrderJobRepo.createJob({
        locationId,
        shopifyOrderId,
        eventType: "orders/create",
        payloadJson: JSON.stringify(payload)
      });

      console.log("[SHOPIFY ORDER] Spiris job created");
    }

    if (!email) {
      console.log("[SHOPIFY ORDER] no email on order, skipping HL metrics sync");
      return res.sendStatus(200);
    }

    try {
      const orders = await shopifyService.listOrdersByEmail({
        shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
        accessToken: process.env.SHOPIFY_TOKEN,
        email
      });

      const metrics = shopifyCustomerMetricsService.buildCustomerMetricsFromOrders(orders);

      if (!metrics) {
        console.log("[SHOPIFY ORDER] no metrics built, skipping HL update", { email });
        return res.sendStatus(200);
      }

      await shopifyCustomerMetricsService.updateCustomerMetricsInHL(metrics);

      console.log("[SHOPIFY ORDER] HL metrics updated", {
        email,
        ordersCount: orders.length,
        shopifyOrdersCount: metrics.shopifyOrdersCount
      });
    } catch (metricsErr) {
      console.error("[SHOPIFY ORDER] HL metrics sync failed:", metricsErr.message);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[shopify order webhook] error:", err);
    return res.sendStatus(500);
  }
});

router.post("/shopify/order_transactions/create", async (req, res) => {
  console.log("[SHOPIFY ORDER TRANSACTION WEBHOOK HIT]");

  try {
    const payload = req.body || {};

    const locationId = "FZK53zttFssaKFsCr9jl";
    const shopifyOrderId = String(payload.order_id || "");

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    let mapping = null;

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      mapping = await shopifyOrderRepo.getOrderMapping(locationId, shopifyOrderId);

      if (mapping?.spiris_invoice_id) {
        break;
      }

      console.log("[SHOPIFY ORDER TRANSACTION] mapping not ready yet:", {
        shopifyOrderId,
        attempt
      });

      await sleep(1000);
    }

    if (!mapping?.spiris_invoice_id) {
      console.log("[SHOPIFY ORDER TRANSACTION] no completed mapping found after retry:", shopifyOrderId);
      return res.sendStatus(200);
    }

    const orderPayload = mapping.payload_json ? JSON.parse(mapping.payload_json) : {};
    const orderEmail = String(orderPayload?.email || "").trim().toLowerCase();

    const hasTestSku = Array.isArray(orderPayload?.line_items) &&
      orderPayload.line_items.some((li) => {
        return String(li?.sku || "").trim().toUpperCase() === "A1";
      });

    if (orderEmail !== "annika@forgood.se" || !hasTestSku) {
      console.log("[SHOPIFY ORDER TRANSACTION] skipping non-test payment:", {
        shopifyOrderId,
        email: orderEmail,
        hasTestSku
      });
      return res.sendStatus(200);
    }

    const transactionKind = String(payload.kind || "").toLowerCase();
    const transactionStatus = String(payload.status || "").toLowerCase();
    const transactionAmount = Number(payload.amount || 0);
    const transactionCurrency = String(payload.currency || "").toUpperCase();

    const isSuccessfulSale =
      transactionKind === "sale" &&
      transactionStatus === "success" &&
      transactionAmount > 0 &&
      transactionCurrency === "SEK";

    const paymentCandidate = {
      shopifyOrderId,
      spirisInvoiceId: mapping.spiris_invoice_id,
      spirisCustomerId: mapping.spiris_customer_id || null,
      transactionId: String(payload.id || ""),
      paymentDate: String(payload.processed_at || payload.created_at || "").split("T")[0],
      paymentAmount: transactionAmount,
      currency: transactionCurrency,
      accountNumber: 1581,
      transactionKind,
      transactionStatus,
      isSuccessfulSale
    };

  try {
  await shopifyOrderTransactionRepo.createOrIgnoreTransaction({
    locationId,
    shopifyOrderId,
    shopifyTransactionId: paymentCandidate.transactionId,
    shopifyParentId: String(payload.parent_id || ""),
    shopifyOrderName: mapping.shopify_order_name || null,
    kind: paymentCandidate.transactionKind,
    status: paymentCandidate.transactionStatus,
    gateway: String(payload.gateway || ""),
    paymentDate: paymentCandidate.paymentDate,
    currency: paymentCandidate.currency,
    amount: paymentCandidate.paymentAmount,
    rawPayloadJson: JSON.stringify(payload),
    spirisInvoiceId: paymentCandidate.spirisInvoiceId,
    spirisCustomerId: paymentCandidate.spirisCustomerId
  });

  console.log("[SHOPIFY ORDER TRANSACTION] saved to DB:", {
    shopifyOrderId,
    transactionId: paymentCandidate.transactionId
  });

} catch (dbErr) {
  console.error("[SHOPIFY ORDER TRANSACTION] DB error:", dbErr.message);
}

    console.log("[SHOPIFY ORDER TRANSACTION CHECK]");
    console.log(JSON.stringify(paymentCandidate, null, 2));

    return res.sendStatus(200);
      } catch (err) {
      console.error("[shopify order transaction webhook] error:", err);
        return res.sendStatus(500);
      }
    });

router.post("/test", (req, res) => {
  console.log("[WEBHOOK TEST HIT]");
  res.send("ok");
});

module.exports = router;
