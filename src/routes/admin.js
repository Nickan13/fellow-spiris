const express = require("express");
const router = express.Router();
const invoiceOrchestrator = require("../services/invoiceOrchestrator");
const tokenService = require("../services/tokenService");
const articleSyncService = require("../services/articleSyncService");
const draftMappingStore = require("../services/draftMappingStore");
const ghlService = require("../services/ghlService");
const ghlWritebackStore = require("../services/ghlWritebackStore");
const env = require("../config/env");

router.get("/spiris/company-settings", async (req, res) => {
  try {
    return res.status(501).json({
      ok: false,
      message: "Use the draft test route instead."
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

module.exports = router;