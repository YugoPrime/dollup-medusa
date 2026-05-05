import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type {
  UpdateLoyaltySettingsInput,
} from "../../../../modules/loyalty/service"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const loyaltyService = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const settings = await loyaltyService.getSettings()

  res.json({ settings })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const input: UpdateLoyaltySettingsInput = {
    earn_rate_per_100_mur: parseOptionalInt(body.earn_rate_per_100_mur),
    redeem_rate_mur_per_100_pts: parseOptionalInt(
      body.redeem_rate_mur_per_100_pts,
    ),
    min_redeem_points: parseOptionalInt(body.min_redeem_points),
    welcome_bonus_points: parseOptionalInt(body.welcome_bonus_points),
    points_expiry_months:
      body.points_expiry_months === null || body.points_expiry_months === ""
        ? null
        : parseOptionalInt(body.points_expiry_months),
  }

  for (const key of Object.keys(input) as (keyof UpdateLoyaltySettingsInput)[]) {
    if (input[key] === undefined) {
      delete input[key]
    }
  }

  const loyaltyService = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)

  try {
    const settings = await loyaltyService.updateSettings(input)
    res.json({ settings })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to update loyalty settings",
    })
  }
}

function parseOptionalInt(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : Number.NaN
}
