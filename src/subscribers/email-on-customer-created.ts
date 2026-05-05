import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/framework/types"

import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"
import { EmailTemplate } from "../modules/notification-resend/service"
import type { WelcomeEmailData } from "../modules/notification-resend/templates/welcome"

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://shop.dollupboutique.com"

export default async function emailOnCustomerCreated({
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
      fields: ["id", "email", "first_name", "last_name", "has_account"],
      filters: { id: customerId },
    })
    const customer = customers?.[0]
    if (!customer || !customer.email) {
      logger.warn(
        `[email] customer.created: no customer or email for ${customerId}, skipping`,
      )
      return
    }

    if (!customer.has_account) {
      // Guest checkout creates a customer record too — skip welcome email
      // for guests, only send to people who actually registered.
      return
    }

    let welcomeBonusPoints = 0
    try {
      const loyaltyService = container.resolve<LoyaltyModuleService>(
        LOYALTY_MODULE,
      )
      const settings = await loyaltyService.getSettings()
      welcomeBonusPoints = settings.welcome_bonus_points ?? 0
    } catch (err) {
      logger.warn(
        `[email] customer.created: could not read loyalty settings (${(err as Error).message})`,
      )
    }

    const data: WelcomeEmailData = {
      storefrontUrl: STOREFRONT_URL,
      customerFirstName: (customer.first_name as string | null) ?? "",
      welcomeBonusPoints,
    }

    const notificationService = container.resolve<INotificationModuleService>(
      Modules.NOTIFICATION,
    )
    await notificationService.createNotifications({
      to: customer.email,
      channel: "email",
      template: EmailTemplate.WELCOME,
      data: data as unknown as Record<string, unknown>,
    })

    logger.info(`[email] customer.created → ${customer.email}`)
  } catch (err) {
    logger.error(
      `[email] customer.created failed for ${customerId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
  context: {
    subscriberId: "email-on-customer-created",
  },
}
