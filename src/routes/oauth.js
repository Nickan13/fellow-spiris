const express = require("express");
const axios = require("axios");
const router = express.Router();

const env = require("../config/env");
const tokenRepo = require("../db/repositories/tokenRepo");
const cryptoUtil = require("../utils/crypto");

/*
 START OAUTH
*/
router.get("/spiris/start", (req, res) => {
  const locationId = req.query.locationId;

  if (!locationId) {
    return res.status(400).json({
      error: "locationId required"
    });
  }

  const scope = "offline_access ea:api ea:sales ea:accounting";
  const prompt = "select_account";
  const acrValues = "service:44643EB1-3F76-4C1C-A672-402AE8085934";

  const authUrl =
    `${env.spirisAuthBase}/connect/authorize` +
    `?client_id=${encodeURIComponent(env.spirisClientId)}` +
    `&redirect_uri=${encodeURIComponent(env.spirisRedirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(locationId)}` +
    `&response_type=code` +
    `&prompt=${encodeURIComponent(prompt)}` +
    `&acr_values=${encodeURIComponent(acrValues)}`;

  return res.redirect(authUrl);
});

/*
 OAUTH CALLBACK
*/
router.get("/spiris/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const locationId = req.query.state;

    if (!code) {
      return res.status(400).json({
        error: "Missing authorization code"
      });
    }

    if (!locationId) {
      return res.status(400).json({
        error: "Missing state/locationId"
      });
    }

    const basicAuth = Buffer
      .from(`${env.spirisClientId}:${env.spirisClientSecret}`)
      .toString("base64");

    const tokenResponse = await axios.post(
      `${env.spirisAuthBase}/connect/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: env.spirisRedirectUri
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "Authorization": `Basic ${basicAuth}`
        }
      }
    );

    const tokens = tokenResponse.data;

    const encryptedAccess = cryptoUtil.encrypt(tokens.access_token);
    const encryptedRefresh = cryptoUtil.encrypt(tokens.refresh_token);

    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();

    await tokenRepo.saveTokens(
      locationId,
      encryptedAccess,
      encryptedRefresh,
      expiresAt
    );

    return res.json({
      success: true,
      locationId,
      message: "Spiris sandbox connected and tokens saved"
    });

  } catch (error) {
    console.error("OAuth callback error:", error.response?.data || error.message);

    return res.status(500).json({
      error: "OAuth failed",
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;