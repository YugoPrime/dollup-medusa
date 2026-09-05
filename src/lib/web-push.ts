// Web Push (VAPID) sender for the installed Doll Up Admin PWA.
// Wraps the `web-push` package so subscribers and routes never see its
// error shapes: every send resolves to a SendResult, and `gone` tells the
// caller to prune the subscription.

import webpush from "web-push"

import { computeDeposit } from "./preorder-deposit"

export type PushPayload = { title: string; body: string; url: string; tag: string }
export type PushTarget = { endpoint: string; p256dh: string; auth: string }
export type SendResult =
  | { ok: true }
  | { ok: false; gone: boolean; status?: number; message: string }

type Logger = {
  info: (m: string) => void
  warn: (m: string) => void
  error: (m: string) => void
}

const DEFAULT_ADMIN_URL = "https://admin.dollupboutique.com"
const PUSH_TTL_SECONDS = 60 * 60 // an hour-old "new order" alert is still useful

export function isWebPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
}

export function getAdminUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.ADMIN_URL ?? "").trim() || DEFAULT_ADMIN_URL
  return raw.replace(/\/+$/, "")
}

let configuredWith: string | null = null

function ensureVapid(env: NodeJS.ProcessEnv): void {
  const key = `${env.VAPID_SUBJECT}|${env.VAPID_PUBLIC_KEY}`
  if (configuredWith === key) return
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
  configuredWith = key
}

export async function sendWebPush(
  logger: Logger,
  target: PushTarget,
  payload: PushPayload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SendResult> {
  if (!isWebPushConfigured(env)) {
    return { ok: false, gone: false, message: "web push not configured (VAPID_* missing)" }
  }
  try {
    ensureVapid(env)
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: PUSH_TTL_SECONDS },
    )
    return { ok: true }
  } catch (err) {
    const e = err as { statusCode?: number; body?: string; message?: string }
    const status = typeof e?.statusCode === "number" ? e.statusCode : undefined
    const gone = status === 404 || status === 410
    const message = e?.message || e?.body || `push failed${status ? ` (HTTP ${status})` : ""}`
    if (!gone) logger.warn(`[web-push] send failed for ${target.endpoint.slice(0, 60)}…: ${message}`)
    return { ok: false, gone, status, message }
  }
}

// ---- order.placed payload ------------------------------------------------

export type OrderForPush = {
  id: string
  display_id?: number | null
  email?: string | null
  subtotal?: unknown
  shipping_total?: unknown
  total?: unknown
  metadata?: Record<string, unknown> | null
  items?: Array<{ quantity?: number | null }> | null
  shipping_address?: { first_name?: string | null; last_name?: string | null } | null
}

function num(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value?: string | number }).value) || 0
  }
  return 0
}

function formatMUR(value: number): string {
  return `Rs ${Math.round(value).toLocaleString("en-MU")}`
}

function deliveryLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === "pick up" || s === "pickup") return "Pickup"
  if (s === "home delivery" || s === "home_delivery") return "Home delivery"
  if (s.includes("rodrigues")) return "Rodrigues postage"
  if (s.includes("express")) return "Express postage"
  if (s.includes("post")) return "Standard postage"
  return raw.trim()
}

export function buildOrderPlacedPayload(order: OrderForPush, adminUrl: string): PushPayload {
  const metadata = (order.metadata ?? {}) as Record<string, unknown>
  const addr = order.shipping_address ?? {}
  const customer =
    [addr.first_name, addr.last_name].filter(Boolean).join(" ").trim() || order.email || "Guest"
  const itemCount = (order.items ?? []).reduce(
    (sum, item) => sum + (Number(item?.quantity ?? 0) || 0),
    0,
  )
  const ref = `#${order.display_id ?? order.id}`
  const subtotal = num(order.subtotal)
  const shipping = num(order.shipping_total)
  const total = num(order.total)

  let title: string
  if (metadata.cart_type === "preorder") {
    const deposit =
      metadata.deposit_amount != null
        ? Number(metadata.deposit_amount)
        : computeDeposit(subtotal, shipping).deposit
    title = `New pre-order ${ref} · deposit ${formatMUR(deposit)}`
  } else {
    title = `New order ${ref} · ${formatMUR(total)}`
  }

  const bits = [customer, `${itemCount} ${itemCount === 1 ? "item" : "items"}`]
  const delivery = deliveryLabel(metadata.delivery_method)
  if (delivery) bits.push(delivery)

  return {
    title,
    body: bits.join(" · "),
    url: `${adminUrl}/orders/${order.id}`,
    tag: `order-${order.id}`,
  }
}
