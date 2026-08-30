/* =========================================================
   GLOBAL PULSE V8
   Global News + Country Trends + Shopping
   + Interactive Crypto Radar Telegram Bot
   + Bybit Deep Analysis
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V8";
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

const TF_LIST = ["1","3","5","15","30","60","240","D"];

const sleep = ms => new Promise(r => setTimeout(r,ms));

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{
      "content-type":"application/json; charset=UTF-8",
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
  if(!a.length) return 0;
  return a.reduce((x,y)=>x+y,0)/a.length;
}

function sma(v,p){
  if(v.length<p) return null;
  return avg(v.slice(-p));
}

function ema(v,p){
  if(v.length<p) return null;

  const k=2/(p+1);
  let e=avg(v.slice(0,p));

  for(let i=p;i<v.length;i++){
    e=v[i]*k+e*(1-k);
  }

  return e;
}

function stddev(v,p){
  if(v.length<p) return null;

  const a=v.slice(-p);
  const m=avg(a);

  return Math.sqrt(
    avg(a.map(x=>(x-m)*(x-m)))
  );
}

function rsi(v,p=14){
  if(v.length<p+1) return null;

  let gain=0;
  let loss=0;

  for(let i=1;i<=p;i++){
    const d=v[i]-v[i-1];

    if(d>=0) gain+=d;
    else loss-=d;
  }

  let ag=gain/p;
  let al=loss/p;

  for(let i=p+1;i<v.length;i++){
    const d=v[i]-v[i-1];
    const g=Math.max(d,0);
    const l=Math.max(-d,0);

    ag=((ag*(p-1))+g)/p;
    al=((al*(p-1))+l)/p;
  }

  if(al===0) return 100;

  return 100-(100/(1+(ag/al)));
}

function macd(v){
  if(v.length<35) return null;

  const fast=ema(v,12);
  const slow=ema(v,26);

  if(fast==null||slow==null) return null;

  const line=fast-slow;
  const series=[];

  for(let i=26;i<v.length;i++){
    const f=ema(v.slice(0,i+1),12);
    const s=ema(v.slice(0,i+1),26);

    if(f!=null&&s!=null){
      series.push(f-s);
    }
  }

  const signal=ema(series,9);

  return {
    line,
    signal,
    histogram:signal==null?null:line-signal
  };
}

function atr(c,p=14){
  if(c.length<p+1) return null;

  const tr=[];

  for(let i=1;i<c.length;i++){
    const x=c[i];
    const prev=c[i-1];

    tr.push(
      Math.max(
        x.high-x.low,
        Math.abs(x.high-prev.close),
        Math.abs(x.low-prev.close)
      )
    );
  }

  return avg(tr.slice(-p));
}

function bollinger(v,p=20,m=2){
  if(v.length<p) return null;

  const middle=sma(v,p);
  const sd=stddev(v,p);

  return {
    middle,
    upper:middle+m*sd,
    lower:middle-m*sd,
    width:middle?((m*2*sd)/middle)*100:0
  };
}

function stochastic(c,p=14){
  if(c.length<p) return null;

  const a=c.slice(-p);
  const high=Math.max(...a.map(x=>x.high));
  const low=Math.min(...a.map(x=>x.low));
  const close=a[a.length-1].close;

  if(high===low){
    return {k:50,d:50};
  }

  const k=((close-low)/(high-low))*100;

  const ks=[];

  for(let i=p;i<=c.length;i++){
    const q=c.slice(i-p,i);
    const h=Math.max(...q.map(x=>x.high));
    const l=Math.min(...q.map(x=>x.low));
    const cl=q[q.length-1].close;

    if(h!==l){
      ks.push(((cl-l)/(h-l))*100);
    }
  }

  return {
    k,
    d:avg(ks.slice(-3))
  };
}

function vwap(c){
  let pv=0;
  let vol=0;

  for(const x of c){
    const typical=(x.high+x.low+x.close)/3;
    pv+=typical*x.volume;
    vol+=x.volume;
  }

  return vol?pv/vol:null;
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

/* =========================================================
   BYBIT
   ========================================================= */

async function bybit(path){

  const r=await fetch(BYBIT+path,{
    headers:{
      "user-agent":"Global-Pulse/8.0"
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

/*
   BTC -> BTCUSDT
   PEPE -> PEPEUSDT
   BTCUSDT -> BTCUSDT
*/

async function findMarket(symbol){

  const raw=cleanSymbol(symbol);

  if(!raw){
    return null;
  }

  const candidates=[];

  candidates.push(raw);

  if(!raw.endsWith("USDT")){
    candidates.push(raw+"USDT");
  }

  for(const s of candidates){

    try{
      const r=await bybit(
        `/v5/market/instruments-info?category=linear&symbol=${s}`
      );

      if(r.list&&r.list.length){
        return {
          category:"linear",
          symbol:s
        };
      }
    }catch{}
  }

  for(const s of candidates){

    try{
      const r=await bybit(
        `/v5/market/instruments-info?category=spot&symbol=${s}`
      );

      if(r.list&&r.list.length){
        return {
          category:"spot",
          symbol:s
        };
      }
    }catch{}
  }

  return null;
}

/* =========================================================
   STRUCTURE
   ========================================================= */

function marketStructure(c){

  if(c.length<30) return "UNKNOWN";

  const r=c.slice(-30);

  const highs=r.map(x=>x.high);
  const lows=r.map(x=>x.low);

  const hh=highs[highs.length-1]>highs[0];
  const ll=lows[lows.length-1]>lows[0];

  if(hh&&ll) return "BULLISH_STRUCTURE";
  if(!hh&&!ll) return "BEARISH_STRUCTURE";

  return "RANGE";
}

function supportResistance(c){

  const recent=c.slice(-100);

  const highs=recent.map(x=>x.high).sort((a,b)=>b-a);
  const lows=recent.map(x=>x.low).sort((a,b)=>a-b);

  const resistance=[];
  const support=[];

  for(const x of highs){
    if(!resistance.some(v=>Math.abs(v-x)/x<0.003)){
      resistance.push(x);
    }

    if(resistance.length>=5) break;
  }

  for(const x of lows){
    if(!support.some(v=>Math.abs(v-x)/x<0.003)){
      support.push(x);
    }

    if(support.length>=5) break;
  }

  return {
    support,
    resistance
  };
}

/* =========================================================
   DIVERGENCE
   ========================================================= */

function divergence(c){

  if(c.length<50){
    return {
      rsi:"NONE",
      macd:"NONE",
      overall:"NONE"
    };
  }

  const closes=c.map(x=>x.close);
  const rsis=[];

  for(let i=14;i<closes.length;i++){
    const x=rsi(closes.slice(0,i+1),14);

    if(x!=null) rsis.push(x);
  }

  const priceOld=closes[closes.length-21];
  const priceNew=closes[closes.length-1];

  const rsiOld=rsis[Math.max(0,rsis.length-21)];
  const rsiNew=rsis[rsis.length-1];

  let rsiDiv="NONE";

  if(priceNew<priceOld && rsiNew>rsiOld){
    rsiDiv="BULLISH_DIVERGENCE";
  }

  if(priceNew>priceOld && rsiNew<rsiOld){
    rsiDiv="BEARISH_DIVERGENCE";
  }

  const m1=macd(closes.slice(0,-20));
  const m2=macd(closes);

  let macdDiv="NONE";

  if(m1&&m2){

    if(priceNew<priceOld && m2.line>m1.line){
      macdDiv="BULLISH_DIVERGENCE";
    }

    if(priceNew>priceOld && m2.line<m1.line){
      macdDiv="BEARISH_DIVERGENCE";
    }
  }

  let overall="NONE";

  if(
    rsiDiv==="BULLISH_DIVERGENCE" ||
    macdDiv==="BULLISH_DIVERGENCE"
  ){
    overall="BULLISH_DIVERGENCE";
  }

  if(
    rsiDiv==="BEARISH_DIVERGENCE" ||
    macdDiv==="BEARISH_DIVERGENCE"
  ){
    overall="BEARISH_DIVERGENCE";
  }

  return {
    rsi:rsiDiv,
    macd:macdDiv,
    overall
  };
}

/* =========================================================
   ORDER BOOK
   ========================================================= */

async function orderBook(category,symbol){

  const r=await bybit(
    `/v5/market/orderbook?category=${category}&symbol=${symbol}&limit=50`
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

  const buyShare=total?buy/total*100:50;
  const sellShare=total?sell/total*100:50;

  let pressure="NEUTRAL";

  if(buyShare>sellShare+8){
    pressure="BUY_PRESSURE";
  }

  if(sellShare>buyShare+8){
    pressure="SELL_PRESSURE";
  }

  const buyWalls=[
    ...bids
  ].sort((a,b)=>b[1]-a[1]).slice(0,5);

  const sellWalls=[
    ...asks
  ].sort((a,b)=>b[1]-a[1]).slice(0,5);

  return {
    buy,
    sell,
    buyShare,
    sellShare,
    pressure,
    bestBid:bids[0]?.[0]??null,
    bestAsk:asks[0]?.[0]??null,
    buyWalls,
    sellWalls
  };
}

/* =========================================================
   FOOTPRINT
   ========================================================= */

async function footprint(category,symbol){

  const r=await bybit(
    `/v5/market/recent-trade?category=${category}&symbol=${symbol}&limit=1000`
  );

  let buyVolume=0;
  let sellVolume=0;
  let buyNotional=0;
  let sellNotional=0;
  let buyTrades=0;
  let sellTrades=0;

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
   FUTURES
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
      `/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=1`
    );

    result.oi=r.list?.[0]||null;
  }catch{}

  try{
    const r=await bybit(
      `/v5/market/funding/history?category=linear&symbol=${symbol}&limit=1`
    );

    result.funding=r.list?.[0]||null;
  }catch{}

  try{
    const r=await bybit(
      `/v5/market/account-ratio?category=linear&symbol=${symbol}&period=5min&limit=1`
    );

    result.ratio=r.list?.[0]||null;
  }catch{}

  return result;
}

/* =========================================================
   TRADING STYLES
   ========================================================= */

function tradingStyles(x){

  const result=[];

  const trend=x.structure;
  const r=x.rsi;
  const m=x.macd;
  const st=x.stochastic;
  const price=x.price;
  const vw=x.vwap;

  if(
    trend==="BULLISH_STRUCTURE" &&
    r>50 &&
    m>0
  ){
    result.push("TREND_FOLLOWING_LONG");
  }

  if(
    trend==="BEARISH_STRUCTURE" &&
    r<50 &&
    m<0
  ){
    result.push("TREND_FOLLOWING_SHORT");
  }

  if(
    r<30 &&
    st?.k<25
  ){
    result.push("REVERSAL_LONG");
  }

  if(
    r>70 &&
    st?.k>75
  ){
    result.push("REVERSAL_SHORT");
  }

  if(
    x.bb &&
    price<=x.bb.lower
  ){
    result.push("BOLLINGER_MEAN_REVERSION_LONG");
  }

  if(
    x.bb &&
    price>=x.bb.upper
  ){
    result.push("BOLLINGER_MEAN_REVERSION_SHORT");
  }

  if(
    vw &&
    price>vw
  ){
    result.push("VWAP_LONG_BIAS");
  }

  if(
    vw &&
    price<vw
  ){
    result.push("VWAP_SHORT_BIAS");
  }

  if(
    x.orderBook?.pressure==="BUY_PRESSURE" &&
    x.footprint?.pressure==="BUY_PRESSURE"
  ){
    result.push("ORDER_FLOW_LONG");
  }

  if(
    x.orderBook?.pressure==="SELL_PRESSURE" &&
    x.footprint?.pressure==="SELL_PRESSURE"
  ){
    result.push("ORDER_FLOW_SHORT");
  }

  if(!result.length){
    result.push("NO_CLEAR_SETUP");
  }

  return result;
}

/* =========================================================
   TIMEFRAME ANALYSIS
   ========================================================= */

async function analyzeTimeframe(category,symbol,tf){

  const candles=await getKlines(
    category,
    symbol,
    tf,
    200
  );

  if(candles.length<60){
    throw new Error(`Insufficient ${tf} timeframe data`);
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
  const st=stochastic(candles,14);
  const vw=vwap(candles);

  const structure=marketStructure(candles);
  const sr=supportResistance(candles);
  const div=divergence(candles);

  const volumeNow=candles.at(-1).volume;

  const volumeAvg=
    avg(candles.slice(-21,-1).map(x=>x.volume));

  const volumeRatio=
    volumeAvg?volumeNow/volumeAvg:0;

  let momentum="NEUTRAL";

  if(
    r>55 &&
    m?.histogram>0
  ){
    momentum="BULLISH";
  }

  if(
    r<45 &&
    m?.histogram<0
  ){
    momentum="BEARISH";
  }

  const x={
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
    bb,
    stochastic:st,
    vwap:vw,
    volumeRatio,
    structure,
    supportResistance:sr,
    divergence:div,
    momentum
  };

  return x;
}

/* =========================================================
   DEEP ANALYSIS
   ========================================================= */

async function deepAnalyze(inputSymbol,requestedTf="15"){

  const market=await findMarket(inputSymbol);

  if(!market){
    throw new Error(
      `Symbol ${cleanSymbol(inputSymbol)} not found on Bybit`
    );
  }

  const symbol=market.symbol;
  const category=market.category;

  const selected=
    TF_LIST.includes(String(requestedTf))
      ? String(requestedTf)
      : "15";

  const analyses=[];

  for(const tf of TF_LIST){

    try{
      analyses.push(
        await analyzeTimeframe(
          category,
          symbol,
          tf
        )
      );
    }catch{}

    await sleep(70);
  }

  const selectedAnalysis=
    analyses.find(x=>x.tf===selected)||
    analyses.find(x=>x.tf==="15")||
    analyses[0];

  const [order,foot,futures]=await Promise.all([

    orderBook(category,symbol)
      .catch(()=>null),

    footprint(category,symbol)
      .catch(()=>null),

    category==="linear"
      ? futuresData(symbol)
      : Promise.resolve(null)

  ]);

  if(selectedAnalysis){

    selectedAnalysis.orderBook=order;
    selectedAnalysis.footprint=foot;

    selectedAnalysis.tradingStyles=
      tradingStyles({
        ...selectedAnalysis,
        orderBook:order,
        footprint:foot
      });
  }

  let bias="NEUTRAL";

  const bulls=analyses.filter(
    x=>
      x.structure==="BULLISH_STRUCTURE" &&
      x.momentum==="BULLISH"
  ).length;

  const bears=analyses.filter(
    x=>
      x.structure==="BEARISH_STRUCTURE" &&
      x.momentum==="BEARISH"
  ).length;

  if(bulls>bears) bias="BULLISH";
  if(bears>bulls) bias="BEARISH";

  return {
    symbol,
    category,
    requestedTimeframe:selected,
    selectedAnalysis,
    analyses,
    orderBook:order,
    footprint:foot,
    futures,
    bias,
    generatedAt:new Date().toISOString()
  };
}

/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(env,method,body){

  if(!env.TELEGRAM_BOT_TOKEN){
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
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

async function sendTelegram(env,textMessage,extra={}){

  if(!env.TELEGRAM_CHANNEL_ID){
    throw new Error("TELEGRAM_CHANNEL_ID is missing");
  }

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:env.TELEGRAM_CHANNEL_ID,
      text:textMessage,
      disable_web_page_preview:true,
      ...extra
    }
  );
}

/* =========================================================
   CRYPTO RADAR BUTTON
   ========================================================= */

async function installCryptoRadar(env){

  if(!env.TELEGRAM_CHANNEL_ID){
    throw new Error("TELEGRAM_CHANNEL_ID is missing");
  }

  const botUsername="GlobalPulseWorldBot";

  const message=
`🪙 GLOBAL PULSE CRYPTO RADAR

برای تحلیل هر رمز ارز روی دکمه زیر بزنید.

سپس داخل ربات فقط نام ارز را ارسال کنید:

BTC
BTCUSDT
ETH
ETHUSDT
PEPE
PEPEUSDT
SOL
XRP

ربات بازار Bybit را به‌صورت خودکار تشخیص می‌دهد و تحلیل محاسبه‌شده را نمایش می‌دهد.

━━━━━━━━━━━━━━━━
📊 RSI
📈 MACD
🔀 Divergence
🧱 Support / Resistance
🧲 Buy / Sell Walls
👣 Footprint / Delta
📦 Volume
📐 VWAP
🧮 Bollinger
📊 Stochastic
🧠 Trading Styles
📡 Futures Data
⏱ Multi Timeframe

🌐 Global Pulse`;

  const result=await telegram(
    env,
    "sendMessage",
    {
      chat_id:env.TELEGRAM_CHANNEL_ID,
      text:message,
      disable_web_page_preview:true,
      reply_markup:{
        inline_keyboard:[
          [
            {
              text:"🪙 Crypto Radar",
              url:`https://t.me/${botUsername}?start=crypto`
            }
          ]
        ]
      }
    }
  );

  try{
    await telegram(
      env,
      "pinChatMessage",
      {
        chat_id:env.TELEGRAM_CHANNEL_ID,
        message_id:result.result.message_id,
        disable_notification:true
      }
    );
  }catch{}

  return result;
}

/* =========================================================
   TELEGRAM CRYPTO MESSAGE
   ========================================================= */

function fmt(v,d=4){
  const n=Number(v);

  if(!Number.isFinite(n)){
    return "N/A";
  }

  return n.toLocaleString(
    "en-US",
    {
      maximumFractionDigits:d
    }
  );
}

function cryptoTelegramMessage(a){

  const x=a.selectedAnalysis||{};
  const sr=x.supportResistance||{};
  const div=x.divergence||{};
  const st=x.stochastic||{};

  let s=
`🪙 GLOBAL PULSE CRYPTO RADAR

${a.symbol}
Market: ${a.category==="linear"?"Futures / Linear":"Spot"}
Timeframe: ${a.requestedTimeframe}

━━━━━━━━━━━━━━━━

💰 PRICE
${fmt(x.price,8)}

📊 MARKET STATE
Bias: ${a.bias}
Structure: ${x.structure}
Momentum: ${x.momentum}

━━━━━━━━━━━━━━━━

📈 RSI / MACD

RSI: ${fmt(x.rsi,2)}
MACD: ${fmt(x.macd,6)}
Signal: ${fmt(x.macdSignal,6)}
Histogram: ${fmt(x.macdHistogram,6)}

━━━━━━━━━━━━━━━━

🔀 DIVERGENCE

RSI: ${div.rsi||"NONE"}
MACD: ${div.macd||"NONE"}
Overall: ${div.overall||"NONE"}

━━━━━━━━━━━━━━━━

🧱 SUPPORT / RESISTANCE

Support:
${(sr.support||[]).map(v=>fmt(v,8)).join("\n")||"N/A"}

Resistance:
${(sr.resistance||[]).map(v=>fmt(v,8)).join("\n")||"N/A"}

━━━━━━━━━━━━━━━━

🧲 ORDER BOOK

Buy: ${fmt(a.orderBook?.buyShare,2)}%
Sell: ${fmt(a.orderBook?.sellShare,2)}%
Pressure: ${a.orderBook?.pressure||"N/A"}

Best Bid: ${fmt(a.orderBook?.bestBid,8)}
Best Ask: ${fmt(a.orderBook?.bestAsk,8)}

━━━━━━━━━━━━━━━━

🧱 BUY WALLS

${(a.orderBook?.buyWalls||[])
  .map(v=>`${fmt(v[0],8)} | ${fmt(v[1],4)}`)
  .join("\n")||"N/A"}

🧱 SELL WALLS

${(a.orderBook?.sellWalls||[])
  .map(v=>`${fmt(v[0],8)} | ${fmt(v[1],4)}`)
  .join("\n")||"N/A"}

━━━━━━━━━━━━━━━━

👣 FOOTPRINT / DELTA

Buy Volume: ${fmt(a.footprint?.buyVolume,4)}
Sell Volume: ${fmt(a.footprint?.sellVolume,4)}

Delta: ${fmt(a.footprint?.delta,4)}
Delta %: ${fmt(a.footprint?.deltaPercent,2)}%

Pressure:
${a.footprint?.pressure||"N/A"}

━━━━━━━━━━━━━━━━

📦 VOLUME / STRUCTURE

Volume Ratio: ${fmt(x.volumeRatio,2)}
VWAP: ${fmt(x.vwap,8)}
ATR: ${fmt(x.atr,8)}

━━━━━━━━━━━━━━━━

🧮 BOLLINGER

Middle: ${fmt(x.bb?.middle,8)}
Upper: ${fmt(x.bb?.upper,8)}
Lower: ${fmt(x.bb?.lower,8)}
Width: ${fmt(x.bb?.width,3)}%

━━━━━━━━━━━━━━━━

📊 STOCHASTIC

K: ${fmt(st.k,2)}
D: ${fmt(st.d,2)}

━━━━━━━━━━━━━━━━

🧠 TRADING STYLES

${(x.tradingStyles||[])
  .map(v=>`• ${v}`)
  .join("\n")}

━━━━━━━━━━━━━━━━

🌐 OTHER TIMEFRAMES

${a.analyses
  .map(z=>
    `${z.tf}: ${z.structure} | RSI ${fmt(z.rsi,1)} | ${z.momentum}`
  )
  .join("\n")}

━━━━━━━━━━━━━━━━`;

  if(a.futures){

    s+=
`
📡 FUTURES DATA

Last Price:
${a.futures.ticker?.lastPrice||"N/A"}

24h Change:
${a.futures.ticker?.price24hPcnt
  ? `${(Number(a.futures.ticker.price24hPcnt)*100).toFixed(2)}%`
  :"N/A"}

Open Interest:
${a.futures.ticker?.openInterest||"N/A"}

Funding:
${a.futures.funding?.fundingRate||a.futures.ticker?.fundingRate||"N/A"}

Long/Short Ratio:
${a.futures.ratio
  ? `${a.futures.ratio.buyRatio} / ${a.futures.ratio.sellRatio}`
  :"N/A"}

━━━━━━━━━━━━━━━━`;
  }

  s+=
`
⏱ انتخاب تایم‌فریم:

1m | 3m | 5m | 15m
30m | 1H | 4H | 1D

⚠️ اطلاعات بر اساس داده و محاسبات بازار Bybit است.

🌐 Global Pulse`;

  return s;
}

function timeframeKeyboard(symbol){

  return {
    inline_keyboard:[
      [
        {text:"1m",callback_data:`tf|${symbol}|1`},
        {text:"3m",callback_data:`tf|${symbol}|3`},
        {text:"5m",callback_data:`tf|${symbol}|5`},
        {text:"15m",callback_data:`tf|${symbol}|15`}
      ],
      [
        {text:"30m",callback_data:`tf|${symbol}|30`},
        {text:"1H",callback_data:`tf|${symbol}|60`},
        {text:"4H",callback_data:`tf|${symbol}|240`},
        {text:"1D",callback_data:`tf|${symbol}|D`}
      ]
    ]
  };
}

/* =========================================================
   SEND LONG TELEGRAM MESSAGE SAFELY
   ========================================================= */

async function sendLongTelegram(env,chatId,textMessage,replyMarkup=null){

  const limit=3900;

  if(textMessage.length<=limit){

    return telegram(
      env,
      "sendMessage",
      {
        chat_id:chatId,
        text:textMessage,
        disable_web_page_preview:true,
        ...(replyMarkup
          ? {reply_markup:replyMarkup}
          : {})
      }
    );
  }

  const parts=[];

  for(let i=0;i<textMessage.length;i+=limit){
    parts.push(
      textMessage.slice(i,i+limit)
    );
  }

  let last=null;

  for(let i=0;i<parts.length;i++){

    last=await telegram(
      env,
      "sendMessage",
      {
        chat_id:chatId,
        text:parts[i],
        disable_web_page_preview:true,
        ...(i===parts.length-1&&replyMarkup
          ? {reply_markup:replyMarkup}
          : {})
      }
    );
  }

  return last;
}

/* =========================================================
   TELEGRAM UPDATE HANDLER
   ========================================================= */

async function handleTelegramUpdate(update,env){

  /* CALLBACK */

  if(update.callback_query){

    const cb=update.callback_query;

    const data=String(cb.data||"");

    await telegram(
      env,
      "answerCallbackQuery",
      {
        callback_query_id:cb.id,
        text:"در حال محاسبه..."
      }
    ).catch(()=>{});

    if(data.startsWith("tf|")){

      const p=data.split("|");

      const symbol=cleanSymbol(p[1]);
      const tf=p[2]||"15";

      try{

        const analysis=
          await deepAnalyze(
            symbol,
            tf
          );

        await sendLongTelegram(
          env,
          cb.message.chat.id,
          cryptoTelegramMessage(analysis),
          timeframeKeyboard(analysis.symbol)
        );

      }catch(e){

        await telegram(
          env,
          "sendMessage",
          {
            chat_id:cb.message.chat.id,
            text:`❌ خطا در تحلیل ${symbol}\n\n${e.message}`
          }
        );
      }

      return;
    }

    return;
  }

  /* MESSAGE */

  const message=update.message;

  if(!message){
    return;
  }

  const chatId=message.chat?.id;
  const text=String(message.text||"").trim();

  if(!chatId||!text){
    return;
  }

  /* START */

  if(text.startsWith("/start")){

    await telegram(
      env,
      "sendMessage",
      {
        chat_id:chatId,
        text:
`🪙 GLOBAL PULSE CRYPTO RADAR

نام رمز ارز را ارسال کن.

مثال:

BTC
BTCUSDT
ETH
PEPE
PEPEUSDT
SOL
XRP

نیازی به انتخاب Spot یا Futures نیست.

ربات بازار را خودش تشخیص می‌دهد و تحلیل کامل را محاسبه می‌کند.`,
        reply_markup:{
          inline_keyboard:[
            [
              {
                text:"🔎 شروع تحلیل BTC",
                callback_data:"tf|BTCUSDT|15"
              }
            ]
          ]
        }
      }
    );

    return;
  }

  /* HELP */

  if(
    text==="/help"||
    text==="/crypto"||
    text.toLowerCase()==="help"
  ){

    await telegram(
      env,
      "sendMessage",
      {
        chat_id:chatId,
        text:
`🔎 Crypto Radar

فقط نام ارز را بفرست.

مثال:

BTC
ETH
PEPE
SOL
XRP
BTCUSDT
PEPEUSDT

بازار به‌صورت خودکار تشخیص داده می‌شود.`
      }
    );

    return;
  }

  /* SYMBOL */

  const symbol=cleanSymbol(text);

  if(!symbol){
    return;
  }

  /* جلوگیری از پردازش پیام‌های غیرنمادی */

  if(symbol.length<2||symbol.length>30){
    return;
  }

  try{

    await telegram(
      env,
      "sendChatAction",
      {
        chat_id:chatId,
        action:"typing"
      }
    ).catch(()=>{});

    const analysis=
      await deepAnalyze(
        symbol,
        "15"
      );

    await sendLongTelegram(
      env,
      chatId,
      cryptoTelegramMessage(analysis),
      timeframeKeyboard(analysis.symbol)
    );

  }catch(e){

    await telegram(
      env,
      "sendMessage",
      {
        chat_id:chatId,
        text:
`❌ رمز ارز پیدا نشد یا اطلاعات آن در Bybit در دسترس نیست.

نمونه صحیح:

BTC
BTCUSDT
ETH
PEPE
PEPEUSDT

جزئیات:
${e.message}`
      }
    );
  }
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

  const blocks=
    xml.match(/<item[\s\S]*?<\/item>/gi)||[];

  const items=[];

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
          "user-agent":"Global-Pulse/8.0"
        }
      });

      if(!r.ok) continue;

      all.push(
        ...xmlItems(await r.text())
      );

    }catch{}
  }

  const seen=new Set();
  const result=[];

  for(const x of all){

    const k=x.title.toLowerCase();

    if(seen.has(k)) continue;

    seen.add(k);
    result.push(x);
  }

  return result.slice(0,20);
}

function newsMessage(items){

  let s=
`🌍 GLOBAL PULSE
📰 GLOBAL NEWS RADAR

`;

  if(!items.length){
    return s+
      "No reliable global news available right now.";
  }

  for(const x of items.slice(0,8)){

    s+=`• ${x.title}\n`;

    if(x.link){
      s+=`${x.link}\n`;
    }

    s+="\n";
  }

  s+=
`━━━━━━━━━━━━━━━━
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   COUNTRY TREND
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

    if(!r.ok){
      throw new Error("Trend unavailable");
    }

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

function trendMessage(data){

  let s=
`🔥 COUNTRY TREND RADAR

🌍 ${data.country}

`;

  if(!data.trends.length){
    s+="No reliable trend data available right now.\n";
  }else{

    data.trends.forEach(
      (x,i)=>{
        s+=`${i+1}. ${x}\n`;
      }
    );
  }

  s+=
`
━━━━━━━━━━━━━━━━
📊 Trends rotate automatically
🌐 Global Pulse`;

  return s;
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
          "user-agent":"Global-Pulse/8.0"
        }
      });

      if(!r.ok) continue;

      all.push(
        ...xmlItems(await r.text())
      );

    }catch{}
  }

  const seen=new Set();
  const result=[];

  for(const x of all){

    const k=x.title.toLowerCase();

    if(seen.has(k)) continue;

    seen.add(k);
    result.push(x);
  }

  return result.slice(0,20);
}

function shoppingMessage(items){

  let s=
`🛒 GLOBAL SHOPPING RADAR

🔥 Popular deals & consumer topics

`;

  if(!items.length){

    s+=
      "No shopping information available right now.\n";

  }else{

    for(const x of items.slice(0,8)){

      s+=`• ${x.title}\n`;

      if(x.link){
        s+=`${x.link}\n`;
      }

      s+="\n";
    }
  }

  s+=
`━━━━━━━━━━━━━━━━
⚠️ Prices and availability can change.
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   AUTOMATIC PUBLISHING
   ========================================================= */

async function automaticPublish(env){

  const errors=[];

  try{

    const news=await fetchNews();

    await sendTelegram(
      env,
      newsMessage(news)
    );

  }catch(e){
    errors.push("news: "+e.message);
  }

  await sleep(500);

  try{

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

  }catch(e){
    errors.push("trend: "+e.message);
  }

  await sleep(500);

  try{

    const shopping=
      await fetchShopping();

    await sendTelegram(
      env,
      shoppingMessage(shopping)
    );

  }catch(e){
    errors.push("shopping: "+e.message);
  }

  return errors;
}

/* =========================================================
   ROUTER
   ========================================================= */

export default {

  async fetch(request,env){

    const url=new URL(request.url);
    const path=url.pathname;

    try{

      /* ROOT */

      if(path==="/"){

        return json({
          ok:true,
          project:"Global Pulse",
          version:VERSION,
          telegram:!!env.TELEGRAM_BOT_TOKEN,
          channel:!!env.TELEGRAM_CHANNEL_ID,
          bybit:true,
          cryptoAnalyzer:true,
          automaticPublishing:true,
          interactiveTelegramRadar:true,
          time:new Date().toISOString()
        });
      }

      /* HEALTH */

      if(path==="/health"){

        let channel=false;

        try{

          if(env.TELEGRAM_CHANNEL_ID){

            const r=await telegram(
              env,
              "getChat",
              {
                chat_id:env.TELEGRAM_CHANNEL_ID
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
          cryptoAnalyzer:true,
          automaticPublishing:true,
          interactiveTelegramRadar:true,
          time:new Date().toISOString()
        });
      }

      /* SETUP WEBHOOK */

      if(path==="/setup-webhook"){

        const webhook=
          `${url.origin}/telegram/webhook`;

        const result=
          await telegram(
            env,
            "setWebhook",
            {
              url:webhook,
              allowed_updates:[
                "message",
                "callback_query"
              ]
            }
          );

        return json({
          ok:true,
          webhook,
          telegram:result
        });
      }

      /* INSTALL CRYPTO RADAR */

      if(path==="/setup-crypto-radar"){

        const result=
          await installCryptoRadar(env);

        return json({
          ok:true,
          installed:true,
          message_id:
            result.result?.message_id||null
        });
      }

      /* WEBHOOK */

      if(
        path==="/telegram/webhook" &&
        request.method==="POST"
      ){

        const update=
          await request.json();

        await handleTelegramUpdate(
          update,
          env
        );

        return json({
          ok:true,
          received:true,
          update_id:update.update_id??null
        });
      }

      /* TEST NEWS */

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

      /* TEST TREND */

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

      /* TEST SHOPPING */

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

      /* ANALYZE */

      if(path==="/analyze"){

        const symbol=
          url.searchParams.get("symbol");

        const timeframe=
          url.searchParams.get("timeframe")||"15";

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

      /* TEST CRYPTO */

      if(path==="/test-crypto"){

        const symbol=
          url.searchParams.get("symbol")||
          "BTCUSDT";

        const timeframe=
          url.searchParams.get("timeframe")||
          "15";

        const data=
          await deepAnalyze(
            symbol,
            timeframe
          );

        return json({
          ok:true,
          type:"crypto",
          symbol:data.symbol,
          timeframe:data.requestedTimeframe,
          category:data.category
        });
      }

      /* MANUAL PUBLISH */

      if(path==="/publish"){

        const errors=
          await automaticPublish(env);

        return json({
          ok:errors.length===0,
          version:VERSION,
          published:{
            news:!errors.some(x=>x.startsWith("news:")),
            trend:!errors.some(x=>x.startsWith("trend:")),
            shopping:!errors.some(x=>x.startsWith("shopping:"))
          },
          errors,
          time:new Date().toISOString()
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
