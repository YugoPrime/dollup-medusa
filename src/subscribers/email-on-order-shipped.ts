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

function num(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  if (value && typeof value === "object" && "value" in value) {
    const v = (value as { value?: string | number }).value
    return Number(v) || 0
  }
  return 0
}

// Mirrors dollup-admin's "is paid" rule: sale_type === "paid" (admin
// manually marked it) OR Medusa's payment_status is captured/paid.
function detectIsPaid(
  metadata: Record<string, unknown>,
  paymentStatus: unknown,
): boolean {
  if (metadata.sale_type === "paid") return true
  if (typeof paymentStatus === "string") {
    const s = paymentStatus.toLowerCase()
    if (s === "captured" || s === "paid" || s === "partially_captured") {
      return true
    }
  }
  return false
}

export default async function emailOnOrderShipped({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  try {
    // Medusa v2 query.graph silently returns 0 for calculated totals.
    // retrieveOrder via OrderModuleService runs the totals calculator and
    // returns real values (same pattern used by loyalty-award.ts).
    const orderModuleService = container.resolve(Modules.ORDER)
    const order = (await orderModuleService.retrieveOrder(orderId, {
      select: [
        "id",
        "display_id",
        "email",
        "metadata",
        "payment_status",
        "subtotal",
        "shipping_total",
        "total",
      ],
      relations: ["items", "shipping_address"],
    })) as unknown as {
      id: string
      display_id?: number | null
      email?: string | null
      metadata?: Record<string, unknown> | null
      payment_status?: string | null
      subtotal?: number | { value?: string | number } | null
      shipping_total?: number | { value?: string | number } | null
      total?: number | { value?: string | number } | null
      items?: Array<{
        title?: string | null
        quantity?: number | null
        unit_price?: number | { value?: string | number } | null
        thumbnail?: string | null
      }> | null
      shipping_address?: {
        first_name?: string | null
      } | null
    }
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

    const isPaid = detectIsPaid(
      metadata,
      (order as { payment_status?: unknown }).payment_status,
    )

    const data: OrderShippedEmailData = {
      storefrontUrl: STOREFRONT_URL,
      customerFirstName:
        (order.shipping_address?.first_name as string | null) ?? "",
      displayId: order.display_id ?? order.id,
      deliveryMethod,
      shippingMethodLabel:
        typeof metadata.delivery_method === "string"
          ? metadata.delivery_method
          : null,
      deliveryDate,
      trackingNumber,
      isPaid,
      items: (order.items ?? [])
        .filter((item): item is NonNullable<typeof item> => item != null)
        .map((item) => ({
          title: (item.title as string) ?? "Item",
          quantity: num(item.quantity) || 1,
          unit_price: num(item.unit_price),
          thumbnail: (item.thumbnail as string | null) ?? null,
        })),
      // Medusa v2 BigNumber objects coerce to the numeric value via
      // valueOf(), which Number() invokes. The custom num() helper falls
      // through to 0 because BigNumber doesn't have a top-level `value`
      // property — only loyalty-award.ts's direct Number() cast works.
      subtotal: Number(order.subtotal ?? 0),
      shippingTotal: Number(order.shipping_total ?? 0),
      total: Number(order.total ?? 0),
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
