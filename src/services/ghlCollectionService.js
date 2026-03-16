const axios = require("axios");
const env = require("../config/env");
const platformAppTokenRepo = require("../db/repositories/platformAppTokenRepo");

async function getHeadersForLocation(locationId) {
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

async function listCollections(locationId) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const response = await axios.get(
    `${env.ghlApiBase}/products/collections`,
    {
      headers,
      params: {
        locationId
      }
    }
  );

  return response.data;
}

async function createCollection(locationId, name) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!name) {
    throw new Error("name is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const payload = {
    locationId,
    name
  };

  const response = await axios.post(
    `${env.ghlApiBase}/products/collections`,
    payload,
    {
      headers
    }
  );

  return response.data;
}

async function assignProductToCollections(locationId, productId, collectionIds) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!productId) {
    throw new Error("productId is required");
  }

  if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
    throw new Error("collectionIds must be a non-empty array");
  }

  const headers = await getHeadersForLocation(locationId);

  const payload = {
    locationId,
    products: [
      {
        _id: productId,
        collectionIds
      }
    ]
  };

  const response = await axios.post(
    `${env.ghlApiBase}/products/bulk-update`,
    payload,
    {
      headers
    }
  );

  return response.data;
}

module.exports = {
  listCollections,
  createCollection,
  assignProductToCollections
};