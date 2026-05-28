import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../modules/preorder/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const info = await svc.getActiveTokenInfo()
  res.json(info)
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { expiresInDays?: number }
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const result = await svc.generateBookmarkletToken({
    expiresInDays: body.expiresInDays,
  })
  // Plaintext returned ONCE here.
  res.json({ token: result.token, expiresAt: result.expiresAt })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  await svc.revokeBookmarkletToken()
  res.json({ revoked: true })
}
