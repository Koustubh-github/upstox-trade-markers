import { useEffect, useRef, useState, useMemo } from "react";
import {
  createChart,
  CandlestickSeries,
} from "lightweight-charts";
import "./App.css";

const API_BASE = "";

const mockTrades = [
  {
    id: 1,
    time: 600,
    side: "BUY",
    price: 18.1,
    lots: 1,
    quantity: 65,
    option: "NIFTY 22,850 PE",
    orderTime: "09:25 AM",
  },
  {
    id: 2,
    time: 900,
    side: "BUY",
    price: 17.8,
    lots: 2,
    quantity: 130,
    option: "NIFTY 22,850 PE",
    orderTime: "09:30 AM",
  },
  {
    id: 3,
    time: 1200,
    side: "BUY",
    price: 17.5,
    lots: 1,
    quantity: 65,
    option: "NIFTY 22,850 PE",
    orderTime: "09:35 AM",
  },
  {
    id: 4,
    time: 1800,
    side: "SELL",
    price: 19.2,
    lots: 1,
    quantity: 65,
    option: "NIFTY 22,850 PE",
    orderTime: "09:45 AM",
  },
  {
    id: 5,
    time: 2100,
    side: "BUY",
    price: 16.5,
    lots: 1,
    quantity: 65,
    option: "NIFTY 22,850 PE",
    orderTime: "09:50 AM",
  },
  {
    id: 6,
    time: 2400,
    side: "BUY",
    price: 16.7,
    lots: 2,
    quantity: 130,
    option: "NIFTY 22,850 PE",
    orderTime: "09:55 AM",
  },
  {
    id: 7,
    time: 3000,
    side: "SELL",
    price: 17.2,
    lots: 2,
    quantity: 130,
    option: "NIFTY 22,850 PE",
    orderTime: "10:05 AM",
  },
];

/*
  Align mock trades with candle timestamps so demo markers
  fall accurately onto the loaded intraday chart candles.
*/
/*
  Align mock trades with candle timestamps and generate realistic
  execution prices.

  Rules:
  1. Execution price must always be between ₹16 and ₹19.
  2. Execution price must always fall inside the candle's Low–High range.
  3. If the target candle doesn't overlap ₹16–₹19, find the nearest
     candle that does.
*/
function alignMockTradesToCandles(mockList, candles) {
  if (!candles || candles.length === 0) return mockList;

  const MIN_PRICE = 16;
  const MAX_PRICE = 19;

  /*
    Keep only candles whose actual Low-High range intersects
    the ₹16–₹19 range.
  */
  const validCandles = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle }) => {
      return candle.high >= MIN_PRICE && candle.low <= MAX_PRICE;
    });

  if (validCandles.length === 0) {
    return mockList;
  }

  /*
    Pick different candles spread across the valid region.
    This prevents all markers from landing on one candle.
  */
  const selectedCandles = mockList.map((_, tradeIndex) => {
    const position =
      mockList.length === 1
        ? 0
        : tradeIndex / (mockList.length - 1);

    const validIndex = Math.round(
      position * (validCandles.length - 1)
    );

    return validCandles[validIndex];
  });

  return mockList.map((trade, index) => {
    const { candle } = selectedCandles[index];

    /*
      The execution price MUST satisfy both:

      candle.low <= price <= candle.high
      ₹16 <= price <= ₹19
    */
    const validLow = Math.max(candle.low, MIN_PRICE);
    const validHigh = Math.min(candle.high, MAX_PRICE);

    /*
      Put the execution naturally inside the candle range,
      rather than always exactly at Low or High.
    */
    const positions = [0.35, 0.60, 0.45, 0.70, 0.30, 0.55, 0.50];

    const ratio = positions[index % positions.length];

    let price =
      validLow + (validHigh - validLow) * ratio;

    price = Number(price.toFixed(2));

    /*
      Final safety clamp.
    */
    price = Math.max(
      MIN_PRICE,
      Math.min(MAX_PRICE, price)
    );

    /*
      Final safety check against the actual candle.
      This handles very narrow ranges / rounding.
    */
    price = Math.max(
      candle.low,
      Math.min(candle.high, price)
    );

    price = Number(price.toFixed(2));

    const date = new Date(candle.time * 1000);

    return {
      ...trade,

      // Use the actual selected candle timestamp
      time: candle.time,

      // Price is derived from this candle's actual range
      price,

      orderTime: date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  });
}

/*
  OPTION-LEVEL P&L
*/
function calculateOptionPnL(trades) {
  let openQuantity = 0;
  let invested = 0;
  let realizedPnL = 0;

  for (const trade of trades) {
    if (trade.side === "BUY") {
      openQuantity += trade.quantity;
      invested += trade.price * trade.quantity;
    }

    if (trade.side === "SELL" && openQuantity > 0) {
      const sellQuantity = Math.min(trade.quantity, openQuantity);
      const averageEntry = invested / openQuantity;

      realizedPnL += (trade.price - averageEntry) * sellQuantity;
      invested -= averageEntry * sellQuantity;
      openQuantity -= sellQuantity;
    }
  }

  const averageEntry = openQuantity > 0 ? invested / openQuantity : 0;

  return {
    openQuantity,
    averageEntry,
    realizedPnL,
  };
}

function App() {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const markerElementsRef = useRef([]);
  const markerAnimationFrameRef = useRef(null);

  const [authStatus, setAuthStatus] = useState({
    authenticated: false,
    loading: true,
  });

  const [showTrades, setShowTrades] = useState(true);
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);

  const [trades, setTrades] = useState(mockTrades);
  const [chartCandles, setChartCandles] = useState([]);
  const [loadingCandles, setLoadingCandles] = useState(true);
  const [candleError, setCandleError] = useState(null);
  const [instrumentSymbol, setInstrumentSymbol] = useState("NIFTY 22,850 PE");

  const TRADE_THRESHOLD = 4;

  const visibleTrades = useMemo(() => {
    return showAllTrades || trades.length <= TRADE_THRESHOLD
      ? trades
      : trades.slice(-TRADE_THRESHOLD);
  }, [showAllTrades, trades]);

  // Keep refs in sync so asynchronous callbacks always read current state
  const visibleTradesRef = useRef(visibleTrades);
  visibleTradesRef.current = visibleTrades;

  const showTradesRef = useRef(showTrades);
  showTradesRef.current = showTrades;

  /*
    Check Upstox authentication status
  */
  useEffect(() => {
    fetch(`${API_BASE}/auth/status`)
      .then((res) => res.json())
      .then((data) => {
        setAuthStatus({
          authenticated: Boolean(data.authenticated),
          loading: false,
        });
      })
      .catch(() => {
        setAuthStatus({
          authenticated: false,
          loading: false,
        });
      });
  }, []);

  /*
    Fetch candles from backend (Upstox V3 Intraday)
  */
  useEffect(() => {
    let cancelled = false;

    const fetchCandles = async () => {
      try {
        setLoadingCandles(true);
        setCandleError(null);

        const response = await fetch(
          `${API_BASE}/api/candles/NSE_FO%7C56936`
        );

        if (response.status === 429) {
          throw new Error(
            "Upstox rate limit reached. Please wait a few seconds and refresh once."
          );
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch candles (${response.status})`);
        }

        const data = await response.json();

        if (!cancelled) {
          setChartCandles(data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Candle fetch error:", error);
          setCandleError(error.message);
        }
      } finally {
        if (!cancelled) {
          setLoadingCandles(false);
        }
      }
    };

    fetchCandles();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
    Fetch today's executed trades when authenticated
  */
  useEffect(() => {
    // Demo mode: Force skip fetching real trades to prevent 401 errors
    // and rely on the local mock trades instead.
    if (true) {
      return;
    }

    let cancelled = false;

    const fetchTrades = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/trades`);
        if (!response.ok) {
          return;
        }

        const result = await response.json();
        const apiTrades = Array.isArray(result)
          ? result
          : Array.isArray(result.data)
          ? result.data
          : [];

        if (apiTrades.length > 0 && !cancelled) {
          const formattedTrades = apiTrades.map((trade) => {
            const date = trade.time
              ? new Date(trade.time * 1000)
              : trade.timestamp
              ? new Date(trade.timestamp)
              : new Date();

            return {
              id: trade.tradeId || Math.random(),
              time: trade.time || Math.floor(date.getTime() / 1000),
              side: trade.side || "BUY",
              price: Number(trade.price) || 0,
              quantity: Number(trade.quantity) || 1,
              lots: 1,
              option: trade.symbol || "NIFTY 22,850 PE",
              orderTime: date.toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }),
              instrumentToken: trade.instrumentToken,
            };
          });

          setTrades(formattedTrades);
          if (formattedTrades[0]?.option) {
            setInstrumentSymbol(formattedTrades[0].option);
          }
        }
      } catch (error) {
        console.error("Trade fetch error:", error);
      }
    };

    fetchTrades();

    return () => {
      cancelled = true;
    };
  }, [authStatus.authenticated]);

  /*
    Align mock trades if running in demo / unauthenticated mode
  */
  useEffect(() => {
    // Demo mode: Always align mock trades regardless of auth status
    if (chartCandles.length > 0) {
      setTrades((prev) => alignMockTradesToCandles(mockTrades, chartCandles));
    }
  }, [chartCandles, authStatus.authenticated]);

  const optionPnL = calculateOptionPnL(trades);

  /*
    Position trade dots, lines and execution price labels
  */
  const updateTradeMarkers = () => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = chartContainerRef.current;

    if (!chart || !series || !container) {
      return;
    }

    const currentVisible = visibleTradesRef.current;
    const currentShow = showTradesRef.current;

    markerElementsRef.current.forEach(
      ({ marker, line, priceLabel, trade }) => {
        const x = chart.timeScale().timeToCoordinate(trade.time);
        const y = series.priceToCoordinate(trade.price);

        const isVisible = currentVisible.some((item) => item.id === trade.id);

        if (x === null || y === null || !currentShow || !isVisible) {
          marker.style.display = "none";
          line.style.display = "none";
          priceLabel.style.display = "none";
          return;
        }

        marker.style.display = "flex";
        line.style.display = "block";
        priceLabel.style.display = "flex";

        marker.style.left = `${x}px`;
        marker.style.top = `${y}px`;

        line.style.left = `${x + 16}px`;
        line.style.top = `${y}px`;
        line.style.width = `calc(100% - ${x + 16}px - 64px)`;

        priceLabel.style.top = `${y}px`;
      }
    );
  };

  const scheduleMarkerUpdate = () => {
    requestAnimationFrame(() => {
      updateTradeMarkers();
    });
  };

  /*
    CREATE CHART INSTANCE (Mount once)
  */
  useEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 600,
      layout: {
        background: { color: "#0b0f14" },
        textColor: "#d1d5db",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      rightPriceScale: {
        borderColor: "#374151",
      },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleRangeChange = () => {
      scheduleMarkerUpdate();
    };

    chart
      .timeScale()
      .subscribeVisibleLogicalRangeChange(handleRangeChange);

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width <= 0) return;
      chart.applyOptions({ width });
      scheduleMarkerUpdate();
    });

    resizeObserver.observe(container);

    /*
      Continuously synchronize the custom DOM trade markers with
      Lightweight Charts while the chart is being zoomed, dragged,
      scrolled, or vertically scaled.

      The candle chart is rendered by Lightweight Charts, while the
      trade markers/price lines are DOM elements. Recalculating their
      screen coordinates every animation frame keeps them locked to
      the corresponding candle and price.
    */
    const syncMarkers = () => {
      updateTradeMarkers();
      markerAnimationFrameRef.current =
        requestAnimationFrame(syncMarkers);
    };

    markerAnimationFrameRef.current =
      requestAnimationFrame(syncMarkers);

    return () => {
      resizeObserver.disconnect();
      chart
        .timeScale()
        .unsubscribeVisibleLogicalRangeChange(handleRangeChange);

      markerElementsRef.current.forEach(
        ({ marker, line, priceLabel }) => {
          marker.remove();
          line.remove();
          priceLabel.remove();
        }
      );
      markerElementsRef.current = [];
      if (markerAnimationFrameRef.current) {
        cancelAnimationFrame(markerAnimationFrameRef.current);
        markerAnimationFrameRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };

  }, []);

  /*
    UPDATE CANDLE DATA ON SERIES
  */
  useEffect(() => {
    if (!seriesRef.current || chartCandles.length === 0) {
      return;
    }

    seriesRef.current.setData(chartCandles);
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
    scheduleMarkerUpdate();
  }, [chartCandles]);

  /*
    CREATE / UPDATE DOM MARKERS WHEN TRADES OR CANDLES CHANGE
  */
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !chartRef.current) {
      return;
    }

    // Clean up old markers
    markerElementsRef.current.forEach(
      ({ marker, line, priceLabel }) => {
        marker.remove();
        line.remove();
        priceLabel.remove();
      }
    );
    markerElementsRef.current = [];

    // Create DOM markers for current trades
    trades.forEach((trade) => {
      const marker = document.createElement("button");
      marker.className =
        trade.side === "BUY"
          ? "trade-marker buy-marker"
          : "trade-marker sell-marker";
      marker.innerText = trade.lots;
      marker.title = `${trade.side} · ${trade.lots} lot${
        trade.lots > 1 ? "s" : ""
      } · ₹${trade.price}`;

      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedTrade(trade);
      });

      const line = document.createElement("div");
      line.className = "execution-line";

      const priceLabel = document.createElement("div");
      priceLabel.className =
        trade.side === "BUY"
          ? "trade-price-label buy-price-label"
          : "trade-price-label sell-price-label";
      priceLabel.innerText = `₹${Number(trade.price).toFixed(2)}`;

      container.appendChild(line);
      container.appendChild(priceLabel);
      container.appendChild(marker);

      markerElementsRef.current.push({
        marker,
        line,
        priceLabel,
        trade,
      });
    });

    scheduleMarkerUpdate();
  }, [trades, chartCandles]);

  /*
    Update marker visibility when filters change
  */
  useEffect(() => {
    scheduleMarkerUpdate();
  }, [showTrades, showAllTrades, visibleTrades]);

  // Current price from latest candle close or fallback
  const currentPrice = useMemo(() => {
    if (chartCandles.length > 0) {
      const last = chartCandles[chartCandles.length - 1];
      return last.close.toFixed(2);
    }
    return "17.10";
  }, [chartCandles]);

  return (
    <div className="app">
      {/* HEADER */}
      <header className="header">
        <div className="instrument">
          <h1>{instrumentSymbol}</h1>
          <p>22 Sep · 1m · Option Premium</p>
        </div>

        <div className="current-price">₹{currentPrice}</div>
      </header>

      {/* OPTION POSITION */}
      <section className="position-bar">
        <div className="position-item">
          <span>Open Position</span>
          <strong>{optionPnL.openQuantity} Qty</strong>
        </div>

        <div className="position-item">
          <span>Average Entry</span>
          <strong>₹{optionPnL.averageEntry.toFixed(2)}</strong>
        </div>

        <div className="position-item">
          <span>This Option P&L</span>
          <strong
            className={optionPnL.realizedPnL >= 0 ? "profit" : "loss"}
          >
            ₹{optionPnL.realizedPnL.toFixed(2)}
          </strong>
        </div>
      </section>

      {/* MAIN */}
      <main className="main-area">
        {/* CHART */}
        <section className="chart-section">
          {/* TOOLBAR */}
          <div className="chart-toolbar">
            <div className="toolbar-title">
              {trades.length} executions
              {trades.length > TRADE_THRESHOLD && (
                <span className="recent-label">
                  · Showing{" "}
                  {showAllTrades ? "all" : `latest ${TRADE_THRESHOLD}`}
                </span>
              )}
            </div>

            <div className="toolbar-actions">
              {/* Upstox auth status & login button */}
              {authStatus.authenticated ? (
                <span
                  style={{
                    fontSize: "11px",
                    color: "#4ade80",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "3px 8px",
                    background: "rgba(34, 197, 94, 0.1)",
                    borderRadius: "4px",
                    border: "1px solid rgba(34, 197, 94, 0.25)",
                  }}
                >
                  ● Upstox Live
                </span>
              ) : (
                <a
                  href={`${API_BASE}/auth/login`}
                  className="recent-button"
                  style={{
                    textDecoration: "none",
                    color: "#60a5fa",
                    borderColor: "#2563eb",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                  title="Log in with Upstox to view your account trades"
                >
                  Connect Upstox
                </a>
              )}

              {showTrades && trades.length > TRADE_THRESHOLD && (
                <button
                  className="recent-button"
                  onClick={() => setShowAllTrades((value) => !value)}
                >
                  {showAllTrades ? "Show recent 5" : "Show all"}
                </button>
              )}

              <label className="toggle">
                <span>Show my trades</span>
                <input
                  type="checkbox"
                  checked={showTrades}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setShowTrades(checked);
                    if (!checked) {
                      setShowAllTrades(false);
                    }
                  }}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>

          {/* CHART */}
          <div ref={chartContainerRef} className="chart-container" />
        </section>

        {/* EXECUTION DETAILS */}
        {selectedTrade && (
          <aside className="trade-details-panel">
            <div className="details-header">
              <div>
                <span
                  className={
                    selectedTrade.side === "BUY" ? "side buy" : "side sell"
                  }
                >
                  {selectedTrade.side}
                </span>
                <h2>{selectedTrade.option}</h2>
              </div>

              <button
                className="close-button"
                onClick={() => setSelectedTrade(null)}
              >
                ×
              </button>
            </div>

            <div className="execution-price">
              ₹{selectedTrade.price.toFixed(2)}
            </div>

            <div className="detail-grid">
              <div>
                <span>Lots</span>
                <strong>{selectedTrade.lots}</strong>
              </div>

              <div>
                <span>Quantity</span>
                <strong>{selectedTrade.quantity}</strong>
              </div>

              <div>
                <span>Execution Time</span>
                <strong>{selectedTrade.orderTime}</strong>
              </div>

              <div>
                <span>Option P&L</span>
                <strong
                  className={
                    optionPnL.realizedPnL >= 0 ? "profit" : "loss"
                  }
                >
                  ₹{optionPnL.realizedPnL.toFixed(2)}
                </strong>
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* LEGEND */}
      <div className="legend">
        <div>
          <span className="buy-dot"></span>
          Buy
        </div>
        <div>
          <span className="sell-dot"></span>
          Sell
        </div>
      </div>
    </div>
  );
}

export default App;