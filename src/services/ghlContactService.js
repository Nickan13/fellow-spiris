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

  const response = await axios.post(
    `${env.ghlApiBase}/contacts/search`,
    {
      locationId,
      page: 1,
      pageLimit: 10,
      filters: [
        {
          field: "email",
          operator: "eq",
          value: email
        }
      ]
    },
    {
      headers
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

async function createBusiness(locationId, input) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const payload = {
    locationId,
    name: input.name || "",
    phone: input.phone || "",
    email: input.email || "",
    address: input.address1 || "",
    city: input.city || "",
    postalCode: input.postalCode || "",
    country: input.country || "SE"
  };

  const response = await axios.post(
    `${env.ghlApiBase}/businesses/`,
    payload,
    {
      headers
    }
  );

  return {
    request: payload,
    response: response.data,
    business: response.data?.business || response.data || null
  };
}

async function attachContactToBusiness(locationId, contactId, businessId) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!contactId) {
    throw new Error("contactId is required");
  }

  if (!businessId) {
    throw new Error("businessId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const payload = {
    locationId,
    contactIds: [contactId],
    businessId
  };

    try {
    const response = await axios.post(
      `${env.ghlApiBase}/contacts/bulk/business`,
      payload,
      {
        headers
      }
    );

    console.log("[attachContactToBusiness] success", {
      locationId,
      contactId,
      businessId,
      payload,
      response: response.data
    });

    return {
      request: payload,
      response: response.data
    };
  } catch (err) {
    console.error("[attachContactToBusiness] failed", {
      locationId,
      contactId,
      businessId,
      payload,
      status: err.response?.status || null,
      response: err.response?.data || null,
      message: err.message
    });

    throw err;
  }
}

module.exports = {
  getHeadersForLocation,
  findContactByEmail,
  createContact,
  createBusiness,
  attachContactToBusiness
};