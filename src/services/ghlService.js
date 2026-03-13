const axios = require("axios");
const env = require("../config/env");

function getHeaders() {
  if (!env.ghlSubaccountPit) {
    throw new Error("GHL_SUBACCOUNT_PIT is not configured");
  }

  return {
    Authorization: `Bearer ${env.ghlSubaccountPit}`,
    Version: env.ghlApiVersion,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}

function assertLocationIsConfigured(locationId) {
  if (!env.ghlWritebackLocationId) {
    throw new Error("GHL_WRITEBACK_LOCATION_ID is not configured");
  }

  if (locationId !== env.ghlWritebackLocationId) {
    throw new Error(
      `GHL writeback is only configured for locationId=${env.ghlWritebackLocationId}, received=${locationId}`
    );
  }
}

async function getCustomFields(locationId, model = "opportunity") {
  assertLocationIsConfigured(locationId);

  const response = await axios.get(
    `${env.ghlApiBase}/locations/${locationId}/customFields`,
    {
      headers: getHeaders(),
      params: {
        model
      }
    }
  );

  return response.data;
}

async function updateOpportunityWithSpirisDraftId({
  locationId,
  opportunityId,
  spirisDraftId
}) {
  assertLocationIsConfigured(locationId);

  if (!opportunityId) {
    throw new Error("opportunityId is required");
  }

  if (!spirisDraftId) {
    throw new Error("spirisDraftId is required");
  }

  if (!env.ghlSpirisDraftFieldKey) {
    throw new Error("GHL_SPIRIS_DRAFT_FIELD_KEY is not configured");
  }

  const payload = {
    customFields: [
      {
        key: env.ghlSpirisDraftFieldKey,
        fieldValue: spirisDraftId
      }
    ]
  };

  const response = await axios.put(
    `${env.ghlApiBase}/opportunities/${opportunityId}`,
    payload,
    {
      headers: getHeaders()
    }
  );

  return {
    request: payload,
    response: response.data
  };
}

module.exports = {
  getCustomFields,
  updateOpportunityWithSpirisDraftId
};