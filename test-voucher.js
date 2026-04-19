require("dotenv").config();
const axios = require("axios");
const tokenService = require("./src/services/tokenService");

const LOCATION_ID = "FZK53zttFssaKFsCr9jl";
const env = require("./src/config/env");
const SPIRIS_API = env.spirisApiBase;

async function main() {
  const token = await tokenService.getAccessTokenForLocation(LOCATION_ID);
  console.log("Got token OK");

  // Hämta ett befintligt voucher för att se strukturen
  const res = await axios.get(`${SPIRIS_API}/v2/vouchers?$top=1`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  console.log(JSON.stringify(res.data, null, 2));
}

main().catch(console.error);