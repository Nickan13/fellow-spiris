const SHOPIFY_API_VERSION = "2026-01";

function getShopDomain(shopDomain) {
  if (!shopDomain) {
    throw new Error("shopDomain is required");
  }
  return shopDomain;
}

function getAccessToken(accessToken) {
  if (!accessToken) {
    throw new Error("accessToken is required");
  }
  return accessToken;
}

async function shopifyGraphQL({ shopDomain, accessToken, query, variables = {} }) {
  const res = await fetch(
    `https://${getShopDomain(shopDomain)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": getAccessToken(accessToken)
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  if (data.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

async function getOrderById({ shopDomain, accessToken, orderId }) {
  if (!orderId) {
    throw new Error("orderId is required");
  }

  const res = await fetch(
    `https://${getShopDomain(shopDomain)}/admin/api/${SHOPIFY_API_VERSION}/orders/${orderId}.json`,
    {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": getAccessToken(accessToken),
        "Content-Type": "application/json"
      }
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.order;
}

function mapGraphQLOrderNode(node) {
  const lineItems = (node.lineItems?.edges || []).map(({ node: li }) => ({
    title: li.title || "",
    name: li.name || "",
    sku: li.sku || "",
    quantity: li.quantity || 0,
    price: li.originalUnitPriceSet?.shopMoney?.amount || "0"
  }));

  const refunds = (node.refunds || []).map((refund) => ({
    created_at: refund.createdAt || "",
    refund_line_items: (refund.refundLineItems?.edges || []).map(({ node: rli }) => ({
      subtotal: rli.subtotalSet?.shopMoney?.amount || "0",
      line_item: {
        price: rli.lineItem?.originalUnitPriceSet?.shopMoney?.amount || "0"
      }
    }))
  }));

  return {
    id: node.legacyResourceId || node.id || "",
    name: node.name || "",
    order_number: node.name || "",
    email: node.email || node.customer?.email || "",
    created_at: node.createdAt || "",
    total_price: node.currentTotalPriceSet?.shopMoney?.amount || "0",
    currency: node.currentTotalPriceSet?.shopMoney?.currencyCode || "",
    source_name: node.sourceName || "",
    customer: {
      id: node.customer?.legacyResourceId || node.customer?.id || "",
      email: node.customer?.email || ""
    },
    line_items: lineItems,
    refunds
  };
}

async function listOrdersByEmail({ shopDomain, accessToken, email }) {
  if (!email) {
    throw new Error("email is required");
  }

  const normalizedEmail = String(email).trim();
  const allOrders = [];
  let hasNextPage = true;
  let after = null;

  const query = `
    query GetOrdersByEmail($first: Int!, $after: String, $query: String!) {
      orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: false) {
        edges {
          cursor
          node {
            id
            legacyResourceId
            name
            email
            createdAt
            sourceName
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              id
              legacyResourceId
              email
            }
            lineItems(first: 100) {
              edges {
                node {
                  title
                  name
                  sku
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                    }
                  }
                }
              }
            }
            refunds {
              createdAt
              refundLineItems(first: 100) {
                edges {
                  node {
                    subtotalSet {
                      shopMoney {
                        amount
                      }
                    }
                    lineItem {
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  while (hasNextPage) {
    const data = await shopifyGraphQL({
      shopDomain,
      accessToken,
      query,
      variables: {
        first: 50,
        after,
        query: `email:"${normalizedEmail}"`
      }
    });

    const connection = data?.orders;
    const edges = connection?.edges || [];

    for (const edge of edges) {
      allOrders.push(mapGraphQLOrderNode(edge.node));
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return allOrders;
}

module.exports = {
  getOrderById,
  listOrdersByEmail
};