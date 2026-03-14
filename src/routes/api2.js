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
  try {
    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).send("Missing locationId");
    }

    const appToken = await platformAppTokenRepo.getTokenByLocationId(locationId);

    if (!appToken) {
      return res.status(403).send("App is not installed for this location");
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors https://crm.fellow.se https://*.gohighlevel.com https://app.gohighlevel.com"
    );

    return res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Spiris Integration</title>

<style>
body {
  font-family: Inter, sans-serif;
  padding: 30px;
  color: #1f2937;
}

.card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 24px;
  max-width: 760px;
  background: #fff;
}

h2 {
  margin-top: 0;
  margin-bottom: 24px;
}

.section {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid #eee;
}

.section:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.section h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
}

.help-text {
  margin: 0 0 14px 0;
  color: #4b5563;
  font-size: 14px;
  line-height: 1.5;
}

.status {
  margin: 10px 0;
}

.actions-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

button {
  padding: 10px 16px;
  font-size: 14px;
  border-radius: 6px;
  border: none;
  background: #82358b;
  color: white;
  cursor: pointer;
}

button.secondary {
  background: #8597b3;
}

button.disabled {
  background: #d1d5db;
  color: #6b7280;
  cursor: not-allowed;
}

select {
  padding: 10px 12px;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: white;
}

.notice {
  margin-top: 16px;
  color: #444;
  font-size: 14px;
}

.error {
  color: #b00020;
  margin-top: 12px;
  font-size: 14px;
}
</style>
</head>

<body>

<div class="card">

  <h2>Spiris Integration</h2>

  <div id="status">Laddar integrationsstatus...</div>

  <div class="section">
    <h3>Koppla till Spiris</h3>
    <p class="help-text">
      Koppla ditt Spiris-konto till Fellow så att integrationen kan hämta kunder, synka produkter och skicka fakturor.
    </p>
    <div class="actions-row">
      <button id="connectBtn">Koppla till Spiris</button>
      <button class="secondary" id="disconnectBtn" style="display:none;">Koppla bort Spiris</button>
    </div>
    <p class="help-text" id="connectHelpText">
      När kopplingen är klar uppdateras sidan automatiskt.
    </p>
  </div>

  <div class="section">
    <h3>Importera kunder</h3>
    <p class="help-text">
      Importera kunder från Spiris till detta subaccount i Fellow. Befintliga mappingar återanvänds och nya kontakter skapas vid behov.
    </p>
    <div class="actions-row">
      <button class="secondary" id="importCustomersBtn">Importera kunder</button>
    </div>
    <p class="help-text">
      Funktionen hämtar kunder från Spiris och kopplar dem till rätt kontakter i Fellow.
    </p>
  </div>

  <div class="section">
    <h3>Fakturaläge</h3>
    <p class="help-text">
      Välj om fakturor från Fellow ska skickas till Spiris som utkast eller bokföras direkt.
    </p>
    <div class="actions-row">
      <select id="invoiceModeSelect">
        <option value="draft">utkast</option>
        <option value="booked">bokför direkt</option>
      </select>
      <button class="secondary" id="saveInvoiceModeBtn">Spara fakturaläge</button>
    </div>
    <p class="help-text">
      Ändringen gäller nya fakturor för denna location. Redan skickade fakturor påverkas inte.
    </p>
  </div>

  <div class="section">
    <h3>Produktsynk</h3>
    <p class="help-text">
      Produkter och artiklar synkas automatiskt från Spiris i bakgrunden. Du behöver normalt inte starta någon manuell synk här.
    </p>
    <p class="help-text">
      Nästa steg senare blir att visa senaste artikelsync och eventuella produkter som saknar mapping.
    </p>
  </div>

  <div class="notice" id="message"></div>
  <div class="error" id="error"></div>

</div>

<script>
const params = new URLSearchParams(window.location.search);
const locationId = params.get("locationId");
let connectPopup = null;

function setMessage(text) {
  document.getElementById("message").textContent = text || "";
}

function setError(text) {
  document.getElementById("error").textContent = text || "";
}

function formatInvoiceMode(mode) {
  if (mode === "draft") return "utkast";
  if (mode === "booked") return "bokför direkt";
  return mode || "";
}

function updateConnectButton(isConnected) {
  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const help = document.getElementById("connectHelpText");

  if (isConnected) {
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    help.textContent = "Spiris är anslutet för denna location. Om du vill byta konto kan du först koppla bort integrationen.";
  } else {
    connectBtn.style.display = "inline-block";
    disconnectBtn.style.display = "none";
    help.textContent = "När kopplingen är klar uppdateras sidan automatiskt.";
  }
}

async function loadStatus() {
  setMessage("");
  setError("");

  const res = await fetch("/api2/integration/status/" + encodeURIComponent(locationId));
  const data = await res.json();

  if (!res.ok || !data.ok || !data.status) {
    throw new Error(data.error || "Failed to load integration status");
  }

  const s = data.status;

  document.getElementById("status").innerHTML = \`
    <div class="status"><b>App installerad:</b> \${s.appInstalled ? "Ja" : "Nej"}</div>
    <div class="status"><b>Spiris ansluten:</b> \${s.spirisConnected ? "Ja" : "Nej"}</div>
    <div class="status"><b>Fakturaläge:</b> \${formatInvoiceMode(s.spirisInvoiceMode)}</div>
    <div class="status"><b>Synkade kunder:</b> \${s.customerMappingsCount}</div>
    <div class="status"><b>Produktmappingar:</b> \${s.productMappingsCount}</div>
    <div class="status"><b>Skickade fakturor:</b> \${s.invoiceMappingsCount}</div>
    <div class="status"><b>Retry-jobb:</b> \${s.retryJobsCount}</div>
    <div class="status"><b>Misslyckade jobb:</b> \${s.failedJobsCount}</div>
  \`;

  document.getElementById("invoiceModeSelect").value = s.spirisInvoiceMode;
  updateConnectButton(s.spirisConnected);
}

window.addEventListener("message", async function (event) {
  if (event.origin !== "https://integrations.fellow.se") {
    return;
  }

  if (!event.data || event.data.type !== "spiris-oauth-success") {
    return;
  }

  if (event.data.locationId && event.data.locationId !== locationId) {
    return;
  }

  setMessage("Spiris kopplades klart. Uppdaterar status...");
  setError("");

  if (connectPopup && !connectPopup.closed) {
    try {
      connectPopup.close();
    } catch (err) {}
  }

  try {
    await loadStatus();
    setMessage("Spiris är nu anslutet.");
  } catch (err) {
    setError(err.message || "Failed to refresh status after Spiris connection");
  }
});

document.getElementById("connectBtn").onclick = function () {
  if (document.getElementById("connectBtn").disabled) {
    return;
  }

  setMessage("Öppnar Spiris-inloggning...");
  setError("");

  connectPopup = window.open(
    "/api2/integration/connect-spiris/" + encodeURIComponent(locationId),
    "spirisConnectPopup",
    "width=700,height=800,resizable=yes,scrollbars=yes"
  );

  if (!connectPopup) {
    setError("Popup blockerad. Tillåt popup-fönster och försök igen.");
  }
};

document.getElementById("disconnectBtn").onclick = async function () {
  try {
    setMessage("Kopplar bort Spiris...");
    setError("");

    const res = await fetch(
      "/api2/integration/disconnect-spiris/" + encodeURIComponent(locationId),
      {
        method: "POST"
      }
    );

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to disconnect Spiris");
    }

    setMessage("Spiris har kopplats bort.");
    await loadStatus();
  } catch (err) {
    setError(err.message || "Failed to disconnect Spiris");
  }
};

document.getElementById("importCustomersBtn").onclick = async function () {
  try {
    setMessage("Importerar kunder...");
    setError("");

    const res = await fetch("/api2/admin/spiris/customers/import-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ locationId })
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Customer import failed");
    }

    setMessage("Kundimport klar.");
    await loadStatus();
  } catch (err) {
    setError(err.message || "Customer import failed");
  }
};

document.getElementById("saveInvoiceModeBtn").onclick = async function () {
  try {
    setMessage("Uppdaterar fakturaläge...");
    setError("");

    const selectedMode = document.getElementById("invoiceModeSelect").value;

    const saveRes = await fetch("/api2/settings/" + encodeURIComponent(locationId) + "/invoice-mode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        spirisInvoiceMode: selectedMode
      })
    });

    const saveData = await saveRes.json();

    if (!saveRes.ok || !saveData.ok) {
      throw new Error(saveData.error || "Failed to update invoice mode");
    }

    setMessage("Fakturaläge sparat: " + formatInvoiceMode(selectedMode));
    await loadStatus();
  } catch (err) {
    setError(err.message || "Failed to update invoice mode");
  }
};

loadStatus().catch((err) => {
  setError(err.message || "Failed to load integration status");
});
</script>

</body>
</html>
    `);
  } catch (err) {
    console.error("app spiris page error:", err.message);
    return res.status(500).send("Failed to load Spiris app page");
  }
});

router.post("/integration/disconnect-spiris/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const response = await axios.delete(
      "https://integrations.fellow.se/spiris/token?locationId=" +
      encodeURIComponent(locationId)
    );

    return res.json({
      ok: true,
      message: "Spiris disconnected",
      locationId,
      upstream: response.data
    });
  } catch (err) {
    console.error("disconnect spiris error:", err.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to disconnect Spiris",
      details: err.response?.data || err.message
    });
  }
});

module.exports = router;