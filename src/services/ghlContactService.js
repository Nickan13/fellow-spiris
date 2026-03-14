const axios = require("axios");
const env = require("../config/env");
const platformAppTokenRepo = require("../db/repositories/platformAppTokenRepo");

async function getHeadersForLocation(locationId) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const token = await platformAppTokenRepo.getTokenByLocationId(locationId);

  if (!token?.accessToken) {
    throw new Error(`No app token found for locationId=${locationId}`);
  }

  return {
    Authorization: `Bearer ${token.accessToken}`,
    Version: env.ghlApiVersion,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}

async function findContactByEmail(locationId, email) {
  if (!email) {
    return null;
  }

  const headers = await getHeadersForLocation(locationId);

  const response = await axios.get(
    `${env.ghlApiBase}/contacts/search`,
    {
      headers,
      params: {
        locationId,
        query: email
      }
    }
  );

  const contacts = response.data?.contacts || [];

  if (!contacts.length) {
    return null;
  }

  return contacts[0];
}

module.exports = {
  getHeadersForLocation,
  findContactByEmail
};