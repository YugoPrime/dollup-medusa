import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"

/**
 * Award the configured welcome bonus the first time a customer registers.
 *
 *   - Only registered customers (has_account=true), not guest checkout records.
 *   - Idempotent through the loyalty service: awardPoints with order_id=null
 *     will create a fresh transaction every call, so we guard with a metadata
 *     flag on the loyalty account itself.
 *   - Skipped if welcome_bonus_points is 0 in settings.
 */
export default async function loyaltyWelcomeBonusSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const customerId = event.data?.id
  if (!customerId) return

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["id", "has_account"],
      filters: { id: customerId },
    })
    const customer = customers?.[0]
    if (!customer || !customer.has_account) return

    const loyaltyService = container.resolve<LoyaltyModuleService>(
      LOYALTY_MODULE,
    )
    const settings = await loyaltyService.getSettings()
    const bonus = settings.welcome_bonus_points
    if (!bonus || bonus <= 0) return

    const account = await loyaltyService.getAccount(customerId)
    // Guard against double-awarding if the subscriber re-fires.
    if (account.lifetime_earned > 0 || account.points_balance > 0) {
      return
    }

    await loyaltyService.awardPoints(customerId, bonus, {
      reason: `Welcome bonus on signup`,
    })

    logger.info(
      `[loyalty] awarded ${bonus} welcome pts to customer ${customerId}`,
    )
  } catch (err) {
    logger.error(
      `[loyalty] welcome bonus failed for ${customerId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
  context: {
    subscriberId: "loyalty-welcome-bonus-on-customer-created",
  },
}
