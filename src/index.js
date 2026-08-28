const TELEGRAM_API = "https://api.telegram.org";

/* =========================================================
   GLOBAL PULSE — TELEGRAM AUTO CHANNEL V3
   ========================================================= */

const CONFIG = {
  SERVICE: "Global Pulse",
  WORKER: "telegram-auto-channel",

  LANGUAGE: "en",

  MAX_TELEGRAM_TEXT: 4096,
  MAX_CAPTION: 1024,

  DUPLICATE_TTL: 86400,

  MAX_NEWS_PER_RUN: 5,

  BLOCKED_WORDS: [
    "iran",
    "iranian",
    "islamic republic of iran",
    "tehran",
    "persia",
    "persian",
    "ایران",
    "ایرانی",
    "تهران",
    "فارس",
    "پرشیا"
  ],

  RSS_FEEDS: [
    {
      name: "BBC World",
      url: "https://feeds.bbci.co.uk/news/world/rss.xml",
      credibility: 92
    },
    {
      name: "Al Jazeera",
      url: "https://www.aljazeera.com/xml/rss/all.xml",
      credibility: 85
    },
    {
      name: "The Guardian World",
      url: "https://www.theguardian.com/world/rss",
      credibility: 90
    },
    {
      name: "NPR World",
      url: "https://feeds.npr.org/1004/rss.xml",
      credibility: 91
    }
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
   TEXT
   ========================================================= */

function cleanText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}


function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


function truncate(text, max) {
  const value = String(text || "");

  if (value.length <= max) {
    return value;
  }

  return value.slice(0, max - 3) + "...";
}


/* =========================================================
   URL
   ========================================================= */

function validUrl(value) {
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

  return CONFIG.BLOCKED_WORDS.some(
    word =>
      value.includes(word.toLowerCase())
  );
}


function isAllowedNews(news) {
  const combined = [
    news.title,
    news.description,
    news.content,
    news.source,
    news.url
  ].join(" ");

  return !containsBlockedContent(combined);
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

  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error(
      "TELEGRAM_CHANNEL_ID is not configured"
    );
  }

  return env.TELEGRAM_CHANNEL_ID;
}


/* =========================================================
   SEND TEXT
   ========================================================= */

async function sendMessage(
  env,
  text
) {

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:
        getChannelId(env),

      text:
        truncate(
          text,
          CONFIG.MAX_TELEGRAM_TEXT
        ),

      disable_web_page_preview:
        true
    }
  );
}


/* =========================================================
   SEND HTML
   ========================================================= */

async function sendHtml(
  env,
  html
) {

  return telegram(
    env,
    "sendMessage",
    {
      chat_id:
        getChannelId(env),

      text:
        truncate(
          html,
          CONFIG.MAX_TELEGRAM_TEXT
        ),

      parse_mode:
        "HTML",

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
  caption
) {

  return telegram(
    env,
    "sendPhoto",
    {
      chat_id:
        getChannelId(env),

      photo,

      caption:
        truncate(
          caption,
          CONFIG.MAX_CAPTION
        ),

      parse_mode:
        "HTML"
    }
  );
}


/* =========================================================
   RSS FETCH
   ========================================================= */

async function fetchFeed(feed) {

  const response =
    await fetch(
      feed.url,
      {
        headers: {
          "user-agent":
            "GlobalPulse/3.0",
          "accept":
            "application/rss+xml, application/xml, text/xml"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `${feed.name}: HTTP ${response.status}`
    );
  }

  const xml =
    await response.text();

  return parseRSS(
    xml,
    feed
  );
}


/* =========================================================
   XML HELPERS
   ========================================================= */

function xmlValue(
  block,
  tag
) {

  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    block.match(regex);

  return match
    ? cleanText(match[1])
    : "";
}


function xmlRaw(
  block,
  tag
) {

  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    block.match(regex);

  return match
    ? match[1]
    : "";
}


/* =========================================================
   IMAGE EXTRACTION
   ========================================================= */

function extractImage(block) {

  let match =
    block.match(
      /<media:content[^>]+url=["']([^"']+)["']/i
    );

  if (
    match &&
    validUrl(match[1])
  ) {
    return match[1];
  }

  match =
    block.match(
      /<media:thumbnail[^>]+url=["']([^"']+)["']/i
    );

  if (
    match &&
    validUrl(match[1])
  ) {
    return match[1];
  }

  match =
    block.match(
      /<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i
    );

  if (
    match &&
    validUrl(match[1])
  ) {
    return match[1];
  }

  const description =
    xmlRaw(
      block,
      "description"
    );

  match =
    description.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );

  if (
    match &&
    validUrl(match[1])
  ) {
    return match[1];
  }

  return null;
}


/* =========================================================
   RSS PARSER
   ========================================================= */

function parseRSS(
  xml,
  feed
) {

  const items = [];

  const matches =
    xml.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];

  for (
    const block of matches
  ) {

    const title =
      xmlValue(
        block,
        "title"
      );

    const description =
      xmlValue(
        block,
        "description"
      );

    const link =
      xmlValue(
        block,
        "link"
      );

    const guid =
      xmlValue(
        block,
        "guid"
      );

    const pubDate =
      xmlValue(
        block,
        "pubDate"
      );

    const imageUrl =
      extractImage(block);

    if (!title) {
      continue;
    }

    const item = {

      title,

      description,

      content:
        description,

      url:
        validUrl(link)
          ? link
          : "",

      guid,

      pubDate,

      imageUrl,

      source:
        feed.name,

      credibility:
        feed.credibility
    };

    if (
      !isAllowedNews(item)
    ) {
      continue;
    }

    items.push(item);
  }

  return items;
}


/* =========================================================
   NEWS SCORE
   ========================================================= */

function scoreNews(news) {

  let score =
    Number(news.credibility) || 0;

  const text =
    `${news.title} ${news.description}`
      .toLowerCase();

  const importantWords = [
    "breaking",
    "global",
    "world",
    "election",
    "economy",
    "markets",
    "technology",
    "science",
    "space",
    "climate",
    "war",
    "conflict",
    "energy",
    "business",
    "health",
    "ai",
    "artificial intelligence"
  ];

  for (
    const word of importantWords
  ) {

    if (
      text.includes(word)
    ) {
      score += 2;
    }
  }

  return score;
}


/* =========================================================
   CACHE DUPLICATE
   ========================================================= */

async function isDuplicate(
  news
) {

  const key =
    await sha256(
      `${news.title}|${news.source}`
    );

  const cacheKey =
    new Request(
      `https://global-pulse.local/news/${key}`
    );

  const cached =
    await caches.default.match(
      cacheKey
    );

  return {
    duplicate:
      !!cached,

    key,
    cacheKey
  };
}


async function rememberNews(
  item
) {

  const response =
    new Response(
      "published",
      {
        headers: {
          "cache-control":
            `max-age=${CONFIG.DUPLICATE_TTL}`
        }
      }
    );

  await caches.default.put(
    item.cacheKey,
    response
  );
}


/* =========================================================
   CREATE NEWS POST
   ========================================================= */

function createNewsPost(
  news
) {

  const title =
    escapeHtml(
      cleanText(news.title)
    );

  const description =
    cleanText(
      news.description
    );

  const source =
    escapeHtml(
      news.source
    );

  const credibility =
    Number(
      news.credibility
    ) || 0;

  const url =
    validUrl(news.url)
      ? news.url
      : "";

  const summary =
    truncate(
      description ||
        "A major international development reported by a verified global source.",
      650
    );

  const post = [

    "🌍 <b>GLOBAL PULSE</b>",

    "",

    `📰 <b>${title}</b>`,

    "",

    escapeHtml(summary),

    "",

    "💡 <b>Why it matters</b>",

    "This development may have wider international, economic, political or social implications.",

    "",

    `🔎 <b>Source:</b> ${source}`,

    `🛡️ <b>Source credibility:</b> ${credibility}/100`,

    "",

    url
      ? `🔗 <a href="${escapeHtml(url)}">Read the original source</a>`
      : "",

    "",

    "🌎 #GlobalPulse #WorldNews"

  ].filter(Boolean);

  return post.join("\n");
}


/* =========================================================
   PUBLISH NEWS
   ========================================================= */

async function publishNews(
  env,
  news
) {

  if (
    !isAllowedNews(news)
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "blocked-content"
    };
  }

  const duplicate =
    await isDuplicate(news);

  if (
    duplicate.duplicate
  ) {

    return {
      ok: false,
      skipped: true,
      reason:
        "duplicate"
    };
  }

  const post =
    createNewsPost(news);

  let result;

  /*
   * اگر تصویر معتبر وجود داشته باشد
   */

  if (
    news.imageUrl &&
    validUrl(news.imageUrl)
  ) {

    try {

      result =
        await sendPhoto(
          env,
          news.imageUrl,
          post
        );

    } catch (error) {

      console.log(
        "IMAGE_SEND_FAILED",
        error.message
      );

      result =
        await sendHtml(
          env,
          post
        );
    }

  } else {

    result =
      await sendHtml(
        env,
        post
      );
  }

  await rememberNews(
    duplicate
  );

  return {

    ok: true,

    message_id:
      result.result.message_id,

    source:
      news.source,

    title:
      news.title,

    image:
      !!news.imageUrl
  };
}


/* =========================================================
   COLLECT GLOBAL NEWS
   ========================================================= */

async function collectGlobalNews() {

  const all = [];

  for (
    const feed of
    CONFIG.RSS_FEEDS
  ) {

    try {

      const items =
        await fetchFeed(
          feed
        );

      all.push(
        ...items
      );

    } catch (error) {

      console.error(
        JSON.stringify({
          feed:
            feed.name,

          error:
            error.message
        })
      );
    }
  }

  /*
   * حذف تکراری بین منابع
   */

  const unique =
    new Map();

  for (
    const item of all
  ) {

    const normalized =
      cleanText(
        item.title
      )
      .toLowerCase();

    if (
      !unique.has(
        normalized
      )
    ) {

      unique.set(
        normalized,
        item
      );
    }
  }

  const result =
    [...unique.values()]
      .sort(
        (a, b) =>
          scoreNews(b) -
          scoreNews(a)
      );

  return result;
}


/* =========================================================
   AUTO PUBLISH
   ========================================================= */

async function autoPublish(
  env
) {

  const news =
    await collectGlobalNews();

  const results = [];

  for (
    const item of
    news.slice(
      0,
      CONFIG.MAX_NEWS_PER_RUN
    )
  ) {

    try {

      const result =
        await publishNews(
          env,
          item
        );

      results.push(
        result
      );

    } catch (error) {

      results.push({

        ok: false,

        title:
          item.title,

        source:
          item.source,

        error:
          error.message
      });
    }
  }

  return {

    ok: true,

    collected:
      news.length,

    processed:
      results.length,

    results
  };
}


/* =========================================================
   GLOBAL PRICE
   ========================================================= */

async function publishPrice(
  env,
  body
) {

  const product =
    cleanText(body.product);

  const prices =
    Array.isArray(body.prices)
      ? body.prices
      : [];

  if (
    !product ||
    !prices.length
  ) {

    throw new Error(
      "product and prices are required"
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

  if (
    !valid.length
  ) {

    throw new Error(
      "No valid prices"
    );
  }

  valid.sort(
    (a, b) =>
      Number(a.price) -
      Number(b.price)
  );

  const cheapest =
    valid[0];

  const lines = [

    "💰 <b>GLOBAL PRICE</b>",

    "",

    `🛒 <b>${escapeHtml(product)}</b>`,

    ""

  ];

  for (
    const item of valid
  ) {

    lines.push(
      `${escapeHtml(item.flag || "🌎")} ` +
      `<b>${escapeHtml(item.country)}</b> — ` +
      `$${Number(item.price).toLocaleString()}`
    );
  }

  lines.push(

    "",

    `🏆 <b>CHEAPEST:</b> ${escapeHtml(cheapest.country)}`,

    `💵 <b>Price:</b> $${Number(cheapest.price).toLocaleString()}`,

    "",

    `🔎 <b>Source:</b> ${escapeHtml(body.source || "Verified source")}`,

    "",

    "#GlobalPulse #GlobalPrice"

  );

  const result =
    await sendHtml(
      env,
      lines.join("\n")
    );

  return {

    ok: true,

    message_id:
      result.result.message_id
  };
}


/* =========================================================
   COUNTRY BATTLE
   ========================================================= */

async function publishCountryBattle(
  env,
  body
) {

  if (
    containsBlockedContent(
      JSON.stringify(body)
    )
  ) {

    return {

      ok: false,

      skipped: true,

      reason:
        "blocked-country"
    };
  }

  const items =
    Array.isArray(body.items)
      ? body.items
      : [];

  if (
    !body.title ||
    !items.length
  ) {

    throw new Error(
      "title and items are required"
    );
  }

  const lines = [

    "⚔️ <b>COUNTRY BATTLE</b>",

    "",

    `🌍 <b>${escapeHtml(body.title)}</b>`,

    ""

  ];

  for (
    const item of items
  ) {

    lines.push(
      `${escapeHtml(item.flag || "🌎")} ` +
      `<b>${escapeHtml(item.country)}</b> — ` +
      `${escapeHtml(item.value)}`
    );
  }

  if (
    body.winner
  ) {

    lines.push(
      "",
      `🏆 <b>WINNER:</b> ${escapeHtml(body.winner)}`
    );
  }

  lines.push(

    "",

    `🔎 <b>Source:</b> ${escapeHtml(body.source || "Verified source")}`,

    "",

    "#GlobalPulse #CountryBattle"

  );

  const result =
    await sendHtml(
      env,
      lines.join("\n")
    );

  return {

    ok: true,

    message_id:
      result.result.message_id
  };
}


/* =========================================================
   GLOBAL TREND
   ========================================================= */

async function publishTrend(
  env,
  body
) {

  if (
    containsBlockedContent(
      JSON.stringify(body)
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

    `📈 <b>${escapeHtml(body.title || body.topic || "Global Trend")}</b>`,

    ""

  ];

  if (
    body.countries
  ) {

    lines.push(
      `🌍 <b>Top markets:</b> ${escapeHtml(
        Array.isArray(body.countries)
          ? body.countries.join(" · ")
          : body.countries
      )}`
    );
  }

  if (
    body.growth
  ) {

    lines.push(
      `📊 <b>Growth:</b> ${escapeHtml(body.growth)}`
    );
  }

  lines.push(

    "",

    "💡 <b>Why it matters</b>",

    escapeHtml(
      body.why ||
      "This trend is gaining attention across international markets."
    ),

    "",

    `🔎 <b>Source:</b> ${escapeHtml(body.source || "Verified source")}`,

    "",

    "#GlobalPulse #GlobalTrend"

  );

  const result =
    await sendHtml(
      env,
      lines.join("\n")
    );

  return {

    ok: true,

    message_id:
      result.result.message_id
  };
}


/* =========================================================
   TEST MESSAGE
   ========================================================= */

async function sendTest(
  env
) {

  return sendMessage(
    env,

    [
      "🌍 Global Pulse",

      "",

      "✅ Global publishing system is online.",

      "",

      "📰 Global News",

      "💰 Global Price",

      "⚔️ Country Battle",

      "🔥 Global Trend",

      "🏠 Cost of Living",

      "",

      "🚫 Iran content filter: ACTIVE",

      "♻️ Duplicate protection: ACTIVE",

      "🖼️ Image support: ACTIVE",

      "🤖 Auto publishing: READY"

    ].join("\n")
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
   MAIN FETCH
   ========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(
        request.url
      );

    try {

      /* =========================
         HEALTH
      ========================= */

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

          features: {

            global_news:
              true,

            rss_sources:
              CONFIG.RSS_FEEDS.length,

            iran_filter:
              true,

            duplicate_filter:
              true,

            image_posts:
              true,

            global_price:
              true,

            country_battle:
              true,

            global_trend:
              true,

            auto_publish:
              true

          }

        });
      }


      /* =========================
         DEBUG
      ========================= */

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

          env_keys:
            Object.keys(env)

        });
      }


      /* =========================
         TELEGRAM TEST
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname === "/test-telegram"
      ) {

        const result =
          await telegram(
            env,
            "getMe"
          );

        return json({

          ok: true,

          bot:
            result.result,

          channel_id:
            env.TELEGRAM_CHANNEL_ID ||
            null

        });
      }


      /* =========================
         CHANNEL TEST
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname === "/test-channel"
      ) {

        const result =
          await sendTest(
            env
          );

        return json({

          ok: true,

          message_id:
            result.result.message_id,

          channel_id:
            env.TELEGRAM_CHANNEL_ID

        });
      }


      /* =========================
         MANUAL AUTO NEWS
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname === "/auto-news"
      ) {

        const result =
          await autoPublish(
            env
          );

        return json(
          result
        );
      }


      /* =========================
         MANUAL PUBLISH NEWS
      ========================= */

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


      /* =========================
         GLOBAL PRICE
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-price"
      ) {

        const body =
          await readJson(
            request
          );

        return json(
          await publishPrice(
            env,
            body
          )
        );
      }


      /* =========================
         COUNTRY BATTLE
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-country-battle"
      ) {

        const body =
          await readJson(
            request
          );

        return json(
          await publishCountryBattle(
            env,
            body
          )
        );
      }


      /* =========================
         GLOBAL TREND
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/publish-trend"
      ) {

        const body =
          await readJson(
            request
          );

        return json(
          await publishTrend(
            env,
            body
          )
        );
      }


      /* =========================
         CUSTOM SEND
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/send"
      ) {

        const body =
          await readJson(
            request
          );

        if (
          !body.text &&
          !body.message
        ) {

          return json(
            {
              ok: false,
              error:
                "text or message is required"
            },
            400
          );
        }

        const text =
          body.text ||
          body.message;

        if (
          containsBlockedContent(
            text
          )
        ) {

          return json({

            ok: false,

            skipped: true,

            reason:
              "blocked-content"

          });
        }

        const result =
          await sendMessage(
            env,
            text
          );

        return json({

          ok: true,

          message_id:
            result.result.message_id

        });
      }


      /* =========================
         WEBHOOK
      ========================= */

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


      /* =========================
         404
      ========================= */

      return json(
        {

          ok: false,

          error:
            "Not Found",

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
            String(error)

        },
        500
      );
    }
  },


  /* =======================================================
     CLOUDFLARE CRON
     ======================================================= */

  async scheduled(
    event,
    env,
    ctx
  ) {

    ctx.waitUntil(
      autoPublish(
        env
      )
    );
  }

};
