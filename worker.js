/* =========================================================
   GLOBAL PULSE V5
   ---------------------------------------------------------
   Global News + Country Trends + Shopping + Telegram
   + SINGLE-COIN DEEP CRYPTO ANALYZER

   IMPORTANT:
   - NO market scanner
   - NO scan batch
   - NO score / strictness
   - User sends ONE symbol
   - Worker automatically detects Spot / Linear
   - Analysis is performed on the SELECTED timeframe
   - Multi-analysis is calculated only for that timeframe
   - Frontend can refresh the same symbol continuously
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V5";
const BYBIT = "https://api.bybit.com";

const TF_LIST = [
  "1","3","5","15","30","60","120","240","360","720","D","W","M"
];

const COUNTRIES = [
  { code:"US", name:"United States" },
  { code:"GB", name:"United Kingdom" },
  { code:"DE", name:"Germany" },
  { code:"FR", name:"France" },
  { code:"JP", name:"Japan" },
  { code:"KR", name:"South Korea" },
  { code:"AE", name:"United Arab Emirates" },
  { code:"TR", name:"Turkey" },
  { code:"IN", name:"India" },
  { code:"BR", name:"Brazil" },
  { code:"CA", name:"Canada" },
  { code:"AU", name:"Australia" },
  { code:"SG", name:"Singapore" },
  { code:"CH", name:"Switzerland" }
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
   RESPONSE
   ========================================================= */

function json(data, status=200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers:{
      "content-type":"application/json; charset=UTF-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*",
      "access-control-allow-methods":"GET,POST,OPTIONS",
      "access-control-allow-headers":"Content-Type"
    }
  });
}

function text(data,status=200) {
  return new Response(data,{
    status,
    headers:{
      "content-type":"text/plain; charset=UTF-8",
      "access-control-allow-origin":"*"
    }
  });
}

/* =========================================================
   HELPERS
   ========================================================= */

function cleanSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g,"");
}

function num(v,fallback=0) {
  const n=Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function avg(a) {
  if(!a || !a.length) return 0;
  return a.reduce((x,y)=>x+y,0)/a.length;
}

function median(a) {
  if(!a || !a.length) return 0;
  const b=[...a].sort((x,y)=>x-y);
  const m=Math.floor(b.length/2);
  return b.length%2 ? b[m] : (b[m-1]+b[m])/2;
}

function sum(a) {
  return (a||[]).reduce((x,y)=>x+y,0);
}

function pct(a,b) {
  if(!b) return 0;
  return ((a-b)/b)*100;
}

function round(v,d=4) {
  const n=Number(v);
  if(!Number.isFinite(n)) return null;
  return Number(n.toFixed(d));
}

/* =========================================================
   BYBIT
   ========================================================= */

async function bybit(path) {

  const r=await fetch(BYBIT+path,{
    headers:{
      "user-agent":"Global-Pulse/5.0"
    }
  });

  if(!r.ok) {
    throw new Error(`Bybit HTTP ${r.status}`);
  }

  const j=await r.json();

  if(j.retCode!==0) {
    throw new Error(j.retMsg || "Bybit API error");
  }

  return j.result;
}

/* =========================================================
   KLINES
   ========================================================= */

function parseKlines(rows) {

  return (rows||[])
    .map(x=>({
      time:num(x[0]),
      open:num(x[1]),
      high:num(x[2]),
      low:num(x[3]),
      close:num(x[4]),
      volume:num(x[5]),
      turnover:num(x[6])
    }))
    .sort((a,b)=>a.time-b.time);
}

async function getKlines(category,symbol,interval,limit=500) {

  const q=
    `/v5/market/kline`+
    `?category=${encodeURIComponent(category)}`+
    `&symbol=${encodeURIComponent(symbol)}`+
    `&interval=${encodeURIComponent(interval)}`+
    `&limit=${limit}`;

  const r=await bybit(q);

  return parseKlines(r.list||[]);
}

/* =========================================================
   MARKET DETECTION
   ========================================================= */

async function findMarket(symbol) {

  const s=cleanSymbol(symbol);

  try {
    const r=await bybit(
      `/v5/market/instruments-info?category=linear&symbol=${s}`
    );

    if(r.list?.length) {
      return {
        category:"linear",
        symbol:s,
        market:"Futures"
      };
    }
  } catch {}

  try {
    const r=await bybit(
      `/v5/market/instruments-info?category=spot&symbol=${s}`
    );

    if(r.list?.length) {
      return {
        category:"spot",
        symbol:s,
        market:"Spot"
      };
    }
  } catch {}

  return null;
}

/* =========================================================
   SMA / EMA
   ========================================================= */

function sma(values,period) {

  if(!values || values.length<period) return null;

  return avg(values.slice(-period));
}

function ema(values,period) {

  if(!values || values.length<period) return null;

  const k=2/(period+1);

  let e=avg(values.slice(0,period));

  for(let i=period;i<values.length;i++) {
    e=values[i]*k+e*(1-k);
  }

  return e;
}

/* =========================================================
   STANDARD DEVIATION
   ========================================================= */

function stddev(values,period) {

  if(values.length<period) return null;

  const a=values.slice(-period);
  const m=avg(a);

  return Math.sqrt(
    avg(a.map(v=>Math.pow(v-m,2)))
  );
}

/* =========================================================
   RSI
   ========================================================= */

function rsi(values,period=14) {

  if(values.length<period+1) return null;

  let gain=0;
  let loss=0;

  for(let i=1;i<=period;i++) {

    const d=values[i]-values[i-1];

    if(d>=0) gain+=d;
    else loss-=d;
  }

  let avgGain=gain/period;
  let avgLoss=loss/period;

  for(let i=period+1;i<values.length;i++) {

    const d=values[i]-values[i-1];

    const g=Math.max(d,0);
    const l=Math.max(-d,0);

    avgGain=((avgGain*(period-1))+g)/period;
    avgLoss=((avgLoss*(period-1))+l)/period;
  }

  if(avgLoss===0) return 100;

  const rs=avgGain/avgLoss;

  return 100-(100/(1+rs));
}

/* =========================================================
   MACD
   ========================================================= */

function macd(values) {

  if(values.length<40) return null;

  const lineSeries=[];

  for(let i=0;i<values.length;i++) {

    const f=ema(values.slice(0,i+1),12);
    const s=ema(values.slice(0,i+1),26);

    if(f!=null && s!=null) {
      lineSeries.push(f-s);
    }
  }

  if(lineSeries.length<9) return null;

  const line=lineSeries[lineSeries.length-1];
  const signal=ema(lineSeries,9);

  return {
    line,
    signal,
    histogram:signal==null?null:line-signal
  };
}

/* =========================================================
   ATR
   ========================================================= */

function atr(candles,period=14) {

  if(candles.length<period+1) return null;

  const trs=[];

  for(let i=1;i<candles.length;i++) {

    const c=candles[i];
    const p=candles[i-1];

    trs.push(
      Math.max(
        c.high-c.low,
        Math.abs(c.high-p.close),
        Math.abs(c.low-p.close)
      )
    );
  }

  return avg(trs.slice(-period));
}

/* =========================================================
   BOLLINGER
   ========================================================= */

function bollinger(values,period=20,mult=2) {

  if(values.length<period) return null;

  const middle=sma(values,period);
  const sd=stddev(values,period);

  if(middle==null || sd==null) return null;

  return {
    middle,
    upper:middle+mult*sd,
    lower:middle-mult*sd,
    width:middle
      ? ((mult*2*sd)/middle)*100
      : 0
  };
}

/* =========================================================
   STOCHASTIC
   ========================================================= */

function stochastic(candles,period=14,smooth=3) {

  if(candles.length<period+smooth) return null;

  const values=[];

  for(
    let i=period-1;
    i<candles.length;
    i++
  ) {

    const section=
      candles.slice(i-period+1,i+1);

    const high=
      Math.max(...section.map(x=>x.high));

    const low=
      Math.min(...section.map(x=>x.low));

    const close=
      candles[i].close;

    const k=
      high===low
        ? 50
        : ((close-low)/(high-low))*100;

    values.push(k);
  }

  const k=values[values.length-1];
  const d=sma(values,smooth);

  return {k,d};
}

/* =========================================================
   ADX
   ========================================================= */

function adx(candles,period=14) {

  if(candles.length<period*2+5) return null;

  const tr=[];
  const plus=[];
  const minus=[];

  for(let i=1;i<candles.length;i++) {

    const c=candles[i];
    const p=candles[i-1];

    const up=c.high-p.high;
    const down=p.low-c.low;

    tr.push(
      Math.max(
        c.high-c.low,
        Math.abs(c.high-p.close),
        Math.abs(c.low-p.close)
      )
    );

    plus.push(
      up>down && up>0 ? up : 0
    );

    minus.push(
      down>up && down>0 ? down : 0
    );
  }

  const atrV=avg(tr.slice(-period));

  if(!atrV) return null;

  const pdi=
    avg(plus.slice(-period))/atrV*100;

  const mdi=
    avg(minus.slice(-period))/atrV*100;

  const dx=
    (pdi+mdi)
      ? Math.abs(pdi-mdi)/(pdi+mdi)*100
      : 0;

  return {
    adx:dx,
    plusDI:pdi,
    minusDI:mdi
  };
}

/* =========================================================
   ICHIMOKU
   ========================================================= */

function ichimoku(candles) {

  if(candles.length<52) return null;

  const highest=(n,end=candles.length)=>{
    const a=candles.slice(
      Math.max(0,end-n),
      end
    );
    return Math.max(...a.map(x=>x.high));
  };

  const lowest=(n,end=candles.length)=>{
    const a=candles.slice(
      Math.max(0,end-n),
      end
    );
    return Math.min(...a.map(x=>x.low));
  };

  const tenkan=
    (
      highest(9)+
      lowest(9)
    )/2;

  const kijun=
    (
      highest(26)+
      lowest(26)
    )/2;

  const spanA=(tenkan+kijun)/2;

  const spanB=
    (
      highest(52)+
      lowest(52)
    )/2;

  const price=candles[candles.length-1].close;

  let position="INSIDE_CLOUD";

  if(price>Math.max(spanA,spanB))
    position="ABOVE_CLOUD";

  if(price<Math.min(spanA,spanB))
    position="BELOW_CLOUD";

  return {
    tenkan,
    kijun,
    spanA,
    spanB,
    cloudTop:Math.max(spanA,spanB),
    cloudBottom:Math.min(spanA,spanB),
    position
  };
}

/* =========================================================
   VWAP
   ========================================================= */

function vwap(candles) {

  if(!candles.length) return null;

  let pv=0;
  let vol=0;

  for(const c of candles) {

    const typical=
      (c.high+c.low+c.close)/3;

    pv+=typical*c.volume;
    vol+=c.volume;
  }

  return vol ? pv/vol : null;
}

/* =========================================================
   MARKET STRUCTURE
   ========================================================= */

function pivots(candles,left=2,right=2) {

  const highs=[];
  const lows=[];

  for(
    let i=left;
    i<candles.length-right;
    i++
  ) {

    let high=true;
    let low=true;

    for(let j=1;j<=left;j++) {

      if(candles[i].high<=candles[i-j].high)
        high=false;

      if(candles[i].low>=candles[i-j].low)
        low=false;
    }

    for(let j=1;j<=right;j++) {

      if(candles[i].high<=candles[i+j].high)
        high=false;

      if(candles[i].low>=candles[i+j].low)
        low=false;
    }

    if(high) {
      highs.push({
        index:i,
        price:candles[i].high,
        time:candles[i].time
      });
    }

    if(low) {
      lows.push({
        index:i,
        price:candles[i].low,
        time:candles[i].time
      });
    }
  }

  return {
    highs,
    lows
  };
}

function marketStructure(candles) {

  const p=pivots(candles,2,2);

  const highs=p.highs.slice(-6);
  const lows=p.lows.slice(-6);

  let structure="RANGE";
  let bos=null;
  let choch=null;

  if(highs.length>=2 && lows.length>=2) {

    const h1=highs[highs.length-2].price;
    const h2=highs[highs.length-1].price;

    const l1=lows[lows.length-2].price;
    const l2=lows[lows.length-1].price;

    if(h2>h1 && l2>l1)
      structure="BULLISH";

    if(h2<h1 && l2<l1)
      structure="BEARISH";
  }

  const price=
    candles[candles.length-1].close;

  const lastHigh=
    highs[highs.length-1]?.price;

  const lastLow=
    lows[lows.length-1]?.price;

  if(lastHigh && price>lastHigh) {
    bos="BULLISH_BOS";
    choch=
      structure==="BEARISH"
        ? "BULLISH_CHOCH"
        : null;
  }

  if(lastLow && price<lastLow) {
    bos="BEARISH_BOS";
    choch=
      structure==="BULLISH"
        ? "BEARISH_CHOCH"
        : null;
  }

  return {
    structure,
    bos,
    choch,
    swingHighs:highs,
    swingLows:lows
  };
}

/* =========================================================
   SUPPORT / RESISTANCE
   ========================================================= */

function supportResistance(candles) {

  const p=pivots(candles,3,3);

  const price=
    candles[candles.length-1].close;

  const tolerance=
    price*0.003;

  const raw=[
    ...p.highs.map(x=>({
      price:x.price,
      type:"resistance",
      time:x.time
    })),
    ...p.lows.map(x=>({
      price:x.price,
      type:"support",
      time:x.time
    }))
  ];

  raw.sort((a,b)=>a.price-b.price);

  const clusters=[];

  for(const x of raw) {

    const existing=
      clusters.find(
        c=>Math.abs(c.price-x.price)<=tolerance
      );

    if(existing) {

      existing.prices.push(x.price);
      existing.count++;

      existing.price=
        avg(existing.prices);

    } else {

      clusters.push({
        price:x.price,
        type:x.type,
        prices:[x.price],
        count:1
      });
    }
  }

  const supports=
    clusters
      .filter(x=>x.price<price)
      .sort((a,b)=>b.price-a.price)
      .slice(0,8);

  const resistances=
    clusters
      .filter(x=>x.price>price)
      .sort((a,b)=>a.price-b.price)
      .slice(0,8);

  return {
    supports,
    resistances
  };
}

/* =========================================================
   FVG
   ========================================================= */

function fairValueGaps(candles) {

  const bullish=[];
  const bearish=[];

  for(let i=2;i<candles.length;i++) {

    const a=candles[i-2];
    const b=candles[i-1];
    const c=candles[i];

    if(c.low>a.high) {

      bullish.push({
        from:a.high,
        to:c.low,
        middle:(a.high+c.low)/2,
        time:b.time
      });
    }

    if(c.high<a.low) {

      bearish.push({
        from:c.high,
        to:a.low,
        middle:(c.high+a.low)/2,
        time:b.time
      });
    }
  }

  return {
    bullish:bullish.slice(-10),
    bearish:bearish.slice(-10)
  };
}

/* =========================================================
   ORDER BLOCK
   ========================================================= */

function orderBlocks(candles) {

  const bullish=[];
  const bearish=[];

  for(let i=2;i<candles.length-1;i++) {

    const prev=candles[i-1];
    const cur=candles[i];
    const next=candles[i+1];

    const body=Math.abs(cur.close-cur.open);

    const avgBody=
      avg(
        candles
          .slice(Math.max(0,i-10),i)
          .map(x=>Math.abs(x.close-x.open))
      );

    if(
      prev.close<prev.open &&
      cur.close>cur.open &&
      body>avgBody*1.3 &&
      next.high>cur.high
    ) {

      bullish.push({
        high:prev.high,
        low:prev.low,
        time:prev.time
      });
    }

    if(
      prev.close>prev.open &&
      cur.close<cur.open &&
      body>avgBody*1.3 &&
      next.low<cur.low
    ) {

      bearish.push({
        high:prev.high,
        low:prev.low,
        time:prev.time
      });
    }
  }

  return {
    bullish:bullish.slice(-8),
    bearish:bearish.slice(-8)
  };
}

/* =========================================================
   LIQUIDITY LEVELS
   ========================================================= */

function liquidityLevels(candles) {

  const p=pivots(candles,3,3);

  const highs=
    p.highs
      .slice(-12)
      .map(x=>x.price);

  const lows=
    p.lows
      .slice(-12)
      .map(x=>x.price);

  const highClusters=[];
  const lowClusters=[];

  const cluster=(arr,target)=>{

    const found=
      arr.find(
        x=>Math.abs(x.price-target)<=target*0.0015
      );

    if(found) {
      found.values.push(target);
      found.price=avg(found.values);
      found.count++;
    } else {
      arr.push({
        price:target,
        values:[target],
        count:1
      });
    }
  };

  for(const x of highs)
    cluster(highClusters,x);

  for(const x of lows)
    cluster(lowClusters,x);

  return {
    buySideLiquidity:
      highClusters
        .filter(x=>x.count>=1)
        .sort((a,b)=>b.price-a.price)
        .slice(0,8),

    sellSideLiquidity:
      lowClusters
        .filter(x=>x.count>=1)
        .sort((a,b)=>b.price-a.price)
        .slice(0,8)
  };
}

/* =========================================================
   HUNT / SWEEP
   ========================================================= */

function liquiditySweeps(candles) {

  if(candles.length<10) {
    return {
      bullish:[],
      bearish:[]
    };
  }

  const bullish=[];
  const bearish=[];

  for(let i=3;i<candles.length;i++) {

    const c=candles[i];

    const previous=
      candles.slice(Math.max(0,i-10),i);

    const prevHigh=
      Math.max(...previous.map(x=>x.high));

    const prevLow=
      Math.min(...previous.map(x=>x.low));

    if(
      c.low<prevLow &&
      c.close>prevLow
    ) {

      bullish.push({
        time:c.time,
        price:c.low,
        type:"SELL_SIDE_SWEEP"
      });
    }

    if(
      c.high>prevHigh &&
      c.close<prevHigh
    ) {

      bearish.push({
        time:c.time,
        price:c.high,
        type:"BUY_SIDE_SWEEP"
      });
    }
  }

  return {
    bullish:bullish.slice(-10),
    bearish:bearish.slice(-10)
  };
}

/* =========================================================
   DIVERGENCE
   ========================================================= */

function detectDivergence(candles) {

  const closes=candles.map(x=>x.close);

  const rsiValues=[];

  for(let i=0;i<closes.length;i++) {

    const value=
      rsi(closes.slice(0,i+1),14);

    rsiValues.push(value);
  }

  const p=pivots(candles,3,3);

  const bullish=[];
  const bearish=[];

  const lows=p.lows.slice(-8);
  const highs=p.highs.slice(-8);

  for(let i=1;i<lows.length;i++) {

    const a=lows[i-1];
    const b=lows[i];

    const r1=rsiValues[a.index];
    const r2=rsiValues[b.index];

    if(
      r1!=null &&
      r2!=null &&
      b.price<a.price &&
      r2>r1
    ) {

      bullish.push({
        price1:a.price,
        price2:b.price,
        rsi1:r1,
        rsi2:r2,
        time:b.time,
        type:"BULLISH_RSI_DIVERGENCE"
      });
    }
  }

  for(let i=1;i<highs.length;i++) {

    const a=highs[i-1];
    const b=highs[i];

    const r1=rsiValues[a.index];
    const r2=rsiValues[b.index];

    if(
      r1!=null &&
      r2!=null &&
      b.price>a.price &&
      r2<r1
    ) {

      bearish.push({
        price1:a.price,
        price2:b.price,
        rsi1:r1,
        rsi2:r2,
        time:b.time,
        type:"BEARISH_RSI_DIVERGENCE"
      });
    }
  }

  return {
    bullish:bullish.slice(-5),
    bearish:bearish.slice(-5)
  };
}

/* =========================================================
   VOLUME ANALYSIS
   ========================================================= */

function volumeAnalysis(candles) {

  if(candles.length<21) return null;

  const current=
    candles[candles.length-1].volume;

  const average=
    avg(
      candles
        .slice(-21,-1)
        .map(x=>x.volume)
    );

  const ratio=
    average ? current/average : 0;

  let state="NORMAL";

  if(ratio>=2)
    state="VERY_HIGH";

  else if(ratio>=1.4)
    state="HIGH";

  else if(ratio<=0.6)
    state="LOW";

  return {
    current,
    average,
    ratio,
    state
  };
}

/* =========================================================
   CANDLE ANALYSIS
   ========================================================= */

function candleAnalysis(candles) {

  const c=candles[candles.length-1];

  const range=c.high-c.low;

  const body=Math.abs(c.close-c.open);

  const upper=
    c.high-Math.max(c.open,c.close);

  const lower=
    Math.min(c.open,c.close)-c.low;

  let pattern="NORMAL";

  if(range>0) {

    if(
      body/range<0.1 &&
      upper/range<0.45 &&
      lower/range<0.45
    ) {
      pattern="DOJI";
    }

    if(
      lower>body*2 &&
      lower>upper*1.3
    ) {
      pattern="HAMMER_LIKE";
    }

    if(
      upper>body*2 &&
      upper>lower*1.3
    ) {
      pattern="SHOOTING_STAR_LIKE";
    }
  }

  return {
    open:c.open,
    high:c.high,
    low:c.low,
    close:c.close,
    body,
    range,
    upperWick:upper,
    lowerWick:lower,
    direction:
      c.close>c.open
        ? "BULLISH"
        : c.close<c.open
          ? "BEARISH"
          : "NEUTRAL",
    pattern
  };
}

/* =========================================================
   ORDER BOOK
   ========================================================= */

async function orderBook(category,symbol) {

  const r=await bybit(
    `/v5/market/orderbook`+
    `?category=${category}`+
    `&symbol=${symbol}`+
    `&limit=200`
  );

  const bids=
    (r.b||[]).map(x=>[
      num(x[0]),
      num(x[1])
    ]);

  const asks=
    (r.a||[]).map(x=>[
      num(x[0]),
      num(x[1])
    ]);

  const buy=
    sum(
      bids.map(x=>x[0]*x[1])
    );

  const sell=
    sum(
      asks.map(x=>x[0]*x[1])
    );

  const total=buy+sell;

  const buyShare=
    total ? buy/total*100 : 50;

  const sellShare=
    total ? sell/total*100 : 50;

  let pressure="NEUTRAL";

  if(buyShare>sellShare+8)
    pressure="BUY_PRESSURE";

  if(sellShare>buyShare+8)
    pressure="SELL_PRESSURE";

  const bidMedian=
    median(bids.map(x=>x[1]));

  const askMedian=
    median(asks.map(x=>x[1]));

  const buyWalls=
    bids
      .filter(x=>x[1]>=bidMedian*4)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,15)
      .map(x=>({
        price:x[0],
        quantity:x[1],
        notional:x[0]*x[1]
      }));

  const sellWalls=
    asks
      .filter(x=>x[1]>=askMedian*4)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,15)
      .map(x=>({
        price:x[0],
        quantity:x[1],
        notional:x[0]*x[1]
      }));

  return {
    bids:bids.slice(0,50),
    asks:asks.slice(0,50),

    buy,
    sell,

    buyShare,
    sellShare,

    pressure,

    bestBid:bids[0]?.[0] ?? null,
    bestAsk:asks[0]?.[0] ?? null,

    spread:
      bids[0]&&asks[0]
        ? asks[0][0]-bids[0][0]
        : null,

    buyWalls,
    sellWalls
  };
}

/* =========================================================
   FOOTPRINT
   ========================================================= */

async function footprint(category,symbol) {

  const r=await bybit(
    `/v5/market/recent-trade`+
    `?category=${category}`+
    `&symbol=${symbol}`+
    `&limit=1000`
  );

  const trades=r.list||[];

  let buyVolume=0;
  let sellVolume=0;

  let buyNotional=0;
  let sellNotional=0;

  let buyTrades=0;
  let sellTrades=0;

  const notionals=[];

  for(const t of trades) {

    const size=num(t.size);
    const price=num(t.price);

    const n=size*price;

    notionals.push(n);

    const side=
      String(t.side||"").toLowerCase();

    if(side==="buy") {

      buyVolume+=size;
      buyNotional+=n;
      buyTrades++;
    }

    if(side==="sell") {

      sellVolume+=size;
      sellNotional+=n;
      sellTrades++;
    }
  }

  const total=
    buyNotional+sellNotional;

  const delta=
    buyNotional-sellNotional;

  const deltaPercent=
    total ? delta/total*100 : 0;

  const avgNotional=
    avg(notionals);

  const p95=
    notionals.length
      ? [...notionals].sort((a,b)=>a-b)[
          Math.floor(notionals.length*0.95)
        ]
      : 0;

  const largeThreshold=
    Math.max(
      avgNotional*5,
      p95
    );

  let largeBuy=0;
  let largeSell=0;

  for(const t of trades) {

    const size=num(t.size);
    const price=num(t.price);
    const n=size*price;

    if(n<largeThreshold) continue;

    if(String(t.side).toLowerCase()==="buy")
      largeBuy+=n;

    if(String(t.side).toLowerCase()==="sell")
      largeSell+=n;
  }

  let pressure="NEUTRAL";

  if(deltaPercent>=10)
    pressure="BUY_PRESSURE";

  if(deltaPercent<=-10)
    pressure="SELL_PRESSURE";

  return {

    tradeCount:trades.length,

    buyVolume,
    sellVolume,

    buyNotional,
    sellNotional,

    buyTrades,
    sellTrades,

    delta,
    deltaPercent,

    pressure,

    averageTradeNotional:avgNotional,

    largeTradeThreshold:largeThreshold,

    largeBuyNotional:largeBuy,
    largeSellNotional:largeSell,

    largeTradePressure:
      largeBuy>largeSell*1.2
        ? "LARGE_BUY_PRESSURE"
        : largeSell>largeBuy*1.2
          ? "LARGE_SELL_PRESSURE"
          : "NEUTRAL"
  };
}

/* =========================================================
   FUTURES DATA
   ========================================================= */

async function futuresData(symbol) {

  const result={
    ticker:null,
    openInterest:null,
    funding:null,
    accountRatio:null
  };

  try {

    const r=await bybit(
      `/v5/market/tickers`+
      `?category=linear`+
      `&symbol=${symbol}`
    );

    result.ticker=r.list?.[0]||null;

  } catch {}

  try {

    const r=await bybit(
      `/v5/market/open-interest`+
      `?category=linear`+
      `&symbol=${symbol}`+
      `&intervalTime=5min`+
      `&limit=20`
    );

    result.openInterest=r.list||[];

  } catch {}

  try {

    const r=await bybit(
      `/v5/market/funding/history`+
      `?category=linear`+
      `&symbol=${symbol}`+
      `&limit=20`
    );

    result.funding=r.list||[];

  } catch {}

  try {

    const r=await bybit(
      `/v5/market/account-ratio`+
      `?category=linear`+
      `&symbol=${symbol}`+
      `&period=5min`+
      `&limit=20`
    );

    result.accountRatio=r.list||[];

  } catch {}

  return result;
}

/* =========================================================
   TRADING STYLE ANALYSIS
   ========================================================= */

function tradingStyles(data) {

  const x=data.indicators;
  const ms=data.marketStructure;
  const price=data.price;

  const styles=[];

  /* SCALPING */

  let scalp="NEUTRAL";

  if(
    x.rsi!=null &&
    x.macd &&
    x.ema20!=null &&
    x.ema50!=null
  ) {

    if(
      price>x.ema20 &&
      x.ema20>x.ema50 &&
      x.rsi>55 &&
      x.macd.line>x.macd.signal
    )
      scalp="BULLISH";

    if(
      price<x.ema20 &&
      x.ema20<x.ema50 &&
      x.rsi<45 &&
      x.macd.line<x.macd.signal
    )
      scalp="BEARISH";
  }

  styles.push({
    name:"Scalping",
    bias:scalp,
    basis:[
      "EMA20/EMA50",
      "RSI",
      "MACD",
      "Price structure"
    ]
  });

  /* INTRADAY */

  let intraday="NEUTRAL";

  if(ms.structure==="BULLISH")
    intraday="BULLISH";

  if(ms.structure==="BEARISH")
    intraday="BEARISH";

  styles.push({
    name:"Intraday",
    bias:intraday,
    basis:[
      "Market Structure",
      "VWAP",
      "Volume",
      "Support/Resistance"
    ]
  });

  /* TREND FOLLOWING */

  let trend="NEUTRAL";

  if(
    x.ema20 &&
    x.ema50 &&
    x.ema20>x.ema50
  )
    trend="BULLISH";

  if(
    x.ema20 &&
    x.ema50 &&
    x.ema20<x.ema50
  )
    trend="BEARISH";

  styles.push({
    name:"Trend Following",
    bias:trend,
    basis:[
      "EMA20/EMA50",
      "ADX",
      "Market Structure"
    ]
  });

  /* MOMENTUM */

  let momentum="NEUTRAL";

  if(
    x.rsi>60 &&
    x.macd &&
    x.macd.histogram>0
  )
    momentum="BULLISH";

  if(
    x.rsi<40 &&
    x.macd &&
    x.macd.histogram<0
  )
    momentum="BEARISH";

  styles.push({
    name:"Momentum",
    bias:momentum,
    basis:[
      "RSI",
      "MACD Histogram",
      "Volume"
    ]
  });

  /* MEAN REVERSION */

  let meanReversion="NEUTRAL";

  if(
    x.bb &&
    price<x.bb.lower &&
    x.rsi<35
  )
    meanReversion="POSSIBLE_BULLISH_REVERSION";

  if(
    x.bb &&
    price>x.bb.upper &&
    x.rsi>65
  )
    meanReversion="POSSIBLE_BEARISH_REVERSION";

  styles.push({
    name:"Mean Reversion",
    bias:meanReversion,
    basis:[
      "Bollinger Bands",
      "RSI",
      "Price extension"
    ]
  });

  /* PRICE ACTION */

  styles.push({
    name:"Price Action",
    bias:
      ms.structure==="BULLISH"
        ? "BULLISH"
        : ms.structure==="BEARISH"
          ? "BEARISH"
          : "RANGE",
    basis:[
      "Swing High/Low",
      "BOS",
      "CHoCH",
      "Candles"
    ]
  });

  /* SMC / ICT */

  let smc="NEUTRAL";

  if(
    ms.structure==="BULLISH" ||
    data.fvg.bullish.length ||
    data.orderBlocks.bullish.length
  )
    smc="BULLISH_CONTEXT";

  if(
    ms.structure==="BEARISH" ||
    data.fvg.bearish.length ||
    data.orderBlocks.bearish.length
  )
    smc=
      smc==="BULLISH_CONTEXT"
        ? "MIXED_CONTEXT"
        : "BEARISH_CONTEXT";

  styles.push({
    name:"SMC / ICT",
    bias:smc,
    basis:[
      "BOS",
      "CHoCH",
      "FVG",
      "Order Block",
      "Liquidity Sweep"
    ]
  });

  return styles;
}

/* =========================================================
   ANALYSIS TEXT
   ========================================================= */

function interpretation(data) {

  const x=data.indicators;

  const observations=[];

  if(x.price>x.ma20)
    observations.push(
      "قیمت بالاتر از MA20 قرار دارد."
    );
  else
    observations.push(
      "قیمت پایین‌تر از MA20 قرار دارد."
    );

  if(x.ema20>x.ema50)
    observations.push(
      "EMA20 بالاتر از EMA50 است."
    );
  else
    observations.push(
      "EMA20 پایین‌تر از EMA50 است."
    );

  if(x.rsi>=70)
    observations.push(
      "RSI در محدوده اشباع خرید قرار دارد."
    );
  else if(x.rsi<=30)
    observations.push(
      "RSI در محدوده اشباع فروش قرار دارد."
    );
  else
    observations.push(
      `RSI در محدوده ${round(x.rsi,2)} قرار دارد.`
    );

  if(x.macd) {

    if(x.macd.histogram>0)
      observations.push(
        "هیستوگرام MACD مثبت است."
      );
    else
      observations.push(
        "هیستوگرام MACD منفی است."
      );
  }

  if(data.marketStructure.bos)
    observations.push(
      `ساختار بازار: ${data.marketStructure.bos}`
    );

  if(data.marketStructure.choch)
    observations.push(
      `تغییر ساختار: ${data.marketStructure.choch}`
    );

  if(data.orderBook?.pressure)
    observations.push(
      `دفتر سفارش: ${data.orderBook.pressure}`
    );

  if(data.footprint?.pressure)
    observations.push(
      `فوت‌پرینت: ${data.footprint.pressure}`
    );

  if(data.divergence.bullish.length)
    observations.push(
      "واگرایی مثبت RSI شناسایی شده است."
    );

  if(data.divergence.bearish.length)
    observations.push(
      "واگرایی منفی RSI شناسایی شده است."
    );

  return observations;
}

/* =========================================================
   SINGLE TIMEFRAME DEEP ANALYSIS
   ========================================================= */

async function deepAnalyze(symbol,requestedTf="15") {

  symbol=cleanSymbol(symbol);

  if(!symbol)
    throw new Error("نام رمز ارز وارد نشده است.");

  const market=
    await findMarket(symbol);

  if(!market)
    throw new Error(
      `رمز ارز ${symbol} در Bybit پیدا نشد.`
    );

  const timeframe=
    TF_LIST.includes(String(requestedTf))
      ? String(requestedTf)
      : "15";

  const candles=
    await getKlines(
      market.category,
      market.symbol,
      timeframe,
      500
    );

  if(candles.length<80)
    throw new Error(
      "داده کافی برای تحلیل این تایم‌فریم وجود ندارد."
    );

  const closes=
    candles.map(x=>x.close);

  const price=
    closes[closes.length-1];

  const ma20=sma(closes,20);
  const ma50=sma(closes,50);
  const ma100=sma(closes,100);
  const ma200=sma(closes,200);

  const ema9=ema(closes,9);
  const ema20=ema(closes,20);
  const ema50=ema(closes,50);
  const ema200=ema(closes,200);

  const r=rsi(closes,14);
  const m=macd(closes);
  const a=atr(candles,14);
  const bb=bollinger(closes,20,2);
  const stoch=stochastic(candles,14,3);
  const adxData=adx(candles,14);
  const ichi=ichimoku(candles);
  const v=vwap(candles);

  const ms=marketStructure(candles);
  const sr=supportResistance(candles);
  const fvg=fairValueGaps(candles);
  const ob=orderBlocks(candles);
  const liq=liquidityLevels(candles);
  const sweeps=liquiditySweeps(candles);
  const div=detectDivergence(candles);
  const volume=volumeAnalysis(candles);
  const candle=candleAnalysis(candles);

  const [
    order,
    foot,
    futures
  ]=await Promise.all([
    orderBook(
      market.category,
      market.symbol
    ).catch(()=>null),

    footprint(
      market.category,
      market.symbol
    ).catch(()=>null),

    market.category==="linear"
      ? futuresData(market.symbol)
      : Promise.resolve(null)
  ]);

  const indicators={
    price,

    ma20,
    ma50,
    ma100,
    ma200,

    ema9,
    ema20,
    ema50,
    ema200,

    rsi:r,

    macd:m,

    atr:a,

    bollinger:bb,

    stochastic:stoch,

    adx:adxData,

    ichimoku:ichi,

    vwap:v,

    volume
  };

  const data={
    symbol:market.symbol,

    market:market.market,
    category:market.category,

    timeframe,

    price,

    candles,

    indicators,

    candle,

    marketStructure:ms,

    supportResistance:sr,

    divergence:div,

    fvg,

    orderBlocks:ob,

    liquidity:liq,

    liquiditySweeps:sweeps,

    orderBook:order,

    footprint:foot,

    futures,

    tradingStyles:null,

    interpretation:null,

    generatedAt:new Date().toISOString()
  };

  data.tradingStyles=
    tradingStyles(data);

  data.interpretation=
    interpretation(data);

  return data;
}

/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(env,method,body) {

  if(!env.TELEGRAM_BOT_TOKEN)
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing"
    );

  const url=
    `https://api.telegram.org/bot`+
    `${env.TELEGRAM_BOT_TOKEN}/${method}`;

  const r=
    await fetch(url,{
      method:"POST",
      headers:{
        "content-type":"application/json"
      },
      body:JSON.stringify(body)
    });

  const j=await r.json();

  if(!j.ok)
    throw new Error(
      j.description||"Telegram error"
    );

  return j;
}

async function sendTelegram(env,message) {

  if(!env.TELEGRAM_CHANNEL_ID)
    throw new Error(
      "TELEGRAM_CHANNEL_ID is missing"
    );

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:env.TELEGRAM_CHANNEL_ID,
      text:message,
      disable_web_page_preview:true
    }
  );
}

/* =========================================================
   XML
   ========================================================= */

function stripXml(s) {

  return String(s||"")
    .replace(/<!\[CDATA\[/g,"")
    .replace(/\]\]>/g,"")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function xmlItems(xml) {

  const items=[];

  const blocks=
    xml.match(
      /<item[\s\S]*?<\/item>/gi
    )||[];

  for(const block of blocks) {

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

    const pubDate=
      stripXml(
        (
          block.match(
            /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i
          )||[]
        )[1]
      );

    if(title)
      items.push({
        title,
        link,
        pubDate
      });
  }

  return items;
}

/* =========================================================
   NEWS
   ========================================================= */

async function fetchNews() {

  const all=[];

  for(const url of NEWS_FEEDS) {

    try {

      const r=
        await fetch(url,{
          headers:{
            "user-agent":
              "Global-Pulse/5.0"
          }
        });

      if(!r.ok) continue;

      const xml=await r.text();

      all.push(
        ...xmlItems(xml)
      );

    } catch {}
  }

  const seen=new Set();
  const result=[];

  for(const x of all) {

    const key=
      x.title.toLowerCase();

    if(seen.has(key))
      continue;

    seen.add(key);
    result.push(x);
  }

  return result.slice(0,20);
}

/* =========================================================
   COUNTRY TRENDS
   ========================================================= */

async function fetchCountryTrend(country) {

  const url=
    `https://trends.google.com/trending/rss`+
    `?geo=${country.code}`;

  try {

    const r=
      await fetch(url,{
        headers:{
          "user-agent":
            "Mozilla/5.0 Global-Pulse"
        }
      });

    if(!r.ok)
      throw new Error(
        "Trend unavailable"
      );

    const xml=await r.text();

    const items=xmlItems(xml);

    return {
      country:country.name,
      code:country.code,
      trends:items
        .slice(0,10)
        .map(x=>x.title)
    };

  } catch {

    return {
      country:country.name,
      code:country.code,
      trends:[]
    };
  }
}

/* =========================================================
   SHOPPING
   ========================================================= */

async function fetchShopping() {

  const all=[];

  for(const url of SHOPPING_FEEDS) {

    try {

      const r=
        await fetch(url,{
          headers:{
            "user-agent":
              "Global-Pulse/5.0"
          }
        });

      if(!r.ok) continue;

      const xml=await r.text();

      all.push(
        ...xmlItems(xml)
      );

    } catch {}
  }

  const seen=new Set();
  const result=[];

  for(const x of all) {

    const key=
      x.title.toLowerCase();

    if(seen.has(key))
      continue;

    seen.add(key);
    result.push(x);
  }

  return result.slice(0,20);
}

/* =========================================================
   TELEGRAM NEWS
   ========================================================= */

function newsMessage(items) {

  let s=
`🌍 GLOBAL PULSE
📰 اخبار جهانی

`;

  if(!items.length)
    return s+
      "در حال حاضر خبر معتبر دریافت نشد.";

  for(const x of items.slice(0,8)) {

    s+=`• ${x.title}\n`;

    if(x.link)
      s+=`${x.link}\n`;

    s+="\n";
  }

  s+=
`━━━━━━━━━━━━━━━━
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   TELEGRAM TREND
   ========================================================= */

function trendMessage(data) {

  let s=
`🔥 GLOBAL PULSE
📊 ترند کشور

🌍 ${data.country}

`;

  if(!data.trends.length) {

    s+="اطلاعات ترند در دسترس نیست.";

  } else {

    data.trends.forEach(
      (x,i)=>{
        s+=`${i+1}. ${x}\n`;
      }
    );
  }

  s+=
`\n━━━━━━━━━━━━━━━━
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   TELEGRAM SHOPPING
   ========================================================= */

function shoppingMessage(items) {

  let s=
`🛒 GLOBAL PULSE
🔥 SHOPPING RADAR

`;

  if(!items.length) {

    s+="اطلاعات خرید در دسترس نیست.";

  } else {

    for(const x of items.slice(0,8)) {

      s+=`• ${x.title}\n`;

      if(x.link)
        s+=`${x.link}\n`;

      s+="\n";
    }
  }

  s+=
`━━━━━━━━━━━━━━━━
⚠️ قیمت و موجودی ممکن است تغییر کند.
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   TELEGRAM CRYPTO
   ========================================================= */

function cryptoMessage(a) {

  const x=a.indicators;

  let s=
`🪙 GLOBAL PULSE
🔎 تحلیل رمز ارز

${a.symbol}

📊 بازار: ${a.market}
⏱ تایم‌فریم: ${a.timeframe}
💰 قیمت: ${a.price}

━━━━━━━━━━━━━━━━

📈 INDICATORS

MA20: ${a.indicators.ma20}
MA50: ${a.indicators.ma50}

EMA20: ${a.indicators.ema20}
EMA50: ${a.indicators.ema50}

RSI: ${round(x.rsi,2)}

MACD:
Line: ${round(x.macd?.line,6)}
Signal: ${round(x.macd?.signal,6)}
Histogram: ${round(x.macd?.histogram,6)}

ATR: ${round(x.atr,6)}

━━━━━━━━━━━━━━━━

🏗 MARKET STRUCTURE

Structure:
${a.marketStructure.structure}

BOS:
${a.marketStructure.bos||"NONE"}

CHoCH:
${a.marketStructure.choch||"NONE"}

━━━━━━━━━━━━━━━━

📊 ORDER BOOK

${a.orderBook
  ? `Buy: ${round(a.orderBook.buyShare,2)}%
Sell: ${round(a.orderBook.sellShare,2)}%
Pressure: ${a.orderBook.pressure}`
  : "Unavailable"}

━━━━━━━━━━━━━━━━

📖 FOOTPRINT

${a.footprint
  ? `Buy Notional: ${round(a.footprint.buyNotional,2)}
Sell Notional: ${round(a.footprint.sellNotional,2)}
Delta: ${round(a.footprint.delta,2)}
Delta %: ${round(a.footprint.deltaPercent,2)}%
Pressure: ${a.footprint.pressure}
Large Trades: ${a.footprint.largeTradePressure}`
  : "Unavailable"}

━━━━━━━━━━━━━━━━

⚠️ این اطلاعات تحلیل بازار است و توصیه مالی نیست.

🌐 Global Pulse`;

  return s;
}

/* =========================================================
   AUTOMATIC PUBLISH
   ========================================================= */

async function automaticPublish(env) {

  /* NEWS */

  try {

    const news=
      await fetchNews();

    await sendTelegram(
      env,
      newsMessage(news)
    );

  } catch {}

  await sleep(800);

  /* COUNTRY */

  try {

    const country=
      COUNTRIES[
        Math.floor(
          Math.random()*COUNTRIES.length
        )
      ];

    const trend=
      await fetchCountryTrend(country);

    await sendTelegram(
      env,
      trendMessage(trend)
    );

  } catch {}

  await sleep(800);

  /* SHOPPING */

  try {

    const shopping=
      await fetchShopping();

    await sendTelegram(
      env,
      shoppingMessage(shopping)
    );

  } catch {}
}

/* =========================================================
   ROUTER
   ========================================================= */

export default {

  async fetch(request,env) {

    if(request.method==="OPTIONS") {

      return new Response(null,{
        status:204,
        headers:{
          "access-control-allow-origin":"*",
          "access-control-allow-methods":
            "GET,POST,OPTIONS",
          "access-control-allow-headers":
            "Content-Type"
        }
      });
    }

    const url=
      new URL(request.url);

    const path=url.pathname;

    try {

      /* HEALTH */

      if(path==="/health") {

        let channel=false;

        try {

          if(env.TELEGRAM_CHANNEL_ID) {

            const r=
              await telegram(
                env,
                "getChat",
                {
                  chat_id:
                    env.TELEGRAM_CHANNEL_ID
                }
              );

            channel=!!r.ok;
          }

        } catch {}

        return json({
          ok:true,
          project:"Global Pulse",
          version:VERSION,

          telegram:
            !!env.TELEGRAM_BOT_TOKEN,

          channel,

          bybit:true,

          cryptoAnalyzer:true,

          automaticPublishing:true,

          time:
            new Date().toISOString()
        });
      }

      /* =====================================================
         CRYPTO ANALYZE
         ===================================================== */

      if(path==="/analyze") {

        const symbol=
          cleanSymbol(
            url.searchParams.get("symbol")
          );

        const timeframe=
          url.searchParams.get("timeframe")||
          "15";

        if(!symbol) {

          return json({
            ok:false,
            error:"symbol is required"
          },400);
        }

        const data=
          await deepAnalyze(
            symbol,
            timeframe
          );

        return json({
          ok:true,
          version:VERSION,
          data
        });
      }

      /* =====================================================
         CHART DATA
         ===================================================== */

      if(path==="/chart") {

        const symbol=
          cleanSymbol(
            url.searchParams.get("symbol")
          );

        const timeframe=
          url.searchParams.get("timeframe")||
          "15";

        if(!symbol) {

          return json({
            ok:false,
            error:"symbol is required"
          },400);
        }

        const market=
          await findMarket(symbol);

        if(!market) {

          return json({
            ok:false,
            error:"Symbol not found"
          },404);
        }

        const candles=
          await getKlines(
            market.category,
            market.symbol,
            timeframe,
            500
          );

        return json({
          ok:true,
          symbol:market.symbol,
          category:market.category,
          market:market.market,
          timeframe,
          candles
        });
      }

      /* =====================================================
         TELEGRAM CRYPTO
         ===================================================== */

      if(path==="/test-crypto") {

        const symbol=
          cleanSymbol(
            url.searchParams.get("symbol")||
            "BTCUSDT"
          );

        const timeframe=
          url.searchParams.get("timeframe")||
          "15";

        const data=
          await deepAnalyze(
            symbol,
            timeframe
          );

        await sendTelegram(
          env,
          cryptoMessage(data)
        );

        return json({
          ok:true,
          type:"crypto",
          symbol,
          timeframe
        });
      }

      /* =====================================================
         NEWS
         ===================================================== */

      if(path==="/test-news") {

        const items=
          await fetchNews();

        await sendTelegram(
          env,
          newsMessage(items)
        );

        return json({
          ok:true,
          type:"news",
          count:items.length
        });
      }

      /* =====================================================
         COUNTRY
         ===================================================== */

      if(path==="/test-trend") {

        const country=
          COUNTRIES[0];

        const data=
          await fetchCountryTrend(country);

        await sendTelegram(
          env,
          trendMessage(data)
        );

        return json({
          ok:true,
          type:"trend",
          country:country.name,
          count:data.trends.length
        });
      }

      /* =====================================================
         SHOPPING
         ===================================================== */

      if(path==="/test-shopping") {

        const items=
          await fetchShopping();

        await sendTelegram(
          env,
          shoppingMessage(items)
        );

        return json({
          ok:true,
          type:"shopping",
          count:items.length
        });
      }

      /* =====================================================
         PUBLISH ALL
         ===================================================== */

      if(path==="/publish") {

        await automaticPublish(env);

        return json({
          ok:true,
          published:true,
          sections:[
            "news",
            "country-trends",
            "shopping"
          ]
        });
      }

      /* =====================================================
         WEBHOOK
         ===================================================== */

      if(
        path==="/setup-webhook"
      ) {

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

      if(
        path==="/telegram/webhook" &&
        request.method==="POST"
      ) {

        const update=
          await request.json();

        return json({
          ok:true,
          received:true,
          update_id:
            update.update_id??null
        });
      }

      return json({
        ok:false,
        error:"Not Found",
        path
      },404);

    } catch(e) {

      return json({
        ok:false,
        version:VERSION,
        error:e.message||String(e)
      },500);
    }
  },

  async scheduled(event,env,ctx) {

    ctx.waitUntil(
      automaticPublish(env)
    );
  }
};
