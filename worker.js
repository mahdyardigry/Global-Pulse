const VERSION = "GLOBAL-PULSE-V2";
const BYBIT = "https://api.bybit.com";
const TELEGRAM = "https://api.telegram.org";

const TF = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "D",
  "1w": "W"
};

const NEWS_QUERIES = [
  "world news",
  "global economy",
  "technology AI",
  "business markets",
  "travel",
  "shopping deals",
  "consumer trends",
  "cryptocurrency"
];

const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Germany",
  "France",
  "Italy",
  "Spain",
  "Turkey",
  "United Arab Emirates",
  "Saudi Arabia",
  "Japan",
  "South Korea",
  "India",
  "Singapore",
  "Australia",
  "Canada",
  "Brazil",
  "Mexico"
];

const IRAN_WORDS = [
  "iran",
  "iranian",
  "tehran",
  "ایران",
  "تهران"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "access-control-allow-origin": "*"
    }
  });
}

function text(data, status = 200) {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/plain;charset=UTF-8"
    }
  });
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fmt(n, digits = 4) {
  if (!Number.isFinite(Number(n))) return "N/A";

  const x = Number(n);

  if (Math.abs(x) >= 1000000000)
    return (x / 1000000000).toFixed(2) + "B";

  if (Math.abs(x) >= 1000000)
    return (x / 1000000).toFixed(2) + "M";

  if (Math.abs(x) >= 1000)
    return (x / 1000).toFixed(2) + "K";

  return x.toFixed(digits);
}

function percent(n) {
  if (!Number.isFinite(Number(n))) return "N/A";
  const x = Number(n);
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clean(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isIran(s) {
  const x = String(s || "").toLowerCase();
  return IRAN_WORDS.some(w => x.includes(w));
}

/* =========================================================
   TELEGRAM
========================================================= */

async function telegram(env, method, body) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  const r = await fetch(
    `${TELEGRAM}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await r.json();

  if (!data.ok) {
    throw new Error(
      data.description || `Telegram ${method} failed`
    );
  }

  return data;
}

async function sendTelegram(env, chatId, message) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

async function sendChannel(env, message) {
  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error("TELEGRAM_CHANNEL_ID is missing");
  }

  return sendTelegram(
    env,
    env.TELEGRAM_CHANNEL_ID,
    message
  );
}

/* =========================================================
   NEWS
========================================================= */

function rssUrl(query) {
  return (
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=en-US&gl=US&ceid=US:en"
  );
}

async function fetchRSS(query) {
  const r = await fetch(rssUrl(query), {
    headers: {
      "user-agent": "GlobalPulse/2.0"
    }
  });

  if (!r.ok) {
    throw new Error(`RSS ${r.status}`);
  }

  return r.text();
}

function parseRSS(xml, limit = 10) {
  const result = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;

  let match;

  while (
    (match = re.exec(xml)) &&
    result.length < limit
  ) {
    const block = match[1];

    const title = clean(
      (block.match(
        /<title>([\s\S]*?)<\/title>/i
      ) || [])[1]
    );

    const link = clean(
      (block.match(
        /<link>([\s\S]*?)<\/link>/i
      ) || [])[1]
    );

    const date = clean(
      (block.match(
        /<pubDate>([\s\S]*?)<\/pubDate>/i
      ) || [])[1]
    );

    if (!title || isIran(title)) continue;

    result.push({
      title,
      link,
      date
    });
  }

  return result;
}

async function getNews(query, limit = 8) {
  try {
    const xml = await fetchRSS(query);
    return parseRSS(xml, limit);
  } catch {
    return [];
  }
}

async function buildNews() {
  const all = [];

  for (const query of NEWS_QUERIES) {
    const items = await getNews(query, 4);

    for (const item of items) {
      const duplicate = all.some(
        x =>
          x.title.toLowerCase() ===
          item.title.toLowerCase()
      );

      if (!duplicate) {
        all.push(item);
      }
    }

    if (all.length >= 10) break;
  }

  let out = `
🌍 <b>GLOBAL PULSE</b>

📰 <b>WORLD NEWS RADAR</b>

`;

  if (!all.length) {
    out +=
      "No major international headlines are available right now.";
  } else {
    all.slice(0, 8).forEach((x, i) => {
      out +=
        `${i + 1}. <b>${esc(x.title)}</b>\n`;

      if (x.link) {
        out += `🔗 ${esc(x.link)}\n`;
      }

      out += "\n";
    });
  }

  out += `
━━━━━━━━━━━━━━━━
🌐 International coverage
🚫 No Iran-focused news
`;

  return out;
}

/* =========================================================
   COUNTRY TREND
========================================================= */

async function buildTrend() {
  const index =
    Math.floor(Date.now() / 3600000) %
    COUNTRIES.length;

  const country = COUNTRIES[index];

  const queries = [
    `"${country}" trending`,
    `"${country}" popular products`,
    `"${country}" shopping trends`,
    `"${country}" consumer trends`
  ];

  const all = [];

  for (const q of queries) {
    const items = await getNews(q, 3);

    for (const item of items) {
      if (
        !all.some(
          x =>
            x.title.toLowerCase() ===
            item.title.toLowerCase()
        )
      ) {
        all.push(item);
      }
    }
  }

  let out = `
🔥 <b>COUNTRY TREND RADAR</b>

🌍 <b>${esc(country)}</b>

What is attracting attention:

`;

  if (!all.length) {
    out += "No reliable trend data available right now.\n";
  } else {
    all.slice(0, 8).forEach((x, i) => {
      out +=
        `${i + 1}. ${esc(x.title)}\n` +
        `🔗 ${esc(x.link)}\n\n`;
    });
  }

  out += `
━━━━━━━━━━━━━━━━
📊 Trends rotate automatically
🌐 Global Pulse
`;

  return out;
}

/* =========================================================
   SHOPPING
========================================================= */

async function buildShopping() {
  const queries = [
    "best shopping deals today",
    "best electronics deals",
    "popular products this week",
    "cheap travel deals",
    "best shopping Europe",
    "best shopping USA"
  ];

  const all = [];

  for (const q of queries) {
    const items = await getNews(q, 3);

    for (const item of items) {
      if (
        !all.some(
          x =>
            x.title.toLowerCase() ===
            item.title.toLowerCase()
        )
      ) {
        all.push(item);
      }
    }
  }

  let out = `
🛒 <b>GLOBAL SHOPPING RADAR</b>

🔥 Popular deals & consumer topics

`;

  if (!all.length) {
    out += "No shopping information available.\n";
  } else {
    all.slice(0, 8).forEach((x, i) => {
      out +=
        `${i + 1}. <b>${esc(x.title)}</b>\n` +
        `🔗 ${esc(x.link)}\n\n`;
    });
  }

  out += `
━━━━━━━━━━━━━━━━
⚠️ Prices and availability can change.
🌐 Global Pulse
`;

  return out;
}

/* =========================================================
   BYBIT
========================================================= */

async function bybit(path, params = {}) {
  const url = new URL(BYBIT + path);

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, value);
    }
  }

  const r = await fetch(url.toString());

  if (!r.ok) {
    throw new Error(`Bybit HTTP ${r.status}`);
  }

  const data = await r.json();

  if (data.retCode !== 0) {
    throw new Error(
      data.retMsg || "Bybit API error"
    );
  }

  return data.result;
}

/* =========================================================
   CANDLES
========================================================= */

function parseCandles(list) {
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
    .sort((a, b) => a.time - b.time);
}

/* =========================================================
   INDICATORS
========================================================= */

function SMA(values, period) {
  if (values.length < period) return null;

  let sum = 0;

  for (
    let i = values.length - period;
    i < values.length;
    i++
  ) {
    sum += values[i];
  }

  return sum / period;
}

function EMA(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);

  let value = SMA(
    values.slice(0, period),
    period
  );

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

function RSI(values, period = 14) {
  if (values.length < period + 1) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d =
      values[i] -
      values[i - 1];

    if (d >= 0) gain += d;
    else loss -= d;
  }

  gain /= period;
  loss /= period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {
    const d =
      values[i] -
      values[i - 1];

    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);

    gain =
      (gain * (period - 1) + g) /
      period;

    loss =
      (loss * (period - 1) + l) /
      period;
  }

  if (loss === 0) return 100;

  return (
    100 -
    100 /
      (1 + gain / loss)
  );
}

function ATR(data, period = 14) {
  if (data.length < period + 1) return null;

  const tr = [];

  for (let i = 1; i < data.length; i++) {
    const current = data[i];
    const previous = data[i - 1];

    tr.push(
      Math.max(
        current.high - current.low,
        Math.abs(
          current.high -
          previous.close
        ),
        Math.abs(
          current.low -
          previous.close
        )
      )
    );
  }

  return SMA(tr, period);
}

function MACD(values) {
  if (values.length < 35) return null;

  const fast = EMA(values, 12);
  const slow = EMA(values, 26);

  if (
    fast === null ||
    slow === null
  ) {
    return null;
  }

  return fast - slow;
}

function Bollinger(values, period = 20) {
  if (values.length < period) return null;

  const data =
    values.slice(-period);

  const middle =
    SMA(data, period);

  let variance = 0;

  for (const value of data) {
    variance +=
      Math.pow(
        value - middle,
        2
      );
  }

  variance /= period;

  const sd = Math.sqrt(
    variance
  );

  return {
    middle,
    upper:
      middle + sd * 2,
    lower:
      middle - sd * 2
  };
}

function volumeRatio(data, period = 20) {
  if (
    data.length <
    period + 1
  ) {
    return null;
  }

  const current =
    data[data.length - 1]
      .volume;

  const previous =
    data
      .slice(-period - 1, -1)
      .map(x => x.volume);

  const average =
    SMA(previous, period);

  if (!average) return null;

  return current / average;
}

function recentHigh(data, period = 20) {
  return Math.max(
    ...data
      .slice(-period)
      .map(x => x.high)
  );
}

function recentLow(data, period = 20) {
  return Math.min(
    ...data
      .slice(-period)
      .map(x => x.low)
  );
}

/* =========================================================
   STRUCTURE
========================================================= */

function marketStructure(data) {
  if (data.length < 30) {
    return "UNKNOWN";
  }

  const recent =
    data.slice(-20);

  const mid =
    Math.floor(
      recent.length / 2
    );

  const first =
    recent
      .slice(0, mid)
      .reduce(
        (s, x) => s + x.close,
        0
      ) / mid;

  const second =
    recent
      .slice(mid)
      .reduce(
        (s, x) => s + x.close,
        0
      ) /
      (recent.length - mid);

  if (second > first * 1.003)
    return "BULLISH_STRUCTURE";

  if (second < first * 0.997)
    return "BEARISH_STRUCTURE";

  return "RANGE";
}

/* =========================================================
   TIMEFRAME ANALYSIS
========================================================= */

async function analyzeTF(
  symbol,
  category,
  tf
) {
  const result =
    await bybit(
      "/v5/market/kline",
      {
        category,
        symbol,
        interval: TF[tf],
        limit: 200
      }
    );

  const data =
    parseCandles(result.list);

  if (data.length < 60) {
    throw new Error(
      `Insufficient ${tf} data`
    );
  }

  const close =
    data.map(x => x.close);

  const price =
    close[close.length - 1];

  const ma20 =
    SMA(close, 20);

  const ma50 =
    SMA(close, 50);

  const ema20 =
    EMA(close, 20);

  const ema50 =
    EMA(close, 50);

  const rsi =
    RSI(close, 14);

  const macd =
    MACD(close);

  const atr =
    ATR(data, 14);

  const bb =
    Bollinger(close, 20);

  const vr =
    volumeRatio(data, 20);

  const high =
    recentHigh(data, 20);

  const low =
    recentLow(data, 20);

  const structure =
    marketStructure(data);

  let score = 50;

  if (price > ma20) score += 8;
  else score -= 8;

  if (price > ma50) score += 8;
  else score -= 8;

  if (ema20 > ema50) score += 10;
  else score -= 10;

  if (rsi !== null) {
    if (
      rsi >= 55 &&
      rsi < 75
    ) {
      score += 7;
    }

    if (
      rsi <= 45 &&
      rsi > 25
    ) {
      score -= 7;
    }
  }

  if (macd !== null) {
    if (macd > 0) score += 6;
    else score -= 6;
  }

  if (structure === "BULLISH_STRUCTURE")
    score += 6;

  if (structure === "BEARISH_STRUCTURE")
    score -= 6;

  if (vr !== null && vr > 1.5) {
    if (price > ma20) score += 4;
    else score -= 4;
  }

  score = clamp(
    score,
    0,
    100
  );

  let trend = "NEUTRAL";

  if (score >= 65)
    trend = "BULLISH";

  if (score <= 35)
    trend = "BEARISH";

  return {
    tf,
    price,
    ma20,
    ma50,
    ema20,
    ema50,
    rsi,
    macd,
    atr,
    bb,
    volumeRatio: vr,
    high,
    low,
    structure,
    score,
    trend
  };
}

/* =========================================================
   SYMBOL
========================================================= */

async function resolveSymbol(input) {
  let symbol =
    String(input || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  if (!symbol) {
    throw new Error(
      "Symbol is required"
    );
  }

  const aliases = {
    BTC: "BTCUSDT",
    ETH: "ETHUSDT",
    SOL: "SOLUSDT",
    XRP: "XRPUSDT",
    DOGE: "DOGEUSDT",
    PEPE: "PEPEUSDT",
    BNB: "BNBUSDT",
    ADA: "ADAUSDT",
    AVAX: "AVAXUSDT",
    LINK: "LINKUSDT",
    SUI: "SUIUSDT"
  };

  if (aliases[symbol]) {
    return aliases[symbol];
  }

  if (
    symbol.endsWith("USDT") ||
    symbol.endsWith("USDC")
  ) {
    return symbol;
  }

  return symbol + "USDT";
}

/* =========================================================
   CATEGORY
========================================================= */

async function detectCategory(symbol) {
  try {
    const x =
      await bybit(
        "/v5/market/tickers",
        {
          category: "linear",
          symbol
        }
      );

    if (
      x.list &&
      x.list.length
    ) {
      return "linear";
    }
  } catch {}

  try {
    const x =
      await bybit(
        "/v5/market/tickers",
        {
          category: "spot",
          symbol
        }
      );

    if (
      x.list &&
      x.list.length
    ) {
      return "spot";
    }
  } catch {}

  throw new Error(
    `Symbol ${symbol} was not found on Bybit`
  );
}

/* =========================================================
   ORDER BOOK
========================================================= */

async function getOrderBook(
  symbol,
  category
) {
  try {
    const result =
      await bybit(
        "/v5/market/orderbook",
        {
          category,
          symbol,
          limit: 50
        }
      );

    const bids =
      result.b || [];

    const asks =
      result.a || [];

    let buy = 0;
    let sell = 0;

    for (const row of bids) {
      buy +=
        num(row[0]) *
        num(row[1]);
    }

    for (const row of asks) {
      sell +=
        num(row[0]) *
        num(row[1]);
    }

    const total =
      buy + sell;

    const buyShare =
      total
        ? buy / total * 100
        : 50;

    const sellShare =
      total
        ? sell / total * 100
        : 50;

    let pressure =
      "BALANCED";

    if (
      buyShare >
      sellShare + 8
    ) {
      pressure =
        "BUY_PRESSURE";
    }

    if (
      sellShare >
      buyShare + 8
    ) {
      pressure =
        "SELL_PRESSURE";
    }

    return {
      buy,
      sell,
      buyShare,
      sellShare,
      pressure,
      bestBid:
        num(bids[0]?.[0]),
      bestAsk:
        num(asks[0]?.[0])
    };
  } catch {
    return null;
  }
}

/* =========================================================
   RECENT TRADES / FOOTPRINT
========================================================= */

async function getFootprint(
  symbol,
  category
) {
  try {
    const result =
      await bybit(
        "/v5/market/recent-trade",
        {
          category,
          symbol,
          limit: 1000
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

    for (const t of trades) {
      const qty =
        num(t.size);

      const price =
        num(t.price);

      const notional =
        qty * price;

      const side =
        String(t.side || "")
          .toLowerCase();

      if (side === "buy") {
        buyVolume += qty;
        buyNotional += notional;
        buyTrades++;
      }

      if (side === "sell") {
        sellVolume += qty;
        sellNotional += notional;
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
      "BALANCED";

    if (deltaPercent >= 10)
      pressure =
        "BUY_PRESSURE";

    if (deltaPercent <= -10)
      pressure =
        "SELL_PRESSURE";

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
  } catch {
    return null;
  }
}

/* =========================================================
   FUTURES
========================================================= */

async function getFutures(
  symbol
) {
  const result = {
    ticker: null,
    oi: null,
    funding: null,
    ratio: null
  };

  try {
    const x =
      await bybit(
        "/v5/market/tickers",
        {
          category: "linear",
          symbol
        }
      );

    result.ticker =
      x.list?.[0] || null;
  } catch {}

  try {
    const x =
      await bybit(
        "/v5/market/open-interest",
        {
          category: "linear",
          symbol,
          intervalTime: "5min",
          limit: 20
        }
      );

    result.oi =
      x.list?.[0] || null;
  } catch {}

  try {
    const x =
      await bybit(
        "/v5/market/funding/history",
        {
          category: "linear",
          symbol,
          limit: 10
        }
      );

    result.funding =
      x.list?.[0] || null;
  } catch {}

  try {
    const x =
      await bybit(
        "/v5/market/account-ratio",
        {
          category: "linear",
          symbol,
          period: "5min",
          limit: 10
        }
      );

    result.ratio =
      x.list?.[0] || null;
  } catch {}

  return result;
}

/* =========================================================
   DEEP ANALYSIS
========================================================= */

async function deepAnalysis(
  symbol,
  requestedTFs
) {
  const category =
    await detectCategory(symbol);

  const timeframes =
    requestedTFs &&
    requestedTFs.length
      ? requestedTFs
      : [
          "1m",
          "3m",
          "5m",
          "15m",
          "30m",
          "1h",
          "4h",
          "1d"
        ];

  const analyses = [];

  for (const tf of timeframes) {
    if (!TF[tf]) continue;

    try {
      analyses.push(
        await analyzeTF(
          symbol,
          category,
          tf
        )
      );
    } catch {}
  }

  if (!analyses.length) {
    throw new Error(
      "No timeframe data available"
    );
  }

  const orderBook =
    await getOrderBook(
      symbol,
      category
    );

  const footprint =
    await getFootprint(
      symbol,
      category
    );

  const futures =
    category === "linear"
      ? await getFutures(symbol)
      : {
          ticker: null,
          oi: null,
          funding: null,
          ratio: null
        };

  const bullish =
    analyses.filter(
      x => x.trend === "BULLISH"
    ).length;

  const bearish =
    analyses.filter(
      x => x.trend === "BEARISH"
    ).length;

  let bias = "NEUTRAL";

  if (
    bullish >
    bearish + 1
  ) {
    bias = "BULLISH";
  }

  if (
    bearish >
    bullish + 1
  ) {
    bias = "BEARISH";
  }

  let score =
    analyses.reduce(
      (s, x) => s + x.score,
      0
    ) / analyses.length;

  if (
    orderBook?.pressure ===
      "BUY_PRESSURE" &&
    bias === "BULLISH"
  ) {
    score += 5;
  }

  if (
    orderBook?.pressure ===
      "SELL_PRESSURE" &&
    bias === "BEARISH"
  ) {
    score += 5;
  }

  if (
    footprint?.pressure ===
      "BUY_PRESSURE" &&
    bias === "BULLISH"
  ) {
    score += 5;
  }

  if (
    footprint?.pressure ===
      "SELL_PRESSURE" &&
    bias === "BEARISH"
  ) {
    score += 5;
  }

  score =
    Math.round(
      clamp(score, 0, 100)
    );

  const latest =
    analyses[
      analyses.length - 1
    ];

  const support =
    Math.min(
      ...analyses.map(x => x.low)
    );

  const resistance =
    Math.max(
      ...analyses.map(x => x.high)
    );

  const atr =
    latest.atr || 0;

  const price =
    latest.price;

  return {
    symbol,
    category,
    analyses,
    orderBook,
    footprint,
    futures,
    bias,
    confidence: score,
    price,
    support,
    resistance,
    atr,
    longSL:
      support - atr * 0.5,
    longTP1:
      price + atr * 1.5,
    longTP2:
      price + atr * 2.5,
    shortSL:
      resistance + atr * 0.5,
    shortTP1:
      price - atr * 1.5,
    shortTP2:
      price - atr * 2.5
  };
}

/* =========================================================
   CRYPTO MESSAGE
========================================================= */

function cryptoMessage(a) {
  const bias =
    a.bias === "BULLISH"
      ? "🟢 BULLISH"
      : a.bias === "BEARISH"
      ? "🔴 BEARISH"
      : "🟡 NEUTRAL";

  let out = `
₿ <b>GLOBAL PULSE — DEEP CRYPTO INTELLIGENCE</b>

🪙 <b>${esc(a.symbol)}</b>
📊 Market: <b>${esc(a.category.toUpperCase())}</b>

━━━━━━━━━━━━━━━━

🎯 <b>GLOBAL BIAS</b>

${bias}

Confidence:
<b>${a.confidence}%</b>

Current Price:
<b>${fmt(a.price, 8)}</b>

━━━━━━━━━━━━━━━━

📈 <b>MULTI-TIMEFRAME ANALYSIS</b>

`;

  for (const x of a.analyses) {
    out +=
      `<b>${x.tf}</b> → ` +
      `${x.trend} | ${Math.round(x.score)}/100\n` +
      `RSI: ${fmt(x.rsi, 2)}\n` +
      `MA20: ${fmt(x.ma20, 8)}\n` +
      `MA50: ${fmt(x.ma50, 8)}\n` +
      `EMA20/50: ${fmt(x.ema20, 8)} / ${fmt(x.ema50, 8)}\n` +
      `MACD: ${fmt(x.macd, 8)}\n` +
      `ATR: ${fmt(x.atr, 8)}\n` +
      `Volume: ${
        x.volumeRatio
          ? fmt(x.volumeRatio, 2) + "x"
          : "N/A"
      }\n` +
      `Structure: ${x.structure}\n\n`;
  }

  out += `
━━━━━━━━━━━━━━━━

🧱 <b>KEY LEVELS</b>

Support:
<b>${fmt(a.support, 8)}</b>

Resistance:
<b>${fmt(a.resistance, 8)}</b>

`;

  if (a.orderBook) {
    out += `
📚 <b>ORDER BOOK</b>

Buy Liquidity:
${fmt(a.orderBook.buy)}

Sell Liquidity:
${fmt(a.orderBook.sell)}

Buy Share:
${a.orderBook.buyShare.toFixed(1)}%

Sell Share:
${a.orderBook.sellShare.toFixed(1)}%

Pressure:
<b>${a.orderBook.pressure}</b>

`;
  }

  if (a.footprint) {
    out += `
👣 <b>FOOTPRINT / RECENT TRADES</b>

Buy Volume:
${fmt(a.footprint.buyVolume)}

Sell Volume:
${fmt(a.footprint.sellVolume)}

Buy Notional:
${fmt(a.footprint.buyNotional)}

Sell Notional:
${fmt(a.footprint.sellNotional)}

Delta:
${fmt(a.footprint.delta)}

Delta %:
${percent(a.footprint.deltaPercent)}

Pressure:
<b>${a.footprint.pressure}</b>

`;
  }

  if (a.futures.ticker) {
    const t =
      a.futures.ticker;

    out += `
⚡ <b>FUTURES INTELLIGENCE</b>

24h Change:
${percent(
  num(t.price24hPcnt) * 100
)}

24h Volume:
${fmt(
  num(t.volume24h)
)}

Open Interest:
${
  a.futures.oi
    ? fmt(
        num(
          a.futures.oi.openInterest
        )
      )
    : "N/A"
}

Funding:
${
  a.futures.funding
    ? percent(
        num(
          a.futures.funding.fundingRate
        ) * 100
      )
    : "N/A"
}

Long/Short:
${
  a.futures.ratio
    ? `${fmt(
        num(
          a.futures.ratio
            .buyRatio
        ),
        3
      )} / ${fmt(
        num(
          a.futures.ratio
            .sellRatio
        ),
        3
      )}`
    : "N/A"
}

`;
  }

  out += `
━━━━━━━━━━━━━━━━

🎯 <b>LONG SCENARIO</b>

Entry:
${fmt(a.price, 8)}

Stop:
${fmt(a.longSL, 8)}

TP1:
${fmt(a.longTP1, 8)}

TP2:
${fmt(a.longTP2, 8)}

━━━━━━━━━━━━━━━━

🎯 <b>SHORT SCENARIO</b>

Entry:
${fmt(a.price, 8)}

Stop:
${fmt(a.shortSL, 8)}

TP1:
${fmt(a.shortTP1, 8)}

TP2:
${fmt(a.shortTP2, 8)}

━━━━━━━━━━━━━━━━

⚠️ Technical analysis only.
Crypto markets can move rapidly.

🌐 <b>GLOBAL PULSE</b>
`;

  return out;
}

/* =========================================================
   COMMANDS
========================================================= */

function parseAnalyze(command) {
  const parts =
    command
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  parts.shift();

  const symbol =
    parts.shift();

  const tfs =
    parts
      .map(x => x.toLowerCase())
      .filter(x => TF[x]);

  return {
    symbol,
    tfs
  };
}

async function handleTelegram(
  env,
  update
) {
  const message =
    update.message ||
    update.edited_message;

  if (!message?.text) return;

  const chatId =
    message.chat.id;

  const input =
    message.text.trim();

  const lower =
    input.toLowerCase();

  if (lower === "/start") {
    await sendTelegram(
      env,
      chatId,
`
🌍 <b>GLOBAL PULSE</b>

International intelligence platform.

📰 World News
🔥 Country Trends
🛒 Shopping Radar
₿ Deep Crypto Analysis

<b>Commands</b>

/news
/trend
/shopping

/analyze BTCUSDT

/analyze BTCUSDT 15m

/analyze BTCUSDT 1m 5m 15m 1h 4h 1d

/help
`
    );

    return;
  }

  if (lower === "/help") {
    await sendTelegram(
      env,
      chatId,
`
<b>GLOBAL PULSE COMMANDS</b>

/news
🌍 International news

/trend
🔥 Country trend radar

/shopping
🛒 Global shopping radar

/analyze BTCUSDT
₿ Full multi-timeframe crypto analysis

/analyze BTCUSDT 15m
₿ One timeframe

/analyze BTCUSDT 1m 5m 15m 1h 4h 1d
₿ Multiple timeframes
`
    );

    return;
  }

  if (lower === "/news") {
    await sendTelegram(
      env,
      chatId,
      await buildNews()
    );

    return;
  }

  if (lower === "/trend") {
    await sendTelegram(
      env,
      chatId,
      await buildTrend()
    );

    return;
  }

  if (lower === "/shopping") {
    await sendTelegram(
      env,
      chatId,
      await buildShopping()
    );

    return;
  }

  if (
    lower.startsWith("/analyze")
  ) {
    const parsed =
      parseAnalyze(input);

    if (!parsed.symbol) {
      await sendTelegram(
        env,
        chatId,
`
❌ Symbol required.

Example:

/analyze BTCUSDT

/analyze BTCUSDT 15m
`
      );

      return;
    }

    try {
      const symbol =
        await resolveSymbol(
          parsed.symbol
        );

      const tfs =
        parsed.tfs.length
          ? parsed.tfs
          : null;

      await sendTelegram(
        env,
        chatId,
`
⏳ <b>DEEP ANALYSIS</b>

🪙 ${esc(symbol)}

📊 ${
  tfs
    ? tfs.join(", ")
    : "1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d"
}

Collecting live Bybit market data...
`
      );

      const result =
        await deepAnalysis(
          symbol,
          tfs
        );

      await sendTelegram(
        env,
        chatId,
        cryptoMessage(result)
      );
    } catch (e) {
      await sendTelegram(
        env,
        chatId,
`
❌ <b>ANALYSIS ERROR</b>

${esc(
  e.message ||
  "Unknown error"
)}

Example:

/analyze BTCUSDT 15m
`
      );
    }

    return;
  }
}

/* =========================================================
   AUTOMATIC CHANNEL
========================================================= */

async function scheduledPublish(env) {
  const hour =
    new Date().getUTCHours();

  if (hour % 6 === 0) {
    await sendChannel(
      env,
      await buildNews()
    );

    return;
  }

  if (hour % 6 === 2) {
    await sendChannel(
      env,
      await buildTrend()
    );

    return;
  }

  if (hour % 6 === 4) {
    await sendChannel(
      env,
      await buildShopping()
    );

    return;
  }

  if (hour % 6 === 5) {
    const coins = [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT"
    ];

    const coin =
      coins[
        Math.floor(
          Date.now() / 3600000
        ) % coins.length
      ];

    try {
      const result =
        await deepAnalysis(
          coin,
          [
            "15m",
            "1h",
            "4h",
            "1d"
          ]
        );

      await sendChannel(
        env,
        cryptoMessage(result)
      );
    } catch {}
  }
}

/* =========================================================
   FETCH
========================================================= */

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    try {
      if (
        url.pathname === "/"
      ) {
        return json({
          ok: true,
          project: "Global Pulse",
          version: VERSION,
          status: "ONLINE"
        });
      }

      if (
        url.pathname === "/health"
      ) {
        return json({
          ok: true,
          project: "Global Pulse",
          version: VERSION,
          telegram:
            Boolean(
              env.TELEGRAM_BOT_TOKEN
            ),
          channel:
            Boolean(
              env.TELEGRAM_CHANNEL_ID
            ),
          bybit: true,
          time:
            new Date().toISOString()
        });
      }

      if (
        url.pathname ===
        "/setup-webhook"
      ) {
        const webhook =
          `${url.origin}/telegram/webhook`;

        const result =
          await telegram(
            env,
            "setWebhook",
            {
              url: webhook,
              allowed_updates: [
                "message"
              ]
            }
          );

        return json({
          ok: true,
          webhook,
          telegram: result
        });
      }

      if (
        url.pathname ===
        "/test-channel"
      ) {
        const result =
          await sendChannel(
            env,
`
🌍 <b>GLOBAL PULSE</b>

✅ Channel connection is working.

📡 World News
🔥 Country Trends
🛒 Shopping Radar
₿ Crypto Intelligence

<b>${VERSION}</b>
`
          );

        return json({
          ok: true,
          message_id:
            result.result?.message_id,
          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }

      if (
        url.pathname ===
        "/test-news"
      ) {
        await sendChannel(
          env,
          await buildNews()
        );

        return json({
          ok: true,
          type: "news"
        });
      }

      if (
        url.pathname ===
        "/test-trend"
      ) {
        await sendChannel(
          env,
          await buildTrend()
        );

        return json({
          ok: true,
          type: "trend"
        });
      }

      if (
        url.pathname ===
        "/test-shopping"
      ) {
        await sendChannel(
          env,
          await buildShopping()
        );

        return json({
          ok: true,
          type: "shopping"
        });
      }

      if (
        url.pathname ===
        "/analyze"
      ) {
        const raw =
          url.searchParams.get(
            "symbol"
          );

        const tf =
          url.searchParams.get(
            "tf"
          );

        if (!raw) {
          return json(
            {
              ok: false,
              error:
                "symbol is required"
            },
            400
          );
        }

        const symbol =
          await resolveSymbol(
            raw
          );

        const tfs =
          tf
            ? tf
                .split(",")
                .map(x =>
                  x.trim().toLowerCase()
                )
                .filter(x => TF[x])
            : null;

        const result =
          await deepAnalysis(
            symbol,
            tfs
          );

        return json({
          ok: true,
          version: VERSION,
          data: result
        });
      }

      if (
        url.pathname ===
        "/telegram/webhook" &&
        request.method === "POST"
      ) {
        const update =
          await request.json();

        await handleTelegram(
          env,
          update
        );

        return json({
          ok: true
        });
      }

      return json(
        {
          ok: false,
          error: "Not Found",
          path: url.pathname
        },
        404
      );
    } catch (e) {
      return json(
        {
          ok: false,
          version: VERSION,
          error:
            e.message ||
            "Internal Server Error"
        },
        500
      );
    }
  },

  async scheduled(
    event,
    env,
    ctx
  ) {
    ctx.waitUntil(
      scheduledPublish(env)
    );
  }
};
