const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { exchangeCodeForToken } = require("../services/upstox");

const router = express.Router();

const TOKEN_FILE = path.join(__dirname, "../.token.json");

// Helper to load token safely from disk on startup
function loadTokenFromDisk() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
      if (data && data.access_token) {
        return data.access_token;
      }
    }
  } catch (err) {
    // Ignore read errors
  }
  return null;
}

// Helper to save token safely to disk
function saveTokenToDisk(token) {
  try {
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify({
        access_token: token,
        saved_at: new Date().toISOString(),
      }),
      { mode: 0o600 }
    );
  } catch (err) {
    console.error("Failed to persist token locally:", err.message);
  }
}

// Helper to clear token
function clearTokenFromDisk() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch (err) {
    // Ignore deletion errors
  }
}

let accessToken = loadTokenFromDisk();

router.get("/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.UPSTOX_CLIENT_ID,
    redirect_uri: process.env.UPSTOX_REDIRECT_URI,
    state,
  });

  router.oauthState = state;

  const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?${params.toString()}`;
  res.redirect(loginUrl);
});

router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).json({
        error: "Authorization code missing",
      });
    }

    if (!state || state !== router.oauthState) {
      return res.status(400).json({
        error: "Invalid OAuth state",
      });
    }

    router.oauthState = null;

    const tokenData = await exchangeCodeForToken(code);

    accessToken = tokenData.access_token;
    saveTokenToDisk(accessToken);

    console.log("Upstox authentication successful");

    res.redirect("http://localhost:5173");
  } catch (error) {
    console.error(
      "OAuth callback error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      error: "Failed to authenticate with Upstox",
      details: error.response?.data || error.message,
    });
  }
});

router.get("/status", (req, res) => {
  res.json({
    authenticated: Boolean(accessToken),
  });
});

router.post("/logout", (req, res) => {
  accessToken = null;
  clearTokenFromDisk();
  res.json({ success: true, authenticated: false });
});

// Make token available to other routes (never exposed via HTTP response)
router.getAccessToken = () => accessToken;

module.exports = router;