import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SOURCING_SETTINGS_MODULE } from "../../../../modules/sourcing-settings"
import type SourcingSettingsService from "../../../../modules/sourcing-settings/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const service =
      req.scope.resolve<SourcingSettingsService>(SOURCING_SETTINGS_MODULE)
    const settings = await service.getSettings()
    res.json({ settings })
  } catch (err) {
    const e = err as Error
    req.scope
      .resolve<{ error: (msg: string, meta?: unknown) => void }>("logger")
      .error(`GET /admin/sourcing/settings failed: ${e.message}`, {
        stack: e.stack,
      })
    res.status(400).json({ message: e.message ?? "Failed" })
  }
}

export const PUT = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const input: Record<string, number> = {}
    for (const k of [
      "fx_rate",
      "landed_multiplier_default",
      "markup_multiplier",
      "round_step",
    ] as const) {
      if (body[k] !== undefined) input[k] = Number(body[k])
    }
    const service =
      req.scope.resolve<SourcingSettingsService>(SOURCING_SETTINGS_MODULE)
    const settings = await service.updateSettings(input)
    res.json({ settings })
  } catch (err) {
    const e = err as Error
    req.scope
      .resolve<{ error: (msg: string, meta?: unknown) => void }>("logger")
      .error(`PUT /admin/sourcing/settings failed: ${e.message}`, {
        stack: e.stack,
      })
    res.status(400).json({ message: e.message ?? "Failed" })
  }
}
