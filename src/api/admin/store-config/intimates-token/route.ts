import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORE_CONFIG_MODULE } from "../../../../modules/store-config"
import type StoreConfigModuleService from "../../../../modules/store-config/service"

// GET returns whether a token is currently set (does NOT leak the value).
// POST { action: "rotate" } generates a new random token and returns it ONCE
// so the admin UI can show it for copy. Subsequent reads only expose existence.
// POST { action: "clear" } wipes the token, locking the catalog for everyone.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)
  const settings = await service.getStoreSettings()
  res.json({
    is_set: Boolean(settings.intimates_unlock_token),
    length: settings.intimates_unlock_token?.length ?? 0,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { action?: unknown }
  const action = typeof body.action === "string" ? body.action : ""
  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)

  try {
    if (action === "rotate") {
      const token = await service.rotateIntimatesUnlockToken()
      res.json({ token, is_set: true })
      return
    }
    if (action === "clear") {
      await service.clearIntimatesUnlockToken()
      res.json({ is_set: false })
      return
    }
    res.status(400).json({
      message: "action must be 'rotate' or 'clear'",
    })
  } catch (err) {
    res.status(400).json({
      message:
        (err as Error)?.message ?? "Failed to update intimates unlock token",
    })
  }
}
