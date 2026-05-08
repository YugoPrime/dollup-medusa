import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { scrapeUrl } from "../../../../lib/sourcing/og-scrape"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { url?: unknown }
  const url = String(body.url ?? "")
  if (!url) {
    return res.json({ ok: false, reason: "invalid_url" })
  }
  const result = await scrapeUrl(url)
  res.json(result)
}
