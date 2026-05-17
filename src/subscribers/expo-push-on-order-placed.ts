import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import { isExpoToken, sendExpoPush } from "../lib/expo-push"

export default async function expoPushOnOrderPlaced({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  try {
    const orderModuleService = container.resolve(Modules.ORDER)
    const order = (await orderModuleService.retrieveOrder(orderId, {
      select: ["id", "display_id", "customer_id", "total"],
    })) as unknown as {
      id: string
      display_id?: number | null
      customer_id?: string | null
      total?: number | { value?: string | number } | null
    }
    if (!order?.customer_id) {
      // Guest checkout — no customer to push to. Telegram subscriber covers
      // the operator-side notification.
      return
    }

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

    await sendExpoPush(logger, token, {
      title: "Order placed 🎉",
      body: `Order #${order.display_id ?? order.id.slice(-6)} — we're preparing it now.`,
      data: { orderId: order.id, screen: "order", display_id: order.display_id },
    })
  } catch (err) {
    logger.error(
      `[expo-push] order.placed failed for ${orderId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: {
    subscriberId: "expo-push-on-order-placed",
  },
}
