/* =========================================================
   GLOBAL PULSE
   GLOBAL NEWS + COUNTRY TRENDS + SHOPPING
   + CRYPTO LIVE TERMINAL
   + TELEGRAM AUTO PUBLISH
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V4";
const BYBIT = "https://api.bybit.com";

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
  { id:"1", label:"1 دقیقه" },
  { id:"3", label:"3 دقیقه" },
  { id:"5", label:"5 دقیقه" },
  { id:"15", label:"15 دقیقه" },
  { id:"30", label:"30 دقیقه" },
  { id:"60", label:"1 ساعت" },
  { id:"240", label:"4 ساعت" },
  { id:"D", label:"روزانه" }
];

const AUTO_CRYPTO = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT"
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{
      "content-type":"application/json; charset=UTF-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*"
    }
  });
}

function html(data,status=200){
  return new Response(data,{
    status,
    headers:{
      "content-type":"text/html; charset=UTF-8",
      "cache-control":"no-store"
    }
  });
}

function cleanSymbol(symbol){
  return String(symbol||"")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g,"");
}

function num(v,fallback=0){
  const n=Number(v);
  return Number.isFinite(n)?n:fallback;
}

function avg(a){
  if(!a.length)return 0;
  return a.reduce((x,y)=>x+y,0)/a.length;
}

function median(a){
  if(!a.length)return 0;
  const b=[...a].sort((x,y)=>x-y);
  const m=Math.floor(b.length/2);
  return b.length%2?b[m]:(b[m-1]+b[m])/2;
}

function sma(values,period){
  if(values.length<period)return null;
  return avg(values.slice(-period));
}

function ema(values,period){
  if(values.length<period)return null;

  const k=2/(period+1);
  let e=avg(values.slice(0,period));

  for(let i=period;i<values.length;i++){
    e=values[i]*k+e*(1-k);
  }

  return e;
}

function stddev(values,period){
  if(values.length<period)return null;

  const a=values.slice(-period);
  const m=avg(a);

  return Math.sqrt(
    avg(a.map(v=>(v-m)**2))
  );
}

function rsi(values,period=14){
  if(values.length<period+1)return null;

  let gain=0;
  let loss=0;

  for(let i=1;i<=period;i++){
    const d=values[i]-values[i-1];

    if(d>=0)gain+=d;
    else loss-=d;
  }

  let avgGain=gain/period;
  let avgLoss=loss/period;

  for(let i=period+1;i<values.length;i++){
    const d=values[i]-values[i-1];
    const g=Math.max(d,0);
    const l=Math.max(-d,0);

    avgGain=((avgGain*(period-1))+g)/period;
    avgLoss=((avgLoss*(period-1))+l)/period;
  }

  if(avgLoss===0)return 100;

  const rs=avgGain/avgLoss;

  return 100-(100/(1+rs));
}

function macd(values){
  if(values.length<35)return null;

  const series=[];

  for(let i=0;i<values.length;i++){

    const f=ema(values.slice(0,i+1),12);
    const s=ema(values.slice(0,i+1),26);

    if(f!=null&&s!=null){
      series.push(f-s);
    }
  }

  if(!series.length)return null;

  const line=series[series.length-1];
  const signal=ema(series,9);

  return {
    line,
    signal,
    histogram:
      signal==null?null:line-signal
  };
}

function atr(candles,period=14){
  if(candles.length<period+1)return null;

  const trs=[];

  for(let i=1;i<candles.length;i++){

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

function bollinger(values,period=20,mult=2){
  if(values.length<period)return null;

  const middle=sma(values,period);
  const sd=stddev(values,period);

  return {
    middle,
    upper:middle+mult*sd,
    lower:middle-mult*sd,
    width:middle?((mult*2*sd)/middle)*100:0
  };
}

function parseKlines(rows){

  return rows.map(x=>({
    time:num(x[0]),
    open:num(x[1]),
    high:num(x[2]),
    low:num(x[3]),
    close:num(x[4]),
    volume:num(x[5]),
    turnover:num(x[6])
  })).sort((a,b)=>a.time-b.time);
}

async function bybit(path){

  const r=await fetch(BYBIT+path,{
    headers:{
      "user-agent":"Global-Pulse/4.0"
    }
  });

  if(!r.ok){
    throw new Error(`Bybit HTTP ${r.status}`);
  }

  const j=await r.json();

  if(j.retCode!==0){
    throw new Error(j.retMsg||"Bybit error");
  }

  return j.result;
}

async function getKlines(category,symbol,interval,limit=200){

  const q=
    `/v5/market/kline?category=${encodeURIComponent(category)}`+
    `&symbol=${encodeURIComponent(symbol)}`+
    `&interval=${encodeURIComponent(interval)}`+
    `&limit=${limit}`;

  const r=await bybit(q);

  return parseKlines(r.list||[]);
}

async function findMarket(symbol){

  const s=cleanSymbol(symbol);

  try{

    const linear=await bybit(
      `/v5/market/instruments-info?category=linear&symbol=${s}`
    );

    if(linear.list?.length){
      return "linear";
    }

  }catch{}

  try{

    const spot=await bybit(
      `/v5/market/instruments-info?category=spot&symbol=${s}`
    );

    if(spot.list?.length){
      return "spot";
    }

  }catch{}

  return null;
}

/* =========================================================
   PIVOTS / SUPPORT / RESISTANCE
   ========================================================= */

function pivotHigh(c,i,left=2,right=2){

  if(i<left||i+right>=c.length)return false;

  const v=c[i].high;

  for(let x=1;x<=left;x++){
    if(c[i-x].high>=v)return false;
  }

  for(let x=1;x<=right;x++){
    if(c[i+x].high>v)return false;
  }

  return true;
}

function pivotLow(c,i,left=2,right=2){

  if(i<left||i+right>=c.length)return false;

  const v=c[i].low;

  for(let x=1;x<=left;x++){
    if(c[i-x].low<=v)return false;
  }

  for(let x=1;x<=right;x++){
    if(c[i+x].low<v)return false;
  }

  return true;
}

function supportResistance(candles){

  const supports=[];
  const resistances=[];

  for(let i=2;i<candles.length-2;i++){

    if(pivotLow(candles,i)){
      supports.push(candles[i].low);
    }

    if(pivotHigh(candles,i)){
      resistances.push(candles[i].high);
    }
  }

  const merge=v=>{
    const out=[];

    for(const x of v.sort((a,b)=>a-b)){

      if(!out.length){
        out.push(x);
        continue;
      }

      const last=out[out.length-1];

      if(Math.abs(x-last)/Math.max(x,1)<0.003){
        out[out.length-1]=(last+x)/2;
      }else{
        out.push(x);
      }
    }

    return out.slice(-8);
  };

  return {
    supports:merge(supports),
    resistances:merge(resistances)
  };
}

/* =========================================================
   MARKET STRUCTURE
   ========================================================= */

function marketStructure(candles){

  if(candles.length<20){
    return {
      trend:"UNKNOWN",
      bos:"NONE",
      choch:"NONE",
      swingHigh:null,
      swingLow:null
    };
  }

  const p=candles.slice(-60);

  let highs=[];
  let lows=[];

  for(let i=2;i<p.length-2;i++){

    if(pivotHigh(p,i)){
      highs.push({
        price:p[i].high,
        index:i
      });
    }

    if(pivotLow(p,i)){
      lows.push({
        price:p[i].low,
        index:i
      });
    }
  }

  const last=p[p.length-1];

  const lastHigh=highs.at(-1)?.price||null;
  const previousHigh=highs.at(-2)?.price||null;

  const lastLow=lows.at(-1)?.price||null;
  const previousLow=lows.at(-2)?.price||null;

  let trend="RANGE";
  let bos="NONE";
  let choch="NONE";

  if(
    lastHigh &&
    previousHigh &&
    lastLow &&
    previousLow
  ){

    if(lastHigh>previousHigh&&lastLow>previousLow){
      trend="BULLISH";
    }

    if(lastHigh<previousHigh&&lastLow<previousLow){
      trend="BEARISH";
    }

    if(last.close>lastHigh){
      bos="BULLISH_BOS";
    }

    if(last.close<lastLow){
      bos="BEARISH_BOS";
    }

    if(
      trend==="BEARISH" &&
      last.close>lastHigh
    ){
      choch="BULLISH_CHOCH";
    }

    if(
      trend==="BULLISH" &&
      last.close<lastLow
    ){
      choch="BEARISH_CHOCH";
    }
  }

  return {
    trend,
    bos,
    choch,
    swingHigh:lastHigh,
    swingLow:lastLow
  };
}

/* =========================================================
   FVG
   ========================================================= */

function findFVG(candles){

  const bullish=[];
  const bearish=[];

  for(let i=2;i<candles.length;i++){

    const a=candles[i-2];
    const c=candles[i];

    if(c.low>a.high){
      bullish.push({
        from:a.high,
        to:c.low,
        index:i
      });
    }

    if(c.high<a.low){
      bearish.push({
        from:c.high,
        to:a.low,
        index:i
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

function findOrderBlocks(candles){

  const bullish=[];
  const bearish=[];

  for(let i=3;i<candles.length-2;i++){

    const c=candles[i];
    const next=candles[i+1];
    const next2=candles[i+2];

    if(
      c.close<c.open &&
      next.close>next.open &&
      next2.close>next2.open &&
      next2.close>c.high
    ){

      bullish.push({
        high:c.high,
        low:c.low,
        index:i
      });
    }

    if(
      c.close>c.open &&
      next.close<next.open &&
      next2.close<next2.open &&
      next2.close<c.low
    ){

      bearish.push({
        high:c.high,
        low:c.low,
        index:i
      });
    }
  }

  return {
    bullish:bullish.slice(-8),
    bearish:bearish.slice(-8)
  };
}

/* =========================================================
   LIQUIDITY SWEEP
   ========================================================= */

function liquiditySweeps(candles){

  const bullish=[];
  const bearish=[];

  for(let i=3;i<candles.length;i++){

    const c=candles[i];

    const prevHigh=Math.max(
      ...candles.slice(Math.max(0,i-10),i)
        .map(x=>x.high)
    );

    const prevLow=Math.min(
      ...candles.slice(Math.max(0,i-10),i)
        .map(x=>x.low)
    );

    if(
      c.low<prevLow &&
      c.close>prevLow
    ){
      bullish.push({
        price:c.low,
        index:i,
        type:"BULLISH_LIQUIDITY_SWEEP"
      });
    }

    if(
      c.high>prevHigh &&
      c.close<prevHigh
    ){
      bearish.push({
        price:c.high,
        index:i,
        type:"BEARISH_LIQUIDITY_SWEEP"
      });
    }
  }

  return {
    bullish:bullish.slice(-8),
    bearish:bearish.slice(-8)
  };
}

/* =========================================================
   DIVERGENCE
   ========================================================= */

function divergence(candles){

  const closes=candles.map(x=>x.close);

  const rsis=[];

  for(let i=0;i<closes.length;i++){

    const r=rsi(closes.slice(0,i+1),14);

    rsis.push(r);
  }

  const priceLows=[];
  const priceHighs=[];

  for(let i=3;i<candles.length-3;i++){

    if(pivotLow(candles,i)){
      priceLows.push(i);
    }

    if(pivotHigh(candles,i)){
      priceHighs.push(i);
    }
  }

  let bullish=false;
  let bearish=false;

  if(priceLows.length>=2){

    const a=priceLows.at(-2);
    const b=priceLows.at(-1);

    if(
      candles[b].low<candles[a].low &&
      rsis[b]>rsis[a]
    ){
      bullish=true;
    }
  }

  if(priceHighs.length>=2){

    const a=priceHighs.at(-2);
    const b=priceHighs.at(-1);

    if(
      candles[b].high>candles[a].high &&
      rsis[b]<rsis[a]
    ){
      bearish=true;
    }
  }

  return {
    bullish,
    bearish,
    type:
      bullish&&bearish
        ?"BOTH"
        :bullish
          ?"BULLISH"
          :bearish
            ?"BEARISH"
            :"NONE"
  };
}

/* =========================================================
   ANALYSIS
   ========================================================= */

async function analyzeTimeframe(category,symbol,tf){

  const candles=await getKlines(
    category,
    symbol,
    tf,
    200
  );

  if(candles.length<60){
    throw new Error("Insufficient data");
  }

  const closes=candles.map(x=>x.close);
  const price=closes.at(-1);

  const ma20=sma(closes,20);
  const ma50=sma(closes,50);

  const ema20=ema(closes,20);
  const ema50=ema(closes,50);

  const r=rsi(closes,14);
  const m=macd(closes);
  const a=atr(candles,14);
  const bb=bollinger(closes,20,2);

  const sr=supportResistance(candles);
  const ms=marketStructure(candles);
  const fvg=findFVG(candles);
  const ob=findOrderBlocks(candles);
  const sweep=liquiditySweeps(candles);
  const div=divergence(candles);

  const volumeNow=candles.at(-1).volume;

  const volumeAvg=avg(
    candles.slice(-21,-1).map(x=>x.volume)
  );

  const volumeRatio=
    volumeAvg?volumeNow/volumeAvg:0;

  let direction="NEUTRAL";

  if(
    price>ma20 &&
    ema20>ema50 &&
    r>=50
  ){
    direction="BULLISH";
  }

  if(
    price<ma20 &&
    ema20<ema50 &&
    r<50
  ){
    direction="BEARISH";
  }

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
    macdHistogram:m?.histogram??null,
    atr:a,
    bollinger:bb,
    volumeNow,
    volumeAverage:volumeAvg,
    volumeRatio,
    supportResistance:sr,
    structure:ms,
    fvg,
    orderBlocks:ob,
    liquiditySweep:sweep,
    divergence:div,
    direction,
    high:Math.max(...candles.slice(-20).map(x=>x.high)),
    low:Math.min(...candles.slice(-20).map(x=>x.low)),
    candles
  };
}

/* =========================================================
   ORDER BOOK
   ========================================================= */

async function orderBook(category,symbol){

  const r=await bybit(
    `/v5/market/orderbook?category=${category}`+
    `&symbol=${symbol}&limit=50`
  );

  const bids=(r.b||[]).map(x=>[
    num(x[0]),
    num(x[1])
  ]);

  const asks=(r.a||[]).map(x=>[
    num(x[0]),
    num(x[1])
  ]);

  const buy=bids.reduce(
    (s,x)=>s+x[0]*x[1],0
  );

  const sell=asks.reduce(
    (s,x)=>s+x[0]*x[1],0
  );

  const total=buy+sell;

  const buyShare=
    total?buy/total*100:50;

  const sellShare=
    total?sell/total*100:50;

  let pressure="NEUTRAL";

  if(buyShare>sellShare+8){
    pressure="BUY_PRESSURE";
  }

  if(sellShare>buyShare+8){
    pressure="SELL_PRESSURE";
  }

  const quantities=[
    ...bids.map(x=>x[1]),
    ...asks.map(x=>x[1])
  ];

  const med=median(quantities);

  const walls={
    buy:bids
      .filter(x=>x[1]>=med*4)
      .slice(0,10),
    sell:asks
      .filter(x=>x[1]>=med*4)
      .slice(0,10)
  };

  return {
    buy,
    sell,
    total,
    buyShare,
    sellShare,
    pressure,
    bestBid:bids[0]?.[0]??null,
    bestAsk:asks[0]?.[0]??null,
    bidLevels:bids.slice(0,20),
    askLevels:asks.slice(0,20),
    walls
  };
}

/* =========================================================
   FOOTPRINT
   ========================================================= */

async function footprint(category,symbol){

  const r=await bybit(
    `/v5/market/recent-trade?category=${category}`+
    `&symbol=${symbol}&limit=1000`
  );

  let buyVolume=0;
  let sellVolume=0;
  let buyNotional=0;
  let sellNotional=0;
  let buyTrades=0;
  let sellTrades=0;

  const trades=[];

  for(const t of r.list||[]){

    const size=num(t.size);
    const price=num(t.price);
    const side=String(t.side||"").toLowerCase();

    if(side==="buy"){
      buyVolume+=size;
      buyNotional+=size*price;
      buyTrades++;
    }

    if(side==="sell"){
      sellVolume+=size;
      sellNotional+=size*price;
      sellTrades++;
    }

    trades.push({
      price,
      size,
      side,
      time:num(t.time)
    });
  }

  const total=buyNotional+sellNotional;
  const delta=buyNotional-sellNotional;

  const deltaPercent=
    total?delta/total*100:0;

  let pressure="NEUTRAL";

  if(deltaPercent>=10){
    pressure="BUY_PRESSURE";
  }

  if(deltaPercent<=-10){
    pressure="SELL_PRESSURE";
  }

  const notionals=trades.map(
    x=>x.price*x.size
  );

  const p95=
    notionals.length
      ? [...notionals].sort((a,b)=>a-b)
        [Math.max(0,Math.floor(notionals.length*.95)-1)]
      :0;

  const averageNotional=avg(notionals);

  const largeThreshold=
    Math.max(
      averageNotional*5,
      p95
    );

  const largeBuys=trades
    .filter(x=>x.side==="buy"&&x.price*x.size>=largeThreshold);

  const largeSells=trades
    .filter(x=>x.side==="sell"&&x.price*x.size>=largeThreshold);

  return {
    buyVolume,
    sellVolume,
    buyNotional,
    sellNotional,
    buyTrades,
    sellTrades,
    delta,
    deltaPercent,
    pressure,
    averageNotional,
    largeThreshold,
    largeBuyCount:largeBuys.length,
    largeSellCount:largeSells.length,
    largeBuys:largeBuys.slice(-20),
    largeSells:largeSells.slice(-20)
  };
}

/* =========================================================
   FUTURES DATA
   ========================================================= */

async function futuresData(symbol){

  const result={
    ticker:null,
    oi:null,
    funding:null,
    ratio:null
  };

  try{

    const r=await bybit(
      `/v5/market/tickers?category=linear&symbol=${symbol}`
    );

    result.ticker=r.list?.[0]||null;

  }catch{}

  try{

    const r=await bybit(
      `/v5/market/open-interest?category=linear`+
      `&symbol=${symbol}&intervalTime=5min&limit=1`
    );

    result.oi=r.list?.[0]||null;

  }catch{}

  try{

    const r=await bybit(
      `/v5/market/funding/history?category=linear`+
      `&symbol=${symbol}&limit=1`
    );

    result.funding=r.list?.[0]||null;

  }catch{}

  try{

    const r=await bybit(
      `/v5/market/account-ratio?category=linear`+
      `&symbol=${symbol}&period=5min&limit=1`
    );

    result.ratio=r.list?.[0]||null;

  }catch{}

  return result;
}

/* =========================================================
   TRADING STYLE ANALYSIS
   ========================================================= */

function tradingStyles(a){

  const x=a.selectedAnalysis||{};

  const styles=[];

  const price=x.price||0;
  const ma20=x.ma20||0;
  const ema20=x.ema20||0;
  const ema50=x.ema50||0;
  const r=x.rsi||50;
  const mac=x.macd||0;

  if(
    price>ma20 &&
    ema20>ema50 &&
    r>52
  ){
    styles.push({
      name:"Trend Following",
      direction:"LONG BIAS",
      reason:"Price and moving averages support the trend."
    });
  }

  if(
    price<ma20 &&
    ema20<ema50 &&
    r<48
  ){
    styles.push({
      name:"Trend Following",
      direction:"SHORT BIAS",
      reason:"Price and moving averages support the downtrend."
    });
  }

  if(
    r<=30
  ){
    styles.push({
      name:"Mean Reversion",
      direction:"POTENTIAL LONG",
      reason:"RSI is deeply oversold."
    });
  }

  if(
    r>=70
  ){
    styles.push({
      name:"Mean Reversion",
      direction:"POTENTIAL SHORT",
      reason:"RSI is deeply overbought."
    });
  }

  if(
    x.structure?.bos==="BULLISH_BOS"
  ){
    styles.push({
      name:"Breakout",
      direction:"BULLISH",
      reason:"Bullish break of structure detected."
    });
  }

  if(
    x.structure?.bos==="BEARISH_BOS"
  ){
    styles.push({
      name:"Breakout",
      direction:"BEARISH",
      reason:"Bearish break of structure detected."
    });
  }

  if(
    x.liquiditySweep?.bullish?.length
  ){
    styles.push({
      name:"Smart Money / Liquidity",
      direction:"BULLISH",
      reason:"Recent downside liquidity sweep detected."
    });
  }

  if(
    x.liquiditySweep?.bearish?.length
  ){
    styles.push({
      name:"Smart Money / Liquidity",
      direction:"BEARISH",
      reason:"Recent upside liquidity sweep detected."
    });
  }

  if(
    x.divergence?.bullish
  ){
    styles.push({
      name:"Divergence",
      direction:"BULLISH",
      reason:"Bullish RSI divergence detected."
    });
  }

  if(
    x.divergence?.bearish
  ){
    styles.push({
      name:"Divergence",
      direction:"BEARISH",
      reason:"Bearish RSI divergence detected."
    });
  }

  if(
    mac>0 &&
    x.macdHistogram>0
  ){
    styles.push({
      name:"Momentum",
      direction:"BULLISH",
      reason:"MACD momentum is positive."
    });
  }

  if(
    mac<0 &&
    x.macdHistogram<0
  ){
    styles.push({
      name:"Momentum",
      direction:"BEARISH",
      reason:"MACD momentum is negative."
    });
  }

  if(
    x.volumeRatio>=1.5
  ){
    styles.push({
      name:"Volume Expansion",
      direction:"ACTIVE",
      reason:"Volume is significantly above average."
    });
  }

  return styles;
}

/* =========================================================
   DEEP ANALYZE
   ========================================================= */

async function deepAnalyze(symbol,requestedTf="15"){

  symbol=cleanSymbol(symbol);

  if(!symbol){
    throw new Error("Symbol is required");
  }

  const category=await findMarket(symbol);

  if(!category){
    throw new Error(
      `Symbol ${symbol} not found on Bybit`
    );
  }

  const selected=
    TF_LIST.some(x=>x.id===requestedTf)
      ?requestedTf
      :"15";

  const analyses=[];

  for(const tf of TF_LIST){

    try{

      const a=await analyzeTimeframe(
        category,
        symbol,
        tf.id
      );

      analyses.push(a);

    }catch{}

    await sleep(40);
  }

  const selectedAnalysis=
    analyses.find(x=>x.tf===selected)||
    analyses[0];

  const [
    order,
    foot,
    futures
  ]=await Promise.all([
    orderBook(category,symbol).catch(()=>null),
    footprint(category,symbol).catch(()=>null),
    category==="linear"
      ?futuresData(symbol)
      :Promise.resolve(null)
  ]);

  const styles=
    tradingStyles({
      selectedAnalysis
    });

  const price=
    selectedAnalysis?.price||
    num(futures?.ticker?.lastPrice)||
    0;

  const atrValue=
    selectedAnalysis?.atr||0;

  return {
    symbol,
    category,
    requestedTimeframe:selected,
    selectedAnalysis,
    analyses,
    orderBook:order,
    footprint:foot,
    futures,
    tradingStyles:styles,
    price,
    generatedAt:new Date().toISOString()
  };
}

/* =========================================================
   NEWS
   ========================================================= */

const NEWS_FEEDS=[
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.bbci.co.uk/news/business/rss.xml",
  "https://feeds.bbci.co.uk/news/technology/rss.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"
];

function stripXml(s){

  return String(s||"")
    .replace(/<!\[CDATA\[/g,"")
    .replace(/\]\]>/g,"")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function xmlItems(xml){

  const items=[];

  const blocks=
    xml.match(/<item[\s\S]*?<\/item>/gi)||[];

  for(const block of blocks){

    const title=
      stripXml(
        (block.match(
          /<title[^>]*>([\s\S]*?)<\/title>/i
        )||[])[1]
      );

    const link=
      stripXml(
        (block.match(
          /<link[^>]*>([\s\S]*?)<\/link>/i
        )||[])[1]
      );

    const pub=
      stripXml(
        (block.match(
          /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i
        )||[])[1]
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

  for(const url of NEWS_FEEDS){

    try{

      const r=await fetch(url,{
        headers:{
          "user-agent":"Global-Pulse/4.0"
        }
      });

      if(!r.ok)continue;

      all.push(
        ...xmlItems(await r.text())
      );

    }catch{}
  }

  const seen=new Set();
  const result=[];

  for(const x of all){

    const k=x.title.toLowerCase();

    if(seen.has(k))continue;

    seen.add(k);
    result.push(x);
  }

  return result.slice(0,20);
}

/* =========================================================
   COUNTRY TRENDS
   ========================================================= */

async function fetchCountryTrend(country){

  try{

    const r=await fetch(
      `https://trends.google.com/trending/rss?geo=${country.code}`,
      {
        headers:{
          "user-agent":"Mozilla/5.0 Global-Pulse"
        }
      }
    );

    if(!r.ok)throw new Error();

    const items=xmlItems(await r.text());

    return {
      country:country.name,
      code:country.code,
      trends:items.slice(0,10).map(x=>x.title)
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

  for(const url of SHOPPING_FEEDS){

    try{

      const r=await fetch(url,{
        headers:{
          "user-agent":"Global-Pulse/4.0"
        }
      });

      if(!r.ok)continue;

      all.push(
        ...xmlItems(await r.text())
      );

    }catch{}
  }

  const seen=new Set();
  const result=[];

  for(const x of all){

    const k=x.title.toLowerCase();

    if(seen.has(k))continue;

    seen.add(k);
    result.push(x);
  }

  return result.slice(0,20);
}

/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(env,method,body){

  if(!env.TELEGRAM_BOT_TOKEN){
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  const r=await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method:"POST",
      headers:{
        "content-type":"application/json"
      },
      body:JSON.stringify(body)
    }
  );

  const j=await r.json();

  if(!j.ok){
    throw new Error(
      j.description||"Telegram error"
    );
  }

  return j;
}

async function sendTelegram(env,message){

  if(!env.TELEGRAM_CHANNEL_ID){
    throw new Error(
      "TELEGRAM_CHANNEL_ID is missing"
    );
  }

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
   TELEGRAM FORMATTERS
   ========================================================= */

function newsMessage(items){

  let s=
`🌍 GLOBAL PULSE
📰 GLOBAL NEWS RADAR

`;

  for(const x of items.slice(0,8)){

    s+=`• ${x.title}\n`;

    if(x.link){
      s+=`${x.link}\n`;
    }

    s+="\n";
  }

  return s+
`━━━━━━━━━━━━━━━━
🌐 Global Pulse`;
}

function trendMessage(data){

  let s=
`🔥 COUNTRY TREND RADAR

🌍 ${data.country}

`;

  if(!data.trends.length){

    s+="No reliable trend data available.\n";

  }else{

    data.trends.forEach(
      (x,i)=>{
        s+=`${i+1}. ${x}\n`;
      }
    );
  }

  return s+
`━━━━━━━━━━━━━━━━
📊 Google Trends
🌐 Global Pulse`;
}

function shoppingMessage(items){

  let s=
`🛒 GLOBAL SHOPPING RADAR

🔥 Popular deals & consumer topics

`;

  for(const x of items.slice(0,8)){

    s+=`• ${x.title}\n`;

    if(x.link){
      s+=`${x.link}\n`;
    }

    s+="\n";
  }

  return s+
`━━━━━━━━━━━━━━━━
⚠️ Prices and availability can change.
🌐 Global Pulse`;
}

function cryptoMessage(a){

  const x=a.selectedAnalysis||{};

  let s=
`🪙 GLOBAL PULSE CRYPTO RADAR

${a.symbol}

⏱ ${a.requestedTimeframe}

💰 Price: ${a.price}

━━━━━━━━━━━━━━━━

📊 MARKET STRUCTURE
Trend: ${x.structure?.trend||"UNKNOWN"}
BOS: ${x.structure?.bos||"NONE"}
CHoCH: ${x.structure?.choch||"NONE"}

━━━━━━━━━━━━━━━━

📈 INDICATORS

RSI: ${num(x.rsi).toFixed(2)}
MACD: ${num(x.macd).toFixed(4)}
MACD Signal: ${num(x.macdSignal).toFixed(4)}
Histogram: ${num(x.macdHistogram).toFixed(4)}

MA20: ${x.ma20}
MA50: ${x.ma50}
EMA20: ${x.ema20}
EMA50: ${x.ema50}

ATR: ${x.atr}
Volume Ratio: ${num(x.volumeRatio).toFixed(2)}

━━━━━━━━━━━━━━━━

🧠 DIVERGENCE
${x.divergence?.type||"NONE"}

💧 LIQUIDITY
Bullish Sweeps: ${x.liquiditySweep?.bullish?.length||0}
Bearish Sweeps: ${x.liquiditySweep?.bearish?.length||0}

━━━━━━━━━━━━━━━━

📚 ORDER BOOK
${a.orderBook
  ?`Buy: ${a.orderBook.buyShare.toFixed(1)}%
Sell: ${a.orderBook.sellShare.toFixed(1)}%
Pressure: ${a.orderBook.pressure}`
  :"Unavailable"}

━━━━━━━━━━━━━━━━

👣 FOOTPRINT
${a.footprint
  ?`Buy Notional: ${a.footprint.buyNotional.toFixed(2)}
Sell Notional: ${a.footprint.sellNotional.toFixed(2)}
Delta: ${a.footprint.deltaPercent.toFixed(2)}%
Pressure: ${a.footprint.pressure}`
  :"Unavailable"}

━━━━━━━━━━━━━━━━

🎯 TRADING STYLES

${a.tradingStyles.length
  ?a.tradingStyles.map(
    z=>`• ${z.name}
${z.direction}
${z.reason}`
  ).join("\n\n")
  :"No active setup detected."}

━━━━━━━━━━━━━━━━

⚠️ Market analysis only.
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   AUTOMATIC CHANNEL PUBLISH
   ========================================================= */

async function automaticPublish(env){

  const news=await fetchNews();

  if(news.length){

    try{
      await sendTelegram(
        env,
        newsMessage(news)
      );
    }catch{}
  }

  await sleep(1000);

  const country=
    COUNTRIES[
      Math.floor(
        Math.random()*COUNTRIES.length
      )
    ];

  const trend=
    await fetchCountryTrend(country);

  try{

    await sendTelegram(
      env,
      trendMessage(trend)
    );

  }catch{}

  await sleep(1000);

  const shopping=
    await fetchShopping();

  if(shopping.length){

    try{

      await sendTelegram(
        env,
        shoppingMessage(shopping)
      );

    }catch{}
  }

  await sleep(1000);

  /*
     یک ارز در هر اجرای Cron.
     بازار به‌صورت خودکار پیدا می‌شود.
  */

  const crypto=
    AUTO_CRYPTO[
      Math.floor(
        Math.random()*AUTO_CRYPTO.length
      )
    ];

  try{

    const analysis=
      await deepAnalyze(
        crypto,
        "15"
      );

    await sendTelegram(
      env,
      cryptoMessage(analysis)
    );

  }catch{}
}

/* =========================================================
   LIVE CRYPTO WEB APP
   ========================================================= */

function appHTML(origin){

return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width,initial-scale=1,maximum-scale=1">

<title>Global Pulse Crypto Terminal</title>

<style>

*{
 box-sizing:border-box;
}

body{
 margin:0;
 background:#071018;
 color:#e8f0f7;
 font-family:
 system-ui,
 -apple-system,
 BlinkMacSystemFont,
 "Segoe UI",
 sans-serif;
}

header{
 padding:18px;
 background:#0c1722;
 border-bottom:1px solid #1d3445;
 position:sticky;
 top:0;
 z-index:20;
}

h1{
 margin:0 0 6px;
 font-size:22px;
}

.sub{
 color:#8ea7b8;
 font-size:13px;
}

.container{
 max-width:1250px;
 margin:auto;
 padding:14px;
}

.search{
 display:flex;
 gap:8px;
 margin-bottom:12px;
}

input,select,button{
 border:1px solid #294354;
 background:#0c1b27;
 color:#fff;
 border-radius:10px;
 padding:12px;
 font-size:15px;
}

input{
 flex:1;
 min-width:0;
 direction:ltr;
}

button{
 cursor:pointer;
}

button:hover{
 background:#132838;
}

#status{
 padding:10px;
 border-radius:10px;
 background:#0d1d29;
 margin-bottom:12px;
 color:#9bc7dc;
}

.chart{
 height:440px;
 background:#050b10;
 border:1px solid #1d3445;
 border-radius:14px;
 overflow:hidden;
 position:relative;
}

canvas{
 width:100%;
 height:100%;
 display:block;
}

.pricebar{
 display:grid;
 grid-template-columns:
 repeat(auto-fit,minmax(150px,1fr));
 gap:8px;
 margin:12px 0;
}

.metric{
 background:#0c1a25;
 border:1px solid #1d3445;
 border-radius:12px;
 padding:12px;
}

.metric small{
 display:block;
 color:#7892a4;
 margin-bottom:5px;
}

.metric b{
 font-size:17px;
 direction:ltr;
 display:block;
}

details{
 background:#0b1924;
 border:1px solid #1d3445;
 border-radius:12px;
 margin:9px 0;
 overflow:hidden;
}

summary{
 padding:14px;
 cursor:pointer;
 font-weight:700;
}

.section{
 padding:14px;
 border-top:1px solid #1d3445;
}

.grid{
 display:grid;
 grid-template-columns:
 repeat(auto-fit,minmax(180px,1fr));
 gap:8px;
}

.card{
 background:#08131c;
 border:1px solid #1b3140;
 padding:10px;
 border-radius:9px;
}

.card small{
 color:#7e98aa;
}

.ltr{
 direction:ltr;
 text-align:left;
}

.good{
 color:#64df9b;
}

.bad{
 color:#ff7777;
}

.neutral{
 color:#f0c674;
}

table{
 width:100%;
 border-collapse:collapse;
}

td,th{
 padding:8px;
 border-bottom:1px solid #1d3445;
 text-align:right;
}

pre{
 white-space:pre-wrap;
 word-break:break-word;
 color:#b8cad6;
}

@media(max-width:700px){

 .chart{
   height:330px;
 }

 .search{
   flex-wrap:wrap;
 }

 select{
   width:100%;
 }

}

</style>
</head>

<body>

<header>

<h1>🪙 Global Pulse — تحلیل هوشمند رمز ارز</h1>

<div class="sub">
تحلیل واقعی بازار Bybit — بدون انتخاب دستی Spot/Futures
</div>

</header>

<div class="container">

<div class="search">

<input
 id="symbol"
 value="BTCUSDT"
 placeholder="نام یا نماد ارز؛ مثال BTCUSDT"
 autocomplete="off">

<select id="tf">

${TF_LIST.map(
 x=>`<option value="${x.id}">
 ${x.label}
 </option>`
).join("")}

</select>

<button onclick="analyze()">
🔎 تحلیل
</button>

</div>

<div id="status">
🟡 آماده تحلیل
</div>

<div class="chart">
<canvas id="chart"></canvas>
</div>

<div class="pricebar">

<div class="metric">
<small>ارز</small>
<b id="mSymbol">-</b>
</div>

<div class="metric">
<small>قیمت</small>
<b id="mPrice">-</b>
</div>

<div class="metric">
<small>بازار</small>
<b id="mMarket">-</b>
</div>

<div class="metric">
<small>تایم‌فریم</small>
<b id="mTf">-</b>
</div>

</div>

<div id="result"></div>

</div>

<script>

const ORIGIN="${origin}";

let currentData=null;
let refreshTimer=null;

function esc(v){
 return String(v??"")
 .replaceAll("&","&amp;")
 .replaceAll("<","&lt;")
 .replaceAll(">","&gt;")
 .replaceAll('"',"&quot;");
}

function n(v,d=4){

 if(v===null||v===undefined) return "-";

 const x=Number(v);

 if(!Number.isFinite(x))return "-";

 return x.toLocaleString(
  "en-US",
  {
   maximumFractionDigits:d
  }
 );
}

function cls(v){

 if(
  String(v).includes("BULL")||
  String(v).includes("BUY")||
  String(v).includes("LONG")
 )return "good";

 if(
  String(v).includes("BEAR")||
  String(v).includes("SELL")||
  String(v).includes("SHORT")
 )return "bad";

 return "neutral";
}

function box(title,value){

 return \`
 <div class="card">
   <small>\${esc(title)}</small>
   <div class="ltr">\${esc(value)}</div>
 </div>
 \`;
}

async function analyze(){

 const symbol=
   document.getElementById("symbol")
   .value
   .trim();

 const tf=
   document.getElementById("tf")
   .value;

 if(!symbol){
   alert("نام یا نماد ارز را وارد کنید.");
   return;
 }

 const status=
   document.getElementById("status");

 status.textContent=
   "🟡 در حال دریافت اطلاعات واقعی Bybit...";

 try{

   const r=
     await fetch(
       ORIGIN+
       "/analyze?symbol="+
       encodeURIComponent(symbol)+
       "&timeframe="+tf
     );

   const j=await r.json();

   if(!j.ok){
     throw new Error(j.error||"Analysis failed");
   }

   currentData=j.data;

   render(j.data);

   status.textContent=
     "🟢 تحلیل زنده فعال است — "+
     new Date().toLocaleTimeString("fa-IR");

   startRefresh();

 }catch(e){

   status.textContent=
     "🔴 خطا: "+e.message;

 }

}

function startRefresh(){

 clearInterval(refreshTimer);

 refreshTimer=setInterval(
   analyze,
   15000
 );

}

function render(a){

 const x=a.selectedAnalysis||{};

 document.getElementById("mSymbol")
   .textContent=a.symbol;

 document.getElementById("mPrice")
   .textContent=n(a.price,8);

 document.getElementById("mMarket")
   .textContent=
     a.category==="linear"
       ?"Futures"
       :"Spot";

 document.getElementById("mTf")
   .textContent=a.requestedTimeframe;

 drawChart(x.candles||[]);

 let h="";

 h+=\`
 <details open>
 <summary>📊 اطلاعات اصلی تایم‌فریم انتخابی</summary>
 <div class="section grid">
 \`;

 h+=box("قیمت",n(x.price,8));
 h+=box("MA20",n(x.ma20,8));
 h+=box("MA50",n(x.ma50,8));
 h+=box("EMA20",n(x.ema20,8));
 h+=box("EMA50",n(x.ema50,8));
 h+=box("RSI",n(x.rsi,2));
 h+=box("MACD",n(x.macd,8));
 h+=box("MACD Signal",n(x.macdSignal,8));
 h+=box("MACD Histogram",n(x.macdHistogram,8));
 h+=box("ATR",n(x.atr,8));
 h+=box("Volume Ratio",n(x.volumeRatio,2));

 h+=\`
 </div>
 </details>
 \`;

 h+=\`
 <details>
 <summary>📈 MACD + RSI</summary>
 <div class="section grid">
 \`;

 h+=box(
  "RSI وضعیت",
  x.rsi>=70
   ?"OVERBOUGHT"
   :x.rsi<=30
    ?"OVERSOLD"
    :"NEUTRAL"
 );

 h+=box(
  "MACD",
  n(x.macd,8)
 );

 h+=box(
  "Histogram",
  n(x.macdHistogram,8)
 );

 h+=\`
 </div>
 </details>
 \`;

 const sr=x.supportResistance||{};

 h+=\`
 <details>
 <summary>🧱 حمایت و مقاومت</summary>
 <div class="section">
 <div class="grid">
 \`;

 (sr.supports||[]).slice().reverse()
 .forEach(v=>{
   h+=box("Support",n(v,8));
 });

 (sr.resistances||[]).slice().reverse()
 .forEach(v=>{
   h+=box("Resistance",n(v,8));
 });

 h+=\`
 </div>
 </div>
 </details>
 \`;

 const st=x.structure||{};

 h+=\`
 <details>
 <summary>🏗 ساختار بازار — BOS / CHoCH</summary>
 <div class="section grid">
 \`;

 h+=box("Trend",st.trend);
 h+=box("BOS",st.bos);
 h+=box("CHoCH",st.choch);
 h+=box("Swing High",n(st.swingHigh,8));
 h+=box("Swing Low",n(st.swingLow,8));

 h+=\`
 </div>
 </details>
 \`;

 const div=x.divergence||{};

 h+=\`
 <details>
 <summary>🔀 واگرایی</summary>
 <div class="section grid">
 \`;

 h+=box("RSI Divergence",div.type);

 h+=\`
 </div>
 </details>
 \`;

 const fvg=x.fvg||{};

 h+=\`
 <details>
 <summary>🕳 Fair Value Gap — FVG</summary>
 <div class="section">

 <h4>🟢 Bullish FVG</h4>
 <div class="grid">
 \`;

 (fvg.bullish||[]).slice(-8).reverse()
 .forEach(v=>{
   h+=box(
    "Zone",
    n(v.from,8)+" → "+n(v.to,8)
   );
 });

 h+=\`
 </div>

 <h4>🔴 Bearish FVG</h4>
 <div class="grid">
 \`;

 (fvg.bearish||[]).slice(-8).reverse()
 .forEach(v=>{
   h+=box(
    "Zone",
    n(v.from,8)+" → "+n(v.to,8)
   );
 });

 h+=\`
 </div>
 </div>
 </details>
 \`;

 const ob=x.orderBlocks||{};

 h+=\`
 <details>
 <summary>📦 Order Block</summary>
 <div class="section grid">
 \`;

 (ob.bullish||[]).slice(-6).reverse()
 .forEach(v=>{
   h+=box(
    "Bullish OB",
    n(v.low,8)+" → "+n(v.high,8)
   );
 });

 (ob.bearish||[]).slice(-6).reverse()
 .forEach(v=>{
   h+=box(
    "Bearish OB",
    n(v.low,8)+" → "+n(v.high,8)
   );
 });

 h+=\`
 </div>
 </details>
 \`;

 const li=x.liquiditySweep||{};

 h+=\`
 <details>
 <summary>💧 Liquidity Sweep / Hunt</summary>
 <div class="section grid">
 \`;

 h+=box(
  "Bullish Sweeps",
  (li.bullish||[]).length
 );

 h+=box(
  "Bearish Sweeps",
  (li.bearish||[]).length
 );

 h+=\`
 </div>
 </details>
 \`;

 const obook=a.orderBook;

 h+=\`
 <details>
 <summary>📖 Order Book + دیوارهای خرید و فروش</summary>
 <div class="section">
 \`;

 if(obook){

   h+=\`
   <div class="grid">
   \`;

   h+=box(
    "Buy Share",
    n(obook.buyShare,2)+"%"
   );

   h+=box(
    "Sell Share",
    n(obook.sellShare,2)+"%"
   );

   h+=box(
    "Pressure",
    obook.pressure
   );

   h+=box(
    "Best Bid",
    n(obook.bestBid,8)
   );

   h+=box(
    "Best Ask",
    n(obook.bestAsk,8)
   );

   h+=\`
   </div>

   <h4>🟢 Buy Walls</h4>
   <div class="grid">
   \`;

   (obook.walls?.buy||[]).forEach(v=>{
     h+=box(
      "Buy Wall",
      n(v[0],8)+" | "+n(v[1],4)
     );
   });

   h+=\`
   </div>

   <h4>🔴 Sell Walls</h4>
   <div class="grid">
   \`;

   (obook.walls?.sell||[]).forEach(v=>{
     h+=box(
      "Sell Wall",
      n(v[0],8)+" | "+n(v[1],4)
     );
   });

   h+=\`</div>\`;

 }else{

   h+="<p>Order Book unavailable.</p>";

 }

 h+=\`
 </div>
 </details>
 \`;

 const fp=a.footprint;

 h+=\`
 <details>
 <summary>👣 Footprint + Delta</summary>
 <div class="section grid">
 \`;

 if(fp){

   h+=box(
    "Buy Volume",
    n(fp.buyVolume,4)
   );

   h+=box(
    "Sell Volume",
    n(fp.sellVolume,4)
   );

   h+=box(
    "Buy Notional",
    n(fp.buyNotional,2)
   );

   h+=box(
    "Sell Notional",
    n(fp.sellNotional,2)
   );

   h+=box(
    "Delta",
    n(fp.delta,2)
   );

   h+=box(
    "Delta %",
    n(fp.deltaPercent,2)+"%"
   );

   h+=box(
    "Pressure",
    fp.pressure
   );

   h+=box(
    "Large Buys",
    fp.largeBuyCount
   );

   h+=box(
    "Large Sells",
    fp.largeSellCount
   );

 }else{

   h+="<p>Footprint unavailable.</p>";

 }

 h+=\`
 </div>
 </details>
 \`;

 const fut=a.futures;

 h+=\`
 <details>
 <summary>📊 Futures Data — OI / Funding / Long Short</summary>
 <div class="section grid">
 \`;

 if(fut){

   h+=box(
    "Open Interest",
    fut.oi?.openInterest||
    fut.ticker?.openInterest||
    "-"
   );

   h+=box(
    "Funding",
    fut.funding?.fundingRate||
    fut.ticker?.fundingRate||
    "-"
   );

   h+=box(
    "Buy Ratio",
    fut.ratio?.buyRatio||
    "-"
   );

   h+=box(
    "Sell Ratio",
    fut.ratio?.sellRatio||
    "-"
   );

   h+=box(
    "24H Change",
    fut.ticker?.price24hPcnt||
    "-"
   );

   h+=box(
    "24H High",
    fut.ticker?.highPrice24h||
    "-"
   );

   h+=box(
    "24H Low",
    fut.ticker?.lowPrice24h||
    "-"
   );

 }else{

   h+="<p>این ارز اطلاعات Futures در دسترس ندارد.</p>";

 }

 h+=\`
 </div>
 </details>
 \`;

 h+=\`
 <details>
 <summary>🧠 انواع سبک‌های معاملاتی</summary>
 <div class="section">
 \`;

 if(a.tradingStyles?.length){

   a.tradingStyles.forEach(z=>{

     h+=\`
     <div class="card" style="margin-bottom:8px">
       <b>\${esc(z.name)}</b>
       <div class="\${cls(z.direction)}">
         \${esc(z.direction)}
       </div>
       <small>
         \${esc(z.reason)}
       </small>
     </div>
     \`;

   });

 }else{

   h+=`
   <div class="card">
   در این لحظه Setup مشخصی برای سبک‌های تعریف‌شده
   فعال نیست.
   </div>
   `;

 }

 h+=\`
 </div>
 </details>
 \`;

 h+=\`
 <details>
 <summary>⏱ تحلیل تمام تایم‌فریم‌ها</summary>
 <div class="section">
 <table>
 <tr>
 <th>TF</th>
 <th>Price</th>
 <th>RSI</th>
 <th>MACD</th>
 <th>Structure</th>
 <th>Direction</th>
 </tr>
 \`;

 (a.analyses||[]).forEach(z=>{

   h+=\`
   <tr>
    <td>\${esc(z.tf)}</td>
    <td class="ltr">\${n(z.price,8)}</td>
    <td class="ltr">\${n(z.rsi,2)}</td>
    <td class="ltr">\${n(z.macd,6)}</td>
    <td>\${esc(z.structure?.trend||"-")}</td>
    <td class="\${cls(z.direction)}">
      \${esc(z.direction)}
    </td>
   </tr>
   \`;

 });

 h+=\`
 </table>
 </div>
 </details>
 \`;

 document.getElementById("result")
   .innerHTML=h;

}

function drawChart(candles){

 const canvas=
   document.getElementById("chart");

 const rect=
   canvas.getBoundingClientRect();

 const dpr=
   window.devicePixelRatio||1;

 canvas.width=
   rect.width*dpr;

 canvas.height=
   rect.height*dpr;

 const ctx=canvas.getContext("2d");

 ctx.scale(dpr,dpr);

 const w=rect.width;
 const h=rect.height;

 ctx.clearRect(0,0,w,h);

 if(!candles.length)return;

 const data=
   candles.slice(-100);

 const highs=
   data.map(x=>x.high);

 const lows=
   data.map(x=>x.low);

 const max=Math.max(...highs);
 const min=Math.min(...lows);

 const range=max-min||1;

 const pad=25;

 const cw=
   (w-pad*2)/data.length;

 function y(v){

   return pad+
     (max-v)/range*
     (h-pad*2);

 }

 function x(i){

   return pad+
     i*cw+
     cw/2;

 }

 ctx.strokeStyle="#1c3444";
 ctx.lineWidth=1;

 for(let i=0;i<6;i++){

   const yy=
     pad+
     i*(h-pad*2)/5;

   ctx.beginPath();
   ctx.moveTo(0,yy);
   ctx.lineTo(w,yy);
   ctx.stroke();

 }

 data.forEach((c,i)=>{

   const xx=x(i);

   ctx.beginPath();
   ctx.moveTo(xx,y(c.high));
   ctx.lineTo(xx,y(c.low));
   ctx.stroke();

   const top=y(Math.max(c.open,c.close));
   const bottom=y(Math.min(c.open,c.close));

   const body=
     Math.max(1,bottom-top);

   ctx.fillStyle=
     c.close>=c.open
       ?"rgba(70,220,145,.85)"
       :"rgba(255,90,100,.85)";

   ctx.fillRect(
     xx-cw*.32,
     top,
     cw*.64,
     body
   );

 });

 const last=data.at(-1);

 ctx.fillStyle="#fff";
 ctx.font="12px sans-serif";

 ctx.fillText(
   n(last.close,8),
   10,
   20
 );

}

window.addEventListener(
 "resize",
 ()=>{
   if(currentData){
     drawChart(
       currentData.selectedAnalysis?.candles||[]
     );
   }
 );

document
 .getElementById("symbol")
 .addEventListener(
   "keydown",
   e=>{
     if(e.key==="Enter"){
       analyze();
     }
   }
 );

analyze();

</script>

</body>
</html>`;
}

/* =========================================================
   ROUTER
   ========================================================= */

export default {

  async fetch(request,env){

    const url=new URL(request.url);
    const path=url.pathname;

    try{

      /* HOME */

      if(
        path==="/"||
        path==="/crypto"||
        path==="/index.html"
      ){

        return html(
          appHTML(url.origin)
        );
      }

      /* HEALTH */

      if(path==="/health"){

        let channel=false;

        try{

          if(env.TELEGRAM_CHANNEL_ID){

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

        }catch{}

        return json({
          ok:true,
          project:"Global Pulse",
          version:VERSION,
          telegram:!!env.TELEGRAM_BOT_TOKEN,
          channel,
          bybit:true,
          cryptoTerminal:true,
          automaticPublish:true,
          time:new Date().toISOString()
        });
      }

      /* ANALYZE */

      if(path==="/analyze"){

        const symbol=
          cleanSymbol(
            url.searchParams.get("symbol")
          );

        const timeframe=
          url.searchParams.get("timeframe")||
          "15";

        if(!symbol){

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

      /* NEWS */

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
          count:items.length
        });
      }

      /* TREND */

      if(path==="/test-trend"){

        const country=COUNTRIES[0];

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

      /* SHOPPING */

      if(path==="/test-shopping"){

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

      /* CRYPTO */

      if(path==="/test-crypto"){

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

      /* PUBLISH ALL */

      if(path==="/publish"){

        await automaticPublish(env);

        return json({
          ok:true,
          published:true
        });
      }

      /* WEBHOOK */

      if(path==="/telegram/webhook"){

        if(request.method!=="POST"){
          return json({
            ok:true,
            webhook:true
          });
        }

        const update=
          await request.json();

        return json({
          ok:true,
          received:true,
          update_id:update.update_id??null
        });
      }

      /* SET WEBHOOK */

      if(path==="/setup-webhook"){

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

      return json({
        ok:false,
        error:"Not Found",
        path
      },404);

    }catch(e){

      return json({
        ok:false,
        version:VERSION,
        error:e.message||String(e)
      },500);
    }
  },

  async scheduled(event,env,ctx){

    ctx.waitUntil(
      automaticPublish(env)
    );

  }

};
