/* =========================================================
   GLOBAL PULSE V10
   Global News + Iran News + Country Trends + Shopping
   + Interactive Crypto Radar
   + Persian / English
   + Crypto Timeframe Selector
   + Automatic Telegram Publishing
   + Iran News ONLY from Iranian Sources
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V10";
const BYBIT = "https://api.bybit.com";

const TF_LIST = ["1","3","5","15","30","60","240","D"];

const TF_NAMES = {
  fa:{
    "1":"۱ دقیقه",
    "3":"۳ دقیقه",
    "5":"۵ دقیقه",
    "15":"۱۵ دقیقه",
    "30":"۳۰ دقیقه",
    "60":"۱ ساعت",
    "240":"۴ ساعت",
    "D":"روزانه"
  },
  en:{
    "1":"1 Minute",
    "3":"3 Minutes",
    "5":"5 Minutes",
    "15":"15 Minutes",
    "30":"30 Minutes",
    "60":"1 Hour",
    "240":"4 Hours",
    "D":"Daily"
  }
};

const COUNTRIES = [
  {code:"US",name:"United States",fa:"آمریکا"},
  {code:"GB",name:"United Kingdom",fa:"بریتانیا"},
  {code:"DE",name:"Germany",fa:"آلمان"},
  {code:"FR",name:"France",fa:"فرانسه"},
  {code:"JP",name:"Japan",fa:"ژاپن"},
  {code:"KR",name:"South Korea",fa:"کره جنوبی"},
  {code:"AE",name:"United Arab Emirates",fa:"امارات"},
  {code:"TR",name:"Turkey",fa:"ترکیه"},
  {code:"IN",name:"India",fa:"هند"},
  {code:"BR",name:"Brazil",fa:"برزیل"},
  {code:"CA",name:"Canada",fa:"کانادا"},
  {code:"AU",name:"Australia",fa:"استرالیا"},
  {code:"SG",name:"Singapore",fa:"سنگاپور"},
  {code:"CH",name:"Switzerland",fa:"سوئیس"}
];

/* =========================================================
   HELPERS
   ========================================================= */

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve,ms));

function json(data,status=200){

  return new Response(
    JSON.stringify(data,null,2),
    {
      status,
      headers:{
        "content-type":"application/json; charset=UTF-8",
        "cache-control":"no-store"
      }
    }
  );
}

function cleanSymbol(s){

  return String(s||"")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g,"");
}

function num(v,fallback=0){

  const n=Number(v);

  return Number.isFinite(n)
    ?n
    :fallback;
}

function avg(a){

  if(!a.length)return 0;

  return a.reduce(
    (x,y)=>x+y,
    0
  )/a.length;
}

function sma(v,p){

  if(v.length<p)return null;

  return avg(
    v.slice(-p)
  );
}

function ema(v,p){

  if(v.length<p)return null;

  const k=2/(p+1);

  let e=avg(
    v.slice(0,p)
  );

  for(
    let i=p;
    i<v.length;
    i++
  ){

    e=
      v[i]*k+
      e*(1-k);
  }

  return e;
}

function stddev(v,p){

  if(v.length<p)return null;

  const a=v.slice(-p);

  const m=avg(a);

  return Math.sqrt(
    avg(
      a.map(
        x=>(x-m)**2
      )
    )
  );
}

function rsi(v,p=14){

  if(v.length<p+1)return null;

  let gain=0;
  let loss=0;

  for(
    let i=1;
    i<=p;
    i++
  ){

    const d=
      v[i]-v[i-1];

    if(d>=0)
      gain+=d;
    else
      loss-=d;
  }

  let ag=gain/p;
  let al=loss/p;

  for(
    let i=p+1;
    i<v.length;
    i++
  ){

    const d=
      v[i]-v[i-1];

    const g=
      Math.max(d,0);

    const l=
      Math.max(-d,0);

    ag=
      ((ag*(p-1))+g)/p;

    al=
      ((al*(p-1))+l)/p;
  }

  if(al===0)
    return 100;

  const rs=
    ag/al;

  return 100-
    (100/(1+rs));
}

function macd(v){

  if(v.length<35)
    return null;

  const fast=
    ema(v,12);

  const slow=
    ema(v,26);

  if(
    fast==null||
    slow==null
  )
    return null;

  const line=
    fast-slow;

  const series=[];

  for(
    let i=26;
    i<v.length;
    i++
  ){

    const f=
      ema(
        v.slice(0,i+1),
        12
      );

    const s=
      ema(
        v.slice(0,i+1),
        26
      );

    if(
      f!=null&&
      s!=null
    ){

      series.push(
        f-s
      );
    }
  }

  const signal=
    ema(
      series,
      9
    );

  return {
    line,
    signal,
    histogram:
      signal==null
        ?null
        :line-signal
  };
}

function atr(c,p=14){

  if(c.length<p+1)
    return null;

  const trs=[];

  for(
    let i=1;
    i<c.length;
    i++
  ){

    const x=c[i];
    const y=c[i-1];

    trs.push(
      Math.max(
        x.high-x.low,
        Math.abs(
          x.high-y.close
        ),
        Math.abs(
          x.low-y.close
        )
      )
    );
  }

  return avg(
    trs.slice(-p)
  );
}

function bollinger(
  v,
  p=20,
  m=2
){

  if(v.length<p)
    return null;

  const middle=
    sma(v,p);

  const sd=
    stddev(v,p);

  return {
    middle,
    upper:
      middle+m*sd,
    lower:
      middle-m*sd,
    width:
      middle
        ?((2*m*sd)/middle)*100
        :0
  };
}

function parseKlines(rows){

  return rows
    .map(x=>({
      time:num(x[0]),
      open:num(x[1]),
      high:num(x[2]),
      low:num(x[3]),
      close:num(x[4]),
      volume:num(x[5]),
      turnover:num(x[6])
    }))
    .sort(
      (a,b)=>a.time-b.time
    );
}

/* =========================================================
   BYBIT
   ========================================================= */

async function bybit(path){

  const r=
    await fetch(
      BYBIT+path,
      {
        headers:{
          "user-agent":
            "Global-Pulse/10.0"
        }
      }
    );

  if(!r.ok){

    throw new Error(
      `Bybit HTTP ${r.status}`
    );
  }

  const j=
    await r.json();

  if(j.retCode!==0){

    throw new Error(
      j.retMsg||
      "Bybit error"
    );
  }

  return j.result;
}

async function getKlines(
  category,
  symbol,
  interval,
  limit=200
){

  const r=
    await bybit(
      `/v5/market/kline?category=${category}`+
      `&symbol=${symbol}`+
      `&interval=${interval}`+
      `&limit=${limit}`
    );

  return parseKlines(
    r.list||[]
  );
}

async function findMarket(symbol){

  symbol=
    cleanSymbol(symbol);

  if(!symbol)
    return null;

  for(
    const category of
    ["linear","spot"]
  ){

    try{

      const r=
        await bybit(
          `/v5/market/instruments-info`+
          `?category=${category}`+
          `&symbol=${symbol}`
        );

      if(
        r.list?.length
      ){

        return category;
      }

    }catch{}
  }

  return null;
}

/* =========================================================
   CRYPTO SYMBOL RESOLUTION
   ========================================================= */

function isCryptoSymbol(text){

  const s=
    cleanSymbol(text);

  if(!s)
    return false;

  return /^[A-Z0-9]{2,30}$/.test(s);
}

function extractCryptoSymbol(text){

  let s=
    String(text||"")
      .trim();

  if(!s)
    return null;

  s=
    s.replace(
      /^\/crypto(@[A-Za-z0-9_]+)?\s*/i,
      ""
    );

  s=
    s.replace(
      /^\/analyze(@[A-Za-z0-9_]+)?\s*/i,
      ""
    );

  const parts=
    s.split(/\s+/);

  s=
    parts[0]||"";

  s=
    cleanSymbol(s);

  return isCryptoSymbol(s)
    ?s
    :null;
}

async function resolveCryptoSymbol(
  input
){

  const original=
    cleanSymbol(input);

  if(!original){

    throw new Error(
      "Symbol is required"
    );
  }

  /* مستقیم */

  const direct=
    await findMarket(
      original
    );

  if(direct)
    return original;

  /* USDT */

  if(
    !original.endsWith("USDT")
  ){

    const usdt=
      original+
      "USDT";

    const market=
      await findMarket(
        usdt
      );

    if(market)
      return usdt;
  }

  return original;
}

/* =========================================================
   MARKET ANALYSIS
   ========================================================= */

function structure(c){

  if(c.length<30)
    return "UNKNOWN";

  const r=
    c.slice(-20);

  const high=
    Math.max(
      ...r.map(
        x=>x.high
      )
    );

  const low=
    Math.min(
      ...r.map(
        x=>x.low
      )
    );

  const first=
    r[0].close;

  const last=
    r[r.length-1].close;

  const range=
    high-low;

  if(!range)
    return "RANGE";

  const move=
    (last-first)/range;

  if(move>.35)
    return "BULLISH_STRUCTURE";

  if(move<-.35)
    return "BEARISH_STRUCTURE";

  return "RANGE";
}

function supportResistance(c){

  const recent=
    c.slice(-100);

  const supports=
    recent
      .map(x=>x.low)
      .sort(
        (a,b)=>a-b
      );

  const resistances=
    recent
      .map(x=>x.high)
      .sort(
        (a,b)=>b-a
      );

  return {
    supports:
      supports.slice(0,8),
    resistances:
      resistances.slice(0,8)
  };
}

function vwap(c){

  let pv=0;
  let vol=0;

  for(
    const x of
    c.slice(-100)
  ){

    const typical=
      (
        x.high+
        x.low+
        x.close
      )/3;

    pv+=
      typical*
      x.volume;

    vol+=x.volume;
  }

  return vol
    ?pv/vol
    :null;
}

function stochastic(
  c,
  p=14
){

  if(c.length<p)
    return null;

  const a=
    c.slice(-p);

  const high=
    Math.max(
      ...a.map(
        x=>x.high
      )
    );

  const low=
    Math.min(
      ...a.map(
        x=>x.low
      )
    );

  if(high===low)
    return 50;

  return (
    (
      a.at(-1).close-
      low
    )/
    (high-low)
  )*100;
}

function momentum(
  v,
  p=10
){

  if(v.length<=p)
    return null;

  const old=
    v[v.length-1-p];

  const now=
    v[v.length-1];

  return old
    ?((now-old)/old)*100
    :0;
}

function divergence(v){

  if(v.length<40){

    return {
      type:"NONE",
      strength:0
    };
  }

  const a=
    v.slice(-40);

  const first=
    a.slice(0,20);

  const second=
    a.slice(20);

  const p1=
    avg(first);

  const p2=
    avg(second);

  const r1=
    rsi(first);

  const r2=
    rsi(second);

  if(
    r1==null||
    r2==null
  ){

    return {
      type:"NONE",
      strength:0
    };
  }

  if(
    p2<p1&&
    r2>r1
  ){

    return {
      type:
        "BULLISH_DIVERGENCE",
      strength:
        Math.round(r2-r1)
    };
  }

  if(
    p2>p1&&
    r2<r1
  ){

    return {
      type:
        "BEARISH_DIVERGENCE",
      strength:
        Math.round(r1-r2)
    };
  }

  return {
    type:"NONE",
    strength:0
  };
}

/* =========================================================
   TIMEFRAME ANALYSIS
   ========================================================= */

async function analyzeTimeframe(
  category,
  symbol,
  tf
){

  const candles=
    await getKlines(
      category,
      symbol,
      tf,
      200
    );

  if(candles.length<60){

    throw new Error(
      `Insufficient ${tf} data`
    );
  }

  const closes=
    candles.map(
      x=>x.close
    );

  const price=
    closes.at(-1);

  const ma20=
    sma(closes,20);

  const ma50=
    sma(closes,50);

  const ema20=
    ema(closes,20);

  const ema50=
    ema(closes,50);

  const r=
    rsi(closes,14);

  const m=
    macd(closes);

  const a=
    atr(candles,14);

  const bb=
    bollinger(closes);

  const volNow=
    candles.at(-1).volume;

  const volAvg=
    avg(
      candles
        .slice(-21,-1)
        .map(
          x=>x.volume
        )
    );

  const volumeRatio=
    volAvg
      ?volNow/volAvg
      :0;

  const sr=
    supportResistance(
      candles
    );

  const vw=
    vwap(candles);

  const stoch=
    stochastic(candles);

  const mom=
    momentum(closes);

  const div=
    divergence(closes);

  let trend=
    "NEUTRAL";

  let bullish=0;
  let bearish=0;

  if(price>ma20)
    bullish++;
  else
    bearish++;

  if(ma20>ma50)
    bullish++;
  else
    bearish++;

  if(ema20>ema50)
    bullish++;
  else
    bearish++;

  if(r>55)
    bullish++;

  if(r<45)
    bearish++;

  if(m?.line>m?.signal)
    bullish++;

  if(m?.line<m?.signal)
    bearish++;

  if(bullish>bearish)
    trend="BULLISH";

  if(bearish>bullish)
    trend="BEARISH";

  return {
    tf,
    price,
    ma20,
    ma50,
    ema20,
    ema50,
    rsi:r,
    macd:m?.line??null,
    macdSignal:m?.signal??null,
    macdHistogram:
      m?.histogram??null,
    atr:a,
    bollinger:bb,
    bb,
    vwap:vw,
    stochastic:stoch,
    momentum:mom,
    divergence:div,
    volumeRatio,
    supportResistance:sr,
    high:
      Math.max(
        ...candles
          .slice(-20)
          .map(x=>x.high)
      ),
    low:
      Math.min(
        ...candles
          .slice(-20)
          .map(x=>x.low)
      ),
    structure:
      structure(candles),
    trend
  };
}

/* =========================================================
   ORDER BOOK
   ========================================================= */

async function orderBook(
  category,
  symbol
){

  const r=
    await bybit(
      `/v5/market/orderbook`+
      `?category=${category}`+
      `&symbol=${symbol}`+
      `&limit=50`
    );

  const bids=
    (r.b||[])
      .map(x=>[
        num(x[0]),
        num(x[1])
      ]);

  const asks=
    (r.a||[])
      .map(x=>[
        num(x[0]),
        num(x[1])
      ]);

  const buy=
    bids.reduce(
      (s,x)=>
        s+x[0]*x[1],
      0
    );

  const sell=
    asks.reduce(
      (s,x)=>
        s+x[0]*x[1],
      0
    );

  const total=
    buy+sell;

  return {
    buy,
    sell,

    buyShare:
      total
        ?buy/total*100
        :50,

    sellShare:
      total
        ?sell/total*100
        :50,

    pressure:
      buy>sell*1.15
        ?"BUY_PRESSURE"
        :
      sell>buy*1.15
        ?"SELL_PRESSURE"
        :
        "NEUTRAL",

    bestBid:
      bids[0]?.[0]??null,

    bestAsk:
      asks[0]?.[0]??null,

    buyWalls:
      bids
        .sort(
          (a,b)=>b[1]-a[1]
        )
        .slice(0,10),

    sellWalls:
      asks
        .sort(
          (a,b)=>b[1]-a[1]
        )
        .slice(0,10)
  };
}

/* =========================================================
   FOOTPRINT
   ========================================================= */

async function footprint(
  category,
  symbol
){

  const r=
    await bybit(
      `/v5/market/recent-trade`+
      `?category=${category}`+
      `&symbol=${symbol}`+
      `&limit=1000`
    );

  let buyVolume=0;
  let sellVolume=0;

  let buyNotional=0;
  let sellNotional=0;

  let buyTrades=0;
  let sellTrades=0;

  for(
    const t of
    r.list||[]
  ){

    const size=
      num(t.size);

    const price=
      num(t.price);

    const side=
      String(
        t.side||""
      ).toLowerCase();

    if(side==="buy"){

      buyVolume+=size;
      buyNotional+=
        size*price;
      buyTrades++;
    }

    if(side==="sell"){

      sellVolume+=size;
      sellNotional+=
        size*price;
      sellTrades++;
    }
  }

  const total=
    buyNotional+
    sellNotional;

  const delta=
    buyNotional-
    sellNotional;

  const deltaPercent=
    total
      ?delta/total*100
      :0;

  return {
    buyVolume,
    sellVolume,
    buyNotional,
    sellNotional,
    buyTrades,
    sellTrades,
    delta,
    deltaPercent,

    pressure:
      deltaPercent>=10
        ?"BUY_PRESSURE"
        :
      deltaPercent<=-10
        ?"SELL_PRESSURE"
        :
        "NEUTRAL"
  };
}

/* =========================================================
   FUTURES
   ========================================================= */

async function futuresData(
  symbol
){

  const result={
    ticker:null,
    oi:null,
    funding:null,
    ratio:null
  };

  try{

    const r=
      await bybit(
        `/v5/market/tickers`+
        `?category=linear`+
        `&symbol=${symbol}`
      );

    result.ticker=
      r.list?.[0]||null;

  }catch{}

  try{

    const r=
      await bybit(
        `/v5/market/open-interest`+
        `?category=linear`+
        `&symbol=${symbol}`+
        `&intervalTime=5min`+
        `&limit=1`
      );

    result.oi=
      r.list?.[0]||null;

  }catch{}

  try{

    const r=
      await bybit(
        `/v5/market/funding/history`+
        `?category=linear`+
        `&symbol=${symbol}`+
        `&limit=1`
      );

    result.funding=
      r.list?.[0]||null;

  }catch{}

  try{

    const r=
      await bybit(
        `/v5/market/account-ratio`+
        `?category=linear`+
        `&symbol=${symbol}`+
        `&period=5min`+
        `&limit=1`
      );

    result.ratio=
      r.list?.[0]||null;

  }catch{}

  return result;
}

/* =========================================================
   DEEP ANALYSIS
   ========================================================= */

async function deepAnalyze(
  symbol,
  requestedTf="15"
){

  symbol=
    cleanSymbol(symbol);

  if(!symbol){

    throw new Error(
      "Symbol is required"
    );
  }

  const category=
    await findMarket(symbol);

  if(!category){

    throw new Error(
      `Symbol ${symbol} not found on Bybit`
    );
  }

  const selected=
    TF_LIST.includes(
      requestedTf
    )
      ?requestedTf
      :"15";

  const analyses=[];

  for(
    const tf of TF_LIST
  ){

    try{

      analyses.push(
        await analyzeTimeframe(
          category,
          symbol,
          tf
        )
      );

    }catch{}

    await sleep(60);
  }

  const selectedAnalysis=
    analyses.find(
      x=>x.tf===selected
    )||
    analyses.find(
      x=>x.tf==="15"
    )||
    analyses[0];

  const [
    order,
    foot,
    futures
  ]=
    await Promise.all([
      orderBook(
        category,
        symbol
      ).catch(()=>null),

      footprint(
        category,
        symbol
      ).catch(()=>null),

      category==="linear"
        ?futuresData(symbol)
        :null
    ]);

  const price=
    selectedAnalysis?.price||
    num(
      futures?.ticker?.lastPrice
    );

  return {
    symbol,
    category,
    requestedTimeframe:selected,
    analyses,
    selectedAnalysis,
    orderBook:order,
    footprint:foot,
    futures,
    price,
    generatedAt:
      new Date().toISOString()
  };
}

/* =========================================================
   NEWS SOURCES
   ========================================================= */

const GLOBAL_NEWS_FEEDS=[
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.bbci.co.uk/news/business/rss.xml",
  "https://feeds.bbci.co.uk/news/technology/rss.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"
];

/*
   IMPORTANT:
   Iran News is restricted to Iranian domestic sources.
   No BBC / CNN / Reuters / NYT / foreign source is used
   in this section.
*/

const IRAN_NEWS_FEEDS=[
  "https://www.irna.ir/rss",
  "https://www.isna.ir/rss",
  "https://www.mehrnews.com/rss",
  "https://www.tasnimnews.com/fa/rss/feed/0/8/0/%D9%85%D9%87%D9%85%D8%AA%D8%B1%DB%8C%D9%86-%D8%AA%D8%B3%D9%86%DB%8C%D9%85"
];

const IRAN_SOURCE_NAMES={
  "https://www.irna.ir/rss":
    "IRNA",
  "https://www.isna.ir/rss":
    "ISNA",
  "https://www.mehrnews.com/rss":
    "Mehr News",
  "https://www.tasnimnews.com/fa/rss/feed/0/8/0/%D9%85%D9%87%D9%85%D8%AA%D8%B1%DB%8C%D9%86-%D8%AA%D8%B3%D9%86%DB%8C%D9%85":
    "Tasnim"
};

const SHOPPING_FEEDS=[
  "https://news.google.com/rss/search?q=best+deals+shopping&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=consumer+deals+discounts&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=popular+products+shopping&hl=en-US&gl=US&ceid=US:en"
];

/* =========================================================
   XML
   ========================================================= */

function stripXml(s){

  return String(s||"")
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

function xmlItems(xml){

  const result=[];

  const blocks=
    xml.match(
      /<item[\s\S]*?<\/item>/gi
    )||[];

  for(
    const block of blocks
  ){

    const title=
      stripXml(
        (
          block.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
          )||[]
        )[1]
      );

    const link=
      stripXml(
        (
          block.match(
            /<link[^>]*>([\s\S]*?)<\/link>/i
          )||[]
        )[1]
      );

    const pub=
      stripXml(
        (
          block.match(
            /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i
          )||[]
        )[1]
      );

    if(title){

      result.push({
        title,
        link,
        pubDate:pub
      });
    }
  }

  return result;
}

async function fetchFeeds(
  feeds,
  source
){

  const all=[];

  for(
    const url of feeds
  ){

    try{

      const r=
        await fetch(
          url,
          {
            headers:{
              "user-agent":
                "Global-Pulse/10.0"
            }
          }
        );

      if(!r.ok)
        continue;

      const xml=
        await r.text();

      for(
        const x of
        xmlItems(xml)
      ){

        all.push({
          ...x,
          source
        });
      }

    }catch{}
  }

  const seen=
    new Set();

  const result=[];

  for(
    const x of all
  ){

    const key=
      x.title
        .toLowerCase()
        .trim();

    if(seen.has(key))
      continue;

    seen.add(key);

    result.push(x);
  }

  return result.slice(
    0,
    20
  );
}

async function fetchGlobalNews(){

  return fetchFeeds(
    GLOBAL_NEWS_FEEDS,
    "Global Sources"
  );
}

async function fetchIranNews(){

  const all=[];

  for(
    const url of
    IRAN_NEWS_FEEDS
  ){

    try{

      const r=
        await fetch(
          url,
          {
            headers:{
              "user-agent":
                "Global-Pulse/10.0"
            }
          }
        );

      if(!r.ok)
        continue;

      const xml=
        await r.text();

      const source=
        IRAN_SOURCE_NAMES[url]||
        "Iranian Source";

      for(
        const x of
        xmlItems(xml)
      ){

        all.push({
          ...x,
          source
        });
      }

    }catch{}
  }

  const seen=
    new Set();

  const result=[];

  for(
    const x of all
  ){

    const key=
      x.title
        .toLowerCase()
        .trim();

    if(seen.has(key))
      continue;

    seen.add(key);

    result.push(x);
  }

  return result.slice(
    0,
    20
  );
}

async function fetchShopping(){

  return fetchFeeds(
    SHOPPING_FEEDS,
    "Shopping Sources"
  );
}

/* =========================================================
   TRENDS
   ========================================================= */

async function fetchCountryTrend(
  country
){

  try{

    const r=
      await fetch(
        `https://trends.google.com/trending/rss?geo=${country.code}`,
        {
          headers:{
            "user-agent":
              "Mozilla/5.0 Global-Pulse"
          }
        }
      );

    if(!r.ok)
      throw new Error();

    const xml=
      await r.text();

    return {
      country:country.name,
      code:country.code,
      trends:
        xmlItems(xml)
          .slice(0,10)
          .map(
            x=>x.title
          )
    };

  }catch{

    return {
      country:country.name,
      code:country.code,
      trends:[]
    };
  }
}

/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(
  env,
  method,
  body
){

  if(!env.TELEGRAM_BOT_TOKEN){

    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  const r=
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method:"POST",
        headers:{
          "content-type":
            "application/json"
        },
        body:
          JSON.stringify(body)
      }
    );

  const j=
    await r.json();

  if(!j.ok){

    throw new Error(
      j.description||
      "Telegram error"
    );
  }

  return j;
}

async function sendTelegram(
  env,
  message
){

  if(!env.TELEGRAM_CHANNEL_ID){

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

      text:message,

      disable_web_page_preview:true
    }
  );
}

/* =========================================================
   LANGUAGE
   ========================================================= */

const userLanguages=
  new Map();

const pendingSymbols=
  new Map();

function getLang(
  userId
){

  return (
    userLanguages.get(
      String(userId)
    )||"en"
  );
}

function setLang(
  userId,
  lang
){

  if(
    lang!=="fa"&&
    lang!=="en"
  ){

    lang="en";
  }

  userLanguages.set(
    String(userId),
    lang
  );

  return lang;
}

function setPendingSymbol(
  userId,
  symbol
){

  pendingSymbols.set(
    String(userId),
    cleanSymbol(symbol)
  );
}

function getPendingSymbol(
  userId
){

  return pendingSymbols.get(
    String(userId)
  )||null;
}

function clearPendingSymbol(
  userId
){

  pendingSymbols.delete(
    String(userId)
  );
}

/* =========================================================
   LANGUAGE KEYBOARD
   ========================================================= */

function languageKeyboard(){

  return {
    inline_keyboard:[
      [
        {
          text:"🇮🇷 فارسی",
          callback_data:
            "lang_fa"
        },
        {
          text:"🇬🇧 English",
          callback_data:
            "lang_en"
        }
      ]
    ]
  };
}

async function sendLanguageMenu(
  env,
  chatId
){

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:chatId,

      text:
`🌐 GLOBAL PULSE

🇮🇷 فارسی
🇬🇧 English

زبان / Language`,

      reply_markup:
        languageKeyboard()
    }
  );
}

/* =========================================================
   TIMEFRAME KEYBOARD
   ========================================================= */

function timeframeKeyboard(
  lang
){

  const n=
    TF_NAMES[lang]||
    TF_NAMES.en;

  return {
    inline_keyboard:[
      [
        {
          text:`1m — ${n["1"]}`,
          callback_data:"tf_1"
        },
        {
          text:`3m — ${n["3"]}`,
          callback_data:"tf_3"
        },
        {
          text:`5m — ${n["5"]}`,
          callback_data:"tf_5"
        }
      ],
      [
        {
          text:`15m — ${n["15"]}`,
          callback_data:"tf_15"
        },
        {
          text:`30m — ${n["30"]}`,
          callback_data:"tf_30"
        },
        {
          text:`1H — ${n["60"]}`,
          callback_data:"tf_60"
        }
      ],
      [
        {
          text:`4H — ${n["240"]}`,
          callback_data:"tf_240"
        },
        {
          text:`D — ${n["D"]}`,
          callback_data:"tf_D"
        }
      ]
    ]
  };
}

async function sendTimeframeMenu(
  env,
  chatId,
  symbol
){

  const lang=
    getLang(chatId);

  const text=
    lang==="fa"
      ?
`🪙 رمز ارز: ${symbol}

⏱ تایم‌فریم تحلیل را انتخاب کنید:`
      :
`🪙 Symbol: ${symbol}

⏱ Select analysis timeframe:`;

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:chatId,
      text,
      reply_markup:
        timeframeKeyboard(lang)
    }
  );
}

/* =========================================================
   CRYPTO TEXT
   ========================================================= */

function cryptoText(
  a,
  lang="en"
){

  const x=
    a.selectedAnalysis||{};

  const o=
    a.orderBook;

  const f=
    a.footprint;

  const tf=
    TF_NAMES[lang]||
    TF_NAMES.en;

  const safe=
    v=>
      Number.isFinite(
        Number(v)
      )
        ?Number(v)
        :0;

  const fixed=
    (v,d=4)=>
      safe(v).toFixed(d);

  const support=
    (
      x.supportResistance
        ?.supports||[]
    )
      .slice(0,5)
      .map(
        v=>fixed(v,8)
      )
      .join("\n")||"-";

  const resistance=
    (
      x.supportResistance
        ?.resistances||[]
    )
      .slice(0,5)
      .map(
        v=>fixed(v,8)
      )
      .join("\n")||"-";

  const multi=
    (a.analyses||[])
      .map(
        z=>
          `${tf[z.tf]||z.tf} | `+
          `${z.trend||"-"} | `+
          `RSI ${fixed(z.rsi,1)}`
      )
      .join("\n")||"-";

  if(lang==="fa"){

    return `
🪙 GLOBAL PULSE — رادار کریپتو

🔎 رمز ارز:
${a.symbol}

🏦 بازار:
${a.category==="linear"
  ?"Futures"
  :"Spot"}

⏱ تایم‌فریم:
${tf[a.requestedTimeframe]||a.requestedTimeframe}

━━━━━━━━━━━━━━━━

💰 قیمت:
${a.price}

━━━━━━━━━━━━━━━━

📊 تحلیل تکنیکال

روند:
${x.trend||"-"}

ساختار:
${x.structure||"-"}

RSI:
${fixed(x.rsi,2)}

MACD:
${fixed(x.macd,6)}

MACD Signal:
${fixed(x.macdSignal,6)}

MACD Histogram:
${fixed(x.macdHistogram,6)}

EMA20:
${fixed(x.ema20,8)}

EMA50:
${fixed(x.ema50,8)}

MA20:
${fixed(x.ma20,8)}

MA50:
${fixed(x.ma50,8)}

ATR:
${fixed(x.atr,8)}

Volume Ratio:
${fixed(x.volumeRatio,2)}

━━━━━━━━━━━━━━━━

🔀 واگرایی

نوع:
${x.divergence?.type||"NONE"}

قدرت:
${x.divergence?.strength||0}

━━━━━━━━━━━━━━━━

🧱 حمایت و مقاومت

حمایت:
${support}

مقاومت:
${resistance}

━━━━━━━━━━━━━━━━

🧮 اندیکاتورها

VWAP:
${fixed(x.vwap,8)}

Stochastic:
${fixed(x.stochastic,2)}

Momentum:
${fixed(x.momentum,2)}%

━━━━━━━━━━━━━━━━

🧲 ORDER BOOK

Buy:
${o?fixed(o.buy,2):"-"}

Sell:
${o?fixed(o.sell,2):"-"}

Buy Share:
${o?fixed(o.buyShare,2):"-"}%

Sell Share:
${o?fixed(o.sellShare,2):"-"}%

Pressure:
${o?.pressure||"N/A"}

Best Bid:
${o?fixed(o.bestBid,8):"-"}

Best Ask:
${o?fixed(o.bestAsk,8):"-"}

━━━━━━━━━━━━━━━━

👣 FOOTPRINT / DELTA

Buy Volume:
${fixed(f?.buyVolume,4)}

Sell Volume:
${fixed(f?.sellVolume,4)}

Buy Trades:
${f?.buyTrades??"-"}

Sell Trades:
${f?.sellTrades??"-"}

Delta:
${fixed(f?.delta,4)}

Delta %:
${fixed(f?.deltaPercent,2)}%

Pressure:
${f?.pressure||"N/A"}

━━━━━━━━━━━━━━━━

🌐 سایر تایم‌فریم‌ها

${multi}

━━━━━━━━━━━━━━━━

📡 Futures

${
  a.futures?.ticker
    ?
`Last Price:
${a.futures.ticker.lastPrice||"-"}

24H Change:
${
  a.futures.ticker.price24hPcnt
    ?
    (
      Number(
        a.futures.ticker.price24hPcnt
      )*100
    ).toFixed(2)+"%"
    :
    "-"
}

24H High:
${a.futures.ticker.highPrice24h||"-"}

24H Low:
${a.futures.ticker.lowPrice24h||"-"}

Open Interest:
${a.futures.oi?.openInterest||"-"}

Funding:
${a.futures.funding?.fundingRate||"-"}`
    :
`اطلاعات Futures در دسترس نیست.`
}

━━━━━━━━━━━━━━━━

⚠️ این اطلاعات تحلیل محاسباتی بازار است و توصیه مالی نیست.

🌐 GLOBAL PULSE
`.trim();
  }

  return `
🪙 GLOBAL PULSE — CRYPTO RADAR

🔎 Symbol:
${a.symbol}

🏦 Market:
${a.category==="linear"
  ?"Futures"
  :"Spot"}

⏱ Timeframe:
${tf[a.requestedTimeframe]||a.requestedTimeframe}

━━━━━━━━━━━━━━━━

💰 Price:
${a.price}

━━━━━━━━━━━━━━━━

📊 Technical Analysis

Trend:
${x.trend||"-"}

Structure:
${x.structure||"-"}

RSI:
${fixed(x.rsi,2)}

MACD:
${fixed(x.macd,6)}

MACD Signal:
${fixed(x.macdSignal,6)}

MACD Histogram:
${fixed(x.macdHistogram,6)}

EMA20:
${fixed(x.ema20,8)}

EMA50:
${fixed(x.ema50,8)}

MA20:
${fixed(x.ma20,8)}

MA50:
${fixed(x.ma50,8)}

ATR:
${fixed(x.atr,8)}

Volume Ratio:
${fixed(x.volumeRatio,2)}

━━━━━━━━━━━━━━━━

🔀 Divergence

Type:
${x.divergence?.type||"NONE"}

Strength:
${x.divergence?.strength||0}

━━━━━━━━━━━━━━━━

🧱 Support & Resistance

Support:
${support}

Resistance:
${resistance}

━━━━━━━━━━━━━━━━

🧮 Indicators

VWAP:
${fixed(x.vwap,8)}

Stochastic:
${fixed(x.stochastic,2)}

Momentum:
${fixed(x.momentum,2)}%

━━━━━━━━━━━━━━━━

🧲 ORDER BOOK

Buy:
${o?fixed(o.buy,2):"-"}

Sell:
${o?fixed(o.sell,2):"-"}

Buy Share:
${o?fixed(o.buyShare,2):"-"}%

Sell Share:
${o?fixed(o.sellShare,2):"-"}%

Pressure:
${o?.pressure||"N/A"}

Best Bid:
${o?fixed(o.bestBid,8):"-"}

Best Ask:
${o?fixed(o.bestAsk,8):"-"}

━━━━━━━━━━━━━━━━

👣 FOOTPRINT / DELTA

Buy Volume:
${fixed(f?.buyVolume,4)}

Sell Volume:
${fixed(f?.sellVolume,4)}

Buy Trades:
${f?.buyTrades??"-"}

Sell Trades:
${f?.sellTrades??"-"}

Delta:
${fixed(f?.delta,4)}

Delta %:
${fixed(f?.deltaPercent,2)}%

Pressure:
${f?.pressure||"N/A"}

━━━━━━━━━━━━━━━━

🌐 OTHER TIMEFRAMES

${multi}

━━━━━━━━━━━━━━━━

📡 FUTURES

${
  a.futures?.ticker
    ?
`Last Price:
${a.futures.ticker.lastPrice||"-"}

24H Change:
${
  a.futures.ticker.price24hPcnt
    ?
    (
      Number(
        a.futures.ticker.price24hPcnt
      )*100
    ).toFixed(2)+"%"
    :
    "-"
}

24H High:
${a.futures.ticker.highPrice24h||"-"}

24H Low:
${a.futures.ticker.lowPrice24h||"-"}

Open Interest:
${a.futures.oi?.openInterest||"-"}

Funding:
${a.futures.funding?.fundingRate||"-"}`
    :
`Futures data unavailable.`
}

━━━━━━━━━━━━━━━━

⚠️ Market analysis only. Not financial advice.

🌐 GLOBAL PULSE
`.trim();
}

/* =========================================================
   AUTOMATIC MESSAGES
   ========================================================= */

function newsMessage(
  items,
  lang="en"
){

  let s=
    lang==="fa"
      ?
`🌍 GLOBAL PULSE
📰 اخبار جهان

`
      :
`🌍 GLOBAL PULSE
📰 GLOBAL NEWS

`;

  if(!items.length){

    return s+
      (
        lang==="fa"
          ?
"No reliable global news available."
          :
"No reliable global news available."
      );
  }

  for(
    const x of
    items.slice(0,8)
  ){

    s+=
      `• ${x.title}\n`;

    if(x.link)
      s+=`${x.link}\n`;

    s+="\n";
  }

  s+=
    "━━━━━━━━━━━━━━━━\n"+
    "🌐 Global Pulse";

  return s;
}

function iranMessage(
  items,
  lang="en"
){

  let s=
    lang==="fa"
      ?
`🇮🇷 GLOBAL PULSE
📰 اخبار ایران

منابع: خبرگزاری‌های داخلی ایران

`
      :
`🇮🇷 GLOBAL PULSE
📰 IRAN NEWS

Sources: Iranian domestic news agencies

`;

  if(!items.length){

    return s+
      (
        lang==="fa"
          ?
"خبر جدیدی از منابع داخلی معتبر ایران در دسترس نیست."
          :
"No new news is available from selected Iranian domestic sources."
      );
  }

  for(
    const x of
    items.slice(0,8)
  ){

    s+=
      `• ${x.title}\n`;

    if(x.link)
      s+=`${x.link}\n`;

    s+=
      lang==="fa"
        ?
`منبع: ${x.source}

`
        :
`Source: ${x.source}

`;
  }

  s+=
    "━━━━━━━━━━━━━━━━\n"+
    "🌐 Global Pulse";

  return s;
}

function trendMessage(
  data,
  lang="en"
){

  let s=
    lang==="fa"
      ?
`🔥 رادار ترند کشورها

🌍 ${data.country}

`
      :
`🔥 COUNTRY TREND RADAR

🌍 ${data.country}

`;

  if(!data.trends.length){

    s+=
      lang==="fa"
        ?
"اطلاعات ترند در حال حاضر در دسترس نیست.\n"
        :
"No reliable trend data available right now.\n";

  }else{

    data.trends.forEach(
      (x,i)=>{
        s+=
          `${i+1}. ${x}\n`;
      }
    );
  }

  s+=
    "\n━━━━━━━━━━━━━━━━\n"+
    "🌐 Global Pulse";

  return s;
}

function shoppingMessage(
  items,
  lang="en"
){

  let s=
    lang==="fa"
      ?
`🛒 GLOBAL PULSE
🔥 رادار خرید

`
      :
`🛒 GLOBAL PULSE
🔥 SHOPPING RADAR

`;

  if(!items.length){

    s+=
      lang==="fa"
        ?
"اطلاعات خرید در دسترس نیست.\n"
        :
"No shopping information available.\n";

  }else{

    for(
      const x of
      items.slice(0,8)
    ){

      s+=
        `• ${x.title}\n`;

      if(x.link)
        s+=`${x.link}\n`;

      s+="\n";
    }
  }

  s+=
    "━━━━━━━━━━━━━━━━\n"+
    "🌐 Global Pulse";

  return s;
}

/* =========================================================
   AUTOMATIC PUBLISHING
   ========================================================= */

async function automaticPublish(
  env
){

  const langs=[
    "en",
    "fa"
  ];

  /* GLOBAL NEWS */

  try{

    const global=
      await fetchGlobalNews();

    for(
      const lang of langs
    ){

      try{

        await sendTelegram(
          env,
          newsMessage(
            global,
            lang
          )
        );

      }catch{}
    }

  }catch{}

  await sleep(500);

  /* IRAN */

  try{

    const iran=
      await fetchIranNews();

    for(
      const lang of langs
    ){

      try{

        await sendTelegram(
          env,
          iranMessage(
            iran,
            lang
          )
        );

      }catch{}
    }

  }catch{}

  await sleep(500);

  /* TREND */

  try{

    const country=
      COUNTRIES[
        Math.floor(
          Math.random()*
          COUNTRIES.length
        )
      ];

    const trend=
      await fetchCountryTrend(
        country
      );

    for(
      const lang of langs
    ){

      try{

        await sendTelegram(
          env,
          trendMessage(
            trend,
            lang
          )
        );

      }catch{}
    }

  }catch{}

  await sleep(500);

  /* SHOPPING */

  try{

    const shopping=
      await fetchShopping();

    for(
      const lang of langs
    ){

      try{

        await sendTelegram(
          env,
          shoppingMessage(
            shopping,
            lang
          )
        );

      }catch{}
    }

  }catch{}
}

/* =========================================================
   TELEGRAM INTERACTIVE RADAR
   ========================================================= */

async function handleTelegramUpdate(
  env,
  update
){

  /* =======================================================
     CALLBACK
     ======================================================= */

  if(update.callback_query){

    const q=
      update.callback_query;

    const chatId=
      q.message?.chat?.id;

    if(!chatId)
      return;

    /* LANGUAGE */

    if(
      q.data==="lang_fa"||
      q.data==="lang_en"
    ){

      const lang=
        q.data==="lang_fa"
          ?"fa"
          :"en";

      setLang(
        chatId,
        lang
      );

      await telegram(
        env,
        "answerCallbackQuery",
        {
          callback_query_id:q.id,
          text:
            lang==="fa"
              ?
              "زبان فارسی فعال شد"
              :
              "English selected"
        }
      );

      await telegram(
        env,
        "sendMessage",
        {
          chat_id:chatId,

          text:
            lang==="fa"
              ?
`🇮🇷 زبان فارسی فعال شد.

🪙 نام رمز ارز را ارسال کنید.

مثال:
BTC
BTCUSDT
PEPE
PEPEUSDT`
              :
`🇬🇧 English selected.

🪙 Send a crypto symbol.

Examples:
BTC
BTCUSDT
PEPE
PEPEUSDT`,

          reply_markup:
            {
              inline_keyboard:[
                [
                  {
                    text:
                      lang==="fa"
                        ?
                        "🌐 تغییر زبان"
                        :
                        "🌐 Change Language",
                    callback_data:
                      "open_language"
                  }
                ]
              ]
            }
        }
      );

      return;
    }

    /* OPEN LANGUAGE */

    if(
      q.data==="open_language"
    ){

      await telegram(
        env,
        "answerCallbackQuery",
        {
          callback_query_id:q.id
        }
      );

      await sendLanguageMenu(
        env,
        chatId
      );

      return;
    }

    /* TIMEFRAME */

    if(
      q.data?.startsWith("tf_")
    ){

      const tf=
        q.data
          .replace(
            "tf_",
            ""
          );

      if(
        !TF_LIST.includes(tf)
      ){

        await telegram(
          env,
          "answerCallbackQuery",
          {
            callback_query_id:q.id,
            text:
              "Invalid timeframe"
          }
        );

        return;
      }

      const symbol=
        getPendingSymbol(
          chatId
        );

      if(!symbol){

        await telegram(
          env,
          "answerCallbackQuery",
          {
            callback_query_id:q.id,
            text:
              "Symbol expired. Send it again."
          }
        );

        return;
      }

      const lang=
        getLang(chatId);

      await telegram(
        env,
        "answerCallbackQuery",
        {
          callback_query_id:q.id,
          text:
            lang==="fa"
              ?
              `تایم‌فریم ${TF_NAMES.fa[tf]} انتخاب شد`
              :
              `${TF_NAMES.en[tf]} selected`
        }
      );

      try{

        await telegram(
          env,
          "sendMessage",
          {
            chat_id:chatId,
            text:
              lang==="fa"
                ?
"⏳ در حال دریافت داده واقعی Bybit و محاسبه تحلیل..."
                :
"⏳ Fetching live Bybit data and calculating analysis..."
          }
        );

        const data=
          await deepAnalyze(
            symbol,
            tf
          );

        await telegram(
          env,
          "sendMessage",
          {
            chat_id:chatId,

            text:
              cryptoText(
                data,
                lang
              ),

            disable_web_page_preview:
              true
          }
        );

        clearPendingSymbol(
          chatId
        );

      }catch(e){

        await telegram(
          env,
          "sendMessage",
          {
            chat_id:chatId,

            text:
              lang==="fa"
                ?
`❌ خطا در تحلیل

${e.message}`
                :
`❌ Analysis error

${e.message}`
          }
        );
      }

      return;
    }

    return;
  }

  /* =======================================================
     MESSAGE
     ======================================================= */

  const message=
    update.message;

  if(!message)
    return;

  const chatId=
    message.chat?.id;

  const rawText=
    String(
      message.text||""
    ).trim();

  if(!chatId||!rawText)
    return;

  /* START / LANGUAGE */

  if(
    rawText==="/start"||
    rawText==="/language"
  ){

    await sendLanguageMenu(
      env,
      chatId
    );

    return;
  }

  const lang=
    getLang(chatId);

  /* HELP */

  if(
    rawText==="/help"
  ){

    await telegram(
      env,
      "sendMessage",
      {
        chat_id:chatId,

        text:
          lang==="fa"
            ?
`🪙 رادار کریپتو

نام رمز ارز را ارسال کنید.

مثال:

BTC
BTCUSDT
ETH
ETHUSDT
PEPE
PEPEUSDT

بعد از انتخاب ارز،
تایم‌فریم تحلیل را انتخاب می‌کنید.

تایم‌فریم‌ها:

1 دقیقه
3 دقیقه
5 دقیقه
15 دقیقه
30 دقیقه
1 ساعت
4 ساعت
روزانه

تحلیل شامل:

RSI
MACD
EMA
MA
ATR
Bollinger
VWAP
Stochastic
Momentum
واگرایی
حمایت
مقاومت
Order Book
Buy/Sell Walls
Footprint
Delta
Volume
Market Structure
Futures
Funding
Open Interest
Multi-Timeframe`
            :
`🪙 CRYPTO RADAR

Send a crypto symbol.

Examples:

BTC
BTCUSDT
ETH
ETHUSDT
PEPE
PEPEUSDT

After selecting the symbol,
you can select the analysis timeframe.

Timeframes:

1 Minute
3 Minutes
5 Minutes
15 Minutes
30 Minutes
1 Hour
4 Hours
Daily

Analysis includes:

RSI
MACD
EMA
MA
ATR
Bollinger
VWAP
Stochastic
Momentum
Divergence
Support
Resistance
Order Book
Buy/Sell Walls
Footprint
Delta
Volume
Market Structure
Futures
Funding
Open Interest
Multi-Timeframe`
      }
    );

    return;
  }

  /* =======================================================
     /crypto and /analyze
     ======================================================= */

  let cryptoInput=
    rawText;

  if(
    /^\/crypto(?:@[\w]+)?/i
      .test(rawText)
  ){

    cryptoInput=
      rawText.replace(
        /^\/crypto(?:@[\w]+)?/i,
        ""
      ).trim();

  }else if(
    /^\/analyze(?:@[\w]+)?/i
      .test(rawText)
  ){

    cryptoInput=
      rawText.replace(
        /^\/analyze(?:@[\w]+)?/i,
        ""
      ).trim();
  }

  const parts=
    cryptoInput.split(
      /\s+/
    );

  const possibleSymbol=
    parts[0]||"";

  const possibleTf=
    parts[1]||null;

  /* =======================================================
     CRYPTO
     ======================================================= */

  if(
    isCryptoSymbol(
      possibleSymbol
    )
  ){

    try{

      const symbol=
        await resolveCryptoSymbol(
          possibleSymbol
        );

      /* اگر تایم‌فریم داخل پیام بود */

      if(
        possibleTf&&
        TF_LIST.includes(
          possibleTf
        )
      ){

        await telegram(
          env,
          "sendMessage",
          {
            chat_id:chatId,

            text:
              lang==="fa"
                ?
"⏳ در حال دریافت داده واقعی Bybit و محاسبه تحلیل..."
                :
"⏳ Fetching live Bybit data and calculating analysis..."
          }
        );

        const data=
          await deepAnalyze(
            symbol,
            possibleTf
          );

        await telegram(
          env,
          "sendMessage",
          {
            chat_id:chatId,

            text:
              cryptoText(
                data,
                lang
              ),

            disable_web_page_preview:
              true
          }
        );

        return;
      }

      /*
         نماد پیدا شده:
         تایم‌فریم را انتخاب کن
      */

      setPendingSymbol(
        chatId,
        symbol
      );

      await telegram(
        env,
        "sendMessage",
        {
          chat_id:chatId,

          text:
            lang==="fa"
              ?
`✅ رمز ارز پیدا شد:

${symbol}

⏱ تایم‌فریم تحلیل را انتخاب کنید:`
              :
`✅ Symbol found:

${symbol}

⏱ Select the analysis timeframe:`,

          reply_markup:
            timeframeKeyboard(
              lang
            )
        }
      );

      return;

    }catch(e){

      await telegram(
        env,
        "sendMessage",
        {
          chat_id:chatId,

          text:
            lang==="fa"
              ?
`❌ رمز ارز پیدا نشد.

🔎 ورودی:
${possibleSymbol}

نمونه:
BTC
BTCUSDT
PEPE
PEPEUSDT`
              :
`❌ Cryptocurrency not found.

🔎 Input:
${possibleSymbol}

Examples:
BTC
BTCUSDT
PEPE
PEPEUSDT`
        }
      );

      return;
    }
  }

  /* =======================================================
     UNKNOWN
     ======================================================= */

  await telegram(
    env,
    "sendMessage",
    {
      chat_id:chatId,

      text:
        lang==="fa"
          ?
`❌ ورودی قابل تشخیص نیست.

نام رمز ارز را ارسال کنید.

مثال:
BTC
BTCUSDT
PEPE
PEPEUSDT

برای تغییر زبان:
 /language`
          :
`❌ Input not recognized.

Send a cryptocurrency symbol.

Examples:
BTC
BTCUSDT
PEPE
PEPEUSDT

To change language:
 /language`
    }
  );
}

/* =========================================================
   ROUTER
   ========================================================= */

export default {

  async fetch(
    request,
    env
  ){

    const url=
      new URL(
        request.url
      );

    const path=
      url.pathname;

    try{

      /* ROOT */

      if(path==="/"){

        return json({
          ok:true,
          project:
            "Global Pulse",
          version:
            VERSION,

          telegram:
            !!env.TELEGRAM_BOT_TOKEN,

          channel:
            !!env.TELEGRAM_CHANNEL_ID,

          bybit:true,

          cryptoAnalyzer:true,

          automaticPublishing:
            true,

          interactiveTelegramRadar:
            true,

          languages:[
            "fa",
            "en"
          ],

          iranNewsSources:
            [
              "IRNA",
              "ISNA",
              "Mehr",
              "Tasnim"
            ],

          cryptoTimeframes:
            TF_LIST,

          time:
            new Date().toISOString()
        });
      }

      /* HEALTH */

      if(path==="/health"){

        let channel=false;

        try{

          if(
            env.TELEGRAM_CHANNEL_ID
          ){

            const r=
              await telegram(
                env,
                "getChat",
                {
                  chat_id:
                    env.TELEGRAM_CHANNEL_ID
                }
              );

            channel=
              !!r.ok;
          }

        }catch{}

        return json({
          ok:true,
          project:
            "Global Pulse",
          version:
            VERSION,

          telegram:
            !!env.TELEGRAM_BOT_TOKEN,

          channel,

          bybit:true,

          cryptoAnalyzer:true,

          automaticPublishing:
            true,

          interactiveTelegramRadar:
            true,

          languages:[
            "fa",
            "en"
          ],

          iranNewsOnly:
            true,

          iranNewsSources:
            [
              "IRNA",
              "ISNA",
              "Mehr",
              "Tasnim"
            ],

          cryptoTimeframes:
            TF_LIST,

          time:
            new Date().toISOString()
        });
      }

      /* SETUP WEBHOOK */

      if(
        path==="/setup-webhook"
      ){

        const webhook=
          `${url.origin}/telegram/webhook`;

        const result=
          await telegram(
            env,
            "setWebhook",
            {
              url:webhook
            }
          );

        return json({
          ok:true,
          webhook,
          telegram:result
        });
      }

      /* TELEGRAM WEBHOOK */

      if(
        path===
          "/telegram/webhook" &&
        request.method==="POST"
      ){

        const update=
          await request.json();

        await handleTelegramUpdate(
          env,
          update
        );

        return json({
          ok:true,
          received:true,
          update_id:
            update.update_id??null
        });
      }

      /* LANGUAGE TEST */

      if(
        path==="/test-language"
      ){

        const chatId=
          url.searchParams.get(
            "chat_id"
          );

        if(!chatId){

          return json({
            ok:false,
            error:
              "chat_id is required"
          },400);
        }

        await sendLanguageMenu(
          env,
          chatId
        );

        return json({
          ok:true,
          languageMenu:true
        });
      }

      /* NEWS */

      if(
        path==="/test-news"
      ){

        const items=
          await fetchGlobalNews();

        await sendTelegram(
          env,
          newsMessage(
            items,
            "en"
          )
        );

        return json({
          ok:true,
          type:"news",
          count:
            items.length
        });
      }

      /* IRAN NEWS */

      if(
        path==="/test-iran"
      ){

        const items=
          await fetchIranNews();

        await sendTelegram(
          env,
          iranMessage(
            items,
            "fa"
          )
        );

        return json({
          ok:true,
          type:"iran-news",

          count:
            items.length,

          iranOnly:true,

          sources:
            [
              "IRNA",
              "ISNA",
              "Mehr",
              "Tasnim"
            ]
        });
      }

      /* TREND */

      if(
        path==="/test-trend"
      ){

        const data=
          await fetchCountryTrend(
            COUNTRIES[0]
          );

        await sendTelegram(
          env,
          trendMessage(
            data,
            "en"
          )
        );

        return json({
          ok:true,
          type:"trend",
          country:
            data.country,
          count:
            data.trends.length
        });
      }

      /* SHOPPING */

      if(
        path==="/test-shopping"
      ){

        const items=
          await fetchShopping();

        await sendTelegram(
          env,
          shoppingMessage(
            items,
            "en"
          )
        );

        return json({
          ok:true,
          type:"shopping",
          count:
            items.length
        });
      }

      /* CRYPTO ANALYSIS */

      if(
        path==="/analyze"
      ){

        const symbol=
          cleanSymbol(
            url.searchParams.get(
              "symbol"
            )
          );

        const timeframe=
          url.searchParams.get(
            "timeframe"
          )||
          "15";

        if(!symbol){

          return json({
            ok:false,
            error:
              "symbol is required"
          },400);
        }

        const data=
          await deepAnalyze(
            symbol,
            timeframe
          );

        return json({
          ok:true,
          version:
            VERSION,
          data
        });
      }

      /* TELEGRAM CRYPTO TEST */

      if(
        path==="/test-crypto"
      ){

        const rawSymbol=
          url.searchParams.get(
            "symbol"
          )||
          "BTCUSDT";

        const symbol=
          await resolveCryptoSymbol(
            rawSymbol
          );

        const timeframe=
          url.searchParams.get(
            "timeframe"
          )||
          "15";

        const data=
          await deepAnalyze(
            symbol,
            timeframe
          );

        await sendTelegram(
          env,
          cryptoText(
            data,
            "en"
          )
        );

        return json({
          ok:true,
          type:"crypto",
          symbol,
          timeframe
        });
      }

      /* FULL PUBLISH */

      if(
        path==="/publish"
      ){

        await automaticPublish(
          env
        );

        return json({
          ok:true,
          version:
            VERSION,

          published:{
            global:true,
            iran:true,
            trend:true,
            shopping:true
          },

          iranSourcesOnly:true,

          languages:[
            "en",
            "fa"
          ]
        });
      }

      return json({
        ok:false,
        version:
          VERSION,
        error:
          "Not Found",
        path
      },404);

    }catch(e){

      return json({
        ok:false,
        version:
          VERSION,
        error:
          e.message||
          String(e)
      },500);
    }
  },

  async scheduled(
    event,
    env,
    ctx
  ){

    ctx.waitUntil(
      automaticPublish(
        env
      )
    );
  }
};
