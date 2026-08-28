const TELEGRAM_API = "https://api.telegram.org";

/* =========================
   JSON RESPONSE
========================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/* =========================
   TELEGRAM API
========================= */

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

/* =========================
   SEND MESSAGE
========================= */

async function sendMessage(env, text) {
  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error("TELEGRAM_CHANNEL_ID is not configured");
  }

  if (!text || !String(text).trim()) {
    throw new Error("Message text is empty");
  }

  return telegram(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHANNEL_ID,
    text: String(text),
    disable_web_page_preview: true
  });
}

/* =========================
   SEND HTML MESSAGE
========================= */

async function sendHtmlMessage(env, html) {
  if (!env.TELEGRAM_CHANNEL_ID) {
    throw new Error("TELEGRAM_CHANNEL_ID is not configured");
  }

  if (!html || !String(html).trim()) {
    throw new Error("HTML message is empty");
  }

  return telegram(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHANNEL_ID,
    text: String(html),
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

/* =========================
   REQUEST BODY
========================= */

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/* =========================
   MAIN WORKER
========================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {

      /* =========================
         HEALTH CHECK
      ========================= */

      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          service: "Global Pulse",
          worker: "telegram-auto-channel",
          status: "online",
          time: new Date().toISOString(),

          telegram: {
            telegram_bot_token: !!env.TELEGRAM_BOT_TOKEN,
            telegram_channel_id: !!env.TELEGRAM_CHANNEL_ID,
            channel_id: env.TELEGRAM_CHANNEL_ID || null
          }
        });
      }

      /* =========================
         DEBUG ENVIRONMENT
         TOKEN NEVER SHOWN
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
            env.TELEGRAM_CHANNEL_ID || null,

          env_keys:
            Object.keys(env)
        });
      }

      /* =========================
         TELEGRAM BOT TEST
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname === "/test-telegram"
      ) {
        const me = await telegram(env, "getMe");

        return json({
          ok: true,
          bot: me.result,
          channel_id:
            env.TELEGRAM_CHANNEL_ID || null
        });
      }

      /* =========================
         CHANNEL TEST
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname === "/test-channel"
      ) {
        const message =
          "🌍 Global Pulse\n\n" +
          "✅ اتصال Worker به کانال برقرار است.\n\n" +
          "🤖 Global Pulse Assistant\n" +
          "⚙️ سیستم انتشار خودکار آماده راه‌اندازی است.";

        const result =
          await sendMessage(env, message);

        return json({
          ok: true,
          message_id:
            result.result.message_id,
          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =========================
         FIND CHANNEL / UPDATES
      ========================= */

      if (
        request.method === "GET" &&
        url.pathname === "/find-channel"
      ) {
        const updates =
          await telegram(env, "getUpdates");

        return json({
          ok: true,
          updates:
            updates.result || []
        });
      }

      /* =========================
         SEND CUSTOM MESSAGE
         POST /send
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/send"
      ) {
        const body =
          await readJson(request);

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
          await sendMessage(env, text);

        return json({
          ok: true,
          message_id:
            result.result.message_id,
          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =========================
         SEND HTML MESSAGE
         POST /send-html
      ========================= */

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
          await sendHtmlMessage(env, html);

        return json({
          ok: true,
          message_id:
            result.result.message_id,
          channel_id:
            env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =========================
         TELEGRAM WEBHOOK
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/telegram-webhook"
      ) {
        const update =
          await request.json();

        console.log(
          JSON.stringify({
            type: "telegram_update",
            update_id:
              update.update_id || null
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
          error: "Not Found"
        },
        404
      );

    } catch (error) {

      console.error(
        JSON.stringify({
          error:
            error.message || String(error),
          path: url.pathname
        })
      );

      return json(
        {
          ok: false,
          error:
            error.message || String(error)
        },
        500
      );
    }
  }
};
