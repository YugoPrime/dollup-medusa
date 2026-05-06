import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORE_CONFIG_MODULE } from "../../../../modules/store-config"
import type StoreConfigModuleService from "../../../../modules/store-config/service"
import type { UpdateShippingSettingsInput } from "../../../../modules/store-config/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)
  const settings = await service.getShippingSettings()

  res.json({ settings })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const input: UpdateShippingSettingsInput = {
    free_shipping_threshold_mur: parseOptionalInt(
      body.free_shipping_threshold_mur,
    ),
    return_fee_mur: parseOptionalInt(body.return_fee_mur),
    preorder_eta_copy:
      body.preorder_eta_copy === undefined
        ? undefined
        : String(body.preorder_eta_copy).trim(),
  }

  for (
    const key of Object.keys(input) as (keyof UpdateShippingSettingsInput)[]
  ) {
    if (input[key] === undefined) {
      delete input[key]
    }
  }

  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)

  try {
    const settings = await service.updateShippingSettingsConfig(input)
    res.json({ settings })
  } catch (err) {
    res.status(400).json({
      message:
        (err as Error)?.message ?? "Failed to update shipping settings",
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
