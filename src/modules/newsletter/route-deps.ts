import { MedusaError, Modules } from "@medusajs/framework/utils"

import { loadCatalogueProducts } from "./catalogue-source"
import {
  createNewsletterResend,
  getNewsletterConfig,
  type NewsletterResend,
} from "./newsletter-resend"
import { renderCatalogueEmail } from "./render-catalogue"
import type { CampaignDeps } from "./send-campaign"
import { NEWSLETTER_MODULE } from "./index"
import { NEWSLETTER_LISTS, type NewsletterList, type SubscriberDTO } from "./types"

type Scope = { resolve(key: any): any }
type LoggerLike = {
  info?: (msg: string) => void
  error: (msg: string, meta?: unknown) => void
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
      logger?.error(`newsletter route failed: ${errorBody(err).message}`, {
        stack: err instanceof Error ? err.stack : undefined,
      })
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

/** Needs Resend config: throws when it is missing. Only preview/test/send use it. */
export function buildCampaignDeps(scope: Scope): CampaignDeps {
  const config = getNewsletterConfig()
  return {
    // The real service's JSON columns are typed loosely; CampaignDeps narrows them.
    service: scope.resolve(NEWSLETTER_MODULE) as unknown as CampaignDeps["service"],
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
  getResend: (list: NewsletterList) => { resend: NewsletterResend; segmentId: string }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Background Resend sync of freshly imported rows. Sequential (Resend allows 10 req/s).
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
      logger.error(`newsletter import: could not record sync error: ${messageOf(e)}`)
    }
  }
  try {
    let target: { resend: NewsletterResend; segmentId: string }
    try {
      target = deps.getResend(list)
    } catch (e) {
      for (const row of rows) await record(row, messageOf(e))
      logger.info?.(`newsletter import (${list}): synced 0, failed ${failed}`)
      return { synced, failed }
    }
    for (const row of rows) {
      try {
        const r = await target.resend.ensureContact(
          row.email,
          target.segmentId,
          row.status === "unsubscribed",
        )
        if (r.ok) {
          await deps.service.markSynced(row.id, r.contactId)
          synced++
        } else {
          await record(row, r.error)
        }
      } catch (e) {
        await record(row, messageOf(e))
      }
    }
    logger.info?.(`newsletter import (${list}): synced ${synced}, failed ${failed}`)
  } catch (e) {
    try {
      logger.error(`newsletter import sync crashed: ${messageOf(e)}`)
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
