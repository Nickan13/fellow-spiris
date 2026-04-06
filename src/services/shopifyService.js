const SHOPIFY_API_VERSION = "2026-01";

async function getOrderById({ shopDomain, accessToken, orderId }) {
  if (!shopDomain) {
    throw new Error("shopDomain is required");
  }

  if (!accessToken) {
    throw new Error("accessToken is required");
  }

  if (!orderId) {
    throw new Error("orderId is required");
  }

  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}.json`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  return data.order;
}

module.exports = {
  getOrderById
};