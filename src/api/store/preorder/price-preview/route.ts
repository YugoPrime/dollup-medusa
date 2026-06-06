import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

/**
 * GET /store/preorder/price-preview?usd=22.5
 * Public simulator: USD -> all-in MUR estimate (live settings, NOT a binding
 * quote). No auth, no PII. Clamped to the same bound as the bookmarklet.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const raw = (req.query?.usd ?? "") as string
  const usd = Number(raw)
  if (!Number.isFinite(usd) || usd <= 0 || usd > 10000) {
    res.status(400).json({ message: "usd must be a number in (0, 10000]" })
    return
  }
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  try {
    const preview = await svc.previewPrice({ sheinPriceUsd: usd })
    res.json({
      finalPriceMur: preview.finalPriceMur,
      fxRateUsed: preview.fxRateUsed,
      breakdown: preview,
    })
  } catch (err) {
    const e = err as Error & { type?: string }
    // MedusaError (bad input) -> 400; anything else (DB/infra) -> 500.
    const status = e?.type ? 400 : 500
    res.status(status).json({ message: e?.message ?? "failed" })
  }
}
