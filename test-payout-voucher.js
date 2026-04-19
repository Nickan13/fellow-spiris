require("dotenv").config();
const tokenService = require("./src/services/tokenService");
const shopifyPayoutService = require("./src/services/shopifyPayoutService");
const axios = require("axios");
const env = require("./src/config/env");

const LOCATION_ID = "FZK53zttFssaKFsCr9jl";
const ACCOUNT_SHOPIFY_TRANSIT = 1941;
const ACCOUNT_BANK = 1940;
const ACCOUNT_SHOPIFY_FEES = 6044;

// Ändra detta till en payout du vill testa med
const TEST_PAYOUT_ID = "147413664086";
const TEST_PAYOUT_DATE = "2026-04-15";
const TEST_PAYOUT_AMOUNT = 1264.89;

async function main() {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const shopifyToken = process.env.SHOPIFY_PAYOUTS_TOKEN;
  const spirisToken = await tokenService.getAccessTokenForLocation(LOCATION_ID);

  console.log("Got Spiris token OK");

  // Hämta transaktioner för payout
  const transactions = await shopifyPayoutService.getPayoutTransactions({
    shopDomain,
    accessToken: shopifyToken,
    payoutId: TEST_PAYOUT_ID
  });

  const charges = transactions.filter(t => t.type === "charge");
  const refunds = transactions.filter(t => t.type === "refund");

  let totalFees = 0;
  for (const charge of charges) totalFees += parseFloat(charge.fee || 0);
  for (const refund of refunds) totalFees += parseFloat(refund.fee || 0);
  totalFees = Math.round(totalFees * 100) / 100;

  console.log(`Payout: ${TEST_PAYOUT_ID}, net: ${TEST_PAYOUT_AMOUNT}, fees: ${totalFees}`);

  const voucherRows = [];

  if (totalFees > 0) {
    voucherRows.push({ AccountNumber: ACCOUNT_SHOPIFY_FEES, DebitAmount: totalFees, CreditAmount: 0, TransactionText: `Shopify avgifter payout ${TEST_PAYOUT_ID}` });
    voucherRows.push({ AccountNumber: ACCOUNT_SHOPIFY_TRANSIT, DebitAmount: 0, CreditAmount: totalFees, TransactionText: `Shopify avgifter payout ${TEST_PAYOUT_ID}` });
  }

  voucherRows.push({ AccountNumber: ACCOUNT_BANK, DebitAmount: TEST_PAYOUT_AMOUNT, CreditAmount: 0, TransactionText: `Shopify utbetalning ${TEST_PAYOUT_DATE}` });
  voucherRows.push({ AccountNumber: ACCOUNT_SHOPIFY_TRANSIT, DebitAmount: 0, CreditAmount: TEST_PAYOUT_AMOUNT, TransactionText: `Shopify utbetalning ${TEST_PAYOUT_DATE}` });

  const payload = {
    VoucherDate: TEST_PAYOUT_DATE,
    VoucherText: `Shopify payout ${TEST_PAYOUT_ID}`,
    Rows: voucherRows
  };

  console.log("Voucher payload:", JSON.stringify(payload, null, 2));
  console.log("\n--- SKAPAR VOUCHER I SPIRIS ---");

  const response = await axios.post(
    `${env.spirisApiBase}/v2/vouchers`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${spirisToken}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    }
  );

  console.log("Voucher skapad!", JSON.stringify(response.data, null, 2));
}

main().catch(err => {
  console.error("FEL:", err.message);
  if (err.response) console.error("Spiris svar:", JSON.stringify(err.response.data));
});