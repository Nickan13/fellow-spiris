const env = require("../config/env");

const LOCATION_ID = "FZK53zttFssaKFsCr9jl";

const FIELD_IDS = {
  shopifyCustomerId: "sRJdedIoBvTeyYOIpWKw",
  shopifyOrderNr: "lEAIIqBE2LbOTH4UEZSn",
  firstOrderDate: "RNL7HV9TrgYXnNU2mPeP",
  shopifyTotalSpent: "2rKaKR6H7tilHUEJp214",
  aov: "NgVM7mkDsEiG5iehXDdU",
  daysSinceLastOrder: "HvLfwHrbltavhh3Xhi81",
  productsLastOrder: "eoL4ZsJRAe7Unhz3ERhH",
  productsEverBought: "8kQOyAlz2laddKhpVkk6",
  productsCountersJson: "QC9H3xzSTChFHZR8eSQC",
  lastRefundDate: "Wj07iVHttsRnt39ESShP",
  lastRefundValue: "3jdra4afUTk31iAPc3Ds",
  lastOrderChannel: "3IHnO8seITCwrTXWb6ES",
  shopifyStore: "Bd5XxKcPG4eMwBBB2pjr",
  averageDaysBetweenOrders: "Ec6PMVbXVct5XXuAJcSL",
  nextExpectedOrderDate: "LA1Bzs0SFYSwNXrOxUhW",
  preferredProducts: "yYgGRbw9OPXRqt8awcTT",
  shopifyOrdersCount: "Ch5agbbY5JlTkApoYcPE",
  lastOrderDate: "0ATfuZUTlTpO51mneYcR",
  lastOrderValue: "ghjgPnDN7NjqMjqJ47SB",
  orderAfterAbandoned: "Il2vyrq0FRA24Jf0KnDP",
  lastAbandonedCheckout: "zJ3ehF3uZCCqwuZaANWy"
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function toDateOnly(value) {
  if (!value) return "";
  const s = String(value);
  return s.includes("T") ? s.split("T")[0] : s;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
}

function diffDays(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return null;
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((to - from) / msPerDay);
}

function uniqStrings(values) {
  return [...new Set(
    (values || [])
      .map((v) => String(v || "").trim())
      .filter(Boolean)
  )];
}

function getLineItemProductName(li) {
  return String(li?.title || li?.name || li?.sku || "").trim();
}

function buildCustomerMetricsFromOrders(orders) {
  const validOrders = (orders || [])
    .filter((o) => o && o.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (validOrders.length === 0) {
    return null;
  }

  const firstOrder = validOrders[0];
  const lastOrder = validOrders[validOrders.length - 1];

  const orderCount = validOrders.length;

  const totalSpend = round2(
    validOrders.reduce((sum, order) => sum + safeNumber(order.total_price), 0)
  );

  const aov = orderCount > 0 ? round2(totalSpend / orderCount) : 0;

  const firstOrderDate = toDateOnly(firstOrder.created_at);
  const lastOrderDate = toDateOnly(lastOrder.created_at);

  const today = new Date();
  const daysSinceLastOrder = diffDays(lastOrderDate, today);

  let averageDaysBetweenOrders = null;
  let nextExpectedOrderDate = "";

  if (orderCount >= 2) {
    const spanDays = diffDays(firstOrderDate, lastOrderDate);
    if (spanDays != null) {
      averageDaysBetweenOrders = round2(spanDays / (orderCount - 1));

      const nextDate = new Date(lastOrderDate);
      nextDate.setDate(nextDate.getDate() + Math.round(averageDaysBetweenOrders));
      nextExpectedOrderDate = nextDate.toISOString().split("T")[0];
    }
  }

  const lastOrderProducts = uniqStrings(
    (lastOrder.line_items || []).map(getLineItemProductName)
  );

  const allProducts = [];
  const counters = {};

  for (const order of validOrders) {
    for (const li of order.line_items || []) {
      const name = getLineItemProductName(li);
      if (!name) continue;

      allProducts.push(name);

      const qty = safeNumber(li.quantity || 1);
      counters[name] = (counters[name] || 0) + qty;
    }
  }

  const productsEverBought = uniqStrings(allProducts);

  const preferredProducts = Object.entries(counters)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  let lastRefundDate = "";
  let lastRefundValue = 0;

  for (const order of validOrders) {
    for (const refund of order.refunds || []) {
      const refundDate = toDateOnly(refund.created_at);
      const refundValue = round2(
        (refund.refund_line_items || []).reduce((sum, item) => {
          const subtotal = item?.subtotal ?? item?.line_item?.price ?? 0;
          return sum + safeNumber(subtotal);
        }, 0)
      );

      if (!lastRefundDate || refundDate > lastRefundDate) {
        lastRefundDate = refundDate;
        lastRefundValue = refundValue;
      }
    }
  }

  return {
    email: normalizeEmail(lastOrder.email || lastOrder.customer?.email || ""),
    shopifyCustomerId: String(lastOrder.customer?.id || ""),
    shopifyOrderNr: String(lastOrder.order_number || lastOrder.name || ""),
    firstOrderDate,
    ltvTotalSpend: totalSpend,
    aov,
    daysSinceLastOrder: daysSinceLastOrder ?? "",
    productsLastOrder: lastOrderProducts.join(", "),
    productsEverBought: productsEverBought.join(", "),
    productsCountersJson: Object.entries(counters)
      .sort((a, b) => a[0].localeCompare(b[0], "sv"))
      .map(([name, qty]) => `${name}: ${qty}`)
      .join("\n"),
    lastRefundDate,
    lastRefundValue: lastRefundDate ? lastRefundValue : "",
    lastOrderChannel: String(lastOrder.source_name || ""),
    shopifyStore: "Sjöbergs Goda",
    averageDaysBetweenOrders: averageDaysBetweenOrders ?? "",
    nextExpectedOrderDate,
    preferredProducts: preferredProducts.join(", "),
    lastOrderValue: round2(safeNumber(lastOrder.total_price)),
    shopifyOrdersCount: orderCount,
    lastOrderDate
  };
}

async function upsertContactByEmail(email) {
  const res = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ghlSubaccountPit}`,
      Version: env.ghlApiVersion || "2021-07-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      locationId: LOCATION_ID,
      email
    })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`HighLevel upsert HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  const contactId = data?.contact?.id;
  if (!contactId) {
    throw new Error("No contact.id returned from contacts/upsert");
  }

  return contactId;
}

async function updateCustomerMetricsInHL(metrics) {
  if (!metrics?.email) {
    throw new Error("metrics.email is required");
  }

  const contactId = await upsertContactByEmail(metrics.email);

  let orderAfterAbandoned = "no";

  const lastOrderDate = metrics.lastOrderDate; // denna finns i din metrics
  const lastAbandoned = existingContact?.customFields?.find(
    f => f.id === FIELD_IDS.lastAbandonedCheckout
  )?.value;

  if (lastOrderDate && lastAbandoned) {
    if (new Date(lastOrderDate) > new Date(lastAbandoned)) {
      orderAfterAbandoned = "yes";
    }
  }

  const payload = {
    customFields: [
      { id: FIELD_IDS.shopifyCustomerId, field_value: metrics.shopifyCustomerId },
      { id: FIELD_IDS.shopifyOrderNr, field_value: metrics.shopifyOrderNr },
      { id: FIELD_IDS.firstOrderDate, field_value: metrics.firstOrderDate },
      { id: FIELD_IDS.shopifyTotalSpent, field_value: String(metrics.ltvTotalSpend) },
      { id: FIELD_IDS.aov, field_value: String(metrics.aov) },
      { id: FIELD_IDS.daysSinceLastOrder, field_value: String(metrics.daysSinceLastOrder) },
      { id: FIELD_IDS.productsLastOrder, field_value: metrics.productsLastOrder },
      { id: FIELD_IDS.productsEverBought, field_value: metrics.productsEverBought },
      { id: FIELD_IDS.productsCountersJson, field_value: metrics.productsCountersJson },
      { id: FIELD_IDS.lastRefundDate, field_value: metrics.lastRefundDate },
      { id: FIELD_IDS.lastRefundValue, field_value: String(metrics.lastRefundValue) },
      { id: FIELD_IDS.lastOrderChannel, field_value: metrics.lastOrderChannel },
      { id: FIELD_IDS.shopifyStore, field_value: metrics.shopifyStore },
      { id: FIELD_IDS.averageDaysBetweenOrders, field_value: String(metrics.averageDaysBetweenOrders) },
      { id: FIELD_IDS.nextExpectedOrderDate, field_value: metrics.nextExpectedOrderDate },
      { id: FIELD_IDS.preferredProducts, field_value: metrics.preferredProducts },
      { id: FIELD_IDS.lastOrderValue, field_value: String(metrics.lastOrderValue) },
      { id: FIELD_IDS.shopifyOrdersCount, field_value: String(metrics.shopifyOrdersCount) },
      { id: FIELD_IDS.lastOrderDate, field_value: metrics.lastOrderDate },
      { id: FIELD_IDS.orderAfterAbandoned, field_value: orderAfterAbandoned }
    ]
  };

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.ghlSubaccountPit}`,
      Version: env.ghlApiVersion || "2021-07-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`HighLevel contact update HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

module.exports = {
  buildCustomerMetricsFromOrders,
  updateCustomerMetricsInHL
};