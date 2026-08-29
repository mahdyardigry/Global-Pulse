/* =========================================================
   GLOBAL PULSE
   International Telegram Intelligence Channel
   Cloudflare Worker
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V1";

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

const COUNTRY_QUERIES = [
  ["United States", "US"],
  ["United Kingdom", "UK"],
  ["Germany", "DE"],
  ["France", "FR"],
  ["Italy", "IT"],
  ["Spain", "ES"],
  ["Turkey", "TR"],
  ["UAE", "AE"],
  ["Saudi Arabia", "SA"],
  ["Japan", "JP"],
  ["South Korea", "KR"],
  ["India", "IN"],
  ["Singapore", "SG"],
  ["Australia", "AU"],
  ["Canada", "CA"],
  ["Brazil", "BR"],
  ["Mexico", "MX"]
];

const NEWS_QUERIES = [
  "world news",
  "global economy",
  "technology",
  "artificial intelligence",
  "business markets",
  "travel",
  "shopping deals",
  "consumer trends",
  "cryptocurrency"
];

const IRAN_WORDS = [
  "iran",
  "iranian",
  "tehran",
  "ایران",
  "تهران"
];

/* =========================================================
   BASIC HELPERS
   ========================================================= */

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return "N/A";
  if (Math.abs(n) >= 1000000) {
    return (n / 1000000).toFixed(2) + "M";
  }
  if (Math.abs(n) >= 1000) {
    return (n / 1000).toFixed(2) + "K";
  }
  return n.toFixed(digits);
}

function pct(n) {
  if (!Number.isFinite(n)) return "N/A";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function escapeTelegram(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function containsIran(s) {
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
      `Telegram ${method}: ${data.description || "unknown error"}`
    );
  }

  return data;
}

async function sendTelegram(env, chatId, message) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: false
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
   RSS / GLOBAL NEWS
   ========================================================= */

function googleNewsRSS(query, hl = "en-US", gl = "US", ceid = "US:en") {
  return (
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    `&hl=${hl}&gl=${gl}&ceid=${ceid}`
  );
}

async function fetchRSS(url) {
  const r = await fetch(url, {
    headers: {
      "user-agent": "GlobalPulse/1.0"
    }
  });

  if (!r.ok) {
    throw new Error(`RSS HTTP ${r.status}`);
  }

  return await r.text();
}

function parseRSS(xml, limit = 10) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;

  let m;

  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];

    const title =
      cleanText(
        (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]
      );

    const link =
      cleanText(
        (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]
      );

    const pubDate =
      cleanText(
        (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1]
      );

    if (!title || containsIran(title)) continue;

    items.push({
      title,
      link,
      pubDate
    });
  }

  return items;
}

async function getNews(query, limit = 6) {
  try {
    const xml = await fetchRSS(
      googleNewsRSS(query)
    );

    return parseRSS(xml, limit);
  } catch {
    return [];
  }
}

async function buildGlobalNews() {
  const all = [];

  for (const q of NEWS_QUERIES.slice(0, 5)) {
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

    if (all.length >= 8) break;
  }

  if (!all.length) {
    return `
🌍 <b>GLOBAL PULSE</b>

No major international headlines were available right now.

We will refresh the global radar automatically.
`;
  }

  let out = `
🌍 <b>GLOBAL PULSE — WORLD RADAR</b>

📰 <b>Top international headlines</b>

`;

  all.slice(0, 8).forEach((x, i) => {
    out +=
      `${i + 1}. <b>${escapeTelegram(x.title)}</b>\n` +
      (x.link ? `🔗 ${escapeTelegram(x.link)}\n\n` : "\n");
  });

  out += `
━━━━━━━━━━━━━━
🌐 Global Pulse
📡 International intelligence
`;

  return out;
}

/* =========================================================
   COUNTRY TRENDS
   ========================================================= */

async function countryTrend(country, code) {
  const query =
    `"${country}" trending OR popular OR shopping OR searches`;

  const items = await getNews(query, 5);

  let out =
    `🌍 <b>${escapeTelegram(country)}</b>\n\n`;

  if (!items.length) {
    return out +
      "No reliable trend headlines available right now.\n";
  }

  items.slice(0, 4).forEach((x, i) => {
    out +=
      `${i + 1}. ${escapeTelegram(x.title)}\n` +
      `🔗 ${escapeTelegram(x.link)}\n\n`;
  });

  return out;
}

async function buildCountryRadar() {
  const selected =
    COUNTRY_QUERIES[
      Math.floor(Date.now() / 3600000) %
      COUNTRY_QUERIES.length
    ];

  const [country, code] = selected;

  return `
🔥 <b>COUNTRY TREND RADAR</b>

${await countryTrend(country, code)}

━━━━━━━━━━━━━━
📊 This section tracks international interest,
consumer topics, shopping and local trends.

🌐 Global Pulse
`;
}

/* =========================================================
   SHOPPING / PRICE RADAR
   ========================================================= */

async function buildShoppingRadar() {
  const queries = [
    "best deals electronics today",
    "cheap travel destinations",
    "best shopping deals Europe",
    "best shopping deals USA",
    "popular products this week"
  ];

  const all = [];

  for (const q of queries) {
    const items = await getNews(q, 2);

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

🔥 <b>What people are watching</b>

`;

  if (!all.length) {
    out += "No shopping data available right now.\n";
  } else {
    all.slice(0, 8).forEach((x, i) => {
      out +=
        `${i + 1}. <b>${escapeTelegram(x.title)}</b>\n` +
        `🔗 ${escapeTelegram(x.link)}\n\n`;
    });
  }

  out += `
━━━━━━━━━━━━━━
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

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, v);
    }
  }

  const r = await fetch(url.toString(), {
    headers: {
      "user-agent": "GlobalPulse-Bybit/1.0"
    }
  });

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

function candles(raw) {
  return (raw || [])
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

function sma(values, period) {
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

function ema(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);

  let e = sma(values.slice(0, period), period);

  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
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

  gain /= period;
  loss /= period;

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];

    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);

    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
  }

  if (loss === 0) return 100;

  return 100 - 100 / (1 + gain / loss);
}

function macd(values) {
  if (values.length < 35) return null;

  const fast = ema(values, 12);
  const slow = ema(values, 26);

  if (fast === null || slow === null) return null;

  const macdLine = fast - slow;

  return {
    value: macdLine
  };
}

function atr(data, period = 14) {
  if (data.length < period + 1) return null;

  const tr = [];

  for (let i = 1; i < data.length; i++) {
    const c = data[i];

    const prev = data[i - 1].close;

    tr.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev),
        Math.abs(c.low - prev)
      )
    );
  }

  return sma(tr, period);
}

function bollinger(data, period = 20) {
  if (data.length < period) return null;

  const values = data
    .slice(-period)
    .map(x => x.close);

  const mean = sma(values, period);

  let variance = 0;

  for (const v of values) {
    variance += Math.pow(v - mean, 2);
  }

  variance /= period;

  const sd = Math.sqrt(variance);

  return {
    mid: mean,
    upper: mean + sd * 2,
    lower: mean - sd * 2
  };
}

function highest(data, period = 20) {
  return Math.max(
    ...data.slice(-period).map(x => x.high)
  );
}

function lowest(data, period = 20) {
  return Math.min(
    ...data.slice(-period).map(x => x.low)
  );
}

function volumeRatio(data, period = 20) {
  if (data.length < period + 1) return null;

  const current =
    data[data.length - 1].volume;

  const avg =
    sma(
      data.slice(0, -1).map(x => x.volume),
      period
    );

  if (!avg) return null;

  return current / avg;
}

/* =========================================================
   TIMEFRAME ANALYSIS
   ========================================================= */

async function analyzeTimeframe(symbol, category, interval) {
  const result = await bybit(
    "/v5/market/kline",
    {
      category,
      symbol,
      interval,
      limit: 200
    }
  );

  const data = candles(result.list);

  if (data.length < 60) {
    throw new Error(
      `Insufficient candle data ${interval}`
    );
  }

  const closes = data.map(x => x.close);

  const price =
    closes[closes.length - 1];

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);

  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = atr(data, 14);
  const bb = bollinger(data, 20);

  const high20 = highest(data, 20);
  const low20 = lowest(data, 20);

  const vr = volumeRatio(data, 20);

  let score = 50;

  if (price > ma20) score += 8;
  else score -= 8;

  if (price > ma50) score += 8;
  else score -= 8;

  if (ema20 > ema50) score += 10;
  else score -= 10;

  if (r >= 55 && r < 75) score += 7;
  if (r <= 45 && r > 25) score -= 7;

  if (m?.value > 0) score += 6;
  if (m?.value < 0) score -= 6;

  if (vr > 1.5) {
    score += price > ma20 ? 5 : -5;
  }

  score = clamp(score, 0, 100);

  let trend = "NEUTRAL";

  if (score >= 65) trend = "BULLISH";
  if (score <= 35) trend = "BEARISH";

  return {
    interval,
    price,
    ma20,
    ma50,
    ema20,
    ema50,
    rsi: r,
    macd: m?.value,
    atr: a,
    bb,
    high20,
    low20,
    volumeRatio: vr,
    score,
    trend
  };
}

/* =========================================================
   FUTURES DATA
   ========================================================= */

async function futuresData(symbol) {
  const result = {};

  try {
    const ticker =
      await bybit("/v5/market/tickers", {
        category: "linear",
        symbol
      });

    result.ticker =
      ticker.list?.[0] || null;
  } catch {}

  try {
    const oi =
      await bybit("/v5/market/open-interest", {
        category: "linear",
        symbol,
        intervalTime: "5min",
        limit: 20
      });

    result.oi =
      oi.list?.[0] || null;
  } catch {}

  try {
    const funding =
      await bybit("/v5/market/funding/history", {
        category: "linear",
        symbol,
        limit: 10
      });

    result.funding =
      funding.list?.[0] || null;
  } catch {}

  try {
    const ratio =
      await bybit("/v5/market/account-ratio", {
        category: "linear",
        symbol,
        period: "5min",
        limit: 10
      });

    result.ratio =
      ratio.list?.[0] || null;
  } catch {}

  return result;
}

/* =========================================================
   ORDER BOOK
   ========================================================= */

async function orderBook(symbol, category) {
  try {
    const result =
      await bybit("/v5/market/orderbook", {
        category,
        symbol,
        limit: 50
      });

    const bids = result.b || [];
    const asks = result.a || [];

    let buy = 0;
    let sell = 0;

    for (const x of bids) {
      buy += num(x[0]) * num(x[1]);
    }

    for (const x of asks) {
      sell += num(x[0]) * num(x[1]);
    }

    const total = buy + sell;

    return {
      buy,
      sell,
      buyShare:
        total ? buy / total * 100 : 50,
      sellShare:
        total ? sell / total * 100 : 50,
      bestBid: num(bids[0]?.[0]),
      bestAsk: num(asks[0]?.[0])
    };
  } catch {
    return null;
  }
}

/* =========================================================
   SYMBOL RESOLUTION
   ========================================================= */

async function resolveSymbol(input) {
  let symbol =
    String(input || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  if (!symbol) {
    throw new Error("Symbol required");
  }

  if (
    symbol.endsWith("USDT") ||
    symbol.endsWith("USDC")
  ) {
    return symbol;
  }

  if (symbol === "BTC") return "BTCUSDT";
  if (symbol === "ETH") return "ETHUSDT";
  if (symbol === "SOL") return "SOLUSDT";
  if (symbol === "XRP") return "XRPUSDT";
  if (symbol === "DOGE") return "DOGEUSDT";
  if (symbol === "PEPE") return "PEPEUSDT";

  return symbol + "USDT";
}

/* =========================================================
   DEEP CRYPTO ANALYSIS
   ========================================================= */

async function deepCrypto(symbol, requestedTFs = null) {
  const categories = [
    "linear",
    "spot"
  ];

  let category = "linear";

  try {
    await bybit(
      "/v5/market/tickers",
      {
        category: "linear",
        symbol
      }
    );
  } catch {
    category = "spot";
  }

  const tfs =
    requestedTFs?.length
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

  for (const tf of tfs) {
    if (!TF[tf]) continue;

    try {
      const a =
        await analyzeTimeframe(
          symbol,
          category,
          TF[tf]
        );

      analyses.push(a);
    } catch {}
  }

  if (!analyses.length) {
    throw new Error(
      "No market data for this symbol"
    );
  }

  const book =
    await orderBook(
      symbol,
      category
    );

  const futures =
    await futuresData(symbol);

  const latest =
    analyses[analyses.length - 1];

  const bullish =
    analyses.filter(
      x => x.trend === "BULLISH"
    ).length;

  const bearish =
    analyses.filter(
      x => x.trend === "BEARISH"
    ).length;

  let globalBias = "NEUTRAL";

  if (bullish > bearish + 1) {
    globalBias = "BULLISH";
  }

  if (bearish > bullish + 1) {
    globalBias = "BEARISH";
  }

  const avgScore =
    analyses.reduce(
      (s, x) => s + x.score,
      0
    ) / analyses.length;

  let confidence =
    Math.round(avgScore);

  if (
    globalBias === "BULLISH" &&
    book?.buyShare > book?.sellShare + 8
  ) {
    confidence += 5;
  }

  if (
    globalBias === "BEARISH" &&
    book?.sellShare > book?.buyShare + 8
  ) {
    confidence += 5;
  }

  confidence = clamp(
    confidence,
    0,
    100
  );

  const resistance =
    latest.high20;

  const support =
    latest.low20;

  const atrValue =
    latest.atr || 0;

  let longEntry = latest.price;
  let shortEntry = latest.price;

  let longSL =
    support - atrValue * 0.5;

  let shortSL =
    resistance + atrValue * 0.5;

  let longTP1 =
    latest.price + atrValue * 1.5;

  let longTP2 =
    latest.price + atrValue * 2.5;

  let shortTP1 =
    latest.price - atrValue * 1.5;

  let shortTP2 =
    latest.price - atrValue * 2.5;

  return {
    symbol,
    category,
    analyses,
    book,
    futures,
    latest,
    globalBias,
    confidence,
    support,
    resistance,
    longEntry,
    shortEntry,
    longSL,
    shortSL,
    longTP1,
    longTP2,
    shortTP1,
    shortTP2
  };
}

/* =========================================================
   CRYPTO MESSAGE
   ========================================================= */

function cryptoMessage(a) {
  let out = `
₿ <b>GLOBAL PULSE — DEEP CRYPTO ANALYSIS</b>

🪙 <b>${escapeTelegram(a.symbol)}</b>
📊 Market: <b>${a.category.toUpperCase()}</b>

━━━━━━━━━━━━━━━━━━

🎯 <b>GLOBAL MARKET BIAS</b>

${a.globalBias === "BULLISH" ? "🟢 BULLISH" :
  a.globalBias === "BEARISH" ? "🔴 BEARISH" :
  "🟡 NEUTRAL"}

Confidence: <b>${a.confidence}%</b>

💰 Current Price:
<b>${fmt(a.latest.price, 8)}</b>

━━━━━━━━━━━━━━━━━━

📈 <b>TIMEFRAME ANALYSIS</b>

`;

  for (const x of a.analyses) {
    out +=
      `<b>${x.interval}</b> → ` +
      `${x.trend} | Score ${Math.round(x.score)}\n` +
      `RSI: ${fmt(x.rsi, 1)} | ` +
      `MA20: ${fmt(x.ma20, 6)}\n` +
      `MA50: ${fmt(x.ma50, 6)} | ` +
      `Vol: ${x.volumeRatio ? fmt(x.volumeRatio, 2) + "x" : "N/A"}\n\n`;
  }

  out += `
━━━━━━━━━━━━━━━━━━

🧱 <b>KEY LEVELS</b>

Support:
<b>${fmt(a.support, 8)}</b>

Resistance:
<b>${fmt(a.resistance, 8)}</b>
`;

  if (a.book) {
    let pressure = "BALANCED";

    if (
      a.book.buyShare >
      a.book.sellShare + 8
    ) {
      pressure = "BUY PRESSURE";
    }

    if (
      a.book.sellShare >
      a.book.buyShare + 8
    ) {
      pressure = "SELL PRESSURE";
    }

    out += `
📚 <b>ORDER BOOK</b>

Buy Liquidity:
${fmt(a.book.buy)}

Sell Liquidity:
${fmt(a.book.sell)}

Buy Share:
${a.book.buyShare.toFixed(1)}%

Sell Share:
${a.book.sellShare.toFixed(1)}%

Pressure:
<b>${pressure}</b>
`;
  }

  if (a.futures.ticker) {
    const t =
      a.futures.ticker;

    out += `
━━━━━━━━━━━━━━━━━━

⚡ <b>FUTURES DATA</b>

24h Change:
${pct(num(t.price24hPcnt) * 100)}

24h Volume:
${fmt(num(t.volume24h))}

Open Interest:
${
  a.futures.oi
    ? fmt(num(a.futures.oi.openInterest))
    : "N/A"
}

Funding:
${
  a.futures.funding
    ? pct(
        num(
          a.futures.funding.fundingRate
        ) * 100
      )
    : "N/A"
}
`;
  }

  out += `
━━━━━━━━━━━━━━━━━━

🎯 <b>SCENARIOS</b>

🟢 <b>LONG SCENARIO</b>

Entry:
${fmt(a.longEntry, 8)}

Stop:
${fmt(a.longSL, 8)}

TP1:
${fmt(a.longTP1, 8)}

TP2:
${fmt(a.longTP2, 8)}

🔴 <b>SHORT SCENARIO</b>

Entry:
${fmt(a.shortEntry, 8)}

Stop:
${fmt(a.shortSL, 8)}

TP1:
${fmt(a.shortTP1, 8)}

TP2:
${fmt(a.shortTP2, 8)}

━━━━━━━━━━━━━━━━━━

⚠️ <b>Risk Notice</b>

This is market analysis, not financial advice.
Crypto markets can move rapidly and invalidate technical levels.

🌐 <b>Global Pulse</b>
`;

  return out;
}

/* =========================================================
   COMMAND PARSER
   ========================================================= */

function parseAnalyze(text) {
  const parts =
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  parts.shift();

  const symbol =
    parts.shift();

  if (!symbol) {
    return {
      error:
        "Usage:\n/analyze BTCUSDT\n/analyze BTCUSDT 15m\n/analyze BTCUSDT 1m 5m 15m 1h 4h"
    };
  }

  const tfs =
    parts
      .map(x =>
        x.toLowerCase()
      )
      .filter(x => TF[x]);

  return {
    symbol,
    tfs
  };
}

/* =========================================================
   BOT COMMANDS
   ========================================================= */

async function handleTelegramUpdate(
  env,
  update
) {
  const msg =
    update.message ||
    update.edited_message;

  if (!msg?.text) return;

  const chatId =
    msg.chat.id;

  const input =
    msg.text.trim();

  if (input === "/start") {
    await sendTelegram(
      env,
      chatId,
`
🌍 <b>GLOBAL PULSE</b>

International news, trends, shopping intelligence and deep crypto analysis.

<b>Commands</b>

/news
/trend
/shopping

/analyze BTCUSDT
/analyze BTCUSDT 15m
/analyze BTCUSDT 1m 5m 15m 1h 4h

/help
`
    );

    return;
  }

  if (input === "/help") {
    await sendTelegram(
      env,
      chatId,
`
<b>GLOBAL PULSE BOT</b>

🌍 /news
🔥 /trend
🛒 /shopping

₿ <b>Crypto</b>

/analyze BTCUSDT

or:

/analyze ETHUSDT 1m 5m 15m 1h 4h 1d

The requested timeframes are analyzed independently.
`
    );

    return;
  }

  if (input === "/news") {
    await sendTelegram(
      env,
      chatId,
      await buildGlobalNews()
    );

    return;
  }

  if (input === "/trend") {
    await sendTelegram(
      env,
      chatId,
      await buildCountryRadar()
    );

    return;
  }

  if (input === "/shopping") {
    await sendTelegram(
      env,
      chatId,
      await buildShoppingRadar()
    );

    return;
  }

  if (
    input.toLowerCase()
      .startsWith("/analyze")
  ) {
    const p =
      parseAnalyze(input);

    if (p.error) {
      await sendTelegram(
        env,
        chatId,
        p.error
      );
      return;
    }

    try {
      const symbol =
        await resolveSymbol(
          p.symbol
        );

      await sendTelegram(
        env,
        chatId,
`
⏳ <b>Deep analysis started</b>

🪙 ${escapeTelegram(symbol)}

📊 Timeframes:
${
  p.tfs.length
    ? p.tfs.join(", ")
    : "1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d"
}

Please wait...
`
      );

      const analysis =
        await deepCrypto(
          symbol,
          p.tfs
        );

      await sendTelegram(
        env,
        chatId,
        cryptoMessage(
          analysis
        )
      );
    } catch (e) {
      await sendTelegram(
        env,
        chatId,
`
❌ <b>Analysis Error</b>

${escapeTelegram(
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

  /*
     Direct symbol:
     BTC
     BTCUSDT
     ETHUSDT 15m
  */

  if (
    /^[A-Za-z0-9]+(?:USDT|USDC)?(?:\s+[0-9mhdw]+)*$/i
      .test(input)
  ) {
    const parts =
      input.split(/\s+/);

    try {
      const symbol =
        await resolveSymbol(
          parts[0]
        );

      const tfs =
        parts
          .slice(1)
          .map(x =>
            x.toLowerCase()
          )
          .filter(x => TF[x]);

      const analysis =
        await deepCrypto(
          symbol,
          tfs.length
            ? tfs
            : null
        );

      await sendTelegram(
        env,
        chatId,
        cryptoMessage(
          analysis
        )
      );
    } catch {
      await sendTelegram(
        env,
        chatId,
`
❌ Symbol not found.

Example:

BTCUSDT

or:

BTCUSDT 15m
`
      );
    }
  }
}

/* =========================================================
   AUTOMATIC CHANNEL CONTENT
   ========================================================= */

async function scheduledPublish(
  env
) {
  const hour =
    new Date().getUTCHours();

  /*
     4 automatic content windows
  */

  if (hour % 6 === 0) {
    await sendChannel(
      env,
      await buildGlobalNews()
    );
    return;
  }

  if (hour % 6 === 2) {
    await sendChannel(
      env,
      await buildCountryRadar()
    );
    return;
  }

  if (hour % 6 === 4) {
    await sendChannel(
      env,
      await buildShoppingRadar()
    );
    return;
  }

  /*
     Crypto market report
  */

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
      const analysis =
        await deepCrypto(
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
        cryptoMessage(
          analysis
        )
      );
    } catch {}
  }
}

/* =========================================================
   WEBHOOK
   ========================================================= */

async function setupWebhook(
  request,
  env
) {
  const url =
    new URL(request.url);

  const webhookUrl =
    `${url.origin}/telegram/webhook`;

  const result =
    await telegram(
      env,
      "setWebhook",
      {
        url: webhookUrl,
        allowed_updates: [
          "message"
        ]
      }
    );

  return json({
    ok: true,
    webhookUrl,
    telegram: result
  });
}

/* =========================================================
   HEALTH
   ========================================================= */

async function health(env) {
  return json({
    ok: true,
    project: "Global Pulse",
    version: VERSION,
    time: new Date().toISOString(),
    telegram:
      Boolean(
        env.TELEGRAM_BOT_TOKEN
      ),
    channel:
      Boolean(
        env.TELEGRAM_CHANNEL_ID
      ),
    bybit: true
  });
}

/* =========================================================
   MAIN FETCH
   ========================================================= */

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    try {
      if (
        url.pathname ===
        "/"
      ) {
        return text(
          "GLOBAL PULSE ONLINE"
        );
      }

      if (
        url.pathname ===
        "/health"
      ) {
        return health(env);
      }

      if (
        url.pathname ===
        "/setup-webhook"
      ) {
        return setupWebhook(
          request,
          env
        );
      }

      if (
        url.pathname ===
        "/test-channel"
      ) {
        await sendChannel(
          env,
`
🌍 <b>GLOBAL PULSE</b>

✅ Telegram channel connection is working.

📡 News
🔥 Trends
🛒 Shopping
₿ Crypto Intelligence

System:
<b>${VERSION}</b>
`
        );

        return json({
          ok: true,
          message:
            "Channel test sent"
        });
      }

      if (
        url.pathname ===
        "/test-news"
      ) {
        const news =
          await buildGlobalNews();

        await sendChannel(
          env,
          news
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
        const trend =
          await buildCountryRadar();

        await sendChannel(
          env,
          trend
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
        const shopping =
          await buildShoppingRadar();

        await sendChannel(
          env,
          shopping
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
        const symbol =
          url.searchParams.get(
            "symbol"
          );

        const timeframe =
          url.searchParams.get(
            "tf"
          );

        if (!symbol) {
          return json(
            {
              ok: false,
              error:
                "Use /analyze?symbol=BTCUSDT&tf=15m"
            },
            400
          );
        }

        const resolved =
          await resolveSymbol(
            symbol
          );

        const tfs =
          timeframe
            ? timeframe
                .split(",")
                .map(x =>
                  x.trim()
                    .toLowerCase()
                )
                .filter(x => TF[x])
            : null;

        const result =
          await deepCrypto(
            resolved,
            tfs
          );

        return json(
          result
        );
      }

      if (
        url.pathname ===
        "/telegram/webhook" &&
        request.method ===
          "POST"
      ) {
        const update =
          await request.json();

        await handleTelegramUpdate(
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
          error: "Not Found"
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
            "Internal error"
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
