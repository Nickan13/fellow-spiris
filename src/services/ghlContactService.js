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

async function createContact(locationId, input) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const payload = {
    locationId,
    firstName: input.firstName || "",
    lastName: input.lastName || "",
    name: input.name || "",
    email: input.email || "",
    phone: input.phone || "",
    address1: input.address1 || "",
    city: input.city || "",
    postalCode: input.postalCode || "",
    country: input.country || "SE",
    companyName: input.companyName || ""
  };

  const response = await axios.post(
    `${env.ghlApiBase}/contacts/`,
    payload,
    {
      headers
    }
  );

  return {
    request: payload,
    response: response.data,
    contact: response.data?.contact || response.data || null
  };
}

module.exports = {
  getHeadersForLocation,
  findContactByEmail,
  createContact
};