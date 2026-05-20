import { sendTelegram } from "../lib/telegram"

/**
 * One-shot Telegram wiring test.
 *
 * Local (laptop): pulls TELEGRAM_BOT_TOKEN/CHAT_ID from .env (or
 * .env.local-render if you source it first):
 *   yarn medusa exec ./src/scripts/test-telegram.ts
 *
 * Coolify (prod): exec inside the container so env vars come from Coolify:
 *   docker exec -it <container> sh -c "yarn medusa exec ./src/scripts/test-telegram.ts"
 *
 * Expected:
 *   ✅ on Telegram → wiring works
 *   "skipped" exit → env vars not set in this environment
 *   HTTP 401 → bot token wrong
 *   HTTP 400 with "chat not found" → chat id wrong (or bot not added to chat)
 */
export default async function testTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  console.log("[test-telegram] TELEGRAM_BOT_TOKEN set:", token ? "yes" : "NO")
  console.log("[test-telegram] TELEGRAM_CHAT_ID set:  ", chatId ? "yes" : "NO")

  if (!token || !chatId) {
    console.log(
      "[test-telegram] One or both env vars missing — sendTelegram will return skipped.",
    )
    return
  }

  const stamp = new Date().toISOString()
  const result = await sendTelegram(
    `🧪 <b>Telegram wiring test</b>\n` +
      `<i>Source:</i> dollup-medusa test-telegram.ts\n` +
      `<i>Time:</i> ${stamp}\n` +
      `<i>Token hint:</i> <code>${token.slice(0, 6)}…${token.slice(-4)}</code>`,
  )

  console.log("[test-telegram] result:", JSON.stringify(result))

  if (result.ok) {
    console.log("[test-telegram] ✅ message sent — check Telegram now.")
  } else if ("skipped" in result) {
    console.log("[test-telegram] ⏭️  skipped (env vars missing)")
  } else {
    console.log(
      `[test-telegram] ❌ FAILED status=${result.status} message=${result.message}`,
    )
  }
}
