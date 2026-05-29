import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { computeDeposit } from "../lib/preorder-deposit"

const ADMIN_URL =
  process.env.ADMIN_URL ?? "https://api.dollupboutique.com/app"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function formatMUR(value: number): string {
  return `Rs ${Math.round(value).toLocaleString("en-MU")}`
}

function normalizeDeliveryMethod(raw: unknown): string {
  if (typeof raw !== "string") return "—"
  const s = raw.trim().toLowerCase()
  if (!s) return "—"
  if (s === "pick up" || s === "pickup") return "Pickup"
  if (s === "home delivery" || s === "home_delivery") return "Home delivery"
  if (s.includes("rodrigues")) return "Rodrigues postage"
  if (s.includes("express")) return "Express postage"
  if (s.includes("post")) return "Standard postage"
  return raw.trim()
}

export default async function telegramOnOrderPlaced({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) return

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    // Dormant until configured. Don't spam logs on every order.
    return
  }

  try {
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
      subtotal?: number | { value?: string | number } | null
      shipping_total?: number | { value?: string | number } | null
      total?: number | { value?: string | number } | null
      metadata?: Record<string, unknown> | null
      items?: Array<{
        title?: string | null
        quantity?: number | null
        unit_price?: number | { value?: string | number } | null
      }> | null
      shipping_address?: {
        first_name?: string | null
        last_name?: string | null
        address_1?: string | null
        city?: string | null
        phone?: string | null
      } | null
    }
    if (!order) {
      logger.warn(`[telegram] order.placed: no order for ${orderId}`)
      return
    }

    const metadata = (order.metadata ?? {}) as Record<string, unknown>
    const addr = order.shipping_address ?? {}
    const customer =
      [addr.first_name, addr.last_name].filter(Boolean).join(" ").trim() ||
      order.email ||
      "Guest"
    const items = (order.items ?? []).filter(Boolean)
    const itemCount = items.reduce(
      (sum, item) => sum + (Number(item?.quantity ?? 0) || 0),
      0,
    )

    const subtotal = Number(order.subtotal ?? 0)
    const shipping = Number(order.shipping_total ?? 0)
    const total = Number(order.total ?? 0)

    // Pre-order branch: a deposit-model order reads very differently from a
    // COD order. The stamp subscriber (preorder-stamp-on-order-placed) also
    // fires on order.placed and writes deposit_amount onto metadata, but
    // subscriber ordering is not guaranteed — so fall back to recomputing the
    // deposit inline if it hasn't landed yet.
    if (metadata.cart_type === "preorder") {
      const deposit =
        metadata.deposit_amount != null
          ? Number(metadata.deposit_amount)
          : computeDeposit(subtotal, shipping).deposit
      const balance =
        metadata.balance_amount != null
          ? Number(metadata.balance_amount)
          : Math.max(0, total - deposit)
      const preorderLines: string[] = []
      preorderLines.push(
        `🟣 <b>NEW PRE-ORDER #${order.display_id ?? order.id}</b>`,
      )
      preorderLines.push("")
      preorderLines.push(`👤 ${escapeHtml(customer)}`)
      if (order.email) preorderLines.push(`✉️ ${escapeHtml(order.email)}`)
      if (addr.phone) preorderLines.push(`📞 ${escapeHtml(addr.phone)}`)
      const preLocation = [
        normalizeDeliveryMethod(metadata.delivery_method),
        addr.city,
      ].filter(Boolean) as string[]
      if (preLocation.length) {
        preorderLines.push(`📍 ${escapeHtml(preLocation.join(" — "))}`)
      }
      preorderLines.push("")
      preorderLines.push(`💰 Total: ${formatMUR(total)}`)
      preorderLines.push(`🔸 Deposit due now (75%): <b>${formatMUR(deposit)}</b>`)
      preorderLines.push(`🔹 Balance on arrival: ${formatMUR(balance)}`)
      preorderLines.push(`⏳ Deposit deadline: 24h`)
      preorderLines.push("")
      preorderLines.push(
        `🔗 <a href="${ADMIN_URL}/orders/${order.id}">Open in admin</a>`,
      )
      const preBody = {
        chat_id: chatId,
        text: preorderLines.join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }
      const preRes = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(preBody),
        },
      )
      if (!preRes.ok) {
        const text = await preRes.text().catch(() => "")
        logger.error(
          `[telegram] preorder order.placed → HTTP ${preRes.status} for ${orderId}: ${text}`,
        )
        return
      }
      logger.info(`[telegram] preorder order.placed → sent (order ${orderId})`)
      return
    }

    const lines: string[] = []
    lines.push(`🛍️ <b>NEW ORDER #${order.display_id ?? order.id}</b>`)
    lines.push("")
    lines.push(`👤 ${escapeHtml(customer)}`)
    if (order.email) lines.push(`✉️ ${escapeHtml(order.email)}`)
    if (addr.phone) lines.push(`📞 ${escapeHtml(addr.phone)}`)
    const locationBits = [
      normalizeDeliveryMethod(metadata.delivery_method),
      addr.city,
    ].filter(Boolean) as string[]
    if (locationBits.length) {
      lines.push(`📍 ${escapeHtml(locationBits.join(" — "))}`)
    }
    if (typeof metadata.delivery_date === "string" && metadata.delivery_date) {
      lines.push(`📅 ${escapeHtml(metadata.delivery_date)}`)
    }
    lines.push("")
    lines.push(`🧾 <b>Items (${itemCount})</b>`)
    for (const item of items) {
      const title = (item?.title as string) ?? "Item"
      const qty = Number(item?.quantity ?? 0) || 1
      const price = Number(item?.unit_price ?? 0)
      lines.push(`• ${escapeHtml(title)} × ${qty} — ${formatMUR(price * qty)}`)
    }
    lines.push("")
    lines.push(`Subtotal:  ${formatMUR(subtotal)}`)
    lines.push(`Shipping:  ${formatMUR(shipping)}`)
    lines.push(`💰 <b>TOTAL: ${formatMUR(total)}</b>`)
    lines.push("")
    lines.push(
      `🔗 <a href="${ADMIN_URL}/orders/${order.id}">Open in admin</a>`,
    )

    const body = {
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      logger.error(
        `[telegram] order.placed → HTTP ${res.status} for ${orderId}: ${text}`,
      )
      return
    }
    logger.info(`[telegram] order.placed → sent (order ${orderId})`)
  } catch (err) {
    logger.error(
      `[telegram] order.placed failed for ${orderId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: {
    subscriberId: "telegram-on-order-placed",
  },
}
