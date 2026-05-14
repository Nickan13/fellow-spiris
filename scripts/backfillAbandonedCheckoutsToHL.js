require("dotenv").config();

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOP_TOKEN = process.env.SHOPIFY_TOKEN;

const shopifyAbandonedCheckoutService = require("../src/services/shopifyAbandonedCheckoutService");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOP_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${JSON.stringify(data)}`);
  }

  if (data.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

async function listAllAbandonedCheckouts() {
  const results = [];
  let hasNextPage = true;
  let after = null;

  const query = `
    query GetAbandonedCheckouts($first: Int!, $after: String) {
      abandonedCheckouts(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            completedAt
            createdAt
            updatedAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            subtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 100) {
              edges {
                node {
                  title
                  quantity
                  variantTitle
                }
              }
            }
            customer {
              email
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
    const data = await shopifyGraphQL(query, {
      first: 100,
      after
    });

    const connection = data?.abandonedCheckouts;
    const edges = connection?.edges || [];

    for (const edge of edges) {
      results.push(edge.node);
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return results;
}

function mapGraphQLAbandonedCheckout(node) {
  const email = String(node?.email || node?.customer?.email || "").trim().toLowerCase();

  const line_items = (node?.lineItems?.edges || []).map(({ node: li }) => ({
    title: li?.title || li?.variantTitle || "",
    quantity: li?.quantity || 0
  }));

  return {
    id: node?.id || null,
    email,
    created_at: node?.createdAt || "",
    updated_at: node?.updatedAt || "",
    completed_at: node?.completedAt || null,
    total_price:
      node?.totalPriceSet?.shopMoney?.amount != null
        ? String(node.totalPriceSet.shopMoney.amount)
        : node?.subtotalPriceSet?.shopMoney?.amount != null
          ? String(node.subtotalPriceSet.shopMoney.amount)
          : "0",
    subtotal_price:
      node?.subtotalPriceSet?.shopMoney?.amount != null
        ? String(node.subtotalPriceSet.shopMoney.amount)
        : "0",
    line_items,
    buyer_accepts_marketing: false
  };
}

async function run() {
  if (!SHOP_DOMAIN) {
    throw new Error("SHOPIFY_SHOP_DOMAIN missing");
  }

  if (!SHOP_TOKEN) {
    throw new Error("SHOPIFY_TOKEN missing");
  }

  const all = await listAllAbandonedCheckouts();

  console.log(`Abandoned checkouts fetched: ${all.length}`);

  let processed = 0;
  let skippedCompleted = 0;
  let skippedNoEmail = 0;
  let updated = 0;
  let failed = 0;

  // TESTA FÖRST PÅ 10
  for (const node of all) {
    const payload = mapGraphQLAbandonedCheckout(node);

    if (payload.completed_at) {
      skippedCompleted += 1;
      continue;
    }

    if (!payload.email) {
      skippedNoEmail += 1;
      continue;
    }

    processed += 1;

    try {
      await shopifyAbandonedCheckoutService.updateAbandonedCheckoutInHL(payload);
      updated += 1;
      console.log(`[UPDATED] ${payload.email}`);
    } catch (err) {
      failed += 1;
      console.error(`[FAILED] ${payload.email}: ${err.message}`);
    }

    await sleep(300);
  }

  console.log("DONE");
  console.log(
    JSON.stringify(
      {
        abandonedCheckoutsFetched: all.length,
        processed,
        skippedCompleted,
        skippedNoEmail,
        updated,
        failed
      },
      null,
      2
    )
  );
}

run().catch((err) => {
  console.error("BACKFILL FAILED:", err);
  process.exit(1);
});