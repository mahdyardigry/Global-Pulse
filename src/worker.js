const BYBIT = "https://api.bybit.com";
const VERSION = "GLOBAL-PULSE-CRYPTO-DEEP-V1";

const KLINE_LIMIT = 200;
const TRADE_LIMIT = 1000;
const ORDERBOOK_LIMIT = 50;

const BLOCKED = [
  "iran",
  "iranian",
  "islamic republic of iran",
  "tehran",
  "persia",
  "persian",
  "ایران",
  "ایرانی",
  "تهران"
];

/* =========================================================
   RESPONSE
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Content-Type"
    }
  });
}

/* =========================================================
   HELPERS
========================================================= */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clean(v) {
  return String(v || "").trim();
}

function upper(v) {
  return clean(v).toUpperCase();
}

function blocked(text) {
  const s = clean(text).toLowerCase();
  return BLOCKED.some(x => s.includes(x.toLowerCase()));
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function pct(a, b) {
  if (!b) return 0;
  return ((a - b) / b) * 100;
}

function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}

function formatPrice(v) {
  const n = num(v);
  if (!n) return "0";

  if (n >= 1000) {
    return n.toLocaleString("en-US", {
      maximumFractionDigits: 2
    });
  }

  if (n >= 1) {
    return n.toLocaleString("en-US", {
      maximumFractionDigits: 4
    });
  }

  return n.toLocaleString("en-US", {
    maximumFractionDigits: 8
  });
}

/* =========================================================
   BYBIT REQUEST
========================================================= */

async function bybit(path, params = {}) {
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      qs.set(k, String(v));
    }
  }

  const url = `${BYBIT}${path}?${qs.toString()}`;

  const r = await fetch(url, {
    headers: {
      "accept": "application/json"
    }
  });

  if (!r.ok) {
    throw new Error(`Bybit HTTP ${r.status}`);
  }

  const data = await r.json();

  if (data.retCode !== 0) {
    throw new Error(
      `Bybit ${data.retCode}: ${data.retMsg || "API error"}`
    );
  }

  return data.result;
}

/* =========================================================
   FIND SYMBOL
   Futures first.
   No user category selection.
========================================================= */

async function findSymbol(input) {
  let symbol = upper(input);

  symbol = symbol
    .replace(/\s+/g, "")
    .replace(/[-_/]/g, "");

  if (!symbol.endsWith("USDT")) {
    symbol += "USDT";
  }

  /* ---------- LINEAR FUTURES ---------- */

  try {
    const result = await bybit(
      "/v5/market/instruments-info",
      {
        category: "linear",
        symbol
      }
    );

    const item =
      result.list &&
      result.list.find(
        x => upper(x.symbol) === symbol
      );

    if (item) {
      return {
        found: true,
        category: "linear",
        market: "Futures",
        symbol: item.symbol,
        baseCoin: item.baseCoin || "",
        quoteCoin: item.quoteCoin || "",
        contractType: item.contractType || "",
        raw: item
      };
    }
  } catch (_) {}

  /* ---------- SPOT ---------- */

  try {
    const result = await bybit(
      "/v5/market/instruments-info",
      {
        category: "spot",
        symbol
      }
    );

    const item =
      result.list &&
      result.list.find(
        x => upper(x.symbol) === symbol
      );

    if (item) {
      return {
        found: true,
        category: "spot",
        market: "Spot",
        symbol: item.symbol,
        baseCoin: item.baseCoin || "",
        quoteCoin: item.quoteCoin || "",
        contractType: "",
        raw: item
      };
    }
  } catch (_) {}

  return {
    found: false,
    symbol
  };
}

/* =========================================================
   KLINES
========================================================= */

function parseKlines(list) {
  return (list || [])
    .map(x => ({
      time: num(x[0]),
      open: num(x[1]),
      high: num(x[2]),
      low: num(x[3]),
      close: num(x[4]),
      volume: num(x[5]),
      turnover: num(x[6])
    }))
    .reverse();
}

async function getKlines(category, symbol, interval) {
  const result = await bybit(
    "/v5/market/kline",
    {
      category,
      symbol,
      interval,
      limit: KLINE_LIMIT
    }
  );

  return parseKlines(result.list);
}

/* =========================================================
   INDICATORS
========================================================= */

function sma(values, period) {
  if (values.length < period) return null;

  return avg(
    values.slice(values.length - period)
  );
}

function ema(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);

  let e =
    avg(values.slice(0, period));

  for (let i = period; i < values.length; i++) {
    e =
      values[i] * k +
      e * (1 - k);
  }

  return e;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];

    if (d >= 0) gain += d;
    else loss -= d;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];

    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);

    avgGain =
      ((avgGain * (period - 1)) + g) / period;

    avgLoss =
      ((avgLoss * (period - 1)) + l) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const tr = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];

    tr.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      )
    );
  }

  return avg(
    tr.slice(-period)
  );
}

function macd(values) {
  if (values.length < 35) return null;

  const fast = ema(values, 12);
  const slow = ema(values, 26);

  if (fast === null || slow === null) {
    return null;
  }

  return fast - slow;
}

function bollinger(values, period = 20) {
  if (values.length < period) return null;

  const data =
    values.slice(-period);

  const mean = avg(data);

  const variance =
    avg(
      data.map(x =>
        Math.pow(x - mean, 2)
      )
    );

  const sd = Math.sqrt(variance);

  return {
    middle: mean,
    upper: mean + sd * 2,
    lower: mean - sd * 2,
    width: mean
      ? ((sd * 4) / mean) * 100
      : 0
  };
}

/* =========================================================
   TREND
========================================================= */

function trendAnalysis(candles) {
  const closes =
    candles.map(x => x.close);

  const price =
    closes[closes.length - 1];

  const ma20 =
    sma(closes, 20);

  const ma50 =
    sma(closes, 50);

  const ma100 =
    sma(closes, 100);

  let direction = "NEUTRAL";
  let score = 50;

  if (ma20 && ma50) {
    if (
      price > ma20 &&
      ma20 > ma50
    ) {
      direction = "BULLISH";
      score = 80;
    } else if (
      price < ma20 &&
      ma20 < ma50
    ) {
      direction = "BEARISH";
      score = 20;
    } else if (price > ma20) {
      direction = "BULLISH";
      score = 65;
    } else if (price < ma20) {
      direction = "BEARISH";
      score = 35;
    }
  }

  return {
    direction,
    score,
    price,
    ma20,
    ma50,
    ma100
  };
}

/* =========================================================
   SUPPORT / RESISTANCE
========================================================= */

function supportResistance(candles) {
  if (candles.length < 30) {
    return {
      supports: [],
      resistances: []
    };
  }

  const highs =
    candles.map(x => x.high);

  const lows =
    candles.map(x => x.low);

  const price =
    candles[candles.length - 1].close;

  const levels = [];

  for (let i = 2; i < candles.length - 2; i++) {

    const h = highs[i];

    if (
      h >= highs[i - 1] &&
      h >= highs[i - 2] &&
      h >= highs[i + 1] &&
      h >= highs[i + 2]
    ) {
      levels.push({
        price: h,
        type: "resistance"
      });
    }

    const l = lows[i];

    if (
      l <= lows[i - 1] &&
      l <= lows[i - 2] &&
      l <= lows[i + 1] &&
      l <= lows[i + 2]
    ) {
      levels.push({
        price: l,
        type: "support"
      });
    }
  }

  const supports =
    levels
      .filter(x => x.type === "support")
      .filter(x => x.price < price)
      .sort(
        (a, b) =>
          Math.abs(price - a.price) -
          Math.abs(price - b.price)
      )
      .slice(0, 5);

  const resistances =
    levels
      .filter(x => x.type === "resistance")
      .filter(x => x.price > price)
      .sort(
        (a, b) =>
          Math.abs(price - a.price) -
          Math.abs(price - b.price)
      )
      .slice(0, 5);

  return {
    supports,
    resistances
  };
}

/* =========================================================
   LIQUIDITY / HUNT
========================================================= */

function liquidityHunt(candles) {
  if (candles.length < 20) {
    return {
      detected: false,
      type: "NONE",
      reason: "Insufficient data"
    };
  }

  const current =
    candles[candles.length - 1];

  const previous =
    candles.slice(-20, -1);

  const previousHigh =
    Math.max(...previous.map(x => x.high));

  const previousLow =
    Math.min(...previous.map(x => x.low));

  const bullishSweep =
    current.low < previousLow &&
    current.close > previousLow;

  const bearishSweep =
    current.high > previousHigh &&
    current.close < previousHigh;

  if (bullishSweep) {
    return {
      detected: true,
      type: "BULLISH LIQUIDITY SWEEP",
      reason:
        "Price swept the previous low and closed back above it.",
      level: previousLow
    };
  }

  if (bearishSweep) {
    return {
      detected: true,
      type: "BEARISH LIQUIDITY SWEEP",
      reason:
        "Price swept the previous high and closed back below it.",
      level: previousHigh
    };
  }

  return {
    detected: false,
    type: "NONE",
    reason:
      "No confirmed liquidity sweep in the sampled candles."
  };
}

/* =========================================================
   FOOTPRINT
========================================================= */

async function footprint(category, symbol) {

  const result =
    await bybit(
      "/v5/market/recent-trade",
      {
        category,
        symbol,
        limit: TRADE_LIMIT
      }
    );

  const trades =
    result.list || [];

  let buyVolume = 0;
  let sellVolume = 0;

  let buyNotional = 0;
  let sellNotional = 0;

  const notionals = [];

  for (const t of trades) {

    const qty = num(t.size);
    const price = num(t.price);

    const notional =
      qty * price;

    notionals.push(notional);

    if (
      String(t.side).toLowerCase() ===
      "buy"
    ) {
      buyVolume += qty;
      buyNotional += notional;
    } else {
      sellVolume += qty;
      sellNotional += notional;
    }
  }

  const total =
    buyVolume + sellVolume;

  const delta =
    buyVolume - sellVolume;

  const deltaPercent =
    total
      ? (delta / total) * 100
      : 0;

  const med =
    median(notionals);

  const largeThreshold =
    med * 5;

  let largeBuy = 0;
  let largeSell = 0;

  for (const t of trades) {

    const qty = num(t.size);
    const price = num(t.price);

    const n = qty * price;

    if (n < largeThreshold) {
      continue;
    }

    if (
      String(t.side).toLowerCase() ===
      "buy"
    ) {
      largeBuy += n;
    } else {
      largeSell += n;
    }
  }

  let pressure = "NEUTRAL";

  if (deltaPercent >= 10) {
    pressure = "BUY PRESSURE";
  } else if (deltaPercent <= -10) {
    pressure = "SELL PRESSURE";
  }

  return {
    trades: trades.length,
    buyVolume,
    sellVolume,
    buyNotional,
    sellNotional,
    delta,
    deltaPercent,
    largeBuy,
    largeSell,
    largeThreshold,
    pressure
  };
}

/* =========================================================
   ORDER BOOK
========================================================= */

async function orderBook(category, symbol) {

  const result =
    await bybit(
      "/v5/market/orderbook",
      {
        category,
        symbol,
        limit: ORDERBOOK_LIMIT
      }
    );

  const bids =
    result.b || [];

  const asks =
    result.a || [];

  let bidLiquidity = 0;
  let askLiquidity = 0;

  for (const b of bids) {
    bidLiquidity +=
      num(b[0]) * num(b[1]);
  }

  for (const a of asks) {
    askLiquidity +=
      num(a[0]) * num(a[1]);
  }

  const total =
    bidLiquidity + askLiquidity;

  const buyShare =
    total
      ? bidLiquidity / total * 100
      : 50;

  const sellShare =
    total
      ? askLiquidity / total * 100
      : 50;

  let pressure = "NEUTRAL";

  if (buyShare > sellShare + 8) {
    pressure = "BUY PRESSURE";
  } else if (
    sellShare > buyShare + 8
  ) {
    pressure = "SELL PRESSURE";
  }

  const buyWalls =
    bids
      .map(x => ({
        price: num(x[0]),
        quantity: num(x[1]),
        value:
          num(x[0]) * num(x[1])
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

  const sellWalls =
    asks
      .map(x => ({
        price: num(x[0]),
        quantity: num(x[1]),
        value:
          num(x[0]) * num(x[1])
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

  return {
    bidLiquidity,
    askLiquidity,
    totalLiquidity: total,
    buyShare,
    sellShare,
    pressure,
    bestBid:
      bids.length ? num(bids[0][0]) : 0,
    bestAsk:
      asks.length ? num(asks[0][0]) : 0,
    buyWalls,
    sellWalls
  };
}

/* =========================================================
   FUTURES DATA
========================================================= */

async function futuresData(symbol) {

  const output = {
    available: true,
    openInterest: null,
    openInterestValue: null,
    fundingRate: null
  };

  try {

    const oi =
      await bybit(
        "/v5/market/open-interest",
        {
          category: "linear",
          symbol,
          intervalTime: "5min",
          limit: 50
        }
      );

    const list =
      oi.list || [];

    if (list.length) {

      const latest =
        list[0];

      output.openInterest =
        num(
          latest.openInterest
        );

      output.openInterestValue =
        num(
          latest.openInterestValue
        );
    }

  } catch (_) {}

  try {

    const funding =
      await bybit(
        "/v5/market/funding/history",
        {
          category: "linear",
          symbol,
          limit: 1
        }
      );

    const list =
      funding.list || [];

    if (list.length) {

      output.fundingRate =
        num(
          list[0].fundingRate
        );
    }

  } catch (_) {}

  return output;
}

/* =========================================================
   STYLE ANALYSIS
========================================================= */

function styleAnalysis(data) {

  const {
    trend,
    rsiValue,
    macdValue,
    footprint,
    orderbook,
    hunt,
    atrValue,
    price
  } = data;

  const styles = [];

  /* Scalping */

  let scalpScore = 50;
  const scalpReasons = [];

  if (
    footprint.pressure ===
    "BUY PRESSURE"
  ) {
    scalpScore += 18;
    scalpReasons.push(
      "Aggressive executed buying is dominant."
    );
  }

  if (
    footprint.pressure ===
    "SELL PRESSURE"
  ) {
    scalpScore -= 18;
    scalpReasons.push(
      "Aggressive executed selling is dominant."
    );
  }

  if (
    orderbook.pressure ===
    "BUY PRESSURE"
  ) {
    scalpScore += 12;
    scalpReasons.push(
      "Bid-side order-book liquidity is dominant."
    );
  }

  if (
    orderbook.pressure ===
    "SELL PRESSURE"
  ) {
    scalpScore -= 12;
    scalpReasons.push(
      "Ask-side order-book liquidity is dominant."
    );
  }

  styles.push({
    name: "Scalping",
    score: Math.max(0, Math.min(100, scalpScore)),
    view:
      scalpScore >= 65
        ? "BULLISH"
        : scalpScore <= 35
          ? "BEARISH"
          : "NEUTRAL",
    reasons: scalpReasons
  });

  /* Day Trading */

  let dayScore = 50;
  const dayReasons = [];

  if (trend.direction === "BULLISH") {
    dayScore += 20;
    dayReasons.push(
      "Price structure is above the short/medium moving averages."
    );
  }

  if (trend.direction === "BEARISH") {
    dayScore -= 20;
    dayReasons.push(
      "Price structure is below the short/medium moving averages."
    );
  }

  if (rsiValue > 55) {
    dayScore += 10;
    dayReasons.push(
      "RSI confirms positive momentum."
    );
  } else if (rsiValue < 45) {
    dayScore -= 10;
    dayReasons.push(
      "RSI confirms negative momentum."
    );
  }

  styles.push({
    name: "Day Trading",
    score: Math.max(0, Math.min(100, dayScore)),
    view:
      dayScore >= 65
        ? "BULLISH"
        : dayScore <= 35
          ? "BEARISH"
          : "NEUTRAL",
    reasons: dayReasons
  });

  /* Swing */

  let swingScore =
    trend.score;

  const swingReasons = [];

  swingReasons.push(
    `Primary structure: ${trend.direction}.`
  );

  if (
    macdValue !== null
  ) {
    if (macdValue > 0) {
      swingScore += 8;
      swingReasons.push(
        "MACD is above its zero baseline."
      );
    } else {
      swingScore -= 8;
      swingReasons.push(
        "MACD is below its zero baseline."
      );
    }
  }

  styles.push({
    name: "Swing Trading",
    score: Math.max(0, Math.min(100, swingScore)),
    view:
      swingScore >= 65
        ? "BULLISH"
        : swingScore <= 35
          ? "BEARISH"
          : "NEUTRAL",
    reasons: swingReasons
  });

  /* Momentum */

  let momentum =
    50;

  const momentumReasons = [];

  if (rsiValue >= 55) {
    momentum += 20;
    momentumReasons.push(
      "Momentum favors buyers."
    );
  }

  if (rsiValue <= 45) {
    momentum -= 20;
    momentumReasons.push(
      "Momentum favors sellers."
    );
  }

  if (
    footprint.deltaPercent > 10
  ) {
    momentum += 15;
    momentumReasons.push(
      "Positive trade delta supports upside momentum."
    );
  }

  if (
    footprint.deltaPercent < -10
  ) {
    momentum -= 15;
    momentumReasons.push(
      "Negative trade delta supports downside momentum."
    );
  }

  styles.push({
    name: "Momentum",
    score: Math.max(0, Math.min(100, momentum)),
    view:
      momentum >= 65
        ? "BULLISH"
        : momentum <= 35
          ? "BEARISH"
          : "NEUTRAL",
    reasons: momentumReasons
  });

  /* Smart Money */

  let sm = 50;
  const smReasons = [];

  if (hunt.detected) {

    if (
      hunt.type.includes("BULLISH")
    ) {
      sm += 25;
      smReasons.push(
        "Bullish liquidity sweep detected."
      );
    }

    if (
      hunt.type.includes("BEARISH")
    ) {
      sm -= 25;
      smReasons.push(
        "Bearish liquidity sweep detected."
      );
    }
  } else {
    smReasons.push(
      "No confirmed liquidity sweep in the sampled data."
    );
  }

  if (
    orderbook.pressure ===
    "BUY PRESSURE"
  ) {
    sm += 10;
    smReasons.push(
      "Buy-side resting liquidity is stronger."
    );
  }

  if (
    orderbook.pressure ===
    "SELL PRESSURE"
  ) {
    sm -= 10;
    smReasons.push(
      "Sell-side resting liquidity is stronger."
    );
  }

  styles.push({
    name: "Smart Money",
    score: Math.max(0, Math.min(100, sm)),
    view:
      sm >= 65
        ? "BULLISH"
        : sm <= 35
          ? "BEARISH"
          : "NEUTRAL",
    reasons: smReasons
  });

  return styles;
}

/* =========================================================
   DEEP ANALYSIS
========================================================= */

async function analyzeSymbol(input) {

  const found =
    await findSymbol(input);

  if (!found.found) {

    return {
      ok: false,
      error:
        `Symbol ${found.symbol} was not found`
    };
  }

  const category =
    found.category;

  const symbol =
    found.symbol;

  const [
    candles1m,
    candles15m,
    candles1h,
    footprintData,
    orderBookData
  ] =
    await Promise.all([
      getKlines(category, symbol, "1"),
      getKlines(category, symbol, "15"),
      getKlines(category, symbol, "60"),
      footprint(category, symbol),
      orderBook(category, symbol)
    ]);

  if (
    !candles1m.length ||
    !candles15m.length
  ) {
    throw new Error(
      "Insufficient market data"
    );
  }

  const close1m =
    candles1m.map(x => x.close);

  const close15m =
    candles15m.map(x => x.close);

  const trend1m =
    trendAnalysis(candles1m);

  const trend15m =
    trendAnalysis(candles15m);

  const rsiValue =
    rsi(close1m, 14);

  const macdValue =
    macd(close1m);

  const atrValue =
    atr(candles1m, 14);

  const bollingerValue =
    bollinger(close1m, 20);

  const levels =
    supportResistance(candles1m);

  const hunt =
    liquidityHunt(candles1m);

  let futures = null;

  if (
    category === "linear"
  ) {
    futures =
      await futuresData(symbol);
  }

  const styles =
    styleAnalysis({
      trend: trend1m,
      rsiValue,
      macdValue,
      footprint: footprintData,
      orderbook: orderBookData,
      hunt,
      atrValue,
      price: trend1m.price
    });

  const confirmations = [];

  if (
    trend1m.direction ===
    trend15m.direction
  ) {
    confirmations.push(
      `1m and 15m trend agree: ${trend1m.direction}`
    );
  } else {
    confirmations.push(
      "1m and 15m trends are not fully aligned."
    );
  }

  if (
    footprintData.pressure ===
    "BUY PRESSURE"
  ) {
    confirmations.push(
      "Executed trade flow favors buyers."
    );
  }

  if (
    footprintData.pressure ===
    "SELL PRESSURE"
  ) {
    confirmations.push(
      "Executed trade flow favors sellers."
    );
  }

  if (
    orderBookData.pressure ===
    "BUY PRESSURE"
  ) {
    confirmations.push(
      "Resting order-book liquidity favors buyers."
    );
  }

  if (
    orderBookData.pressure ===
    "SELL PRESSURE"
  ) {
    confirmations.push(
      "Resting order-book liquidity favors sellers."
    );
  }

  if (hunt.detected) {
    confirmations.push(
      hunt.type
    );
  }

  let overall =
    avg(
      styles.map(x => x.score)
    );

  if (
    trend15m.direction ===
    trend1m.direction
  ) {
    overall += 5;
  }

  overall =
    Math.max(
      0,
      Math.min(100, overall)
    );

  let verdict =
    "NEUTRAL";

  if (overall >= 65) {
    verdict = "BULLISH";
  } else if (overall <= 35) {
    verdict = "BEARISH";
  }

  return {
    ok: true,

    version: VERSION,

    symbol,
    baseCoin: found.baseCoin,
    quoteCoin: found.quoteCoin,

    market: {
      category,
      type: found.market
    },

    price: trend1m.price,

    trend: {
      oneMinute: trend1m,
      fifteenMinute: trend15m
    },

    indicators: {
      rsi: rsiValue,
      macd: macdValue,
      atr: atrValue,
      bollinger: bollingerValue
    },

    supportResistance: levels,

    liquidity: {
      hunt
    },

    footprint: footprintData,

    orderBook: orderBookData,

    futures,

    styles,

    confirmations,

    overallScore: round(overall, 1),

    verdict,

    source: "Bybit"
  };
}

/* =========================================================
   HTML ANALYSIS PAGE
========================================================= */

function htmlEscape(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function analysisHtml(data) {

  if (!data.ok) {
    return `
      <div class="error">
        ❌ ${htmlEscape(data.error)}
      </div>
    `;
  }

  const styles =
    data.styles
      .map(s => `
        <div class="style">
          <div class="style-top">
            <b>${htmlEscape(s.name)}</b>
            <span>${htmlEscape(s.view)}</span>
          </div>
          <div class="bar">
            <i style="width:${s.score}%"></i>
          </div>
          <strong>${s.score}/100</strong>
          <ul>
            ${s.reasons.map(r =>
              `<li>${htmlEscape(r)}</li>`
            ).join("")}
          </ul>
        </div>
      `)
      .join("");

  const supports =
    data.supportResistance.supports
      .map(x => formatPrice(x.price))
      .join(" • ") || "No confirmed level";

  const resistances =
    data.supportResistance.resistances
      .map(x => formatPrice(x.price))
      .join(" • ") || "No confirmed level";

  const f =
    data.footprint;

  const ob =
    data.orderBook;

  const hunt =
    data.liquidity.hunt;

  return `
    <section class="result">

      <div class="coin-head">
        <div>
          <small>DEEP MARKET ANALYSIS</small>
          <h2>🪙 ${htmlEscape(data.symbol)}</h2>
        </div>

        <div class="verdict ${data.verdict.toLowerCase()}">
          ${data.verdict}
          <small>${data.overallScore}/100</small>
        </div>
      </div>

      <div class="cards">

        <div class="card">
          <small>PRICE</small>
          <b>${formatPrice(data.price)}</b>
        </div>

        <div class="card">
          <small>1M TREND</small>
          <b>${data.trend.oneMinute.direction}</b>
        </div>

        <div class="card">
          <small>15M CONFIRMATION</small>
          <b>${data.trend.fifteenMinute.direction}</b>
        </div>

        <div class="card">
          <small>RSI</small>
          <b>${round(data.indicators.rsi,2)}</b>
        </div>

      </div>

      <h3>📊 Trading Styles</h3>
      ${styles}

      <h3>🎯 Support / Resistance</h3>

      <div class="levels">

        <div>
          <b>🟢 Support</b>
          <p>${htmlEscape(supports)}</p>
        </div>

        <div>
          <b>🔴 Resistance</b>
          <p>${htmlEscape(resistances)}</p>
        </div>

      </div>

      <h3>💧 Liquidity / Hunt</h3>

      <div class="data-box">
        <b>${htmlEscape(hunt.type)}</b>
        <p>${htmlEscape(hunt.reason)}</p>
        ${
          hunt.level
            ? `<small>Level: ${formatPrice(hunt.level)}</small>`
            : ""
        }
      </div>

      <h3>👣 Footprint</h3>

      <div class="data-grid">

        <div>
          Buy Volume
          <b>${round(f.buyVolume,4)}</b>
        </div>

        <div>
          Sell Volume
          <b>${round(f.sellVolume,4)}</b>
        </div>

        <div>
          Delta
          <b>${round(f.delta,4)}</b>
        </div>

        <div>
          Delta %
          <b>${round(f.deltaPercent,2)}%</b>
        </div>

        <div>
          Pressure
          <b>${f.pressure}</b>
        </div>

        <div>
          Large Buy
          <b>$${Math.round(f.largeBuy).toLocaleString()}</b>
        </div>

        <div>
          Large Sell
          <b>$${Math.round(f.largeSell).toLocaleString()}</b>
        </div>

      </div>

      <h3>📚 Order Book</h3>

      <div class="data-grid">

        <div>
          Buy Share
          <b>${round(ob.buyShare,2)}%</b>
        </div>

        <div>
          Sell Share
          <b>${round(ob.sellShare,2)}%</b>
        </div>

        <div>
          Best Bid
          <b>${formatPrice(ob.bestBid)}</b>
        </div>

        <div>
          Best Ask
          <b>${formatPrice(ob.bestAsk)}</b>
        </div>

        <div>
          Pressure
          <b>${ob.pressure}</b>
        </div>

      </div>

      ${
        data.futures
          ? `
            <h3>⚡ Derivatives Data</h3>

            <div class="data-grid">

              <div>
                Open Interest
                <b>${data.futures.openInterest ?? "N/A"}</b>
              </div>

              <div>
                OI Value
                <b>$${data.futures.openInterestValue
                  ? Math.round(data.futures.openInterestValue).toLocaleString()
                  : "N/A"}</b>
              </div>

              <div>
                Funding
                <b>${data.futures.fundingRate !== null
                  ? data.futures.fundingRate
                  : "N/A"}</b>
              </div>

            </div>
          `
          : ""
      }

      <h3>🧠 Deep Conclusion</h3>

      <div class="conclusion">
        ${
          data.confirmations
            .map(x =>
              `<div>• ${htmlEscape(x)}</div>`
            )
            .join("")
        }
      </div>

      <footer>
        📊 Analysis based on Bybit information
      </footer>

    </section>
  `;
}

/* =========================================================
   MAIN
========================================================= */

export default {

  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "Content-Type"
        }
      });
    }

    const url =
      new URL(request.url);

    try {

      /* ---------------------------------------------
         HEALTH
      --------------------------------------------- */

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {
        return json({
          ok: true,
          service: "Global Pulse",
          worker: "telegram-auto-channel",
          version: VERSION,
          status: "online",
          cryptoAnalyzer: true,
          time: new Date().toISOString()
        });
      }

      /* ---------------------------------------------
         CRYPTO JSON
      --------------------------------------------- */

      if (
        request.method === "GET" &&
        url.pathname === "/crypto-analyze"
      ) {

        const input =
          url.searchParams.get("symbol");

        if (!input) {
          return json({
            ok: false,
            error: "Symbol is required"
          }, 400);
        }

        if (blocked(input)) {
          return json({
            ok: false,
            error: "This symbol is not available."
          }, 403);
        }

        const result =
          await analyzeSymbol(input);

        return json(result);
      }

      /* ---------------------------------------------
         CRYPTO HTML
      --------------------------------------------- */

      if (
        request.method === "GET" &&
        url.pathname === "/crypto"
      ) {

        const input =
          url.searchParams.get("symbol");

        if (!input) {
          return new Response(
            "<h2>Symbol is required</h2>",
            {
              status: 400,
              headers: {
                "content-type":
                  "text/html; charset=utf-8"
              }
            }
          );
        }

        if (blocked(input)) {
          return new Response(
            "<h2>Symbol not available</h2>",
            {
              status: 403,
              headers: {
                "content-type":
                  "text/html; charset=utf-8"
              }
            }
          );
        }

        const result =
          await analyzeSymbol(input);

        return new Response(
          analysisHtml(result),
          {
            headers: {
              "content-type":
                "text/html; charset=utf-8"
            }
          }
        );
      }

      return json({
        ok: false,
        error: "Not Found",
        path: url.pathname
      }, 404);

    } catch (error) {

      console.error(
        JSON.stringify({
          error:
            error.message || String(error),
          path:
            url.pathname
        })
      );

      return json({
        ok: false,
        error:
          error.message || String(error)
      }, 500);
    }
  }
};
