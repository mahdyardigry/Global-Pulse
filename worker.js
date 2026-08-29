/* =========================================================
   GLOBAL PULSE
   GLOBAL NEWS + COUNTRY TRENDS + SHOPPING
   + FULL CRYPTO ANALYZER / BYBIT
   + TELEGRAM AUTO PUBLISH
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V4";
const BYBIT = "https://api.bybit.com";

/* =========================================================
   CONFIG
   ========================================================= */

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

const TF_LIST = [
  "1","3","5","15","30","60","120","240","D"
];

const CRYPTO_TF = "15";

const KLINE_LIMIT = 300;
const TRADE_LIMIT = 1000;
const ORDERBOOK_LIMIT = 100;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

/* =========================================================
   RESPONSE
   ========================================================= */

function json(data,status=200){

  return new Response(
    JSON.stringify(data,null,2),
    {
      status,
      headers:{
        "content-type":
          "application/json; charset=UTF-8",

        "cache-control":
          "no-store, no-cache, must-revalidate"
      }
    }
  );
}

function text(data,status=200){

  return new Response(
    data,
    {
      status,
      headers:{
        "content-type":
          "text/plain; charset=UTF-8"
      }
    }
  );
}

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function cleanSymbol(symbol){

  return String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g,"");
}

function num(v,fallback=0){

  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function avg(a){

  if(!a.length) return 0;

  return a.reduce(
    (x,y)=>x+y,
    0
  ) / a.length;
}

function median(a){

  if(!a.length) return 0;

  const b=[...a].sort(
    (x,y)=>x-y
  );

  const m=Math.floor(b.length/2);

  return b.length%2
    ? b[m]
    : (b[m-1]+b[m])/2;
}

function highest(a){

  if(!a.length) return null;

  return Math.max(...a);
}

function lowest(a){

  if(!a.length) return null;

  return Math.min(...a);
}

function percent(a,b){

  if(!b) return 0;

  return ((a-b)/b)*100;
}

function round(v,d=4){

  if(v===null || v===undefined)
    return null;

  const n=Number(v);

  if(!Number.isFinite(n))
    return null;

  const p=Math.pow(10,d);

  return Math.round(n*p)/p;
}

/* =========================================================
   BYBIT
   ========================================================= */

async function bybit(path){

  const r=await fetch(
    BYBIT+path,
    {
      headers:{
        "user-agent":
          "Global-Pulse/4.0"
      }
    }
  );

  if(!r.ok){

    throw new Error(
      `Bybit HTTP ${r.status}`
    );
  }

  const j=await r.json();

  if(j.retCode!==0){

    throw new Error(
      j.retMsg || "Bybit error"
    );
  }

  return j.result;
}

/* =========================================================
   KLINES
   ========================================================= */

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

async function getKlines(
  category,
  symbol,
  interval,
  limit=KLINE_LIMIT
){

  const q =
    `/v5/market/kline`+
    `?category=${encodeURIComponent(category)}`+
    `&symbol=${encodeURIComponent(symbol)}`+
    `&interval=${encodeURIComponent(interval)}`+
    `&limit=${limit}`;

  const r=await bybit(q);

  return parseKlines(
    r.list || []
  );
}

/* =========================================================
   MARKET FINDER
   ========================================================= */

async function findMarket(symbol){

  const s=cleanSymbol(symbol);

  try{

    const r=await bybit(
      `/v5/market/instruments-info`+
      `?category=linear`+
      `&symbol=${s}`
    );

    if(
      r.list &&
      r.list.length
    ){

      return "linear";
    }

  }catch{}

  try{

    const r=await bybit(
      `/v5/market/instruments-info`+
      `?category=spot`+
      `&symbol=${s}`
    );

    if(
      r.list &&
      r.list.length
    ){

      return "spot";
    }

  }catch{}

  return null;
}

/* =========================================================
   SMA
   ========================================================= */

function sma(values,period){

  if(values.length<period)
    return null;

  return avg(
    values.slice(-period)
  );
}

/* =========================================================
   EMA
   ========================================================= */

function ema(values,period){

  if(values.length<period)
    return null;

  const k=2/(period+1);

  let e=avg(
    values.slice(0,period)
  );

  for(
    let i=period;
    i<values.length;
    i++
  ){

    e =
      values[i]*k+
      e*(1-k);
  }

  return e;
}

/* =========================================================
   STDDEV
   ========================================================= */

function stddev(values,period){

  if(values.length<period)
    return null;

  const a=values.slice(-period);

  const m=avg(a);

  return Math.sqrt(
    avg(
      a.map(
        v=>Math.pow(v-m,2)
      )
    )
  );
}

/* =========================================================
   RSI
   ========================================================= */

function rsi(values,period=14){

  if(values.length<period+1)
    return null;

  let gain=0;
  let loss=0;

  for(
    let i=1;
    i<=period;
    i++
  ){

    const d=
      values[i]-values[i-1];

    if(d>=0)
      gain+=d;
    else
      loss-=d;
  }

  let avgGain=gain/period;
  let avgLoss=loss/period;

  for(
    let i=period+1;
    i<values.length;
    i++
  ){

    const d=
      values[i]-values[i-1];

    const g=Math.max(d,0);
    const l=Math.max(-d,0);

    avgGain=
      (
        avgGain*(period-1)+g
      )/period;

    avgLoss=
      (
        avgLoss*(period-1)+l
      )/period;
  }

  if(avgLoss===0)
    return 100;

  const rs=
    avgGain/avgLoss;

  return 100-(100/(1+rs));
}

/* =========================================================
   RSI SERIES
   ========================================================= */

function rsiSeries(
  values,
  period=14
){

  const out=[];

  if(values.length<period+1)
    return out;

  let gain=0;
  let loss=0;

  for(
    let i=1;
    i<=period;
    i++
  ){

    const d=
      values[i]-values[i-1];

    if(d>=0)
      gain+=d;
    else
      loss-=d;
  }

  let ag=gain/period;
  let al=loss/period;

  for(
    let i=period+1;
    i<values.length;
    i++
  ){

    const d=
      values[i]-values[i-1];

    const g=Math.max(d,0);
    const l=Math.max(-d,0);

    ag=
      (ag*(period-1)+g)/period;

    al=
      (al*(period-1)+l)/period;

    const value=
      al===0
        ? 100
        : 100-(100/(1+ag/al));

    out.push({
      index:i,
      value
    });
  }

  return out;
}

/* =========================================================
   MACD
   ========================================================= */

function macd(values){

  if(values.length<35)
    return null;

  const fast=ema(values,12);
  const slow=ema(values,26);

  if(
    fast===null ||
    slow===null
  ){

    return null;
  }

  const line=fast-slow;

  const series=[];

  for(
    let i=26;
    i<values.length;
    i++
  ){

    const f=
      ema(
        values.slice(0,i+1),
        12
      );

    const s=
      ema(
        values.slice(0,i+1),
        26
      );

    if(
      f!==null &&
      s!==null
    ){

      series.push(f-s);
    }
  }

  const signal=ema(
    series,
    9
  );

  return {
    line,
    signal,
    histogram:
      signal===null
        ? null
        : line-signal
  };
}

/* =========================================================
   MACD SERIES
   ========================================================= */

function macdSeries(values){

  const out=[];

  if(values.length<40)
    return out;

  for(
    let i=26;
    i<values.length;
    i++
  ){

    const f=
      ema(
        values.slice(0,i+1),
        12
      );

    const s=
      ema(
        values.slice(0,i+1),
        26
      );

    if(
      f===null ||
      s===null
    ) continue;

    const line=f-s;

    out.push({
      index:i,
      value:line
    });
  }

  return out;
}

/* =========================================================
   ATR
   ========================================================= */

function atr(
  candles,
  period=14
){

  if(candles.length<period+1)
    return null;

  const trs=[];

  for(
    let i=1;
    i<candles.length;
    i++
  ){

    const c=candles[i];
    const p=candles[i-1];

    trs.push(
      Math.max(
        c.high-c.low,
        Math.abs(
          c.high-p.close
        ),
        Math.abs(
          c.low-p.close
        )
      )
    );
  }

  return avg(
    trs.slice(-period)
  );
}

/* =========================================================
   BOLLINGER
   ========================================================= */

function bollinger(
  values,
  period=20,
  mult=2
){

  if(values.length<period)
    return null;

  const middle=
    sma(values,period);

  const sd=
    stddev(values,period);

  return {
    middle,
    upper:
      middle+mult*sd,
    lower:
      middle-mult*sd,
    width:
      middle
        ? ((mult*2*sd)/middle)*100
        : 0
  };
}

/* =========================================================
   STOCHASTIC
   ========================================================= */

function stochastic(
  candles,
  period=14,
  smooth=3
){

  if(candles.length<period+smooth)
    return null;

  const values=[];

  for(
    let i=period-1;
    i<candles.length;
    i++
  ){

    const slice=
      candles.slice(
        i-period+1,
        i+1
      );

    const hi=
      Math.max(
        ...slice.map(x=>x.high)
      );

    const lo=
      Math.min(
        ...slice.map(x=>x.low)
      );

    const c=
      candles[i].close;

    const k=
      hi===lo
        ? 50
        : ((c-lo)/(hi-lo))*100;

    values.push(k);
  }

  const k=
    values[values.length-1];

  const d=
    avg(
      values.slice(-smooth)
    );

  return {
    k,
    d
  };
}

/* =========================================================
   ADX
   ========================================================= */

function adx(
  candles,
  period=14
){

  if(candles.length<period*2+1)
    return null;

  const trs=[];
  const plus=[];
  const minus=[];

  for(
    let i=1;
    i<candles.length;
    i++
  ){

    const c=candles[i];
    const p=candles[i-1];

    const tr=
      Math.max(
        c.high-c.low,
        Math.abs(c.high-p.close),
        Math.abs(c.low-p.close)
      );

    const up=
      c.high-p.high;

    const down=
      p.low-c.low;

    trs.push(tr);

    plus.push(
      up>down && up>0
        ? up
        : 0
    );

    minus.push(
      down>up && down>0
        ? down
        : 0
    );
  }

  const atrValue=
    avg(trs.slice(-period));

  if(!atrValue)
    return null;

  const pdi=
    avg(
      plus.slice(-period)
    )/atrValue*100;

  const mdi=
    avg(
      minus.slice(-period)
    )/atrValue*100;

  const dx=
    (pdi+mdi)
      ? Math.abs(pdi-mdi)/
        (pdi+mdi)*100
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

function ichimoku(candles){

  if(candles.length<52)
    return null;

  const mid=(period,end)=>
  {
    const s=
      candles.slice(
        Math.max(
          0,
          candles.length-end-period
        ),
        candles.length-end
      );

    if(!s.length)
      return null;

    const h=
      Math.max(
        ...s.map(x=>x.high)
      );

    const l=
      Math.min(
        ...s.map(x=>x.low)
      );

    return (h+l)/2;
  };

  const conversion=
    mid(9,0);

  const base=
    mid(26,0);

  const spanA=
    conversion!==null &&
    base!==null
      ? (conversion+base)/2
      : null;

  const spanB=
    mid(52,0);

  const price=
    candles[candles.length-1].close;

  let trend="NEUTRAL";

  if(
    spanA!==null &&
    spanB!==null
  ){

    if(
      price>spanA &&
      price>spanB
    ){

      trend="BULLISH";
    }

    if(
      price<spanA &&
      price<spanB
    ){

      trend="BEARISH";
    }
  }

  return {
    conversion,
    base,
    spanA,
    spanB,
    price,
    trend
  };
}

/* =========================================================
   PIVOTS
   ========================================================= */

function pivots(
  candles,
  left=2,
  right=2
){

  const highs=[];
  const lows=[];

  for(
    let i=left;
    i<candles.length-right;
    i++
  ){

    let high=true;
    let low=true;

    for(
      let j=1;
      j<=left;
      j++
    ){

      if(
        candles[i].high<=
        candles[i-j].high
      ){

        high=false;
      }

      if(
        candles[i].low>=
        candles[i-j].low
      ){

        low=false;
      }
    }

    for(
      let j=1;
      j<=right;
      j++
    ){

      if(
        candles[i].high<=
        candles[i+j].high
      ){

        high=false;
      }

      if(
        candles[i].low>=
        candles[i+j].low
      ){

        low=false;
      }
    }

    if(high){

      highs.push({
        index:i,
        time:candles[i].time,
        price:candles[i].high
      });
    }

    if(low){

      lows.push({
        index:i,
        time:candles[i].time,
        price:candles[i].low
      });
    }
  }

  return {
    highs,
    lows
  };
}

/* =========================================================
   SUPPORT / RESISTANCE
   ========================================================= */

function supportResistance(
  candles
){

  const p=pivots(
    candles,
    2,
    2
  );

  const current=
    candles[candles.length-1].close;

  const supports=
    p.lows
      .filter(
        x=>x.price<=current
      )
      .slice(-15)
      .sort(
        (a,b)=>b.price-a.price
      );

  const resistances=
    p.highs
      .filter(
        x=>x.price>=current
      )
      .slice(-15)
      .sort(
        (a,b)=>a.price-b.price
      );

  return {
    supports,
    resistances,
    nearestSupport:
      supports[0] || null,
    nearestResistance:
      resistances[0] || null
  };
}

/* =========================================================
   MARKET STRUCTURE
   BOS / CHOCH
   ========================================================= */

function marketStructure(
  candles
){

  const p=pivots(
    candles,
    2,
    2
  );

  const highs=p.highs;
  const lows=p.lows;

  const lastHigh=
    highs[highs.length-1];

  const previousHigh=
    highs[highs.length-2];

  const lastLow=
    lows[lows.length-1];

  const previousLow=
    lows[lows.length-2];

  const price=
    candles[candles.length-1].close;

  let trend="RANGE";
  let bos=null;
  let choch=null;

  if(
    lastHigh &&
    previousHigh &&
    lastLow &&
    previousLow
  ){

    if(
      lastHigh.price>
      previousHigh.price &&
      lastLow.price>
      previousLow.price
    ){

      trend="BULLISH";
    }

    if(
      lastHigh.price<
      previousHigh.price &&
      lastLow.price<
      previousLow.price
    ){

      trend="BEARISH";
    }

    if(
      price>lastHigh.price
    ){

      bos="BULLISH_BOS";
    }

    if(
      price<lastLow.price
    ){

      bos="BEARISH_BOS";
    }

    if(
      trend==="BEARISH" &&
      price>lastHigh.price
    ){

      choch="BULLISH_CHOCH";
    }

    if(
      trend==="BULLISH" &&
      price<lastLow.price
    ){

      choch="BEARISH_CHOCH";
    }
  }

  return {
    trend,
    bos,
    choch,
    lastHigh,
    previousHigh,
    lastLow,
    previousLow
  };
}

/* =========================================================
   LIQUIDITY SWEEP / HUNT
   ========================================================= */

function liquiditySweep(
  candles
){

  if(candles.length<10)
    return null;

  const current=
    candles[candles.length-1];

  const previous=
    candles.slice(
      -11,
      -1
    );

  const prevHigh=
    Math.max(
      ...previous.map(x=>x.high)
    );

  const prevLow=
    Math.min(
      ...previous.map(x=>x.low)
    );

  let signal="NONE";

  if(
    current.high>prevHigh &&
    current.close<prevHigh
  ){

    signal="BUY_SIDE_LIQUIDITY_SWEEP";
  }

  if(
    current.low<prevLow &&
    current.close>prevLow
  ){

    signal="SELL_SIDE_LIQUIDITY_SWEEP";
  }

  return {
    signal,
    previousHigh:prevHigh,
    previousLow:prevLow,
    candleHigh:current.high,
    candleLow:current.low,
    close:current.close
  };
}

/* =========================================================
   FVG
   ========================================================= */

function fairValueGaps(
  candles
){

  const gaps=[];

  for(
    let i=2;
    i<candles.length;
    i++
  ){

    const a=candles[i-2];
    const c=candles[i];

    if(c.low>a.high){

      gaps.push({
        type:"BULLISH_FVG",
        from:a.high,
        to:c.low,
        index:i,
        time:c.time
      });
    }

    if(c.high<a.low){

      gaps.push({
        type:"BEARISH_FVG",
        from:c.high,
        to:a.low,
        index:i,
        time:c.time
      });
    }
  }

  return gaps.slice(-20);
}

/* =========================================================
   ORDER BLOCK
   ========================================================= */

function orderBlocks(
  candles
){

  const blocks=[];

  for(
    let i=2;
    i<candles.length-1;
    i++
  ){

    const a=candles[i-1];
    const b=candles[i];
    const c=candles[i+1];

    if(
      a.close<a.open &&
      c.close>c.open &&
      c.close>b.high
    ){

      blocks.push({
        type:"BULLISH_ORDER_BLOCK",
        high:a.high,
        low:a.low,
        index:i-1,
        time:a.time
      });
    }

    if(
      a.close>a.open &&
      c.close<c.open &&
      c.close<b.low
    ){

      blocks.push({
        type:"BEARISH_ORDER_BLOCK",
        high:a.high,
        low:a.low,
        index:i-1,
        time:a.time
      });
    }
  }

  return blocks.slice(-20);
}

/* =========================================================
   VOLUME ANALYSIS
   ========================================================= */

function volumeAnalysis(
  candles
){

  const current=
    candles[candles.length-1];

  const previous=
    candles.slice(-21,-1);

  const averageVolume=
    avg(
      previous.map(
        x=>x.volume
      )
    );

  const ratio=
    averageVolume
      ? current.volume/
        averageVolume
      : 0;

  let state="NORMAL";

  if(ratio>=2)
    state="VERY_HIGH";

  else if(ratio>=1.3)
    state="HIGH";

  else if(ratio<=0.5)
    state="LOW";

  return {
    currentVolume:current.volume,
    averageVolume,
    ratio,
    state
  };
}

/* =========================================================
   DIVERGENCE
   ========================================================= */

function divergence(
  candles
){

  const closes=
    candles.map(
      x=>x.close
    );

  const rsiValues=
    rsiSeries(
      closes,
      14
    );

  const p=
    pivots(
      candles,
      3,
      3
    );

  const result={
    bullishRSI:false,
    bearishRSI:false,
    bullishMACD:false,
    bearishMACD:false,
    details:[]
  };

  const recentHighs=
    p.highs.slice(-4);

  const recentLows=
    p.lows.slice(-4);

  if(recentLows.length>=2){

    const a=
      recentLows[
        recentLows.length-2
      ];

    const b=
      recentLows[
        recentLows.length-1
      ];

    const ra=
      rsiValues.find(
        x=>x.index===a.index
      );

    const rb=
      rsiValues.find(
        x=>x.index===b.index
      );

    if(
      ra &&
      rb &&
      b.price<a.price &&
      rb.value>ra.value
    ){

      result.bullishRSI=true;

      result.details.push(
        "BULLISH_RSI_DIVERGENCE"
      );
    }
  }

  if(recentHighs.length>=2){

    const a=
      recentHighs[
        recentHighs.length-2
      ];

    const b=
      recentHighs[
        recentHighs.length-1
      ];

    const ra=
      rsiValues.find(
        x=>x.index===a.index
      );

    const rb=
      rsiValues.find(
        x=>x.index===b.index
      );

    if(
      ra &&
      rb &&
      b.price>a.price &&
      rb.value<ra.value
    ){

      result.bearishRSI=true;

      result.details.push(
        "BEARISH_RSI_DIVERGENCE"
      );
    }
  }

  const ms=
    macdSeries(
      closes
    );

  if(
    recentLows.length>=2 &&
    ms.length
  ){

    const a=
      recentLows[
        recentLows.length-2
      ];

    const b=
      recentLows[
        recentLows.length-1
      ];

    const ma=
      ms.find(
        x=>x.index===a.index
      );

    const mb=
      ms.find(
        x=>x.index===b.index
      );

    if(
      ma &&
      mb &&
      b.price<a.price &&
      mb.value>ma.value
    ){

      result.bullishMACD=true;

      result.details.push(
        "BULLISH_MACD_DIVERGENCE"
      );
    }
  }

  if(
    recentHighs.length>=2 &&
    ms.length
  ){

    const a=
      recentHighs[
        recentHighs.length-2
      ];

    const b=
      recentHighs[
        recentHighs.length-1
      ];

    const ma=
      ms.find(
        x=>x.index===a.index
      );

    const mb=
      ms.find(
        x=>x.index===b.index
      );

    if(
      ma &&
      mb &&
      b.price>a.price &&
      mb.value<ma.value
    ){

      result.bearishMACD=true;

      result.details.push(
        "BEARISH_MACD_DIVERGENCE"
      );
    }
  }

  return result;
}

/* =========================================================
   ORDER BOOK
   ========================================================= */

async function orderBook(
  category,
  symbol
){

  const r=await bybit(
    `/v5/market/orderbook`+
    `?category=${category}`+
    `&symbol=${symbol}`+
    `&limit=${ORDERBOOK_LIMIT}`
  );

  const bids=
    (r.b||[]).map(
      x=>[
        num(x[0]),
        num(x[1])
      ]
    );

  const asks=
    (r.a||[]).map(
      x=>[
        num(x[0]),
        num(x[1])
      ]
    );

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

  const total=buy+sell;

  const buyShare=
    total
      ? buy/total*100
      : 50;

  const sellShare=
    total
      ? sell/total*100
      : 50;

  let pressure="NEUTRAL";

  if(
    buyShare>
    sellShare+8
  ){

    pressure="BUY_PRESSURE";
  }

  if(
    sellShare>
    buyShare+8
  ){

    pressure="SELL_PRESSURE";
  }

  const bidSizes=
    bids.map(
      x=>x[0]*x[1]
    );

  const askSizes=
    asks.map(
      x=>x[0]*x[1]
    );

  const bidMedian=
    median(bidSizes);

  const askMedian=
    median(askSizes);

  const buyThreshold=
    bidMedian*4;

  const sellThreshold=
    askMedian*4;

  const buyWalls=
    bids
      .filter(
        x=>
          x[0]*x[1]>=
          buyThreshold
      )
      .slice(0,20)
      .map(
        x=>({
          price:x[0],
          quantity:x[1],
          notional:x[0]*x[1]
        })
      );

  const sellWalls=
    asks
      .filter(
        x=>
          x[0]*x[1]>=
          sellThreshold
      )
      .slice(0,20)
      .map(
        x=>({
          price:x[0],
          quantity:x[1],
          notional:x[0]*x[1]
        })
      );

  return {
    buy,
    sell,
    total,
    buyShare,
    sellShare,
    pressure,

    bestBid:
      bids[0]?.[0] ??
      null,

    bestAsk:
      asks[0]?.[0] ??
      null,

    spread:
      bids[0] &&
      asks[0]
        ? asks[0][0]-
          bids[0][0]
        : null,

    buyWalls,
    sellWalls
  };
}

/* =========================================================
   FOOTPRINT
   ========================================================= */

async function footprint(
  category,
  symbol
){

  const r=await bybit(
    `/v5/market/recent-trade`+
    `?category=${category}`+
    `&symbol=${symbol}`+
    `&limit=${TRADE_LIMIT}`
  );

  let buyVolume=0;
  let sellVolume=0;

  let buyNotional=0;
  let sellNotional=0;

  let buyTrades=0;
  let sellTrades=0;

  const trades=
    r.list || [];

  const notionals=
    trades.map(
      t=>
        num(t.size)*
        num(t.price)
    );

  const avgNotional=
    avg(notionals);

  const largeThreshold=
    Math.max(
      avgNotional*5,
      median(notionals)*8
    );

  let largeBuyVolume=0;
  let largeSellVolume=0;

  let blockBuyVolume=0;
  let blockSellVolume=0;

  for(
    const t of trades
  ){

    const size=num(t.size);
    const price=num(t.price);

    const notional=
      size*price;

    const side=
      String(
        t.side||""
      ).toLowerCase();

    if(side==="buy"){

      buyVolume+=size;
      buyNotional+=notional;
      buyTrades++;

      if(
        notional>=
        largeThreshold
      ){

        largeBuyVolume+=size;
      }

      if(
        notional>=
        largeThreshold*2
      ){

        blockBuyVolume+=size;
      }
    }

    if(side==="sell"){

      sellVolume+=size;
      sellNotional+=notional;
      sellTrades++;

      if(
        notional>=
        largeThreshold
      ){

        largeSellVolume+=size;
      }

      if(
        notional>=
        largeThreshold*2
      ){

        blockSellVolume+=size;
      }
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
      ? delta/total*100
      : 0;

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

    largeThreshold,

    largeBuyVolume,
    largeSellVolume,

    blockBuyVolume,
    blockSellVolume,

    largeOrderBias:
      largeBuyVolume>
      largeSellVolume
        ? "BUY"
        : largeSellVolume>
          largeBuyVolume
            ? "SELL"
            : "NEUTRAL"
  };
}

/* =========================================================
   FUTURES DATA
   ========================================================= */

async function futuresData(
  symbol
){

  const result={
    ticker:null,
    openInterest:null,
    funding:null,
    longShortRatio:null
  };

  try{

    const r=
      await bybit(
        `/v5/market/tickers`+
        `?category=linear`+
        `&symbol=${symbol}`
      );

    result.ticker=
      r.list?.[0] ||
      null;

  }catch{}

  try{

    const r=
      await bybit(
        `/v5/market/open-interest`+
        `?category=linear`+
        `&symbol=${symbol}`+
        `&intervalTime=5min`+
        `&limit=10`
      );

    result.openInterest=
      r.list ||
      [];

  }catch{}

  try{

    const r=
      await bybit(
        `/v5/market/funding/history`+
        `?category=linear`+
        `&symbol=${symbol}`+
        `&limit=10`
      );

    result.funding=
      r.list ||
      [];

  }catch{}

  try{

    const r=
      await bybit(
        `/v5/market/account-ratio`+
        `?category=linear`+
        `&symbol=${symbol}`+
        `&period=5min`+
        `&limit=10`
      );

    result.longShortRatio=
      r.list ||
      [];

  }catch{}

  return result;
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
      KLINE_LIMIT
    );

  if(candles.length<60){

    throw new Error(
      `Insufficient ${tf} timeframe data`
    );
  }

  const closes=
    candles.map(
      x=>x.close
    );

  const price=
    closes[closes.length-1];

  const ma20=
    sma(closes,20);

  const ma50=
    sma(closes,50);

  const ma100=
    sma(closes,100);

  const ma200=
    sma(closes,200);

  const ema20=
    ema(closes,20);

  const ema50=
    ema(closes,50);

  const ema100=
    ema(closes,100);

  const ema200=
    ema(closes,200);

  const r=
    rsi(closes,14);

  const m=
    macd(closes);

  const a=
    atr(candles,14);

  const bb=
    bollinger(
      closes,
      20,
      2
    );

  const st=
    stochastic(
      candles,
      14,
      3
    );

  const adxData=
    adx(
      candles,
      14
    );

  const ichi=
    ichimoku(
      candles
    );

  const sr=
    supportResistance(
      candles
    );

  const structureData=
    marketStructure(
      candles
    );

  const sweep=
    liquiditySweep(
      candles
    );

  const fvg=
    fairValueGaps(
      candles
    );

  const ob=
    orderBlocks(
      candles
    );

  const div=
    divergence(
      candles
    );

  const vol=
    volumeAnalysis(
      candles
    );

  const current=
    candles[candles.length-1];

  const previous=
    candles[candles.length-2];

  const candleChange=
    previous?.close
      ? percent(
          current.close,
          previous.close
        )
      : 0;

  const high20=
    highest(
      candles.slice(-20)
        .map(x=>x.high)
    );

  const low20=
    lowest(
      candles.slice(-20)
        .map(x=>x.low)
    );

  let direction=
    "NEUTRAL";

  let confirmations=[];

  if(
    ema20!==null &&
    ema50!==null
  ){

    if(
      ema20>ema50
    ){

      direction="BULLISH";
      confirmations.push(
        "EMA20_ABOVE_EMA50"
      );
    }

    if(
      ema20<ema50
    ){

      direction="BEARISH";
      confirmations.push(
        "EMA20_BELOW_EMA50"
      );
    }
  }

  if(
    r!==null
  ){

    if(r>=70)
      confirmations.push(
        "RSI_OVERBOUGHT"
      );

    else if(r<=30)
      confirmations.push(
        "RSI_OVERSOLD"
      );
  }

  if(
    m?.histogram!==null &&
    m?.histogram!==undefined
  ){

    if(m.histogram>0)
      confirmations.push(
        "MACD_HISTOGRAM_POSITIVE"
      );

    if(m.histogram<0)
      confirmations.push(
        "MACD_HISTOGRAM_NEGATIVE"
      );
  }

  const candlesForChart=
    candles.slice(-150);

  return {

    timeframe:tf,

    price,

    changeFromPreviousCandle:
      candleChange,

    candle:{
      time:current.time,
      open:current.open,
      high:current.high,
      low:current.low,
      close:current.close,
      volume:current.volume
    },

    movingAverages:{
      ma20,
      ma50,
      ma100,
      ma200,
      ema20,
      ema50,
      ema100,
      ema200
    },

    rsi:{
      value:r
    },

    macd:{
      line:m?.line ?? null,
      signal:m?.signal ?? null,
      histogram:
        m?.histogram ?? null
    },

    atr:{
      value:a
    },

    bollinger:bb,

    stochastic:st,

    adx:adxData,

    ichimoku:ichi,

    volume:vol,

    supportResistance:sr,

    marketStructure:structureData,

    liquiditySweep:sweep,

    fairValueGaps:fvg,

    orderBlocks:ob,

    divergence:div,

    direction,

    confirmations,

    recentRange:{
      high:high20,
      low:low20
    },

    chartCandles:candlesForChart
  };
}

/* =========================================================
   MULTI TIMEFRAME
   ========================================================= */

async function multiTimeframe(
  category,
  symbol
){

  const result=[];

  for(
    const tf of TF_LIST
  ){

    try{

      const data=
        await analyzeTimeframe(
          category,
          symbol,
          tf
        );

      result.push({
        timeframe:tf,
        direction:data.direction,
        price:data.price,
        rsi:data.rsi?.value ?? null,
        macd:data.macd?.line ?? null,
        macdHistogram:
          data.macd?.histogram ??
          null,
        structure:
          data.marketStructure?.trend ??
          "RANGE"
      });

    }catch{}

    await sleep(60);
  }

  return result;
}

/* =========================================================
   DEEP ANALYZE
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
      ? requestedTf
      : "15";

  const selectedAnalysis=
    await analyzeTimeframe(
      category,
      symbol,
      selected
    );

  const [order,foot,futures,multi]=
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
        ? futuresData(symbol)
        : Promise.resolve(null),

      multiTimeframe(
        category,
        symbol
      )
    ]);

  const price=
    selectedAnalysis.price;

  return {

    symbol,

    category,

    requestedTimeframe:
      selected,

    price,

    selectedAnalysis,

    multiTimeframe:multi,

    orderBook:order,

    footprint:foot,

    futures,

    marketSummary:{
      direction:
        selectedAnalysis.direction,

      structure:
        selectedAnalysis
          .marketStructure,

      nearestSupport:
        selectedAnalysis
          .supportResistance
          ?.nearestSupport ??
        null,

      nearestResistance:
        selectedAnalysis
          .supportResistance
          ?.nearestResistance ??
        null,

      liquiditySweep:
        selectedAnalysis
          .liquiditySweep ??
        null,

      divergence:
        selectedAnalysis
          .divergence ??
        null
    },

    generatedAt:
      new Date().toISOString()
  };
}

/* =========================================================
   GLOBAL NEWS
   ========================================================= */

const NEWS_FEEDS=[
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.bbci.co.uk/news/business/rss.xml",
  "https://feeds.bbci.co.uk/news/technology/rss.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"
];

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

  const items=[];

  const blocks=
    xml.match(
      /<item[\s\S]*?<\/item>/gi
    ) || [];

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

      items.push({
        title,
        link,
        pubDate:pub
      });
    }
  }

  return items;
}

async function fetchNews(){

  const all=[];

  for(
    const url of NEWS_FEEDS
  ){

    try{

      const r=
        await fetch(
          url,
          {
            headers:{
              "user-agent":
                "Global-Pulse/4.0"
            }
          }
        );

      if(!r.ok)
        continue;

      const xml=
        await r.text();

      all.push(
        ...xmlItems(xml)
      );

    }catch{}
  }

  const result=[];
  const seen=new Set();

  for(
    const x of all
  ){

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

async function fetchCountryTrend(
  country
){

  const url=
    `https://trends.google.com/`+
    `trending/rss?geo=${country.code}`;

  try{

    const r=
      await fetch(
        url,
        {
          headers:{
            "user-agent":
              "Mozilla/5.0 Global-Pulse"
          }
        }
      );

    if(!r.ok)
      throw new Error(
        "Trend unavailable"
      );

    const xml=
      await r.text();

    const items=
      xmlItems(xml);

    return {
      country:country.name,
      code:country.code,
      trends:
        items
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
   SHOPPING
   ========================================================= */

const SHOPPING_FEEDS=[
  "https://news.google.com/rss/search?q=best+deals+shopping&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=consumer+deals+discounts&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=popular+products+shopping&hl=en-US&gl=US&ceid=US:en"
];

async function fetchShopping(){

  const all=[];

  for(
    const url of SHOPPING_FEEDS
  ){

    try{

      const r=
        await fetch(
          url,
          {
            headers:{
              "user-agent":
                "Global-Pulse/4.0"
            }
          }
        );

      if(!r.ok)
        continue;

      const xml=
        await r.text();

      all.push(
        ...xmlItems(xml)
      );

    }catch{}
  }

  const result=[];
  const seen=new Set();

  for(
    const x of all
  ){

    const k=
      x.title.toLowerCase();

    if(seen.has(k))
      continue;

    seen.add(k);
    result.push(x);
  }

  return result.slice(0,20);
}

/* =========================================================
   BYBIT TOP CRYPTO
   ========================================================= */

async function getTopCryptoSymbols(){

  try{

    const r=
      await bybit(
        `/v5/market/tickers`+
        `?category=linear`
      );

    const list=
      r.list || [];

    return list
      .filter(
        x=>
          x.symbol &&
          x.symbol.endsWith("USDT")
      )
      .sort(
        (a,b)=>
          num(b.turnover24h)-
          num(a.turnover24h)
      )
      .slice(0,10)
      .map(
        x=>x.symbol
      );

  }catch{

    return [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
      "XRPUSDT",
      "DOGEUSDT"
    ];
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

  const url=
    `https://api.telegram.org/`+
    `bot${env.TELEGRAM_BOT_TOKEN}/`+
    `${method}`;

  const r=
    await fetch(
      url,
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
      j.description ||
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

      disable_web_page_preview:
        true
    }
  );
}

/* =========================================================
   TELEGRAM NEWS
   ========================================================= */

function newsMessage(items){

  let s=
`🌍 GLOBAL PULSE

📰 GLOBAL NEWS RADAR

`;

  if(!items.length){

    s+=
`No reliable global news available right now.

`;

  }else{

    for(
      const x of items.slice(0,8)
    ){

      s+=
        `• ${x.title}\n`;

      if(x.link)
        s+=`${x.link}\n`;

      s+="\n";
    }
  }

  s+=
`━━━━━━━━━━━━━━━━
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   TELEGRAM TRENDS
   ========================================================= */

function trendMessage(data){

  let s=
`🔥 COUNTRY TREND RADAR

🌍 ${data.country}

`;

  if(!data.trends.length){

    s+=
`No reliable trend data available.

`;

  }else{

    data.trends.forEach(
      (x,i)=>{

        s+=
          `${i+1}. ${x}\n`;
      }
    );
  }

  s+=
`\n━━━━━━━━━━━━━━━━
📊 Google Trends
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   TELEGRAM SHOPPING
   ========================================================= */

function shoppingMessage(items){

  let s=
`🛒 GLOBAL SHOPPING RADAR

🔥 Popular deals & consumer topics

`;

  if(!items.length){

    s+=
      `No shopping information available.\n\n`;

  }else{

    items.slice(0,8)
      .forEach(
        x=>{

          s+=
            `• ${x.title}\n`;

          if(x.link)
            s+=`${x.link}\n`;

          s+="\n";
        }
      );
  }

  s+=
`━━━━━━━━━━━━━━━━
⚠️ Prices and availability can change.
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   CRYPTO TELEGRAM
   ========================================================= */

function cryptoMessage(a){

  const x=
    a.selectedAnalysis || {};

  const rsiValue=
    x.rsi?.value;

  const macdValue=
    x.macd?.line;

  const structure=
    x.marketStructure || {};

  const sr=
    x.supportResistance || {};

  const div=
    x.divergence || {};

  const sweep=
    x.liquiditySweep || {};

  const order=
    a.orderBook;

  const foot=
    a.footprint;

  let s=
`🪙 GLOBAL PULSE CRYPTO RADAR

${a.symbol}

📊 Market: ${
  a.category==="linear"
    ? "Futures"
    : "Spot"
}

⏱ Timeframe: ${
  a.requestedTimeframe
}

💰 Price: ${a.price}

━━━━━━━━━━━━━━━━

📈 MARKET DIRECTION

${x.direction || "NEUTRAL"}

🏗 Structure:
${structure.trend || "RANGE"}

`;

  if(structure.bos)
    s+=`⚡ ${structure.bos}\n`;

  if(structure.choch)
    s+=`🔄 ${structure.choch}\n`;

  s+=
`
━━━━━━━━━━━━━━━━

📊 INDICATORS

RSI:
${rsiValue!==null && rsiValue!==undefined
  ? rsiValue.toFixed(2)
  : "N/A"}

MACD:
${macdValue!==null && macdValue!==undefined
  ? macdValue.toFixed(5)
  : "N/A"}

MACD Histogram:
${x.macd?.histogram!==null &&
 x.macd?.histogram!==undefined
  ? x.macd.histogram.toFixed(5)
  : "N/A"}

ATR:
${x.atr?.value!==null &&
 x.atr?.value!==undefined
  ? x.atr.value.toFixed(5)
  : "N/A"}

`;

  if(
    x.stochastic
  ){

    s+=
`Stochastic:
K ${x.stochastic.k.toFixed(2)}
D ${x.stochastic.d.toFixed(2)}

`;
  }

  if(x.adx){

    s+=
`ADX:
${x.adx.adx.toFixed(2)}
+DI ${x.adx.plusDI.toFixed(2)}
-DI ${x.adx.minusDI.toFixed(2)}

`;
  }

  s+=
`━━━━━━━━━━━━━━━━

🟢 SUPPORT

${
  sr.supports?.slice(0,3)
    .map(
      z=>z.price
    )
    .join(" | ") ||
  "N/A"
}

🔴 RESISTANCE

${
  sr.resistances?.slice(0,3)
    .map(
      z=>z.price
    )
    .join(" | ") ||
  "N/A"
}

━━━━━━━━━━━━━━━━

🔎 DIVERGENCE

${
  div.details?.length
    ? div.details.join("\n")
    : "No confirmed divergence"
}

━━━━━━━━━━━━━━━━

💧 LIQUIDITY

${
  sweep.signal ||
  "NO_SWEEP"
}

━━━━━━━━━━━━━━━━

📖 ORDER BOOK

${
  order
    ? `
Buy: ${order.buyShare.toFixed(1)}%
Sell: ${order.sellShare.toFixed(1)}%
Pressure: ${order.pressure}

Buy Walls:
${order.buyWalls
  .slice(0,3)
  .map(
    z=>z.price
  )
  .join(" | ") || "None"}

Sell Walls:
${order.sellWalls
  .slice(0,3)
  .map(
    z=>z.price
  )
  .join(" | ") || "None"}
`
    : "Unavailable"
}

━━━━━━━━━━━━━━━━

👣 FOOTPRINT

${
  foot
    ? `
Buy Notional:
${foot.buyNotional.toFixed(2)}

Sell Notional:
${foot.sellNotional.toFixed(2)}

Delta:
${foot.delta.toFixed(2)}

Delta %:
${foot.deltaPercent.toFixed(2)}%

Pressure:
${foot.pressure}
`
    : "Unavailable"
}

━━━━━━━━━━━━━━━━

🕯 MULTI TIMEFRAME

${
  a.multiTimeframe
    .map(
      z=>
        `${z.timeframe}m/D : ${z.direction}`
    )
    .join("\n")
}

━━━━━━━━━━━━━━━━

⚠️ Market analysis only.
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   AUTOMATIC CRYPTO PUBLISH
   ========================================================= */

async function automaticCryptoPublish(
  env
){

  const symbols=
    await getTopCryptoSymbols();

  for(
    const symbol of symbols.slice(0,5)
  ){

    try{

      const data=
        await deepAnalyze(
          symbol,
          CRYPTO_TF
        );

      await sendTelegram(
        env,
        cryptoMessage(data)
      );

    }catch{}

    await sleep(700);
  }
}

/* =========================================================
   AUTOMATIC GLOBAL PUBLISH
   ========================================================= */

async function automaticPublish(env){

  /* NEWS */

  try{

    const news=
      await fetchNews();

    await sendTelegram(
      env,
      newsMessage(news)
    );

  }catch{}

  await sleep(500);

  /* COUNTRY TREND */

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

    await sendTelegram(
      env,
      trendMessage(trend)
    );

  }catch{}

  await sleep(500);

  /* SHOPPING */

  try{

    const shopping=
      await fetchShopping();

    await sendTelegram(
      env,
      shoppingMessage(shopping)
    );

  }catch{}

  await sleep(700);

  /* CRYPTO */

  try{

    await automaticCryptoPublish(
      env
    );

  }catch{}
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

      /* =====================================================
         HEALTH
         ===================================================== */

      if(path==="/health"){

        let channel=false;

        try{

          if(
            env.TELEGRAM_CHANNEL_ID
          ){

            const me=
              await telegram(
                env,
                "getChat",
                {
                  chat_id:
                    env.TELEGRAM_CHANNEL_ID
                }
              );

            channel=!!me.ok;
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

          automaticPublishing:true,

          time:
            new Date()
              .toISOString()
        });
      }

      /* =====================================================
         SET WEBHOOK
         ===================================================== */

      if(
        path==="/setup-webhook"
      ){

        const webhook=
          `${url.origin}`+
          `/telegram/webhook`;

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

      /* =====================================================
         TELEGRAM WEBHOOK
         ===================================================== */

      if(
        path===
        "/telegram/webhook" &&
        request.method==="POST"
      ){

        const update=
          await request.json();

        return json({

          ok:true,

          received:true,

          update_id:
            update.update_id ??
            null
        });
      }

      /* =====================================================
         TEST NEWS
         ===================================================== */

      if(path==="/test-news"){

        const items=
          await fetchNews();

        await sendTelegram(
          env,
          newsMessage(items)
        );

        return json({

          ok:true,

          type:"news",

          count:
            items.length
        });
      }

      /* =====================================================
         TEST TREND
         ===================================================== */

      if(path==="/test-trend"){

        const country=
          COUNTRIES[0];

        const data=
          await fetchCountryTrend(
            country
          );

        await sendTelegram(
          env,
          trendMessage(data)
        );

        return json({

          ok:true,

          type:"trend",

          country:
            country.name,

          count:
            data.trends.length
        });
      }

      /* =====================================================
         TEST SHOPPING
         ===================================================== */

      if(
        path==="/test-shopping"
      ){

        const items=
          await fetchShopping();

        await sendTelegram(
          env,
          shoppingMessage(items)
        );

        return json({

          ok:true,

          type:"shopping",

          count:
            items.length
        });
      }

      /* =====================================================
         CRYPTO ANALYZE
         ===================================================== */

      if(
        path==="/analyze"
      ){

        const symbol=
          cleanSymbol(
            url.searchParams
              .get("symbol")
          );

        const timeframe=
          url.searchParams
            .get("timeframe") ||
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

      /* =====================================================
         CRYPTO TEST TELEGRAM
         ===================================================== */

      if(
        path==="/test-crypto"
      ){

        const symbol=
          cleanSymbol(
            url.searchParams
              .get("symbol") ||
            "BTCUSDT"
          );

        const timeframe=
          url.searchParams
            .get("timeframe") ||
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

          timeframe,

          published:true
        });
      }

      /* =====================================================
         CRYPTO AUTO TEST
         ===================================================== */

      if(
        path==="/test-crypto-auto"
      ){

        await automaticCryptoPublish(
          env
        );

        return json({

          ok:true,

          type:
            "crypto-auto",

          published:true
        });
      }

      /* =====================================================
         PUBLISH EVERYTHING
         ===================================================== */

      if(
        path==="/publish"
      ){

        await automaticPublish(
          env
        );

        return json({

          ok:true,

          published:true,

          sections:[
            "news",
            "country-trends",
            "shopping",
            "crypto"
          ]
        });
      }

      /* =====================================================
         NOT FOUND
         ===================================================== */

      return json({

        ok:false,

        error:"Not Found",

        path

      },404);

    }catch(e){

      return json({

        ok:false,

        version:
          VERSION,

        error:
          e.message ||
          String(e)

      },500);
    }
  },

  /* =======================================================
     CLOUDFLARE CRON
     ======================================================= */

  async scheduled(
    event,
    env,
    ctx
  ){

    ctx.waitUntil(
      automaticPublish(env)
    );
  }
};
