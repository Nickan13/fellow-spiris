const shopifyPayoutService = require("./shopifyPayoutService");
const shopifyPayoutRepo = require("../db/repositories/shopifyPayoutRepo");
const shopifyOrderRepo = require("../db/repositories/shopifyOrderRepo");
const tokenService = require("./tokenService");

const LOCATION_ID = "FZK53zttFssaKFsCr9jl";

async function fetchAndStorePendingPayouts() {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_PAYOUTS_TOKEN;

  if (!shopDomain || !accessToken) {
    console.error("[PAYOUT WORKER] Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_PAYOUTS_TOKEN");
    return;
  }

  console.log("[PAYOUT WORKER] fetching payouts from Shopify...");

  const payouts = await shopifyPayoutService.getPayouts({ shopDomain, accessToken });

  console.log(`[PAYOUT WORKER] found ${payouts.length} paid payouts`);

  for (const payout of payouts) {
    const existing = await shopifyPayoutRepo.getPayoutByShopifyId(LOCATION_ID, payout.id);

    if (existing) {
      continue;
    }

    await shopifyPayoutRepo.createPayout({
      locationId: LOCATION_ID,
      shopifyPayoutId: payout.id,
      status: payout.status,
      payoutDate: payout.date,
      currency: payout.currency,
      amount: parseFloat(payout.amount),
      chargesGross: parseFloat(payout.summary?.charges_gross_amount || 0),
      chargesFee: parseFloat(payout.summary?.charges_fee_amount || 0),
      refundsGross: parseFloat(payout.summary?.refunds_gross_amount || 0)
    });

    console.log(`[PAYOUT WORKER] stored new payout: ${payout.id} date=${payout.date} amount=${payout.amount}`);
  }
}

async function processPayoutAccounting() {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_PAYOUTS_TOKEN;

  const pendingPayouts = await shopifyPayoutRepo.getPendingPayouts(LOCATION_ID);

  if (pendingPayouts.length === 0) {
    return;
  }

  console.log(`[PAYOUT WORKER] processing ${pendingPayouts.length} pending payouts...`);

  for (const payout of pendingPayouts) {
    try {
      console.log(`[PAYOUT WORKER] processing payout: ${payout.shopify_payout_id} date=${payout.payout_date}`);

      const transactions = await shopifyPayoutService.getPayoutTransactions({
        shopDomain,
        accessToken,
        payoutId: payout.shopify_payout_id
      });

      const charges = transactions.filter(t => t.type === "charge");
      const refunds = transactions.filter(t => t.type === "refund");

      console.log(`[PAYOUT WORKER] payout ${payout.shopify_payout_id}: ${charges.length} charges, ${refunds.length} refunds`);

      let totalFees = 0;

      for (const charge of charges) {
        const shopifyOrderId = String(charge.source_order_id);
        const fee = parseFloat(charge.fee || 0);
        const amount = parseFloat(charge.amount || 0);

        totalFees += fee;

        const orderMapping = await shopifyOrderRepo.getOrderMapping(LOCATION_ID, shopifyOrderId);

        if (orderMapping?.spiris_invoice_id) {
          console.log(`[PAYOUT WORKER] order ${shopifyOrderId} → spiris invoice ${orderMapping.spiris_invoice_id}, amount=${amount}, fee=${fee}`);
        } else {
          console.log(`[PAYOUT WORKER] order ${shopifyOrderId} → no spiris invoice found, amount=${amount}, fee=${fee}`);
        }
      }

      console.log(`[PAYOUT WORKER] payout ${payout.shopify_payout_id} total net=${payout.amount}, fees=${totalFees}`);

      await shopifyPayoutRepo.markAccountingDone(LOCATION_ID, payout.shopify_payout_id);

      console.log(`[PAYOUT WORKER] payout ${payout.shopify_payout_id} marked done`);

    } catch (err) {
      console.error(`[PAYOUT WORKER] error processing payout ${payout.shopify_payout_id}:`, err.message);
      await shopifyPayoutRepo.markAccountingFailed(LOCATION_ID, payout.shopify_payout_id, err.message);
    }
  }
}

async function runPayoutWorker() {
  try {
    await fetchAndStorePendingPayouts();
    await processPayoutAccounting();
  } catch (err) {
    console.error("[PAYOUT WORKER] error:", err.message);
  }
}

let intervalHandle = null;

function startPayoutWorker() {
  if (intervalHandle) {
    return;
  }

  const INTERVAL_MS = 24 * 60 * 60 * 1000;

  runPayoutWorker();

  intervalHandle = setInterval(() => {
    runPayoutWorker();
  }, INTERVAL_MS);

  console.log("[PAYOUT WORKER] started (interval 24h)");
}

module.exports = {
  startPayoutWorker,
  runPayoutWorker
};