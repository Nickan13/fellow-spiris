const spirisService = require("./spirisService");
const tokenService = require("./tokenService");
const customerResolver = require("./customerResolver");
const articleCache = require("./articleCache");
const articleStore = require("./articleStore");

function toIsoDate(value) {
  if (!value) {
    return new Date().toISOString().split("T")[0];
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }

  return d.toISOString().split("T")[0];
}

async function resolveSpirisArticle(locationId, articleNumber) {
  if (!locationId) {
    throw new Error("locationId is required for article lookup");
  }

  if (!articleNumber) {
    throw new Error("articleNumber is required");
  }

  const cached = articleCache.get(locationId, articleNumber);

  if (cached) {
    return cached;
  }

  const stored = await articleStore.getArticleByNumber(locationId, articleNumber);

  if (stored) {
    articleCache.set(locationId, articleNumber, stored);
    return stored;
  }

  throw new Error(
    `No synced Spiris article found for locationId=${locationId} articleNumber=${articleNumber}`
  );
}

async function resolveSpirisCustomer({
  accessToken,
  customerType,
  orgNumber,
  email,
  createPayload
}) {
  const existing = await customerResolver.resolveExistingCustomer({
    accessToken,
    customerType,
    orgNumber,
    email
  });

  if (existing) {
    return existing;
  }

  if (!createPayload) {
    throw new Error("Customer not found and no createPayload provided");
  }

  return spirisService.createCustomer(accessToken, createPayload);
}

async function createInvoiceDraftFromSimpleInput(input) {
  const {
    locationId,
    customerType,
    orgNumber,
    email,
    customerCreatePayload,
    invoiceDate,
    rows
  } = input;

  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows are required");
  }

  const accessToken = await tokenService.getAccessTokenForLocation(locationId);

  const customer = await resolveSpirisCustomer({
    accessToken,
    customerType,
    orgNumber,
    email,
    createPayload: customerCreatePayload
  });

  const draftRows = [];

  for (const row of rows) {
    const article = await resolveSpirisArticle(locationId, row.articleNumber);

    draftRows.push({
      ArticleId: article.spirisArticleId,
      Text: row.text || article.name,
      Quantity: row.quantity,
      UnitPrice: row.unitPrice
    });
  }

  const payload = {
    CustomerId: customer.Id,
    InvoiceDate: toIsoDate(invoiceDate),
    Rows: draftRows
  };

  const draft = await spirisService.createInvoiceDraft(accessToken, payload);

  return {
    customer,
    payload,
    draft
  };
}

module.exports = {
  createInvoiceDraftFromSimpleInput
};