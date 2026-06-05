import { createHash, randomBytes } from "crypto"

import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import PreorderSettings from "./models/preorder-settings"
import PreorderToken from "./models/preorder-token"
import PreorderQuoteRequest from "./models/preorder-quote-request"
import PreorderQuoteItem from "./models/preorder-quote-item"
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
  PreorderToken,
  PreorderQuoteRequest,
  PreorderQuoteItem,
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

  async generateBookmarkletToken(
    options: { expiresInDays?: number } = {},
  ): Promise<{ token: string; expiresAt: Date | null }> {
    const expiresInDays = options.expiresInDays ?? 90
    const expiresAt =
      expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null

    // Revoke previous active tokens — single-active-token policy.
    const service = this as unknown as {
      listPreorderTokens: (
        filters: Record<string, unknown>,
      ) => Promise<Array<{ id: string }>>
      updatePreorderTokens: (
        input: Record<string, unknown> & { id: string },
      ) => Promise<unknown>
      createPreorderTokens: (
        input: Record<string, unknown>,
      ) => Promise<{ id: string }>
    }
    const previous = await service.listPreorderTokens({
      revoked_at: null,
    })
    for (const row of previous) {
      await service.updatePreorderTokens({
        id: row.id,
        revoked_at: new Date(),
      })
    }

    const plaintext = randomBytes(32).toString("hex")
    const tokenHash = hashToken(plaintext)
    await service.createPreorderTokens({
      token_hash: tokenHash,
      expires_at: expiresAt,
    })

    return { token: plaintext, expiresAt }
  }

  async verifyBookmarkletToken(
    plaintext: string,
  ): Promise<
    | { valid: true; tokenId: string }
    | { valid: false; reason: "unknown" | "revoked" | "expired" }
  > {
    if (!plaintext || typeof plaintext !== "string") {
      return { valid: false, reason: "unknown" }
    }
    const tokenHash = hashToken(plaintext)
    const service = this as unknown as {
      listPreorderTokens: (
        filters: Record<string, unknown>,
      ) => Promise<
        Array<{
          id: string
          revoked_at: Date | null
          expires_at: Date | null
        }>
      >
      updatePreorderTokens: (
        input: Record<string, unknown> & { id: string },
      ) => Promise<unknown>
    }
    const rows = await service.listPreorderTokens({ token_hash: tokenHash })
    if (rows.length === 0) return { valid: false, reason: "unknown" }
    const row = rows[0]
    if (row.revoked_at) return { valid: false, reason: "revoked" }
    if (row.expires_at && row.expires_at < new Date()) {
      return { valid: false, reason: "expired" }
    }
    await service.updatePreorderTokens({
      id: row.id,
      last_used_at: new Date(),
    })
    return { valid: true, tokenId: row.id }
  }

  async revokeBookmarkletToken(): Promise<void> {
    const service = this as unknown as {
      listPreorderTokens: (
        filters: Record<string, unknown>,
      ) => Promise<Array<{ id: string }>>
      updatePreorderTokens: (
        input: Record<string, unknown> & { id: string },
      ) => Promise<unknown>
    }
    const active = await service.listPreorderTokens({ revoked_at: null })
    for (const row of active) {
      await service.updatePreorderTokens({
        id: row.id,
        revoked_at: new Date(),
      })
    }
  }

  async getActiveTokenInfo(): Promise<
    | { active: false }
    | {
        active: true
        expiresAt: Date | null
        lastUsedAt: Date | null
        createdAt: Date
      }
  > {
    const service = this as unknown as {
      listPreorderTokens: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<
        Array<{
          expires_at: Date | null
          last_used_at: Date | null
          created_at: Date
          revoked_at: Date | null
        }>
      >
    }
    const rows = await service.listPreorderTokens(
      { revoked_at: null },
      { take: 1, order: { created_at: "DESC" } },
    )
    if (rows.length === 0) return { active: false }
    const row = rows[0]
    // Treat expired tokens as inactive — same effective state as revoked. The
    // verify path already rejects with reason="expired", so the GET shape should
    // match.
    if (row.expires_at && row.expires_at < new Date()) {
      return { active: false }
    }
    return {
      active: true,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    }
  }
}

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex")
}

// Re-export for unit tests only — not part of the public service API.
export { hashToken as hashTokenForTest }

export default PreorderModuleService
