import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import SourcingSettings from "./models/sourcing-settings"

export type SettingsRow = {
  id: string
  fx_rate: number
  landed_multiplier_default: number
  markup_multiplier: number
  round_step: number
}

export type UpdateSettingsInput = {
  fx_rate?: number
  landed_multiplier_default?: number
  markup_multiplier?: number
  round_step?: number
}

const SINGLETON_ID = "default"

class SourcingSettingsService extends MedusaService({
  SourcingSettings,
}) {
  async getSettings(): Promise<SettingsRow> {
    const svc = this as unknown as {
      retrieveSourcingSettings: (id: string) => Promise<unknown>
      createSourcingSettings: (data: Record<string, unknown>) => Promise<unknown>
    }
    try {
      const row = await svc.retrieveSourcingSettings(SINGLETON_ID)
      return this.normalize(row)
    } catch {
      // Singleton missing — create with defaults.
      const row = await svc.createSourcingSettings({ id: SINGLETON_ID })
      return this.normalize(row)
    }
  }

  async updateSettings(input: UpdateSettingsInput): Promise<SettingsRow> {
    await this.getSettings() // ensure exists
    const svc = this as unknown as {
      updateSourcingSettings: (data: Record<string, unknown>) => Promise<unknown>
    }
    const patch: Record<string, unknown> = { id: SINGLETON_ID }
    if (input.fx_rate !== undefined) {
      if (!Number.isFinite(input.fx_rate) || input.fx_rate <= 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "fx_rate must be a finite number > 0",
        )
      }
      patch.fx_rate = input.fx_rate
    }
    if (input.landed_multiplier_default !== undefined) {
      if (
        !Number.isFinite(input.landed_multiplier_default) ||
        input.landed_multiplier_default <= 0
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "landed_multiplier_default must be a finite number > 0",
        )
      }
      patch.landed_multiplier_default = input.landed_multiplier_default
    }
    if (input.markup_multiplier !== undefined) {
      if (
        !Number.isFinite(input.markup_multiplier) ||
        input.markup_multiplier <= 0
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "markup_multiplier must be a finite number > 0",
        )
      }
      patch.markup_multiplier = input.markup_multiplier
    }
    if (input.round_step !== undefined) {
      if (
        !Number.isFinite(input.round_step) ||
        input.round_step <= 0 ||
        !Number.isInteger(input.round_step)
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "round_step must be a positive integer",
        )
      }
      patch.round_step = input.round_step
    }
    await svc.updateSourcingSettings(patch)
    return await this.getSettings()
  }

  private normalize(row: unknown): SettingsRow {
    const r = row as Record<string, unknown>
    return {
      id: String(r.id),
      fx_rate: Number(r.fx_rate),
      landed_multiplier_default: Number(r.landed_multiplier_default),
      markup_multiplier: Number(r.markup_multiplier),
      round_step: Number(r.round_step),
    }
  }
}

export default SourcingSettingsService
