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
  const body = (req.body ?? {}) as { expiresInDays?: unknown }
  let expiresInDays: number | undefined
  if (body.expiresInDays !== undefined) {
    if (
      typeof body.expiresInDays !== "number" ||
      !Number.isFinite(body.expiresInDays) ||
      body.expiresInDays < 0 ||
      body.expiresInDays > 3650
    ) {
      res.status(400).json({
        message:
          "expiresInDays must be a non-negative integer (max 3650 = 10 years)",
      })
      return
    }
    expiresInDays = body.expiresInDays
  }
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const result = await svc.generateBookmarkletToken({ expiresInDays })
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
