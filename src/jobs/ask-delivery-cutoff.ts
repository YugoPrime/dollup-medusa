/**
 * Asks whether today's delivery cutoff closes at noon or gets pushed later.
 * Runs 12:00 Mauritius (UTC+4) = 08:00 UTC, every day.
 *
 * Noon is the right moment because that is when the default cutoff falls. Every
 * offerable hour is noon or later, so during the morning a value left over from
 * yesterday cannot change any answer — an order before noon qualifies under all
 * of them. The value only starts to matter at 12:00, which is when this job
 * resets it and asks.
 *
 * Resetting before sending is the load-bearing half: ignoring the message means
 * noon, rather than yesterday's 3pm silently carrying into a day the courier
 * comes at midday. A tap extends the day; silence cannot.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { STORE_CONFIG_MODULE } from "../modules/store-config"
import type StoreConfigModuleService from "../modules/store-config/service"
import {
  DEFAULT_CUTOFF_HOUR,
  buildCutoffPrompt,
  buildEtaCopy,
} from "../lib/delivery-cutoff"
import { sendTelegramButtons } from "../lib/telegram"

export default async function askDeliveryCutoff(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const storeConfig =
    container.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)

  try {
    await storeConfig.updateShippingSettingsConfig({
      next_day_cutoff_hour: DEFAULT_CUTOFF_HOUR,
      preorder_eta_copy: buildEtaCopy(DEFAULT_CUTOFF_HOUR),
    })
    logger.info(`[cutoff] reset to ${DEFAULT_CUTOFF_HOUR}:00 for the day`)
  } catch (err) {
    // If the reset fails, yesterday's value is still in force — say so rather
    // than sending a prompt that implies today starts from the default.
    logger.error(`[cutoff] daily reset FAILED: ${(err as Error).message}`)
    return
  }

  const prompt = buildCutoffPrompt(new Date())
  const sent = await sendTelegramButtons(prompt.text, prompt.buttons)

  if (!sent.ok && !("skipped" in sent && sent.skipped)) {
    logger.error(`[cutoff] could not send the prompt: ${sent.message}`)
  }
}

export const config = {
  name: "ask-delivery-cutoff",
  // 12:00 Mauritius (UTC+4) = 08:00 UTC — the moment the default cutoff falls.
  schedule: "0 8 * * *",
}
