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
import type { OrderPlacedEmailData } from "../modules/notification-resend/templates/order-placed"

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://shop.dollupboutique.com"

function normalizeDeliveryMethod(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === "pick up" || s === "pickup") return "pickup"
  if (s === "home delivery" || s === "home_delivery") return "home_delivery"
  if (s.includes("postage") || s.includes("post")) return "post_office"
  return null
}

function num(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  if (value && typeof value === "object" && "value" in value) {
    const v = (value as { value?: string | number }).value
    return Number(v) || 0
  }
  return 0
}

export default async function emailOnOrderPlaced({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  try {
    // Medusa v2 query.graph silently returns 0 for calculated totals
    // (subtotal/shipping_total/total). The OrderModuleService.retrieveOrder
    // path runs the totals calculator and returns real values — same pattern
    // used by loyalty-award.ts.
    const orderModuleService = container.resolve(Modules.ORDER)
    const order = (await orderModuleService.retrieveOrder(orderId, {
      select: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "subtotal",
        "shipping_total",
        "total",
        "metadata",
      ],
      relations: ["items", "shipping_address"],
    })) as unknown as {
      id: string
      display_id?: number | null
      email?: string | null
      currency_code?: string | null
      subtotal?: number | { value?: string | number } | null
      shipping_total?: number | { value?: string | number } | null
      total?: number | { value?: string | number } | null
      metadata?: Record<string, unknown> | null
      items?: Array<{
        title?: string | null
        quantity?: number | null
        unit_price?: number | { value?: string | number } | null
        thumbnail?: string | null
      }> | null
      shipping_address?: {
        first_name?: string | null
        last_name?: string | null
        address_1?: string | null
        city?: string | null
        phone?: string | null
      } | null
    }
    if (!order || !order.email) {
      logger.warn(
        `[email] order.placed: no order or email for ${orderId}, skipping`,
      )
      return
    }

    const metadata = (order.metadata ?? {}) as Record<string, unknown>
    const data: OrderPlacedEmailData = {
      storefrontUrl: STOREFRONT_URL,
      customerFirstName:
        (order.shipping_address?.first_name as string | null) ?? "",
      displayId: order.display_id ?? order.id,
      items: (order.items ?? [])
        .filter((item): item is NonNullable<typeof item> => item != null)
        .map((item) => ({
          title: (item.title as string) ?? "Item",
          quantity: num(item.quantity) || 1,
          unit_price: num(item.unit_price),
          thumbnail: (item.thumbnail as string | null) ?? null,
        })),
      subtotal: num(order.subtotal),
      shippingTotal: num(order.shipping_total),
      total: num(order.total),
      shippingAddress: {
        address_1: (order.shipping_address?.address_1 as string | null) ?? null,
        city: (order.shipping_address?.city as string | null) ?? null,
        phone: (order.shipping_address?.phone as string | null) ?? null,
      },
      deliveryMethod: normalizeDeliveryMethod(metadata.delivery_method),
      // Raw label from the storefront (e.g. "Express Postage", "Rodrigues
      // Postage") so the email shows the exact method the customer picked.
      shippingMethodLabel:
        typeof metadata.delivery_method === "string"
          ? metadata.delivery_method
          : null,
      deliveryDate:
        typeof metadata.delivery_date === "string"
          ? metadata.delivery_date
          : null,
    }

    const notificationService = container.resolve<INotificationModuleService>(
      Modules.NOTIFICATION,
    )
    await notificationService.createNotifications({
      to: order.email,
      channel: "email",
      template: EmailTemplate.ORDER_PLACED,
      data: data as unknown as Record<string, unknown>,
    })

    logger.info(`[email] order.placed → ${order.email} (order ${orderId})`)
  } catch (err) {
    logger.error(
      `[email] order.placed failed for ${orderId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: {
    subscriberId: "email-on-order-placed",
  },
}
