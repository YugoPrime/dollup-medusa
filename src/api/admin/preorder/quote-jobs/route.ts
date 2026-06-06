import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

async function tokenValid(req: MedusaRequest, svc: PreorderModuleService): Promise<boolean> {
  const token = req.headers["x-preorder-bookmarklet-token"]
  const t = Array.isArray(token) ? token[0] : token
  if (!t || typeof t !== "string") return false
  return (await svc.verifyBookmarkletToken(t)).valid
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  if (!(await tokenValid(req, svc))) {
    res.status(401).json({ message: "unauthorized" })
    return
  }
  const status = (req.query?.status as string) ?? "pending"
  const limit = Number(req.query?.limit ?? 5)
  const jobs = await svc.listQuoteJobs({ status, limit })
  res.json({ jobs })
}
