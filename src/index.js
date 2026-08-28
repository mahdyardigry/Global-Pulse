const TELEGRAM_API = "https://api.telegram.org";

/* =========================================================
   GLOBAL PULSE — TELEGRAM AUTO CHANNEL
   VERSION 3
   =========================================================
   امکانات:
   - Telegram Bot
   - ارسال متن / HTML / عکس
   - انتشار خبر کامل
   - فیلتر کامل محتوای مرتبط با ایران
   - جلوگیری از خبر تکراری در حافظه Worker
   - Global News
   - Global Price
   - Country Battle
   - Global Trend
   - Cost of Living
   - Health / Debug
   - آماده برای اتصال News API / RSS / AI
   - بدون نیاز به KV
   ========================================================= */

const CONFIG = {
  SERVICE: "Global Pulse",
  WORKER: "telegram-auto-channel",

  LANGUAGE: "en",

  TELEGRAM_MAX_LENGTH: 4096,
  TELEGRAM_CAPTION_LENGTH: 1024,

  /* نگهداری هش خبرها در حافظه Worker */
  DUPLICATE_TTL_MS: 24 * 60 * 60 * 1000,

  /*
   * کشورهای/کلیدواژه‌های ممنوع
   * هر محتوایی که این موارد را داشته باشد منتشر نمی‌شود.
   */
  BLOCKED_TERMS: [
    "iran",
    "iranian",
    "islamic republic of iran",
    "tehran",
    "persia",
    "persian",
    "ایران",
    "ایرانی",
    "تهران",
    "پرشیا"
  ]
};


/* =========================================================
   SHORT-TERM DUPLICATE MEMORY
   ========================================================= */

const recentNews = new Map();


/* =========================================================
   JSON RESPONSE
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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function truncate(text, max = CONFIG.TELEGRAM_MAX_LENGTH) {

  const value = String(text || "");

  if (value.length <= max) {
    return value;
  }

  return value.slice(0, max - 3) + "...";
}


/* =========================================================
   URL VALIDATION
   ========================================================= */

function validUrl(value) {

  if (!value) {
    return false;
  }

  try {

    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );

  } catch {

    return false;
  }
}


/* =========================================================
   IRAN FILTER
   ========================================================= */

function containsBlockedContent(text) {

  const value =
    cleanText(text).toLowerCase();

  if (!value) {
    return false;
  }

  return CONFIG.BLOCKED_TERMS.some(
    term =>
      value.includes(
        term.toLowerCase()
      )
  );
}


/* =========================================================
   CONTENT VALIDATION
   ========================================================= */

function isAllowedContent({
  title = "",
  summary = "",
  content = "",
  why = "",
  source = "",
  country = "",
  tags = []
} = {}) {

  const combined = [
    title,
    summary,
    content,
    why,
    source,
    country,
    Array.isArray(tags)
      ? tags.join(" ")
      : tags
  ].join(" ");

  return !containsBlockedContent(
    combined
  );
}


/* =========================================================
   SHA-256
   ========================================================= */

async function sha256(text) {

  const data =
    new TextEncoder().encode(
      cleanText(text).toLowerCase()
    );

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return [...new Uint8Array(hash)]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


/* =========================================================
   DUPLICATE MEMORY
   ========================================================= */

function cleanupDuplicateMemory() {

  const now =
    Date.now();

  for (
    const [key, timestamp]
    of recentNews.entries()
  ) {

    if (
      now - timestamp >
      CONFIG.DUPLICATE_TTL_MS
    ) {

      recentNews.delete(key);
    }
  }
}


async function isDuplicateNews(key) {

  cleanupDuplicateMemory();

  const hash =
    await sha256(key);

  if (recentNews.has(hash)) {
    return true;
  }

  recentNews.set(
    hash,
    Date.now()
  );

  return false;
}


/* =========================================================
   TELEGRAM API
   ========================================================= */

async function telegram(
  env,
  method,
  body = {}
) {

  if (!env.TELEGRAM_BOT_TOKEN) {

    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const response =
    await fetch(
      `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
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

  const data =
    await response.json();

  if (!data.ok) {

    throw new Error(
      `Telegram API error: ${
        data.description ||
        "Unknown error"
      }`
    );
  }

  return data;
}


/* =========================================================
   CHANNEL
   ========================================================= */

function getChannelId(env) {

  const id =
    env.TELEGRAM_CHANNEL_ID;

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

async function sendMessage(
  env,
  text
) {

  const channelId =
    getChannelId(env);

  const message =
    truncate(
      String(text || "")
    );

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
    truncate(
      String(html || "")
    );

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

  if (!validUrl(photo)) {

    throw new Error(
      "Invalid photo URL"
    );
  }

  return telegram(
    env,
    "sendPhoto",
    {
      chat_id: channelId,
      photo,
      caption:
        truncate(
          caption,
          CONFIG.TELEGRAM_CAPTION_LENGTH
        ),
      parse_mode: "HTML"
    }
  );
}


/* =========================================================
   NEWS POST
   ========================================================= */

async function publishNews(
  env,
  body
) {

  const {
    title = "",
    summary = "",
    content = "",
    why = "",
    source = "",
    sourceUrl = "",
    imageUrl = "",
    credibility = 0,
    category = "Global News",
    country = "",
    tags = []
  } = body || {};


  if (!title) {

    throw new Error(
      "News title is required"
    );
  }


  if (
    !isAllowedContent({
      title,
      summary,
      content,
      why,
      source,
      country,
      tags
    })
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
    };
  }


  /*
   * جلوگیری از خبر تکراری
   */

  const duplicate =
    await isDuplicateNews(
      `${title}|${source}|${sourceUrl}`
    );

  if (duplicate) {

    return {
      ok: false,
      skipped: true,
      reason:
        "duplicate"
    };
  }


  const cleanTitle =
    cleanText(title);

  const cleanSummary =
    cleanText(summary);

  const cleanContent =
    cleanText(content);

  const cleanWhy =
    cleanText(why);

  const cleanSource =
    cleanText(source);

  const cleanSourceUrl =
    cleanText(sourceUrl);


  const tagText =
    Array.isArray(tags) &&
    tags.length
      ? tags
          .map(
            tag =>
              "#" +
              String(tag)
                .replace(
                  /\s+/g,
                  ""
                )
          )
          .join(" ")
      : "#GlobalPulse";


  let post = [
    "🌍 <b>GLOBAL PULSE</b>",
    "",
    `📰 <b>${escapeHtml(
      cleanTitle
    )}</b>`,
    "",
    category
      ? `📌 <b>${escapeHtml(
          category
        )}</b>`
      : "",
    "",
    cleanSummary
      ? escapeHtml(
          cleanSummary
        )
      : "",
    "",
    cleanContent
      ? `📖 <b>Full story</b>\n${escapeHtml(
          cleanContent
        )}`
      : "",
    "",
    cleanWhy
      ? `💡 <b>Why it matters</b>\n${escapeHtml(
          cleanWhy
        )}`
      : "",
    "",
    cleanSource
      ? `🔎 <b>Source:</b> ${escapeHtml(
          cleanSource
        )}`
      : "",
    credibility
      ? `🛡️ <b>Source credibility:</b> ${Number(
          credibility
        ) || 0}/100`
      : "",
    "",
    validUrl(cleanSourceUrl)
      ? `🔗 <a href="${escapeHtml(
          cleanSourceUrl
        )}">Read original source</a>`
      : "",
    "",
    tagText
  ]
    .filter(Boolean)
    .join("\n");


  post =
    truncate(post);


  /*
   * ارسال عکس
   */

  if (
    imageUrl &&
    validUrl(imageUrl)
  ) {

    try {

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

    } catch (error) {

      /*
       * اگر تصویر خراب بود
       * خبر را بدون تصویر می‌فرستیم.
       */

      console.error(
        "PHOTO_SEND_FAILED",
        error.message
      );
    }
  }


  /*
   * ارسال متن کامل
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
   GLOBAL PRICE
   ========================================================= */

async function publishPriceComparison(
  env,
  body
) {

  const {
    product = "",
    prices = [],
    checkedDate = "",
    source = "",
    sourceUrl = ""
  } = body || {};


  if (
    !product ||
    !Array.isArray(prices) ||
    !prices.length
  ) {

    throw new Error(
      "Invalid price comparison data"
    );
  }


  if (
    containsBlockedContent(
      `${product} ${source}`
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
    };
  }


  const validPrices =
    prices.filter(
      item =>
        item &&
        item.country &&
        !containsBlockedContent(
          item.country
        ) &&
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


  const lines = [
    "🌍 <b>GLOBAL PRICE</b>",
    "",
    `🛒 <b>${escapeHtml(
      product
    )}</b>`,
    ""
  ];


  for (
    const item
    of validPrices
  ) {

    lines.push(
      `${escapeHtml(
        item.flag || "🌎"
      )} <b>${escapeHtml(
        item.country
      )}</b> — $${Number(
        item.price
      ).toLocaleString()}`
    );
  }


  lines.push(
    "",
    `🏆 <b>CHEAPEST:</b> ${escapeHtml(
      cheapest.country
    )}`,
    `💰 <b>PRICE:</b> $${Number(
      cheapest.price
    ).toLocaleString()}`,
    `📅 <b>CHECKED:</b> ${escapeHtml(
      checkedDate ||
      new Date()
        .toISOString()
        .slice(0, 10)
    )}`,
    source
      ? `🔎 <b>SOURCE:</b> ${escapeHtml(
          source
        )}`
      : "",
    validUrl(sourceUrl)
      ? `🔗 <a href="${escapeHtml(
          sourceUrl
        )}">View source</a>`
      : "",
    "",
    "#GlobalPulse #GlobalPrice"
  );


  return sendHtmlMessage(
    env,
    lines
      .filter(Boolean)
      .join("\n")
  );
}


/* =========================================================
   COUNTRY BATTLE
   ========================================================= */

async function publishCountryBattle(
  env,
  body
) {

  const {
    title = "",
    items = [],
    winner = "",
    source = "",
    sourceUrl = ""
  } = body || {};


  if (
    !title ||
    !Array.isArray(items) ||
    !items.length
  ) {

    throw new Error(
      "Invalid country battle data"
    );
  }


  if (
    containsBlockedContent(
      `${title} ${winner} ${source}`
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
    };
  }


  const safeItems =
    items.filter(
      item =>
        item &&
        item.country &&
        !containsBlockedContent(
          `${item.country} ${item.value || ""}`
        )
    );


  if (!safeItems.length) {

    return {
      ok: false,
      skipped: true,
      reason:
        "no-allowed-countries"
    };
  }


  const lines = [
    "🌍 <b>COUNTRY BATTLE</b>",
    "",
    `⚔️ <b>${escapeHtml(
      title
    )}</b>`,
    ""
  ];


  for (
    const item
    of safeItems
  ) {

    lines.push(
      `${escapeHtml(
        item.flag || "🌎"
      )} <b>${escapeHtml(
        item.country
      )}</b> — ${escapeHtml(
        item.value
      )}`
    );
  }


  if (winner) {

    lines.push(
      "",
      `🏆 <b>WINNER:</b> ${escapeHtml(
        winner
      )}`
    );
  }


  lines.push(
    "",
    source
      ? `🔎 <b>SOURCE:</b> ${escapeHtml(
          source
        )}`
      : "",
    validUrl(sourceUrl)
      ? `🔗 <a href="${escapeHtml(
          sourceUrl
        )}">View source</a>`
      : "",
    "",
    "#GlobalPulse #CountryBattle"
  );


  return sendHtmlMessage(
    env,
    lines
      .filter(Boolean)
      .join("\n")
  );
}


/* =========================================================
   GLOBAL TREND
   ========================================================= */

async function publishTrend(
  env,
  body
) {

  const {
    title = "",
    topic = "",
    countries = [],
    growth = "",
    why = "",
    source = "",
    sourceUrl = ""
  } = body || {};


  if (
    containsBlockedContent(
      `${title} ${topic} ${why} ${source}`
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
    };
  }


  const safeCountries =
    Array.isArray(countries)
      ? countries.filter(
          item =>
            !containsBlockedContent(
              typeof item === "string"
                ? item
                : `${item.name || ""}`
            )
        )
      : [];


  const countryText =
    safeCountries.length
      ? safeCountries
          .map(
            item =>
              `${item.flag || "🌎"} ${
                item.name || item
              }`
          )
          .join(" · ")
      : "";


  const post = [
    "🔥 <b>GLOBAL TREND</b>",
    "",
    `📈 <b>${escapeHtml(
      title || topic
    )}</b>`,
    "",
    countryText
      ? `🌍 <b>Top markets:</b>\n${escapeHtml(
          countryText
        )}`
      : "",
    growth
      ? `📊 <b>Growth:</b> ${escapeHtml(
          growth
        )}`
      : "",
    "",
    why
      ? `💡 <b>Why it matters</b>\n${escapeHtml(
          why
        )}`
      : "",
    "",
    source
      ? `🔎 <b>Source:</b> ${escapeHtml(
          source
        )}`
      : "",
    validUrl(sourceUrl)
      ? `🔗 <a href="${escapeHtml(
          sourceUrl
        )}">View source</a>`
      : "",
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
   COST OF LIVING
   ========================================================= */

async function publishCostOfLiving(
  env,
  body
) {

  const {
    city = "",
    country = "",
    rent = "",
    food = "",
    transport = "",
    total = "",
    source = "",
    sourceUrl = ""
  } = body || {};


  if (
    containsBlockedContent(
      `${city} ${country} ${source}`
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
    };
  }


  const post = [
    "🏠 <b>COST OF LIVING</b>",
    "",
    `📍 <b>${escapeHtml(
      city
    )}, ${escapeHtml(
      country
    )}</b>`,
    "",
    rent
      ? `🏠 Rent: ${escapeHtml(
          rent
        )}`
      : "",
    food
      ? `🍽️ Food: ${escapeHtml(
          food
        )}`
      : "",
    transport
      ? `🚇 Transport: ${escapeHtml(
          transport
        )}`
      : "",
    total
      ? `💰 Estimated monthly total: ${escapeHtml(
          total
        )}`
      : "",
    "",
    source
      ? `🔎 <b>Source:</b> ${escapeHtml(
          source
        )}`
      : "",
    validUrl(sourceUrl)
      ? `🔗 <a href="${escapeHtml(
          sourceUrl
        )}">View source</a>`
      : "",
    "",
    "#GlobalPulse #CostOfLiving"
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
      reason:
        "blocked-content"
    };
  }


  return sendMessage(
    env,
    text
  );
}


/* =========================================================
   READ JSON
   ========================================================= */

async function readJson(
  request
) {

  try {

    return await request.json();

  } catch {

    return {};
  }
}


/* =========================================================
   HEALTH RESPONSE
   ========================================================= */

function health(env) {

  return {
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
        env.TELEGRAM_CHANNEL_ID ||
        null
    },

    features: {

      global_news:
        true,

      full_news:
        true,

      image_posts:
        true,

      global_price:
        true,

      country_battle:
        true,

      global_trend:
        true,

      cost_of_living:
        true,

      iran_filter:
        true,

      duplicate_filter:
        true,

      kv_required:
        false,

      ai:
        false,

      scheduler:
        false
    },

    note:
      "News collection, AI processing and scheduling can be connected to this Worker."
  };
}


/* =========================================================
   MAIN WORKER
   ========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

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

        return json(
          health(env)
        );
      }


      /* =====================================================
         DEBUG
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
            env.TELEGRAM_CHANNEL_ID ||
            null,

          duplicate_memory:
            recentNews.size,

          env_keys:
            Object.keys(env)
              .filter(
                key =>
                  key !==
                  "TELEGRAM_BOT_TOKEN"
              )
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
         CHANNEL TEST
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
          await readJson(
            request
          );


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
          await readJson(
            request
          );


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
         NEWS
         POST /publish-news
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-news"
      ) {

        const body =
          await readJson(
            request
          );


        const result =
          await publishNews(
            env,
            body
          );


        return json(
          result
        );
      }


      /* =====================================================
         PRICE
         POST /publish-price
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-price"
      ) {

        const body =
          await readJson(
            request
          );


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
        url.pathname ===
          "/publish-country-battle"
      ) {

        const body =
          await readJson(
            request
          );


        const result =
          await publishCountryBattle(
            env,
            body
          );


        return json(
          result
        );
      }


      /* =====================================================
         GLOBAL TREND
         POST /publish-trend
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname ===
          "/publish-trend"
      ) {

        const body =
          await readJson(
            request
          );


        const result =
          await publishTrend(
            env,
            body
          );


        return json(
          result
        );
      }


      /* =====================================================
         COST OF LIVING
         POST /publish-cost
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname ===
          "/publish-cost"
      ) {

        const body =
          await readJson(
            request
          );


        const result =
          await publishCostOfLiving(
            env,
            body
          );


        return json(
          result
        );
      }


      /* =====================================================
         TELEGRAM WEBHOOK
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname ===
          "/telegram-webhook"
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
          path:
            url.pathname
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
            String(error),

          path:
            url.pathname
        },
        500
      );
    }
  }
};
