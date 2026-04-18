const shopifyOrderJobRepo = require("../db/repositories/shopifyOrderJobRepo");
const shopifyOrderRepo = require("../db/repositories/shopifyOrderRepo");
const invoiceOrchestrator = require("./invoiceOrchestrator");
const shopifyService = require("./shopifyService");

//tilfällig kod innan vi släpper Sharespine - med testprodukt mm.
const TEST_MODE_ONLY = true;
const TEST_CUSTOMER_EMAIL = "annika@forgood.se";
const TEST_PRODUCT_SKU = "A1";

function isAllowedTestOrder(sourceOrder) {
  if (!TEST_MODE_ONLY) {
    return true;
  }

  const orderEmail = String(sourceOrder?.email || "").trim().toLowerCase();

  const hasTestSku = Array.isArray(sourceOrder?.line_items) &&
    sourceOrder.line_items.some((li) => {
      return String(li?.sku || "").trim().toUpperCase() === TEST_PRODUCT_SKU;
    });

  return orderEmail === TEST_CUSTOMER_EMAIL && hasTestSku;
}
//slut tillfällig kod innan vi släpper Sharespine

async function processJobs() {
  //console.log("[SHOPIFY WORKER] checking jobs...");
  const jobs = await shopifyOrderJobRepo.getPendingJobs(10);
  //console.log("[SHOPIFY WORKER] jobs:", jobs);

  if (!jobs || jobs.length === 0) {
    return;
  }

  for (const job of jobs) {
      console.log("[SHOPIFY WORKER] starting job:", {
        jobId: job.id,
        locationId: job.location_id,
        shopifyOrderId: job.shopify_order_id,
        status: job.status,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts
      });
  try {
    const order = await shopifyService.getOrderById({
      shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
      accessToken: process.env.SHOPIFY_TOKEN,
      orderId: job.shopify_order_id
  });

  const sourceOrder = order;

  console.log("[SHOPIFY WORKER] fetched order:", {
    orderId: order?.id || null,
    email: sourceOrder?.email || null,
    lineItemCount: Array.isArray(sourceOrder?.line_items) ? sourceOrder.line_items.length : 0,
    shippingLineCount: Array.isArray(sourceOrder?.shipping_lines) ? sourceOrder.shipping_lines.length : 0,
    financialStatus: sourceOrder?.financial_status || null,
    totalPrice: sourceOrder?.total_price || null,
    currency: sourceOrder?.currency || null
  });

  //tillfällig kod innan vi släpper Sharespine_2
  if (!isAllowedTestOrder(sourceOrder)) {
  console.log("[SHOPIFY WORKER] skipping non-test order:", {
    orderId: sourceOrder?.id || null,
    email: sourceOrder?.email || null
  });

  await shopifyOrderJobRepo.markCompleted(job.id);
    continue;
  }
  //slut tillfällig kod innan vi släpper Sharespine_2
    
  await shopifyOrderJobRepo.markProcessing(job.id);

  const shopifyOrderId = String(job.shopify_order_id);

  console.log("[SHOPIFY WORKER] job marked processing:", {
    jobId: job.id,
    shopifyOrderId
  });

  const rows = [];

  for (const li of sourceOrder.line_items || []) {
    rows.push({
      articleNumber: li.sku,
      text: li.title,
      quantity: li.quantity,
      unitPrice: li.price ? parseFloat(li.price) : 0
    });
  }

  for (const sl of sourceOrder.shipping_lines || []) {
   const shippingAmountRaw =
    sl.discounted_price != null ? sl.discounted_price : sl.price;

    const price = shippingAmountRaw ? parseFloat(shippingAmountRaw) : 0;

    if (price > 0) {
      rows.push({
        articleNumber: "FRAKT",
        text: sl.title || "Frakt",
        quantity: 1,
        unitPrice: price
      });
    }
}

console.log("[SHOPIFY WORKER] built invoice rows:", {
  shopifyOrderId,
  rowCount: rows.length,
  rows
});

// 🔹 Idempotens: kolla om order redan finns
const existing = await shopifyOrderRepo.getOrderMapping(
  job.location_id,
  shopifyOrderId
);

if (existing) {
  if (existing.spiris_invoice_id) {
    console.log("[SHOPIFY WORKER] invoice already exists, skipping:", shopifyOrderId);
    await shopifyOrderJobRepo.markCompleted(job.id);
    continue;
  }

  console.log("[SHOPIFY WORKER] mapping exists but no invoice, continue processing");
}

// 🔹 Spara mapping (utan Spiris än)
console.log("[SHOPIFY WORKER] creating initial order mapping:", {
  shopifyOrderId,
  locationId: job.location_id
});

await shopifyOrderRepo.createOrderMapping({
  locationId: job.location_id,
  shopifyOrderId,
  shopifyOrderGid: sourceOrder.admin_graphql_api_id || null,
  shopifyOrderName: sourceOrder.name || null,
  shopifyOrderNumber: sourceOrder.order_number
    ? String(sourceOrder.order_number)
    : null,
  shopifyShopDomain: sourceOrder?.source_name || null,
  currency: sourceOrder?.currency || null,
  orderTotal: sourceOrder?.total_price
    ? parseFloat(sourceOrder?.total_price)
    : null,
  financialStatus: sourceOrder?.financial_status || null,
  fulfillmentStatus: sourceOrder?.fulfillment_status || null,
  payloadJson: JSON.stringify(sourceOrder)
});

console.log("[SHOPIFY WORKER] initial order mapping created:", {
  shopifyOrderId,
  locationId: job.location_id
});

const customerTags = String(sourceOrder.customer?.tags || "").toLowerCase();

const companyValue =
  sourceOrder.billing_address?.company ||
  sourceOrder.shipping_address?.company ||
  sourceOrder.customer?.default_address?.company ||
    "";

const isB2B =
  customerTags.includes("b2b") ||
  Boolean(String(companyValue).trim());

const normalizedOrgNumber = String(companyValue).replace(/[^0-9]/g, "");
const orgNumber =
  normalizedOrgNumber.length >= 10 ? normalizedOrgNumber : null;

const customerType = isB2B ? "b2b" : "b2c";

console.log("[SHOPIFY WORKER] resolved customer type:", {
  shopifyOrderId,
  customerType,
  orgNumber,
  email: sourceOrder.email || null,
  companyValue: String(companyValue || "")
});

const companyLooksLikeOrgNumber =
  Boolean(String(companyValue).trim()) && Boolean(orgNumber);

const personName =
  `${sourceOrder.customer?.first_name || ""} ${sourceOrder.customer?.last_name || ""}`.trim();

const customerName = isB2B
  ? (!companyLooksLikeOrgNumber ? String(companyValue).trim() : "") ||
    personName ||
    sourceOrder.email ||
    "Shopify customer"
  : personName ||
    sourceOrder.email ||
    "Shopify customer";

const created = await invoiceOrchestrator.createInvoiceFromSimpleInput({
  locationId: job.location_id,
  customerType,
  orgNumber,
  email: sourceOrder.email,
  customerCreatePayload: {
    Name: customerName,
    EmailAddress: sourceOrder.email || "",
    InvoiceAddress1:
      sourceOrder.billing_address?.address1 ||
      sourceOrder.shipping_address?.address1 ||
      sourceOrder.customer?.default_address?.address1 ||
      "",
    InvoicePostalCode:
      sourceOrder.billing_address?.zip ||
      sourceOrder.shipping_address?.zip ||
     sourceOrder.customer?.default_address?.zip ||
     "",
    InvoiceCity:
     sourceOrder.billing_address?.city ||
     sourceOrder.shipping_address?.city ||
     sourceOrder.customer?.default_address?.city ||
     "",
   InvoiceCountryCode:
      sourceOrder.billing_address?.country_code ||
     sourceOrder.shipping_address?.country_code ||
     sourceOrder.customer?.default_address?.country_code ||
     "SE",
    TermsOfPaymentId: "8f9a8f7b-5ea9-44c6-9725-9b8a1addb036",
   IsPrivatePerson: customerType === "b2c"
  },
  invoiceDate: sourceOrder.created_at,
  rows
});

console.log("[SHOPIFY WORKER] Spiris invoice flow completed:", {
  shopifyOrderId,
  spirisCustomerId: created?.customer?.Id || null,
  spirisInvoiceId: created?.invoice?.Id || null,
  spirisInvoiceNumber: created?.invoice?.InvoiceNumber || null,
  spirisPaymentDate: created?.payment?.PaymentDate || null,
  spirisPaymentAmount: created?.payment?.PaymentAmount || null,
  spirisBankTransactionId: created?.payment?.BankTransactionId || null
});

await shopifyOrderRepo.setSpirisData(
  job.location_id,
  shopifyOrderId,
  created.invoice.Id,
  created.customer.Id
);

console.log("[SHOPIFY WORKER] mapping updated with Spiris data:", {
  shopifyOrderId,
  spirisInvoiceId: created.invoice.Id,
  spirisCustomerId: created.customer.Id
});

await shopifyOrderJobRepo.markCompleted(job.id);
  console.log("[SHOPIFY WORKER] job completed:", {
    jobId: job.id,
    shopifyOrderId
  });
  } catch (err) {
    console.error("[shopify worker] error:", err.message);

  if (err.response) {
    console.error("[shopify worker] response status:", err.response.status);
    console.error("[shopify worker] response data:", JSON.stringify(err.response.data, null, 2));
  } else if (err.stack) {
  console.error("[shopify worker] stack:", err.stack);
}

const nextAttempt = job.attempt_count + 1;
  if (nextAttempt >= job.max_attempts) {
    await shopifyOrderJobRepo.markFailed(job.id, err.message);
  } else {

  const nextRetryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await shopifyOrderJobRepo.markRetry(
      job.id,
      err.message,
      nextAttempt,
      nextRetryAt
    );
   }
  }
 }
}

let intervalHandle = null;

function startShopifyOrderWorker(intervalMs = 5000) {
  if (intervalHandle) {
    return intervalHandle;
  }

  intervalHandle = setInterval(() => {
    processJobs();
  }, intervalMs);

  processJobs();

  console.log(`Shopify order worker started (interval ${intervalMs} ms)`);

  return intervalHandle;
}

module.exports = {
  processJobs,
  startShopifyOrderWorker
};
