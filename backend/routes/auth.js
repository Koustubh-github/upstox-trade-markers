const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { exchangeCodeForToken } = require("../services/upstox");

const router = express.Router();

const TOKEN_FILE = path.join(__dirname, "../.token.json");
const COOKIE_NAME = "upstox_session";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET environment variable is required in production");
  }
  return secret || "dev_local_fallback_secret_32bytes!!";
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptToken(token) {
  if (!token) return null;
  const secret = getSecret();
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decryptToken(encryptedData) {
  if (!encryptedData) return null;
  try {
    const parts = encryptedData.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, encryptedHex] = parts;
    const secret = getSecret();
    const key = deriveKey(secret);
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    return null;
  }
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(";").forEach((cookie) => {
      const parts = cookie.split("=");
      list[parts.shift().trim()] = decodeURIComponent(parts.join("="));
    });
  }
  return list;
}

function setTokenCookie(res, token) {
  const encrypted = encryptToken(token);
  const isProd = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const cookieOptions = [
    `${COOKIE_NAME}=${encodeURIComponent(encrypted)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${isProd ? "Lax" : "Lax"}`,
    "Max-Age=86400",
  ];
  if (isProd) {
    cookieOptions.push("Secure");
  }
  res.setHeader("Set-Cookie", cookieOptions.join("; "));
}

function clearTokenCookie(res) {
  const isProd = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const cookieOptions = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${isProd ? "Lax" : "Lax"}`,
    "Max-Age=0",
  ];
  if (isProd) {
    cookieOptions.push("Secure");
  }
  res.setHeader("Set-Cookie", cookieOptions.join("; "));
}

// Local dev fallback disk helpers
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
    // Ignore write errors on read-only serverless disk
  }
}

function clearTokenFromDisk() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch (err) {
    // Ignore deletion errors
  }
}

let devMemoryToken = loadTokenFromDisk();

function extractAccessToken(req) {
  const cookies = parseCookies(req);
  const cookieToken = decryptToken(cookies[COOKIE_NAME]);
  if (cookieToken) {
    return cookieToken;
  }
  return devMemoryToken;
}

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

    const token = tokenData.access_token;
    devMemoryToken = token;
    saveTokenToDisk(token);
    setTokenCookie(res, token);

    console.log("Upstox authentication successful");

    res.redirect(process.env.FRONTEND_URL || "/");
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
  const token = extractAccessToken(req);
  res.json({
    authenticated: Boolean(token),
  });
});

router.post("/logout", (req, res) => {
  devMemoryToken = null;
  clearTokenFromDisk();
  clearTokenCookie(res);
  res.json({ success: true, authenticated: false });
});

// Helper for other routes to retrieve access token from request
router.getAccessToken = (req) => extractAccessToken(req);

module.exports = router;