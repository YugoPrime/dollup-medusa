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
import type { OrderShippedEmailData } from "../modules/notification-resend/templates/order-shipped"

export const ORDER_SHIPPED_EVENT = "dm.order.shipped"

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://shop.dollupboutique.com"

/**
 * Storefront delivery_method labels are stored in DM admin as the raw
 * DmDeliveryMethod string ("Pick Up", "Home Delivery", "Postage", etc).
 * Normalize them to the email template's enum.
 */
function normalizeDeliveryMethod(raw: unknown): string {
  if (typeof raw !== "string") return "post_office"
  const s = raw.trim().toLowerCase()
  if (s === "pick up" || s === "pickup") return "pickup"
  if (s === "home delivery" || s === "home_delivery") return "home_delivery"
  if (s.includes("postage") || s.includes("post")) return "post_office"
  return "post_office"
}

export default async function emailOnOrderShipped({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "metadata",
        "shipping_address.first_name",
      ],
      filters: { id: orderId },
    })
    const order = orders?.[0]
    if (!order || !order.email) {
      logger.warn(
        `[email] dm.order.shipped: no order or email for ${orderId}, skipping`,
      )
      return
    }

    const metadata = (order.metadata ?? {}) as Record<string, unknown>
    const deliveryMethod = normalizeDeliveryMethod(metadata.delivery_method)
    const deliveryDate =
      typeof metadata.delivery_date === "string"
        ? metadata.delivery_date
        : null
    const trackingNumber =
      typeof metadata.tracking_number === "string"
        ? metadata.tracking_number
        : null

    const data: OrderShippedEmailData = {
      storefrontUrl: STOREFRONT_URL,
      customerFirstName:
        (order.shipping_address?.first_name as string | null) ?? "",
      displayId: order.display_id ?? order.id,
      deliveryMethod,
      deliveryDate,
      trackingNumber,
    }

    const notificationService = container.resolve<INotificationModuleService>(
      Modules.NOTIFICATION,
    )
    await notificationService.createNotifications({
      to: order.email,
      channel: "email",
      template: EmailTemplate.ORDER_SHIPPED,
      data: data as unknown as Record<string, unknown>,
    })

    logger.info(`[email] dm.order.shipped → ${order.email} (${orderId})`)
  } catch (err) {
    logger.error(
      `[email] dm.order.shipped failed for ${orderId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: ORDER_SHIPPED_EVENT,
  context: {
    subscriberId: "email-on-dm-order-shipped",
  },
}
