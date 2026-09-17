require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const tradeRoutes = require("./routes/trades");
const candleRoutes = require("./routes/candles");
const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend is running",
  });
});

app.use("/auth", authRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/candles", candleRoutes);
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});