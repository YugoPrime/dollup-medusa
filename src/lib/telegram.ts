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

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) {
      const message = await res.text().catch(() => "")
      return { ok: false, status: res.status, message }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, status: 0, message: (err as Error).message }
  }
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
