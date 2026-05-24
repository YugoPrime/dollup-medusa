import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"
import type { UpdatePreorderSettingsInput } from "../../../../modules/preorder/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const settings = await svc.getSettings()
  res.json({ settings })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const input: UpdatePreorderSettingsInput = {}

  const KEYS = [
    "fx_rate_usd_to_mur",
    "customs_percent",
    "handling_tier_1_max",
    "handling_tier_1_fee",
    "handling_tier_2_max",
    "handling_tier_2_fee",
    "handling_tier_3_max",
    "handling_tier_3_fee",
    "handling_tier_4_flat",
    "handling_tier_4_percent",
    "round_to_mur",
    "eta_min_days",
    "eta_max_days",
    "deposit_percent",
    "submissions_per_ip_per_hour",
    "submissions_per_day_total",
  ] as const

  for (const key of KEYS) {
    const raw = body[key]
    if (raw === undefined) continue
    const num = typeof raw === "number" ? raw : Number(raw)
    if (!Number.isFinite(num)) {
      res.status(400).json({ message: `${key} must be a number` })
      return
    }
    input[key] = num
  }

  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  try {
    const settings = await svc.updateSettings(input)
    res.json({ settings })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to update preorder settings",
    })
  }
}
