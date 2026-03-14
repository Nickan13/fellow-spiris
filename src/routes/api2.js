const express = require("express");
const axios = require("axios");
const router = express.Router();

const env = require("../config/env");
const platformAppTokenRepo = require("../db/repositories/platformAppTokenRepo");
const integrationSettingsRepo = require("../db/repositories/integrationSettingsRepo");
const spirisCustomerMappingRepo = require("../db/repositories/spirisCustomerMappingRepo");
const invoiceJobRepo = require("../db/repositories/invoiceJobRepo");
const tokenService = require("../services/tokenService");
const fellowProductMappingRepo = require("../db/repositories/fellowProductMappingRepo");
const spirisInvoiceMappingRepo = require("../db/repositories/spirisInvoiceMappingRepo");

router.get("/oauth/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "Missing authorization code"
      });
    }

    if (!env.platformAppClientId) {
      return res.status(500).json({
        ok: false,
        error: "PLATFORM_APP_CLIENT_ID is not configured"
      });
    }

    if (!env.platformAppClientSecret) {
      return res.status(500).json({
        ok: false,
        error: "PLATFORM_APP_CLIENT_SECRET is not configured"
      });
    }

    if (!env.platformAppRedirectUri) {
      return res.status(500).json({
        ok: false,
        error: "PLATFORM_APP_REDIRECT_URI is not configured"
      });
    }

    const params = new URLSearchParams();
    params.append("client_id", env.platformAppClientId);
    params.append("client_secret", env.platformAppClientSecret);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("user_type", "Location");
    params.append("redirect_uri", env.platformAppRedirectUri);

    const tokenResponse = await axios.post(
      `${env.platformAppTokenBase}/oauth/token`,
      params.toString(),
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const tokens = tokenResponse.data;

    const locationId =
      tokens.locationId ||
      tokens.location_id ||
      tokens.companyId ||
      tokens.company_id ||
      tokens.userId ||
      tokens.user_id ||
      null;

    if (!locationId) {
      return res.status(500).json({
        ok: false,
        error: "Token response did not include a location identifier",
        tokenKeys: Object.keys(tokens || {})
      });
    }

    const expiresAt =
      tokens.expires_in
        ? new Date(Date.now() + (Number(tokens.expires_in) * 1000)).toISOString()
        : null;

    await platformAppTokenRepo.saveToken({
      locationId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt,
      raw: tokens
    });

    return res.json({
      ok: true,
      message: "App installed and token saved",
      locationId
    });
  } catch (err) {
    console.error("api2 oauth callback error:", err.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: "OAuth callback failed",
      details: err.response?.data || err.message
    });
  }
});

router.get("/settings/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const settings = await integrationSettingsRepo.getByLocationId(locationId);

    return res.json({
      ok: true,
      settings: {
        locationId,
        spirisInvoiceMode: settings?.spirisInvoiceMode || "booked"
      }
    });
  } catch (err) {
    console.error("api2 get settings error:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch settings",
      details: err.message
    });
  }
});

router.post("/settings/:locationId/invoice-mode", express.json(), async (req, res) => {
  try {
    const { locationId } = req.params;
    const { spirisInvoiceMode } = req.body || {};

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    if (!spirisInvoiceMode) {
      return res.status(400).json({
        ok: false,
        error: "spirisInvoiceMode is required"
      });
    }

    if (!["draft", "booked"].includes(spirisInvoiceMode)) {
      return res.status(400).json({
        ok: false,
        error: "spirisInvoiceMode must be 'draft' or 'booked'"
      });
    }

    const settings = await integrationSettingsRepo.upsertInvoiceMode(
      locationId,
      spirisInvoiceMode
    );

    return res.json({
      ok: true,
      message: "Invoice mode saved",
      settings: {
        locationId: settings.locationId,
        spirisInvoiceMode: settings.spirisInvoiceMode,
        updatedAt: settings.updatedAt
      }
    });
  } catch (err) {
    console.error("api2 save invoice mode error:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to save invoice mode",
      details: err.message
    });
  }
});

router.get("/integration/status/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    // 1. Check if Marketplace app token exists
    const token = await platformAppTokenRepo.getTokenByLocationId(locationId);

    const appInstalled = !!token;

    // 2. Read integration settings
    const settings = await integrationSettingsRepo.getByLocationId(locationId);

    const spirisInvoiceMode = settings?.spirisInvoiceMode || "booked";

    const customerMappingsCount =
      await spirisCustomerMappingRepo.countByLocationId(locationId);

    const retryJobsCount =
      await invoiceJobRepo.countRetryJobsByLocationId(locationId);

    const failedJobsCount =
      await invoiceJobRepo.countFailedJobsByLocationId(locationId);

    const productMappingsCount =
      await fellowProductMappingRepo.countByLocationId(locationId);

    const invoiceMappingsCount =
      await spirisInvoiceMappingRepo.countByLocationId(locationId);

    let spirisConnected = false;

      try {
        await tokenService.getAccessTokenForLocation(locationId);
        spirisConnected = true;
      } catch (err) {
        spirisConnected = false;
      }

    return res.json({
      ok: true,
      status: {
        locationId,
        appInstalled,
        spirisConnected,
        spirisInvoiceMode,
        customerMappingsCount,
        productMappingsCount,
        invoiceMappingsCount,
        retryJobsCount,
        failedJobsCount
      }
    });

  } catch (err) {
    console.error("integration status error:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch integration status",
      details: err.message
    });
  }
});

router.get("/integration/connect-spiris/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const redirectUrl =
      "https://integrations.fellow.se/oauth/spiris/start?locationId=" +
      encodeURIComponent(locationId);

    return res.redirect(redirectUrl);

  } catch (err) {
    console.error("connect spiris error:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to start Spiris connection",
      details: err.message
    });
  }
});

router.get("/app/spiris", async (req, res) => {
  const { locationId } = req.query;

  if (!locationId) {
    return res.status(400).send("Missing locationId");
  }

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Spiris Integration</title>

<style>
body {
  font-family: Inter, sans-serif;
  padding: 30px;
}

.card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 20px;
  max-width: 600px;
}

h2 {
  margin-top: 0;
}

.status {
  margin: 10px 0;
}

button {
  padding: 10px 16px;
  font-size: 14px;
  border-radius: 6px;
  border: none;
  background: #4CAF50;
  color: white;
  cursor: pointer;
}

button.secondary {
  background: #1976d2;
}

</style>
</head>

<body>

<div class="card">

<h2>Spiris Integration</h2>

<div id="status">Loading integration status...</div>

<br/>

<button id="connectBtn">Connect Spiris</button>

</div>

<script>

const params = new URLSearchParams(window.location.search);
const locationId = params.get("locationId");

async function loadStatus() {

  const res = await fetch("/api2/integration/status/" + locationId);
  const data = await res.json();

  const s = data.status;

  document.getElementById("status").innerHTML = \`
    <div class="status"><b>App installed:</b> \${s.appInstalled}</div>
    <div class="status"><b>Spiris connected:</b> \${s.spirisConnected}</div>
    <div class="status"><b>Invoice mode:</b> \${s.spirisInvoiceMode}</div>
    <div class="status"><b>Customer mappings:</b> \${s.customerMappingsCount}</div>
    <div class="status"><b>Product mappings:</b> \${s.productMappingsCount}</div>
    <div class="status"><b>Invoices sent:</b> \${s.invoiceMappingsCount}</div>
    <div class="status"><b>Retry jobs:</b> \${s.retryJobsCount}</div>
    <div class="status"><b>Failed jobs:</b> \${s.failedJobsCount}</div>
  \`;
}

document.getElementById("connectBtn").onclick = function() {
  window.location.href =
    "/api2/integration/connect-spiris/" + locationId;
};

loadStatus();

</script>

</body>
</html>
`);
});

module.exports = router;