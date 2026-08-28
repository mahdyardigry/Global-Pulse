const BYBIT = "https://api.bybit.com";
const VERSION = "GLOBAL-PULSE-CRYPTO-DEEP-V2";

const KLINE_LIMIT = 200;
const TRADE_LIMIT = 1000;
const ORDERBOOK_LIMIT = 50;
const LIVE_CHART_LIMIT = 120;

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

  return a.length % 2
    ? a[m]
    : (a[m - 1] + a[m]) / 2;
}

function pct(a, b) {
  if (!b) return 0;
  return ((a - b) / b) * 100;
}

function round(v, d = 2) {
  const n = num(v);
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
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

function htmlEscape(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================
   BYBIT REQUEST
========================================================= */

async function bybit(path, params = {}) {

  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(params)) {

    if (
      v !== undefined &&
      v !== null &&
      v !== ""
    ) {
      qs.set(k, String(v));
    }
  }

  const query = qs.toString();

  const url =
    query
      ? `${BYBIT}${path}?${query}`
      : `${BYBIT}${path}`;

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
========================================================= */

async function findSymbol(input) {

  const raw =
    upper(input)
      .replace(/\s+/g, "")
      .replace(/[-_/]/g, "");

  if (!raw) {
    return {
      found: false,
      symbol: ""
    };
  }

  let symbol = raw;

  if (!symbol.endsWith("USDT")) {
    symbol = `${symbol}USDT`;
  }

  async function searchCategory(category) {

    let cursor = "";

    for (let page = 0; page < 10; page++) {

      const params = {
        category,
        limit: 1000
      };

      if (cursor) {
        params.cursor = cursor;
      }

      let result;

      try {

        result =
          await bybit(
            "/v5/market/instruments-info",
            params
          );

      } catch (_) {

        return null;
      }

      const list =
        Array.isArray(result?.list)
          ? result.list
          : [];

      let item =
        list.find(x =>
          upper(x.symbol) === symbol
        );

      if (item) {
        return item;
      }

      if (!raw.endsWith("USDT")) {

        item =
          list.find(x =>
            upper(x.baseCoin) === raw &&
            upper(x.quoteCoin) === "USDT"
          );

        if (item) {
          return item;
        }
      }

      cursor =
        result?.nextPageCursor || "";

      if (!cursor) {
        break;
      }
    }

    return null;
  }

  /* Futures first */

  const futuresItem =
    await searchCategory("linear");

  if (futuresItem) {

    return {
      found: true,
      category: "linear",
      market: "Futures",
      symbol: futuresItem.symbol,
      baseCoin: futuresItem.baseCoin || "",
      quoteCoin: futuresItem.quoteCoin || "",
      contractType: futuresItem.contractType || "",
      raw: futuresItem
    };
  }

  /* Spot */

  const spotItem =
    await searchCategory("spot");

  if (spotItem) {

    return {
      found: true,
      category: "spot",
      market: "Spot",
      symbol: spotItem.symbol,
      baseCoin: spotItem.baseCoin || "",
      quoteCoin: spotItem.quoteCoin || "",
      contractType: "",
      raw: spotItem
    };
  }

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

async function getKlines(
  category,
  symbol,
  interval,
  limit = KLINE_LIMIT
) {

  const result =
    await bybit(
      "/v5/market/kline",
      {
        category,
        symbol,
        interval,
        limit
      }
    );

  return parseKlines(result.list);
}

/* =========================================================
   LIVE CHART DATA
========================================================= */

async function getLiveChartData(
  category,
  symbol,
  interval = "1",
  limit = LIVE_CHART_LIMIT
) {

  const safeLimit =
    Math.max(
      20,
      Math.min(
        1000,
        num(limit, LIVE_CHART_LIMIT)
      )
    );

  const candles =
    await getKlines(
      category,
      symbol,
      interval,
      safeLimit
    );

  return candles.map(c => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));
}

/* =========================================================
   INDICATORS
========================================================= */

function sma(values, period) {

  if (values.length < period) {
    return null;
  }

  return avg(
    values.slice(
      values.length - period
    )
  );
}

function ema(values, period) {

  if (values.length < period) {
    return null;
  }

  const k =
    2 / (period + 1);

  let e =
    avg(values.slice(0, period));

  for (
    let i = period;
    i < values.length;
    i++
  ) {

    e =
      values[i] * k +
      e * (1 - k);
  }

  return e;
}

function rsi(values, period = 14) {

  if (values.length < period + 1) {
    return null;
  }

  let gain = 0;
  let loss = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const d =
      values[i] -
      values[i - 1];

    if (d >= 0) {
      gain += d;
    } else {
      loss -= d;
    }
  }

  let avgGain =
    gain / period;

  let avgLoss =
    loss / period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {

    const d =
      values[i] -
      values[i - 1];

    const g =
      Math.max(d, 0);

    const l =
      Math.max(-d, 0);

    avgGain =
      (
        avgGain * (period - 1) +
        g
      ) / period;

    avgLoss =
      (
        avgLoss * (period - 1) +
        l
      ) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs =
    avgGain / avgLoss;

  return 100 -
    100 / (1 + rs);
}

function atr(candles, period = 14) {

  if (candles.length < period + 1) {
    return null;
  }

  const tr = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const c =
      candles[i];

    const p =
      candles[i - 1];

    tr.push(
      Math.max(
        c.high - c.low,
        Math.abs(
          c.high - p.close
        ),
        Math.abs(
          c.low - p.close
        )
      )
    );
  }

  return avg(
    tr.slice(-period)
  );
}

function macd(values) {

  if (values.length < 35) {
    return null;
  }

  const fast =
    ema(values, 12);

  const slow =
    ema(values, 26);

  if (
    fast === null ||
    slow === null
  ) {
    return null;
  }

  return fast - slow;
}

function bollinger(values, period = 20) {

  if (values.length < period) {
    return null;
  }

  const data =
    values.slice(-period);

  const mean =
    avg(data);

  const variance =
    avg(
      data.map(x =>
        Math.pow(
          x - mean,
          2
        )
      )
    );

  const sd =
    Math.sqrt(variance);

  return {
    middle: mean,
    upper: mean + sd * 2,
    lower: mean - sd * 2,
    width:
      mean
        ? ((sd * 4) / mean) * 100
        : 0
  };
}

/* =========================================================
   TREND
========================================================= */

function trendAnalysis(candles) {

  const closes =
    candles.map(
      x => x.close
    );

  const price =
    closes[
      closes.length - 1
    ];

  const ma20 =
    sma(closes, 20);

  const ma50 =
    sma(closes, 50);

  const ma100 =
    sma(closes, 100);

  let direction =
    "NEUTRAL";

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

    } else if (
      price > ma20
    ) {

      direction = "BULLISH";
      score = 65;

    } else if (
      price < ma20
    ) {

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
    candles.map(
      x => x.high
    );

  const lows =
    candles.map(
      x => x.low
    );

  const price =
    candles[
      candles.length - 1
    ].close;

  const levels = [];

  for (
    let i = 2;
    i < candles.length - 2;
    i++
  ) {

    const h =
      highs[i];

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

    const l =
      lows[i];

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
      .filter(
        x =>
          x.type === "support"
      )
      .filter(
        x =>
          x.price < price
      )
      .sort(
        (a, b) =>
          Math.abs(price - a.price) -
          Math.abs(price - b.price)
      )
      .slice(0, 5);

  const resistances =
    levels
      .filter(
        x =>
          x.type === "resistance"
      )
      .filter(
        x =>
          x.price > price
      )
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
    candles[
      candles.length - 1
    ];

  const previous =
    candles.slice(-20, -1);

  const previousHigh =
    Math.max(
      ...previous.map(
        x => x.high
      )
    );

  const previousLow =
    Math.min(
      ...previous.map(
        x => x.low
      )
    );

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

async function footprint(
  category,
  symbol
) {

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

    const qty =
      num(t.size);

    const price =
      num(t.price);

    const notional =
      qty * price;

    notionals.push(
      notional
    );

    if (
      String(t.side)
        .toLowerCase() === "buy"
    ) {

      buyVolume += qty;
      buyNotional += notional;

    } else {

      sellVolume += qty;
      sellNotional += notional;
    }
  }

  const total =
    buyVolume +
    sellVolume;

  const delta =
    buyVolume -
    sellVolume;

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

    const qty =
      num(t.size);

    const price =
      num(t.price);

    const n =
      qty * price;

    if (
      n < largeThreshold
    ) {
      continue;
    }

    if (
      String(t.side)
        .toLowerCase() === "buy"
    ) {

      largeBuy += n;

    } else {

      largeSell += n;
    }
  }

  let pressure =
    "NEUTRAL";

  if (
    deltaPercent >= 10
  ) {

    pressure =
      "BUY PRESSURE";

  } else if (
    deltaPercent <= -10
  ) {

    pressure =
      "SELL PRESSURE";
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

async function orderBook(
  category,
  symbol
) {

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
      num(b[0]) *
      num(b[1]);
  }

  for (const a of asks) {

    askLiquidity +=
      num(a[0]) *
      num(a[1]);
  }

  const total =
    bidLiquidity +
    askLiquidity;

  const buyShare =
    total
      ? bidLiquidity /
        total *
        100
      : 50;

  const sellShare =
    total
      ? askLiquidity /
        total *
        100
      : 50;

  let pressure =
    "NEUTRAL";

  if (
    buyShare >
    sellShare + 8
  ) {

    pressure =
      "BUY PRESSURE";

  } else if (
    sellShare >
    buyShare + 8
  ) {

    pressure =
      "SELL PRESSURE";
  }

  const buyWalls =
    bids
      .map(x => ({
        price: num(x[0]),
        quantity: num(x[1]),
        value:
          num(x[0]) *
          num(x[1])
      }))
      .sort(
        (a, b) =>
          b.value -
          a.value
      )
      .slice(0, 5);

  const sellWalls =
    asks
      .map(x => ({
        price: num(x[0]),
        quantity: num(x[1]),
        value:
          num(x[0]) *
          num(x[1])
      }))
      .sort(
        (a, b) =>
          b.value -
          a.value
      )
      .slice(0, 5);

  return {

    bidLiquidity,

    askLiquidity,

    totalLiquidity:
      total,

    buyShare,

    sellShare,

    pressure,

    bestBid:
      bids.length
        ? num(bids[0][0])
        : 0,

    bestAsk:
      asks.length
        ? num(asks[0][0])
        : 0,

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
    hunt
  } = data;

  const styles = [];

  /* SCALPING */

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

    score:
      Math.max(
        0,
        Math.min(
          100,
          scalpScore
        )
      ),

    view:
      scalpScore >= 65
        ? "BULLISH"
        : scalpScore <= 35
          ? "BEARISH"
          : "NEUTRAL",

    reasons:
      scalpReasons
  });

  /* DAY */

  let dayScore = 50;
  const dayReasons = [];

  if (
    trend.direction ===
    "BULLISH"
  ) {

    dayScore += 20;

    dayReasons.push(
      "Price structure is above the short/medium moving averages."
    );
  }

  if (
    trend.direction ===
    "BEARISH"
  ) {

    dayScore -= 20;

    dayReasons.push(
      "Price structure is below the short/medium moving averages."
    );
  }

  if (
    rsiValue > 55
  ) {

    dayScore += 10;

    dayReasons.push(
      "RSI confirms positive momentum."
    );

  } else if (
    rsiValue < 45
  ) {

    dayScore -= 10;

    dayReasons.push(
      "RSI confirms negative momentum."
    );
  }

  styles.push({

    name: "Day Trading",

    score:
      Math.max(
        0,
        Math.min(
          100,
          dayScore
        )
      ),

    view:
      dayScore >= 65
        ? "BULLISH"
        : dayScore <= 35
          ? "BEARISH"
          : "NEUTRAL",

    reasons:
      dayReasons
  });

  /* SWING */

  let swingScore =
    trend.score;

  const swingReasons = [];

  swingReasons.push(
    `Primary structure: ${trend.direction}.`
  );

  if (
    macdValue !== null
  ) {

    if (
      macdValue > 0
    ) {

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

    score:
      Math.max(
        0,
        Math.min(
          100,
          swingScore
        )
      ),

    view:
      swingScore >= 65
        ? "BULLISH"
        : swingScore <= 35
          ? "BEARISH"
          : "NEUTRAL",

    reasons:
      swingReasons
  });

  /* MOMENTUM */

  let momentum = 50;
  const momentumReasons = [];

  if (
    rsiValue >= 55
  ) {

    momentum += 20;

    momentumReasons.push(
      "Momentum favors buyers."
    );
  }

  if (
    rsiValue <= 45
  ) {

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

    score:
      Math.max(
        0,
        Math.min(
          100,
          momentum
        )
      ),

    view:
      momentum >= 65
        ? "BULLISH"
        : momentum <= 35
          ? "BEARISH"
          : "NEUTRAL",

    reasons:
      momentumReasons
  });

  /* SMART MONEY */

  let sm = 50;
  const smReasons = [];

  if (
    hunt.detected
  ) {

    if (
      hunt.type.includes(
        "BULLISH"
      )
    ) {

      sm += 25;

      smReasons.push(
        "Bullish liquidity sweep detected."
      );
    }

    if (
      hunt.type.includes(
        "BEARISH"
      )
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

    score:
      Math.max(
        0,
        Math.min(
          100,
          sm
        )
      ),

    view:
      sm >= 65
        ? "BULLISH"
        : sm <= 35
          ? "BEARISH"
          : "NEUTRAL",

    reasons:
      smReasons
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
        `Symbol ${found.symbol} was not found on Bybit`
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

      getKlines(
        category,
        symbol,
        "1"
      ),

      getKlines(
        category,
        symbol,
        "15"
      ),

      getKlines(
        category,
        symbol,
        "60"
      ),

      footprint(
        category,
        symbol
      ),

      orderBook(
        category,
        symbol
      )
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
    candles1m.map(
      x => x.close
    );

  const trend1m =
    trendAnalysis(
      candles1m
    );

  const trend15m =
    trendAnalysis(
      candles15m
    );

  const trend1h =
    candles1h.length
      ? trendAnalysis(candles1h)
      : null;

  const rsiValue =
    rsi(
      close1m,
      14
    );

  const macdValue =
    macd(
      close1m
    );

  const atrValue =
    atr(
      candles1m,
      14
    );

  const bollingerValue =
    bollinger(
      close1m,
      20
    );

  const levels =
    supportResistance(
      candles1m
    );

  const hunt =
    liquidityHunt(
      candles1m
    );

  let futures = null;

  if (
    category === "linear"
  ) {

    futures =
      await futuresData(
        symbol
      );
  }

  const styles =
    styleAnalysis({

      trend:
        trend1m,

      rsiValue,

      macdValue,

      footprint:
        footprintData,

      orderbook:
        orderBookData,

      hunt,

      atrValue,

      price:
        trend1m.price
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

  if (trend1h) {

    confirmations.push(
      `1h trend: ${trend1h.direction}`
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
      styles.map(
        x => x.score
      )
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
      Math.min(
        100,
        overall
      )
    );

  let verdict =
    "NEUTRAL";

  if (
    overall >= 65
  ) {

    verdict =
      "BULLISH";

  } else if (
    overall <= 35
  ) {

    verdict =
      "BEARISH";
  }

  return {

    ok: true,

    version:
      VERSION,

    symbol,

    baseCoin:
      found.baseCoin,

    quoteCoin:
      found.quoteCoin,

    market: {

      category,

      type:
        found.market
    },

    price:
      trend1m.price,

    trend: {

      oneMinute:
        trend1m,

      fifteenMinute:
        trend15m,

      oneHour:
        trend1h
    },

    indicators: {

      rsi:
        rsiValue,

      macd:
        macdValue,

      atr:
        atrValue,

      bollinger:
        bollingerValue
    },

    supportResistance:
      levels,

    liquidity: {

      hunt
    },

    footprint:
      footprintData,

    orderBook:
      orderBookData,

    futures,

    styles,

    confirmations,

    overallScore:
      round(
        overall,
        1
      ),

    verdict,

    source:
      "Bybit"
  };
}

/* =========================================================
   CHART HTML
========================================================= */

function chartHtml(data) {

  const symbol =
    htmlEscape(data.symbol);

  const category =
    htmlEscape(data.market.category);

  return `

  <section class="live-chart-box">

    <div class="chart-header">

      <div>

        <small>
          LIVE MARKET CHART
        </small>

        <h3>
          📈 ${symbol}
        </h3>

      </div>

      <div class="chart-status">

        <span id="chart-dot">
          ●
        </span>

        <span id="chart-status-text">
          Connecting...
        </span>

      </div>

    </div>

    <div class="chart-tools">

      <button
        type="button"
        class="tf active"
        data-tf="1"
      >
        1M
      </button>

      <button
        type="button"
        class="tf"
        data-tf="5"
      >
        5M
      </button>

      <button
        type="button"
        class="tf"
        data-tf="15"
      >
        15M
      </button>

      <button
        type="button"
        class="tf"
        data-tf="60"
      >
        1H
      </button>

      <button
        type="button"
        id="chart-close"
        class="chart-close"
      >
        ✕
      </button>

    </div>

    <div class="chart-price">

      <span>
        Price
      </span>

      <b id="live-price">
        —
      </b>

      <span id="live-change">
        —
      </span>

    </div>

    <div
      class="chart-wrap"
      id="chart-wrap"
    >

      <canvas
        id="live-chart"
      ></canvas>

      <div
        id="chart-cross"
        class="chart-cross"
      ></div>

      <div
        id="chart-loading"
        class="chart-loading"
      >
        Loading live market data...
      </div>

    </div>

    <div class="chart-info">

      <div>
        <span>Open</span>
        <b id="c-open">—</b>
      </div>

      <div>
        <span>High</span>
        <b id="c-high">—</b>
      </div>

      <div>
        <span>Low</span>
        <b id="c-low">—</b>
      </div>

      <div>
        <span>Close</span>
        <b id="c-close">—</b>
      </div>

      <div>
        <span>Volume</span>
        <b id="c-volume">—</b>
      </div>

    </div>

    <div class="chart-footer">

      <span>
        ● Bybit Live
      </span>

      <span>
        Auto refresh: 5s
      </span>

    </div>

  </section>

  <script>

  (() => {

    const SYMBOL =
      ${JSON.stringify(data.symbol)};

    const CATEGORY =
      ${JSON.stringify(data.market.category)};

    const canvas =
      document.getElementById("live-chart");

    const ctx =
      canvas.getContext("2d");

    const wrap =
      document.getElementById("chart-wrap");

    const loading =
      document.getElementById("chart-loading");

    const statusText =
      document.getElementById(
        "chart-status-text"
      );

    const livePrice =
      document.getElementById(
        "live-price"
      );

    const liveChange =
      document.getElementById(
        "live-change"
      );

    const cOpen =
      document.getElementById("c-open");

    const cHigh =
      document.getElementById("c-high");

    const cLow =
      document.getElementById("c-low");

    const cClose =
      document.getElementById("c-close");

    const cVolume =
      document.getElementById("c-volume");

    const closeBtn =
      document.getElementById(
        "chart-close"
      );

    let interval =
      "1";

    let candles = [];

    let timer = null;

    let destroyed = false;

    function resizeCanvas() {

      const rect =
        wrap.getBoundingClientRect();

      const dpr =
        window.devicePixelRatio || 1;

      canvas.width =
        Math.max(
          300,
          Math.floor(
            rect.width * dpr
          )
        );

      canvas.height =
        Math.max(
          260,
          Math.floor(
            rect.height * dpr
          )
        );

      canvas.style.width =
        rect.width + "px";

      canvas.style.height =
        rect.height + "px";

      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );

      draw();
    }

    function priceText(v) {

      const n =
        Number(v);

      if (!Number.isFinite(n)) {
        return "—";
      }

      if (n >= 1000) {
        return n.toLocaleString(
          "en-US",
          {
            maximumFractionDigits: 2
          }
        );
      }

      if (n >= 1) {
        return n.toLocaleString(
          "en-US",
          {
            maximumFractionDigits: 4
          }
        );
      }

      return n.toLocaleString(
        "en-US",
        {
          maximumFractionDigits: 8
        }
      );
    }

    function volumeText(v) {

      const n =
        Number(v);

      if (!Number.isFinite(n)) {
        return "—";
      }

      if (n >= 1000000000) {
        return (
          (n / 1000000000)
            .toFixed(2)
          + "B"
        );
      }

      if (n >= 1000000) {
        return (
          (n / 1000000)
            .toFixed(2)
          + "M"
        );
      }

      if (n >= 1000) {
        return (
          (n / 1000)
            .toFixed(2)
          + "K"
        );
      }

      return n.toFixed(2);
    }

    function setStatus(text) {

      statusText.textContent =
        text;
    }

    function updateInfo() {

      if (!candles.length) {
        return;
      }

      const last =
        candles[
          candles.length - 1
        ];

      const first =
        candles[
          Math.max(
            0,
            candles.length - 20
          )
        ];

      const change =
        first.close
          ? (
              (last.close -
                first.close) /
              first.close
            ) * 100
          : 0;

      livePrice.textContent =
        priceText(last.close);

      liveChange.textContent =
        (
          change >= 0
            ? "+"
            : ""
        ) +
        change.toFixed(2) +
        "%";

      cOpen.textContent =
        priceText(last.open);

      cHigh.textContent =
        priceText(last.high);

      cLow.textContent =
        priceText(last.low);

      cClose.textContent =
        priceText(last.close);

      cVolume.textContent =
        volumeText(last.volume);
    }

    function draw() {

      if (
        !ctx ||
        !candles.length
      ) {
        return;
      }

      const rect =
        wrap.getBoundingClientRect();

      const width =
        rect.width;

      const height =
        rect.height;

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      const data =
        candles.slice(-90);

      if (!data.length) {
        return;
      }

      let min =
        Math.min(
          ...data.map(
            x => x.low
          )
        );

      let max =
        Math.max(
          ...data.map(
            x => x.high
          )
        );

      if (max === min) {
        max += 1;
        min -= 1;
      }

      const padLeft = 8;
      const padRight = 62;
      const padTop = 18;
      const padBottom = 28;

      const chartWidth =
        width -
        padLeft -
        padRight;

      const chartHeight =
        height -
        padTop -
        padBottom;

      function y(v) {

        return (
          padTop +
          (
            (max - v) /
            (max - min)
          ) *
          chartHeight
        );
      }

      function x(i) {

        return (
          padLeft +
          (
            i /
            Math.max(
              1,
              data.length - 1
            )
          ) *
          chartWidth
        );
      }

      /* Grid */

      ctx.font =
        "11px Arial";

      ctx.textAlign =
        "right";

      ctx.textBaseline =
        "middle";

      for (
        let i = 0;
        i <= 5;
        i++
      ) {

        const py =
          padTop +
          (
            i / 5
          ) *
          chartHeight;

        ctx.beginPath();

        ctx.moveTo(
          padLeft,
          py
        );

        ctx.lineTo(
          width - 4,
          py
        );

        ctx.strokeStyle =
          "rgba(255,255,255,.07)";

        ctx.stroke();

        const value =
          max -
          (
            i / 5
          ) *
          (
            max - min
          );

        ctx.fillStyle =
          "rgba(255,255,255,.65)";

        ctx.fillText(
          priceText(value),
          width - 6,
          py
        );
      }

      /* Candles */

      const candleWidth =
        Math.max(
          2,
          Math.min(
            12,
            chartWidth /
              data.length *
              .65
          )
        );

      for (
        let i = 0;
        i < data.length;
        i++
      ) {

        const c =
          data[i];

        const px =
          x(i);

        const openY =
          y(c.open);

        const closeY =
          y(c.close);

        const highY =
          y(c.high);

        const lowY =
          y(c.low);

        const up =
          c.close >= c.open;

        ctx.beginPath();

        ctx.moveTo(
          px,
          highY
        );

        ctx.lineTo(
          px,
          lowY
        );

        ctx.strokeStyle =
          up
            ? "#22c55e"
            : "#ef4444";

        ctx.lineWidth =
          1;

        ctx.stroke();

        const bodyTop =
          Math.min(
            openY,
            closeY
          );

        const bodyHeight =
          Math.max(
            1,
            Math.abs(
              closeY -
              openY
            )
          );

        ctx.fillStyle =
          up
            ? "#22c55e"
            : "#ef4444";

        ctx.fillRect(
          px -
            candleWidth / 2,
          bodyTop,
          candleWidth,
          bodyHeight
        );
      }

      /* Last price */

      const last =
        data[data.length - 1];

      const lastY =
        y(last.close);

      ctx.beginPath();

      ctx.moveTo(
        padLeft,
        lastY
      );

      ctx.lineTo(
        width - 4,
        lastY
      );

      ctx.strokeStyle =
        "rgba(255,255,255,.35)";

      ctx.setLineDash([
        4,
        4
      ]);

      ctx.stroke();

      ctx.setLineDash([]);

      ctx.fillStyle =
        "#111827";

      ctx.fillRect(
        width - 60,
        lastY - 10,
        58,
        20
      );

      ctx.fillStyle =
        "#ffffff";

      ctx.font =
        "11px Arial";

      ctx.textAlign =
        "center";

      ctx.fillText(
        priceText(last.close),
        width - 31,
        lastY
      );

      /* Time labels */

      ctx.fillStyle =
        "rgba(255,255,255,.55)";

      ctx.font =
        "10px Arial";

      ctx.textAlign =
        "center";

      const step =
        Math.max(
          1,
          Math.floor(
            data.length / 5
          )
        );

      for (
        let i = 0;
        i < data.length;
        i += step
      ) {

        const d =
          new Date(
            data[i].time
          );

        const label =
          d.toLocaleTimeString(
            [],
            {
              hour: "2-digit",
              minute: "2-digit"
            }
          );

        ctx.fillText(
          label,
          x(i),
          height - 9
        );
      }
    }

    async function loadChart() {

      if (destroyed) {
        return;
      }

      try {

        setStatus(
          "Updating..."
        );

        const url =
          "/crypto-chart-data" +
          "?symbol=" +
          encodeURIComponent(
            SYMBOL
          ) +
          "&category=" +
          encodeURIComponent(
            CATEGORY
          ) +
          "&interval=" +
          encodeURIComponent(
            interval
          ) +
          "&limit=120";

        const response =
          await fetch(
            url,
            {
              cache:
                "no-store"
            }
          );

        const data =
          await response.json();

        if (
          !data.ok
        ) {

          throw new Error(
            data.error ||
            "Chart data error"
          );
        }

        candles =
          Array.isArray(
            data.candles
          )
            ? data.candles
            : [];

        loading.style.display =
          candles.length
            ? "none"
            : "block";

        updateInfo();

        draw();

        setStatus(
          "Live"
        );

      } catch (error) {

        console.error(
          error
        );

        setStatus(
          "Connection error"
        );

      }
    }

    function start() {

      clearInterval(
        timer
      );

      loadChart();

      timer =
        setInterval(
          loadChart,
          5000
        );
    }

    document
      .querySelectorAll(
        ".live-chart-box .tf"
      )
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              document
                .querySelectorAll(
                  ".live-chart-box .tf"
                )
                .forEach(
                  x =>
                    x.classList.remove(
                      "active"
                    )
                );

              button.classList.add(
                "active"
              );

              interval =
                button.dataset.tf;

              candles = [];

              loading.style.display =
                "block";

              start();
            }
          );
        }
      );

    closeBtn.addEventListener(
      "click",
      () => {

        destroyed = true;

        clearInterval(
          timer
        );

        const box =
          document.querySelector(
            ".live-chart-box"
          );

        if (box) {
          box.remove();
        }
      }
    );

    window.addEventListener(
      "resize",
      resizeCanvas
    );

    resizeCanvas();

    start();

  })();

  </script>
  `;
}

/* =========================================================
   ANALYSIS HTML
========================================================= */

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

            <b>
              ${htmlEscape(s.name)}
            </b>

            <span>
              ${htmlEscape(s.view)}
            </span>

          </div>

          <div class="bar">

            <i
              style="width:${s.score}%"
            ></i>

          </div>

          <strong>
            ${s.score}/100
          </strong>

          <ul>

            ${s.reasons
              .map(r =>
                `<li>
                  ${htmlEscape(r)}
                </li>`
              )
              .join("")}

          </ul>

        </div>

      `)
      .join("");

  const supports =
    data.supportResistance.supports
      .map(
        x =>
          formatPrice(
            x.price
          )
      )
      .join(" • ") ||
    "No confirmed level";

  const resistances =
    data.supportResistance.resistances
      .map(
        x =>
          formatPrice(
            x.price
          )
      )
      .join(" • ") ||
    "No confirmed level";

  const f =
    data.footprint;

  const ob =
    data.orderBook;

  const hunt =
    data.liquidity.hunt;

  return `

<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
/>

<title>
Global Pulse - ${htmlEscape(data.symbol)}
</title>

<style>

*{
  box-sizing:border-box;
}

html{
  scroll-behavior:smooth;
}

body{

  margin:0;

  padding:20px;

  background:
    radial-gradient(
      circle at top,
      #172033 0,
      #080b12 48%,
      #05070b 100%
    );

  color:#e5e7eb;

  font-family:
    Arial,
    Helvetica,
    sans-serif;

}

.result{

  max-width:1000px;

  margin:auto;

}

.coin-head{

  display:flex;

  justify-content:space-between;

  align-items:center;

  gap:15px;

  margin-bottom:20px;

}

.coin-head small{

  color:#94a3b8;

  letter-spacing:1px;

}

.coin-head h2{

  margin:6px 0 0;

  font-size:28px;

}

.verdict{

  min-width:130px;

  text-align:center;

  padding:14px;

  border-radius:16px;

  font-weight:800;

  background:#1f2937;

}

.verdict small{

  display:block;

  margin-top:5px;

  font-weight:500;

}

.verdict.bullish{

  color:#22c55e;

  border:1px solid
    rgba(34,197,94,.4);

}

.verdict.bearish{

  color:#ef4444;

  border:1px solid
    rgba(239,68,68,.4);

}

.verdict.neutral{

  color:#f59e0b;

  border:1px solid
    rgba(245,158,11,.4);

}

.cards{

  display:grid;

  grid-template-columns:
    repeat(
      auto-fit,
      minmax(
        150px,
        1fr
      )
    );

  gap:10px;

  margin-bottom:25px;

}

.card{

  background:
    rgba(15,23,42,.8);

  border:
    1px solid
    rgba(255,255,255,.08);

  border-radius:14px;

  padding:15px;

}

.card small{

  display:block;

  color:#94a3b8;

  margin-bottom:8px;

}

.card b{

  font-size:18px;

}

h3{

  margin-top:28px;

  margin-bottom:12px;

  color:#f8fafc;

}

.style{

  background:
    rgba(15,23,42,.82);

  border:
    1px solid
    rgba(255,255,255,.07);

  border-radius:16px;

  padding:16px;

  margin-bottom:10px;

}

.style-top{

  display:flex;

  justify-content:space-between;

  margin-bottom:10px;

}

.style-top span{

  font-weight:800;

}

.bar{

  height:8px;

  background:#1e293b;

  border-radius:20px;

  overflow:hidden;

  margin-bottom:8px;

}

.bar i{

  display:block;

  height:100%;

  background:
    linear-gradient(
      90deg,
      #ef4444,
      #f59e0b,
      #22c55e
    );

}

.style ul{

  margin:10px 0 0;

  padding-left:20px;

  color:#cbd5e1;

}

.style li{

  margin:5px 0;

}

.levels{

  display:grid;

  grid-template-columns:
    repeat(
      auto-fit,
      minmax(
        260px,
        1fr
      )
    );

  gap:10px;

}

.levels > div{

  background:
    rgba(15,23,42,.8);

  padding:15px;

  border-radius:14px;

}

.levels p{

  color:#cbd5e1;

  line-height:1.8;

}

.data-grid{

  display:grid;

  grid-template-columns:
    repeat(
      auto-fit,
      minmax(
        150px,
        1fr
      )
    );

  gap:10px;

}

.data-grid > div{

  background:
    rgba(15,23,42,.8);

  border-radius:12px;

  padding:13px;

  color:#94a3b8;

}

.data-grid b{

  display:block;

  color:#f8fafc;

  margin-top:7px;

}

.data-box,
.conclusion{

  background:
    rgba(15,23,42,.82);

  border-radius:14px;

  padding:15px;

  line-height:1.8;

}

.error{

  max-width:900px;

  margin:40px auto;

  padding:20px;

  border-radius:15px;

  background:#3f1212;

  color:#fca5a5;

}

/* =======================================================
   LIVE CHART
======================================================= */

.live-chart-box{

  margin-top:25px;

  background:
    linear-gradient(
      180deg,
      rgba(15,23,42,.98),
      rgba(8,12,20,.98)
    );

  border:
    1px solid
    rgba(255,255,255,.1);

  border-radius:20px;

  padding:15px;

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.35);

}

.chart-header{

  display:flex;

  align-items:center;

  justify-content:space-between;

  gap:10px;

  margin-bottom:12px;

}

.chart-header small{

  color:#64748b;

  letter-spacing:1px;

}

.chart-header h3{

  margin:4px 0 0;

  font-size:21px;

}

.chart-status{

  color:#22c55e;

  font-size:13px;

}

#chart-dot{

  font-size:15px;

  margin-right:4px;

}

.chart-tools{

  display:flex;

  gap:7px;

  flex-wrap:wrap;

  margin-bottom:10px;

}

.tf,
.chart-close{

  border:1px solid
    rgba(255,255,255,.1);

  background:#111827;

  color:#cbd5e1;

  border-radius:10px;

  padding:8px 13px;

  cursor:pointer;

  font-weight:700;

}

.tf.active{

  background:#2563eb;

  color:white;

  border-color:#3b82f6;

}

.chart-close{

  margin-left:auto;

  color:#fca5a5;

}

.chart-price{

  display:flex;

  align-items:baseline;

  gap:10px;

  padding:5px 3px 12px;

}

.chart-price span:first-child{

  color:#64748b;

  font-size:12px;

}

#live-price{

  font-size:24px;

  color:#f8fafc;

}

#live-change{

  font-size:13px;

  color:#22c55e;

}

.chart-wrap{

  position:relative;

  width:100%;

  height:380px;

  min-height:280px;

  overflow:hidden;

  border-radius:14px;

  background:
    #070b12;

}

#live-chart{

  display:block;

  width:100%;

  height:100%;

}

.chart-loading{

  position:absolute;

  inset:0;

  display:flex;

  align-items:center;

  justify-content:center;

  color:#94a3b8;

  background:
    rgba(7,11,18,.75);

  font-size:14px;

}

.chart-info{

  display:grid;

  grid-template-columns:
    repeat(
      auto-fit,
      minmax(
        110px,
        1fr
      )
    );

  gap:8px;

  margin-top:10px;

}

.chart-info div{

  padding:10px;

  border-radius:10px;

  background:#0f172a;

}

.chart-info span{

  display:block;

  color:#64748b;

  font-size:11px;

  margin-bottom:5px;

}

.chart-info b{

  color:#e2e8f0;

  font-size:13px;

}

.chart-footer{

  display:flex;

  justify-content:space-between;

  color:#64748b;

  font-size:11px;

  margin-top:10px;

}

@media(max-width:600px){

  body{

    padding:10px;

  }

  .coin-head{

    align-items:flex-start;

  }

  .coin-head h2{

    font-size:22px;

  }

  .verdict{

    min-width:100px;

  }

  .chart-wrap{

    height:300px;

  }

}

</style>

</head>

<body>

<section class="result">

  <div class="coin-head">

    <div>

      <small>
        GLOBAL PULSE — CRYPTO DEEP ANALYSIS
      </small>

      <h2>
        🪙 ${htmlEscape(data.symbol)}
      </h2>

      <small>
        🏦 Market:
        ${htmlEscape(data.market.type)}
      </small>

    </div>

    <div
      class="verdict ${data.verdict.toLowerCase()}"
    >

      ${data.verdict}

      <small>
        ${data.overallScore}/100
      </small>

    </div>

  </div>

  <div class="cards">

    <div class="card">

      <small>
        PRICE
      </small>

      <b>
        ${formatPrice(data.price)}
      </b>

    </div>

    <div class="card">

      <small>
        1M TREND
      </small>

      <b>
        ${data.trend.oneMinute.direction}
      </b>

    </div>

    <div class="card">

      <small>
        15M CONFIRMATION
      </small>

      <b>
        ${data.trend.fifteenMinute.direction}
      </b>

    </div>

    <div class="card">

      <small>
        1H TREND
      </small>

      <b>
        ${
          data.trend.oneHour
            ? data.trend.oneHour.direction
            : "N/A"
        }
      </b>

    </div>

    <div class="card">

      <small>
        RSI
      </small>

      <b>
        ${round(
          data.indicators.rsi,
          2
        )}
      </b>

    </div>

  </div>

  <div style="
    margin-bottom:20px;
    display:flex;
    gap:10px;
    flex-wrap:wrap;
  ">

    <button
      id="open-live-chart"
      type="button"
      style="
        border:0;
        background:#2563eb;
        color:#fff;
        border-radius:12px;
        padding:12px 18px;
        cursor:pointer;
        font-weight:800;
        font-size:14px;
      "
    >
      📈 چارت زنده
    </button>

  </div>

  <div id="live-chart-container"></div>

  <h3>
    📊 Trading Styles
  </h3>

  ${styles}

  <h3>
    🎯 Support / Resistance
  </h3>

  <div class="levels">

    <div>

      <b>
        🟢 Support
      </b>

      <p>
        ${htmlEscape(supports)}
      </p>

    </div>

    <div>

      <b>
        🔴 Resistance
      </b>

      <p>
        ${htmlEscape(resistances)}
      </p>

    </div>

  </div>

  <h3>
    💧 Liquidity / Hunt
  </h3>

  <div class="data-box">

    <b>
      ${htmlEscape(hunt.type)}
    </b>

    <p>
      ${htmlEscape(hunt.reason)}
    </p>

    ${
      hunt.level
        ? `
          <small>
            Level:
            ${formatPrice(hunt.level)}
          </small>
        `
        : ""
    }

  </div>

  <h3>
    👣 Footprint
  </h3>

  <div class="data-grid">

    <div>
      Buy Volume
      <b>
        ${round(f.buyVolume,4)}
      </b>
    </div>

    <div>
      Sell Volume
      <b>
        ${round(f.sellVolume,4)}
      </b>
    </div>

    <div>
      Delta
      <b>
        ${round(f.delta,4)}
      </b>
    </div>

    <div>
      Delta %
      <b>
        ${round(f.deltaPercent,2)}%
      </b>
    </div>

    <div>
      Pressure
      <b>
        ${f.pressure}
      </b>
    </div>

    <div>
      Large Buy
      <b>
        $${Math.round(
          f.largeBuy
        ).toLocaleString()}
      </b>
    </div>

    <div>
      Large Sell
      <b>
        $${Math.round(
          f.largeSell
        ).toLocaleString()}
      </b>
    </div>

  </div>

  <h3>
    📚 Order Book
  </h3>

  <div class="data-grid">

    <div>
      Buy Share
      <b>
        ${round(ob.buyShare,2)}%
      </b>
    </div>

    <div>
      Sell Share
      <b>
        ${round(ob.sellShare,2)}%
      </b>
    </div>

    <div>
      Best Bid
      <b>
        ${formatPrice(ob.bestBid)}
      </b>
    </div>

    <div>
      Best Ask
      <b>
        ${formatPrice(ob.bestAsk)}
      </b>
    </div>

    <div>
      Pressure
      <b>
        ${ob.pressure}
      </b>
    </div>

  </div>

  ${
    data.futures
      ? `

        <h3>
          ⚡ Derivatives Data
        </h3>

        <div class="data-grid">

          <div>
            Open Interest
            <b>
              ${
                data.futures.openInterest
                  ?? "N/A"
              }
            </b>
          </div>

          <div>
            OI Value
            <b>
              ${
                data.futures.openInterestValue
                  ? "$" +
                    Math.round(
                      data.futures
                        .openInterestValue
                    ).toLocaleString()
                  : "N/A"
              }
            </b>
          </div>

          <div>
            Funding
            <b>
              ${
                data.futures.fundingRate !== null
                  ? data.futures.fundingRate
                  : "N/A"
              }
            </b>
          </div>

        </div>

      `
      : ""
  }

  <h3>
    🧠 Deep Conclusion
  </h3>

  <div class="conclusion">

    ${
      data.confirmations
        .map(
          x =>
            `<div>
              • ${htmlEscape(x)}
            </div>`
        )
        .join("")
    }

  </div>

  <footer style="
    margin-top:25px;
    color:#64748b;
    text-align:center;
  ">

    📊 Analysis based on live Bybit public market data

  </footer>

</section>

<script>

document
  .getElementById(
    "open-live-chart"
  )
  .addEventListener(
    "click",
    async function(){

      const container =
        document.getElementById(
          "live-chart-container"
        );

      if (
        container.innerHTML.trim()
      ) {

        container.scrollIntoView({
          behavior:"smooth",
          block:"start"
        });

        return;
      }

      container.innerHTML =
        ${JSON.stringify(chartHtml(data))};

      container.scrollIntoView({
        behavior:"smooth",
        block:"start"
      });

    }
  );

</script>

</body>

</html>

  `;
}

/* =========================================================
   MAIN
========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          headers: {

            "access-control-allow-origin":
              "*",

            "access-control-allow-methods":
              "GET,POST,OPTIONS",

            "access-control-allow-headers":
              "Content-Type"
          }
        }
      );
    }

    const url =
      new URL(
        request.url
      );

    try {

      /* ===================================================
         HEALTH
      =================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {

        return json({

          ok: true,

          service:
            "Global Pulse",

          worker:
            "telegram-auto-channel",

          version:
            VERSION,

          status:
            "online",

          cryptoAnalyzer:
            true,

          liveChart:
            true,

          time:
            new Date().toISOString()
        });
      }

      /* ===================================================
         CRYPTO JSON
      =================================================== */

      if (
        request.method === "GET" &&
        url.pathname ===
          "/crypto-analyze"
      ) {

        const input =
          url.searchParams.get(
            "symbol"
          );

        if (!input) {

          return json({

            ok: false,

            error:
              "Symbol is required"

          }, 400);
        }

        if (
          blocked(input)
        ) {

          return json({

            ok: false,

            error:
              "This symbol is not available."

          }, 403);
        }

        const result =
          await analyzeSymbol(
            input
          );

        return json(
          result
        );
      }

      /* ===================================================
         LIVE CHART DATA
      =================================================== */

      if (
        request.method === "GET" &&
        url.pathname ===
          "/crypto-chart-data"
      ) {

        const input =
          url.searchParams.get(
            "symbol"
          );

        const requestedCategory =
          lowerCategory(
            url.searchParams.get(
              "category"
            )
          );

        const interval =
          url.searchParams.get(
            "interval"
          ) || "1";

        const limit =
          num(
            url.searchParams.get(
              "limit"
            ),
            LIVE_CHART_LIMIT
          );

        if (!input) {

          return json({

            ok: false,

            error:
              "Symbol is required"

          }, 400);
        }

        if (
          blocked(input)
        ) {

          return json({

            ok: false,

            error:
              "This symbol is not available."

          }, 403);
        }

        const found =
          await findSymbol(
            input
          );

        if (!found.found) {

          return json({

            ok: false,

            error:
              `Symbol ${found.symbol} was not found on Bybit`

          }, 404);
        }

        let category =
          found.category;

        /*
         * اگر Frontend دسته‌بندی فرستاد،
         * فقط در صورتی استفاده می‌کنیم
         * که با بازار واقعی Symbol هماهنگ باشد.
         */

        if (
          requestedCategory === "spot" &&
          found.category === "spot"
        ) {

          category = "spot";
        }

        if (
          requestedCategory === "linear" &&
          found.category === "linear"
        ) {

          category = "linear";
        }

        const allowedIntervals = [
          "1",
          "3",
          "5",
          "15",
          "30",
          "60",
          "120",
          "240",
          "360",
          "720",
          "D"
        ];

        const safeInterval =
          allowedIntervals.includes(
            String(interval)
          )
            ? String(interval)
            : "1";

        const candles =
          await getLiveChartData(
            category,
            found.symbol,
            safeInterval,
            limit
          );

        return json({

          ok: true,

          symbol:
            found.symbol,

          category,

          market:
            found.market,

          interval:
            safeInterval,

          candles,

          serverTime:
            Date.now(),

          source:
            "Bybit"
        });
      }

      /* ===================================================
         CRYPTO HTML
      =================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/crypto"
      ) {

        const input =
          url.searchParams.get(
            "symbol"
          );

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

        if (
          blocked(input)
        ) {

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
          await analyzeSymbol(
            input
          );

        return new Response(
          analysisHtml(
            result
          ),
          {
            headers: {
              "content-type":
                "text/html; charset=utf-8",
              "cache-control":
                "no-store"
            }
          }
        );
      }

      /* ===================================================
         NOT FOUND
      =================================================== */

      return json({

        ok: false,

        error:
          "Not Found",

        path:
          url.pathname

      }, 404);

    } catch (error) {

      console.error(
        JSON.stringify({

          error:
            error.message ||
            String(error),

          path:
            url.pathname

        })
      );

      return json({

        ok: false,

        error:
          error.message ||
          String(error)

      }, 500);
    }
  }
};

/* =========================================================
   CATEGORY HELPER
========================================================= */

function lowerCategory(v) {

  const x =
    String(v || "")
      .trim()
      .toLowerCase();

  if (
    x === "spot"
  ) {
    return "spot";
  }

  if (
    x === "linear" ||
    x === "futures"
  ) {
    return "linear";
  }

  return "";
}
