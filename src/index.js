const TELEGRAM_API = "https://api.telegram.org";

/* =========================================================
   GLOBAL PULSE — TELEGRAM AUTO CHANNEL V3
   ========================================================= */

const CONFIG = {
  SERVICE: "Global Pulse",
  WORKER: "telegram-auto-channel",

  LANGUAGE: "en",

  TELEGRAM_MAX_LENGTH: 4096,
  TELEGRAM_CAPTION_MAX_LENGTH: 1024,

  DUPLICATE_TTL: 86400,

  BLOCKED_TERMS: [
    "iran",
    "iranian",
    "islamic republic of iran",
    "tehran",
    "persia",
    "persian",
    "ایران",
    "ایرانی",
    "تهران"
  ],

  NEWS_SOURCES: [
    {
      name: "Reuters",
      url: "https://www.reuters.com/"
    },
    {
      name: "BBC",
      url: "https://www.bbc.com/news"
    },
    {
      name: "Al Jazeera",
      url: "https://www.aljazeera.com/"
    },
    {
      name: "AP News",
      url: "https://apnews.com/"
    },
    {
      name: "The Guardian",
      url: "https://www.theguardian.com/international"
    },
    {
      name: "DW",
      url: "https://www.dw.com/"
    }
  ]
};


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
   TEXT
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


function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


function truncate(
  text,
  max = CONFIG.TELEGRAM_MAX_LENGTH
) {
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


function isAllowedContent({
  title = "",
  summary = "",
  content = "",
  source = "",
  country = "",
  tags = []
} = {}) {

  const combined = [
    title,
    summary,
    content,
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
   HASH
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
   TELEGRAM
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
    cleanText(
      env.TELEGRAM_CHANNEL_ID
    );

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
    truncate(text);

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
      disable_web_page_preview:
        true
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
    truncate(html);

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
      disable_web_page_preview:
        false
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
      caption:
        truncate(
          caption,
          CONFIG.TELEGRAM_CAPTION_MAX_LENGTH
        ),
      parse_mode: "HTML"
    }
  );
}


/* =========================================================
   KV
   ========================================================= */

async function isDuplicate(
  env,
  key
) {

  if (!env.GLOBAL_PULSE_KV) {
    return false;
  }

  const exists =
    await env.GLOBAL_PULSE_KV.get(
      `published:${key}`
    );

  return !!exists;
}


async function markPublished(
  env,
  key
) {

  if (!env.GLOBAL_PULSE_KV) {
    return;
  }

  await env.GLOBAL_PULSE_KV.put(
    `published:${key}`,
    "1",
    {
      expirationTtl:
        CONFIG.DUPLICATE_TTL
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
    tags = [],
    country = "",
    publishedAt = ""
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


  const duplicateKey =
    await sha256(
      [
        title,
        source,
        sourceUrl
      ].join("|")
    );


  if (
    await isDuplicate(
      env,
      duplicateKey
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "duplicate"
    };
  }


  const safeTitle =
    escapeHtml(
      cleanText(title)
    );

  const safeSummary =
    escapeHtml(
      cleanText(summary)
    );

  const safeContent =
    escapeHtml(
      cleanText(content)
    );

  const safeWhy =
    escapeHtml(
      cleanText(why)
    );

  const safeSource =
    escapeHtml(
      cleanText(source)
    );

  const safeSourceUrl =
    escapeAttribute(
      cleanText(sourceUrl)
    );


  const score =
    Math.max(
      0,
      Math.min(
        100,
        Number(credibility) || 0
      )
    );


  const hashtagText =
    Array.isArray(tags) &&
    tags.length
      ? tags
          .map(
            tag =>
              "#" +
              String(tag)
                .replace(
                  /[^a-zA-Z0-9_]/g,
                  ""
                )
          )
          .filter(Boolean)
          .join(" ")
      : "#GlobalPulse";


  let post =
`🌍 <b>GLOBAL PULSE</b>

📰 <b>${safeTitle}</b>

${safeSummary || ""}

${safeContent
  ? `\n📖 <b>Full story</b>\n${safeContent}\n`
  : ""}

${safeWhy
  ? `💡 <b>Why it matters</b>\n${safeWhy}\n`
  : ""}

🔎 <b>Source:</b> ${safeSource || "Verified source"}
🛡️ <b>Source credibility:</b> ${score}/100

${safeSourceUrl
  ? `🔗 <a href="${safeSourceUrl}">Read original source</a>\n`
  : ""}

${publishedAt
  ? `🕒 ${escapeHtml(publishedAt)}\n`
  : ""}

${hashtagText}`;


  post =
    truncate(post);


  let result;


  if (imageUrl) {

    result =
      await sendPhoto(
        env,
        imageUrl,
        post
      );

  } else {

    result =
      await sendHtmlMessage(
        env,
        post
      );
  }


  await markPublished(
    env,
    duplicateKey
  );


  return {
    ok: true,

    type:
      imageUrl
        ? "photo"
        : "text",

    message_id:
      result.result.message_id
  };
}


/* =========================================================
   GLOBAL PRICE
   ========================================================= */

async function publishPrice(
  env,
  body
) {

  const {
    product = "",
    prices = [],
    source = "",
    sourceUrl = "",
    checkedDate = ""
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


  const valid =
    prices.filter(
      item =>
        item &&
        item.country &&
        Number.isFinite(
          Number(item.price)
        )
    );


  if (!valid.length) {
    throw new Error(
      "No valid prices"
    );
  }


  const blocked =
    valid.some(
      item =>
        containsBlockedContent(
          `${item.country} ${item.name || ""}`
        )
    );


  if (blocked) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-country"
    };
  }


  valid.sort(
    (a, b) =>
      Number(a.price) -
      Number(b.price)
  );


  const cheapest =
    valid[0];


  const lines = [
    "🌍 <b>GLOBAL PRICE</b>",
    "",
    `🛒 <b>${escapeHtml(product)}</b>`,
    ""
  ];


  for (const item of valid) {

    lines.push(
      `${escapeHtml(item.flag || "🌎")} ` +
      `<b>${escapeHtml(item.country)}</b> — ` +
      `${escapeHtml(item.currency || "$")}` +
      `${Number(item.price).toLocaleString()}`
    );
  }


  lines.push(
    "",
    `🏆 <b>CHEAPEST:</b> ${escapeHtml(cheapest.country)}`,
    `💰 <b>Price:</b> ${escapeHtml(cheapest.currency || "$")}${Number(cheapest.price).toLocaleString()}`,
    `📅 <b>Checked:</b> ${escapeHtml(checkedDate || new Date().toISOString().slice(0, 10))}`,
    `🔎 <b>Source:</b> ${escapeHtml(source || "Verified source")}`
  );


  if (sourceUrl) {

    lines.push(
      `🔗 <a href="${escapeAttribute(sourceUrl)}">Source</a>`
    );
  }


  lines.push(
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
      [
        title,
        winner,
        source,
        ...items.map(
          item =>
            `${item.country || ""} ${item.value || ""}`
        )
      ].join(" ")
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
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
    `🔎 <b>Source:</b> ${escapeHtml(source || "Verified source")}`
  );


  if (sourceUrl) {

    lines.push(
      `🔗 <a href="${escapeAttribute(sourceUrl)}">Source</a>`
    );
  }


  lines.push(
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
      [
        title,
        topic,
        why,
        source,
        JSON.stringify(countries)
      ].join(" ")
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
    };
  }


  const lines = [
    "🔥 <b>GLOBAL TREND</b>",
    "",
    `📈 <b>${escapeHtml(title || topic)}</b>`
  ];


  if (
    Array.isArray(countries) &&
    countries.length
  ) {

    lines.push(
      "",
      "🌍 <b>Top markets:</b>"
    );

    for (const item of countries) {

      lines.push(
        `${escapeHtml(item.flag || "🌎")} ` +
        `${escapeHtml(item.name || item)}`
      );
    }
  }


  if (growth) {

    lines.push(
      "",
      `📊 <b>Growth:</b> ${escapeHtml(growth)}`
    );
  }


  if (why) {

    lines.push(
      "",
      `💡 <b>Why it matters</b>`,
      escapeHtml(why)
    );
  }


  lines.push(
    "",
    `🔎 <b>Source:</b> ${escapeHtml(source || "Verified source")}`
  );


  if (sourceUrl) {

    lines.push(
      `🔗 <a href="${escapeAttribute(sourceUrl)}">Source</a>`
    );
  }


  lines.push(
    "",
    "#GlobalPulse #GlobalTrend"
  );


  return sendHtmlMessage(
    env,
    lines.join("\n")
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
    items = [],
    monthlyIncome = "",
    source = "",
    sourceUrl = ""
  } = body || {};


  if (
    containsBlockedContent(
      [
        city,
        country,
        source,
        JSON.stringify(items)
      ].join(" ")
    )
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
    };
  }


  const lines = [
    "🏠 <b>COST OF LIVING</b>",
    "",
    `📍 <b>${escapeHtml(city)}, ${escapeHtml(country)}</b>`,
    ""
  ];


  for (const item of items) {

    lines.push(
      `${escapeHtml(item.icon || "💵")} ` +
      `<b>${escapeHtml(item.name)}</b>: ` +
      `${escapeHtml(item.value)}`
    );
  }


  if (monthlyIncome) {

    lines.push(
      "",
      `💼 <b>Reference income:</b> ${escapeHtml(monthlyIncome)}`
    );
  }


  lines.push(
    "",
    `🔎 <b>Source:</b> ${escapeHtml(source || "Verified source")}`
  );


  if (sourceUrl) {

    lines.push(
      `🔗 <a href="${escapeAttribute(sourceUrl)}">Source</a>`
    );
  }


  lines.push(
    "",
    "#GlobalPulse #CostOfLiving"
  );


  return sendHtmlMessage(
    env,
    lines.join("\n")
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


  const result =
    await sendMessage(
      env,
      text
    );


  return {
    ok: true,
    message_id:
      result.result.message_id
  };
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
   MAIN WORKER
   ========================================================= */

export default {

  async fetch(
    request,
    env,
    ctx
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
              env.TELEGRAM_CHANNEL_ID ||
              null
          },

          storage: {

            kv:
              !!env.GLOBAL_PULSE_KV
          },

          features: {

            global_news:
              true,

            full_news:
              true,

            image_news:
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
              !!env.GLOBAL_PULSE_KV,

            telegram_html:
              true
          }
        });
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

          kv:
            !!env.GLOBAL_PULSE_KV,

          env_keys:
            Object.keys(env)
        });
      }


      /* =====================================================
         BOT TEST
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

        const result =
          await sendMessage(
            env,
            [
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
            ].join("\n")
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
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/send"
      ) {

        const body =
          await readJson(request);

        return json(
          await publishCustom(
            env,
            body
          )
        );
      }


      /* =====================================================
         SEND HTML
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
         NEWS
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-news"
      ) {

        const body =
          await readJson(request);

        return json(
          await publishNews(
            env,
            body
          )
        );
      }


      /* =====================================================
         PRICE
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-price"
      ) {

        const body =
          await readJson(request);

        return json(
          await publishPrice(
            env,
            body
          )
        );
      }


      /* =====================================================
         COUNTRY BATTLE
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-country-battle"
      ) {

        const body =
          await readJson(request);

        return json(
          await publishCountryBattle(
            env,
            body
          )
        );
      }


      /* =====================================================
         TREND
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-trend"
      ) {

        const body =
          await readJson(request);

        return json(
          await publishTrend(
            env,
            body
          )
        );
      }


      /* =====================================================
         COST OF LIVING
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-cost"
      ) {

        const body =
          await readJson(request);

        return json(
          await publishCostOfLiving(
            env,
            body
          )
        );
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
            String(error),

          path:
            url.pathname
        },
        500
      );
    }
  }
};
