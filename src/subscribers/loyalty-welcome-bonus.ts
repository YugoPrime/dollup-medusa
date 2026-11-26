import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { findGuestPointRows, moveGuestPoints, type PgRaw } from "../lib/loyalty-maintenance"
import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"

/**
 * When a customer registers:
 *   1. Award the configured welcome bonus (first time only).
 *   2. Move in any points sitting on guest checkout records with the same
 *      email (web orders placed before signing up or while logged out).
 *
 *   - Only registered customers (has_account=true), not guest checkout records.
 *   - Welcome is guarded by the account balance: a re-fired event finds the
 *     balance above zero and awards nothing. It runs before the move so the
 *     moved points never block the bonus.
 *   - The move is idempotent: moved guest records are at zero, and
 *     moveGuestPoints debits before it credits.
 *   - Each step has its own try/catch: a failing move never costs the bonus.
 */
export default async function loyaltyWelcomeBonusSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const customerId = event.data?.id
  if (!customerId) return

  let loyaltyService: LoyaltyModuleService
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["id", "has_account"],
      filters: { id: customerId },
    })
    const customer = customers?.[0]
    if (!customer || !customer.has_account) return
    loyaltyService = container.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  } catch (err) {
    logger.error(
      `[loyalty] welcome bonus failed for ${customerId}: ${(err as Error).message}`,
    )
    return
  }

  try {
    const settings = await loyaltyService.getSettings()
    const bonus = settings.welcome_bonus_points
    const account = await loyaltyService.getAccount(customerId)
    if (bonus > 0 && account.lifetime_earned <= 0 && account.points_balance <= 0) {
      await loyaltyService.awardPoints(customerId, bonus, {
        reason: `Welcome bonus on signup`,
      })
      logger.info(
        `[loyalty] awarded ${bonus} welcome pts to customer ${customerId}`,
      )
    }
  } catch (err) {
    logger.error(
      `[loyalty] welcome bonus failed for ${customerId}: ${(err as Error).message}`,
    )
  }

  try {
    const pg = container.resolve<PgRaw>(ContainerRegistrationKeys.PG_CONNECTION)
    const rows = await findGuestPointRows(pg, customerId)
    const moved = await moveGuestPoints(loyaltyService, rows)
    if (moved.points > 0) {
      logger.info(
        `[loyalty] moved ${moved.points} guest pts into customer ${customerId}`,
      )
    }
  } catch (err) {
    logger.error(
      `[loyalty] guest points move failed for ${customerId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
  context: {
    subscriberId: "loyalty-welcome-bonus-on-customer-created",
  },
}
