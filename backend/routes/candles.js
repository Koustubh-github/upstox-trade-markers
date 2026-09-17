const express = require("express");
const axios = require("axios");
const authRoutes = require("./auth");

const router = express.Router();

const UPSTOX_API_BASE = "https://api.upstox.com/v3";

// GET /api/candles/:instrumentToken
// Example:
// /api/candles/NSE_FO%7C56936

router.get("/:instrumentToken", async (req, res) => {
  try {
    const accessToken = authRoutes.getAccessToken();

    const instrumentToken = req.params.instrumentToken;

    // Upstox API documentation specifies Authorization header,
    // though the gateway currently serves intraday candles publicly as well.
    // We send Authorization if available, but do not block unauthenticated calls.
    const headers = {
      Accept: "application/json",
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    let candles = [];

    try {
      const intradayRes = await axios.get(
        `${UPSTOX_API_BASE}/historical-candle/intraday/${encodeURIComponent(
          instrumentToken
        )}/minutes/1`,
        { headers }
      );
      candles = intradayRes.data?.data?.candles || [];
    } catch (intradayErr) {
      console.warn("Intraday candle fetch failed, falling back to historical:", intradayErr.message);
    }

    // If outside market hours or contract had no trades today, fallback to latest historical data
    if (candles.length === 0) {
      try {
        const todayStr = new Date().toISOString().split("T")[0];
        const histRes = await axios.get(
          `${UPSTOX_API_BASE}/historical-candle/${encodeURIComponent(
            instrumentToken
          )}/minutes/1/${todayStr}`,
          { headers }
        );
        const allHistCandles = histRes.data?.data?.candles || [];
        if (allHistCandles.length > 0) {
          // Filter to the latest available trading day/session to keep chart responsive and clean
          const latestDate = allHistCandles[0][0].split("T")[0];
          candles = allHistCandles.filter((c) => c[0].startsWith(latestDate));
          if (candles.length === 0) {
            candles = allHistCandles.slice(0, 375);
          }
        }
      } catch (histErr) {
        console.warn("Historical candle fallback also failed:", histErr.message);
      }
    }


    // Upstox format:
    // [timestamp, open, high, low, close, volume, open_interest]
    const formattedCandles = candles
      .map((candle) => ({
        time: Math.floor(new Date(candle[0]).getTime() / 1000),
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5]) || 0,
      }))
      .filter(
        (candle) =>
          Number.isFinite(candle.time) &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close)
      )
      .sort((a, b) => a.time - b.time);

    // Deduplicate candles with identical timestamps for lightweight-charts
    const uniqueCandles = [];
    for (let i = 0; i < formattedCandles.length; i++) {
      if (i === 0 || formattedCandles[i].time > formattedCandles[i - 1].time) {
        uniqueCandles.push(formattedCandles[i]);
      }
    }

    res.json(uniqueCandles);
  } catch (error) {
    console.error(
      "Candles API error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json({
      error: "Failed to fetch candles",
      details: error.response?.data || error.message,
    });
  }
});


module.exports = router;