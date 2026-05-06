import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORE_CONFIG_MODULE } from "../../../../modules/store-config"
import type StoreConfigModuleService from "../../../../modules/store-config/service"
import type {
  StoreSettingsDTO,
  UpdateStoreSettingsInput,
} from "../../../../modules/store-config/service"

const FIELDS: Array<keyof Omit<StoreSettingsDTO, "id">> = [
  "contact_phone",
  "contact_email",
  "contact_hours",
  "instagram_url",
  "facebook_url",
  "tiktok_url",
  "whatsapp_url",
  "footer_copyright",
]

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)
  const settings = await service.getStoreSettings()

  res.json({ settings })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const input: UpdateStoreSettingsInput = {}

  for (const field of FIELDS) {
    if (body[field] !== undefined) {
      input[field] = String(body[field]).trim()
    }
  }

  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)

  try {
    const settings = await service.updateStoreSettingsConfig(input)
    res.json({ settings })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to update store settings",
    })
  }
}
