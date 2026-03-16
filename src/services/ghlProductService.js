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

async function listProducts(locationId) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const response = await axios.get(
    `${env.ghlApiBase}/products/`,
    {
      headers,
      params: {
        locationId
      }
    }
  );

  return response.data;
}

async function createProduct(locationId, input) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const payload = {
    locationId,
    name: input.name || "",
    description: input.description || "",
    productType: input.productType || "SERVICE",
    availableInStore: true
  };

  const response = await axios.post(
    `${env.ghlApiBase}/products/`,
    payload,
    {
      headers
    }
  );

  return {
    request: payload,
    response: response.data,
    product: response.data?.product || response.data || null
  };
}

async function createPrice(locationId, productId, input) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!productId) {
    throw new Error("productId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const payload = {
    locationId,
    name: input.name || "Standardpris",
    type: "one_time",
    currency: input.currency || "SEK",
    amount: Number(input.amount ?? "0"),
    isDigitalProduct: input.isDigitalProduct ?? true
  };

  const response = await axios.post(
    `${env.ghlApiBase}/products/${productId}/price`,
    payload,
    {
      headers
    }
  );

  return {
    request: payload,
    response: response.data,
    price: response.data?.price || response.data || null
  };
}

async function getProductById(locationId, productId) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!productId) {
    throw new Error("productId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const response = await axios.get(
    `${env.ghlApiBase}/products/${productId}`,
    {
      headers,
      params: {
        locationId
      }
    }
  );

  return response.data;
}

async function updateProduct(locationId, productId, input) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!productId) {
    throw new Error("productId is required");
  }

  const headers = await getHeadersForLocation(locationId);

  const payload = {
    locationId,
    ...input
  };

  const response = await axios.put(
    `${env.ghlApiBase}/products/${productId}`,
    payload,
    { headers }
  );

  return response.data;
}

module.exports = {
  getHeadersForLocation,
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  createPrice
};