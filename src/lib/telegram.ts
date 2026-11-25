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

/** A text message's limit, counted once the HTML is parsed (tags removed, entities as one character). */
export const TELEGRAM_TEXT_MAX = 4096
export const TELEGRAM_ALBUM_MAX = 10

/**
 * Sends JPEG photos, uploaded as multipart/form-data: one with sendPhoto, 2 to
 * 10 as one album with sendMediaGroup. The caption (HTML by default, at most
 * 1024 characters once parsed) goes on the first photo only, which Telegram
 * shows under the album. Dormant like sendTelegram when the env vars are
 * unset, and never throws: a refused or failed send comes back as
 * { ok: false, status, message }.
 */
export async function sendTelegramPhotos(
  photos: Buffer[],
  opts: {
    caption?: string
    /** Override chat id, otherwise reads TELEGRAM_CHAT_ID env. */
    chatId?: string
    /** Default "HTML". Pass null to disable formatting. */
    parseMode?: "HTML" | "Markdown" | null
  } = {},
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = opts.chatId ?? process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return { ok: false, skipped: true }
  if (photos.length < 1 || photos.length > TELEGRAM_ALBUM_MAX) {
    return {
      ok: false,
      status: 0,
      message: `Telegram takes 1 to ${TELEGRAM_ALBUM_MAX} photos, got ${photos.length}`,
    }
  }

  const caption: Record<string, string> = {}
  if (opts.caption) {
    caption.caption = opts.caption
    if (opts.parseMode !== null) caption.parse_mode = opts.parseMode ?? "HTML"
  }

  const form = new FormData()
  form.append("chat_id", chatId)
  // Copied into a plain Uint8Array: Buffer's type allows shared memory, which Blob doesn't accept.
  const attach = (name: string, photo: Buffer) =>
    form.append(name, new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), `${name}.jpg`)
  let method: "sendPhoto" | "sendMediaGroup"
  if (photos.length === 1) {
    method = "sendPhoto"
    attach("photo", photos[0])
    for (const [key, value] of Object.entries(caption)) form.append(key, value)
  } else {
    method = "sendMediaGroup"
    // Each photo is uploaded under its own field and named in `media` as attach://<field>.
    const media = photos.map((_, i) => ({
      type: "photo",
      media: `attach://photo${i}`,
      ...(i === 0 ? caption : {}),
    }))
    form.append("media", JSON.stringify(media))
    photos.forEach((photo, i) => attach(`photo${i}`, photo))
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    })
    if (!res.ok) {
      const message = await res.text().catch(() => "")
      return { ok: false, status: res.status, message }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, status: 0, message: (err as Error).message }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Send a message with a single row of inline buttons.
 *
 * Buttons rather than free text so the answer needs one tap on a phone, carries
 * no parsing risk, and cannot produce a value the rest of the system rejects.
 * Returns the sent message id so the caller can edit it afterwards.
 */
export async function sendTelegramButtons(
  text: string,
  buttons: Array<{ text: string; callback_data: string }>,
  opts: { chatId?: string } = {},
): Promise<{ ok: true; messageId: number } | { ok: false; skipped?: true; message?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = opts.chatId ?? process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return { ok: false, skipped: true }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [buttons] },
      }),
      signal: controller.signal,
    })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { message_id?: number } }
      | null
    if (!res.ok || !body?.ok || typeof body.result?.message_id !== "number") {
      return { ok: false, message: `sendMessage failed (${res.status})` }
    }
    return { ok: true, messageId: body.result.message_id }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Acknowledge a button tap. Telegram spins the button until this is called, so
 * it runs on every callback — including ones we reject.
 */
export async function answerTelegramCallback(
  callbackQueryId: string,
  text: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
      signal: controller.signal,
    })
  } catch {
    // Best effort — the setting is already saved by this point.
  } finally {
    clearTimeout(timeout)
  }
}

/** Replace a message's text and drop its buttons, so the day has one record. */
export async function editTelegramMessage(
  messageId: number,
  text: string,
  opts: { chatId?: string } = {},
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = opts.chatId ?? process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      }),
      signal: controller.signal,
    })
  } catch {
    // Best effort — cosmetic only.
  } finally {
    clearTimeout(timeout)
  }
}
