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
 * Admin route that fires the shipped-customer email for a DM order.
 *
 *   - Stamps metadata.shipped_at (audit only, no reader)
 *   - Optionally writes metadata.tracking_number from the request body
 *   - Emits the custom `dm.order.shipped` event so the email subscriber
 *     fires exactly once per shipping action.
 *
 * dm_status is owned exclusively by setDmStatus() in dollup-admin. This route
 * MUST NOT touch dm_status — readDmStatus() in admin-orders.ts treats anything
 * other than "ready" as "preparation", so writing "shipped" here used to drop
 * Home Delivery / Pickup orders back into Mark Ready after every click.
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
