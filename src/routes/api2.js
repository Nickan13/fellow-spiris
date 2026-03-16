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

router.get("/integration/fellow/product-import-status/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const productImportJobRepo = require("../db/repositories/productImportJobRepo");

    const job =
      await productImportJobRepo.getLatestByLocationId(locationId);

    return res.json({
      ok: true,
      job
    });

  } catch (err) {
    console.error(
      "product import status error:",
      err.message
    );

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch product import job status",
      details: err.message
    });
  }
});

router.get("/integration/fellow/product-import-job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const productImportJobRepo = require("../db/repositories/productImportJobRepo");

    const job = await productImportJobRepo.getById(jobId);

    if (!job) {
      return res.status(404).json({
        ok: false,
        error: "Job not found"
      });
    }

    return res.json({
      ok: true,
      job
    });

  } catch (err) {
    console.error(
      "product import job error:",
      err.message
    );

    return res.status(500).json({
      ok: false,
      error: "Failed to fetch product import job",
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
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Spiris Integration</title>

<style>
:root {
  --bg: #f5f7fb;
  --card: #ffffff;
  --card-muted: #f9fafb;
  --border: #e5e7eb;
  --border-strong: #d1d5db;
  --text: #111827;
  --muted: #6b7280;
  --primary: #82358b;
  --primary-hover: #6f2d78;
  --secondary: #eef2ff;
  --success-bg: #e8f7ee;
  --success-text: #166534;
  --danger-bg: #fef2f2;
  --danger-text: #b91c1c;
  --warning-bg: #fff7ed;
  --warning-text: #9a3412;
  --info-bg: #eff6ff;
  --info-text: #1d4ed8;
  --shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
  --radius-lg: 18px;
  --radius-md: 12px;
  --radius-sm: 10px;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  padding: 28px;
}

.app-shell {
  max-width: 1180px;
  margin: 0 auto;
}

.hero {
  background: linear-gradient(135deg, #82358b 0%, #5b2b91 100%);
  color: white;
  border-radius: 24px;
  padding: 28px;
  box-shadow: var(--shadow);
  margin-bottom: 22px;
}

.hero-top {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.hero-brand {
  display: flex;
  gap: 16px;
  align-items: center;
}

.hero-logo {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(255,255,255,0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
}

.hero h1 {
  margin: 0 0 6px 0;
  font-size: 28px;
  line-height: 1.1;
}

.hero-subtitle {
  margin: 0;
  color: rgba(255,255,255,0.86);
  font-size: 15px;
  max-width: 720px;
  line-height: 1.5;
}

.hero-status {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.hero-status .pill {
  background: rgba(255,255,255,0.14);
  color: white;
  border: 1px solid rgba(255,255,255,0.18);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-top: 22px;
}

.summary-card {
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 18px;
  padding: 16px;
}

.summary-label {
  font-size: 13px;
  color: rgba(255,255,255,0.78);
  margin-bottom: 8px;
}

.summary-value {
  font-size: 26px;
  line-height: 1;
  font-weight: 700;
  color: white;
}

.layout-grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 22px;
  align-items: start;
}

.stack {
  display: grid;
  gap: 22px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.card-header {
  padding: 20px 22px 14px 22px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
}

.card-title-wrap h2,
.card-title-wrap h3 {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
}

.card-subtitle {
  margin: 6px 0 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}

.card-body {
  padding: 20px 22px 22px 22px;
}

.actions-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

button {
  appearance: none;
  border: none;
  cursor: pointer;
  border-radius: 12px;
  padding: 11px 16px;
  font-size: 14px;
  font-weight: 600;
  transition: 0.18s ease;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

button.primary {
  background: var(--primary);
  color: white;
}

button.primary:hover {
  background: var(--primary-hover);
}

button.secondary {
  background: #eef2f7;
  color: #1f2937;
}

button.secondary:hover {
  background: #e5e7eb;
}

button.ghost-danger {
  background: #fff1f2;
  color: #be123c;
}

button.ghost-danger:hover {
  background: #ffe4e6;
}

select {
  appearance: none;
  border: 1px solid var(--border-strong);
  background: white;
  color: var(--text);
  border-radius: 12px;
  padding: 11px 42px 11px 14px;
  font-size: 14px;
  min-width: 180px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
  white-space: nowrap;
}

.pill.success {
  background: var(--success-bg);
  color: var(--success-text);
  border-color: #bbf7d0;
}

.pill.danger {
  background: var(--danger-bg);
  color: var(--danger-text);
  border-color: #fecaca;
}

.pill.warning {
  background: var(--warning-bg);
  color: var(--warning-text);
  border-color: #fed7aa;
}

.pill.info {
  background: var(--info-bg);
  color: var(--info-text);
  border-color: #bfdbfe;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.metric-box {
  border: 1px solid var(--border);
  background: var(--card-muted);
  border-radius: 14px;
  padding: 14px;
}

.metric-label {
  margin: 0 0 8px 0;
  color: var(--muted);
  font-size: 13px;
}

.metric-value {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
}

.info-list {
  display: grid;
  gap: 12px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}

.info-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.info-row:first-child {
  padding-top: 0;
}

.info-label {
  color: var(--muted);
  font-size: 14px;
}

.info-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  text-align: right;
}

.notice {
  margin-top: 0;
  color: var(--text);
  font-size: 14px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  min-height: 48px;
  line-height: 1.5;
}

.error {
  color: var(--danger-text);
  font-size: 14px;
  background: var(--danger-bg);
  border: 1px solid #fecaca;
  border-radius: 14px;
  padding: 14px 16px;
  min-height: 48px;
  line-height: 1.5;
}

.panel-stack {
  display: grid;
  gap: 14px;
  margin-top: 14px;
}

.import-details-card {
  background: #fcfcfd;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
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
  line-height: 1.45;
}

.helper-text {
  margin: 0 0 16px 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}

.section-note {
  margin-top: 14px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}

@media (max-width: 1080px) {
  .layout-grid {
    grid-template-columns: 1fr;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .hero {
    padding: 20px;
  }

  .hero h1 {
    font-size: 24px;
  }

  .summary-grid,
  .metrics {
    grid-template-columns: 1fr;
  }

  .card-header,
  .card-body {
    padding-left: 16px;
    padding-right: 16px;
  }

  .info-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .info-value {
    text-align: left;
  }
}
</style>
</head>

<body>

<div class="app-shell">

  <section class="hero">
    <div class="hero-top">
      <div class="hero-brand">
        <div class="hero-logo">S</div>
        <div>
          <h1>Spiris Integration</h1>
          <p class="hero-subtitle">
            Koppla Spiris till Fellow, synka kunder och produkter, hantera flera prislistor och styr hur fakturor skickas vidare.
          </p>
        </div>
      </div>

      <div class="hero-status">
        <span class="pill" id="heroAppInstalledPill">Appstatus laddas...</span>
        <span class="pill" id="heroSpirisPill">Spiris-status laddas...</span>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Synkade kunder</div>
        <div class="summary-value" id="summaryCustomers">-</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Synkade produkter</div>
        <div class="summary-value" id="summaryProducts">-</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Skickade fakturor</div>
        <div class="summary-value" id="summaryInvoices">-</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Kräver åtgärd</div>
        <div class="summary-value" id="summaryRequiresAction">-</div>
      </div>
    </div>
  </section>

  <div class="layout-grid">

    <div class="stack">

      <section class="card">
        <div class="card-header">
          <div class="card-title-wrap">
            <h2>Översikt</h2>
            <p class="card-subtitle">
              Här ser du aktuell status för integrationen, kopplingen till Spiris och de viktigaste nyckeltalen.
            </p>
          </div>
          <span class="pill info" id="invoiceModePill">Fakturaläge laddas...</span>
        </div>
        <div class="card-body">
          <div class="metrics">
            <div class="metric-box">
              <p class="metric-label">Retry-jobb</p>
              <p class="metric-value" id="metricRetryJobs">-</p>
            </div>
            <div class="metric-box">
              <p class="metric-label">Misslyckade jobb</p>
              <p class="metric-value" id="metricFailedJobs">-</p>
            </div>
          </div>

          <div class="info-list" style="margin-top:16px;">
            <div class="info-row">
              <div class="info-label">App installerad</div>
              <div class="info-value" id="infoAppInstalled">-</div>
            </div>
            <div class="info-row">
              <div class="info-label">Spiris anslutet</div>
              <div class="info-value" id="infoSpirisConnected">-</div>
            </div>
            <div class="info-row">
              <div class="info-label">Aktuellt fakturaläge</div>
              <div class="info-value" id="infoInvoiceMode">-</div>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div class="card-title-wrap">
            <h2>Koppling till Spiris</h2>
            <p class="card-subtitle">
              Hantera kopplingen mellan detta subaccount och Spiris.
            </p>
          </div>
        </div>
        <div class="card-body">
          <p class="helper-text" id="connectHelpText">
            När kopplingen är klar uppdateras sidan automatiskt.
          </p>
          <div class="actions-row">
            <button class="primary" id="connectBtn">Koppla till Spiris</button>
            <button class="ghost-danger" id="disconnectBtn" style="display:none;">Koppla bort Spiris</button>
          </div>
          <p class="section-note">
            Kopplingen används för kundimport, produktsynk, prislistor och fakturering.
          </p>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div class="card-title-wrap">
            <h2>Produkter och prislistor</h2>
            <p class="card-subtitle">
              Importera artiklar från Spiris, skapa eller reparera produkter i Fellow och synka flera priser på samma produkt.
            </p>
          </div>
        </div>
        <div class="card-body">
          <p class="helper-text">
            Importen återanvänder befintliga mappingar, skapar saknade priser och kan självläka om en Fellow-produkt tidigare tagits bort.
          </p>
          <div class="actions-row">
            <button class="primary" id="importProductsBtn">Importera produkter</button>
          </div>
          <p class="section-note">
            0-priser importeras också, så att Fellow speglar Spiris så exakt som möjligt.
          </p>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div class="card-title-wrap">
            <h2>Kunder</h2>
            <p class="card-subtitle">
              Importera kunder från Spiris till detta subaccount i Fellow.
            </p>
          </div>
        </div>
        <div class="card-body">
          <p class="helper-text">
            Befintliga mappingar återanvänds och nya kontakter skapas vid behov.
          </p>
          <div class="actions-row">
            <button class="secondary" id="importCustomersBtn">Importera kunder</button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div class="card-title-wrap">
            <h2>Fakturor</h2>
            <p class="card-subtitle">
              Styr om nya fakturor från Fellow ska skickas till Spiris som utkast eller bokföras direkt.
            </p>
          </div>
        </div>
        <div class="card-body">
          <p class="helper-text">
            Fakturor skickas vidare när ni <b>skickar</b> dem i Fellow. Redan skickade fakturor påverkas inte av ändrat fakturaläge.
          </p>
          <div class="actions-row">
            <select id="invoiceModeSelect">
              <option value="draft">Utkast</option>
              <option value="booked">Bokför direkt</option>
            </select>
            <button class="secondary" id="saveInvoiceModeBtn">Spara fakturaläge</button>
          </div>
        </div>
      </section>

    </div>

    <div class="stack">

      <section class="card">
        <div class="card-header">
          <div class="card-title-wrap">
            <h3>Status och meddelanden</h3>
            <p class="card-subtitle">
              Här visas resultat från import, koppling och ändringar.
            </p>
          </div>
        </div>
        <div class="card-body">
          <div class="panel-stack">
            <div class="notice" id="message"></div>
            <div class="error" id="error"></div>
            <div id="importDetails"></div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div class="card-title-wrap">
            <h3>Fakturor som kräver åtgärd</h3>
            <p class="card-subtitle">
              Problem som behöver hanteras manuellt för att fakturor ska komma vidare.
            </p>
          </div>
        </div>
        <div class="card-body">
          <div id="requiresActionDetails"></div>
        </div>
      </section>

    </div>

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

function getPillClass(type) {
  if (type === "success") return "pill success";
  if (type === "danger") return "pill danger";
  if (type === "warning") return "pill warning";
  return "pill info";
}

function updateConnectButton(isConnected) {
  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const help = document.getElementById("connectHelpText");

  if (isConnected) {
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-flex";
    help.textContent = "Spiris är anslutet för detta subaccount. Du kan koppla bort integrationen här om det behövs.";
  } else {
    connectBtn.style.display = "inline-flex";
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

  document.getElementById("summaryCustomers").textContent = s.customerMappingsCount;
  document.getElementById("summaryProducts").textContent = s.productMappingsCount;
  document.getElementById("summaryInvoices").textContent = s.invoiceMappingsCount;
  document.getElementById("summaryRequiresAction").textContent = s.requiresActionCount;

  document.getElementById("metricRetryJobs").textContent = s.retryJobsCount;
  document.getElementById("metricFailedJobs").textContent = s.failedJobsCount;

  document.getElementById("infoAppInstalled").textContent = s.appInstalled ? "Ja" : "Nej";
  document.getElementById("infoSpirisConnected").textContent = s.spirisConnected ? "Ja" : "Nej";
  document.getElementById("infoInvoiceMode").textContent = formatInvoiceMode(s.spirisInvoiceMode);

  document.getElementById("invoiceModePill").textContent = "Fakturaläge: " + formatInvoiceMode(s.spirisInvoiceMode);

  const heroAppInstalledPill = document.getElementById("heroAppInstalledPill");
  heroAppInstalledPill.className = s.appInstalled ? getPillClass("success") : getPillClass("danger");
  heroAppInstalledPill.textContent = s.appInstalled ? "App installerad" : "App ej installerad";

  const heroSpirisPill = document.getElementById("heroSpirisPill");
  heroSpirisPill.className = s.spirisConnected ? getPillClass("success") : getPillClass("warning");
  heroSpirisPill.textContent = s.spirisConnected ? "Spiris anslutet" : "Spiris ej anslutet";

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
          importAll: true
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

    const resultRows = Array.isArray(data.results) ? data.results : [];

    const totalCreatedPrices = resultRows.reduce(function (sum, row) {
      return sum + ((row.createdPrices || []).length);
    }, 0);

    const totalSkippedPrices = resultRows.reduce(function (sum, row) {
      return sum + ((row.skippedPrices || []).length);
    }, 0);

    const rowsWithCreatedPrices = resultRows.filter(function (row) {
      return Array.isArray(row.createdPrices) && row.createdPrices.length > 0;
    });

    const failedRows = resultRows.filter(function (row) {
      return row.status === "failed";
    });

    await loadStatus();
    await loadRequiresActionJobs();

    setMessage(
      "Produktimport klar. Behandlade: " + totalCount +
      ", skapade produkter: " + createdCount +
      ", redan mappade: " + skippedCount +
      ", skapade priser: " + totalCreatedPrices +
      ", redan befintliga priser: " + totalSkippedPrices +
      ", fel: " + failedCount + "."
    );

    const detailSections = [];

    if (rowsWithCreatedPrices.length > 0) {
      const createdPriceItems = rowsWithCreatedPrices.map(function (row) {
        const label = row.articleName || row.spirisArticleNumber || "Okänd artikel";

        const prices = (row.createdPrices || []).map(function (price) {
          return price.name + " (" + price.amount + " " + price.currency + ")";
        }).join(", ");

        return "<li><b>" + label + "</b>: " + prices + "</li>";
      }).join("");

      detailSections.push(
        '<div class="import-details-card">' +
        '<h4>Produkter där nya priser skapades</h4>' +
        '<ul>' + createdPriceItems + '</ul>' +
        '</div>'
      );
    }

    if (failedRows.length > 0) {
      const failedItems = failedRows.map(function (row) {
        const label = row.articleName || row.spirisArticleNumber || "Okänd artikel";

        let reason = row.error || "Okänt fel";

        if (typeof reason === "object") {
          reason = reason.message || JSON.stringify(reason);
        }

        return "<li><b>" + label + "</b>: " + reason + "</li>";
      }).join("");

      detailSections.push(
        '<div class="import-details-card">' +
        '<h4>Produkter med fel</h4>' +
        '<ul>' + failedItems + '</ul>' +
        '</div>'
      );
    }

    setImportDetails(detailSections.join(""));
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
    );

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
  } finally {
    const button = document.getElementById("importCustomersBtn");
    button.disabled = false;
    button.textContent = "Importera kunder";
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
    const importAll = req.body?.importAll === true;
    const requestedLimit = Number(req.body?.limit ?? 10);

    const limit = importAll
      ? null
      : Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 10;

    const articleFetchLimit = importAll ? 5000 : 1000;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const productImportJobRepo = require("../db/repositories/productImportJobRepo");

    const runningJob =
      await productImportJobRepo.hasRunningJobForLocation(locationId);

    if (runningJob) {
      return res.status(409).json({
        ok: false,
        error: "A product import job is already running for this location"
      });
    }

    const job = await productImportJobRepo.createJob({
      locationId,
      importAll,
      requestedLimit: limit,
      articleFetchLimit
    });

    return res.json({
      ok: true,
      queued: true,
      job: {
        id: job.id,
        locationId: job.locationId,
        status: job.status,
        importAll: job.importAll,
        requestedLimit: job.requestedLimit,
        articleFetchLimit: job.articleFetchLimit,
        createdAt: job.createdAt
      }
    });
  } catch (err) {
    console.error(
      "queue fellow product import error:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      ok: false,
      error: "Failed to queue Spiris product import job",
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

module.exports = router;