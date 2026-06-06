import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../../modules/preorder/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const token = req.headers["x-preorder-bookmarklet-token"]
  const t = Array.isArray(token) ? token[0] : token
  if (!t || typeof t !== "string" || !(await svc.verifyBookmarkletToken(t)).valid) {
    res.status(401).json({ message: "unauthorized" })
    return
  }
  const body = (req.body ?? {}) as { outcome?: string } & Record<string, unknown>
  if (body.outcome !== "quoted" && body.outcome !== "failed" && body.outcome !== "needs_manual") {
    res.status(400).json({ message: "outcome must be quoted|failed|needs_manual" })
    return
  }
  await svc.recordScrapeResult(req.params.id, body as any)
  res.json({ ok: true })
}
