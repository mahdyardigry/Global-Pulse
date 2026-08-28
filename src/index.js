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
"${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}",
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
"Telegram API error: ${data.description || "Unknown error"}"
);
}

return data;
}

async function sendMessage(env, text) {
const channelId = env.TELEGRAM_CHANNEL_ID;

if (!channelId) {
throw new Error("TELEGRAM_CHANNEL_ID is not configured");
}

return telegram(env, "sendMessage", {
chat_id: channelId,
text,
disable_web_page_preview: true
});
}

export default {
async fetch(request, env) {
const url = new URL(request.url);

try {

  /* =========================
     Health Check
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
     Debug Environment
  ========================= */

  if (url.pathname === "/debug-env") {
    return json({
      ok: true,
      telegram_bot_token: !!env.TELEGRAM_BOT_TOKEN,
      telegram_channel_id: !!env.TELEGRAM_CHANNEL_ID,
      channel_id: env.TELEGRAM_CHANNEL_ID || null,
      env_keys: Object.keys(env)
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
     تست ارسال پیام
  ========================= */

  if (url.pathname === "/test-channel") {
    const result = await sendMessage(
      env,
      "🌍 Global Pulse\n\n" +
      "✅ اتصال Worker به کانال برقرار است.\n\n" +
      "🤖 Global Pulse Assistant\n" +
      "⚙️ سیستم انتشار خودکار آماده است."
    );

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
