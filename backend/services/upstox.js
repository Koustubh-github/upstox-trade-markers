const axios = require("axios");

const UPSTOX_API_BASE = "https://api.upstox.com/v2";

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    code,
    client_id: process.env.UPSTOX_CLIENT_ID,
    client_secret: process.env.UPSTOX_CLIENT_SECRET,
    redirect_uri: process.env.UPSTOX_REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const response = await axios.post(
    `${UPSTOX_API_BASE}/login/authorization/token`,
    params.toString(),
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data;
}

function parseExchangeTimestamp(raw) {
  if (!raw) return null;
  if (typeof raw === "number") return Math.floor(raw > 1e11 ? raw / 1000 : raw);

  const directDate = new Date(raw);
  if (!isNaN(directDate.getTime())) {
    return Math.floor(directDate.getTime() / 1000);
  }

  // Handle formats like "03-Aug-2017 15:03:42" or "17-09-2026 09:25:00"
  const match = String(raw).match(
    /^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/
  );
  if (match) {
    const [, day, month, year, h, m, s] = match;
    const parsed = new Date(`${day} ${month} ${year} ${h}:${m}:${s} GMT+0530`);
    if (!isNaN(parsed.getTime())) {
      return Math.floor(parsed.getTime() / 1000);
    }
  }

  return null;
}

async function getTrades(accessToken) {
  const response = await axios.get(
    `${UPSTOX_API_BASE}/order/trades/get-trades-for-day`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const trades = response.data?.data || [];

  return trades.map((trade) => {
    const timeInSeconds = parseExchangeTimestamp(trade.exchange_timestamp);
    return {
      instrumentToken: trade.instrument_token,
      symbol: trade.trading_symbol || trade.tradingsymbol,
      side: trade.transaction_type,
      quantity: Number(trade.quantity) || 0,
      price: Number(trade.average_price) || 0,
      timestamp: trade.exchange_timestamp,
      time: timeInSeconds,
      tradeId: trade.trade_id,
    };
  });
}

module.exports = {
  exchangeCodeForToken,
  getTrades,
};