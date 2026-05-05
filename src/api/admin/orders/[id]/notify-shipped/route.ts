import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import { ORDER_SHIPPED_EVENT } from "../../../../../subscribers/email-on-order-shipped"

/**
 * Admin route that finalizes the "shipped" state on a DM order.
 *
 *   - Sets metadata.dm_status = "shipped"
 *   - Optionally writes metadata.tracking_number from the request body
 *   - Emits the custom `dm.order.shipped` event so the email subscriber
 *     fires exactly once per shipping action.
 *
 * Called by the storefront's /admin/prep page after the user clicks
 * "Mark shipped". Existing markOrderShipped() in admin-orders.ts handles
 * the dm_status flip + fulfillment creation through the SDK; this route is
 * specifically the email trigger so it can be re-fired manually if needed.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const orderId = req.params?.id
  if (!orderId) {
    res.status(400).json({ message: "Order id is required" })
    return
  }

  const body = (req.body ?? {}) as { tracking_number?: unknown }
  const trackingNumber =
    typeof body.tracking_number === "string" && body.tracking_number.trim()
      ? body.tracking_number.trim()
      : null

  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: orderId },
  })
  const order = orders?.[0]
  if (!order) {
    res.status(404).json({ message: `Order ${orderId} not found` })
    return
  }

  const orderModule = req.scope.resolve(Modules.ORDER)
  const newMetadata = {
    ...((order.metadata ?? {}) as Record<string, unknown>),
    dm_status: "shipped",
    shipped_at: new Date().toISOString(),
    ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
  }

  await orderModule.updateOrders(orderId, { metadata: newMetadata })

  const eventBus = req.scope.resolve(Modules.EVENT_BUS) as {
    emit: (
      input: { name: string; data: Record<string, unknown> },
    ) => Promise<void>
  }
  await eventBus.emit({
    name: ORDER_SHIPPED_EVENT,
    data: { id: orderId },
  })

  logger.info(`[order-shipped] notified for ${orderId}`)
  res.json({ ok: true })
}
