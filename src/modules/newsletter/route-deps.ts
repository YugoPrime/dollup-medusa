import { MedusaError, Modules } from "@medusajs/framework/utils"

import { loadCatalogueProducts } from "./catalogue-source"
import {
  createNewsletterResend,
  getNewsletterConfig,
  type NewsletterResend,
} from "./newsletter-resend"
import { renderCatalogueEmail } from "./render-catalogue"
import type { CampaignDeps } from "./send-campaign"
import type NewsletterModuleService from "./service"
import { MAX_PRODUCTS, toPickerRow, type CatalogueProduct, type PickerRow } from "./lib/catalogue"
import { NEWSLETTER_MODULE } from "./index"
import { NEWSLETTER_LISTS, type NewsletterList, type SubscriberDTO } from "./types"

type Scope = { resolve(key: any): any }
type LoggerLike = {
  info?: (msg: string) => void
  error: (msg: string) => void
}

export function httpStatusFor(err: unknown): number {
  if (err instanceof MedusaError) {
    switch (err.type) {
      case MedusaError.Types.INVALID_DATA:
        return 400
      case MedusaError.Types.CONFLICT:
        return 409
      case MedusaError.Types.NOT_FOUND:
        return 404
    }
  }
  return 500
}

export function errorBody(err: unknown): { message: string } {
  if (err instanceof Error && err.message) return { message: err.message }
  if (typeof err === "string" && err) return { message: err }
  return { message: "Unexpected error" }
}

/**
 * Responds with the error itself. Newsletter routes never rethrow into Medusa's core
 * error handler, which rewrites CONFLICT messages and hides plain Error messages.
 */
export function sendError(
  res: { status(code: number): { json(body: unknown): unknown } },
  err: unknown,
  logger?: LoggerLike,
): void {
  const status = httpStatusFor(err)
  if (status === 500) {
    try {
      // One string: Medusa's logger treats an object 2nd arg as the error and drops the message.
      const stack = err instanceof Error ? err.stack : undefined
      logger?.error(`[newsletter] route failed: ${errorBody(err).message}
${stack ?? ""}`)
    } catch {
      // logging is best-effort
    }
  }
  res.status(status).json(errorBody(err))
}

/** Lazily resolves the locking module so routes that never lock don't need it. */
export function makeWithLock(scope: Scope): CampaignDeps["withLock"] {
  return (key, fn) =>
    (scope.resolve(Modules.LOCKING) as {
      execute: <T>(k: string, f: () => Promise<T>, o: { timeout: number }) => Promise<T>
    }).execute(key, fn, { timeout: 10 })
}

export type CampaignService = CampaignDeps["service"] & {
  deleteNewsletterCampaigns: (id: string) => Promise<void>
}

/** The one place the real service is cast to the narrowed structural type. */
export function newsletterService(scope: Scope): CampaignService {
  // The real service's JSON columns are typed loosely; CampaignDeps narrows them.
  return scope.resolve(NEWSLETTER_MODULE) as unknown as CampaignService
}

/** Needs Resend config: throws when it is missing. Only preview/test/send use it. */
export function buildCampaignDeps(scope: Scope): CampaignDeps {
  const config = getNewsletterConfig()
  return {
    service: newsletterService(scope),
    resend: createNewsletterResend(config),
    config,
    loadProducts: (ids) => loadCatalogueProducts(scope, ids),
    render: renderCatalogueEmail,
    withLock: makeWithLock(scope),
  }
}

export type ImportSyncDeps = {
  service: {
    markSynced(id: string, contactId: string | null): Promise<unknown>
    markSyncError(id: string, message: string): Promise<unknown>
  }
  /** Throws when Resend config is missing. `segmentId()` throws when the list's segment is unset. */
  getResend: (list: NewsletterList) => { resend: NewsletterResend; segmentId: () => string }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Background Resend sync of imported rows. Sequential (Resend allows 10 req/s).
 * Unsubscribed rows (new or flipped) only get setUnsubscribed, never ensureContact, so no
 * contact is created for someone who opted out. Subscribed rows get ensureContact(.., false).
 * Never throws: failures are recorded per row with markSyncError.
 */
export async function syncImportedRows(
  deps: ImportSyncDeps,
  list: NewsletterList,
  rows: SubscriberDTO[],
  logger: LoggerLike,
): Promise<{ synced: number; failed: number }> {
  let synced = 0
  let failed = 0
  const record = async (row: SubscriberDTO, message: string) => {
    failed++
    try {
      await deps.service.markSyncError(row.id, message)
    } catch (e) {
      logger.error(`[newsletter] import: could not record sync error: ${messageOf(e)}`)
    }
  }
  try {
    let target: { resend: NewsletterResend; segmentId: () => string }
    try {
      target = deps.getResend(list)
    } catch (e) {
      for (const row of rows) await record(row, messageOf(e))
      logger.info?.(`[newsletter] import (${list}): synced 0, failed ${failed}`)
      return { synced, failed }
    }
    let segmentId: string | null = null
    let segmentError: string | null = null
    try {
      segmentId = target.segmentId()
    } catch (e) {
      segmentError = messageOf(e)
    }
    for (const row of rows) {
      try {
        if (row.status === "unsubscribed") {
          await target.resend.setUnsubscribed(row.email)
          await deps.service.markSynced(row.id, null)
          synced++
        } else if (segmentId === null) {
          await record(row, segmentError ?? "segment is not set")
        } else {
          const r = await target.resend.ensureContact(row.email, segmentId, false)
          if (r.ok) {
            await deps.service.markSynced(row.id, r.contactId)
            synced++
          } else {
            await record(row, r.error)
          }
        }
      } catch (e) {
        await record(row, messageOf(e))
      }
    }
    logger.info?.(`[newsletter] import (${list}): synced ${synced}, failed ${failed}`)
  } catch (e) {
    try {
      logger.error(`[newsletter] import sync crashed: ${messageOf(e)}`)
    } catch {
      // best-effort
    }
  }
  return { synced, failed }
}

export function parseList(raw: unknown): NewsletterList {
  if (typeof raw !== "string" || !NEWSLETTER_LISTS.includes(raw as NewsletterList)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "list must be main or after_dark")
  }
  return raw as NewsletterList
}

/** Banner file name: sanitised base name, extension forced from the content type. */
export function bannerFilename(filename: string, contentType: "image/jpeg" | "image/png"): string {
  const base = filename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
  return `${base || "banner"}${contentType === "image/png" ? ".png" : ".jpg"}`
}

/** True when the buffer starts with the JPEG (FF D8 FF) or PNG (89 50 4E 47) signature. */
export function hasImageMagic(buf: Buffer, contentType: "image/jpeg" | "image/png"): boolean {
  const sig = contentType === "image/png" ? [0x89, 0x50, 0x4e, 0x47] : [0xff, 0xd8, 0xff]
  return buf.length >= sig.length && sig.every((b, i) => buf[i] === b)
}

/** `?ids=a,b,c` to a trimmed, de-duplicated list (max 24). */
export function parseIdsParam(raw: string): string[] {
  const ids = [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))]
  if (ids.length > MAX_PRODUCTS) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `at most ${MAX_PRODUCTS} product ids are allowed`,
    )
  }
  return ids
}

/** Picker rows for exactly `ids`, in that order, missing products omitted. No list filtering. */
export function pickerRowsInOrder(ids: string[], products: CatalogueProduct[]): PickerRow[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  return ids.flatMap((id) => {
    const p = byId.get(id)
    return p ? [toPickerRow(p)] : []
  })
}
