<section class="crypto-box">

  <div class="crypto-title">
    🪙 تحلیل عمیق ارز
  </div>

  <p class="crypto-desc">
    نام ارز را وارد کنید تا تحلیل عمیق بازار به‌صورت خودکار انجام شود.
  </p>

  <div class="crypto-search">

    <input
      id="cryptoSymbol"
      type="text"
      placeholder="مثلاً BTC یا BTCUSDT"
      autocomplete="off"
      spellcheck="false"
    >

    <button
      id="cryptoAnalyzeBtn"
      type="button"
    >
      🔎 تحلیل
    </button>

  </div>

  <div id="cryptoStatus"></div>

  <div id="cryptoResult"></div>

</section>

<style>

.crypto-box{
  margin:24px auto;
  max-width:900px;
  padding:22px;
  border-radius:20px;
  background:#111827;
  border:1px solid #263244;
  color:#fff;
}

.crypto-title{
  font-size:22px;
  font-weight:800;
  margin-bottom:8px;
}

.crypto-desc{
  color:#9ca3af;
  line-height:1.8;
}

.crypto-search{
  display:flex;
  gap:10px;
  margin-top:18px;
}

.crypto-search input{
  flex:1;
  min-width:0;
  padding:15px;
  border-radius:12px;
  border:1px solid #374151;
  background:#0b1220;
  color:#fff;
  font-size:16px;
  outline:none;
}

.crypto-search button{
  padding:15px 22px;
  border:0;
  border-radius:12px;
  background:#2563eb;
  color:#fff;
  font-weight:800;
  cursor:pointer;
}

.crypto-search button:disabled{
  opacity:.5;
  cursor:wait;
}

#cryptoStatus{
  margin-top:15px;
  color:#9ca3af;
}

.result{
  margin-top:20px;
}

.coin-head{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:15px;
  padding:18px;
  border-radius:16px;
  background:#0b1220;
}

.coin-head small{
  color:#9ca3af;
}

.coin-head h2{
  margin:5px 0 0;
}

.verdict{
  min-width:100px;
  text-align:center;
  padding:12px;
  border-radius:12px;
  font-weight:900;
}

.verdict small{
  display:block;
  margin-top:5px;
}

.verdict.bullish{
  background:#064e3b;
  color:#6ee7b7;
}

.verdict.bearish{
  background:#7f1d1d;
  color:#fecaca;
}

.verdict.neutral{
  background:#374151;
  color:#d1d5db;
}

.cards,
.data-grid,
.levels{
  display:grid;
  grid-template-columns:
    repeat(auto-fit,minmax(150px,1fr));
  gap:12px;
  margin-top:14px;
}

.card,
.data-grid>div,
.levels>div,
.data-box,
.conclusion{
  padding:15px;
  border-radius:14px;
  background:#172033;
  border:1px solid #263244;
}

.card small{
  display:block;
  color:#9ca3af;
  margin-bottom:8px;
}

.card b{
  font-size:18px;
}

.result h3{
  margin-top:25px;
}

.style{
  padding:16px;
  margin:10px 0;
  border-radius:14px;
  background:#172033;
  border:1px solid #263244;
}

.style-top{
  display:flex;
  justify-content:space-between;
  gap:10px;
}

.bar{
  height:8px;
  margin:12px 0;
  background:#0b1220;
  border-radius:20px;
  overflow:hidden;
}

.bar i{
  display:block;
  height:100%;
  background:#3b82f6;
}

.style ul{
  margin-bottom:0;
  padding-right:20px;
  color:#cbd5e1;
  line-height:1.8;
}

.data-grid>div b{
  display:block;
  margin-top:7px;
}

.conclusion{
  line-height:2;
}

.result footer{
  margin-top:22px;
  padding:14px;
  text-align:center;
  border-top:1px solid #263244;
  color:#9ca3af;
  font-size:13px;
}

.error{
  margin-top:20px;
  padding:15px;
  border-radius:12px;
  background:#450a0a;
  color:#fecaca;
}

@media(max-width:600px){

  .crypto-search{
    flex-direction:column;
  }

  .crypto-search button{
    width:100%;
  }

  .coin-head{
    flex-direction:column;
    align-items:flex-start;
  }

}

</style>

<script>

const CRYPTO_WORKER =
  window.GLOBAL_PULSE_WORKER_URL ||
  "https://telegram-auto-channel.29mah12.workers.dev";

const cryptoSymbol =
  document.getElementById("cryptoSymbol");

const cryptoButton =
  document.getElementById("cryptoAnalyzeBtn");

const cryptoStatus =
  document.getElementById("cryptoStatus");

const cryptoResult =
  document.getElementById("cryptoResult");

async function analyzeCrypto(){

  let symbol =
    cryptoSymbol.value.trim();

  if(!symbol){

    cryptoStatus.textContent =
      "❌ نام ارز را وارد کنید.";

    return;
  }

  cryptoButton.disabled = true;

  cryptoStatus.textContent =
    "⏳ در حال دریافت اطلاعات بازار...";

  cryptoResult.innerHTML = "";

  try{

    const url =
      `${CRYPTO_WORKER}/crypto-analyze?symbol=${encodeURIComponent(symbol)}`;

    const response =
      await fetch(url,{
        cache:"no-store"
      });

    const data =
      await response.json();

    if(!data.ok){

      cryptoStatus.textContent =
        "❌ " + (data.error || "تحلیل انجام نشد.");

      return;
    }

    cryptoStatus.textContent =
      "✅ تحلیل با اطلاعات لحظه‌ای بازار انجام شد.";

    renderCryptoAnalysis(data);

  }catch(error){

    cryptoStatus.textContent =
      "❌ خطا در اتصال به سیستم تحلیل.";

    console.error(error);

  }finally{

    cryptoButton.disabled = false;
  }
}

function renderCryptoAnalysis(data){

  const styles =
    (data.styles || [])
      .map(style => {

        const reasons =
          (style.reasons || [])
            .map(x => `<li>${escapeCrypto(x)}</li>`)
            .join("");

        return `
          <div class="style">

            <div class="style-top">
              <b>${escapeCrypto(style.name)}</b>
              <span>
                ${escapeCrypto(style.view)}
                — ${style.score}/100
              </span>
            </div>

            <div class="bar">
              <i style="width:${style.score}%"></i>
            </div>

            <ul>${reasons}</ul>

          </div>
        `;

      })
      .join("");

  const supports =
    (data.supportResistance?.supports || [])
      .map(x => formatCryptoPrice(x.price))
      .join(" • ") ||
    "داده کافی نیست";

  const resistances =
    (data.supportResistance?.resistances || [])
      .map(x => formatCryptoPrice(x.price))
      .join(" • ") ||
    "داده کافی نیست";

  const f =
    data.footprint || {};

  const ob =
    data.orderBook || {};

  const hunt =
    data.liquidity?.hunt || {};

  const futures =
    data.futures;

  cryptoResult.innerHTML = `

    <div class="result">

      <div class="coin-head">

        <div>
          <small>DEEP ANALYSIS</small>
          <h2>🪙 ${escapeCrypto(data.symbol)}</h2>
        </div>

        <div class="verdict ${
          String(data.verdict || "NEUTRAL").toLowerCase()
        }">

          ${escapeCrypto(data.verdict)}

          <small>
            ${data.overallScore}/100
          </small>

        </div>

      </div>

      <div class="cards">

        <div class="card">
          <small>PRICE</small>
          <b>${formatCryptoPrice(data.price)}</b>
        </div>

        <div class="card">
          <small>1M</small>
          <b>${escapeCrypto(
            data.trend?.oneMinute?.direction
          )}</b>
        </div>

        <div class="card">
          <small>15M</small>
          <b>${escapeCrypto(
            data.trend?.fifteenMinute?.direction
          )}</b>
        </div>

        <div class="card">
          <small>RSI</small>
          <b>${Number(
            data.indicators?.rsi || 0
          ).toFixed(2)}</b>
        </div>

      </div>

      <h3>📊 Trading Styles</h3>

      ${styles}

      <h3>🎯 Support / Resistance</h3>

      <div class="levels">

        <div>
          <b>🟢 Support</b>
          <p>${escapeCrypto(supports)}</p>
        </div>

        <div>
          <b>🔴 Resistance</b>
          <p>${escapeCrypto(resistances)}</p>
        </div>

      </div>

      <h3>💧 Liquidity / Hunt</h3>

      <div class="data-box">

        <b>${escapeCrypto(
          hunt.type || "NONE"
        )}</b>

        <p>${escapeCrypto(
          hunt.reason || "No confirmed hunt."
        )}</p>

      </div>

      <h3>👣 Footprint</h3>

      <div class="data-grid">

        <div>
          Buy Volume
          <b>${Number(
            f.buyVolume || 0
          ).toFixed(4)}</b>
        </div>

        <div>
          Sell Volume
          <b>${Number(
            f.sellVolume || 0
          ).toFixed(4)}</b>
        </div>

        <div>
          Delta
          <b>${Number(
            f.delta || 0
          ).toFixed(4)}</b>
        </div>

        <div>
          Delta %
          <b>${Number(
            f.deltaPercent || 0
          ).toFixed(2)}%</b>
        </div>

        <div>
          Pressure
          <b>${escapeCrypto(
            f.pressure || "NEUTRAL"
          )}</b>
        </div>

      </div>

      <h3>📚 Order Book</h3>

      <div class="data-grid">

        <div>
          Buy Share
          <b>${Number(
            ob.buyShare || 0
          ).toFixed(2)}%</b>
        </div>

        <div>
          Sell Share
          <b>${Number(
            ob.sellShare || 0
          ).toFixed(2)}%</b>
        </div>

        <div>
          Best Bid
          <b>${formatCryptoPrice(
            ob.bestBid
          )}</b>
        </div>

        <div>
          Best Ask
          <b>${formatCryptoPrice(
            ob.bestAsk
          )}</b>
        </div>

        <div>
          Pressure
          <b>${escapeCrypto(
            ob.pressure || "NEUTRAL"
          )}</b>
        </div>

      </div>

      ${
        futures
        ? `

          <h3>⚡ Market Data</h3>

          <div class="data-grid">

            <div>
              Open Interest
              <b>
                ${futures.openInterest ?? "N/A"}
              </b>
            </div>

            <div>
              OI Value
              <b>
                ${
                  futures.openInterestValue
                  ? "$" +
                    Math.round(
                      futures.openInterestValue
                    ).toLocaleString()
                  : "N/A"
                }
              </b>
            </div>

            <div>
              Funding
              <b>
                ${futures.fundingRate ?? "N/A"}
              </b>
            </div>

          </div>

        `
        : ""
      }

      <h3>🧠 Conclusion</h3>

      <div class="conclusion">

        ${
          (data.confirmations || [])
            .map(x =>
              `<div>• ${escapeCrypto(x)}</div>`
            )
            .join("")
        }

      </div>

      <footer>
        📊 تحلیل بر اساس اطلاعات Bybit
      </footer>

    </div>
  `;
}

function escapeCrypto(value){

  return String(value ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");

}

function formatCryptoPrice(value){

  const n =
    Number(value);

  if(!Number.isFinite(n)){
    return "N/A";
  }

  if(n >= 1000){
    return n.toLocaleString(
      "en-US",
      {
        maximumFractionDigits:2
      }
    );
  }

  if(n >= 1){
    return n.toLocaleString(
      "en-US",
      {
        maximumFractionDigits:4
      }
    );
  }

  return n.toLocaleString(
    "en-US",
    {
      maximumFractionDigits:8
    }
  );

}

cryptoButton.addEventListener(
  "click",
  analyzeCrypto
);

cryptoSymbol.addEventListener(
  "keydown",
  event => {

    if(event.key === "Enter"){
      analyzeCrypto();
    }

  }
);

</script>
