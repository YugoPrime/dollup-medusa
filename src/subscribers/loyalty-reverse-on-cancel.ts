import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"

/**
 * Take back the points an order earned when the order is cancelled.
 *
 * reversePointsForOrder is idempotent: an order already reversed (by a
 * refund or an earlier cancel event) is left alone. Failures are logged and
 * swallowed so a loyalty problem never blocks a cancellation.
 */
export default async function loyaltyReverseOnCancel({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  try {
    const order = await container.resolve(Modules.ORDER).retrieveOrder(orderId, {
      select: ["id", "display_id", "customer_id"],
    })
    if (!order.customer_id) return

    const loyalty = container.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
    const { reversed } = await loyalty.reversePointsForOrder(order.customer_id, order.id, {
      reason: `Order #${order.display_id ?? order.id} cancelled`,
    })
    if (reversed > 0) {
      logger.info(`[loyalty] took back ${reversed} pts for cancelled order ${order.id}`)
    }
  } catch (err) {
    logger.error(
      `[loyalty] failed to take back points for cancelled order ${orderId}: ${
        (err as Error)?.message ?? err
      }`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: {
    subscriberId: "loyalty-reverse-on-order-canceled",
  },
}
