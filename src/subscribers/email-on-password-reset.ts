import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/framework/types"

import { EmailTemplate } from "../modules/notification-resend/service"
import type { PasswordResetEmailData } from "../modules/notification-resend/templates/password-reset"

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://shop.dollupboutique.com"

type PasswordResetEvent = {
  entity_id: string
  token: string
  actor_type: string
}

export default async function emailOnPasswordReset({
  event,
  container,
}: SubscriberArgs<PasswordResetEvent>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { entity_id: email, token, actor_type } = event.data ?? ({} as PasswordResetEvent)

  if (!email || !token) {
    logger.warn(`[email] password reset: missing email or token`)
    return
  }

  if (actor_type !== "customer") {
    // Admins reset via the Medusa admin's own flow.
    return
  }

  try {
    const resetUrl = `${STOREFRONT_URL}/reset-password?token=${encodeURIComponent(
      token,
    )}&email=${encodeURIComponent(email)}`

    const data: PasswordResetEmailData = {
      storefrontUrl: STOREFRONT_URL,
      resetUrl,
      expiresInMinutes: 60,
    }

    const notificationService = container.resolve<INotificationModuleService>(
      Modules.NOTIFICATION,
    )
    await notificationService.createNotifications({
      to: email,
      channel: "email",
      template: EmailTemplate.PASSWORD_RESET,
      data: data as unknown as Record<string, unknown>,
    })

    logger.info(`[email] password reset → ${email}`)
  } catch (err) {
    logger.error(
      `[email] password reset failed for ${email}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
  context: {
    subscriberId: "email-on-password-reset",
  },
}
