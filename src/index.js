const TELEGRAM_API = "https://api.telegram.org";
const BYBIT_API = "https://api.bybit.com";

const CONFIG = {
  SERVICE: "Global Pulse",
  WORKER: "telegram-auto-channel",
  LANGUAGE: "en",

  TELEGRAM_MAX_LENGTH: 4096,
  DUPLICATE_TTL: 86400,

  KLINE_1M: 200,
  KLINE_5M: 200,
  KLINE_15M: 200,
  KLINE_1H: 200,

  TRADE_LIMIT: 1000,
  ORDERBOOK_LIMIT: 50,

  BLOCKED_COUNTRIES: [
    "iran",
    "iranian",
    "islamic republic of iran",
    "tehran",
    "persia",
    "persian",
    "ایران",
    "ایرانی",
    "تهران"
  ]
};

/* =========================================================
   RESPONSE
========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/* =========================================================
   HELPERS
========================================================= */

function cleanText(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .trim();
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(a, b) {
  if (!b) return 0;
  return ((a - b) / b) * 100;
}

function average(arr) {
  const a = arr.filter(Number.isFinite);
  if (!a.length) return 0;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function median(arr) {
  const a = arr
    .filter(Number.isFinite)
    .sort((x, y) => x - y);

  if (!a.length) return 0;

  const m = Math.floor(a.length / 2);

  return a.length % 2
    ? a[m]
    : (a[m - 1] + a[m]) / 2;
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

/* =========================================================
   IRAN FILTER
========================================================= */

function blocked(text) {
  const value = cleanText(text).toLowerCase();

  return CONFIG.BLOCKED_COUNTRIES.some(
    x => value.includes(x.toLowerCase())
  );
}

/* =========================================================
   TELEGRAM
========================================================= */

async function telegram(env, method, body = {}) {

  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const response = await fetch(
    `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description || "Telegram API error"
    );
  }

  return data;
}

function channel(env) {

  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error(
      "TELEGRAM_CHANNEL_ID is not configured"
    );
  }

  return env.TELEGRAM_CHANNEL_ID;
}

async function sendTelegram(env, text) {

  return telegram(
    env,
    "sendMessage",
    {
      chat_id: channel(env),
      text: String(text).slice(0, 4096),
      disable_web_page_preview: true
    }
  );
}

/* =========================================================
   BYBIT API
========================================================= */

async function bybit(path, params = {}) {

  const qs = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      qs.set(key, String(value));
    }
  }

  const url =
    `${BYBIT_API}${path}?${qs.toString()}`;

  const response =
    await fetch(url, {
      headers: {
        "accept": "application/json"
      }
    });

  if (!response.ok) {
    throw new Error(
      `Bybit HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (data.retCode !== 0) {
    throw new Error(
      data.retMsg || "Bybit API error"
    );
  }

  return data.result;
}

/* =========================================================
   SYMBOL FINDER
========================================================= */

async function findSymbol(input) {

  let symbol =
    cleanText(input)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  if (!symbol) {
    throw new Error(
      "Symbol is required"
    );
  }

  if (!symbol.endsWith("USDT")) {
    symbol += "USDT";
  }

  let futures = null;
  let spot = null;

  try {

    const result =
      await bybit(
        "/v5/market/instruments-info",
        {
          category: "linear",
          symbol
        }
      );

    if (
      result.list &&
      result.list.length
    ) {
      futures = result.list[0];
    }

  } catch {}

  try {

    const result =
      await bybit(
        "/v5/market/instruments-info",
        {
          category: "spot",
          symbol
        }
      );

    if (
      result.list &&
      result.list.length
    ) {
      spot = result.list[0];
    }

  } catch {}

  if (!futures && !spot) {
    throw new Error(
      `Symbol ${symbol} was not found on Bybit`
    );
  }

  return {
    symbol,
    futures,
    spot,
    category: futures
      ? "linear"
      : "spot"
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
    .sort(
      (a, b) =>
        a.time - b.time
    );
}

async function getKlines(
  category,
  symbol,
  interval,
  limit
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
   MOVING AVERAGES
========================================================= */

function sma(values, period) {

  if (values.length < period) {
    return null;
  }

  return average(
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

  let value =
    average(values.slice(0, period));

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    value =
      values[i] * k +
      value * (1 - k);
  }

  return value;
}

/* =========================================================
   RSI
========================================================= */

function rsi(values, period = 14) {

  if (values.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {

    const diff =
      values[i] - values[i - 1];

    if (diff >= 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  let avgGain =
    gains / period;

  let avgLoss =
    losses / period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {

    const diff =
      values[i] - values[i - 1];

    const gain =
      Math.max(diff, 0);

    const loss =
      Math.max(-diff, 0);

    avgGain =
      ((avgGain * (period - 1)) + gain) /
      period;

    avgLoss =
      ((avgLoss * (period - 1)) + loss) /
      period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs =
    avgGain / avgLoss;

  return 100 - (100 / (1 + rs));
}

/* =========================================================
   MACD
========================================================= */

function macd(values) {

  if (values.length < 35) {
    return null;
  }

  const fast = [];
  const slow = [];

  for (let i = 0; i < values.length; i++) {

    fast.push(
      ema(
        values.slice(0, i + 1),
        12
      )
    );

    slow.push(
      ema(
        values.slice(0, i + 1),
        26
      )
    );
  }

  const macdValues =
    fast
      .map((x, i) =>
        x !== null &&
        slow[i] !== null
          ? x - slow[i]
          : null
      )
      .filter(x => x !== null);

  const signal =
    ema(macdValues, 9);

  const line =
    macdValues[
      macdValues.length - 1
    ];

  return {
    macd: line,
    signal,
    histogram:
      signal !== null
        ? line - signal
        : null
  };
}

/* =========================================================
   ATR
========================================================= */

function atr(candles, period = 14) {

  if (candles.length <= period) {
    return null;
  }

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

  return average(
    tr.slice(-period)
  );
}

/* =========================================================
   BOLLINGER
========================================================= */

function bollinger(values, period = 20) {

  if (values.length < period) {
    return null;
  }

  const data =
    values.slice(-period);

  const mid =
    average(data);

  const variance =
    average(
      data.map(
        x => Math.pow(x - mid, 2)
      )
    );

  const sd =
    Math.sqrt(variance);

  return {
    middle: mid,
    upper: mid + 2 * sd,
    lower: mid - 2 * sd,
    width:
      mid
        ? ((4 * sd) / mid) * 100
        : 0
  };
}

/* =========================================================
   SUPPORT / RESISTANCE
========================================================= */

function supportResistance(candles) {

  const highs =
    candles
      .map(x => x.high)
      .filter(Boolean);

  const lows =
    candles
      .map(x => x.low)
      .filter(Boolean);

  const resistance =
    highs
      .sort((a, b) => b - a)
      .slice(0, 5);

  const support =
    lows
      .sort((a, b) => a - b)
      .slice(0, 5);

  return {
    support,
    resistance
  };
}

/* =========================================================
   STRUCTURE / BOS / CHOCH
========================================================= */

function marketStructure(candles) {

  if (candles.length < 20) {
    return {
      trend: "NEUTRAL",
      bos: false,
      choch: false
    };
  }

  const recent =
    candles.slice(-20);

  const first =
    recent[0].close;

  const last =
    recent[recent.length - 1].close;

  const highs =
    recent.map(x => x.high);

  const lows =
    recent.map(x => x.low);

  const highNow =
    Math.max(...highs.slice(-8));

  const highOld =
    Math.max(...highs.slice(0, 8));

  const lowNow =
    Math.min(...lows.slice(-8));

  const lowOld =
    Math.min(...lows.slice(0, 8));

  if (
    last > first &&
    highNow >= highOld
  ) {
    return {
      trend: "BULLISH",
      bos: last > highOld,
      choch: false
    };
  }

  if (
    last < first &&
    lowNow <= lowOld
  ) {
    return {
      trend: "BEARISH",
      bos: last < lowOld,
      choch: false
    };
  }

  return {
    trend: "RANGE",
    bos: false,
    choch: true
  };
}

/* =========================================================
   ORDER BOOK
========================================================= */

async function getOrderbook(
  category,
  symbol
) {

  const result =
    await bybit(
      "/v5/market/orderbook",
      {
        category,
        symbol,
        limit:
          CONFIG.ORDERBOOK_LIMIT
      }
    );

  const bids =
    (result.b || []).map(
      x => ({
        price: num(x[0]),
        size: num(x[1])
      })
    );

  const asks =
    (result.a || []).map(
      x => ({
        price: num(x[0]),
        size: num(x[1])
      })
    );

  const buyLiquidity =
    bids.reduce(
      (sum, x) =>
        sum + x.price * x.size,
      0
    );

  const sellLiquidity =
    asks.reduce(
      (sum, x) =>
        sum + x.price * x.size,
      0
    );

  const total =
    buyLiquidity + sellLiquidity;

  const buyShare =
    total
      ? buyLiquidity / total * 100
      : 50;

  const sellShare =
    total
      ? sellLiquidity / total * 100
      : 50;

  const bidSizes =
    bids.map(x => x.size);

  const askSizes =
    asks.map(x => x.size);

  const bidMedian =
    median(bidSizes);

  const askMedian =
    median(askSizes);

  const buyWalls =
    bids
      .filter(
        x =>
          bidMedian > 0 &&
          x.size >= bidMedian * 4
      )
      .sort(
        (a, b) =>
          b.size - a.size
      )
      .slice(0, 5);

  const sellWalls =
    asks
      .filter(
        x =>
          askMedian > 0 &&
          x.size >= askMedian * 4
      )
      .sort(
        (a, b) =>
          b.size - a.size
      )
      .slice(0, 5);

  return {
    bids,
    asks,
    buyLiquidity,
    sellLiquidity,
    buyShare,
    sellShare,
    bestBid:
      bids[0]?.price || 0,
    bestAsk:
      asks[0]?.price || 0,
    buyWalls,
    sellWalls
  };
}

/* =========================================================
   FOOTPRINT
========================================================= */

async function getFootprint(
  category,
  symbol
) {

  const result =
    await bybit(
      "/v5/market/recent-trade",
      {
        category,
        symbol,
        limit:
          CONFIG.TRADE_LIMIT
      }
    );

  const trades =
    result.list || [];

  let buyVolume = 0;
  let sellVolume = 0;

  let buyNotional = 0;
  let sellNotional = 0;

  let buyTrades = 0;
  let sellTrades = 0;

  const notionals = [];

  for (const trade of trades) {

    const price =
      num(trade.price);

    const size =
      num(trade.size);

    const value =
      price * size;

    notionals.push(value);

    const side =
      String(
        trade.side || ""
      ).toLowerCase();

    if (side === "buy") {

      buyVolume += size;
      buyNotional += value;
      buyTrades++;

    } else {

      sellVolume += size;
      sellNotional += value;
      sellTrades++;
    }
  }

  const total =
    buyNotional + sellNotional;

  const delta =
    buyNotional - sellNotional;

  const deltaPercent =
    total
      ? delta / total * 100
      : 0;

  const averageNotional =
    average(notionals);

  const p95 =
    notionals
      .slice()
      .sort((a, b) => a - b)[
        Math.floor(
          notionals.length * 0.95
        )
      ] || 0;

  const largeThreshold =
    Math.max(
      averageNotional * 5,
      p95
    );

  let largeBuy = 0;
  let largeSell = 0;

  for (const trade of trades) {

    const value =
      num(trade.price) *
      num(trade.size);

    if (value >= largeThreshold) {

      if (
        String(trade.side).toLowerCase() ===
        "buy"
      ) {
        largeBuy += value;
      } else {
        largeSell += value;
      }
    }
  }

  let pressure = "NEUTRAL";

  if (deltaPercent >= 10) {
    pressure = "BUY_PRESSURE";
  }

  if (deltaPercent <= -10) {
    pressure = "SELL_PRESSURE";
  }

  return {
    trades: trades.length,
    buyVolume,
    sellVolume,
    buyNotional,
    sellNotional,
    buyTrades,
    sellTrades,
    delta,
    deltaPercent,
    averageNotional,
    largeThreshold,
    largeBuy,
    largeSell,
    pressure
  };
}

/* =========================================================
   LIQUIDITY HUNT
========================================================= */

function liquidityHunt(candles) {

  if (candles.length < 30) {
    return {
      detected: false,
      type: "NONE",
      strength: 0
    };
  }

  const recent =
    candles[candles.length - 1];

  const previous =
    candles.slice(-21, -1);

  const priorHigh =
    Math.max(
      ...previous.map(x => x.high)
    );

  const priorLow =
    Math.min(
      ...previous.map(x => x.low)
    );

  const bullishSweep =
    recent.low < priorLow &&
    recent.close > priorLow;

  const bearishSweep =
    recent.high > priorHigh &&
    recent.close < priorHigh;

  if (bullishSweep) {

    return {
      detected: true,
      type: "BULLISH_LIQUIDITY_SWEEP",
      strength:
        clamp(
          Math.abs(
            recent.close -
            recent.low
          ) /
          Math.max(
            recent.high -
            recent.low,
            1e-12
          ) *
          100
        )
    };
  }

  if (bearishSweep) {

    return {
      detected: true,
      type: "BEARISH_LIQUIDITY_SWEEP",
      strength:
        clamp(
          Math.abs(
            recent.high -
            recent.close
          ) /
          Math.max(
            recent.high -
            recent.low,
            1e-12
          ) *
          100
        )
    };
  }

  return {
    detected: false,
    type: "NONE",
    strength: 0
  };
}

/* =========================================================
   FUTURES DATA
========================================================= */

async function futuresData(symbol) {

  const output = {
    openInterest: null,
    fundingRate: null,
    longShortRatio: null
  };

  try {

    const oi =
      await bybit(
        "/v5/market/open-interest",
        {
          category: "linear",
          symbol,
          intervalTime: "5min",
          limit: 1
        }
      );

    output.openInterest =
      num(
        oi.list?.[0]?.openInterest
      );

  } catch {}

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

    output.fundingRate =
      num(
        funding.list?.[0]?.fundingRate
      );

  } catch {}

  try {

    const ratio =
      await bybit(
        "/v5/market/account-ratio",
        {
          category: "linear",
          symbol,
          period: "5min",
          limit: 1
        }
      );

    const item =
      ratio.list?.[0];

    if (item) {

      output.longShortRatio =
        num(
          item.longShortRatio
        );
    }

  } catch {}

  return output;
}

/* =========================================================
   INDICATORS
========================================================= */

function indicators(candles) {

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

  const b =
    bollinger(closes, 20);

  let score = 50;
  const reasons = [];

  if (ma20 !== null) {

    if (price > ma20) {

      score += 8;

      reasons.push(
        "Price is above MA20"
      );

    } else {

      score -= 8;

      reasons.push(
        "Price is below MA20"
      );
    }
  }

  if (
    ma50 !== null &&
    ma20 !== null
  ) {

    if (ma20 > ma50) {

      score += 8;

      reasons.push(
        "MA20 is above MA50"
      );

    } else {

      score -= 8;

      reasons.push(
        "MA20 is below MA50"
      );
    }
  }

  if (r !== null) {

    if (r >= 55 && r <= 70) {

      score += 7;

      reasons.push(
        "RSI supports bullish momentum"
      );

    } else if (
      r <= 45 &&
      r >= 30
    ) {

      score -= 7;

      reasons.push(
        "RSI supports bearish momentum"
      );

    } else if (r > 70) {

      reasons.push(
        "RSI is overbought"
      );

    } else if (r < 30) {

      reasons.push(
        "RSI is oversold"
      );
    }
  }

  if (m) {

    if (
      m.macd !== null &&
      m.signal !== null
    ) {

      if (m.macd > m.signal) {

        score += 7;

        reasons.push(
          "MACD is bullish"
        );

      } else {

        score -= 7;

        reasons.push(
          "MACD is bearish"
        );
      }
    }
  }

  return {
    price,
    ma20,
    ma50,
    ma100,
    ema20,
    ema50,
    rsi: r,
    macd: m,
    atr: a,
    bollinger: b,
    score: clamp(score),
    reasons
  };
}

/* =========================================================
   15M CONFIRMATION
========================================================= */

function confirmation15m(candles) {

  const closes =
    candles.map(x => x.close);

  const price =
    closes[closes.length - 1];

  const ma20 =
    sma(closes, 20);

  const ma50 =
    sma(closes, 50);

  if (
    ma20 !== null &&
    ma50 !== null
  ) {

    if (
      price > ma20 &&
      ma20 > ma50
    ) {
      return {
        direction: "BULLISH",
        score: 100,
        reason:
          "15m price > MA20 > MA50"
      };
    }

    if (
      price < ma20 &&
      ma20 < ma50
    ) {
      return {
        direction: "BEARISH",
        score: 0,
        reason:
          "15m price < MA20 < MA50"
      };
    }
  }

  return {
    direction: "NEUTRAL",
    score: 50,
    reason:
      "15m structure is mixed"
  };
}

/* =========================================================
   TRADING STYLE ANALYSIS
========================================================= */

function styles(data) {

  const {
    one,
    five,
    fifteen,
    oneHour,
    structure,
    footprint,
    orderbook,
    hunt
  } = data;

  const result = {};

  const bull =
    one.score >= 58 &&
    fifteen.direction === "BULLISH";

  const bear =
    one.score <= 42 &&
    fifteen.direction === "BEARISH";

  result.scalping = {
    bias:
      footprint.pressure ===
      "BUY_PRESSURE"
        ? "LONG"
        : footprint.pressure ===
          "SELL_PRESSURE"
            ? "SHORT"
            : "WAIT",
    reason:
      `1m order-flow: ${footprint.pressure}; ` +
      `delta ${footprint.deltaPercent.toFixed(2)}%`
  };

  result.dayTrading = {
    bias:
      bull
        ? "LONG"
        : bear
          ? "SHORT"
          : "WAIT",
    reason:
      `1m score ${one.score.toFixed(0)}/100 with 15m confirmation ${fifteen.direction}`
  };

  result.swing = {
    bias:
      oneHour.score >= 58
        ? "LONG"
        : oneHour.score <= 42
          ? "SHORT"
          : "WAIT",
    reason:
      `1H trend score ${oneHour.score.toFixed(0)}/100`
  };

  result.momentum = {
    bias:
      structure.trend === "BULLISH"
        ? "LONG"
        : structure.trend === "BEARISH"
          ? "SHORT"
          : "WAIT",
    reason:
      `Market structure: ${structure.trend}`
  };

  result.meanReversion = {
    bias:
      one.rsi !== null &&
      one.rsi < 30
        ? "LONG WATCH"
        : one.rsi !== null &&
          one.rsi > 70
          ? "SHORT WATCH"
          : "WAIT",
    reason:
      `RSI ${one.rsi?.toFixed(2) ?? "N/A"}`
  };

  result.smartMoney = {
    bias:
      hunt.type ===
      "BULLISH_LIQUIDITY_SWEEP"
        ? "LONG WATCH"
        : hunt.type ===
          "BEARISH_LIQUIDITY_SWEEP"
          ? "SHORT WATCH"
          : orderbook.buyShare >
            orderbook.sellShare + 8
            ? "LONG"
            : orderbook.sellShare >
              orderbook.buyShare + 8
              ? "SHORT"
              : "WAIT",
    reason:
      `Liquidity hunt: ${hunt.type}; ` +
      `orderbook ${orderbook.buyShare.toFixed(1)}% buy / ` +
      `${orderbook.sellShare.toFixed(1)}% sell`
  };

  result.breakout = {
    bias:
      one.bollinger &&
      one.bollinger.width < 3
        ? "BREAKOUT WATCH"
        : "WAIT",
    reason:
      one.bollinger
        ? `Bollinger width ${one.bollinger.width.toFixed(2)}%`
        : "No Bollinger data"
  };

  return result;
}

/* =========================================================
   FINAL VERDICT
========================================================= */

function finalVerdict(data) {

  let score = 50;
  const reasons = [];

  score +=
    (data.one.score - 50) * 0.45;

  score +=
    (data.fifteen.score - 50) * 0.25;

  if (
    data.footprint.pressure ===
    "BUY_PRESSURE"
  ) {
    score += 10;
    reasons.push(
      "Buy-side footprint pressure"
    );
  }

  if (
    data.footprint.pressure ===
    "SELL_PRESSURE"
  ) {
    score -= 10;
    reasons.push(
      "Sell-side footprint pressure"
    );
  }

  if (
    data.orderbook.buyShare >
    data.orderbook.sellShare + 8
  ) {
    score += 8;
    reasons.push(
      "Buy-side order-book dominance"
    );
  }

  if (
    data.orderbook.sellShare >
    data.orderbook.buyShare + 8
  ) {
    score -= 8;
    reasons.push(
      "Sell-side order-book dominance"
    );
  }

  if (
    data.hunt.type ===
    "BULLISH_LIQUIDITY_SWEEP"
  ) {
    score += 8;
    reasons.push(
      "Bullish liquidity sweep"
    );
  }

  if (
    data.hunt.type ===
    "BEARISH_LIQUIDITY_SWEEP"
  ) {
    score -= 8;
    reasons.push(
      "Bearish liquidity sweep"
    );
  }

  score =
    clamp(score);

  let bias = "NEUTRAL";

  if (score >= 65) {
    bias = "BULLISH";
  } else if (score <= 35) {
    bias = "BEARISH";
  } else {
    bias = "WAIT";
  }

  return {
    score,
    bias,
    reasons
  };
}

/* =========================================================
   DEEP ANALYSIS
========================================================= */

async function analyzeCrypto(input) {

  const found =
    await findSymbol(input);

  const category =
    found.category;

  const symbol =
    found.symbol;

  const [
    k1,
    k5,
    k15,
    k60,
    orderbook,
    footprint
  ] = await Promise.all([
    getKlines(
      category,
      symbol,
      "1",
      CONFIG.KLINE_1M
    ),
    getKlines(
      category,
      symbol,
      "5",
      CONFIG.KLINE_5M
    ),
    getKlines(
      category,
      symbol,
      "15",
      CONFIG.KLINE_15M
    ),
    getKlines(
      category,
      symbol,
      "60",
      CONFIG.KLINE_1H
    ),
    getOrderbook(
      category,
      symbol
    ),
    getFootprint(
      category,
      symbol
    )
  ]);

  const one =
    indicators(k1);

  const five =
    indicators(k5);

  const fifteen =
    indicators(k15);

  const oneHour =
    indicators(k60);

  const confirm =
    confirmation15m(k15);

  const structure =
    marketStructure(k15);

  const sr =
    supportResistance(k15);

  const hunt =
    liquidityHunt(k15);

  const futures =
    category === "linear"
      ? await futuresData(symbol)
      : {
          openInterest: null,
          fundingRate: null,
          longShortRatio: null
        };

  const data = {
    symbol,
    category,

    one,
    five,
    fifteen,
    oneHour,

    confirm,
    structure,

    support: sr.support,
    resistance: sr.resistance,

    hunt,
    orderbook,
    footprint,
    futures
  };

  data.styles =
    styles(data);

  data.verdict =
    finalVerdict(data);

  return data;
}

/* =========================================================
   FORMAT PRICE
========================================================= */

function formatPrice(v) {

  const n = num(v);

  if (!n) return "N/A";

  if (n >= 1000) {
    return n.toLocaleString(
      "en-US",
      {
        maximumFractionDigits: 2
      }
    );
  }

  if (n >= 1) {
    return n.toFixed(4);
  }

  if (n >= 0.01) {
    return n.toFixed(6);
  }

  return n.toPrecision(6);
}

/* =========================================================
   FORMAT ANALYSIS
========================================================= */

function analysisText(data) {

  const f =
    data.footprint;

  const o =
    data.orderbook;

  const v =
    data.verdict;

  const style =
    data.styles;

  const support =
    data.support
      .slice(0, 3)
      .map(formatPrice)
      .join(" / ");

  const resistance =
    data.resistance
      .slice(0, 3)
      .map(formatPrice)
      .join(" / ");

  return `
🌍 <b>GLOBAL PULSE — CRYPTO DEEP ANALYSIS</b>

🪙 <b>${esc(data.symbol)}</b>
🏦 Market: <b>Bybit ${esc(data.category)}</b>

━━━━━━━━━━━━━━━━━━

💰 <b>PRICE</b>
Current: <b>${formatPrice(data.one.price)}</b>

📊 <b>FINAL MARKET BIAS</b>
${v.bias === "BULLISH" ? "🟢" : v.bias === "BEARISH" ? "🔴" : "🟡"}
<b>${esc(v.bias)}</b>
Confidence score: <b>${v.score.toFixed(1)}/100</b>

${v.reasons.length
  ? "Reasons:\n" +
    v.reasons
      .map(x => "• " + esc(x))
      .join("\n")
  : ""}

━━━━━━━━━━━━━━━━━━

📈 <b>TECHNICAL ANALYSIS</b>

1M:
MA20: ${formatPrice(data.one.ma20)}
MA50: ${formatPrice(data.one.ma50)}
RSI: ${data.one.rsi?.toFixed(2) ?? "N/A"}
MACD: ${data.one.macd?.macd?.toFixed(6) ?? "N/A"}

5M:
RSI: ${data.five.rsi?.toFixed(2) ?? "N/A"}
Score: ${data.five.score.toFixed(1)}/100

15M:
Trend: <b>${data.confirm.direction}</b>
${esc(data.confirm.reason)}

1H:
Score: ${data.oneHour.score.toFixed(1)}/100

━━━━━━━━━━━━━━━━━━

🏗 <b>MARKET STRUCTURE</b>

Trend:
<b>${data.structure.trend}</b>

BOS:
${data.structure.bos ? "✅ Detected" : "❌ Not detected"}

CHoCH:
${data.structure.choch ? "⚠️ Possible" : "—"}

━━━━━━━━━━━━━━━━━━

🎯 <b>SUPPORT / RESISTANCE</b>

Support:
${esc(support || "N/A")}

Resistance:
${esc(resistance || "N/A")}

━━━━━━━━━━━━━━━━━━

💧 <b>LIQUIDITY / HUNT</b>

${esc(data.hunt.type)}

Strength:
${data.hunt.strength.toFixed(1)}%

━━━━━━━━━━━━━━━━━━

📚 <b>ORDER BOOK</b>

Buy liquidity:
${o.buyShare.toFixed(2)}%

Sell liquidity:
${o.sellShare.toFixed(2)}%

Best Bid:
${formatPrice(o.bestBid)}

Best Ask:
${formatPrice(o.bestAsk)}

Buy Walls:
${o.buyWalls
  .slice(0, 3)
  .map(
    x =>
      `${formatPrice(x.price)} (${x.size.toLocaleString()})`
  )
  .join("\n") || "None"}

Sell Walls:
${o.sellWalls
  .slice(0, 3)
  .map(
    x =>
      `${formatPrice(x.price)} (${x.size.toLocaleString()})`
  )
  .join("\n") || "None"}

━━━━━━━━━━━━━━━━━━

👣 <b>FOOTPRINT / ORDER FLOW</b>

Trades analyzed:
${f.trades}

Buy volume:
${f.buyVolume.toLocaleString()}

Sell volume:
${f.sellVolume.toLocaleString()}

Buy notional:
$${f.buyNotional.toLocaleString(undefined, {
  maximumFractionDigits: 2
})}

Sell notional:
$${f.sellNotional.toLocaleString(undefined, {
  maximumFractionDigits: 2
})}

Delta:
$${f.delta.toLocaleString(undefined, {
  maximumFractionDigits: 2
})}

Delta %:
${f.deltaPercent.toFixed(2)}%

Pressure:
<b>${f.pressure}</b>

Large buy:
$${f.largeBuy.toLocaleString(undefined, {
  maximumFractionDigits: 2
})}

Large sell:
$${f.largeSell.toLocaleString(undefined, {
  maximumFractionDigits: 2
})}

━━━━━━━━━━━━━━━━━━

⚔️ <b>TRADING STYLES</b>

⚡ Scalping:
<b>${style.scalping.bias}</b>
${esc(style.scalping.reason)}

📅 Day Trading:
<b>${style.dayTrading.bias}</b>
${esc(style.dayTrading.reason)}

📆 Swing:
<b>${style.swing.bias}</b>
${esc(style.swing.reason)}

🚀 Momentum:
<b>${style.momentum.bias}</b>
${esc(style.momentum.reason)}

🔄 Mean Reversion:
<b>${style.meanReversion.bias}</b>
${esc(style.meanReversion.reason)}

🧠 Smart Money:
<b>${style.smartMoney.bias}</b>
${esc(style.smartMoney.reason)}

💥 Breakout:
<b>${style.breakout.bias}</b>
${esc(style.breakout.reason)}

━━━━━━━━━━━━━━━━━━

${
  data.category === "linear"
    ? `
📌 <b>FUTURES DATA</b>

Open Interest:
${data.futures.openInterest ?? "N/A"}

Funding Rate:
${data.futures.fundingRate !== null
  ? (data.futures.fundingRate * 100).toFixed(4) + "%"
  : "N/A"}

Long / Short Ratio:
${data.futures.longShortRatio ?? "N/A"}
`
    : ""
}

━━━━━━━━━━━━━━━━━━

🧮 <b>ANALYSIS BASIS</b>

This report is calculated from live
Bybit market data.

Included:
• 1M / 5M / 15M / 1H candles
• Moving averages
• RSI
• MACD
• ATR
• Bollinger Bands
• Market structure
• BOS / CHoCH
• Support / Resistance
• Liquidity Hunt / Sweep
• Order Book
• Buy / Sell Walls
• Recent Trades
• Footprint
• Delta
• Large order flow
• Open Interest
• Funding
• Long/Short Ratio

━━━━━━━━━━━━━━━━━━

🔎 <b>DATA SOURCE</b>

Bybit public market data

⚠️ This is market analysis,
not financial advice.

#GlobalPulse #Crypto #Bybit
`.trim();
}

/* =========================================================
   CRYPTO HTML PAGE
========================================================= */

function cryptoPage() {

return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1">

<title>Global Pulse Crypto Analyzer</title>

<style>

* {
  box-sizing:border-box;
}

body {
  margin:0;
  background:#07111f;
  color:#eaf2ff;
  font-family:
    Arial,
    sans-serif;
}

.container {
  max-width:900px;
  margin:auto;
  padding:20px;
}

h1 {
  text-align:center;
}

.search {
  display:flex;
  gap:10px;
  margin:20px 0;
}

input {
  flex:1;
  padding:15px;
  border-radius:10px;
  border:1px solid #334;
  background:#101d30;
  color:white;
  font-size:18px;
}

button {
  padding:15px 22px;
  border:0;
  border-radius:10px;
  cursor:pointer;
  font-weight:bold;
}

#result {
  white-space:pre-wrap;
  background:#0d1929;
  border-radius:14px;
  padding:20px;
  line-height:1.7;
  overflow:auto;
}

.loading {
  text-align:center;
  padding:30px;
}

</style>
</head>

<body>

<div class="container">

<h1>🌍 Global Pulse</h1>

<p>
🪙 Bybit Crypto Deep Analyzer
</p>

<div class="search">

<input
id="symbol"
placeholder="BTC / ETH / SOL / PEPE..."
autocomplete="off">

<button
onclick="analyze()">
🔎 Analyze
</button>

</div>

<div id="result">
Enter a cryptocurrency symbol.
</div>

</div>

<script>

async function analyze() {

  const symbol =
    document.getElementById("symbol").value.trim();

  if (!symbol) {
    return;
  }

  const result =
    document.getElementById("result");

  result.innerHTML =
    '<div class="loading">⏳ Collecting live Bybit data...</div>';

  try {

    const response =
      await fetch(
        "/crypto-api?symbol=" +
        encodeURIComponent(symbol)
      );

    const data =
      await response.json();

    if (!data.ok) {

      result.textContent =
        "❌ " + (data.error || "Analysis failed");

      return;
    }

    result.innerHTML =
      data.html;

  } catch (error) {

    result.textContent =
      "❌ " + error.message;
  }
}

document
  .getElementById("symbol")
  .addEventListener(
    "keydown",
    e => {
      if (e.key === "Enter") {
        analyze();
      }
    }
  );

</script>

</body>
</html>`;
}

/* =========================================================
   MAIN WORKER
========================================================= */

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

    try {

      /* =====================================================
         HOME
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {

        return json({

          ok:true,

          service:
            CONFIG.SERVICE,

          worker:
            CONFIG.WORKER,

          status:
            "online",

          time:
            new Date().toISOString(),

          telegram:
            !!env.TELEGRAM_BOT_TOKEN,

          channel:
            !!env.TELEGRAM_CHANNEL_ID,

          cryptoAnalyzer:
            true,

          bybit:
            true
        });
      }

      /* =====================================================
         CRYPTO ANALYZER PAGE
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/crypto"
      ) {

        return html(
          cryptoPage()
        );
      }

      /* =====================================================
         CRYPTO API
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/crypto-api"
      ) {

        const symbol =
          url.searchParams.get(
            "symbol"
          );

        if (!symbol) {

          return json(
            {
              ok:false,
              error:
                "Use /crypto-api?symbol=BTC"
            },
            400
          );
        }

        const analysis =
          await analyzeCrypto(
            symbol
          );

        const text =
          analysisText(
            analysis
          );

        return json({
          ok:true,
          symbol:
            analysis.symbol,
          category:
            analysis.category,
          analysis,
          html:
            text
        });
      }

      /* =====================================================
         PUBLISH CRYPTO ANALYSIS
         POST /publish-crypto
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-crypto"
      ) {

        const body =
          await request.json();

        const symbol =
          body.symbol ||
          body.coin ||
          body.asset;

        if (!symbol) {

          return json(
            {
              ok:false,
              error:
                "symbol is required"
            },
            400
          );
        }

        const analysis =
          await analyzeCrypto(
            symbol
          );

        const text =
          analysisText(
            analysis
          );

        const result =
          await sendTelegram(
            env,
            text
          );

        return json({

          ok:true,

          symbol:
            analysis.symbol,

          category:
            analysis.category,

          message_id:
            result.result.message_id,

          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =====================================================
         TEST TELEGRAM
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/test-telegram"
      ) {

        const me =
          await telegram(
            env,
            "getMe"
          );

        return json({
          ok:true,
          bot:me.result,
          channel_id:
            env.TELEGRAM_CHANNEL_ID || null
        });
      }

      /* =====================================================
         TEST CHANNEL
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/test-channel"
      ) {

        const message = [
          "🌍 Global Pulse",
          "",
          "✅ Worker connected to Telegram.",
          "",
          "🤖 Global Pulse Assistant",
          "⚙️ Global publishing system is ready.",
          "",
          "📰 Global News",
          "💰 Global Price",
          "⚔️ Country Battle",
          "🔥 Global Trend",
          "🏠 Cost of Living",
          "🪙 Crypto Deep Analyzer"
        ].join("\n");

        const result =
          await sendTelegram(
            env,
            message
          );

        return json({
          ok:true,
          message_id:
            result.result.message_id,
          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =====================================================
         CUSTOM SEND
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/send"
      ) {

        const body =
          await request.json();

        const text =
          body.text ||
          body.message ||
          "";

        if (!text) {

          return json(
            {
              ok:false,
              error:
                "text or message is required"
            },
            400
          );
        }

        if (blocked(text)) {

          return json({
            ok:false,
            skipped:true,
            reason:
              "blocked-content"
          });
        }

        const result =
          await sendTelegram(
            env,
            text
          );

        return json({
          ok:true,
          message_id:
            result.result.message_id,
          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =====================================================
         TELEGRAM WEBHOOK
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/telegram-webhook"
      ) {

        const update =
          await request.json();

        console.log(
          JSON.stringify({
            type:
              "telegram_update",
            update_id:
              update.update_id || null
          })
        );

        return json({
          ok:true
        });
      }

      /* =====================================================
         404
      ===================================================== */

      return json(
        {
          ok:false,
          error:"Not Found",
          path:url.pathname
        },
        404
      );

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

      return json(
        {
          ok:false,
          error:
            error.message ||
            String(error)
        },
        500
      );
    }
  }
};
