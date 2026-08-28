const TELEGRAM_API = "https://api.telegram.org";

/* =========================================================
   GLOBAL PULSE — TELEGRAM AUTO CHANNEL V2
   ---------------------------------------------------------
   امکانات:
   - Telegram Bot
   - ارسال متن
   - ارسال HTML
   - ارسال عکس
   - ارسال خبر کامل
   - فیلتر محتوای مرتبط با ایران
   - جلوگیری از خبرهای تکراری در حافظه کوتاه‌مدت
   - Global News
   - Global Price
   - Country Battle
   - Cost of Living
   - Global Trend
   - Health / Debug
   ========================================================= */


/* =========================================================
   CONFIG
   ========================================================= */

const CONFIG = {
  SERVICE: "Global Pulse",
  WORKER: "telegram-auto-channel",

  // مدت نگهداری هش خبرهای منتشرشده در حافظه Worker
  DUPLICATE_TTL: 86400,

  // حداکثر طول متن تلگرام
  TELEGRAM_MAX_LENGTH: 4096,

  // زبان محتوای کانال
  LANGUAGE: "en",

  // کشورهای حذف‌شده از محتوای خبری
  BLOCKED_COUNTRIES: [
    "iran",
    "islamic republic of iran",
    "iranian",
    "ایران",
    "ایرانی",
    "تهران",
    "tehran",
    "persia",
    "persian"
  ]
};


/* =========================================================
   JSON
   ========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}


/* =========================================================
   TEXT HELPERS
   ========================================================= */

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text, max = CONFIG.TELEGRAM_MAX_LENGTH) {
  const value = String(text || "");

  if (value.length <= max) {
    return value;
  }

  return value.slice(0, max - 3) + "...";
}


/* =========================================================
   IRAN FILTER
   ========================================================= */

function containsBlockedContent(text) {
  const value = cleanText(text).toLowerCase();

  if (!value) {
    return false;
  }

  return CONFIG.BLOCKED_COUNTRIES.some(
    word => value.includes(word.toLowerCase())
  );
}


/*
 * بررسی قوی‌تر برای عنوان + متن + منبع
 */

function isAllowedContent({
  title = "",
  description = "",
  content = "",
  source = "",
  country = ""
} = {}) {

  const combined = [
    title,
    description,
    content,
    source,
    country
  ].join(" ");

  return !containsBlockedContent(combined);
}


/* =========================================================
   DUPLICATE KEY
   ========================================================= */

async function sha256(text) {
  const data = new TextEncoder().encode(
    cleanText(text).toLowerCase()
  );

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return [...new Uint8Array(hash)]
    .map(
      byte =>
        byte.toString(16).padStart(2, "0")
    )
    .join("");
}


/* =========================================================
   TELEGRAM API
   ========================================================= */

async function telegram(env, method, body = {}) {

  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const response = await fetch(
    `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram API error: ${
        data.description || "Unknown error"
      }`
    );
  }

  return data;
}


/* =========================================================
   CHANNEL ID
   ========================================================= */

function getChannelId(env) {

  const id =
    env.TELEGRAM_CHANNEL_ID ||
    "";

  if (!id) {
    throw new Error(
      "TELEGRAM_CHANNEL_ID is not configured"
    );
  }

  return id;
}


/* =========================================================
   SEND TEXT
   ========================================================= */

async function sendMessage(env, text) {

  const channelId =
    getChannelId(env);

  const message =
    truncate(String(text || ""));

  if (!message.trim()) {
    throw new Error(
      "Message text is empty"
    );
  }

  return telegram(
    env,
    "sendMessage",
    {
      chat_id: channelId,
      text: message,
      disable_web_page_preview: true
    }
  );
}


/* =========================================================
   SEND HTML
   ========================================================= */

async function sendHtmlMessage(
  env,
  html
) {

  const channelId =
    getChannelId(env);

  const message =
    truncate(String(html || ""));

  if (!message.trim()) {
    throw new Error(
      "HTML message is empty"
    );
  }

  return telegram(
    env,
    "sendMessage",
    {
      chat_id: channelId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true
    }
  );
}


/* =========================================================
   SEND PHOTO
   ========================================================= */

async function sendPhoto(
  env,
  photo,
  caption = ""
) {

  const channelId =
    getChannelId(env);

  if (!photo) {
    throw new Error(
      "Photo URL is empty"
    );
  }

  return telegram(
    env,
    "sendPhoto",
    {
      chat_id: channelId,
      photo,
      caption: truncate(caption, 1024),
      parse_mode: "HTML"
    }
  );
}


/* =========================================================
   SEND NEWS POST
   ========================================================= */

async function publishNews(
  env,
  {
    title,
    summary,
    why,
    source,
    sourceUrl,
    imageUrl,
    credibility = 0,
    tags = []
  }
) {

  if (
    !isAllowedContent({
      title,
      description: summary,
      content: why,
      source
    })
  ) {

    return {
      ok: false,
      skipped: true,
      reason: "blocked-content"
    };
  }


  const cleanTitle =
    cleanText(title);

  const cleanSummary =
    cleanText(summary);

  const cleanWhy =
    cleanText(why);

  const cleanSource =
    cleanText(source);

  const cleanUrl =
    cleanText(sourceUrl);


  const duplicateKey =
    await sha256(
      `${cleanTitle}|${cleanSource}`
    );


  const post =
`🌍 <b>GLOBAL PULSE</b>

📰 <b>${escapeHtml(cleanTitle)}</b>

${escapeHtml(cleanSummary)}

💡 <b>Why it matters</b>
${escapeHtml(cleanWhy)}

🔎 <b>Source:</b> ${escapeHtml(cleanSource)}
🛡️ <b>Source credibility:</b> ${Number(credibility) || 0}/100

${cleanUrl ? `🔗 <a href="${escapeHtml(cleanUrl)}">Read the original source</a>` : ""}

${tags.length
  ? tags.map(
      tag => `#${String(tag).replace(/\s+/g, "")}`
    ).join(" ")
  : "#GlobalPulse"
}`;


  /*
   * اگر KV برای duplicate detection وجود داشته باشد
   */

  if (env.GLOBAL_PULSE_KV) {

    const exists =
      await env.GLOBAL_PULSE_KV.get(
        `news:${duplicateKey}`
      );

    if (exists) {

      return {
        ok: false,
        skipped: true,
        reason: "duplicate"
      };
    }

    await env.GLOBAL_PULSE_KV.put(
      `news:${duplicateKey}`,
      "published",
      {
        expirationTtl:
          CONFIG.DUPLICATE_TTL
      }
    );
  }


  /*
   * اگر عکس وجود داشته باشد
   * عکس + کپشن
   */

  if (imageUrl) {

    const result =
      await sendPhoto(
        env,
        imageUrl,
        post
      );

    return {
      ok: true,
      type: "photo",
      message_id:
        result.result.message_id
    };
  }


  /*
   * بدون عکس
   */

  const result =
    await sendHtmlMessage(
      env,
      post
    );

  return {
    ok: true,
    type: "text",
    message_id:
      result.result.message_id
  };
}


/* =========================================================
   GLOBAL PRICE POST
   ========================================================= */

async function publishPriceComparison(
  env,
  {
    product,
    prices,
    checkedDate,
    source
  }
) {

  if (
    !product ||
    !Array.isArray(prices) ||
    !prices.length
  ) {
    throw new Error(
      "Invalid price comparison data"
    );
  }


  const validPrices =
    prices.filter(item =>
      item &&
      item.country &&
      Number.isFinite(
        Number(item.price)
      )
    );


  if (!validPrices.length) {
    throw new Error(
      "No valid prices"
    );
  }


  validPrices.sort(
    (a, b) =>
      Number(a.price) -
      Number(b.price)
  );


  const cheapest =
    validPrices[0];


  let lines = [
    "🌍 <b>GLOBAL PRICE</b>",
    "",
    `🛒 <b>${escapeHtml(product)}</b>`,
    ""
  ];


  for (const item of validPrices) {

    lines.push(
      `${escapeHtml(item.flag || "🌎")} ` +
      `<b>${escapeHtml(item.country)}</b> — ` +
      `$${Number(item.price).toLocaleString()}`
    );
  }


  lines.push(
    "",
    `🏆 <b>CHEAPEST:</b> ${escapeHtml(
      cheapest.country
    )}`,
    `💰 <b>Price:</b> $${Number(
      cheapest.price
    ).toLocaleString()}`,
    `📅 <b>Checked:</b> ${escapeHtml(
      checkedDate || new Date().toISOString().slice(0, 10)
    )}`,
    `🔎 <b>Source:</b> ${escapeHtml(
      source || "Verified source"
    )}`,
    "",
    "#GlobalPulse #GlobalPrice"
  );


  return sendHtmlMessage(
    env,
    lines.join("\n")
  );
}


/* =========================================================
   COUNTRY BATTLE
   ========================================================= */

async function publishCountryBattle(
  env,
  {
    title,
    items,
    winner,
    source
  }
) {

  if (
    !title ||
    !Array.isArray(items) ||
    !items.length
  ) {
    throw new Error(
      "Invalid country battle data"
    );
  }


  const blocked =
    items.some(item =>
      containsBlockedContent(
        `${item.country || ""} ${item.value || ""}`
      )
    );


  if (blocked) {

    return {
      ok: false,
      skipped: true,
      reason: "blocked-country"
    };
  }


  const lines = [
    "🌍 <b>COUNTRY BATTLE</b>",
    "",
    `⚔️ <b>${escapeHtml(title)}</b>`,
    ""
  ];


  for (const item of items) {

    lines.push(
      `${escapeHtml(item.flag || "🌎")} ` +
      `<b>${escapeHtml(item.country)}</b> — ` +
      `${escapeHtml(item.value)}`
    );
  }


  if (winner) {

    lines.push(
      "",
      `🏆 <b>WINNER:</b> ${escapeHtml(winner)}`
    );
  }


  lines.push(
    "",
    `🔎 <b>Source:</b> ${escapeHtml(
      source || "Verified source"
    )}`,
    "",
    "#GlobalPulse #CountryBattle"
  );


  return sendHtmlMessage(
    env,
    lines.join("\n")
  );
}


/* =========================================================
   GLOBAL TREND
   ========================================================= */

async function publishTrend(
  env,
  {
    title,
    topic,
    countries,
    growth,
    why,
    source
  }
) {

  if (
    containsBlockedContent(
      `${title} ${topic} ${why} ${countries?.join(" ")}`
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason: "blocked-content"
    };
  }


  const countryText =
    Array.isArray(countries)
      ? countries
          .map(
            item =>
              `${item.flag || "🌎"} ${item.name || item}`
          )
          .join(" · ")
      : "";


  const post = [
    "🔥 <b>GLOBAL TREND</b>",
    "",
    `📈 <b>${escapeHtml(title || topic)}</b>`,
    "",
    countryText
      ? `🌍 <b>Top markets:</b>\n${escapeHtml(countryText)}`
      : "",
    growth
      ? `📊 <b>Growth:</b> ${escapeHtml(growth)}`
      : "",
    "",
    `💡 <b>Why it matters</b>\n${escapeHtml(why || "")}`,
    "",
    `🔎 <b>Source:</b> ${escapeHtml(
      source || "Verified source"
    )}`,
    "",
    "#GlobalPulse #GlobalTrend"
  ]
    .filter(Boolean)
    .join("\n");


  return sendHtmlMessage(
    env,
    post
  );
}


/* =========================================================
   CUSTOM POST
   ========================================================= */

async function publishCustom(
  env,
  body
) {

  const text =
    body.text ||
    body.message ||
    "";

  if (!text) {

    throw new Error(
      "text or message is required"
    );
  }


  if (
    containsBlockedContent(text)
  ) {

    return {
      ok: false,
      skipped: true,
      reason: "blocked-content"
    };
  }


  return sendMessage(
    env,
    text
  );
}


/* =========================================================
   REQUEST JSON
   ========================================================= */

async function readJson(request) {

  try {

    return await request.json();

  } catch {

    return {};
  }
}


/* =========================================================
   MAIN
   ========================================================= */

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);


    try {


      /* =====================================================
         HEALTH
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {

        return json({

          ok: true,

          service:
            CONFIG.SERVICE,

          worker:
            CONFIG.WORKER,

          status:
            "online",

          time:
            new Date().toISOString(),

          telegram: {

            telegram_bot_token:
              !!env.TELEGRAM_BOT_TOKEN,

            telegram_channel_id:
              !!env.TELEGRAM_CHANNEL_ID,

            channel_id:
              env.TELEGRAM_CHANNEL_ID || null
          },

          features: {

            news:
              true,

            price:
              true,

            country_battle:
              true,

            trends:
              true,

            iran_filter:
              true,

            duplicate_filter:
              !!env.GLOBAL_PULSE_KV,

            image_posts:
              true
          }

        });
      }


      /* =====================================================
         DEBUG ENV
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/debug-env"
      ) {

        return json({

          ok: true,

          telegram_bot_token:
            !!env.TELEGRAM_BOT_TOKEN,

          telegram_channel_id:
            !!env.TELEGRAM_CHANNEL_ID,

          channel_id:
            env.TELEGRAM_CHANNEL_ID || null,

          kv:
            !!env.GLOBAL_PULSE_KV,

          env_keys:
            Object.keys(env)
        });
      }


      /* =====================================================
         TELEGRAM BOT
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/test-telegram"
      ) {

        const me =
          await telegram(
            env,
            "getMe"
          );


        return json({

          ok: true,

          bot:
            me.result,

          channel_id:
            env.TELEGRAM_CHANNEL_ID ||
            null
        });
      }


      /* =====================================================
         TEST CHANNEL
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/test-channel"
      ) {

        const message = [
          "🌍 Global Pulse",
          "",
          "✅ Worker connected to Telegram.",
          "",
          "🤖 Global Pulse Assistant",
          "⚙️ Global publishing system is ready.",
          "",
          "📰 Global News",
          "💰 Global Price",
          "⚔️ Country Battle",
          "🔥 Global Trend",
          "🏠 Cost of Living"
        ].join("\n");


        const result =
          await sendMessage(
            env,
            message
          );


        return json({

          ok: true,

          message_id:
            result.result.message_id,

          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }


      /* =====================================================
         CUSTOM SEND
         POST /send
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/send"
      ) {

        const body =
          await readJson(request);


        const result =
          await publishCustom(
            env,
            body
          );


        return json({
          ...result,
          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }


      /* =====================================================
         SEND HTML
         POST /send-html
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/send-html"
      ) {

        const body =
          await readJson(request);


        const html =
          body.html ||
          body.text ||
          "";


        if (!html) {

          return json(
            {
              ok: false,
              error:
                "html or text is required"
            },
            400
          );
        }


        const result =
          await sendHtmlMessage(
            env,
            html
          );


        return json({

          ok: true,

          message_id:
            result.result.message_id,

          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }


      /* =====================================================
         SEND NEWS
         POST /publish-news
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-news"
      ) {

        const body =
          await readJson(request);


        const result =
          await publishNews(
            env,
            body
          );


        return json(result);
      }


      /* =====================================================
         GLOBAL PRICE
         POST /publish-price
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-price"
      ) {

        const body =
          await readJson(request);


        const result =
          await publishPriceComparison(
            env,
            body
          );


        return json({

          ok: true,

          message_id:
            result.result.message_id,

          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }


      /* =====================================================
         COUNTRY BATTLE
         POST /publish-country-battle
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-country-battle"
      ) {

        const body =
          await readJson(request);


        const result =
          await publishCountryBattle(
            env,
            body
          );


        return json(result);
      }


      /* =====================================================
         GLOBAL TREND
         POST /publish-trend
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-trend"
      ) {

        const body =
          await readJson(request);


        const result =
          await publishTrend(
            env,
            body
          );


        return json(result);
      }


      /* =====================================================
         WEBHOOK
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/telegram-webhook"
      ) {

        const update =
          await request.json();


        console.log(
          JSON.stringify({
            type:
              "telegram_update",

            update_id:
              update.update_id ||
              null
          })
        );


        return json({
          ok: true
        });
      }


      /* =====================================================
         404
      ===================================================== */

      return json(
        {
          ok: false,
          error: "Not Found",
          path: url.pathname
        },
        404
      );


    } catch (error) {

      console.error(
        JSON.stringify({
          error:
            error.message ||
            String(error),

          path:
            url.pathname
        })
      );


      return json(
        {
          ok: false,

          error:
            error.message ||
            String(error)
        },
        500
      );
    }
  }
};
