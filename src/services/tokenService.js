const axios = require("axios");

async function getAccessTokenForLocation(locationId) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const response = await axios.get(
    `https://integrations.fellow.se/spiris/token?locationId=${encodeURIComponent(locationId)}`
  );

  if (!response.data?.access_token) {
    throw new Error("No access token returned");
  }

  return response.data.access_token;
}

module.exports = {
  getAccessTokenForLocation
};