import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { scrapeUrl } from "../../../../lib/sourcing/og-scrape"

function logError(
  req: AuthenticatedMedusaRequest,
  context: string,
  err: Error,
): void {
  try {
    const logger = req.scope.resolve<{
      error: (msg: string, meta?: unknown) => void
    }>("logger")
    logger.error(`${context}: ${err.message}`, { stack: err.stack })
  } catch {
    // best-effort
  }
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const body = (req.body ?? {}) as { url?: unknown }
    const url = String(body.url ?? "")
    if (!url) {
      return res.json({ ok: false, reason: "invalid_url" })
    }
    const result = await scrapeUrl(url)
    res.json(result)
  } catch (err) {
    const e = err as Error
    logError(req, "POST /admin/sourcing/scrape", e)
    res
      .status(400)
      .json({ ok: false, reason: e.message ?? "scrape_failed" })
  }
}
