/**
 * Thin wrapper around Telegram's sendMessage. Dormant when
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env vars are unset — returns
 * { ok: false, skipped: true } so callers don't fail when running
 * locally or before secrets are wired.
 */
export type TelegramSendResult =
  | { ok: true }
  | { ok: false; skipped: true }
  | { ok: false; status: number; message: string }

export async function sendTelegram(
  text: string,
  opts: {
    /** Override chat id, otherwise reads TELEGRAM_CHAT_ID env. */
    chatId?: string
    /** Default "HTML". Pass null to disable formatting. */
    parseMode?: "HTML" | "Markdown" | null
    disableWebPagePreview?: boolean
  } = {},
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = opts.chatId ?? process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return { ok: false, skipped: true }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: opts.disableWebPagePreview ?? true,
  }
  if (opts.parseMode !== null) {
    body.parse_mode = opts.parseMode ?? "HTML"
  }

  // Bounded so a hung request can never hold a caller hostage — e.g. the AI
  // concierge subscriber fires this from inside a per-thread lock, and an
  // unbounded fetch here would delay that thread's next message for as long
  // as Telegram's servers took to answer (or never answer).
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )
    if (!res.ok) {
      const message = await res.text().catch(() => "")
      return { ok: false, status: res.status, message }
    }
    return { ok: true }
  } catch (err) {
    // Covers both a network error and an abort-on-timeout — either way this
    // never throws, matching every other failure mode this function already
    // handles.
    return { ok: false, status: 0, message: (err as Error).message }
  } finally {
    clearTimeout(timeout)
  }
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
