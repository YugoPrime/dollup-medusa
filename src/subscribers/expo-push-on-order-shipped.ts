import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import { isExpoToken, sendExpoPush } from "../lib/expo-push"

export const ORDER_SHIPPED_EVENT = "dm.order.shipped"

export default async function expoPushOnOrderShipped({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  try {
    const orderModuleService = container.resolve(Modules.ORDER)
    const order = (await orderModuleService.retrieveOrder(orderId, {
      select: ["id", "display_id", "customer_id", "metadata"],
    })) as unknown as {
      id: string
      display_id?: number | null
      customer_id?: string | null
      metadata?: Record<string, unknown> | null
    }
    if (!order?.customer_id) return

    const customerModuleService = container.resolve(Modules.CUSTOMER)
    const customer = (await customerModuleService.retrieveCustomer(
      order.customer_id,
      { select: ["id", "metadata"] },
    )) as unknown as {
      id: string
      metadata?: Record<string, unknown> | null
    }

    const token = customer?.metadata?.expo_push_token
    if (!isExpoToken(token)) return

    const tracking =
      typeof order.metadata?.tracking_number === "string"
        ? (order.metadata.tracking_number as string)
        : null
    const deliveryMethod =
      typeof order.metadata?.delivery_method === "string"
        ? (order.metadata.delivery_method as string)
        : null

    const bodyParts: string[] = [
      `Order #${order.display_id ?? order.id.slice(-6)} is on the way.`,
    ]
    if (deliveryMethod) bodyParts.push(`Via ${deliveryMethod}.`)
    if (tracking) bodyParts.push(`Tracking: ${tracking}.`)

    await sendExpoPush(logger, token, {
      title: "Your order is on the way 🚚",
      body: bodyParts.join(" "),
      data: {
        orderId: order.id,
        screen: "order",
        display_id: order.display_id,
        tracking_number: tracking,
      },
    })
  } catch (err) {
    logger.error(
      `[expo-push] dm.order.shipped failed for ${orderId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: ORDER_SHIPPED_EVENT,
  context: {
    subscriberId: "expo-push-on-order-shipped",
  },
}
