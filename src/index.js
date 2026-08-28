const TELEGRAM_API = "https://api.telegram.org";

const SERVICE_NAME = "Global Pulse";
const WORKER_NAME = "telegram-auto-channel";

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
   SAFE ENV STATUS
========================= */

function envStatus(env) {
  return {
    telegram_bot_token: !!env.TELEGRAM_BOT_TOKEN,
    telegram_channel_id: !!env.TELEGRAM_CHANNEL_ID,
    channel_id: env.TELEGRAM_CHANNEL_ID || null
  };
}

/* =========================
   DEFAULT GLOBAL PULSE MESSAGE
========================= */

function buildStartupMessage() {
  return [
    "🌍 Global Pulse",
    "",
    "🤖 Global Pulse Assistant",
    "",
    "✅ سیستم انتشار خودکار فعال است.",
    "📡 اتصال Worker به Telegram برقرار است.",
    "",
    "⚙️ آماده دریافت و انتشار محتوای Global Pulse."
  ].join("\n");
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
   WORKER
========================= */

export default {

  /* =========================
     HTTP
  ========================= */

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {

      /* =========================
         HEALTH CHECK
      ========================= */

      if (url.pathname === "/") {
        return json({
          ok: true,
          service: SERVICE_NAME,
          worker: WORKER_NAME,
          status: "online",
          time: new Date().toISOString(),
          telegram: envStatus(env)
        });
      }

      /* =========================
         DEBUG ENV
         توکن هرگز نمایش داده نمی‌شود
      ========================= */

      if (url.pathname === "/debug-env") {
        return json({
          ok: true,
          ...envStatus(env),
          env_keys: Object.keys(env)
        });
      }

      /* =========================
         TELEGRAM BOT INFO
      ========================= */

      if (url.pathname === "/test-telegram") {

        const me = await telegram(env, "getMe");

        return json({
          ok: true,
          bot: me.result,
          channel_id: env.TELEGRAM_CHANNEL_ID || null
        });
      }

      /* =========================
         TELEGRAM CHANNEL TEST
      ========================= */

      if (url.pathname === "/test-channel") {

        const message = [
          "🌍 Global Pulse",
          "",
          "✅ اتصال Worker به کانال برقرار است.",
          "",
          "🤖 Global Pulse Assistant",
          "⚙️ سیستم انتشار خودکار آماده است.",
          "",
          `🕒 ${new Date().toISOString()}`
        ].join("\n");

        const result = await sendMessage(env, message);

        return json({
          ok: true,
          sent: true,
          message_id: result.result?.message_id || null,
          channel_id: env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =========================
         MANUAL SEND
         
         POST /send
         {
           "text": "پیام شما"
         }
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/send"
      ) {

        const body = await readJson(request);

        const text =
          typeof body.text === "string"
            ? body.text.trim()
            : "";

        if (!text) {
          return json(
            {
              ok: false,
              error: "text is required"
            },
            400
          );
        }

        const result = await sendMessage(env, text);

        return json({
          ok: true,
          sent: true,
          message_id: result.result?.message_id || null,
          channel_id: env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =========================
         GLOBAL PULSE STARTUP
      ========================= */

      if (url.pathname === "/publish-startup") {

        const message = buildStartupMessage();

        const result = await sendMessage(env, message);

        return json({
          ok: true,
          sent: true,
          type: "startup",
          message_id: result.result?.message_id || null,
          channel_id: env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =========================
         FIND TELEGRAM UPDATES
      ========================= */

      if (url.pathname === "/find-channel") {

        const updates = await telegram(env, "getUpdates");

        return json({
          ok: true,
          count: Array.isArray(updates.result)
            ? updates.result.length
            : 0,
          updates: updates.result || []
        });
      }

      /* =========================
         TELEGRAM WEBHOOK
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/telegram-webhook"
      ) {

        const update = await request.json();

        console.log(
          JSON.stringify({
            type: "telegram_update",
            update_id: update?.update_id || null,
            received_at: new Date().toISOString()
          })
        );

        return json({
          ok: true,
          received: true
        });
      }

      /* =========================
         CRON TEST ENDPOINT
      ========================= */

      if (url.pathname === "/cron-test") {

        const message = [
          "🌍 Global Pulse",
          "",
          "⏰ Cron Worker فعال است.",
          "",
          "✅ سیستم زمان‌بندی با موفقیت اجرا شد.",
          `🕒 ${new Date().toISOString()}`
        ].join("\n");

        const result = await sendMessage(env, message);

        return json({
          ok: true,
          cron: true,
          sent: true,
          message_id: result.result?.message_id || null
        });
      }

      /* =========================
         404
      ========================= */

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
          error: error?.message || String(error),
          path: url.pathname,
          time: new Date().toISOString()
        })
      );

      return json(
        {
          ok: false,
          error: error?.message || String(error)
        },
        500
      );
    }
  },

  /* =========================
     CRON
  ========================= */

  async scheduled(event, env, ctx) {

    try {

      const message = [
        "🌍 Global Pulse",
        "",
        "⏰ اجرای خودکار Worker",
        "",
        "✅ سیستم فعال است.",
        "📡 اتصال Telegram برقرار است.",
        "",
        `🕒 ${new Date().toISOString()}`
      ].join("\n");

      ctx.waitUntil(
        sendMessage(env, message)
      );

      console.log(
        JSON.stringify({
          type: "cron_execution",
          time: new Date().toISOString()
        })
      );

    } catch (error) {

      console.error(
        JSON.stringify({
          type: "cron_error",
          error: error?.message || String(error),
          time: new Date().toISOString()
        })
      );
    }
  }
};
