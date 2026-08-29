/* =========================================================
   GLOBAL PULSE
   Global News + Country Trends + Shopping Radar
   + Deep Crypto Analyzer / Bybit
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V3";
const BYBIT = "https://api.bybit.com";

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

const TF_LIST = [
  "1",
  "3",
  "5",
  "15",
  "30",
  "60",
  "240",
  "D"
];

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store"
      }
    }
  );
}

function text(data, status = 200) {

  return new Response(
    data,
    {
      status,
      headers: {
        "content-type": "text/plain; charset=UTF-8"
      }
    }
  );
}


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function cleanSymbol(symbol) {

  return String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function num(v, fallback = 0) {

  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function avg(a) {

  if (!a.length) return 0;

  return a.reduce(
    (x, y) => x + y,
    0
  ) / a.length;
}

function median(a) {

  if (!a.length) return 0;

  const b = [...a].sort(
    (x, y) => x - y
  );

  const m = Math.floor(b.length / 2);

  return b.length % 2
    ? b[m]
    : (b[m - 1] + b[m]) / 2;
}


/* =========================================================
   INDICATORS
   ========================================================= */

function sma(values, period) {

  if (values.length < period)
    return null;

  const s =
    values.slice(-period);

  return avg(s);
}


function ema(values, period) {

  if (values.length < period)
    return null;

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


function stddev(values, period) {

  if (values.length < period)
    return null;

  const a =
    values.slice(-period);

  const m =
    avg(a);

  return Math.sqrt(
    avg(
      a.map(
        v => Math.pow(v - m, 2)
      )
    )
  );
}


function rsi(values, period = 14) {

  if (values.length < period + 1)
    return null;

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

    if (d >= 0)
      gain += d;
    else
      loss -= d;
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

  if (avgLoss === 0)
    return 100;

  const rs =
    avgGain / avgLoss;

  return 100 -
    (
      100 / (1 + rs)
    );
}


function macd(values) {

  if (values.length < 35)
    return null;

  const fast =
    ema(values, 12);

  const slow =
    ema(values, 26);

  if (
    fast == null ||
    slow == null
  ) {
    return null;
  }

  const line =
    fast - slow;

  const macdSeries = [];

  for (
    let i = 26;
    i < values.length;
    i++
  ) {

    const f =
      ema(
        values.slice(0, i + 1),
        12
      );

    const s =
      ema(
        values.slice(0, i + 1),
        26
      );

    if (
      f != null &&
      s != null
    ) {

      macdSeries.push(f - s);
    }
  }

  const signal =
    ema(macdSeries, 9);

  return {
    line,
    signal,
    histogram:
      signal == null
        ? null
        : line - signal
  };
}


function atr(candles, period = 14) {

  if (
    candles.length <
    period + 1
  ) {
    return null;
  }

  const trs = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const c =
      candles[i];

    const p =
      candles[i - 1];

    trs.push(
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
    trs.slice(-period)
  );
}


function bollinger(
  values,
  period = 20,
  mult = 2
) {

  if (values.length < period)
    return null;

  const middle =
    sma(values, period);

  const sd =
    stddev(values, period);

  return {
    middle,

    upper:
      middle + mult * sd,

    lower:
      middle - mult * sd,

    width:
      middle
        ? (
            (mult * 2 * sd) /
            middle
          ) * 100
        : 0
  };
}


/* =========================================================
   BYBIT KLINES
   ========================================================= */

function parseKlines(rows) {

  return rows
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


async function bybit(path) {

  const r =
    await fetch(
      BYBIT + path,
      {
        headers: {
          "user-agent":
            "Global-Pulse/3.0"
        }
      }
    );

  if (!r.ok) {

    throw new Error(
      `Bybit HTTP ${r.status}`
    );
  }

  const j =
    await r.json();

  if (j.retCode !== 0) {

    throw new Error(
      j.retMsg ||
      "Bybit error"
    );
  }

  return j.result;
}


async function getKlines(
  category,
  symbol,
  interval,
  limit = 200
) {

  const q =
    `/v5/market/kline` +
    `?category=${encodeURIComponent(category)}` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;

  const r =
    await bybit(q);

  return parseKlines(
    r.list || []
  );
}


/* =========================================================
   AUTOMATIC MARKET DETECTION
   بدون انتخاب Spot/Futures توسط کاربر
   ========================================================= */

async function findMarket(symbol) {

  const s =
    cleanSymbol(symbol);

  if (!s)
    return null;


  /* ابتدا Futures / Linear */

  try {

    const linear =
      await bybit(
        `/v5/market/instruments-info` +
        `?category=linear` +
        `&symbol=${encodeURIComponent(s)}`
      );

    if (
      linear.list &&
      linear.list.length
    ) {

      return "linear";
    }

  } catch {}


  /* سپس Spot */

  try {

    const spot =
      await bybit(
        `/v5/market/instruments-info` +
        `?category=spot` +
        `&symbol=${encodeURIComponent(s)}`
      );

    if (
      spot.list &&
      spot.list.length
    ) {

      return "spot";
    }

  } catch {}


  return null;
}


/* =========================================================
   MARKET STRUCTURE
   ========================================================= */

function structure(candles) {

  if (candles.length < 30)
    return "UNKNOWN";

  const recent =
    candles.slice(-20);

  const high =
    Math.max(
      ...recent.map(
        x => x.high
      )
    );

  const low =
    Math.min(
      ...recent.map(
        x => x.low
      )
    );

  const first =
    recent[0].close;

  const last =
    recent[recent.length - 1]
      .close;

  const range =
    high - low;

  if (!range)
    return "RANGE";

  const move =
    (last - first) /
    range;

  if (move > 0.35)
    return "BULLISH_STRUCTURE";

  if (move < -0.35)
    return "BEARISH_STRUCTURE";

  return "RANGE";
}


/* =========================================================
   SCORE
   ========================================================= */

function calculateScore(x) {

  let score = 50;

  if (x.price > x.ma20)
    score += 8;
  else
    score -= 8;

  if (x.ma20 > x.ma50)
    score += 8;
  else
    score -= 8;

  if (x.ema20 > x.ema50)
    score += 7;
  else
    score -= 7;

  if (x.rsi > 55)
    score += 8;
  else if (x.rsi < 45)
    score -= 8;

  if (x.macd > 0)
    score += 7;
  else
    score -= 7;

  if (
    x.structure ===
    "BULLISH_STRUCTURE"
  ) {
    score += 10;
  }

  if (
    x.structure ===
    "BEARISH_STRUCTURE"
  ) {
    score -= 10;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(score)
    )
  );
}


function trendFromScore(score) {

  if (score >= 60)
    return "BULLISH";

  if (score <= 40)
    return "BEARISH";

  return "NEUTRAL";
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
      200
    );

  if (candles.length < 60) {

    throw new Error(
      `Insufficient ${tf} timeframe data`
    );
  }

  const closes =
    candles.map(
      x => x.close
    );

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
    bollinger(
      closes,
      20,
      2
    );

  const structureName =
    structure(candles);

  const volumeNow =
    candles[
      candles.length - 1
    ].volume;

  const volumeAvg =
    avg(
      candles
        .slice(-21, -1)
        .map(x => x.volume)
    );

  const volumeRatio =
    volumeAvg
      ? volumeNow / volumeAvg
      : 0;

  const obj = {

    tf,

    price,

    ma20,

    ma50,

    ema20,

    ema50,

    rsi: r,

    macd:
      m?.line ?? null,

    macdSignal:
      m?.signal ?? null,

    macdHistogram:
      m?.histogram ?? null,

    atr: a,

    bb,

    volumeRatio,

    high:
      Math.max(
        ...candles
          .slice(-20)
          .map(x => x.high)
      ),

    low:
      Math.min(
        ...candles
          .slice(-20)
          .map(x => x.low)
      ),

    structure:
      structureName
  };

  obj.score =
    calculateScore(obj);

  obj.trend =
    trendFromScore(
      obj.score
    );

  return obj;
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
      `/v5/market/orderbook` +
      `?category=${encodeURIComponent(category)}` +
      `&symbol=${encodeURIComponent(symbol)}` +
      `&limit=50`
    );

  const bids =
    (r.b || [])
      .map(x => [
        num(x[0]),
        num(x[1])
      ]);

  const asks =
    (r.a || [])
      .map(x => [
        num(x[0]),
        num(x[1])
      ]);

  const buy =
    bids.reduce(
      (s, x) =>
        s + x[0] * x[1],
      0
    );

  const sell =
    asks.reduce(
      (s, x) =>
        s + x[0] * x[1],
      0
    );

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
    "NEUTRAL";

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
      bids[0]?.[0] ??
      null,

    bestAsk:
      asks[0]?.[0] ??
      null
  };
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
      `/v5/market/recent-trade` +
      `?category=${encodeURIComponent(category)}` +
      `&symbol=${encodeURIComponent(symbol)}` +
      `&limit=1000`
    );

  let buyVolume = 0;
  let sellVolume = 0;

  let buyNotional = 0;
  let sellNotional = 0;

  let buyTrades = 0;
  let sellTrades = 0;

  for (
    const t of
    (r.list || [])
  ) {

    const size =
      num(t.size);

    const price =
      num(t.price);

    const side =
      String(
        t.side || ""
      ).toLowerCase();

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

  if (
    deltaPercent >= 10
  ) {
    pressure =
      "BUY_PRESSURE";
  }

  if (
    deltaPercent <= -10
  ) {
    pressure =
      "SELL_PRESSURE";
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
   فقط زمانی که Worker خودش بازار Linear پیدا کرده
   ========================================================= */

async function futuresData(
  symbol
) {

  const result = {

    ticker: null,

    oi: null,

    funding: null,

    ratio: null
  };


  try {

    const r =
      await bybit(
        `/v5/market/tickers` +
        `?category=linear` +
        `&symbol=${encodeURIComponent(symbol)}`
      );

    result.ticker =
      r.list?.[0] ||
      null;

  } catch {}


  try {

    const r =
      await bybit(
        `/v5/market/open-interest` +
        `?category=linear` +
        `&symbol=${encodeURIComponent(symbol)}` +
        `&intervalTime=5min` +
        `&limit=1`
      );

    result.oi =
      r.list?.[0] ||
      null;

  } catch {}


  try {

    const r =
      await bybit(
        `/v5/market/funding/history` +
        `?category=linear` +
        `&symbol=${encodeURIComponent(symbol)}` +
        `&limit=1`
      );

    result.funding =
      r.list?.[0] ||
      null;

  } catch {}


  try {

    const r =
      await bybit(
        `/v5/market/account-ratio` +
        `?category=linear` +
        `&symbol=${encodeURIComponent(symbol)}` +
        `&period=5min` +
        `&limit=1`
      );

    result.ratio =
      r.list?.[0] ||
      null;

  } catch {}


  return result;
}


/* =========================================================
   MULTI TIMEFRAME BIAS
   ========================================================= */

function multiBias(
  analyses
) {

  let bull = 0;
  let bear = 0;

  for (
    const x of analyses
  ) {

    if (
      x.trend ===
      "BULLISH"
    ) {
      bull++;
    }

    if (
      x.trend ===
      "BEARISH"
    ) {
      bear++;
    }
  }

  if (bull > bear)
    return "BULLISH";

  if (bear > bull)
    return "BEARISH";

  return "NEUTRAL";
}


/* =========================================================
   CONFIDENCE
   ========================================================= */

function confidence(
  analyses,
  order,
  foot
) {

  const scores =
    analyses.map(
      x => x.score
    );

  const consistency =
    Math.abs(
      avg(scores) - 50
    ) * 2;

  let extra = 0;

  if (
    order?.pressure ===
    "BUY_PRESSURE"
  ) {
    extra += 8;
  }

  if (
    order?.pressure ===
    "SELL_PRESSURE"
  ) {
    extra += 8;
  }

  if (
    foot?.pressure ===
    "BUY_PRESSURE"
  ) {
    extra += 5;
  }

  if (
    foot?.pressure ===
    "SELL_PRESSURE"
  ) {
    extra += 5;
  }

  return Math.max(
    1,
    Math.min(
      99,
      Math.round(
        consistency + extra
      )
    )
  );
}


/* =========================================================
   DEEP ANALYSIS
   ========================================================= */

async function deepAnalyze(
  symbol,
  requestedTf
) {

  symbol =
    cleanSymbol(symbol);

  if (!symbol) {

    throw new Error(
      "Symbol is required"
    );
  }


  /*
    Worker خودش بازار را پیدا می‌کند.
    کاربر هیچ انتخابی برای Spot/Futures ندارد.
  */

  const category =
    await findMarket(symbol);

  if (!category) {

    throw new Error(
      `Symbol ${symbol} not found on Bybit`
    );
  }


  const selected =
    TF_LIST.includes(
      requestedTf
    )
      ? requestedTf
      : "15";


  const analyses = [];


  const allTf = [
    "1",
    "3",
    "5",
    "15",
    "30",
    "60",
    "240",
    "D"
  ];


  for (
    const tf of allTf
  ) {

    try {

      analyses.push(
        await analyzeTimeframe(
          category,
          symbol,
          tf
        )
      );

    } catch {}

    await sleep(80);
  }


  const selectedAnalysis =
    analyses.find(
      x => x.tf === selected
    ) ||
    analyses.find(
      x => x.tf === "15"
    ) ||
    analyses[0];


  const [
    order,
    foot,
    futures
  ] =
    await Promise.all([

      orderBook(
        category,
        symbol
      ).catch(
        () => null
      ),

      footprint(
        category,
        symbol
      ).catch(
        () => null
      ),

      category === "linear"
        ? futuresData(symbol)
        : Promise.resolve(null)

    ]);


  const bias =
    multiBias(
      analyses
    );


  const conf =
    confidence(
      analyses,
      order,
      foot
    );


  const price =
    selectedAnalysis?.price ||
    futures?.ticker?.lastPrice ||
    0;


  const atrValue =
    selectedAnalysis?.atr ||
    0;


  const high =
    Math.max(
      ...analyses.map(
        x => x.high || 0
      )
    );


  const low =
    Math.min(
      ...analyses.map(
        x => x.low ??
        Infinity
      )
    );


  const longSL =
    price -
    atrValue * 2;

  const longTP1 =
    price +
    atrValue * 3;

  const longTP2 =
    price +
    atrValue * 5;

  const shortSL =
    price +
    atrValue * 2;

  const shortTP1 =
    price -
    atrValue * 3;

  const shortTP2 =
    price -
    atrValue * 5;


  return {

    symbol,

    category,

    requestedTimeframe:
      selected,

    analyses,

    selectedAnalysis,

    orderBook:
      order,

    footprint:
      foot,

    futures,

    bias,

    confidence:
      conf,

    price,

    recentLow:
      low,

    recentHigh:
      high,

    longSL,

    longTP1,

    longTP2,

    shortSL,

    shortTP1,

    shortTP2,

    generatedAt:
      new Date().toISOString()
  };
}


/* =========================================================
   GLOBAL NEWS
   ========================================================= */

const NEWS_FEEDS = [

  "https://feeds.bbci.co.uk/news/world/rss.xml",

  "https://feeds.bbci.co.uk/news/business/rss.xml",

  "https://feeds.bbci.co.uk/news/technology/rss.xml",

  "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"

];


function stripXml(s) {

  return String(s || "")
    .replace(
      /<!\[CDATA\[/g,
      ""
    )
    .replace(
      /\]\]>/g,
      ""
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function xmlItems(xml) {

  const items = [];

  const re =
    /<item[\s\S]*?<\/item>/gi;

  const blocks =
    xml.match(re) || [];


  for (
    const block of blocks
  ) {

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


  for (
    const url of NEWS_FEEDS
  ) {

    try {

      const r =
        await fetch(
          url,
          {
            headers: {
              "user-agent":
                "Global-Pulse/3.0"
            }
          }
        );

      if (!r.ok)
        continue;


      const xml =
        await r.text();


      all.push(
        ...xmlItems(xml)
      );

    } catch {}
  }


  const unique = [];

  const seen =
    new Set();


  for (
    const x of all
  ) {

    const key =
      x.title.toLowerCase();

    if (seen.has(key))
      continue;

    seen.add(key);

    unique.push(x);
  }


  return unique.slice(
    0,
    20
  );
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
      await fetch(
        url,
        {
          headers: {
            "user-agent":
              "Mozilla/5.0 Global-Pulse"
          }
        }
      );


    if (!r.ok)
      throw new Error(
        "Trend unavailable"
      );


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
          .map(
            x => x.title
          )
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
   SHOPPING RADAR
   ========================================================= */

const SHOPPING_FEEDS = [

  "https://news.google.com/rss/search?q=best+deals+shopping&hl=en-US&gl=US&ceid=US:en",

  "https://news.google.com/rss/search?q=consumer+deals+discounts&hl=en-US&gl=US&ceid=US:en",

  "https://news.google.com/rss/search?q=popular+products+shopping&hl=en-US&gl=US&ceid=US:en"

];


async function fetchShopping() {

  const all = [];


  for (
    const url of SHOPPING_FEEDS
  ) {

    try {

      const r =
        await fetch(
          url,
          {
            headers: {
              "user-agent":
                "Global-Pulse/3.0"
            }
          }
        );


      if (!r.ok)
        continue;


      const xml =
        await r.text();


      all.push(
        ...xmlItems(xml)
      );

    } catch {}
  }


  const seen =
    new Set();

  const result =
    [];


  for (
    const x of all
  ) {

    const k =
      x.title.toLowerCase();

    if (seen.has(k))
      continue;

    seen.add(k);

    result.push(x);
  }


  return result.slice(
    0,
    20
  );
}


/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(
  env,
  method,
  body
) {

  if (
    !env.TELEGRAM_BOT_TOKEN
  ) {

    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }


  const telegramUrl =
    `https://api.telegram.org/bot` +
    `${env.TELEGRAM_BOT_TOKEN}` +
    `/${method}`;


  const r =
    await fetch(
      telegramUrl,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(body)
      }
    );


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
  textMessage
) {

  if (
    !env.TELEGRAM_CHANNEL_ID
  ) {

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
        textMessage,

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

    return s +
      "No reliable global news available right now.\n\n" +
      "━━━━━━━━━━━━━━━━\n" +
      "🌐 Global Pulse";
  }


  for (
    const x of items.slice(0, 8)
  ) {

    s +=
      `• ${x.title}\n`;

    if (x.link)
      s +=
        `${x.link}\n`;

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

`;


  if (!data.trends.length) {

    s +=
`🌍 ${data.country}

No reliable trend data available right now.

`;

  } else {

    s +=
`🌍 ${data.country}

`;


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
📊 Trends rotate automatically
🌐 Global Pulse`;

  return s;
}


function shoppingMessage(
  items
) {

  let s =
`🛒 GLOBAL SHOPPING RADAR

🔥 Popular deals & consumer topics

`;


  if (!items.length) {

    s +=
`No shopping information available right now.

`;

  } else {

    items
      .slice(0, 8)
      .forEach(
        x => {

          s +=
            `• ${x.title}\n`;

          if (x.link)
            s +=
              `${x.link}\n`;

          s += "\n";
        }
      );
  }


  s +=
`━━━━━━━━━━━━━━━━
⚠️ Prices and availability can change.
🌐 Global Pulse`;

  return s;
}


/* =========================================================
   CRYPTO TELEGRAM MESSAGE
   ========================================================= */

function cryptoMessage(a) {

  const x =
    a.selectedAnalysis ||
    {};


  let s =
`🪙 GLOBAL PULSE CRYPTO RADAR

${a.symbol}
📊 Market: ${a.category}
⏱ Timeframe: ${a.requestedTimeframe}

━━━━━━━━━━━━━━━━

💰 Price: ${a.price}
🎯 Bias: ${a.bias}
📈 Confidence: ${a.confidence}%

Selected TF:
• Trend: ${x.trend}
• Score: ${x.score}
• RSI: ${num(x.rsi).toFixed(2)}
• MACD: ${num(x.macd).toFixed(4)}
• ATR: ${num(x.atr).toFixed(4)}
• Structure: ${x.structure}
• Volume Ratio: ${num(x.volumeRatio).toFixed(2)}

━━━━━━━━━━━━━━━━

📚 MULTI-TIMEFRAME

${a.analyses
  .map(
    z =>
      `${z.tf}: ${z.trend} | ${z.score}/100`
  )
  .join("\n")}

━━━━━━━━━━━━━━━━

📖 ORDER BOOK
${
  a.orderBook
    ? `Buy ${a.orderBook.buyShare.toFixed(1)}%
Sell ${a.orderBook.sellShare.toFixed(1)}%
${a.orderBook.pressure}`
    : "Unavailable"
}

📖 FOOTPRINT
${
  a.footprint
    ? `Delta ${a.footprint.deltaPercent.toFixed(2)}%
${a.footprint.pressure}`
    : "Unavailable"
}

━━━━━━━━━━━━━━━━

🟢 LONG PLAN
SL: ${a.longSL}
TP1: ${a.longTP1}
TP2: ${a.longTP2}

🔴 SHORT PLAN
SL: ${a.shortSL}
TP1: ${a.shortTP1}
TP2: ${a.shortTP2}

⚠️ This is market analysis, not financial advice.

🌐 Global Pulse`;

  return s;
}


/* =========================================================
   AUTOMATIC PUBLISH
   ========================================================= */

async function automaticPublish(
  env
) {

  const news =
    await fetchNews();


  try {

    await sendTelegram(
      env,
      newsMessage(news)
    );

  } catch {}


  await sleep(500);


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


  try {

    await sendTelegram(
      env,
      trendMessage(trend)
    );

  } catch {}


  await sleep(500);


  const shopping =
    await fetchShopping();


  try {

    await sendTelegram(
      env,
      shoppingMessage(
        shopping
      )
    );

  } catch {}
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

      /* ===================================================
         HEALTH
         =================================================== */

      if (
        path === "/health"
      ) {

        let channel =
          false;


        try {

          if (
            env.TELEGRAM_CHANNEL_ID
          ) {

            const me =
              await telegram(
                env,
                "getChat",
                {
                  chat_id:
                    env.TELEGRAM_CHANNEL_ID
                }
              );

            channel =
              !!me.ok;
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

          bybit:
            true,

          time:
            new Date()
              .toISOString()
        });
      }


      /* ===================================================
         WEBHOOK SETUP
         =================================================== */

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

          telegram:
            result
        });
      }


      /* ===================================================
         TELEGRAM WEBHOOK
         =================================================== */

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


      /* ===================================================
         TEST NEWS
         =================================================== */

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

          type:
            "news",

          count:
            items.length
        });
      }


      /* ===================================================
         TEST TREND
         =================================================== */

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

          type:
            "trend",

          country:
            country.name,

          count:
            data.trends.length
        });
      }


      /* ===================================================
         TEST SHOPPING
         =================================================== */

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

          type:
            "shopping",

          count:
            items.length
        });
      }


      /* ===================================================
         CRYPTO ANALYZE

         کاربر فقط symbol و timeframe می‌دهد.
         category توسط Worker تعیین می‌شود.
         =================================================== */

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

          version:
            VERSION,

          data
        });
      }


      /* ===================================================
         TELEGRAM CRYPTO TEST
         =================================================== */

      if (
        path === "/test-crypto"
      ) {

        const symbol =
          cleanSymbol(
            url.searchParams.get(
              "symbol"
            ) ||
            "BTCUSDT"
          );


        const timeframe =
          url.searchParams.get(
            "timeframe"
          ) ||
          "15";


        const data =
          await deepAnalyze(
            symbol,
            timeframe
          );


        await sendTelegram(
          env,
          cryptoMessage(data)
        );


        return json({

          ok: true,

          type:
            "crypto",

          symbol,

          timeframe
        });
      }


      /* ===================================================
         MANUAL PUBLISH
         =================================================== */

      if (
        path === "/publish"
      ) {

        await automaticPublish(
          env
        );


        return json({

          ok: true,

          published:
            true
        });
      }


      /* ===================================================
         NOT FOUND
         =================================================== */

      return json({

        ok: false,

        error:
          "Not Found",

        path

      }, 404);


    } catch (e) {

      return json({

        ok: false,

        version:
          VERSION,

        error:
          e.message ||
          String(e)

      }, 500);
    }
  },


  /* =====================================================
     CRON
     ===================================================== */

  async scheduled(
    event,
    env,
    ctx
  ) {

    ctx.waitUntil(
      automaticPublish(env)
    );
  }
};
