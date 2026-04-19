const SHOPIFY_API_VERSION = "2026-01";

async function getPayouts({ shopDomain, accessToken, limit = 50 }) {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/payouts.json?limit=${limit}&status=paid`;

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify Payouts API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.payouts || [];
}

async function getPayoutTransactions({ shopDomain, accessToken, payoutId }) {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/balance/transactions.json?payout_id=${payoutId}&limit=250`;

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify Transactions API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.transactions || [];
}

module.exports = {
  getPayouts,
  getPayoutTransactions
};