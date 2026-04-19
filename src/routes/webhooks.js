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
const { upsertCustomerDataToHL } = require("../services/shopifyCustomerProfileService");
const { updateAbandonedCheckoutInHL } = require("../services/shopifyAbandonedCheckoutService");
const { upsertShopifyCustomerToFellow } = require("../services/shopifyCustomerProfileService");
const shopifyRefundRepo = require("../db/repositories/shopifyRefundRepo");

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
        emailMarketingConsent {
          marketingState
          consentUpdatedAt
        }
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

function shouldSkipEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return (
    normalized.includes("joonix.net") ||
    normalized.includes("example.com") ||
    normalized.includes("test@")
  );
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

    if (shouldSkipEmail(customer?.email)) {
      console.log("[shopify customer webhook] skipped non-real email:", customer?.email || "");
      return res.status(200).send("ok");
    }

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
      if (shouldSkipEmail(email)) {
        console.log("[SHOPIFY ORDER] skipped non-real email:", email);
        return res.sendStatus(200);
      }

      if (process.env.SHOPIFY_ORDER_INVOICE_ENABLED !== "true") {
        console.log("[SHOPIFY ORDER] invoice disabled via SHOPIFY_ORDER_INVOICE_ENABLED, skipping Spiris job");
        } else {

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
    }}

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

router.post("/shopify/checkouts/update", async (req, res) => {
  try {
    const isValid = verifyShopifyWebhook(req);

    if (!isValid) {
      console.error("[shopify checkout webhook] invalid HMAC");
      return res.status(401).send("invalid signature");
    }

    const payload = req.body || {};

    if (payload.completed_at) {
      return res.status(200).send("ok");
    }

    if (shouldSkipEmail(payload.email)) {
      console.log("[shopify checkout webhook] skipped non-real email:", payload.email || "");
      return res.status(200).send("ok");
    }

    await updateAbandonedCheckoutInHL(payload);

    console.log("[shopify checkout webhook] synced abandoned checkout", {
      email: payload.email,
      checkoutId: payload.id || null
    });

    return res.status(200).send("ok");
  } catch (err) {
    console.error("[shopify checkout webhook] error:", err);
    return res.status(500).send("error");
  }
});

router.post("/shopify/refunds/create", async (req, res) => {
  console.log("[SHOPIFY REFUND WEBHOOK HIT]");

  try {
    const isValid = verifyShopifyWebhook(req);

    if (!isValid) {
      console.error("[shopify refund webhook] invalid HMAC");
      return res.status(401).send("invalid signature");
    }

    const payload = req.body || {};
    const locationId = "FZK53zttFssaKFsCr9jl";
    const shopifyOrderId = String(payload.order_id || "");
    const shopifyRefundId = String(payload.id || "");

    console.log("[SHOPIFY REFUND] order_id:", shopifyOrderId, "refund_id:", shopifyRefundId);

    // Idempotens-skydd
    const existingRefund = await shopifyRefundRepo.getRefundMapping(locationId, shopifyRefundId);
    if (existingRefund) {
      console.log("[SHOPIFY REFUND] already processed, skipping:", shopifyRefundId);
      return res.sendStatus(200);
    }

    const mapping = await shopifyOrderRepo.getOrderMapping(locationId, shopifyOrderId);

    if (!mapping) {
      console.log("[SHOPIFY REFUND] no order mapping found, skipping:", shopifyOrderId);
      return res.sendStatus(200);
    }

    if (!mapping.spiris_invoice_id) {
      console.log("[SHOPIFY REFUND] no spiris_invoice_id on mapping, skipping:", shopifyOrderId);
      return res.sendStatus(200);
    }

    const refundLineItems = Array.isArray(payload.refund_line_items)
      ? payload.refund_line_items
      : [];

    const shippingAdjustments = Array.isArray(payload.order_adjustments)
      ? payload.order_adjustments.filter((a) => a.kind === "shipping_refund")
      : [];

    const creditRows = [];

    for (const rli of refundLineItems) {
      const li = rli.line_item || {};
      const sku = String(li.sku || "").trim();
      const quantity = Number(rli.quantity || 0);
      const subtotal = Number(rli.subtotal || 0);
      const totalTax = Number(rli.total_tax || 0);
      const totalInclVat = subtotal + totalTax;

      if (!sku || quantity <= 0) {
        console.log("[SHOPIFY REFUND] skipping line item without sku or qty:", rli);
        continue;
      }

      const unitPriceInclVat = quantity > 0 ? Number((totalInclVat / quantity).toFixed(2)) : 0;

      const { getArticleByNumber } = require("../services/articleStore");
      const article = await getArticleByNumber(locationId, sku);

      if (!article) {
        console.warn("[SHOPIFY REFUND] no Spiris article for SKU:", sku);
        continue;
      }

      creditRows.push({
        ArticleId: article.spirisArticleId,
        Text: String(li.name || li.title || sku),
        Quantity: quantity,
        UnitPrice: unitPriceInclVat
      });
    }

    for (const adj of shippingAdjustments) {
      const amount = Math.abs(Number(adj.amount || 0));
      const taxAmount = Math.abs(Number(adj.tax_amount || 0));
      const totalInclVat = amount + taxAmount;

      if (totalInclVat > 0) {
        const freightSku = "frakt";
        const { getArticleByNumber } = require("../services/articleStore");
        const freightArticle = await getArticleByNumber(locationId, freightSku);

        if (freightArticle) {
          creditRows.push({
            ArticleId: freightArticle.spirisArticleId,
            Text: "Återbetalning frakt",
            Quantity: 1,
            UnitPrice: totalInclVat
          });
        } else {
          console.warn("[SHOPIFY REFUND] no Spiris article for freight SKU:", freightSku);
        }
      }
    }

    if (creditRows.length === 0) {
      console.log("[SHOPIFY REFUND] no credit rows to create for order:", shopifyOrderId);
      return res.sendStatus(200);
    }

    const tokenService = require("../services/tokenService");
    const spirisService = require("../services/spirisService");
    const accessToken = await tokenService.getAccessTokenForLocation(locationId);

    const refundDate = String(payload.processed_at || payload.created_at || "").split("T")[0]
      || new Date().toISOString().split("T")[0];

    const creditPayload = {
      InvoiceDate: refundDate,
      IncludesVat: true,
      Rows: creditRows
    };

    console.log("[SHOPIFY REFUND] creating credit invoice in Spiris:", {
      spirisInvoiceId: mapping.spiris_invoice_id,
      refundDate,
      rows: creditRows.length
    });

    const creditInvoice = await spirisService.createCreditInvoice(
      accessToken,
      mapping.spiris_invoice_id,
      creditPayload
    );

    console.log("[SHOPIFY REFUND] credit invoice created:", creditInvoice?.Id);

    await shopifyRefundRepo.createRefundMapping({
      locationId,
      shopifyOrderId,
      shopifyRefundId,
      spirisCreditInvoiceId: creditInvoice?.Id || null
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error("[shopify refund webhook] error:", err.response?.data || err.message);
    return res.sendStatus(500);
  }
});

router.post("/test", (req, res) => {
  console.log("[WEBHOOK TEST HIT]");
  res.send("ok");
});

module.exports = router;
