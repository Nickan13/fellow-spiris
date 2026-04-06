const spirisService = require("./spirisService");
const tokenService = require("./tokenService");
const customerResolver = require("./customerResolver");
const articleCache = require("./articleCache");
const articleStore = require("./articleStore");
const fellowProductMappingRepo = require("../db/repositories/fellowProductMappingRepo");
const integrationSettingsRepo = require("../db/repositories/integrationSettingsRepo");

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

async function resolveSpirisCustomerStrict({
  accessToken,
  customerType,
  orgNumber,
  email,
  createPayload
}) {
  const customer = await resolveSpirisCustomer({
    accessToken,
    customerType,
    orgNumber,
    email,
    createPayload
  });

  if (customerType !== "b2b") {
    return customer;
  }

  if (!customer?.IsPrivatePerson) {
    return customer;
  }

  if (!createPayload) {
    throw new Error("Resolved private person for b2b customer, but no createPayload provided");
  }

  return spirisService.createCustomer(accessToken, {
    ...createPayload,
    IsPrivatePerson: false
  });
}

function getArticleVatRate(article) {
  const gross = Number(article?.raw?.GrossPrice);
  const net = Number(article?.raw?.NetPrice);

  if (!Number.isFinite(gross) || !Number.isFinite(net) || net <= 0 || gross < net) {
    return 0;
  }

  return (gross - net) / net;
}

function convertInclusiveToExclusive(unitPriceInclVat, vatRate) {
  const price = Number(unitPriceInclVat);

  if (!Number.isFinite(price)) {
    throw new Error(`Invalid unit price: ${unitPriceInclVat}`);
  }

  if (!Number.isFinite(vatRate) || vatRate <= 0) {
    return price;
  }

  return Number((price / (1 + vatRate)).toFixed(2));
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

  const customer = await resolveSpirisCustomerStrict({
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

  const invoiceMode = await integrationSettingsRepo.getInvoiceModeByLocationId(locationId);

  let invoice;

  if (invoiceMode === "draft") {
    invoice = await spirisService.createInvoiceDraft(accessToken, requestPayload);
  } else {
    invoice = await spirisService.createInvoice(accessToken, requestPayload);
  }

  return {
    customer,
    payload: requestPayload,
    invoice
  };
}

async function createInvoiceFromSimpleInput(input) {
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

  const customer = await resolveSpirisCustomerStrict({
    accessToken,
    customerType,
    orgNumber,
    email,
    createPayload: customerCreatePayload
  });

  const invoiceRows = [];

  for (const row of rows) {
    const article = await resolveSpirisArticle(locationId, row.articleNumber);

    const inputUnitPrice = Number(row.unitPrice || 0);

    if (!Number.isFinite(inputUnitPrice)) {
      throw new Error(`Invalid unitPrice for articleNumber=${row.articleNumber}`);
    }

    const vatRate = getArticleVatRate(article);

    const unitPriceForSpiris =
      customerType === "b2b"
        ? convertInclusiveToExclusive(inputUnitPrice, vatRate)
        : inputUnitPrice;

    invoiceRows.push({
      ArticleId: article.spirisArticleId,
      Text: row.text || article.name,
      Quantity: row.quantity,
      UnitPrice: unitPriceForSpiris
    });
  }

  const payload = {
    CustomerId: customer.Id,
    InvoiceDate: toIsoDate(invoiceDate),
    IncludesVat: true,
    Rows: invoiceRows
  };

  const invoice = await spirisService.createInvoice(accessToken, payload);

  const paymentPayload = {
    PaymentDate: toIsoDate(invoiceDate),
    PaymentAmount: Number(invoice.TotalAmount),
    PaymentAmountInvoiceCurrency: Number(invoice.TotalAmountInvoiceCurrency || invoice.TotalAmount),
    PaymentCurrency: invoice.CurrencyCode || "SEK",
    PaymentType: 2,
    CompanyBankAccountId: "7f504150-cea2-401d-8553-da9391b9b1f7"
  };

  const payment = await spirisService.createInvoicePayment(
    accessToken,
    invoice.Id,
    paymentPayload
  );

  return {
    customer,
    payload,
    invoice,
    payment
  };
}

module.exports = {
  createInvoiceDraftFromSimpleInput,
  createInvoiceFromSimpleInput,
  createInvoiceFromPlatformPayload
};