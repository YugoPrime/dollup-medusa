import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import PreorderSettings from "./models/preorder-settings"
import {
  computePreorderPrice,
  type ComputePreorderPriceInput,
  type ComputePreorderPriceResult,
  type PreorderSettingsLike,
} from "./lib/pricing"

export const PREORDER_SETTINGS_ID = "preorder_settings"

export type PreorderSettingsDTO = PreorderSettingsLike & { id: string }

export type UpdatePreorderSettingsInput = Partial<
  Omit<PreorderSettingsDTO, "id">
>

const NUMERIC_FIELDS: (keyof PreorderSettingsLike)[] = [
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
]

const DEFAULTS: Omit<PreorderSettingsDTO, "id"> = {
  fx_rate_usd_to_mur: 50,
  customs_percent: 25,
  handling_tier_1_max: 500,
  handling_tier_1_fee: 150,
  handling_tier_2_max: 1000,
  handling_tier_2_fee: 300,
  handling_tier_3_max: 2000,
  handling_tier_3_fee: 600,
  handling_tier_4_flat: 1000,
  handling_tier_4_percent: 30,
  round_to_mur: 10,
  eta_min_days: 15,
  eta_max_days: 20,
  deposit_percent: 75,
  submissions_per_ip_per_hour: 5,
  submissions_per_day_total: 50,
}

class PreorderModuleService extends MedusaService({
  PreorderSettings,
}) {
  async getSettings(): Promise<PreorderSettingsDTO> {
    const service = this as unknown as {
      listPreorderSettings: (
        filters: Record<string, unknown>,
      ) => Promise<PreorderSettingsDTO[]>
      createPreorderSettings: (
        input: PreorderSettingsDTO,
      ) => Promise<PreorderSettingsDTO>
    }

    const existing = await service.listPreorderSettings({
      id: PREORDER_SETTINGS_ID,
    })
    if (existing.length > 0) {
      return existing[0]
    }
    return service.createPreorderSettings({
      id: PREORDER_SETTINGS_ID,
      ...DEFAULTS,
    })
  }

  async updateSettings(
    input: UpdatePreorderSettingsInput,
  ): Promise<PreorderSettingsDTO> {
    const current = await this.getSettings()
    const next: Record<string, number> = {}
    for (const key of NUMERIC_FIELDS) {
      if (key in input && input[key] !== undefined) {
        next[key] = input[key] as number
      }
    }

    this.validateSettings({ ...current, ...next })

    const service = this as unknown as {
      updatePreorderSettings: (
        input: Partial<PreorderSettingsDTO> & { id: string },
      ) => Promise<PreorderSettingsDTO>
    }
    return service.updatePreorderSettings({
      id: PREORDER_SETTINGS_ID,
      ...next,
    })
  }

  private validateSettings(merged: PreorderSettingsLike) {
    for (const key of NUMERIC_FIELDS) {
      const value = merged[key]
      if (
        value === undefined ||
        !Number.isFinite(value) ||
        Math.trunc(value) !== value ||
        value < 0
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${key} must be a non-negative integer`,
        )
      }
    }
    if (merged.deposit_percent > 100) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "deposit_percent must be between 0 and 100",
      )
    }
    if (merged.customs_percent > 1000) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "customs_percent unreasonably high (>1000%)",
      )
    }
    if (merged.eta_min_days > merged.eta_max_days) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "eta_min_days must be <= eta_max_days",
      )
    }
    if (merged.fx_rate_usd_to_mur === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "fx_rate_usd_to_mur cannot be zero",
      )
    }
    if (merged.round_to_mur === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "round_to_mur cannot be zero",
      )
    }
  }

  async previewPrice(
    input: ComputePreorderPriceInput,
  ): Promise<ComputePreorderPriceResult & { settingsId: string }> {
    const settings = await this.getSettings()
    const result = computePreorderPrice(input, settings)
    return { ...result, settingsId: settings.id }
  }
}

export default PreorderModuleService
