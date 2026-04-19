const LOCATION_ID = process.env.GHL_LOCATION_ID;
const CUSTOMER_SINCE_FIELD_ID = process.env.GHL_FIELD_CUSTOMER_SINCE;
const MARKETING_CONSENT_FIELD_ID = "imJSOgomoDH2CQevqC0A";

if (!LOCATION_ID) {
  throw new Error("GHL_LOCATION_ID is not set");
}

if (!CUSTOMER_SINCE_FIELD_ID) {
  throw new Error("GHL_FIELD_CUSTOMER_SINCE is not set");
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function getMarketingConsentValue(customer) {
  const state = String(customer?.emailMarketingConsent?.marketingState || "").toUpperCase();
  const updatedAt = String(customer?.emailMarketingConsent?.consentUpdatedAt || "");

  if (state !== "SUBSCRIBED") {
    return "";
  }

  if (updatedAt && updatedAt.includes("T")) {
    return updatedAt.split("T")[0];
  }

  return "Ja";
}

async function upsertShopifyCustomerToFellow(customer) {
  if (!customer?.email) return null;

  const birthDate = customer?.metafield?.value || "";

  const payload = {
    locationId: LOCATION_ID,
    email: customer.email,
    firstName: customer.firstName || "",
    lastName: customer.lastName || ""
  };

  if (isDateOnly(birthDate)) {
    payload.dateOfBirth = birthDate;
  }

  const upsertRes = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GHL_SUBACCOUNT_PIT}`,
      Version: "2021-07-28",
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

    if (isDateOnly(customer.customerSince || "")) {
      customFields.push({
       id: CUSTOMER_SINCE_FIELD_ID,
        field_value: customer.customerSince
     });
    }

  const marketingConsentValue = getMarketingConsentValue(customer);

    customFields.push({
      id: MARKETING_CONSENT_FIELD_ID,
      field_value: marketingConsentValue
   });

  if (customFields.length === 0) {
    return upsertData;
  }

  const updateRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GHL_SUBACCOUNT_PIT}`,
      Version: "2021-07-28",
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

module.exports = {
  upsertShopifyCustomerToFellow
};