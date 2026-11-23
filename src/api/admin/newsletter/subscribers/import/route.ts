import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { NEWSLETTER_MODULE } from "../../../../../modules/newsletter"
import { parseContactsCsv } from "../../../../../modules/newsletter/lib/csv"
import {
  createNewsletterResend,
  getNewsletterConfig,
  requireSegment,
} from "../../../../../modules/newsletter/newsletter-resend"
import {
  parseList,
  sendError,
  syncImportedRows,
} from "../../../../../modules/newsletter/route-deps"
import type NewsletterModuleService from "../../../../../modules/newsletter/service"

const MAX_CSV_CHARS = 1_000_000

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve("logger") as any
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const list = parseList(body.list)
    const csv = body.csv
    if (typeof csv !== "string" || csv.length === 0 || csv.length > MAX_CSV_CHARS) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "csv must be a non-empty string of at most 1,000,000 characters",
      )
    }
    let parsed: ReturnType<typeof parseContactsCsv>
    try {
      parsed = parseContactsCsv(csv)
    } catch (e) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, (e as Error).message)
    }

    const service = req.scope.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
    const { added, skipped, unsubscribed } = await service.importSubscribers(list, parsed.rows)

    res.json({
      added: added.length,
      skipped,
      invalid: parsed.invalid,
      sync_pending: added.length + unsubscribed.length,
    })

    // Not awaited: syncing thousands of rows at 10 requests/second outlasts the request.
    if (added.length + unsubscribed.length > 0) {
      void syncImportedRows(
        {
          service,
          getResend: (l) => {
            const config = getNewsletterConfig()
            return {
              segmentId: () => requireSegment(config, l),
              resend: createNewsletterResend(config),
            }
          },
        },
        list,
        [...added, ...unsubscribed],
        logger,
      ).catch((e) => {
        try {
          logger.error(`[newsletter] import sync crashed: ${(e as Error).message}`)
        } catch {
          // best-effort
        }
      })
    }
  } catch (err) {
    sendError(res, err, logger)
  }
}
