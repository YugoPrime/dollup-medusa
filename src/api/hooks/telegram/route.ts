/**
 * Telegram webhook. Receives the button taps from the daily delivery-cutoff
 * prompt and writes the chosen hour to store config.
 *
 * Auth is Telegram's secret-token header, not an HMAC over the body — Telegram
 * echoes back the `secret_token` given to setWebhook on every delivery, so
 * unlike the Meta and Rapido hooks this route needs no raw-body handling.
 *
 * Two independent checks guard the write, because this endpoint changes what
 * customers are promised: the secret must match, and the tap must come from the
 * configured chat. A leaked URL alone is not enough.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { STORE_CONFIG_MODULE } from "../../../modules/store-config"
import type StoreConfigModuleService from "../../../modules/store-config/service"
import {
  buildCutoffConfirmation,
  buildEtaCopy,
  parseCallbackData,
} from "../../../lib/delivery-cutoff"
import {
  answerTelegramCallback,
  editTelegramMessage,
} from "../../../lib/telegram"

type CallbackQuery = {
  id?: unknown
  data?: unknown
  message?: { message_id?: unknown; chat?: { id?: unknown } }
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) {
    logger.error("[telegram-hook] TELEGRAM_WEBHOOK_SECRET is not set — refusing")
    // 200 so Telegram stops retrying a request that can never succeed.
    res.status(200).json({ ok: true })
    return
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    logger.warn("[telegram-hook] rejected an update with a bad secret token")
    res.status(401).json({ ok: false })
    return
  }

  const body = (req.body ?? {}) as { callback_query?: CallbackQuery }
  const cb = body.callback_query
  // Any other update type (a plain message, a channel post) is acknowledged and
  // ignored — only button taps mean anything here.
  if (!cb || typeof cb.id !== "string") {
    res.status(200).json({ ok: true })
    return
  }

  const expectedChat = process.env.TELEGRAM_CHAT_ID
  const fromChat = cb.message?.chat?.id
  if (expectedChat && String(fromChat ?? "") !== String(expectedChat)) {
    logger.warn(`[telegram-hook] tap from unexpected chat ${String(fromChat)}`)
    await answerTelegramCallback(cb.id, "Not allowed.")
    res.status(200).json({ ok: true })
    return
  }

  const hour = parseCallbackData(cb.data)
  if (hour === null) {
    // A stale keyboard from an old day, or a button that isn't ours.
    await answerTelegramCallback(cb.id, "That button has expired.")
    res.status(200).json({ ok: true })
    return
  }

  try {
    const storeConfig =
      req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)
    await storeConfig.updateShippingSettingsConfig({
      next_day_cutoff_hour: hour,
      preorder_eta_copy: buildEtaCopy(hour),
    })

    const confirmation = buildCutoffConfirmation(hour, new Date())
    await answerTelegramCallback(cb.id, confirmation)

    const messageId = cb.message?.message_id
    if (typeof messageId === "number") {
      await editTelegramMessage(messageId, `🚚 <b>${confirmation}</b>`)
    }

    logger.info(`[telegram-hook] cutoff set to ${hour}:00`)
  } catch (err) {
    logger.error(`[telegram-hook] failed to set cutoff: ${(err as Error).message}`)
    await answerTelegramCallback(cb.id, "Could not save — try again.")
  }

  res.status(200).json({ ok: true })
}
