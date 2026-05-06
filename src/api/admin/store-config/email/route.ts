import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORE_CONFIG_MODULE } from "../../../../modules/store-config"
import type StoreConfigModuleService from "../../../../modules/store-config/service"
import type { UpdateEmailSettingsInput } from "../../../../modules/store-config/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)
  const settings = await service.getEmailSettings()

  res.json({ settings })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const input: UpdateEmailSettingsInput = {
    enabled_order_placed: parseOptionalBool(body.enabled_order_placed),
    enabled_order_shipped: parseOptionalBool(body.enabled_order_shipped),
    enabled_welcome: parseOptionalBool(body.enabled_welcome),
    enabled_password_reset: parseOptionalBool(body.enabled_password_reset),
    enabled_order_delivered: parseOptionalBool(body.enabled_order_delivered),
  }

  for (const key of Object.keys(input) as (keyof UpdateEmailSettingsInput)[]) {
    if (input[key] === undefined) {
      delete input[key]
    }
  }

  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)

  try {
    const settings = await service.updateEmailSettingsConfig(input)
    res.json({ settings })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to update email settings",
    })
  }
}

function parseOptionalBool(value: unknown) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === "boolean") {
    return value
  }
  if (value === "true" || value === "1" || value === 1) {
    return true
  }
  if (value === "false" || value === "0" || value === 0) {
    return false
  }
  return Boolean(value)
}
