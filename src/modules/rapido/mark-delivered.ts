import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createOrderFulfillmentWorkflow,
  createOrderPaymentCollectionWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"

/**
 * Apply a Rapido "delivered" webhook to the order itself.
 *
 * Mirrors markOrderDelivered() in dollup-admin (src/lib/admin-orders.ts) — the
 * founder's manual "Mark delivered" — so a courier-confirmed delivery and a
 * hand-marked one leave the order in the same state:
 *
 *   - metadata.dm_status = "ready"
 *   - a Medusa fulfillment exists (this is what getEffectiveStatus reads)
 *   - manual-only orders, which cannot be fulfilled in Medusa, fall back to
 *     metadata.dm_delivered = true
 *
 * It goes one step further than the manual path and stamps the fulfillment
 * delivered_at, because unlike a human clicking a button, Rapido is actually
 * telling us the parcel reached the customer. That moves fulfillment_status to
 * "delivered", which is the only thing the storefront's track-order page will
 * show as Delivered.
 *
 * The duplication with dollup-admin is deliberate: the two apps ship separately
 * and share no code. If the delivered semantics change, change both.
 */

const STOCK_LOCATION_ID =
  process.env.MEDUSA_DEFAULT_STOCK_LOCATION_ID ??
  "sloc_01KN48PYHQ0DTXXN2N0JWZSAYV"

export type CourierDeliveryOutcome = {
  /** Whether this call moved the order into a delivered state. */
  applied: boolean
  /** Set when nothing needed doing (already delivered by a prior event). */
  skipped?: "already_delivered"
  /** How delivery was recorded. */
  via?: "fulfillment" | "existing_fulfillment" | "dm_delivered_flag"
  /** Present when the Medusa fulfillment failed and we fell back to the flag. */
  error?: string
}

type FulfillmentRow = {
  id: string
  canceled_at?: string | Date | null
  delivered_at?: string | Date | null
}

/**
 * Record the cash Rapido collected at the door.
 *
 * Rapido guarantees the merchant gets paid, so a delivery genuinely closes the
 * sale — but the money is with Rapido until they remit it. That's why this
 * marks the ORDER paid while flagging it unsettled: `rapido_settled` is what a
 * payout/reconciliation view uses to show how much Rapido is still holding.
 *
 * payment_method stays "Cash" because that is what the customer actually did.
 * How Rapido later remits (bank transfer, sometimes cash) is a property of the
 * payout, not of this order — and writing a transfer method here would trip the
 * VAT extraction that keys off "Juice / Bank Transfer" (see VatBreakdown.tsx in
 * dollup-admin), misstating output VAT on a cash sale.
 *
 * Mutates `metadata` in place; the caller performs the single write.
 */
async function settleCourierCash(
  scope: MedusaContainer,
  orderId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)

  // Written at dispatch time — literally the amount Rapido was told to collect.
  // Absent on orders dispatched before that field existed: skip rather than
  // guess, since re-deriving it goes wrong on deposit / exchange-credit orders.
  const cod = metadata.rapido_cod_amount
  if (typeof cod !== "number" || !Number.isFinite(cod)) {
    logger.warn(
      `[rapido/delivered] order ${orderId}: no rapido_cod_amount on the order (dispatched before it was recorded) — leaving payment for manual review`,
    )
    return
  }

  // Prepaid order: Rapido collected nothing, so there is no cash to record and
  // the existing payment_method (e.g. Juice / Bank Transfer) must stand.
  if (cod <= 0) return

  // Already settled by an earlier delivery event for this order.
  if (metadata.rapido_settled !== undefined) return

  try {
    const { result } = await createOrderPaymentCollectionWorkflow(scope).run({
      input: { order_id: orderId, amount: cod },
    })
    const collection = Array.isArray(result) ? result[0] : result
    const collectionId = (collection as { id?: string } | undefined)?.id
    if (!collectionId) {
      throw new Error("payment collection created but no id was returned")
    }

    await markPaymentCollectionAsPaid(scope).run({
      input: { order_id: orderId, payment_collection_id: collectionId },
    })

    metadata.sale_type = "paid"
    metadata.rapido_settled = false
    // Only fill the method when the order has none. An order that already
    // carries one (a deposit paid by Juice, say) keeps it — overwriting would
    // lose how the non-cash portion arrived.
    if (!metadata.payment_method) metadata.payment_method = "Cash"

    logger.info(
      `[rapido/delivered] order ${orderId}: recorded Rs ${cod} collected by Rapido (unsettled)`,
    )
  } catch (err) {
    // The order still becomes delivered — only the money side failed. Left
    // unpaid on purpose so it surfaces for manual review rather than silently
    // claiming cash that was never recorded.
    const message = err instanceof Error ? err.message : String(err)
    metadata.rapido_payment_error = message
    logger.error(
      `[rapido/delivered] order ${orderId}: recording the Rs ${cod} COD failed, order left unpaid — ${message}`,
    )
  }
}

/**
 * @param baseMetadata the order's metadata with the webhook's own fields
 *   (rapido_status / rapido_tracking) already merged in. This function owns
 *   every metadata write from here on, so the caller must not write it too —
 *   Medusa replaces metadata wholesale and the second write would win.
 */
export async function markOrderDeliveredFromCourier(
  scope: MedusaContainer,
  orderId: string,
  baseMetadata: Record<string, unknown>,
): Promise<CourierDeliveryOutcome> {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const orderModule = scope.resolve(Modules.ORDER)

  const { data: rows } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "fulfillments.id",
      "fulfillments.canceled_at",
      "fulfillments.delivered_at",
    ],
    filters: { id: orderId },
  })
  const fulfillments = ((rows?.[0]?.fulfillments ?? []) as FulfillmentRow[])
    .filter((f) => f && !f.canceled_at)

  // Idempotency. Rapido can resend, and our 500-on-error tells it to retry, so
  // a duplicate DELIVERED is expected rather than exceptional. Note the guard
  // is the *order state*, not rapido_delivered_at: if a previous attempt wrote
  // the timestamp but its fulfillment failed, a retry should try again.
  const alreadyDelivered =
    fulfillments.some((f) => f.delivered_at) || baseMetadata.dm_delivered === true
  if (alreadyDelivered) {
    await orderModule.updateOrders(orderId, { metadata: baseMetadata })
    return { applied: false, skipped: "already_delivered" }
  }

  // Line-item quantities live on the OrderItem join, which query.graph does not
  // hydrate — retrieveOrder with the items relation is the only way to get them.
  // (Same trap documented in scripts/backfill-manual-order-reservations.ts.)
  const hydrated = (await orderModule.retrieveOrder(orderId, {
    select: ["id"],
    relations: ["items"],
  })) as {
    items?: Array<{ id: string; quantity: number; variant_id?: string | null }>
  }
  const fulfillableItems = (hydrated.items ?? [])
    .filter((it) => Number(it.quantity ?? 0) > 0 && it.variant_id)
    .map((it) => ({ id: it.id, quantity: Number(it.quantity) }))

  const metadata: Record<string, unknown> = {
    ...baseMetadata,
    dm_status: "ready",
    rapido_delivered_at: new Date().toISOString(),
  }
  // A prior failed attempt may have left breadcrumbs; this run supersedes them.
  delete metadata.rapido_deliver_error
  delete metadata.rapido_payment_error

  // Money side first, so its result rides along in the single metadata write
  // below. Never throws — a payment problem must not block the delivery status.
  await settleCourierCash(scope, orderId, metadata)

  // Manual-only order (every line is a manual product with no variant): there is
  // nothing Medusa can fulfil, so the flag is the only way to record delivery.
  if (fulfillableItems.length === 0) {
    metadata.dm_delivered = true
    await orderModule.updateOrders(orderId, { metadata })
    return { applied: true, via: "dm_delivered_flag" }
  }

  // Metadata first: if the fulfillment below explodes, dm_status must still have
  // moved, and the catch needs a written baseline to append its breadcrumb to.
  await orderModule.updateOrders(orderId, { metadata })

  try {
    let fulfillmentId = fulfillments[0]?.id
    let via: CourierDeliveryOutcome["via"] = "existing_fulfillment"

    if (!fulfillmentId) {
      const { result } = await createOrderFulfillmentWorkflow(scope).run({
        input: {
          order_id: orderId,
          items: fulfillableItems,
          location_id: STOCK_LOCATION_ID,
          no_notification: true,
        },
      })
      fulfillmentId = (result as { id: string }).id
      via = "fulfillment"
    }

    await markOrderFulfillmentAsDeliveredWorkflow(scope).run({
      input: { orderId, fulfillmentId },
    })

    logger.info(
      `[rapido/delivered] order ${orderId} marked delivered (${via}, fulfillment ${fulfillmentId})`,
    )
    return { applied: true, via }
  } catch (err) {
    // Known failure modes: no stock reservation (manual/Hermes orders created
    // before reservations were wired up) and shipping-profile mismatches.
    // Falling back to the flag keeps the order visibly delivered in admin
    // rather than silently stuck in preparation — but Medusa never moved the
    // stock, so the breadcrumb below is what tells you inventory needs a look.
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `[rapido/delivered] order ${orderId}: Medusa fulfillment failed, falling back to dm_delivered — ${message}`,
    )
    try {
      await orderModule.updateOrders(orderId, {
        metadata: {
          ...metadata,
          dm_delivered: true,
          rapido_deliver_error: message,
        },
      })
    } catch (writeErr) {
      logger.error(
        `[rapido/delivered] order ${orderId}: fallback metadata write ALSO failed — ${
          writeErr instanceof Error ? writeErr.message : String(writeErr)
        }`,
      )
    }
    return { applied: true, via: "dm_delivered_flag", error: message }
  }
}
