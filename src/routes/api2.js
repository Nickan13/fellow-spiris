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
const articleStore = require("../services/articleStore");
const ghlProductService = require("../services/ghlProductService");
const fellowProductImportService = require("../services/fellowProductImportService");
const spirisService = require("../services/spirisService");
const spirisPriceListService = require("../services/spirisPriceListService");

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

    const requiresActionCount =
      await invoiceJobRepo.countRequiresActionJobsByLocationId(locationId);

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
        requiresActionCount,
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

.status-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.status-connected {
  background: #e6f6ec;
  color: #0f7a39;
}

.status-disconnected {
  background: #fdecec;
  color: #b00020;
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

button:hover {
  background: #6f2d78;
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
  padding: 10px 40px 10px 14px;
  font-size: 14px;
  border-radius: 6px;
  border: none;
  background-color: #82358b;
  color: white;
  cursor: pointer;

  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;

  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='white'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 12px;
}

select option {
  background: white;
  color: black;
}

.notice {
  margin-top: 16px;
  color: #1f2937;
  font-size: 14px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 12px;
  min-height: 20px;
}

.error {
  color: #b00020;
  margin-top: 12px;
  font-size: 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 12px;
  min-height: 20px;
}

#importDetails {
  margin-top: 16px;
}

.import-details-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px;
}

.import-details-card h4 {
  margin: 0 0 10px 0;
  font-size: 15px;
}

.import-details-card ul {
  margin: 0;
  padding-left: 18px;
}

.import-details-card li {
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 1.4;
}

</style>
</head>

<body>

<div class="card">

  <h2>Spiris Integration</h2>

  <div id="status">Laddar integrationsstatus...</div>

  <div class="section">
    <h3>Koppla Spiris till Fellow</h3>
    <p class="help-text">
      Koppla ditt Spiris-konto till Fellow så att integrationen kan hämta kunder, synka produkter och skicka fakturor.
    </p>
    <p class="help-text" id="connectHelpText">
      När kopplingen är klar uppdateras sidan automatiskt.
    </p>
    <div class="actions-row">
      <button id="connectBtn">Koppla till Spiris</button>
      <button class="secondary" id="disconnectBtn" style="display:none;">Koppla bort Spiris</button>
    </div>
  </div>

  <div class="section">
    <h3>Kunder</h3>
    <p class="help-text">
      Importera kunder från Spiris till detta subaccount i Fellow. Befintliga mappingar återanvänds och nya kontakter skapas vid behov.
    </p>
    <p class="help-text">
      Funktionen hämtar kunder från Spiris och kopplar dem till rätt kontakter i Fellow.
    </p>
    <div class="actions-row">
      <button class="secondary" id="importCustomersBtn">Importera kunder</button>
    </div>
  </div>

  <div class="section">
    <h3>Fakturor</h3>
    <p class="help-text">
      Fakturor som skapas i Fellow går automatiskt över till Spiris när ni <b>skickar</b> fakturan. Om ni av någon anledning behöver skicka samma faktura en gång till händer ingenting i Spiris (inga dubletter).
    </p>
    <p class="help-text">
      Välj om fakturor från Fellow ska skickas till Spiris som utkast eller om de ska bokföras direkt. Om du väljer att skapa fakturautkast behöver du logga in i Spiris och hantera den för att den ska bokföras. Om du väjer Bokför direkt behöver du inte hantera fakturan mer, utan den bokförs direkt i Spiris.
    </p>
    <p class="help-text">
      Ändring av fakturaläge gäller nya fakturor. Redan skickade fakturor påverkas inte.
    </p>
    <div class="actions-row">
      <select id="invoiceModeSelect">
        <option value="draft">Utkast</option>
        <option value="booked">Bokför direkt</option>
      </select>
      <button class="secondary" id="saveInvoiceModeBtn">Spara fakturaläge</button>
    </div>
  </div>

  <div class="section">
    <h3>Produkter</h3>
    <p class="help-text">
      Importera artiklar från Spiris och skapa dem som produkter i Fellow med pris och lokal mapping.
    </p>
    <p class="help-text">
      Importen hoppar över artiklar som redan är mappade, så samma produkter skapas inte två gånger.
    </p>
    <div class="actions-row">
      <button class="secondary" id="importProductsBtn">Importera produkter</button>
    </div>
  </div>

    <div class="section">
    <h3>Status och meddelanden</h3>
    <p class="help-text">
      Här visas resultat från import, koppling och ändringar i fakturaläge.
    </p>
    <div class="notice" id="message"></div>
    <div class="error" id="error"></div>
    <div id="importDetails"></div>
    <div id="requiresActionDetails"></div>
  </div>

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

function setImportDetails(html) {
  document.getElementById("importDetails").innerHTML = html || "";
}

function setRequiresActionDetails(html) {
  document.getElementById("requiresActionDetails").innerHTML = html || "";
}

function formatInvoiceMode(mode) {
  if (mode === "draft") return "Utkast";
  if (mode === "booked") return "Bokför direkt";
  return mode || "";
}

function updateConnectButton(isConnected) {
  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const help = document.getElementById("connectHelpText");

  if (isConnected) {
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    help.textContent = "Spiris är anslutet för. Klicka bara på knappen om du vill koppla bort integrationen.";
  } else {
    connectBtn.style.display = "inline-block";
    disconnectBtn.style.display = "none";
    help.textContent = "När kopplingen är klar uppdateras sidan automatiskt.";
  }
}

async function loadStatus() {
  setMessage("");
  setError("");
  setImportDetails("");

  const res = await fetch("/api2/integration/status/" + encodeURIComponent(locationId));
  const data = await res.json();

  if (!res.ok || !data.ok || !data.status) {
    throw new Error(data.error || "Failed to load integration status");
  }

  const s = data.status;

  const spirisBadge = s.spirisConnected
  ? '<span class="status-badge status-connected">Ansluten</span>'
  : '<span class="status-badge status-disconnected">Ej ansluten</span>';

  document.getElementById("status").innerHTML = \`
    <div class="status"><b>App installerad:</b> \${s.appInstalled ? "Ja" : "Nej"}</div>
    <div class="status"><b>Spiris:</b> \${spirisBadge}</div>
    <div class="status"><b>Fakturaläge:</b> \${formatInvoiceMode(s.spirisInvoiceMode)}</div>
    <div class="status"><b>Synkade kunder:</b> \${s.customerMappingsCount}</div>
    <div class="status"><b>Synkade produkter:</b> \${s.productMappingsCount}</div>
    <div class="status"><b>Skickade fakturor:</b> \${s.invoiceMappingsCount}</div>
    <div class="status"><b>Retry-jobb:</b> \${s.retryJobsCount}</div>
    <div class="status"><b>Kräver åtgärd:</b> \${s.requiresActionCount}</div>
    <div class="status"><b>Misslyckade jobb:</b> \${s.failedJobsCount}</div>
  \`;

  document.getElementById("invoiceModeSelect").value = s.spirisInvoiceMode;
  updateConnectButton(s.spirisConnected);
}

async function loadRequiresActionJobs() {
  const res = await fetch(
    "/api2/integration/requires-action/" + encodeURIComponent(locationId)
  );

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to load requires-action jobs");
  }

  if (!data.jobs || data.jobs.length === 0) {
    setRequiresActionDetails(
      '<div class="import-details-card">' +
      '<h4>Fakturor som kräver åtgärd</h4>' +
      '<div>Inga fakturor kräver åtgärd just nu.</div>' +
      '</div>'
    );
    return;
  }

  const items = data.jobs.map(function (job) {
    const invoiceId = job.fellowInvoiceId || "Okänd faktura";
    const reason = job.lastErrorText || "Okänd orsak";

    const invoiceLink =
      "https://crm.fellow.se/location/" +
      encodeURIComponent(locationId) +
      "/invoices/" +
      encodeURIComponent(invoiceId);

    const invoiceItems = Array.isArray(job.payload?.invoiceItems)
      ? job.payload.invoiceItems
      : [];

    const productList = invoiceItems.length
      ? invoiceItems.map(function (item) {
          return item.name || item.productId || "Okänd produkt";
        }).join(", ")
      : "Inga produkter hittades i payload";

    return (
      "<li>" +
      "<b>Faktura:</b> " +
      '<a href="' + invoiceLink + '" target="_blank">' + invoiceId + "</a>" +
      "<br/><b>Produkter:</b> " + productList +
      "<br/><b>Problem:</b> " + reason +
      "</li>"
    );
  }).join("");

  setRequiresActionDetails(
    '<div class="import-details-card">' +
    '<h4>Fakturor som kräver åtgärd</h4>' +
    '<ul>' + items + '</ul>' +
    '</div>'
  );
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
    await loadRequiresActionJobs();
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
    await loadRequiresActionJobs();
  } catch (err) {
    setError(err.message || "Failed to disconnect Spiris");
  }
};

document.getElementById("importProductsBtn").onclick = async function () {
  try {
    setMessage("Importerar produkter från Spiris...");
    setError("");
    setImportDetails("");

    const button = document.getElementById("importProductsBtn");
    button.disabled = true;
    button.textContent = "Importerar...";

    const res = await fetch(
      "/api2/integration/fellow/import-products/" + encodeURIComponent(locationId),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          limit: 10
        })
      }
    );

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || data.details || "Product import failed");
    }

    const createdCount = data.created || 0;
    const skippedCount = data.skippedAlreadyMapped || 0;
    const failedCount = data.failed || 0;
    const totalCount = data.total || 0;

    await loadStatus();
    await loadRequiresActionJobs();

    setMessage(
      "Produktimport klar. Behandlade: " + totalCount +
      ", skapade: " + createdCount +
      ", redan mappade: " + skippedCount +
      ", fel: " + failedCount + "."
    );

    const failedRows = (data.results || []).filter(function (row) {
      return row.status === "failed";
    });

    if (failedRows.length > 0) {
      const items = failedRows.map(function (row) {
        const label = row.articleName || row.spirisArticleNumber || "Okänd artikel";
        const reason = row.error || "Okänt fel";
        return "<li><b>" + label + "</b>: " + reason + "</li>";
      }).join("");

      setImportDetails(
        '<div class="import-details-card">' +
        '<h4>Produkter med fel</h4>' +
        '<ul>' + items + '</ul>' +
        '</div>'
      );
    }
  } catch (err) {
    setError(err.message || "Product import failed");
  } finally {
    const button = document.getElementById("importProductsBtn");
    button.disabled = false;
    button.textContent = "Importera produkter";
  }
};

document.getElementById("importCustomersBtn").onclick = async function () {
  try {
    setMessage("Importerar 10 kunder...");
    setError("");
    setImportDetails("");

    const res = await fetch("/api2/admin/spiris/customers/import-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        locationId,
        pageSize: 10,
        maxPages: 1
      })
    });

    const rawText = await res.text();

    let data = null;

    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      throw new Error("Import endpoint returned non-JSON response: " + rawText.slice(0, 300));
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || data.details || "Customer import failed");
    }

    const importedCount = data.totals?.total || 0;
    const createdCount = data.totals?.created || 0;
    const matchedCount = data.totals?.matched || 0;
    const mappedCount = data.totals?.mapped || 0;
    const failedCount = data.totals?.failed || 0;

    const failedRows = [];

    for (const page of (data.pages || [])) {
      for (const row of (page.results || [])) {
        if (row.status === "failed") {
          failedRows.push(row);
        }
      }
    }

    await loadStatus();
    await loadRequiresActionJobs();

    setMessage(
      "Import klar. Behandlade: " + importedCount +
      ", skapade: " + createdCount +
      ", matchade: " + matchedCount +
      ", redan mappade: " + mappedCount +
      ", fel: " + failedCount + "."
    );

    if (failedRows.length > 0) {
      const items = failedRows.map(function (row) {
        const label = row.name || row.email || row.spirisCustomerId || "Okänd kund";
        const reason = row.error || "Okänt fel";
        return "<li><b>" + label + "</b>: " + reason + "</li>";
      }).join("");

      setImportDetails(
        '<div class="import-details-card">' +
        '<h4>Poster med fel</h4>' +
        '<ul>' + items + '</ul>' +
        '</div>'
      );
    }
  } catch (err) {
    setError(err.message || "Customer import failed");
  }
};

document.getElementById("saveInvoiceModeBtn").onclick = async function () {
  try {
    setMessage("Sparar fakturaläge...");
    setError("");

    const selectedMode = document.getElementById("invoiceModeSelect").value;
    const saveButton = document.getElementById("saveInvoiceModeBtn");

    saveButton.disabled = true;
    saveButton.textContent = "Sparar...";

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

    await loadStatus();
    await loadRequiresActionJobs();
    setMessage("Fakturaläget har sparats som: " + formatInvoiceMode(selectedMode));
  } catch (err) {
    setError(err.message || "Failed to update invoice mode");
  } finally {
    const saveButton = document.getElementById("saveInvoiceModeBtn");
    saveButton.disabled = false;
    saveButton.textContent = "Spara fakturaläge";
  }
};

Promise.all([
  loadStatus(),
  loadRequiresActionJobs()
]).catch((err) => {
  setError(err.message || "Failed to load page data");
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
      message: "Spiris bortkopplat",
      locationId,
      upstream: response.data
    });
  } catch (err) {
    console.error("disconnect spiris error:", err.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: "Misslyckades med att koppla bort Spiris",
      details: err.response?.data || err.message
    });
  }
});

router.get("/integration/requires-action/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const jobs =
      await invoiceJobRepo.listRequiresActionJobsByLocationId(locationId);

    return res.json({
      ok: true,
      locationId,
      count: jobs.length,
      jobs
    });

  } catch (err) {
    console.error("requires-action jobs error:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch requires-action jobs",
      details: err.message
    });
  }
});

router.get("/integration/spiris/articles/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;
    const limit = Number(req.query.limit || 200);

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const articles = await articleStore.listArticlesByLocation(locationId, limit);

    return res.json({
      ok: true,
      locationId,
      count: articles.length,
      articles
    });
  } catch (err) {
    console.error("spiris articles list error:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch synced Spiris articles",
      details: err.message
    });
  }
});

router.get("/integration/fellow/products/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const data = await ghlProductService.listProducts(locationId);

    return res.json({
      ok: true,
      locationId,
      data
    });
  } catch (err) {
    console.error("fellow products list error:", err.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch Fellow products",
      details: err.response?.data || err.message
    });
  }
});

router.post("/integration/fellow/test-create-product/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const articles = await articleStore.listArticlesByLocation(locationId, 1);

    if (!articles || articles.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "No synced Spiris articles found"
      });
    }

    const article = articles[0];

    const result = await ghlProductService.createProduct(locationId, {
      name: article.name || article.articleNumber,
      description: "",
      productType: article?.raw?.IsStock === true ? "PHYSICAL" : "SERVICE"
    });

    const productId =
      result.product?._id ||
      result.product?.id ||
      null;

    if (!productId) {
      throw new Error("Created Fellow product missing id");
    }

    const priceResult = await ghlProductService.createPrice(
      locationId,
      productId,
      {
        name: "Standardpris",
        currency: "SEK",
        amount: article.unitPrice ?? 0
      }
    );

    return res.json({
      ok: true,
      locationId,
      spirisArticleNumber: article.articleNumber,
      createdProduct: result.product,
      createdPrice: priceResult.price
    });

  } catch (err) {
    console.error(
      "test create product error:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      ok: false,
      error: "Failed to create Fellow product",
      details: err.response?.data || err.message
    });
  }
});

router.post("/integration/fellow/import-products/:locationId", express.json(), async (req, res) => {
  try {
    const { locationId } = req.params;
    const requestedLimit = Number(req.body?.limit ?? 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 10;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const result = await fellowProductImportService.importProductsForLocation({
      locationId,
      limit,
      articleFetchLimit: 1000
    });

    return res.json({
      ok: true,
      locationId: result.locationId,
      total: result.total,
      created: result.created,
      skippedAlreadyMapped: result.skippedAlreadyMapped,
      failed: result.failed,
      results: result.results
    });
  } catch (err) {
    console.error(
      "import fellow products error:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      ok: false,
      error: "Failed to import Spiris articles as Fellow products",
      details: err.response?.data || err.message
    });
  }
});

router.get("/integration/fellow/product-prices/:locationId/:productId", async (req, res) => {
  try {
    const { locationId, productId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    if (!productId) {
      return res.status(400).json({
        ok: false,
        error: "productId is required"
      });
    }

    const data = await ghlProductService.listPricesForProduct(locationId, productId);

    return res.json({
      ok: true,
      locationId,
      productId,
      data
    });
  } catch (err) {
    console.error("fellow product prices error:", err.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch Fellow product prices",
      details: err.response?.data || err.message
    });
  }
});

router.get("/integration/fellow/collections/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const ghlCollectionService = require("../services/ghlCollectionService");
    const data = await ghlCollectionService.listCollections(locationId);

    return res.json({
      ok: true,
      locationId,
      data
    });
  } catch (err) {
    console.error("fellow collections debug error:", err.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch Fellow collections",
      details: err.response?.data || err.message
    });
  }
});

router.get("/integration/debug/spiris/sales-price-lists/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const accessToken = await tokenService.getAccessTokenForLocation(locationId);

    const salesPriceLists = await spirisService.getSalesPriceLists(accessToken);
    const salesPriceListPrices = await spirisService.getSalesPriceListPrices(accessToken);
    const articles = await articleStore.listArticlesByLocation(locationId, 5);

    return res.json({
      ok: true,
      locationId,
      salesPriceLists,
      salesPriceListPrices,
      sampleArticles: articles.map((article) => ({
        spirisArticleId: article.spirisArticleId,
        articleNumber: article.articleNumber,
        name: article.name,
        unitPrice: article.unitPrice
      }))
    });
  } catch (err) {
    console.error(
      "debug spiris sales price lists error:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch Spiris sales price lists debug data",
      details: err.response?.data || err.message
    });
  }
});

router.get("/integration/debug/spiris/article-prices/:locationId/:articleNumber", async (req, res) => {
  try {
    const { locationId, articleNumber } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    if (!articleNumber) {
      return res.status(400).json({
        ok: false,
        error: "articleNumber is required"
      });
    }

    const article = await articleStore.getArticleByNumber(locationId, articleNumber);

    if (!article) {
      return res.status(404).json({
        ok: false,
        error: "Article not found in local store",
        locationId,
        articleNumber
      });
    }

    if (!article.spirisArticleId) {
      return res.status(400).json({
        ok: false,
        error: "Article is missing spirisArticleId",
        locationId,
        articleNumber
      });
    }

    const accessToken = await tokenService.getAccessTokenForLocation(locationId);

    const resolved =
      await spirisPriceListService.getResolvedPricesForArticle({
        accessToken,
        articleId: article.spirisArticleId
      });

    return res.json({
      ok: true,
      locationId,
      article: {
        articleNumber: article.articleNumber,
        spirisArticleId: article.spirisArticleId,
        name: article.name,
        unitPrice: article.unitPrice
      },
      prices: resolved.prices
    });
  } catch (err) {
    console.error(
      "debug spiris article prices error:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      ok: false,
      error: "Failed to resolve article prices from Spiris",
      details: err.response?.data || err.message
    });
  }
});

module.exports = router;