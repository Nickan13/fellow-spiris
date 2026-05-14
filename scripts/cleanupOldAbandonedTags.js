require("dotenv").config();

const LOCATION_ID = "FZK53zttFssaKFsCr9jl";
const API_BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

const FIELD_IDS = {
  lastOrderDate: "0ATfuZUTlTpO51mneYcR",
  lastAbandonedCheckout: "zJ3ehF3uZCCqwuZaANWy",
  orderAfterAbandoned: "Il2vyrq0FRA24Jf0KnDP"
};

const TAGS_TO_REMOVE = ["Övergiven kundkorg", "abandoned_checkout"];

function getHeaders() {
  const token = process.env.GHL_SUBACCOUNT_PIT;
  if (!token) {
    throw new Error("GHL_SUBACCOUNT_PIT missing");
  }

  return {
    Authorization: `Bearer ${token}`,
    Version: API_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

function toDateOnly(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.includes("T") ? s.split("T")[0] : s;
}

function getCustomFieldValue(contact, fieldId) {
  const match = Array.isArray(contact?.customFields)
    ? contact.customFields.find((f) => String(f.id) === String(fieldId))
    : null;

  return String(match?.value || "").trim();
}

function shouldRemoveAbandonedTag(contact) {
  const lastOrderDate = toDateOnly(getCustomFieldValue(contact, FIELD_IDS.lastOrderDate));
  const lastAbandoned = toDateOnly(getCustomFieldValue(contact, FIELD_IDS.lastAbandonedCheckout));

  if (!lastOrderDate || !lastAbandoned) {
    return false;
  }

  return new Date(lastOrderDate) > new Date(lastAbandoned);
}

async function searchContacts(page = 1, pageLimit = 100) {
  const url = `${API_BASE}/contacts/search`;

  const body = {
    locationId: LOCATION_ID,
    page,
    pageLimit
  };

  const res = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Search contacts HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function updateContact(contactId, payload) {
  const res = await fetch(`${API_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Update contact HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function removeTag(contactId, tag) {
  const res = await fetch(`${API_BASE}/contacts/${contactId}/tags`, {
    method: "DELETE",
    headers: getHeaders(),
    body: JSON.stringify({ tags: [tag] })
  });

  if (res.status === 204) {
    return true;
  }

  let data = {};
  try {
    data = await res.json();
  } catch (_) {}

  if (!res.ok) {
    throw new Error(`Remove tag HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  return true;
}

async function run() {
  let page = 1;
  let totalSeen = 0;
  let candidates = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  while (true) {
    const data = await searchContacts(page, 100);
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];

    if (contacts.length === 0) {
      break;
    }

    for (const contact of contacts) {
      totalSeen += 1;

      const tags = Array.isArray(contact.tags) ? contact.tags : [];
      const hasAbandonedTag = tags.includes("Övergiven kundkorg") || tags.includes("abandoned_checkout");

      if (!hasAbandonedTag) {
        skipped += 1;
        continue;
      }

      if (!shouldRemoveAbandonedTag(contact)) {
        skipped += 1;
        continue;
      }

      candidates += 1;

      try {
        await updateContact(contact.id, {
          customFields: [
            {
              id: FIELD_IDS.orderAfterAbandoned,
              field_value: "yes"
            }
          ]
        });

        for (const tag of TAGS_TO_REMOVE) {
          if (tags.includes(tag)) {
            await removeTag(contact.id, tag);
          }
        }

        updated += 1;
        console.log(`[UPDATED] ${contact.email || contact.id}`);
      } catch (err) {
        failed += 1;
        console.error(`[FAILED] ${contact.email || contact.id}: ${err.message}`);
      }
    }

    page += 1;
  }

  console.log("DONE");
  console.log(
    JSON.stringify(
      {
        totalSeen,
        candidates,
        updated,
        skipped,
        failed
      },
      null,
      2
    )
  );
}

run().catch((err) => {
  console.error("CLEANUP FAILED:", err);
  process.exit(1);
});