const spirisService = require("./spirisService");
const tokenService = require("./tokenService");
const customerResolver = require("./customerResolver");
const articleCache = require("./articleCache");
const articleStore = require("./articleStore");
const fellowProductMappingRepo = require("../db/repositories/fellowProductMappingRepo");

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

async function createInvoiceFromPlatformPayload(payload) {
  const locationId = payload.locationId || payload.altId;
  const fellowInvoiceId = payload._id || payload.id || payload.invoiceId;

  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!fellowInvoiceId) {
    throw new Error("fellow invoice id is required");
  }

  const invoiceItems = Array.isArray(payload.invoiceItems) ? payload.invoiceItems : [];

  if (invoiceItems.length === 0) {
    throw new Error(`No invoiceItems found for fellowInvoiceId=${fellowInvoiceId}`);
  }

  const accessToken = await tokenService.getAccessTokenForLocation(locationId);

  const email = payload.contactDetails?.email || null;
  const name = payload.contactDetails?.name || "Unknown customer";
  const address = payload.contactDetails?.address || {};

  const customer = await resolveSpirisCustomer({
    accessToken,
    customerType: "b2c",
    email,
    createPayload: {
      Name: name,
      EmailAddress: email || "",
      InvoiceAddress1: address.addressLine1 || "",
      InvoicePostalCode: address.postalCode || "",
      InvoiceCity: address.city || "",
      InvoiceCountryCode: address.countryCode || "SE",
      IsPrivatePerson: true
    }
  });

  const rows = [];

  for (const item of invoiceItems) {
    const fellowProductId = item.productId;

    if (!fellowProductId) {
      throw new Error(`Missing productId on invoice item for fellowInvoiceId=${fellowInvoiceId}`);
    }

    const productMapping = await fellowProductMappingRepo.getMappingByProductId(
      locationId,
      fellowProductId
    );

    if (!productMapping) {
      throw new Error(
        `No product mapping found for locationId=${locationId} fellowProductId=${fellowProductId}`
      );
    }

    const article = await resolveSpirisArticle(
      locationId,
      productMapping.spirisArticleNumber
    );

    const quantity = Number(item.qty || 0);
    const unitPrice = Number(item.amount || 0);

    if (!quantity || quantity <= 0) {
      throw new Error(
        `Invalid quantity for fellowInvoiceId=${fellowInvoiceId} fellowProductId=${fellowProductId}`
      );
    }

    rows.push({
      ArticleId: article.spirisArticleId,
      Text: item.name || article.name,
      Quantity: quantity,
      UnitPrice: unitPrice
    });
  }

  const requestPayload = {
    CustomerId: customer.Id,
    InvoiceDate: toIsoDate(payload.issueDate),
    Rows: rows
  };

  const invoice = await spirisService.createInvoice(accessToken, requestPayload);

  return {
    customer,
    payload: requestPayload,
    invoice
  };
}

module.exports = {
  createInvoiceDraftFromSimpleInput,
  createInvoiceFromPlatformPayload
};