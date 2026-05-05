import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"

/**
 * Award loyalty points whenever an order is placed.
 *
 *   - 1 point per Rs 10 (MUR) — Math.floor(total / 10)
 *   - Mauritius (MUR) only; we are a single-region store today, but this
 *     guard means a future EUR/USD region won't accidentally start handing
 *     out points until product owners decide the rate.
 *   - Skipped when order.metadata.loyalty_skip === true (admin escape hatch
 *     for manual / test orders).
 *   - Skipped if the order has no customer_id (guest checkout).
 *   - Idempotent: awardPoints() checks for an existing earn-row tied to
 *     order_id and no-ops the second call.
 */
export default async function loyaltyAwardSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) {
    return
  }

  try {
    const orderModuleService = container.resolve(Modules.ORDER)
    const order = await orderModuleService.retrieveOrder(orderId, {
      select: [
        "id",
        "display_id",
        "customer_id",
        "currency_code",
        "total",
        "metadata",
      ],
    })

    if (!order.customer_id) {
      // Guest order — nothing to credit.
      return
    }

    if (order.metadata && (order.metadata as Record<string, unknown>).loyalty_skip === true) {
      logger.info(
        `[loyalty] skipping award for order ${order.id} (loyalty_skip metadata flag)`,
      )
      return
    }

    const currency = (order.currency_code ?? "").toLowerCase()
    if (currency !== "mur") {
      // Non-MUR region — no points configured yet. Bail quietly.
      return
    }

    // BigNumberValue → number. Medusa serializes via toJSON() to a number,
    // but be defensive in case we hit a raw bignumber instance.
    const totalNumber = Number(order.total ?? 0)
    if (!Number.isFinite(totalNumber) || totalNumber <= 0) {
      return
    }

    const loyaltyService = container.resolve<LoyaltyModuleService>(
      LOYALTY_MODULE,
    )
    const settings = await loyaltyService.getSettings()
    const points = Math.floor(
      (totalNumber * settings.earn_rate_per_100_mur) / 100,
    )
    if (points <= 0) {
      return
    }

    await loyaltyService.awardPoints(order.customer_id, points, {
      orderId: order.id,
      reason: `Order #${order.display_id ?? order.id} completed`,
    })

    logger.info(
      `[loyalty] awarded ${points} pts to customer ${order.customer_id} for order ${order.id}`,
    )
  } catch (err) {
    // Never let a loyalty failure tank the order pipeline. Log + swallow.
    logger.error(
      `[loyalty] failed to award points for order ${orderId}: ${
        (err as Error)?.message ?? err
      }`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: {
    subscriberId: "loyalty-award-on-order-placed",
  },
}
