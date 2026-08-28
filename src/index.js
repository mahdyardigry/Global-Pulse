const TELEGRAM_API = "https://api.telegram.org";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
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
    text,
    disable_web_page_preview: true
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {

      /* =========================
         پیدا کردن آیدی کانال
      ========================= */

      if (url.pathname === "/find-channel") {
        const updates = await telegram(env, "getUpdates");

        return json({
          ok: true,
          updates: updates.result || []
        });
      }

      /* =========================
         وضعیت Worker
      ========================= */

      if (url.pathname === "/") {
        return json({
          ok: true,
          service: "Global Pulse",
          worker: "telegram-auto-channel",
          status: "online",
          time: new Date().toISOString()
        });
      }

      /* =========================
         تست ربات
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
         تست ارسال به کانال
      ========================= */

      if (url.pathname === "/test-channel") {
        const message =
          "🌍 Global Pulse\n\n" +
          "✅ اتصال Worker به کانال برقرار است.\n\n" +
          "🤖 Global Pulse Assistant\n" +
          "⚙️ سیستم انتشار خودکار آماده راه‌اندازی است.";

        const result = await sendMessage(env, message);

        return json({
          ok: true,
          message_id: result.result.message_id,
          channel_id: env.TELEGRAM_CHANNEL_ID
        });
      }

      /* =========================
         Telegram Webhook
      ========================= */

      if (
        request.method === "POST" &&
        url.pathname === "/telegram-webhook"
      ) {
        const update = await request.json();

        console.log(
          JSON.stringify({
            type: "telegram_update",
            update_id: update.update_id || null
          })
        );

        return json({
          ok: true
        });
      }

      /* =========================
         Not Found
      ========================= */

      return json(
        {
          ok: false,
          error: "Not Found"
        },
        404
      );

    } catch (error) {
      console.error(error);

      return json(
        {
          ok: false,
          error: error.message || String(error)
        },
        500
      );
    }
  }
};
