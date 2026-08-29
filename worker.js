/* =========================================================
   GLOBAL PULSE V6
   Global News + Country Trends + Shopping + Crypto
   Telegram Bot + Automatic Publishing + Bybit Analyzer
   ========================================================= */

const VERSION = "GLOBAL-PULSE-V6";
const BYBIT = "https://api.bybit.com";

const TF_LIST = ["1","3","5","15","30","60","240","D"];

const COUNTRIES = [
  {code:"US",name:"United States"},
  {code:"GB",name:"United Kingdom"},
  {code:"DE",name:"Germany"},
  {code:"FR",name:"France"},
  {code:"JP",name:"Japan"},
  {code:"KR",name:"South Korea"},
  {code:"AE",name:"United Arab Emirates"},
  {code:"TR",name:"Turkey"},
  {code:"IN",name:"India"},
  {code:"BR",name:"Brazil"},
  {code:"CA",name:"Canada"},
  {code:"AU",name:"Australia"},
  {code:"SG",name:"Singapore"},
  {code:"CH",name:"Switzerland"}
];

const AUTO_CRYPTO = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT"
];

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
  return String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g,"");
}

function num(v,fallback=0){
  const n=Number(v);
  return Number.isFinite(n)?n:fallback;
}

function avg(a){
  return a.length
    ? a.reduce((x,y)=>x+y,0)/a.length
    : 0;
}

function median(a){
  if(!a.length)return 0;
  const b=[...a].sort((x,y)=>x-y);
  const m=Math.floor(b.length/2);
  return b.length%2?b[m]:(b[m-1]+b[m])/2;
}

function sma(v,p){
  if(v.length<p)return null;
  return avg(v.slice(-p));
}

function ema(v,p){
  if(v.length<p)return null;

  const k=2/(p+1);
  let e=avg(v.slice(0,p));

  for(let i=p;i<v.length;i++){
    e=v[i]*k+e*(1-k);
  }

  return e;
}

function stddev(v,p){
  if(v.length<p)return null;

  const a=v.slice(-p);
  const m=avg(a);

  return Math.sqrt(
    avg(a.map(x=>Math.pow(x-m,2)))
  );
}

function rsi(v,p=14){
  if(v.length<p+1)return null;

  let gain=0;
  let loss=0;

  for(let i=1;i<=p;i++){
    const d=v[i]-v[i-1];
    if(d>=0)gain+=d;
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

  if(al===0)return 100;

  const rs=ag/al;

  return 100-(100/(1+rs));
}

function macd(v){
  if(v.length<35)return null;

  const series=[];

  for(let i=0;i<v.length;i++){
    if(i<26)continue;

    const f=ema(v.slice(0,i+1),12);
    const s=ema(v.slice(0,i+1),26);

    if(f!=null&&s!=null){
      series.push(f-s);
    }
  }

  const line=series.at(-1);
  const signal=ema(series,9);

  return {
    line,
    signal,
    histogram:
      signal==null||line==null
        ? null
        : line-signal
  };
}

function atr(c,p=14){
  if(c.length<p+1)return null;

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

function bollinger(v,p=20,mult=2){
  if(v.length<p)return null;

  const middle=sma(v,p);
  const sd=stddev(v,p);

  return {
    middle,
    upper:middle+mult*sd,
    lower:middle-mult*sd,
    width:middle
      ? ((mult*2*sd)/middle)*100
      : 0
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
    .sort((a,b)=>a.time-b.time);
}

async function bybit(path){
  const r=await fetch(BYBIT+path,{
    headers:{
      "user-agent":"Global-Pulse/6.0"
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
  const r=await bybit(
    `/v5/market/kline?category=${category}`+
    `&symbol=${symbol}`+
    `&interval=${interval}`+
    `&limit=${limit}`
  );

  return parseKlines(r.list||[]);
}

async function findMarket(symbol){
  symbol=cleanSymbol(symbol);

  try{
    const r=await bybit(
      `/v5/market/instruments-info?category=linear&symbol=${symbol}`
    );

    if(r.list?.length)return "linear";
  }catch{}

  try{
    const r=await bybit(
      `/v5/market/instruments-info?category=spot&symbol=${symbol}`
    );

    if(r.list?.length)return "spot";
  }catch{}

  return null;
}

/* =========================================================
   MARKET STRUCTURE
   ========================================================= */

function marketStructure(c){
  if(c.length<30)return "UNKNOWN";

  const r=c.slice(-30);

  const highs=r.map(x=>x.high);
  const lows=r.map(x=>x.low);

  const high=Math.max(...highs);
  const low=Math.min(...lows);

  const first=r[0].close;
  const last=r.at(-1).close;

  const range=high-low;

  if(!range)return "RANGE";

  const move=(last-first)/range;

  if(move>0.30)return "BULLISH_STRUCTURE";
  if(move<-0.30)return "BEARISH_STRUCTURE";

  return "RANGE";
}

/* =========================================================
   SUPPORT / RESISTANCE
   ========================================================= */

function pivotLevels(candles){
  const highs=[];
  const lows=[];

  for(let i=2;i<candles.length-2;i++){

    const c=candles[i];

    if(
      c.high>=candles[i-1].high &&
      c.high>=candles[i-2].high &&
      c.high>=candles[i+1].high &&
      c.high>=candles[i+2].high
    ){
      highs.push(c.high);
    }

    if(
      c.low<=candles[i-1].low &&
      c.low<=candles[i-2].low &&
      c.low<=candles[i+1].low &&
      c.low<=candles[i+2].low
    ){
      lows.push(c.low);
    }
  }

  return {
    resistance:[...highs].slice(-8).sort((a,b)=>b-a),
    support:[...lows].slice(-8).sort((a,b)=>b-a)
  };
}

/* =========================================================
   DIVERGENCE
   ========================================================= */

function divergence(candles,indicator){

  if(candles.length<40||indicator.length!==candles.length){
    return {
      bullish:false,
      bearish:false,
      type:"NONE"
    };
  }

  const n=candles.length;

  const p1=n-20;
  const p2=n-5;

  const price1=candles[p1].close;
  const price2=candles[p2].close;

  const ind1=indicator[p1];
  const ind2=indicator[p2];

  if(
    !Number.isFinite(ind1)||
    !Number.isFinite(ind2)
  ){
    return {
      bullish:false,
      bearish:false,
      type:"NONE"
    };
  }

  if(price2<price1&&ind2>ind1){
    return {
      bullish:true,
      bearish:false,
      type:"BULLISH_DIVERGENCE"
    };
  }

  if(price2>price1&&ind2<ind1){
    return {
      bullish:false,
      bearish:true,
      type:"BEARISH_DIVERGENCE"
    };
  }

  return {
    bullish:false,
    bearish:false,
    type:"NONE"
  };
}

function rsiSeries(v,p=14){
  const out=new Array(v.length).fill(null);

  if(v.length<p+1)return out;

  let gain=0;
  let loss=0;

  for(let i=1;i<=p;i++){
    const d=v[i]-v[i-1];

    if(d>=0)gain+=d;
    else loss-=d;
  }

  let ag=gain/p;
  let al=loss/p;

  out[p]=
    al===0
      ? 100
      : 100-(100/(1+(ag/al)));

  for(let i=p+1;i<v.length;i++){

    const d=v[i]-v[i-1];

    const g=Math.max(d,0);
    const l=Math.max(-d,0);

    ag=((ag*(p-1))+g)/p;
    al=((al*(p-1))+l)/p;

    out[i]=
      al===0
        ? 100
        : 100-(100/(1+(ag/al)));
  }

  return out;
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
    throw new Error(`Insufficient ${tf} data`);
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

  const structure=marketStructure(candles);

  const volumeNow=candles.at(-1).volume;

  const volumeAvg=
    avg(
      candles.slice(-21,-1)
        .map(x=>x.volume)
    );

  const volumeRatio=
    volumeAvg
      ? volumeNow/volumeAvg
      : 0;

  const levels=pivotLevels(candles);

  const rs=rsiSeries(closes,14);

  const div=divergence(
    candles,
    rs
  );

  let trend="NEUTRAL";

  if(
    price>ma20 &&
    ema20>ema50 &&
    r>50 &&
    m?.line>m?.signal
  ){
    trend="BULLISH";
  }

  if(
    price<ma20 &&
    ema20<ema50 &&
    r<50 &&
    m?.line<m?.signal
  ){
    trend="BEARISH";
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
    bb,

    volumeRatio,

    high:Math.max(
      ...candles.slice(-50).map(x=>x.high)
    ),

    low:Math.min(
      ...candles.slice(-50).map(x=>x.low)
    ),

    structure,

    support:levels.support,
    resistance:levels.resistance,

    divergence:div,

    trend
  };
}

/* =========================================================
   ORDER BOOK / WALLS
   ========================================================= */

async function orderBook(category,symbol){

  const r=await bybit(
    `/v5/market/orderbook?category=${category}`+
    `&symbol=${symbol}&limit=50`
  );

  const bids=(r.b||[])
    .map(x=>[
      num(x[0]),
      num(x[1])
    ]);

  const asks=(r.a||[])
    .map(x=>[
      num(x[0]),
      num(x[1])
    ]);

  const buy=bids.reduce(
    (s,x)=>s+x[0]*x[1],
    0
  );

  const sell=asks.reduce(
    (s,x)=>s+x[0]*x[1],
    0
  );

  const total=buy+sell;

  const buyShare=
    total?buy/total*100:50;

  const sellShare=
    total?sell/total*100:50;

  const bidValues=bids.map(x=>x[0]*x[1]);
  const askValues=asks.map(x=>x[0]*x[1]);

  const bidMedian=median(bidValues);
  const askMedian=median(askValues);

  const buyThreshold=bidMedian*4;
  const sellThreshold=askMedian*4;

  const buyWalls=bids
    .filter(x=>x[0]*x[1]>=buyThreshold)
    .slice(0,10)
    .map(x=>({
      price:x[0],
      size:x[1],
      notional:x[0]*x[1]
    }));

  const sellWalls=asks
    .filter(x=>x[0]*x[1]>=sellThreshold)
    .slice(0,10)
    .map(x=>({
      price:x[0],
      size:x[1],
      notional:x[0]*x[1]
    }));

  let pressure="NEUTRAL";

  if(buyShare>sellShare+8)
    pressure="BUY_PRESSURE";

  if(sellShare>buyShare+8)
    pressure="SELL_PRESSURE";

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
    `/v5/market/recent-trade?category=${category}`+
    `&symbol=${symbol}&limit=1000`
  );

  let buyVolume=0;
  let sellVolume=0;

  let buyNotional=0;
  let sellNotional=0;

  let buyTrades=0;
  let sellTrades=0;

  const notionals=[];

  for(const t of r.list||[]){

    const size=num(t.size);
    const price=num(t.price);
    const side=String(t.side||"").toLowerCase();

    const notional=size*price;

    notionals.push(notional);

    if(side==="buy"){
      buyVolume+=size;
      buyNotional+=notional;
      buyTrades++;
    }

    if(side==="sell"){
      sellVolume+=size;
      sellNotional+=notional;
      sellTrades++;
    }
  }

  const total=buyNotional+sellNotional;

  const delta=buyNotional-sellNotional;

  const deltaPercent=
    total
      ? delta/total*100
      : 0;

  const avgNotional=avg(notionals);

  const largeThreshold=
    Math.max(
      avgNotional*5,
      median(notionals)*5
    );

  let largeBuy=0;
  let largeSell=0;

  for(const t of r.list||[]){

    const size=num(t.size);
    const price=num(t.price);
    const side=String(t.side||"").toLowerCase();

    const n=size*price;

    if(n>=largeThreshold){

      if(side==="buy")largeBuy+=n;
      if(side==="sell")largeSell+=n;
    }
  }

  let pressure="NEUTRAL";

  if(deltaPercent>=10)
    pressure="BUY_PRESSURE";

  if(deltaPercent<=-10)
    pressure="SELL_PRESSURE";

  return {
    buyVolume,
    sellVolume,
    buyNotional,
    sellNotional,
    buyTrades,
    sellTrades,
    delta,
    deltaPercent,
    largeBuy,
    largeSell,
    largeThreshold,
    pressure
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
   DEEP ANALYSIS
   ========================================================= */

async function deepAnalyze(symbol,requestedTf="15"){

  symbol=cleanSymbol(symbol);

  if(!symbol)
    throw new Error("Symbol is required");

  const category=await findMarket(symbol);

  if(!category)
    throw new Error(
      `Symbol ${symbol} not found on Bybit`
    );

  const selected=
    TF_LIST.includes(requestedTf)
      ? requestedTf
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

    await sleep(50);
  }

  const selectedAnalysis=
    analyses.find(x=>x.tf===selected)||
    analyses.find(x=>x.tf==="15")||
    analyses[0];

  const [order,foot,futures]=
    await Promise.all([
      orderBook(category,symbol).catch(()=>null),
      footprint(category,symbol).catch(()=>null),
      category==="linear"
        ? futuresData(symbol)
        : Promise.resolve(null)
    ]);

  const price=
    selectedAnalysis?.price||
    num(futures?.ticker?.lastPrice)||
    0;

  const a=
    selectedAnalysis?.atr||
    0;

  return {
    symbol,
    category,
    requestedTimeframe:selected,

    price,

    selectedAnalysis,

    analyses,

    orderBook:order,

    footprint:foot,

    futures,

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

  const result=[];
  const blocks=xml.match(/<item[\s\S]*?<\/item>/gi)||[];

  for(const block of blocks){

    const title=stripXml(
      (block.match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      )||[])[1]
    );

    const link=stripXml(
      (block.match(
        /<link[^>]*>([\s\S]*?)<\/link>/i
      )||[])[1]
    );

    const pubDate=stripXml(
      (block.match(
        /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i
      )||[])[1]
    );

    if(title){
      result.push({
        title,
        link,
        pubDate
      });
    }
  }

  return result;
}

async function fetchRSS(feeds){

  const all=[];

  for(const url of feeds){

    try{

      const r=await fetch(url,{
        headers:{
          "user-agent":"Mozilla/5.0 Global-Pulse"
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

    const key=x.title.toLowerCase();

    if(seen.has(key))continue;

    seen.add(key);
    result.push(x);
  }

  return result.slice(0,20);
}

async function fetchNews(){
  return fetchRSS(NEWS_FEEDS);
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

    if(!r.ok)throw new Error("Trend unavailable");

    const items=xmlItems(await r.text());

    return {
      country:country.name,
      code:country.code,
      trends:items
        .slice(0,10)
        .map(x=>x.title)
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
  return fetchRSS(SHOPPING_FEEDS);
}

/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(env,method,body){

  if(!env.TELEGRAM_BOT_TOKEN)
    throw new Error("TELEGRAM_BOT_TOKEN is missing");

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

async function sendTelegram(env,text,extra={}){

  if(!env.TELEGRAM_CHANNEL_ID)
    throw new Error(
      "TELEGRAM_CHANNEL_ID is missing"
    );

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:env.TELEGRAM_CHANNEL_ID,
      text,
      disable_web_page_preview:true,
      ...extra
    }
  );
}

async function sendChat(env,chatId,text,extra={}){

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:chatId,
      text,
      disable_web_page_preview:true,
      ...extra
    }
  );
}

/* =========================================================
   TELEGRAM CRYPTO MESSAGE
   ========================================================= */

function fmt(v){

  if(v==null||!Number.isFinite(Number(v)))
    return "-";

  const n=Number(v);

  if(Math.abs(n)>=1000)
    return n.toLocaleString(
      "en-US",
      {maximumFractionDigits:2}
    );

  if(Math.abs(n)>=1)
    return n.toFixed(4);

  return n.toFixed(8);
}

function cryptoMessage(a){

  const x=a.selectedAnalysis||{};
  const o=a.orderBook;
  const f=a.footprint;

  let s=
`🪙 GLOBAL PULSE — CRYPTO ANALYSIS

${a.symbol}

━━━━━━━━━━━━━━━━
⏱ TIMEFRAME: ${a.requestedTimeframe}
💰 PRICE: ${fmt(a.price)}
📊 MARKET: ${a.category}

━━━━━━━━━━━━━━━━
📈 MARKET STRUCTURE
Trend: ${x.trend||"-"}
Structure: ${x.structure||"-"}

━━━━━━━━━━━━━━━━
📊 INDICATORS

RSI: ${fmt(x.rsi)}
MACD: ${fmt(x.macd)}
MACD Signal: ${fmt(x.macdSignal)}
MACD Histogram: ${fmt(x.macdHistogram)}

MA20: ${fmt(x.ma20)}
MA50: ${fmt(x.ma50)}
EMA20: ${fmt(x.ema20)}
EMA50: ${fmt(x.ema50)}

ATR: ${fmt(x.atr)}

━━━━━━━━━━━━━━━━
📦 VOLUME

Volume Ratio: ${fmt(x.volumeRatio)}

━━━━━━━━━━━━━━━━
🧱 SUPPORT / RESISTANCE

Support:
${(x.support||[]).slice(0,5).map(v=>`• ${fmt(v)}`).join("\n")||"-"}

Resistance:
${(x.resistance||[]).slice(0,5).map(v=>`• ${fmt(v)}`).join("\n")||"-"}

━━━━━━━━━━━━━━━━
🔀 DIVERGENCE

${x.divergence?.type||"NONE"}

━━━━━━━━━━━━━━━━
📖 ORDER BOOK

Buy: ${o?fmt(o.buyShare)+"%":"-"}
Sell: ${o?fmt(o.sellShare)+"%":"-"}
Pressure: ${o?.pressure||"-"}

Buy Walls:
${o?.buyWalls?.slice(0,5).map(w=>
`• ${fmt(w.price)} | ${fmt(w.notional)}`
).join("\n")||"-"}

Sell Walls:
${o?.sellWalls?.slice(0,5).map(w=>
`• ${fmt(w.price)} | ${fmt(w.notional)}`
).join("\n")||"-"}

━━━━━━━━━━━━━━━━
👣 FOOTPRINT

Buy Volume: ${f?fmt(f.buyVolume):"-"}
Sell Volume: ${f?fmt(f.sellVolume):"-"}

Delta: ${f?fmt(f.delta):"-"}
Delta %: ${f?fmt(f.deltaPercent):"-"}

Large Buy: ${f?fmt(f.largeBuy):"-"}
Large Sell: ${f?fmt(f.largeSell):"-"}

Pressure: ${f?.pressure||"-"}

━━━━━━━━━━━━━━━━
⏱ MULTI TIMEFRAME

${a.analyses.map(z=>
`${z.tf}: ${z.trend} | RSI ${fmt(z.rsi)}`
).join("\n")}

━━━━━━━━━━━━━━━━
⚠️ Market data analysis only.

🌐 GLOBAL PULSE`;

  return s;
}

/* =========================================================
   NEWS MESSAGE
   ========================================================= */

function newsMessage(items){

  let s=
`🌍 GLOBAL PULSE
📰 GLOBAL NEWS RADAR

`;

  for(const x of items.slice(0,8)){

    s+=`• ${x.title}\n`;

    if(x.link)s+=`${x.link}\n`;

    s+="\n";
  }

  s+=
`━━━━━━━━━━━━━━━━
🌐 Global Pulse`;

  return s;
}

function trendMessage(data){

  let s=
`🔥 COUNTRY TREND RADAR

🌍 ${data.country}

`;

  if(data.trends.length){

    data.trends.forEach(
      (x,i)=>{
        s+=`${i+1}. ${x}\n`;
      }
    );

  }else{

    s+="No reliable trend data available.\n";
  }

  s+=
`\n━━━━━━━━━━━━━━━━
🌐 Global Pulse`;

  return s;
}

function shoppingMessage(items){

  let s=
`🛒 GLOBAL SHOPPING RADAR

`;

  for(const x of items.slice(0,8)){

    s+=`• ${x.title}\n`;

    if(x.link)s+=`${x.link}\n`;

    s+="\n";
  }

  s+=
`━━━━━━━━━━━━━━━━
⚠️ Prices and availability can change.
🌐 Global Pulse`;

  return s;
}

/* =========================================================
   TELEGRAM USER COMMANDS
   ========================================================= */

function extractCommand(text){

  const t=String(text||"").trim();

  if(!t)return null;

  const m=t.match(
    /^\/(?:analyze|analysis|crypto)(?:@\w+)?\s+([A-Za-z0-9_-]+)(?:\s+(\w+))?/i
  );

  if(m){

    return {
      symbol:cleanSymbol(m[1]),
      timeframe:m[2]||"15"
    };
  }

  const symbol=cleanSymbol(t);

  if(
    /^[A-Z0-9]{3,20}$/.test(symbol) &&
    (
      symbol.endsWith("USDT")||
      symbol.endsWith("USDC")||
      symbol.endsWith("BTC")||
      symbol.endsWith("ETH")
    )
  ){

    return {
      symbol,
      timeframe:"15"
    };
  }

  return null;
}

async function handleTelegramUpdate(update,env){

  const message=
    update.message||
    update.channel_post||
    update.edited_message||
    update.edited_channel_post;

  if(!message)return;

  const text=message.text||"";

  const command=extractCommand(text);

  if(!command){

    if(
      text==="/start"||
      text==="/help"
    ){

      await sendChat(
        env,
        message.chat.id,
`🌐 GLOBAL PULSE

برای تحلیل رمز ارز فقط نام آن را بفرست:

BTCUSDT
ETHUSDT
SOLUSDT

یا:

/analyze BTCUSDT

برای انتخاب تایم‌فریم:

/analyze BTCUSDT 15
/analyze BTCUSDT 60
/analyze BTCUSDT 240

تایم‌فریم‌های قابل استفاده:
1 / 3 / 5 / 15 / 30 / 60 / 240 / D`
      );
    }

    return;
  }

  await sendChat(
    env,
    message.chat.id,
    `🔎 در حال دریافت داده واقعی ${command.symbol} از Bybit...\n⏱ تایم‌فریم ${command.timeframe}`
  );

  try{

    const data=await deepAnalyze(
      command.symbol,
      command.timeframe
    );

    await sendChat(
      env,
      message.chat.id,
      cryptoMessage(data)
    );

  }catch(e){

    await sendChat(
      env,
      message.chat.id,
      `❌ خطا در تحلیل ${command.symbol}\n\n${e.message}`
    );
  }
}

/* =========================================================
   AUTOMATIC PUBLISHING
   ========================================================= */

async function publishCrypto(env,symbol){

  try{

    const data=await deepAnalyze(
      symbol,
      "15"
    );

    await sendTelegram(
      env,
      cryptoMessage(data)
    );

    return {
      symbol,
      ok:true
    };

  }catch(e){

    return {
      symbol,
      ok:false,
      error:e.message
    };
  }
}

async function automaticPublish(env){

  const results={
    news:false,
    trend:false,
    shopping:false,
    crypto:[]
  };

  /* NEWS */

  try{

    const news=await fetchNews();

    await sendTelegram(
      env,
      newsMessage(news)
    );

    results.news=true;

  }catch{}

  await sleep(800);

  /* COUNTRY TREND */

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

    results.trend=true;

  }catch{}

  await sleep(800);

  /* SHOPPING */

  try{

    const shopping=
      await fetchShopping();

    await sendTelegram(
      env,
      shoppingMessage(shopping)
    );

    results.shopping=true;

  }catch{}

  await sleep(800);

  /* CRYPTO */

  for(const symbol of AUTO_CRYPTO){

    const result=
      await publishCrypto(
        env,
        symbol
      );

    results.crypto.push(result);

    await sleep(1000);
  }

  return results;
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
          endpoints:[
            "/health",
            "/setup-webhook",
            "/test-news",
            "/test-trend",
            "/test-shopping",
            "/test-crypto?symbol=BTCUSDT",
            "/publish",
            "/analyze?symbol=BTCUSDT&timeframe=15"
          ],
          time:new Date().toISOString()
        });
      }

      /* HEALTH */

      if(path==="/health"){

        let channel=false;

        try{

          if(env.TELEGRAM_CHANNEL_ID){

            const result=
              await telegram(
                env,
                "getChat",
                {
                  chat_id:
                    env.TELEGRAM_CHANNEL_ID
                }
              );

            channel=!!result.ok;
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
          time:new Date().toISOString()
        });
      }

      /* WEBHOOK SETUP */

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
                "channel_post",
                "edited_message",
                "edited_channel_post"
              ]
            }
          );

        return json({
          ok:true,
          webhook,
          telegram:result
        });
      }

      /* WEBHOOK */

      if(
        path==="/telegram/webhook"&&
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
          update_id:
            update.update_id??null
        });
      }

      /* ANALYZE */

      if(path==="/analyze"){

        const symbol=
          cleanSymbol(
            url.searchParams.get("symbol")
          );

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

      /* MANUAL FULL PUBLISH */

      if(path==="/publish"){

        const result=
          await automaticPublish(env);

        return json({
          ok:true,
          published:true,
          result
        });
      }

      /* SET WEBHOOK */

      if(path==="/telegram-info"){

        const result=
          await telegram(
            env,
            "getWebhookInfo",
            {}
          );

        return json({
          ok:true,
          webhook:result.result
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
