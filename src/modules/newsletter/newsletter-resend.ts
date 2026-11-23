import { MedusaError } from "@medusajs/framework/utils"
import { Resend } from "resend"
import { normalizeEmail } from "./lib/email"
import type { NewsletterList } from "./types"

export type NewsletterConfig = {
  apiKey: string
  from: string
  replyTo: string
  segments: Record<NewsletterList, string | null>
  storefrontUrl: string
}

export function getNewsletterConfig(env: NodeJS.ProcessEnv = process.env): NewsletterConfig {
  const apiKey = env.RESEND_NEWSLETTER_API_KEY || env.RESEND_API_KEY
  const fromEmail = env.RESEND_FROM_EMAIL
  const missing: string[] = []
  if (!apiKey) missing.push("RESEND_NEWSLETTER_API_KEY (or RESEND_API_KEY)")
  if (!fromEmail) missing.push("RESEND_FROM_EMAIL")
  if (missing.length > 0 || !apiKey || !fromEmail) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Missing env: ${missing.join(", ")}`)
  }
  return {
    apiKey,
    from: `${env.RESEND_FROM_NAME || "Doll Up Team"} <${fromEmail}>`,
    replyTo: env.RESEND_REPLY_TO || fromEmail,
    segments: {
      main: env.RESEND_NEWSLETTER_SEGMENT_MAIN || null,
      after_dark: env.RESEND_NEWSLETTER_SEGMENT_AFTER_DARK || null,
    },
    storefrontUrl: env.STOREFRONT_URL || "https://dollupboutique.com",
  }
}

export function requireSegment(config: NewsletterConfig, list: NewsletterList): string {
  const id = config.segments[list]
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `RESEND_NEWSLETTER_SEGMENT_${list.toUpperCase()} is not set`
    )
  }
  return id
}

type ResendError = { statusCode: number | null; name: string; message: string }
type Result<T> = { data: T | null; error: ResendError | null }

/** Minimal structural subset of the Resend SDK that this file uses. */
export interface ResendLike {
  contacts: {
    create(p: { email: string; unsubscribed?: boolean; segments?: { id: string }[] }): Promise<Result<{ id: string }>>
    get(p: { email: string }): Promise<Result<{ id: string; email: string; unsubscribed: boolean }>>
    list(p: { segmentId?: string; limit?: number; after?: string }): Promise<
      Result<{ data: { id: string; email: string; unsubscribed: boolean }[]; has_more: boolean }>
    >
    update(p: { email: string; unsubscribed?: boolean }): Promise<Result<{ id: string }>>
    segments: {
      add(p: { email: string; segmentId: string }): Promise<Result<unknown>>
    }
  }
  broadcasts: {
    // Taken from the SDK: its payload is a react-or-html union a hand-written subset can't satisfy.
    create(p: Parameters<Resend["broadcasts"]["create"]>[0]): Promise<Result<{ id: string }>>
  }
  emails: {
    send(p: { from: string; to: string[]; subject: string; html: string; replyTo?: string }): Promise<Result<{ id: string }>>
  }
}

export interface NewsletterResend {
  ensureContact(
    email: string,
    segmentId: string,
    unsubscribed: boolean
  ): Promise<{ ok: true; contactId: string | null } | { ok: false; error: string }>
  listUnsubscribedEmails(segmentId: string): Promise<string[]>
  setUnsubscribed(email: string): Promise<void>
  resubscribe(email: string, segmentId: string): Promise<void>
  createAndSendBroadcast(i: {
    segmentId: string
    subject: string
    html: string
    name: string
    previewText?: string | null
  }): Promise<{ id: string }>
  sendTest(i: { to: string; subject: string; html: string }): Promise<void>
}

const MAX_RETRIES = 3
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const isNotFound = (e: ResendError | null) => !!e && (e.statusCode === 404 || e.name === "not_found")
// Only the per-second limit is worth retrying; daily/monthly quota 429s will not clear in seconds.
const isRateLimited = (e: ResendError | null) =>
  !!e && (e.name === "rate_limit_exceeded" || (e.statusCode === 429 && !e.name))
const isAlreadyExists = (e: ResendError | null) =>
  !!e && (e.statusCode === 409 || /already exist/i.test(e.message))

export function createNewsletterResend(
  config: NewsletterConfig,
  client?: ResendLike,
  options: { sleep?: (ms: number) => Promise<void> } = {}
): NewsletterResend {
  const resend: ResendLike = client ?? new Resend(config.apiKey)
  const sleep = options.sleep ?? defaultSleep

  // Resend allows 10 req/s per team: retry 429s with a growing pause.
  async function withRetry<T extends { error: ResendError | null }>(fn: () => Promise<T>): Promise<T> {
    let result = await fn()
    for (let attempt = 1; attempt <= MAX_RETRIES && isRateLimited(result.error); attempt++) {
      await sleep(1000 * attempt)
      result = await fn()
    }
    return result
  }

  // Adding a contact to a segment it is already in is a success.
  async function addToSegment(email: string, segmentId: string) {
    const added = await withRetry(() => resend.contacts.segments.add({ email, segmentId }))
    if (added.error && !(added.error.statusCode === 409 || /already/i.test(added.error.message))) {
      return { ok: false as const, error: added.error.message }
    }
    return { ok: true as const }
  }

  async function ensureContactUnsafe(
    email: string,
    segmentId: string,
    unsubscribed: boolean
  ): Promise<{ ok: true; contactId: string | null } | { ok: false; error: string }> {
    const existing = await withRetry(() => resend.contacts.get({ email }))
    if (existing.data && !existing.error) {
      // Existing contact: never touch its unsubscribed flag.
      const added = await addToSegment(email, segmentId)
      if (!added.ok) return added
      return { ok: true as const, contactId: existing.data.id }
    }
    if (!isNotFound(existing.error)) {
      return { ok: false as const, error: existing.error?.message ?? "Unknown Resend error" }
    }

    const created = await withRetry(() =>
      resend.contacts.create({
        email,
        segments: [{ id: segmentId }],
        ...(unsubscribed ? { unsubscribed: true } : {}),
      })
    )
    if (created.data && !created.error) return { ok: true as const, contactId: created.data.id }
    if (isAlreadyExists(created.error)) {
      const added = await addToSegment(email, segmentId)
      if (!added.ok) return added
      return { ok: true as const, contactId: null }
    }
    return { ok: false as const, error: created.error?.message ?? "Unknown Resend error" }
  }

  // Never throws: SDK exceptions (network etc.) become { ok: false }.
  async function ensureContact(email: string, segmentId: string, unsubscribed: boolean) {
    try {
      return await ensureContactUnsafe(email, segmentId, unsubscribed)
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return {
    ensureContact,

    async listUnsubscribedEmails(segmentId) {
      const out: string[] = []
      let after: string | undefined
      for (;;) {
        const res = await withRetry(() =>
          resend.contacts.list({ segmentId, limit: 100, ...(after ? { after } : {}) })
        )
        if (res.error || !res.data) throw new Error(res.error?.message ?? "Resend contacts.list failed")
        for (const c of res.data.data) {
          if (!c.unsubscribed) continue
          const email = normalizeEmail(c.email)
          if (email) out.push(email)
        }
        const last = res.data.data[res.data.data.length - 1]
        if (!res.data.has_more || !last) break
        after = last.id
      }
      return out
    },

    async setUnsubscribed(email) {
      const res = await withRetry(() => resend.contacts.update({ email, unsubscribed: true }))
      if (res.error && !isNotFound(res.error)) throw new Error(res.error.message)
    },

    // The ONLY path that writes unsubscribed: false (explicit admin re-add).
    async resubscribe(email, segmentId) {
      const res = await withRetry(() => resend.contacts.update({ email, unsubscribed: false }))
      // A 404 means the contact was never in Resend: ensureContact creates it subscribed.
      if (res.error && !isNotFound(res.error)) throw new Error(res.error.message)
      const ensured = await ensureContact(email, segmentId, false)
      if (!ensured.ok) throw new Error(ensured.error)
    },

    async createAndSendBroadcast({ segmentId, subject, html, name, previewText }) {
      const res = await withRetry(() =>
        resend.broadcasts.create({
          segmentId,
          from: config.from,
          replyTo: config.replyTo,
          subject,
          html,
          name,
          ...(previewText ? { previewText } : {}),
          send: true,
        })
      )
      if (res.error || !res.data) throw new Error(res.error?.message ?? "Resend broadcast failed")
      return { id: res.data.id }
    },

    async sendTest({ to, subject, html }) {
      const res = await withRetry(() =>
        resend.emails.send({ from: config.from, to: [to], replyTo: config.replyTo, subject: `[TEST] ${subject}`, html })
      )
      if (res.error) throw new Error(res.error.message)
    },
  }
}
