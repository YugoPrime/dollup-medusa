import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework/subscribers"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { ADMIN_PUSH_MODULE } from "../modules/admin-push"
import type AdminPushModuleService from "../modules/admin-push/service"
import {
  buildOrderPlacedPayload,
  getAdminUrl,
  isWebPushConfigured,
  sendWebPush,
  type OrderForPush,
} from "../lib/web-push"

/**
 * Pushes "New order" to every device that enabled notifications in the
 * installed Doll Up Admin PWA. Dormant until VAPID_* env is set (same
 * behaviour as telegram-on-order-placed). Subscriptions the push service
 * reports gone (404/410) are deleted so we stop paying for dead endpoints.
 */
export default async function webPushOnOrderPlaced({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return
  if (!isWebPushConfigured()) return

  try {
    const pushService = container.resolve<AdminPushModuleService>(ADMIN_PUSH_MODULE)
    const subscriptions = await pushService.listAll()
    if (subscriptions.length === 0) return

    const orderModuleService = container.resolve(Modules.ORDER)
    const order = (await orderModuleService.retrieveOrder(orderId, {
      select: ["id", "display_id", "email", "currency_code", "subtotal", "shipping_total", "total", "metadata"],
      relations: ["items", "shipping_address"],
    })) as unknown as OrderForPush | null
    if (!order) {
      logger.warn(`[web-push] order.placed: no order for ${orderId}`)
      return
    }

    const payload = buildOrderPlacedPayload(order, getAdminUrl())
    const results = await Promise.all(
      subscriptions.map((sub) =>
        sendWebPush(logger, { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload),
      ),
    )

    let sent = 0
    const gone: string[] = []
    results.forEach((res, i) => {
      if (res.ok) sent += 1
      else if (res.gone) gone.push(subscriptions[i].endpoint)
    })
    for (const endpoint of gone) {
      await pushService.removeByEndpoint(endpoint)
    }
    logger.info(`[web-push] order.placed → sent ${sent}, pruned ${gone.length} (order ${orderId})`)
  } catch (err) {
    logger.error(`[web-push] order.placed failed for ${orderId}: ${(err as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: {
    subscriberId: "web-push-on-order-placed",
  },
}
