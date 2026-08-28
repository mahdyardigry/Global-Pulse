const TELEGRAM_API = "https://api.telegram.org";

const MAX_ITEMS_PER_SOURCE = 10;
const MAX_POSTS_PER_RUN = 3;
const DEDUPE_HOURS = 48;

const SOURCES = [
  {
    name: "BBC",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
    trust: 90
  },
  {
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    trust: 85
  }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

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
    text: String(text),
    disable_web_page_preview: true
  });
}

async function sendHtmlMessage(env, html) {
  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error("TELEGRAM_CHANNEL_ID is not configured");
  }

  return telegram(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHANNEL_ID,
    text: String(html),
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(text = "") {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text, max = 900) {
  const value = cleanText(text);

  if (value.length <= max) {
    return value;
  }

  return value.slice(0, max - 1) + "…";
}

function getTag(block, tag) {
  const regex = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    "i"
  );

  const match = block.match(regex);

  return match ? cleanText(match[1]) : "";
}

function getLink(block) {
  const normal = getTag(block, "link");

  if (normal) {
    return normal;
  }

  const href = block.match(
    /<link[^>]+href=["']([^"']+)["']/i
  );

  return href ? href[1] : "";
}

function parseRSS(xml, source) {
  const items = [];

  const blocks =
    xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (
    const block of blocks.slice(
      0,
      MAX_ITEMS_PER_SOURCE
    )
  ) {
    const title =
      getTag(block, "title");

    const description =
      getTag(block, "description") ||
      getTag(block, "summary") ||
      getTag(block, "content:encoded");

    const link =
      getLink(block);

    const pubDate =
      getTag(block, "pubDate") ||
      getTag(block, "published") ||
      getTag(block, "updated");

    if (!title || !link) {
      continue;
    }

    items.push({
      title,
      description,
      link,
      source: source.name,
      trust: source.trust,
      publishedAt:
        pubDate ||
        new Date().toISOString(),

      key:
        normalize(title) +
        "|" +
        link
    });
  }

  return items;
}

async function fetchSource(source) {
  const response =
    await fetch(source.url, {
      headers: {
        "user-agent":
          "GlobalPulse/1.0"
      }
    });

  if (!response.ok) {
    throw new Error(
      `${source.name}: HTTP ${response.status}`
    );
  }

  const xml =
    await response.text();

  return parseRSS(
    xml,
    source
  );
}

async function collectNews() {
  const all = [];

  for (
    const source of SOURCES
  ) {
    try {
      const items =
        await fetchSource(
          source
        );

      all.push(...items);

    } catch (error) {

      console.error(
        JSON.stringify({
          type:
            "source_error",
          source:
            source.name,
          error:
            error.message
        })
      );
    }
  }

  return all;
}

function isUsefulNews(item) {
  if (!item.title) {
    return false;
  }

  if (
    normalize(item.title)
      .length < 15
  ) {
    return false;
  }

  if (!item.link) {
    return false;
  }

  const blocked = [
    "advertisement",
    "sponsored",
    "casino",
    "betting",
    "lottery"
  ];

  const title =
    normalize(item.title);

  return !blocked.some(
    word =>
      title.includes(word)
  );
}

function newsScore(item) {
  let score =
    Number(item.trust || 0);

  if (item.description) {
    score += 5;
  }

  if (
    item.title.length > 30
  ) {
    score += 5;
  }

  return score;
}

async function isDuplicate(
  env,
  item
) {
  if (!env.NEWS_CACHE) {
    return false;
  }

  const key =
    "news:" +
    normalize(item.title);

  return !!(
    await env.NEWS_CACHE.get(
      key
    )
  );
}

async function markPublished(
  env,
  item
) {
  if (!env.NEWS_CACHE) {
    return;
  }

  const key =
    "news:" +
    normalize(item.title);

  await env.NEWS_CACHE.put(
    key,
    JSON.stringify({
      title:
        item.title,
      link:
        item.link,
      source:
        item.source,
      time:
        new Date().toISOString()
    }),
    {
      expirationTtl:
        DEDUPE_HOURS *
        60 *
        60
    }
  );
}

async function processWithAI(
  env,
  item
) {
  /*
   * اگر AI تنظیم نشده باشد،
   * Worker از عنوان و توضیح اصلی
   * استفاده می‌کند.
   */

  if (
    !env.AI_API_URL ||
    !env.AI_API_KEY
  ) {
    return {
      title:
        item.title,

      summary:
        truncate(
          item.description ||
          item.title
        ),

      confidence: 0,

      ai: false
    };
  }

  const prompt = `
You are the editorial AI for Global Pulse.

Translate the following news into Persian.

Create:
1. A strong but factual Persian headline.
2. A concise Persian summary.
3. Never invent facts.
4. Keep names, numbers and dates accurate.
5. Do not exaggerate.
6. Return JSON only.

Source:
${item.source}

Title:
${item.title}

Description:
${item.description}

Return:
{
  "title": "...",
  "summary": "...",
  "confidence": 0
}
`;

  const response =
    await fetch(
      env.AI_API_URL,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json",

          "authorization":
            `Bearer ${env.AI_API_KEY}`
        },

        body:
          JSON.stringify({
            prompt
          })
      }
    );

  if (!response.ok) {
    throw new Error(
      `AI HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  let result =
    data.output ||
    data;

  if (
    typeof result ===
    "string"
  ) {
    result =
      JSON.parse(result);
  }

  return {
    title:
      result.title ||
      item.title,

    summary:
      result.summary ||
      truncate(
        item.description ||
        item.title
      ),

    confidence:
      Number(
        result.confidence ||
        0
      ),

    ai: true
  };
}

function buildPost(
  item,
  processed
) {
  return (
    `🌍 <b>GLOBAL PULSE</b>\n\n` +

    `📰 <b>${escapeHtml(
      processed.title
    )}</b>\n\n` +

    `${escapeHtml(
      truncate(
        processed.summary,
        900
      )
    )}\n\n` +

    `🔎 <b>منبع:</b> ${escapeHtml(
      item.source
    )}\n` +

    `🛡️ <b>اعتبار منبع:</b> ${
      item.trust
    }/100\n\n` +

    `🔗 <a href="${item.link}">منبع اصلی خبر</a>\n\n` +

    `#GlobalPulse`
  );
}

async function publishNews(env) {
  const collected =
    await collectNews();

  const useful =
    collected
      .filter(isUsefulNews)
      .sort(
        (a, b) =>
          newsScore(b) -
          newsScore(a)
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
      await isDuplicate(
        env,
        item
      )
    ) {
      continue;
    }

    try {

      const processed =
        await processWithAI(
          env,
          item
        );

      const post =
        buildPost(
          item,
          processed
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
        source:
          item.source,

        title:
          processed.title,

        message_id:
          result.result.message_id,

        score:
          newsScore(item),

        ai:
          processed.ai
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

export default {

  async fetch(
    request,
    env
  ) {
    const url =
      new URL(request.url);

    try {

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
            telegram_bot_token:
              !!env.TELEGRAM_BOT_TOKEN,

            telegram_channel_id:
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

      if (
        request.method === "GET" &&
        url.pathname ===
          "/debug-env"
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

      if (
        request.method === "GET" &&
        url.pathname ===
          "/test-channel"
      ) {
        const result =
          await sendMessage(
            env,

            "🌍 Global Pulse\n\n" +
            "✅ اتصال Worker به کانال برقرار است.\n\n" +
            "🤖 Global Pulse Assistant\n" +
            "⚙️ سیستم انتشار خودکار آماده است."
          );

        return json({
          ok: true,

          message_id:
            result.result.message_id,

          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }

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

              trust:
                item.trust,

              score:
                newsScore(item)
            }))
        });
      }

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

      if (
        request.method === "POST" &&
        url.pathname === "/send"
      ) {
        let body = {};

        try {
          body =
            await request.json();
        } catch {}

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
