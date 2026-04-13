const LOCATION_ID = "FZK53zttFssaKFsCr9jl";

const FIELD_IDS = {
  lastAbandonedCheckoutDate: "zJ3ehF3uZCCqwuZaANWy",
  abandonedCheckoutProducts: "RxP378ELmyCXkMtYplm6",
  abandonedCheckoutValue: "2UZpUtepsMIAHSkH4phH"
};

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

function buildProductsText(lineItems) {
  const counts = {};

  for (const li of lineItems || []) {
    const name = String(li?.title || li?.name || li?.sku || "").trim();
    if (!name) continue;
    const qty = safeNumber(li?.quantity || 1);
    counts[name] = (counts[name] || 0) + qty;
  }

  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0], "sv"))
    .map(([name, qty]) => `${name}: ${qty}`)
    .join("\n");
}

async function upsertContactByEmail(email) {
  const res = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GHL_SUBACCOUNT_PIT}`,
      Version: "2021-07-28",
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
    throw new Error("No contact id returned from HighLevel upsert");
  }

  return contactId;
}

async function updateAbandonedCheckoutInHL(payload) {
  const email = String(payload?.email || "").trim().toLowerCase();
  if (!email) {
    return null;
  }

  const contactId = await upsertContactByEmail(email);

  const lastAbandonedCheckoutDate = toDateOnly(payload?.updated_at || payload?.created_at || "");
  const abandonedCheckoutProducts = buildProductsText(payload?.line_items || []);
  const abandonedCheckoutValue = String(
    round2(
      payload?.total_price != null
        ? payload.total_price
        : payload?.subtotal_price != null
          ? payload.subtotal_price
          : 0
    )
  );

  const customFields = [
    {
      id: FIELD_IDS.lastAbandonedCheckoutDate,
      field_value: lastAbandonedCheckoutDate
    },
    {
      id: FIELD_IDS.abandonedCheckoutProducts,
      field_value: abandonedCheckoutProducts
    },
    {
      id: FIELD_IDS.abandonedCheckoutValue,
      field_value: abandonedCheckoutValue
    }
  ];

  const updateRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GHL_SUBACCOUNT_PIT}`,
      Version: "2021-07-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tags: ["abandoned_checkout"],
      customFields
    })
  });

  const updateData = await updateRes.json();

  if (!updateRes.ok) {
    throw new Error(`HighLevel update HTTP ${updateRes.status}: ${JSON.stringify(updateData)}`);
  }

  return updateData;
}

module.exports = {
  updateAbandonedCheckoutInHL
};