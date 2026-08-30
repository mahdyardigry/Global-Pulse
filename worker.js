/* =========================================================
   GLOBAL PULSE V7
   ---------------------------------------------------------
   ONE WORKER
   - Global News Radar
   - Country Trend Radar
   - Shopping Radar
   - Telegram automatic publishing
   - Crypto search
   - Live Bybit chart
   - Multi timeframe analysis
   - RSI / MACD / divergence
   - Support / resistance
   - Order book / buy-sell walls
   - Footprint / delta
   - Volume analysis
   - Market structure
   - Trading styles
   - No Spot/Futures selection in UI
   - Market is detected automatically
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V7";
const BYBIT = "https://api.bybit.com";

const TF_LIST = [
  { id: "1", label: "1 دقیقه" },
  { id: "3", label: "3 دقیقه" },
  { id: "5", label: "5 دقیقه" },
  { id: "15", label: "15 دقیقه" },
  { id: "30", label: "30 دقیقه" },
  { id: "60", label: "1 ساعت" },
  { id: "240", label: "4 ساعت" },
  { id: "D", label: "روزانه" }
];

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "TR", name: "Turkey" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "SG", name: "Singapore" },
  { code: "CH", name: "Switzerland" }
];

const NEWS_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.bbci.co.uk/news/business/rss.xml",
  "https://feeds.bbci.co.uk/news/technology/rss.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"
];

const SHOPPING_FEEDS = [
  "https://news.google.com/rss/search?q=best+deals+shopping&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=consumer+deals+discounts&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=popular+products+shopping&hl=en-US&gl=US&ceid=US:en"
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* =========================================================
   BASIC
   ========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function html(data, status = 200) {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function cleanSymbol(symbol) {
  return String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/USDTUSDT$/, "USDT");
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function avg(a) {
  if (!a || !a.length) return 0;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function median(a) {
  if (!a || !a.length) return 0;

  const b = [...a].sort((x, y) => x - y);
  const m = Math.floor(b.length / 2);

  return b.length % 2
    ? b[m]
    : (b[m - 1] + b[m]) / 2;
}

function fmt(v, digits = 4) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "-";
  }

  const n = Number(v);

  if (Math.abs(n) >= 1000) {
    return n.toLocaleString("en-US", {
      maximumFractionDigits: 2
    });
  }

  if (Math.abs(n) >= 1) {
    return n.toLocaleString("en-US", {
      maximumFractionDigits: digits
    });
  }

  return n.toPrecision(6);
}

/* =========================================================
   TECHNICAL INDICATORS
   ========================================================= */

function sma(values, period) {
  if (!values || values.length < period) return null;
  return avg(values.slice(-period));
}

function ema(values, period) {
  if (!values || values.length < period) return null;

  const k = 2 / (period + 1);

  let e = avg(values.slice(0, period));

  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }

  return e;
}

function emaSeries(values, period) {
  if (!values || values.length < period) return [];

  const k = 2 / (period + 1);
  const out = [];

  let e = avg(values.slice(0, period));

  for (let i = 0; i < period - 1; i++) {
    out.push(null);
  }

  out.push(e);

  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }

  return out;
}

function rsi(values, period = 14) {
  if (!values || values.length < period + 1) return null;

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

  return 100 - (100 / (1 + rs));
}

function macd(values) {
  if (!values || values.length < 40) return null;

  const fastSeries = emaSeries(values, 12);
  const slowSeries = emaSeries(values, 26);

  const lineSeries = [];

  for (let i = 0; i < values.length; i++) {
    if (
      fastSeries[i] !== null &&
      slowSeries[i] !== null
    ) {
      lineSeries.push(
        fastSeries[i] - slowSeries[i]
      );
    }
  }

  if (lineSeries.length < 9) return null;

  const signalSeries =
    emaSeries(lineSeries, 9);

  const line =
    lineSeries[lineSeries.length - 1];

  const signal =
    signalSeries[signalSeries.length - 1];

  return {
    line,
    signal,
    histogram:
      signal == null
        ? null
        : line - signal,
    lineSeries,
    signalSeries
  };
}

function atr(candles, period = 14) {
  if (!candles || candles.length < period + 1) {
    return null;
  }

  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];

    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      )
    );
  }

  return avg(trs.slice(-period));
}

function bollinger(values, period = 20, mult = 2) {
  if (!values || values.length < period) {
    return null;
  }

  const middle = sma(values, period);
  const a = values.slice(-period);

  const variance =
    avg(a.map(v => Math.pow(v - middle, 2)));

  const sd = Math.sqrt(variance);

  return {
    middle,
    upper: middle + mult * sd,
    lower: middle - mult * sd,
    width:
      middle
        ? ((mult * 2 * sd) / middle) * 100
        : 0
  };
}

function stochastic(candles, period = 14) {
  if (!candles || candles.length < period) {
    return null;
  }

  const a = candles.slice(-period);

  const high =
    Math.max(...a.map(x => x.high));

  const low =
    Math.min(...a.map(x => x.low));

  const close =
    a[a.length - 1].close;

  if (high === low) return 50;

  return ((close - low) / (high - low)) * 100;
}

function roc(values, period = 12) {
  if (!values || values.length <= period) {
    return null;
  }

  const old =
    values[values.length - 1 - period];

  const current =
    values[values.length - 1];

  return old
    ? ((current - old) / old) * 100
    : null;
}

function vwap(candles) {
  if (!candles || !candles.length) return null;

  let pv = 0;
  let volume = 0;

  for (const c of candles) {
    const typical =
      (c.high + c.low + c.close) / 3;

    pv += typical * c.volume;
    volume += c.volume;
  }

  return volume ? pv / volume : null;
}

/* =========================================================
   KLINE PARSER
   ========================================================= */

function parseKlines(rows) {
  return (rows || [])
    .map(x => ({
      time: num(x[0]),
      open: num(x[1]),
      high: num(x[2]),
      low: num(x[3]),
      close: num(x[4]),
      volume: num(x[5]),
      turnover: num(x[6])
    }))
    .sort((a, b) => a.time - b.time);
}

/* =========================================================
   BYBIT
   ========================================================= */

async function bybit(path) {
  const r = await fetch(BYBIT + path, {
    headers: {
      "user-agent": "Global-Pulse/7.0"
    }
  });

  if (!r.ok) {
    throw new Error(`Bybit HTTP ${r.status}`);
  }

  const j = await r.json();

  if (j.retCode !== 0) {
    throw new Error(
      j.retMsg || "Bybit error"
    );
  }

  return j.result;
}

async function getKlines(
  category,
  symbol,
  interval,
  limit = 300
) {
  const q =
    `/v5/market/kline?category=${encodeURIComponent(category)}` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;

  const r = await bybit(q);

  return parseKlines(r.list || []);
}

/* =========================================================
   MARKET DETECTION
   ---------------------------------------------------------
   UI never asks Spot/Futures.
   Worker automatically detects the best available market.
   ========================================================= */

async function findMarket(symbol) {
  const s = cleanSymbol(symbol);

  if (!s) return null;

  try {
    const linear =
      await bybit(
        `/v5/market/instruments-info?category=linear&symbol=${s}`
      );

    if (
      linear.list &&
      linear.list.length &&
      linear.list[0].status === "Trading"
    ) {
      return "linear";
    }
  } catch {}

  try {
    const spot =
      await bybit(
        `/v5/market/instruments-info?category=spot&symbol=${s}`
      );

    if (
      spot.list &&
      spot.list.length &&
      spot.list[0].status === "Trading"
    ) {
      return "spot";
    }
  } catch {}

  return null;
}

/* =========================================================
   MARKET STRUCTURE
   ========================================================= */

function detectStructure(candles) {
  if (!candles || candles.length < 30) {
    return {
      name: "UNKNOWN",
      description: "داده کافی نیست"
    };
  }

  const a = candles.slice(-30);

  const highs = a.map(x => x.high);
  const lows = a.map(x => x.low);

  const h1 = Math.max(...highs.slice(0, 10));
  const h2 = Math.max(...highs.slice(10, 20));
  const h3 = Math.max(...highs.slice(20));

  const l1 = Math.min(...lows.slice(0, 10));
  const l2 = Math.min(...lows.slice(10, 20));
  const l3 = Math.min(...lows.slice(20));

  const higherHigh =
    h3 > h2 && h2 >= h1;

  const higherLow =
    l3 > l2 && l2 >= l1;

  const lowerHigh =
    h3 < h2 && h2 <= h1;

  const lowerLow =
    l3 < l2 && l2 <= l1;

  if (higherHigh && higherLow) {
    return {
      name: "BULLISH",
      description: "Higher High + Higher Low"
    };
  }

  if (lowerHigh && lowerLow) {
    return {
      name: "BEARISH",
      description: "Lower High + Lower Low"
    };
  }

  return {
    name: "RANGE",
    description: "بازار در محدوده نوسانی"
  };
}

/* =========================================================
   SUPPORT / RESISTANCE
   ========================================================= */

function pivotLevels(candles) {
  if (!candles || candles.length < 20) {
    return {
      supports: [],
      resistances: []
    };
  }

  const a = candles.slice(-120);

  const pivots = [];

  for (let i = 2; i < a.length - 2; i++) {
    const c = a[i];

    const isHigh =
      c.high >= a[i - 1].high &&
      c.high >= a[i - 2].high &&
      c.high >= a[i + 1].high &&
      c.high >= a[i + 2].high;

    const isLow =
      c.low <= a[i - 1].low &&
      c.low <= a[i - 2].low &&
      c.low <= a[i + 1].low &&
      c.low <= a[i + 2].low;

    if (isHigh) {
      pivots.push({
        type: "resistance",
        price: c.high,
        time: c.time
      });
    }

    if (isLow) {
      pivots.push({
        type: "support",
        price: c.low,
        time: c.time
      });
    }
  }

  const current =
    a[a.length - 1].close;

  const supports =
    pivots
      .filter(x => x.type === "support" && x.price < current)
      .sort((x, y) =>
        Math.abs(x.price - current) -
        Math.abs(y.price - current)
      )
      .slice(0, 6);

  const resistances =
    pivots
      .filter(x => x.type === "resistance" && x.price > current)
      .sort((x, y) =>
        Math.abs(x.price - current) -
        Math.abs(y.price - current)
      )
      .slice(0, 6);

  return {
    supports,
    resistances
  };
}

/* =========================================================
   DIVERGENCE
   ---------------------------------------------------------
   Uses price swing points against RSI / MACD.
   ========================================================= */

function divergence(candles, oscillatorValues) {
  if (
    !candles ||
    !oscillatorValues ||
    candles.length < 60
  ) {
    return {
      status: "NONE",
      bullish: false,
      bearish: false,
      details: "داده کافی نیست"
    };
  }

  const n =
    Math.min(
      candles.length,
      oscillatorValues.length
    );

  const start =
    candles.length - n;

  const points = [];

  for (let i = 2; i < n - 2; i++) {
    const c = candles[start + i];

    const prev =
      candles[start + i - 1];

    const next =
      candles[start + i + 1];

    const osc =
      oscillatorValues[i];

    if (osc == null) continue;

    if (
      c.low <= prev.low &&
      c.low <= next.low
    ) {
      points.push({
        type: "low",
        price: c.low,
        osc,
        time: c.time
      });
    }

    if (
      c.high >= prev.high &&
      c.high >= next.high
    ) {
      points.push({
        type: "high",
        price: c.high,
        osc,
        time: c.time
      });
    }
  }

  const lows =
    points.filter(x => x.type === "low");

  const highs =
    points.filter(x => x.type === "high");

  let bullish = false;
  let bearish = false;

  if (lows.length >= 2) {
    const p1 = lows[lows.length - 2];
    const p2 = lows[lows.length - 1];

    bullish =
      p2.price < p1.price &&
      p2.osc > p1.osc;
  }

  if (highs.length >= 2) {
    const p1 = highs[highs.length - 2];
    const p2 = highs[highs.length - 1];

    bearish =
      p2.price > p1.price &&
      p2.osc < p1.osc;
  }

  if (bullish) {
    return {
      status: "BULLISH_DIVERGENCE",
      bullish: true,
      bearish: false,
      details:
        "کف قیمت پایین‌تر شده ولی مومنتوم بالاتر رفته است."
    };
  }

  if (bearish) {
    return {
      status: "BEARISH_DIVERGENCE",
      bullish: false,
      bearish: true,
      details:
        "سقف قیمت بالاتر شده ولی مومنتوم پایین‌تر رفته است."
    };
  }

  return {
    status: "NONE",
    bullish: false,
    bearish: false,
    details: "واگرایی معتبر اخیر شناسایی نشد."
  };
}

/* =========================================================
   VOLUME
   ========================================================= */

function volumeAnalysis(candles) {
  if (!candles || candles.length < 25) {
    return null;
  }

  const current =
    candles[candles.length - 1];

  const previous =
    candles.slice(-21, -1);

  const average =
    avg(previous.map(x => x.volume));

  const ratio =
    average
      ? current.volume / average
      : 0;

  let state = "NORMAL";

  if (ratio >= 2.5) {
    state = "EXTREME";
  } else if (ratio >= 1.5) {
    state = "HIGH";
  } else if (ratio <= 0.6) {
    state = "LOW";
  }

  const candleDirection =
    current.close > current.open
      ? "BUY"
      : current.close < current.open
        ? "SELL"
        : "NEUTRAL";

  return {
    current: current.volume,
    average,
    ratio,
    state,
    candleDirection
  };
}

/* =========================================================
   TIMEFRAME ANALYSIS
   ========================================================= */

async function analyzeTimeframe(
  category,
  symbol,
  tf
) {
  const candles =
    await getKlines(
      category,
      symbol,
      tf,
      300
    );

  if (candles.length < 60) {
    throw new Error(
      `Insufficient ${tf} timeframe data`
    );
  }

  const closes =
    candles.map(x => x.close);

  const price =
    closes[closes.length - 1];

  const ma20 =
    sma(closes, 20);

  const ma50 =
    sma(closes, 50);

  const ema20 =
    ema(closes, 20);

  const ema50 =
    ema(closes, 50);

  const r =
    rsi(closes, 14);

  const m =
    macd(closes);

  const a =
    atr(candles, 14);

  const bb =
    bollinger(closes);

  const stoch =
    stochastic(candles);

  const change12 =
    roc(closes, 12);

  const vw =
    vwap(candles.slice(-100));

  const volume =
    volumeAnalysis(candles);

  const structure =
    detectStructure(candles);

  const levels =
    pivotLevels(candles);

  const rsiSeries =
    buildRsiSeries(closes, 14);

  const rsiDiv =
    divergence(
      candles,
      rsiSeries
    );

  const macdDiv =
    divergence(
      candles,
      m?.lineSeries || []
    );

  let momentum =
    "NEUTRAL";

  if (
    r != null &&
    r >= 55 &&
    m?.histogram > 0
  ) {
    momentum = "BULLISH";
  }

  if (
    r != null &&
    r <= 45 &&
    m?.histogram < 0
  ) {
    momentum = "BEARISH";
  }

  let trend =
    "NEUTRAL";

  if (
    ema20 != null &&
    ema50 != null &&
    price > ema20 &&
    ema20 > ema50
  ) {
    trend = "BULLISH";
  }

  if (
    ema20 != null &&
    ema50 != null &&
    price < ema20 &&
    ema20 < ema50
  ) {
    trend = "BEARISH";
  }

  return {
    tf,
    price,

    ma20,
    ma50,

    ema20,
    ema50,

    rsi: r,

    macd: m?.line ?? null,
    macdSignal: m?.signal ?? null,
    macdHistogram: m?.histogram ?? null,

    atr: a,

    bollinger: bb,

    stochastic: stoch,

    roc12: change12,

    vwap: vw,

    volume,

    structure,

    trend,

    momentum,

    divergence: {
      rsi: rsiDiv,
      macd: macdDiv
    },

    supportResistance: levels,

    recentHigh:
      Math.max(
        ...candles.slice(-50).map(x => x.high)
      ),

    recentLow:
      Math.min(
        ...candles.slice(-50).map(x => x.low)
      )
  };
}

/* =========================================================
   RSI SERIES
   ========================================================= */

function buildRsiSeries(
  values,
  period = 14
) {
  if (!values || values.length < period + 1) {
    return [];
  }

  const out =
    new Array(values.length).fill(null);

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d =
      values[i] - values[i - 1];

    if (d >= 0) gain += d;
    else loss -= d;
  }

  let avgGain =
    gain / period;

  let avgLoss =
    loss / period;

  out[period] =
    avgLoss === 0
      ? 100
      : 100 -
        (100 /
          (1 +
            avgGain /
            avgLoss));

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {
    const d =
      values[i] - values[i - 1];

    const g =
      Math.max(d, 0);

    const l =
      Math.max(-d, 0);

    avgGain =
      ((avgGain * (period - 1)) + g) /
      period;

    avgLoss =
      ((avgLoss * (period - 1)) + l) /
      period;

    out[i] =
      avgLoss === 0
        ? 100
        : 100 -
          (100 /
            (1 +
              avgGain /
              avgLoss));
  }

  return out;
}

/* =========================================================
   ORDER BOOK
   ========================================================= */

async function orderBook(
  category,
  symbol
) {
  const r =
    await bybit(
      `/v5/market/orderbook?category=${category}&symbol=${symbol}&limit=200`
    );

  const bids =
    (r.b || []).map(x => [
      num(x[0]),
      num(x[1])
    ]);

  const asks =
    (r.a || []).map(x => [
      num(x[0]),
      num(x[1])
    ]);

  const buy =
    bids.reduce(
      (s, x) => s + x[0] * x[1],
      0
    );

  const sell =
    asks.reduce(
      (s, x) => s + x[0] * x[1],
      0
    );

  const total =
    buy + sell;

  const buyShare =
    total ? buy / total * 100 : 50;

  const sellShare =
    total ? sell / total * 100 : 50;

  let pressure =
    "NEUTRAL";

  if (buyShare >= sellShare + 8) {
    pressure = "BUY_PRESSURE";
  }

  if (sellShare >= buyShare + 8) {
    pressure = "SELL_PRESSURE";
  }

  const bidWalls =
    detectWalls(
      bids,
      buy
    );

  const askWalls =
    detectWalls(
      asks,
      sell
    );

  return {
    buy,
    sell,

    buyShare,
    sellShare,

    pressure,

    bestBid:
      bids[0]?.[0] ?? null,

    bestAsk:
      asks[0]?.[0] ?? null,

    bidWalls,
    askWalls
  };
}

/* =========================================================
   ORDER BOOK WALLS
   ========================================================= */

function detectWalls(levels, total) {
  if (!levels || !levels.length) {
    return [];
  }

  const notionals =
    levels.map(x => x[0] * x[1]);

  const med =
    median(
      notionals.filter(x => x > 0)
    );

  if (!med) return [];

  return levels
    .map(x => ({
      price: x[0],
      quantity: x[1],
      notional: x[0] * x[1],
      strength:
        (x[0] * x[1]) / med
    }))
    .filter(x => x.strength >= 3)
    .sort(
      (a, b) =>
        b.notional - a.notional
    )
    .slice(0, 10);
}

/* =========================================================
   FOOTPRINT
   ========================================================= */

async function footprint(
  category,
  symbol
) {
  const r =
    await bybit(
      `/v5/market/recent-trade?category=${category}&symbol=${symbol}&limit=1000`
    );

  let buyVolume = 0;
  let sellVolume = 0;

  let buyNotional = 0;
  let sellNotional = 0;

  let buyTrades = 0;
  let sellTrades = 0;

  const recent =
    r.list || [];

  for (const t of recent) {
    const size =
      num(t.size);

    const price =
      num(t.price);

    const side =
      String(t.side || "")
        .toLowerCase();

    if (side === "buy") {
      buyVolume += size;
      buyNotional +=
        size * price;
      buyTrades++;
    }

    if (side === "sell") {
      sellVolume += size;
      sellNotional +=
        size * price;
      sellTrades++;
    }
  }

  const total =
    buyNotional +
    sellNotional;

  const delta =
    buyNotional -
    sellNotional;

  const deltaPercent =
    total
      ? delta / total * 100
      : 0;

  let pressure =
    "NEUTRAL";

  if (deltaPercent >= 10) {
    pressure = "BUY_PRESSURE";
  }

  if (deltaPercent <= -10) {
    pressure = "SELL_PRESSURE";
  }

  return {
    buyVolume,
    sellVolume,

    buyNotional,
    sellNotional,

    buyTrades,
    sellTrades,

    delta,
    deltaPercent,

    pressure
  };
}

/* =========================================================
   FUTURES DATA
   ---------------------------------------------------------
   Only used automatically when Bybit has a linear market.
   No UI selection is required.
   ========================================================= */

async function futuresData(symbol) {
  const result = {
    ticker: null,
    oi: null,
    funding: null,
    ratio: null
  };

  try {
    const r =
      await bybit(
        `/v5/market/tickers?category=linear&symbol=${symbol}`
      );

    result.ticker =
      r.list?.[0] || null;
  } catch {}

  try {
    const r =
      await bybit(
        `/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=2`
      );

    result.oi =
      r.list || [];
  } catch {}

  try {
    const r =
      await bybit(
        `/v5/market/funding/history?category=linear&symbol=${symbol}&limit=2`
      );

    result.funding =
      r.list || [];
  } catch {}

  try {
    const r =
      await bybit(
        `/v5/market/account-ratio?category=linear&symbol=${symbol}&period=5min&limit=2`
      );

    result.ratio =
      r.list || [];
  } catch {}

  return result;
}

/* =========================================================
   TRADING STYLES
   ---------------------------------------------------------
   No numeric score.
   These are descriptive computed interpretations.
   ========================================================= */

function tradingStyles(tf) {
  const {
    price,
    ema20,
    ema50,
    rsi,
    macdHistogram,
    volume,
    structure,
    divergence
  } = tf;

  const styles = [];

  if (
    price > ema20 &&
    ema20 > ema50 &&
    rsi > 50 &&
    macdHistogram > 0
  ) {
    styles.push({
      name: "Trend Following",
      state: "FAVORABLE",
      explanation:
        "روند کوتاه‌مدت و میان‌مدت هم‌جهت صعودی هستند."
    });
  } else if (
    price < ema20 &&
    ema20 < ema50 &&
    rsi < 50 &&
    macdHistogram < 0
  ) {
    styles.push({
      name: "Trend Following",
      state: "FAVORABLE",
      explanation:
        "روند کوتاه‌مدت و میان‌مدت هم‌جهت نزولی هستند."
    });
  } else {
    styles.push({
      name: "Trend Following",
      state: "MIXED",
      explanation:
        "روندها هم‌جهت کامل نیستند."
    });
  }

  const nearOversold =
    rsi != null && rsi <= 35;

  const nearOverbought =
    rsi != null && rsi >= 65;

  if (
    nearOversold ||
    nearOverbought ||
    divergence?.rsi?.bullish ||
    divergence?.rsi?.bearish
  ) {
    styles.push({
      name: "Reversal",
      state: "WATCH",
      explanation:
        "شرایط مومنتوم یا واگرایی برای بررسی برگشت وجود دارد."
    });
  } else {
    styles.push({
      name: "Reversal",
      state: "WAIT",
      explanation:
        "نشانه قدرتمند برگشت مشاهده نشد."
    });
  }

  if (
    structure?.name === "RANGE"
  ) {
    styles.push({
      name: "Range Trading",
      state: "ACTIVE",
      explanation:
        "ساختار فعلی بیشتر نوسانی و محدوده‌ای است."
    });
  } else {
    styles.push({
      name: "Range Trading",
      state: "WEAK",
      explanation:
        "ساختار فعلی روندی‌تر از حالت رنج است."
    });
  }

  if (
    volume?.ratio >= 1.5
  ) {
    styles.push({
      name: "Volume Breakout",
      state: "WATCH",
      explanation:
        "حجم فعلی نسبت به میانگین افزایش یافته است."
    });
  } else {
    styles.push({
      name: "Volume Breakout",
      state: "WAIT",
      explanation:
        "افزایش حجم قدرتمند برای شکست هنوز تأیید نشده است."
    });
  }

  return styles;
}

/* =========================================================
   FULL CRYPTO ANALYSIS
   ========================================================= */

async function deepAnalyze(
  symbol,
  requestedTf = "15"
) {
  symbol =
    cleanSymbol(symbol);

  if (!symbol) {
    throw new Error(
      "Symbol is required"
    );
  }

  const category =
    await findMarket(symbol);

  if (!category) {
    throw new Error(
      `Symbol ${symbol} not found on Bybit`
    );
  }

  const selected =
    TF_LIST.some(x => x.id === requestedTf)
      ? requestedTf
      : "15";

  const analyses = [];

  for (const tf of TF_LIST) {
    try {
      const a =
        await analyzeTimeframe(
          category,
          symbol,
          tf.id
        );

      analyses.push(a);
    } catch {}

    await sleep(60);
  }

  const selectedAnalysis =
    analyses.find(
      x => x.tf === selected
    ) ||
    analyses.find(
      x => x.tf === "15"
    ) ||
    analyses[0];

  if (!selectedAnalysis) {
    throw new Error(
      "Unable to obtain market data"
    );
  }

  const [
    order,
    foot,
    futures
  ] = await Promise.all([
    orderBook(
      category,
      symbol
    ).catch(() => null),

    footprint(
      category,
      symbol
    ).catch(() => null),

    category === "linear"
      ? futuresData(symbol)
      : Promise.resolve(null)
  ]);

  const currentPrice =
    selectedAnalysis.price;

  const styles =
    tradingStyles(
      selectedAnalysis
    );

  const longSetup =
    buildSetup(
      selectedAnalysis,
      order,
      foot,
      "LONG"
    );

  const shortSetup =
    buildSetup(
      selectedAnalysis,
      order,
      foot,
      "SHORT"
    );

  return {
    symbol,

    category,

    requestedTimeframe:
      selected,

    selectedAnalysis,

    analyses,

    orderBook: order,

    footprint: foot,

    futures,

    tradingStyles:
      styles,

    setups: {
      long: longSetup,
      short: shortSetup
    },

    price:
      currentPrice,

    generatedAt:
      new Date().toISOString()
  };
}

/* =========================================================
   TRADE SETUPS
   ---------------------------------------------------------
   Calculated from ATR and current structure.
   Not a score.
   ========================================================= */

function buildSetup(
  tf,
  order,
  foot,
  side
) {
  const price =
    tf.price;

  const a =
    tf.atr || 0;

  const supports =
    tf.supportResistance
      ?.supports || [];

  const resistances =
    tf.supportResistance
      ?.resistances || [];

  if (!a) {
    return {
      state: "UNAVAILABLE"
    };
  }

  if (side === "LONG") {
    const support =
      supports[0]?.price ||
      price - a;

    const resistance =
      resistances[0]?.price ||
      price + a * 2;

    return {
      state: "CALCULATED",
      entryReference: price,
      support,
      resistance,
      stopLoss:
        Math.min(
          support - a * 0.35,
          price - a * 1.5
        ),
      target1:
        price + a * 1.5,
      target2:
        price + a * 2.5,
      target3:
        Math.max(
          resistance,
          price + a * 3.5
        ),
      orderBook:
        order?.pressure || "UNKNOWN",
      footprint:
        foot?.pressure || "UNKNOWN"
    };
  }

  const resistance =
    resistances[0]?.price ||
    price + a;

  const support =
    supports[0]?.price ||
    price - a * 2;

  return {
    state: "CALCULATED",
    entryReference: price,
    support,
    resistance,
    stopLoss:
      Math.max(
        resistance + a * 0.35,
        price + a * 1.5
      ),
    target1:
      price - a * 1.5,
    target2:
      price - a * 2.5,
    target3:
      Math.min(
        support,
        price - a * 3.5
      ),
    orderBook:
      order?.pressure || "UNKNOWN",
    footprint:
      foot?.pressure || "UNKNOWN"
  };
}

/* =========================================================
   NEWS
   ========================================================= */

function stripXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlItems(xml) {
  const items = [];

  const blocks =
    xml.match(
      /<item[\s\S]*?<\/item>/gi
    ) || [];

  for (const block of blocks) {
    const title =
      stripXml(
        (
          block.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
          ) || []
        )[1]
      );

    const link =
      stripXml(
        (
          block.match(
            /<link[^>]*>([\s\S]*?)<\/link>/i
          ) || []
        )[1]
      );

    const pub =
      stripXml(
        (
          block.match(
            /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i
          ) || []
        )[1]
      );

    if (title) {
      items.push({
        title,
        link,
        pubDate: pub
      });
    }
  }

  return items;
}

async function fetchNews() {
  const all = [];

  for (const url of NEWS_FEEDS) {
    try {
      const r =
        await fetch(url, {
          headers: {
            "user-agent":
              "Global-Pulse/7.0"
          }
        });

      if (!r.ok) continue;

      const xml =
        await r.text();

      all.push(
        ...xmlItems(xml)
      );
    } catch {}
  }

  const seen =
    new Set();

  const result = [];

  for (const x of all) {
    const key =
      x.title
        .toLowerCase()
        .trim();

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(x);
  }

  return result.slice(0, 20);
}

/* =========================================================
   COUNTRY TRENDS
   ========================================================= */

async function fetchCountryTrend(
  country
) {
  const url =
    `https://trends.google.com/trending/rss?geo=${country.code}`;

  try {
    const r =
      await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 Global-Pulse"
        }
      });

    if (!r.ok) {
      throw new Error(
        "Trend unavailable"
      );
    }

    const xml =
      await r.text();

    const items =
      xmlItems(xml);

    return {
      country:
        country.name,

      code:
        country.code,

      trends:
        items
          .slice(0, 10)
          .map(x => x.title)
    };
  } catch {
    return {
      country:
        country.name,

      code:
        country.code,

      trends: []
    };
  }
}

/* =========================================================
   SHOPPING
   ========================================================= */

async function fetchShopping() {
  const all = [];

  for (const url of SHOPPING_FEEDS) {
    try {
      const r =
        await fetch(url, {
          headers: {
            "user-agent":
              "Global-Pulse/7.0"
          }
        });

      if (!r.ok) continue;

      const xml =
        await r.text();

      all.push(
        ...xmlItems(xml)
      );
    } catch {}
  }

  const seen =
    new Set();

  const result = [];

  for (const x of all) {
    const k =
      x.title
        .toLowerCase()
        .trim();

    if (seen.has(k)) continue;

    seen.add(k);
    result.push(x);
  }

  return result.slice(0, 20);
}

/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(
  env,
  method,
  body
) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  const url =
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

  const r =
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify(body)
    });

  const j =
    await r.json();

  if (!j.ok) {
    throw new Error(
      j.description ||
      "Telegram error"
    );
  }

  return j;
}

async function sendTelegram(
  env,
  message
) {
  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error(
      "TELEGRAM_CHANNEL_ID is missing"
    );
  }

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:
        env.TELEGRAM_CHANNEL_ID,

      text:
        message,

      disable_web_page_preview:
        true
    }
  );
}

/* =========================================================
   TELEGRAM MESSAGES
   ========================================================= */

function newsMessage(items) {
  let s =
`🌍 GLOBAL PULSE
📰 GLOBAL NEWS RADAR

`;

  if (!items.length) {
    return (
      s +
      "No reliable global news available right now.\n\n" +
      "━━━━━━━━━━━━━━━━\n" +
      "🌐 Global Pulse"
    );
  }

  for (
    const x of items.slice(0, 8)
  ) {
    s +=
      `• ${x.title}\n`;

    if (x.link) {
      s +=
        `${x.link}\n`;
    }

    s += "\n";
  }

  s +=
`━━━━━━━━━━━━━━━━
🌐 Global Pulse`;

  return s;
}

function trendMessage(data) {
  let s =
`🔥 COUNTRY TREND RADAR

🌍 ${data.country}

`;

  if (!data.trends.length) {
    s +=
      "No reliable trend data available right now.\n\n";
  } else {
    data.trends.forEach(
      (x, i) => {
        s +=
          `${i + 1}. ${x}\n`;
      }
    );

    s += "\n";
  }

  s +=
`━━━━━━━━━━━━━━━━
📊 Automatically updated
🌐 Global Pulse`;

  return s;
}

function shoppingMessage(items) {
  let s =
`🛒 GLOBAL SHOPPING RADAR

🔥 Popular deals & consumer topics

`;

  if (!items.length) {
    s +=
      "No shopping information available right now.\n\n";
  } else {
    for (
      const x of items.slice(0, 8)
    ) {
      s +=
        `• ${x.title}\n`;

      if (x.link) {
        s +=
          `${x.link}\n`;
      }

      s += "\n";
    }
  }

  s +=
`━━━━━━━━━━━━━━━━
⚠️ Prices and availability can change.
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   AUTOMATIC PUBLISHING
   ---------------------------------------------------------
   Errors are collected and returned instead of silently
   disappearing.
   ========================================================= */

async function automaticPublish(env) {
  const result = {
    news: false,
    trend: false,
    shopping: false,
    errors: []
  };

  try {
    const news =
      await fetchNews();

    await sendTelegram(
      env,
      newsMessage(news)
    );

    result.news = true;
  } catch (e) {
    result.errors.push(
      `news: ${e.message}`
    );
  }

  await sleep(800);

  try {
    const country =
      COUNTRIES[
        Math.floor(
          Math.random() *
          COUNTRIES.length
        )
      ];

    const trend =
      await fetchCountryTrend(
        country
      );

    await sendTelegram(
      env,
      trendMessage(trend)
    );

    result.trend = true;
  } catch (e) {
    result.errors.push(
      `trend: ${e.message}`
    );
  }

  await sleep(800);

  try {
    const shopping =
      await fetchShopping();

    await sendTelegram(
      env,
      shoppingMessage(
        shopping
      )
    );

    result.shopping = true;
  } catch (e) {
    result.errors.push(
      `shopping: ${e.message}`
    );
  }

  return result;
}

/* =========================================================
   CRYPTO HTML
   ========================================================= */

const APP_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1">

<title>Global Pulse Crypto Radar</title>

<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"></script>

<style>
*{
 box-sizing:border-box;
}

body{
 margin:0;
 background:#07111f;
 color:#eaf2ff;
 font-family:Tahoma,Arial,sans-serif;
}

header{
 padding:18px;
 background:#0c192b;
 border-bottom:1px solid #1b314c;
}

h1{
 margin:0 0 8px;
 font-size:22px;
}

.sub{
 color:#8fa7c3;
 font-size:13px;
}

.container{
 max-width:1100px;
 margin:auto;
 padding:15px;
}

.searchBox{
 display:flex;
 gap:8px;
 margin-bottom:12px;
}

input,select,button{
 border:1px solid #284563;
 background:#0d1c30;
 color:#fff;
 border-radius:10px;
 padding:12px;
 font-size:15px;
}

input{
 flex:1;
 min-width:0;
}

button{
 cursor:pointer;
 background:#1268b3;
 border-color:#1d81d1;
}

button:hover{
 background:#1680d4;
}

.tf{
 display:flex;
 gap:6px;
 flex-wrap:wrap;
 margin-bottom:12px;
}

.tf button{
 background:#0d1c30;
}

.tf button.active{
 background:#1576c8;
}

.status{
 padding:12px;
 background:#0d1c30;
 border-radius:10px;
 margin-bottom:12px;
 color:#9dc2e8;
}

.chart{
 height:430px;
 background:#07111f;
 border:1px solid #1b314c;
 border-radius:12px;
 overflow:hidden;
 margin-bottom:12px;
}

.grid{
 display:grid;
 grid-template-columns:repeat(2,minmax(0,1fr));
 gap:10px;
}

.card{
 background:#0c192b;
 border:1px solid #1b314c;
 border-radius:12px;
 overflow:hidden;
}

.cardTitle{
 padding:13px;
 font-weight:bold;
 cursor:pointer;
 background:#0e2036;
}

.cardBody{
 display:none;
 padding:13px;
 line-height:1.9;
 color:#c9d8e8;
}

.card.open .cardBody{
 display:block;
}

.row{
 display:flex;
 justify-content:space-between;
 gap:10px;
 border-bottom:1px solid #1b314c;
 padding:7px 0;
}

.badge{
 display:inline-block;
 padding:3px 8px;
 border-radius:20px;
 background:#173653;
}

.good{
 color:#61df9a;
}

.bad{
 color:#ff7777;
}

.warn{
 color:#ffd36b;
}

.wall{
 margin:5px 0;
 padding:7px;
 background:#102238;
 border-radius:7px;
}

.error{
 color:#ff7777;
}

@media(max-width:700px){
 .grid{
  grid-template-columns:1fr;
 }

 .chart{
  height:330px;
 }
}
</style>
</head>

<body>

<header>
 <h1>🪙 Global Pulse Crypto Radar</h1>
 <div class="sub">
 جستجوی رمز ارز با تشخیص خودکار بازار Bybit
 </div>
</header>

<div class="container">

 <div class="searchBox">
  <input
   id="symbol"
   placeholder="مثلاً BTCUSDT یا ETHUSDT"
   autocomplete="off">
  <button onclick="searchCoin()">
   🔎 تحلیل
  </button>
 </div>

 <div class="tf" id="tfButtons"></div>

 <div class="status" id="status">
  نام رمز ارز را وارد کنید.
 </div>

 <div id="chart" class="chart"></div>

 <div class="grid">

  <div class="card">
   <div class="cardTitle">
    📊 اطلاعات اصلی
   </div>
   <div class="cardBody" id="main"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    📈 RSI / MACD / Momentum
   </div>
   <div class="cardBody" id="indicators"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    🔀 واگرایی
   </div>
   <div class="cardBody" id="divergence"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    🧱 حمایت و مقاومت
   </div>
   <div class="cardBody" id="levels"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    🧲 دیوارهای خرید و فروش
   </div>
   <div class="cardBody" id="walls"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    👣 Footprint / Delta
   </div>
   <div class="cardBody" id="footprint"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    📦 حجم و ساختار بازار
   </div>
   <div class="cardBody" id="volume"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    🧠 سبک‌های معاملاتی
   </div>
   <div class="cardBody" id="styles"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    🎯 سناریوی محاسبه‌شده
   </div>
   <div class="cardBody" id="setups"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    🌐 تحلیل سایر تایم‌فریم‌ها
   </div>
   <div class="cardBody" id="multi"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    🧮 Bollinger / VWAP / Stochastic
   </div>
   <div class="cardBody" id="advanced"></div>
  </div>

  <div class="card">
   <div class="cardTitle">
    📡 Futures Data
   </div>
   <div class="cardBody" id="futures"></div>
  </div>

 </div>
</div>

<script>
const TF=[
 ["1","1 دقیقه"],
 ["3","3 دقیقه"],
 ["5","5 دقیقه"],
 ["15","15 دقیقه"],
 ["30","30 دقیقه"],
 ["60","1 ساعت"],
 ["240","4 ساعت"],
 ["D","روزانه"]
];

let selectedTf="15";
let lastSymbol="";
let chart=null;
let candleSeries=null;

const fmt=(v)=>{
 if(v===null||v===undefined||!Number.isFinite(Number(v))) return "-";
 const n=Number(v);
 if(Math.abs(n)>=1000){
  return n.toLocaleString("en-US",{maximumFractionDigits:2});
 }
 if(Math.abs(n)>=1){
  return n.toLocaleString("en-US",{maximumFractionDigits:6});
 }
 return n.toPrecision(6);
};

function makeTfButtons(){
 const box=document.getElementById("tfButtons");

 TF.forEach(x=>{
  const b=document.createElement("button");
  b.textContent=x[1];
  b.dataset.tf=x[0];

  if(x[0]===selectedTf)
   b.classList.add("active");

  b.onclick=()=>{
   selectedTf=x[0];

   document.querySelectorAll(".tf button")
    .forEach(z=>z.classList.remove("active"));

   b.classList.add("active");

   if(lastSymbol)
    searchCoin();
  };

  box.appendChild(b);
 });
}

function cardOpen(){
 document.querySelectorAll(".cardTitle")
 .forEach(t=>{
  t.onclick=()=>{
   t.parentElement.classList.toggle("open");
  };
 });
}

async function searchCoin(){
 const input=
  document.getElementById("symbol");

 const symbol=
  input.value.trim().toUpperCase();

 if(!symbol){
  document.getElementById("status").textContent=
   "نام رمز ارز را وارد کنید.";
  return;
 }

 lastSymbol=symbol;

 const status=
  document.getElementById("status");

 status.textContent=
  "⏳ در حال دریافت داده واقعی Bybit...";

 try{
  const r=
   await fetch(
    "/api/crypto?symbol="+
    encodeURIComponent(symbol)+
    "&timeframe="+
    selectedTf+
    "&chart=1"
   );

  const j=await r.json();

  if(!j.ok)
   throw new Error(j.error||"خطا");

  render(j.data);

  status.textContent=
   "🟢 داده واقعی Bybit | "+
   j.data.symbol+
   " | "+
   tfName(j.data.requestedTimeframe);

 }catch(e){
  status.innerHTML=
   '<span class="error">❌ '+
   e.message+
   '</span>';
 }
}

function tfName(tf){
 const x=TF.find(z=>z[0]===tf);
 return x?x[1]:tf;
}

function row(a,b){
 return '<div class="row"><span>'+
  a+'</span><b>'+b+'</b></div>';
}

function render(d){

 const x=d.selectedAnalysis;

 document.getElementById("main").innerHTML=
  row("رمز ارز",d.symbol)+
  row("بازار تشخیص داده شده",d.category)+
  row("تایم فریم",tfName(d.requestedTimeframe))+
  row("قیمت",fmt(d.price))+
  row("روند",x.trend)+
  row("ساختار",x.structure.name)+
  row("مومنتوم",x.momentum);

 document.getElementById("indicators").innerHTML=
  row("RSI",fmt(x.rsi))+
  row("MACD",fmt(x.macd))+
  row("MACD Signal",fmt(x.macdSignal))+
  row("MACD Histogram",fmt(x.macdHistogram))+
  row("ATR",fmt(x.atr))+
  row("MA20",fmt(x.ma20))+
  row("MA50",fmt(x.ma50))+
  row("EMA20",fmt(x.ema20))+
  row("EMA50",fmt(x.ema50));

 document.getElementById("divergence").innerHTML=
  row("RSI Divergence",
   x.divergence.rsi.status)+
  "<p>"+x.divergence.rsi.details+"</p>"+
  row("MACD Divergence",
   x.divergence.macd.status)+
  "<p>"+x.divergence.macd.details+"</p>";

 let lv="";

 (x.supportResistance.supports||[])
 .forEach((z,i)=>{
  lv+=row(
   "حمایت "+(i+1),
   fmt(z.price)
  );
 });

 (x.supportResistance.resistances||[])
 .forEach((z,i)=>{
  lv+=row(
   "مقاومت "+(i+1),
   fmt(z.price)
  );
 });

 document.getElementById("levels").innerHTML=
  lv||"سطح معتبر کافی نیست.";

 let walls="";

 if(d.orderBook){

  walls+=
   "<h4>🟢 دیوارهای خرید</h4>";

  (d.orderBook.bidWalls||[])
   .forEach(z=>{
    walls+=
     '<div class="wall">'+
     "قیمت: "+fmt(z.price)+
     " | حجم: "+fmt(z.quantity)+
     " | قدرت: "+fmt(z.strength)+
     "</div>";
   });

  walls+=
   "<h4>🔴 دیوارهای فروش</h4>";

  (d.orderBook.askWalls||[])
   .forEach(z=>{
    walls+=
     '<div class="wall">'+
     "قیمت: "+fmt(z.price)+
     " | حجم: "+fmt(z.quantity)+
     " | قدرت: "+fmt(z.strength)+
     "</div>";
   });

  walls+=
   row("Buy Share",fmt(d.orderBook.buyShare)+"%")+
   row("Sell Share",fmt(d.orderBook.sellShare)+"%")+
   row("Pressure",d.orderBook.pressure);
 }

 document.getElementById("walls").innerHTML=
  walls||"Order Book در دسترس نیست.";

 if(d.footprint){
  document.getElementById("footprint").innerHTML=
   row("Buy Volume",fmt(d.footprint.buyVolume))+
   row("Sell Volume",fmt(d.footprint.sellVolume))+
   row("Buy Notional",fmt(d.footprint.buyNotional))+
   row("Sell Notional",fmt(d.footprint.sellNotional))+
   row("Delta",fmt(d.footprint.delta))+
   row("Delta %",fmt(d.footprint.deltaPercent)+"%")+
   row("Pressure",d.footprint.pressure)+
   row("Buy Trades",d.footprint.buyTrades)+
   row("Sell Trades",d.footprint.sellTrades);
 }else{
  document.getElementById("footprint").textContent=
   "Footprint در دسترس نیست.";
 }

 let v="";

 if(x.volume){
  v+=
   row("Volume Ratio",fmt(x.volume.ratio))+
   row("Volume State",x.volume.state)+
   row("Candle Direction",x.volume.candleDirection);
 }

 v+=
  row("Market Structure",x.structure.name)+
  row("Structure Detail",x.structure.description);

 document.getElementById("volume").innerHTML=v;

 let styles="";

 d.tradingStyles.forEach(s=>{
  styles+=
   "<h4>"+s.name+"</h4>"+
   row("وضعیت",s.state)+
   "<p>"+s.explanation+"</p>";
 });

 document.getElementById("styles").innerHTML=
  styles;

 document.getElementById("setups").innerHTML=
  setupHtml("🟢 LONG",d.setups.long)+
  setupHtml("🔴 SHORT",d.setups.short);

 let multi="";

 d.analyses.forEach(z=>{
  multi+=
   "<h4>"+tfName(z.tf)+"</h4>"+
   row("Trend",z.trend)+
   row("RSI",fmt(z.rsi))+
   row("MACD Hist",fmt(z.macdHistogram))+
   row("Structure",z.structure.name)+
   row("Volume Ratio",
    fmt(z.volume?.ratio));
 });

 document.getElementById("multi").innerHTML=
  multi;

 document.getElementById("advanced").innerHTML=
  row("Bollinger Middle",
   fmt(x.bollinger?.middle))+
  row("Bollinger Upper",
   fmt(x.bollinger?.upper))+
  row("Bollinger Lower",
   fmt(x.bollinger?.lower))+
  row("Bollinger Width",
   fmt(x.bollinger?.width)+"%")+
  row("VWAP",fmt(x.vwap))+
  row("Stochastic",fmt(x.stochastic))+
  row("ROC 12",fmt(x.roc12)+"%");

 let f="";

 if(d.futures){
  const t=d.futures.ticker;

  if(t){
   f+=
    row("Last Price",fmt(t.lastPrice))+
    row("24h Change",
     fmt(Number(t.price24hPcnt)*100)+"%")+
    row("24h Volume",fmt(t.volume24h))+
    row("Open Interest",
     fmt(t.openInterest))+
    row("Funding",
     fmt(Number(t.fundingRate)*100)+"%");
  }
 }else{
  f="برای این نماد اطلاعات Futures جداگانه در دسترس نیست.";
 }

 document.getElementById("futures").innerHTML=f;

 drawChart(d.chart);
}

function setupHtml(title,s){
 if(!s||s.state!=="CALCULATED")
  return "<h4>"+title+"</h4>اطلاعات کافی نیست.";

 return "<h4>"+title+"</h4>"+
  row("Entry Reference",fmt(s.entryReference))+
  row("Support",fmt(s.support))+
  row("Resistance",fmt(s.resistance))+
  row("Stop Loss",fmt(s.stopLoss))+
  row("Target 1",fmt(s.target1))+
  row("Target 2",fmt(s.target2))+
  row("Target 3",fmt(s.target3))+
  row("Order Book",s.orderBook)+
  row("Footprint",s.footprint);
}

function drawChart(data){

 const el=
  document.getElementById("chart");

 if(chart){
  chart.remove();
  chart=null;
 }

 chart=
  LightweightCharts.createChart(
   el,
   {
    layout:{
     background:{color:"#07111f"},
     textColor:"#c9d8e8"
    },
    grid:{
     vertLines:{color:"#102238"},
     horzLines:{color:"#102238"}
    },
    rightPriceScale:{
     borderColor:"#1b314c"
    },
    timeScale:{
     borderColor:"#1b314c"
    }
   }
  );

 candleSeries=
  chart.addCandlestickSeries();

 candleSeries.setData(
  data.map(x=>({
   time:Math.floor(x.time/1000),
   open:x.open,
   high:x.high,
   low:x.low,
   close:x.close
  }))
 );

 chart.timeScale().fitContent();
}

makeTfButtons();
cardOpen();

document.getElementById("symbol")
 .addEventListener("keydown",e=>{
  if(e.key==="Enter")
   searchCoin();
 });
</script>

</body>
</html>`;

/* =========================================================
   CHART DATA
   ========================================================= */

async function chartData(
  category,
  symbol,
  tf
) {
  const candles =
    await getKlines(
      category,
      symbol,
      tf,
      300
    );

  return candles;
}

/* =========================================================
   ROUTER
   ========================================================= */

export default {

  async fetch(
    request,
    env
  ) {
    const url =
      new URL(request.url);

    const path =
      url.pathname;

    try {

      /* ==============================================
         HOME
         ============================================== */

      if (
        path === "/" ||
        path === "/index.html"
      ) {
        return html(APP_HTML);
      }

      /* ==============================================
         HEALTH
         ============================================== */

      if (
        path === "/health"
      ) {
        let channel = false;

        try {
          if (
            env.TELEGRAM_CHANNEL_ID
          ) {
            const r =
              await telegram(
                env,
                "getChat",
                {
                  chat_id:
                    env.TELEGRAM_CHANNEL_ID
                }
              );

            channel =
              !!r.ok;
          }
        } catch {}

        return json({
          ok: true,
          project:
            "Global Pulse",

          version:
            VERSION,

          telegram:
            !!env.TELEGRAM_BOT_TOKEN,

          channel,

          bybit: true,

          cryptoAnalyzer: true,

          automaticPublishing: true,

          cron:
            "*/15 * * * *",

          time:
            new Date().toISOString()
        });
      }

      /* ==============================================
         WEBHOOK
         ============================================== */

      if (
        path === "/setup-webhook"
      ) {
        const webhook =
          `${url.origin}/telegram/webhook`;

        const result =
          await telegram(
            env,
            "setWebhook",
            {
              url: webhook
            }
          );

        return json({
          ok: true,
          webhook,
          telegram: result
        });
      }

      /* ==============================================
         TELEGRAM WEBHOOK
         ============================================== */

      if (
        path === "/telegram/webhook" &&
        request.method === "POST"
      ) {
        const update =
          await request.json();

        return json({
          ok: true,
          received: true,
          update_id:
            update.update_id ??
            null
        });
      }

      /* ==============================================
         CRYPTO API
         ============================================== */

      if (
        path === "/api/crypto"
      ) {
        const symbol =
          cleanSymbol(
            url.searchParams.get(
              "symbol"
            )
          );

        const timeframe =
          url.searchParams.get(
            "timeframe"
          ) || "15";

        if (!symbol) {
          return json({
            ok: false,
            error:
              "symbol is required"
          }, 400);
        }

        const data =
          await deepAnalyze(
            symbol,
            timeframe
          );

        if (
          url.searchParams.get(
            "chart"
          ) === "1"
        ) {
          data.chart =
            await chartData(
              data.category,
              data.symbol,
              data.requestedTimeframe
            );
        }

        return json({
          ok: true,
          version: VERSION,
          data
        });
      }

      /* ==============================================
         OLD ANALYZE ENDPOINT
         ============================================== */

      if (
        path === "/analyze"
      ) {
        const symbol =
          cleanSymbol(
            url.searchParams.get(
              "symbol"
            )
          );

        const timeframe =
          url.searchParams.get(
            "timeframe"
          ) || "15";

        if (!symbol) {
          return json({
            ok: false,
            error:
              "symbol is required"
          }, 400);
        }

        const data =
          await deepAnalyze(
            symbol,
            timeframe
          );

        return json({
          ok: true,
          version: VERSION,
          data
        });
      }

      /* ==============================================
         TEST CRYPTO TELEGRAM
         ============================================== */

      if (
        path === "/test-crypto"
      ) {
        const symbol =
          cleanSymbol(
            url.searchParams.get(
              "symbol"
            ) || "BTCUSDT"
          );

        const timeframe =
          url.searchParams.get(
            "timeframe"
          ) || "15";

        const data =
          await deepAnalyze(
            symbol,
            timeframe
          );

        await sendTelegram(
          env,
          cryptoTelegramMessage(
            data
          )
        );

        return json({
          ok: true,
          type: "crypto",
          symbol,
          timeframe
        });
      }

      /* ==============================================
         TEST NEWS
         ============================================== */

      if (
        path === "/test-news"
      ) {
        const items =
          await fetchNews();

        await sendTelegram(
          env,
          newsMessage(items)
        );

        return json({
          ok: true,
          type: "news",
          count:
            items.length
        });
      }

      /* ==============================================
         TEST TREND
         ============================================== */

      if (
        path === "/test-trend"
      ) {
        const country =
          COUNTRIES[0];

        const data =
          await fetchCountryTrend(
            country
          );

        await sendTelegram(
          env,
          trendMessage(data)
        );

        return json({
          ok: true,
          type: "trend",
          country:
            country.name,
          count:
            data.trends.length
        });
      }

      /* ==============================================
         TEST SHOPPING
         ============================================== */

      if (
        path === "/test-shopping"
      ) {
        const items =
          await fetchShopping();

        await sendTelegram(
          env,
          shoppingMessage(items)
        );

        return json({
          ok: true,
          type: "shopping",
          count:
            items.length
        });
      }

      /* ==============================================
         MANUAL PUBLISH
         ============================================== */

      if (
        path === "/publish"
      ) {
        const result =
          await automaticPublish(
            env
          );

        return json({
          ok:
            result.errors.length === 0,

          version:
            VERSION,

          published:
            result,

          time:
            new Date().toISOString()
        });
      }

      /* ==============================================
         TELEGRAM STATUS
         ============================================== */

      if (
        path === "/telegram-status"
      ) {
        const result =
          await telegram(
            env,
            "getMe",
            {}
          );

        return json({
          ok: true,
          bot:
            result.result
        });
      }

      return json({
        ok: false,
        version: VERSION,
        error: "Not Found",
        path
      }, 404);

    } catch (e) {

      return json({
        ok: false,
        version: VERSION,
        error:
          e.message ||
          String(e)
      }, 500);
    }
  },

  /* =======================================================
     CRON
     ======================================================= */

  async scheduled(
    event,
    env,
    ctx
  ) {
    ctx.waitUntil(
      automaticPublish(env)
        .catch(() => {})
    );
  }

};

/* =========================================================
   CRYPTO TELEGRAM MESSAGE
   ========================================================= */

function cryptoTelegramMessage(a) {
  const x =
    a.selectedAnalysis;

  let s =
`🪙 GLOBAL PULSE
CRYPTO RADAR

${a.symbol}
⏱ ${a.requestedTimeframe}
💰 ${fmt(a.price)}

━━━━━━━━━━━━━━━━

📊 MARKET STRUCTURE
${x.structure.name}
${x.structure.description}

📈 TREND
${x.trend}

📉 RSI
${fmt(x.rsi)}

〽️ MACD
${fmt(x.macd)}
Signal: ${fmt(x.macdSignal)}
Histogram: ${fmt(x.macdHistogram)}

📦 VOLUME
Ratio: ${fmt(x.volume?.ratio)}
State: ${x.volume?.state || "-"}

━━━━━━━━━━━━━━━━

🔀 DIVERGENCE

RSI:
${x.divergence.rsi.status}

MACD:
${x.divergence.macd.status}

━━━━━━━━━━━━━━━━

🧱 SUPPORT

`;

  for (
    const z of
    (x.supportResistance.supports || [])
      .slice(0, 3)
  ) {
    s +=
      `${fmt(z.price)}\n`;
  }

  s +=
`
🧱 RESISTANCE

`;

  for (
    const z of
    (x.supportResistance.resistances || [])
      .slice(0, 3)
  ) {
    s +=
      `${fmt(z.price)}\n`;
  }

  if (a.orderBook) {
    s +=
`
━━━━━━━━━━━━━━━━

🧲 ORDER BOOK

Buy:
${fmt(a.orderBook.buyShare)}%

Sell:
${fmt(a.orderBook.sellShare)}%

Pressure:
${a.orderBook.pressure}
`;
  }

  if (a.footprint) {
    s +=
`
━━━━━━━━━━━━━━━━

👣 FOOTPRINT

Delta:
${fmt(a.footprint.delta)}

Delta %:
${fmt(a.footprint.deltaPercent)}%

Pressure:
${a.footprint.pressure}
`;
  }

  s +=
`
━━━━━━━━━━━━━━━━

🧠 TRADING STYLES
`;

  for (
    const st of
    a.tradingStyles
  ) {
    s +=
      `${st.name}: ${st.state}\n`;
  }

  s +=
`
━━━━━━━━━━━━━━━━

⚠️ Market analysis based on Bybit data.

🌐 Global Pulse`;

  return s;
}
