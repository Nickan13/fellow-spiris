const express = require("express");
const router = express.Router();
const tokenService = require("../services/tokenService");
const articleSyncService = require("../services/articleSyncService");
const fellowProductMappingRepo = require("../db/repositories/fellowProductMappingRepo");
const customerImportService = require("../services/customerImportService");

router.get("/spiris/company-settings", async (req, res) => {
  try {
    return res.status(501).json({
      ok: false,
      message: "Not implemented"
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

router.post("/spiris/articles/sync", async (req, res) => {
  try {
    const { locationId } = req.body;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const accessToken = await tokenService.getAccessTokenForLocation(locationId);

    const result = await articleSyncService.syncArticlesForLocation({
      locationId,
      accessToken,
      pageSize: 50
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message,
      response: err.response?.data || null
    });
  }
});

router.post("/mappings/products", async (req, res) => {
  try {
    const {
      locationId,
      fellowProductId,
      spirisArticleNumber
    } = req.body;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    if (!fellowProductId) {
      return res.status(400).json({
        ok: false,
        error: "fellowProductId is required"
      });
    }

    if (!spirisArticleNumber) {
      return res.status(400).json({
        ok: false,
        error: "spirisArticleNumber is required"
      });
    }

    await fellowProductMappingRepo.upsertMapping({
      locationId,
      fellowProductId,
      spirisArticleNumber
    });

    return res.json({
      ok: true,
      locationId,
      fellowProductId,
      spirisArticleNumber
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

router.get("/mappings/products", async (req, res) => {
  try {
    const locationId = req.query.locationId;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId query param is required"
      });
    }

    const rows = await fellowProductMappingRepo.listMappingsByLocation(locationId);

    return res.json({
      ok: true,
      count: rows.length,
      rows
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

router.post("/spiris/customers/import-page", async (req, res) => {
  try {
    const { locationId, page = 1, pageSize = 50 } = req.body;

    if (!locationId) {
      return res.status(400).json({
        ok: false,
        error: "locationId is required"
      });
    }

    const result = await customerImportService.importCustomersPage({
      locationId,
      page,
      pageSize
    });

    return res.json({
      ok: true,
      ...result
    });

  } catch (err) {
    console.error("[customer-import]", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

module.exports = router;