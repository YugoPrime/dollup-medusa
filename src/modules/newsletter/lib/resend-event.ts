import { normalizeEmail } from "./email"

/** Resend email event types the results panel uses (the "email." prefix is dropped). */
export const STORED_EMAIL_EVENTS = [
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "opened",
  "clicked",
  "failed",
  "suppressed",
] as const
export type EmailEventType = (typeof STORED_EMAIL_EVENTS)[number]

/** Every event type the webhook subscribes to in Resend. */
export const WEBHOOK_EVENTS = [
  ...STORED_EMAIL_EVENTS.map((t) => `email.${t}`),
  "contact.updated",
]

export type ParsedResendEvent =
  | {
      kind: "email"
      type: EmailEventType
      broadcastId: string | null
      emailId: string
      email: string | null
      link: string | null
      bounceType: string | null
      occurredAt: Date
    }
  | { kind: "contact_unsubscribed"; email: string }
  | { kind: "ignored"; reason: string }

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

function date(...candidates: unknown[]): Date {
  for (const c of candidates) {
    const s = str(c)
    if (!s) continue
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

/** Turns a verified Resend webhook body into the shape the handler acts on. */
export function parseResendEvent(body: unknown): ParsedResendEvent {
  if (!body || typeof body !== "object") return { kind: "ignored", reason: "not an object" }
  const b = body as Record<string, unknown>
  const type = str(b.type)
  const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>
  if (!type) return { kind: "ignored", reason: "no type" }

  if (type === "contact.updated") {
    const email = normalizeEmail(str(data.email) ?? "")
    if (data.unsubscribed === true && email) return { kind: "contact_unsubscribed", email }
    return { kind: "ignored", reason: "contact still subscribed" }
  }

  if (!type.startsWith("email.")) return { kind: "ignored", reason: `unhandled ${type}` }
  const short = type.slice("email.".length) as EmailEventType
  if (!(STORED_EMAIL_EVENTS as readonly string[]).includes(short)) {
    return { kind: "ignored", reason: `unhandled ${type}` }
  }
  const emailId = str(data.email_id)
  if (!emailId) return { kind: "ignored", reason: "no email_id" }

  const to = Array.isArray(data.to) ? data.to : []
  const click = (data.click && typeof data.click === "object" ? data.click : {}) as Record<string, unknown>
  const bounce = (data.bounce && typeof data.bounce === "object" ? data.bounce : {}) as Record<string, unknown>

  return {
    kind: "email",
    type: short,
    broadcastId: str(data.broadcast_id),
    emailId,
    email: normalizeEmail(str(to[0]) ?? ""),
    link: short === "clicked" ? str(click.link) : null,
    bounceType: short === "bounced" ? str(bounce.type) : null,
    occurredAt: date(click.timestamp, b.created_at, data.created_at),
  }
}

export type LinkTarget = { kind: "product"; handle: string } | { kind: "other"; label: string }

/** Product links point at /products/<handle>; everything else is grouped by host + path. */
export function classifyLink(link: string, storefrontUrl: string): LinkTarget {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return { kind: "other", label: link.slice(0, 120) }
  }
  const m = url.pathname.match(/^\/products\/([^/]+)\/?$/)
  if (m) {
    try {
      return { kind: "product", handle: decodeURIComponent(m[1]) }
    } catch {
      return { kind: "product", handle: m[1] }
    }
  }
  let storeHost = ""
  try {
    storeHost = new URL(storefrontUrl).host
  } catch {
    // keep the full host in the label
  }
  const path = url.pathname.replace(/\/+$/, "") || "/"
  return { kind: "other", label: url.host === storeHost ? path : `${url.host}${path === "/" ? "" : path}` }
}
