const express = require("express");
const { getTrades } = require("../services/upstox");
const authRoutes = require("./auth");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const accessToken = authRoutes.getAccessToken();

    if (!accessToken) {
      return res.status(401).json({
        error: "Not authenticated with Upstox",
      });
    }

    const data = await getTrades(accessToken);

    res.json(data);
  } catch (error) {
    console.error(
      "Trades API error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json({
      error: "Failed to fetch trades",
      details: error.response?.data || error.message,
    });
  }
});

module.exports = router;