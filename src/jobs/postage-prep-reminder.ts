/**
 * Morning nag on Telegram: which parcels still need packing today.
 *
 * Runs 09:00 Mauritius (UTC+4) = 05:00 UTC. Lists every Postage / Express
 * Postage / Rodrigues Postage order that is still in preparation and whose
 * delivery day has arrived or passed.
 *
 * There is no reminder state. The job re-derives the list from scratch each
 * morning, so an order keeps reappearing until someone taps it ready on the
 * prep page — which is exactly the requested behaviour, with nothing to get out
 * of sync. Selection and wording live in src/lib/postage-prep-reminder.ts and
 * are unit-tested there; this file is the query and the send.
 *
 * Unlike the daily sales report this job stays silent when the list is empty —
 * see buildPostagePrepMessage for why.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { mauritiusToday } from "../lib/mauritius-date"
import {
  buildPostagePrepMessage,
  selectPostagePrep,
  type PostageOrderLike,
} from "../lib/postage-prep-reminder"
import { sendTelegram } from "../lib/telegram"

// Orders can be created up to ~60 days before their delivery day, and a genuinely
// forgotten parcel should keep surfacing well past that. 120 days covers both
// without scanning the whole order table.
const LOOKBACK_DAYS = 120

export default async function postagePrepReminder(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const today = mauritiusToday()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  let orders: PostageOrderLike[]
  try {
    // delivery_method / delivery_date / dm_status all live in metadata, which
    // query.graph cannot filter on — narrow by date here, decide in JS.
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "fulfillment_status",
        "metadata",
        "shipping_address.first_name",
        "shipping_address.last_name",
      ],
      filters: { created_at: { $gte: since.toISOString() } },
    })
    orders = (data ?? []).filter(
      (o): o is NonNullable<typeof o> => o != null,
    ) as PostageOrderLike[]
  } catch (err) {
    logger.error(
      `[postage-prep] could not read orders: ${(err as Error).message}`,
    )
    // Speak up rather than fail silently — a quiet morning would otherwise be
    // indistinguishable from "nothing to pack".
    await sendTelegram(
      [
        "⚠️ <b>Postage prep reminder failed</b>",
        "",
        "Could not read orders. Check the dollup-medusa logs.",
      ].join("\n"),
    )
    return
  }

  const entries = selectPostagePrep(orders, today)
  const message = buildPostagePrepMessage(entries)

  logger.info(
    `[postage-prep] ${today}: ${entries.length} postage order(s) awaiting prep`,
  )

  if (!message) return

  const sent = await sendTelegram(message)
  if (!sent.ok && !("skipped" in sent)) {
    logger.error(`[postage-prep] Telegram send failed: ${sent.message}`)
  }
}

export const config = {
  name: "postage-prep-reminder",
  // 09:00 Mauritius (UTC+4) = 05:00 UTC.
  schedule: "0 5 * * *",
}
