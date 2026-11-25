import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import {
  ORDER_TRACKING_EVENT,
  trackingEmailDecision,
} from "../../../../../lib/tracking-email"

/**
 * Called by dollup-admin after staff save a new Mauritius Post number on an
 * order. Sends the "here's your tracking number" email when
 * trackingEmailDecision says so (shipped website postage order, once per
 * number), stamps metadata.tracking_emailed, and answers why it did or
 * didn't send. The number itself is saved by the admin before this call.
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

  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "email", "metadata"],
    filters: { id: orderId },
  })
  const order = orders?.[0] as
    | { id: string; email?: string | null; metadata?: Record<string, unknown> | null }
    | undefined
  if (!order) {
    res.status(404).json({ message: `Order ${orderId} not found` })
    return
  }

  const decision = trackingEmailDecision(order)
  if (!decision.send) {
    res.json({ sent: false, reason: decision.reason })
    return
  }

  // Stamp first: a double click or a retry then finds "already_sent".
  const orderModule = req.scope.resolve(Modules.ORDER)
  await orderModule.updateOrders(orderId, {
    metadata: {
      ...(order.metadata ?? {}),
      tracking_emailed: decision.number,
    },
  })

  const eventBus = req.scope.resolve(Modules.EVENT_BUS) as {
    emit: (input: { name: string; data: Record<string, unknown> }) => Promise<void>
  }
  await eventBus.emit({ name: ORDER_TRACKING_EVENT, data: { id: orderId } })

  logger.info(`[order-tracking] email queued for ${orderId}`)
  res.json({ sent: true })
}
