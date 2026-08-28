const TELEGRAM_API = "https://api.telegram.org";

/* =========================================================
   CONFIG
========================================================= */

const MAX_ITEMS_PER_SOURCE = 10;
const MAX_POSTS_PER_RUN = 3;
const DEDUPE_HOURS = 48;

const DEFAULT_SOURCES = [
  {
    name: "BBC",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
    trust: 90
  },
  {
    name: "Reuters",
    url: "https://feeds.reuters.com/reuters/topNews",
    trust: 95
  },
  {
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    trust: 85
  }
];

/* =========================================================
   JSON
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/* =========================================================
   TELEGRAM
========================================================= */

async function telegram(env, method, body = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
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
      `Telegram API error: ${data.description || "Unknown error"}`
    );
  }

  return data;
}

async function sendMessage(env, text) {
  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error("TELEGRAM_CHANNEL_ID is not configured");
  }

  return telegram(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHANNEL_ID,
    text,
    disable_web_page_preview: true
  });
}

async function sendHtmlMessage(env, html) {
  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error("TELEGRAM_CHANNEL_ID is not configured");
  }

  return telegram(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHANNEL_ID,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
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
   TEXT HELPERS
========================================================= */

function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title = "") {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max = 1200) {
  const value = cleanText(text);

  if (value.length <= max) {
    return value;
  }

  return value.slice(0, max - 1) + "…";
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================
   RSS PARSER
========================================================= */

function getTag(block, tag) {
  const regex = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    "i"
  );

  const match = block.match(regex);

  return match ? cleanText(match[1]) : "";
}

function getAtomLink(block) {
  const match = block.match(
    /<link[^>]+href=["']([^"']+)["'][^>]*>/i
  );

  return match ? match[1] : "";
}

function parseRSS(xml, source) {
  const items = [];

  const rssMatches =
    xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const block of rssMatches.slice(0, MAX_ITEMS_PER_SOURCE)) {
    const title = getTag(block, "title");
    const description =
      getTag(block, "description") ||
      getTag(block, "summary");

    const link =
      getTag(block, "link") ||
      getAtomLink(block);

    const pubDate =
      getTag(block, "pubDate") ||
      getTag(block, "published") ||
      getTag(block, "updated");

    if (!title || !link) {
      continue;
    }

    items.push({
      id: normalizeTitle(title) + "|" + link,
      source: source.name,
      trust: source.trust,
      title,
      description,
      link,
      publishedAt: pubDate || new Date().toISOString()
    });
  }

  return items;
}

/* =========================================================
   FETCH NEWS
========================================================= */

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: {
      "user-agent": "GlobalPulse/1.0 NewsAggregator"
    }
  });

  if (!response.ok) {
    throw new Error(
      `${source.name}: HTTP ${response.status}`
    );
  }

  const xml = await response.text();

  return parseRSS(xml, source);
}

async function collectNews() {
  const results = [];

  for (const source of DEFAULT_SOURCES) {
    try {
      const items = await fetchSource(source);

      results.push(...items);
    } catch (error) {
      console.error(
        JSON.stringify({
          type: "source_error",
          source: source.name,
          error: error.message
        })
      );
    }
  }

  return results;
}

/* =========================================================
   QUALITY FILTER
========================================================= */

function isUsefulNews(item) {
  const title = normalizeTitle(item.title);

  if (!title) {
    return false;
  }

  if (title.length < 12) {
    return false;
  }

  if (!item.link) {
    return false;
  }

  const badWords = [
    "advertisement",
    "sponsored",
    "casino",
    "betting",
    "lottery"
  ];

  for (const word of badWords) {
    if (title.includes(word)) {
      return false;
    }
  }

  return true;
}

/* =========================================================
   DUPLICATE FILTER
========================================================= */

async function wasPublished(env, item) {
  if (!env.NEWS_CACHE) {
    return false;
  }

  const key =
    "news:" +
    normalizeTitle(item.title);

  const value =
    await env.NEWS_CACHE.get(key);

  return !!value;
}

async function markPublished(env, item) {
  if (!env.NEWS_CACHE) {
    return;
  }

  const key =
    "news:" +
    normalizeTitle(item.title);

  await env.NEWS_CACHE.put(
    key,
    JSON.stringify({
      title: item.title,
      link: item.link,
      source: item.source,
      publishedAt: new Date().toISOString()
    }),
    {
      expirationTtl:
        DEDUPE_HOURS * 60 * 60
    }
  );
}

/* =========================================================
   SIMPLE NEWS SCORE
========================================================= */

function scoreNews(item) {
  let score = 0;

  score += item.trust || 0;

  if (item.description) {
    score += 5;
  }

  if (item.title.length > 25) {
    score += 5;
  }

  const importantWords = [
    "breaking",
    "war",
    "iran",
    "israel",
    "usa",
    "china",
    "russia",
    "ukraine",
    "economy",
    "market",
    "bitcoin",
    "crypto",
    "oil",
    "election",
    "president"
  ];

  const text =
    normalizeTitle(
      item.title + " " + item.description
    );

  for (const word of importantWords) {
    if (text.includes(word)) {
      score += 3;
    }
  }

  return score;
}

/* =========================================================
   AI
========================================================= */

async function aiProcess(env, item) {
  if (!env.AI_API_URL || !env.AI_API_KEY) {
    return {
      title: item.title,
      summary: truncate(
        item.description || item.title,
        700
      ),
      language: "original",
      ai: false
    };
  }

  const prompt = `
You are the editorial AI for Global Pulse.

Process this news item.

Requirements:
1. Translate to Persian.
2. Create a clear attractive Persian headline.
3. Write a concise factual summary.
4. Do not invent facts.
5. Keep names, numbers and dates accurate.
6. Mention uncertainty when appropriate.
7. Return valid JSON only.

Source:
${item.source}

Title:
${item.title}

Description:
${item.description}

URL:
${item.link}

JSON format:
{
  "title": "...",
  "summary": "...",
  "confidence": 0-100
}
`;

  const response = await fetch(
    env.AI_API_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization":
          `Bearer ${env.AI_API_KEY}`
      },
      body: JSON.stringify({
        prompt
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `AI HTTP ${response.status}`
    );
  }

  const data = await response.json();

  let result = data;

  if (data.output) {
    result = data.output;
  }

  if (typeof result === "string") {
    result = JSON.parse(result);
  }

  return {
    title:
      result.title ||
      item.title,

    summary:
      result.summary ||
      truncate(
        item.description || item.title,
        700
      ),

    confidence:
      Number(result.confidence || 0),

    ai: true
  };
}

/* =========================================================
   BUILD TELEGRAM POST
========================================================= */

function buildPost(item, ai) {
  const title =
    escapeHtml(
      ai.title || item.title
    );

  const summary =
    escapeHtml(
      truncate(
        ai.summary ||
        item.description ||
        item.title,
        900
      )
    );

  const source =
    escapeHtml(item.source);

  return (
    `🌍 <b>GLOBAL PULSE</b>\n\n` +

    `📰 <b>${title}</b>\n\n` +

    `${summary}\n\n` +

    `🔎 <b>منبع:</b> ${source}\n` +

    `🛡️ <b>اعتبار منبع:</b> ${item.trust}/100\n` +

    `\n🔗 <a href="${item.link}">مشاهده منبع اصلی</a>\n\n` +

    `#GlobalPulse`
  );
}

/* =========================================================
   AUTO PUBLISH
========================================================= */

async function publishNews(env) {
  const collected =
    await collectNews();

  const useful =
    collected.filter(isUsefulNews);

  useful.sort(
    (a, b) =>
      scoreNews(b) -
      scoreNews(a)
  );

  const published = [];

  for (
    const item of useful
  ) {
    if (
      published.length >=
      MAX_POSTS_PER_RUN
    ) {
      break;
    }

    if (
      await wasPublished(
        env,
        item
      )
    ) {
      continue;
    }

    try {
      const ai =
        await aiProcess(
          env,
          item
        );

      const post =
        buildPost(
          item,
          ai
        );

      const result =
        await sendHtmlMessage(
          env,
          post
        );

      await markPublished(
        env,
        item
      );

      published.push({
        source: item.source,
        title: ai.title,
        message_id:
          result.result.message_id,
        score:
          scoreNews(item),
        ai:
          ai.ai
      });

    } catch (error) {
      console.error(
        JSON.stringify({
          type:
            "publish_error",
          title:
            item.title,
          error:
            error.message
        })
      );
    }
  }

  return {
    collected:
      collected.length,

    useful:
      useful.length,

    published
  };
}

/* =========================================================
   MAIN WORKER
========================================================= */

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

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
            "Global Pulse",
          worker:
            "telegram-auto-channel",
          status:
            "online",

          telegram: {
            bot:
              !!env.TELEGRAM_BOT_TOKEN,

            channel:
              !!env.TELEGRAM_CHANNEL_ID,

            channel_id:
              env.TELEGRAM_CHANNEL_ID ||
              null
          },

          ai: {
            configured:
              !!(
                env.AI_API_URL &&
                env.AI_API_KEY
              )
          },

          news_cache:
            !!env.NEWS_CACHE,

          time:
            new Date().toISOString()
        });
      }

      /* =========================
         DEBUG ENV
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

          ai_api:
            !!env.AI_API_URL,

          ai_key:
            !!env.AI_API_KEY,

          news_cache:
            !!env.NEWS_CACHE,

          env_keys:
            Object.keys(env)
        });
      }

      /* =========================
         BOT TEST
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname ===
          "/test-telegram"
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

      /* =========================
         CHANNEL TEST
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname ===
          "/test-channel"
      ) {
        const message =
          "🌍 Global Pulse\n\n" +
          "✅ اتصال Worker به کانال برقرار است.\n\n" +
          "🤖 Global Pulse Assistant\n" +
          "⚙️ سیستم انتشار خودکار آماده راه‌اندازی است.";

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

      /* =========================
         MANUAL NEWS SCAN
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname ===
          "/scan"
      ) {
        const news =
          await collectNews();

        return json({
          ok: true,
          count:
            news.length,
          news:
            news.map(item => ({
              source:
                item.source,
              title:
                item.title,
              link:
                item.link,
              score:
                scoreNews(item)
            }))
        });
      }

      /* =========================
         MANUAL PUBLISH
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname ===
          "/publish"
      ) {
        const result =
          await publishNews(
            env
          );

        return json({
          ok: true,
          ...result
        });
      }

      /* =========================
         SEND CUSTOM MESSAGE
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname ===
          "/send"
      ) {
        const body =
          await readJson(
            request
          );

        const text =
          body.text ||
          body.message ||
          "";

        if (!text) {
          return json(
            {
              ok: false,
              error:
                "text or message is required"
            },
            400
          );
        }

        const result =
          await sendMessage(
            env,
            text
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
         WEBHOOK
      ========================= */

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

      return json(
        {
          ok: false,
          error:
            "Not Found"
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
     CRON
  ======================================================= */

  async scheduled(
    event,
    env,
    ctx
  ) {

    ctx.waitUntil(
      (async () => {

        try {

          const result =
            await publishNews(
              env
            );

          console.log(
            JSON.stringify({
              type:
                "scheduled_publish",

              result
            })
          );

        } catch (error) {

          console.error(
            JSON.stringify({
              type:
                "scheduled_error",

              error:
                error.message ||
                String(error)
            })
          );

        }

      })()
    );
  }
};
