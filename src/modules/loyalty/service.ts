import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import LoyaltyAccount from "./models/loyalty-account"
import LoyaltySettings from "./models/loyalty-settings"
import LoyaltyTransaction from "./models/loyalty-transaction"

export type LoyaltyTxnType = "earn" | "redeem" | "adjustment" | "expire"

export const LOYALTY_SETTINGS_ID = "loyalty_settings"

export type LoyaltySettingsDTO = {
  id: string
  earn_rate_per_100_mur: number
  redeem_rate_mur_per_100_pts: number
  min_redeem_points: number
  welcome_bonus_points: number
  points_expiry_months: number | null
}

export type UpdateLoyaltySettingsInput = Partial<
  Omit<LoyaltySettingsDTO, "id">
>

export const DEFAULT_LOYALTY_SETTINGS: Omit<LoyaltySettingsDTO, "id"> = {
  earn_rate_per_100_mur: 1,
  redeem_rate_mur_per_100_pts: 50,
  min_redeem_points: 500,
  welcome_bonus_points: 100,
  points_expiry_months: null,
}

export type AwardOptions = {
  orderId?: string | null
  reason: string
}

export type RedeemOptions = {
  orderId?: string | null
  reason: string
}

export type AdjustOptions = {
  reason: string
}

/**
 * Custom Doll Rewards loyalty service.
 *
 * Auto-generated CRUD on LoyaltyAccount + LoyaltyTransaction comes from
 * MedusaService(...). On top we expose business methods that:
 *   - get-or-create the account for a customer
 *   - mutate balances atomically with a ledger row
 *   - guarantee idempotency on `earn` events tied to an order_id
 */
class LoyaltyModuleService extends MedusaService({
  LoyaltyAccount,
  LoyaltySettings,
  LoyaltyTransaction,
}) {
  /**
   * Returns the singleton settings row, creating default values lazily.
   */
  async getSettings(): Promise<LoyaltySettingsDTO> {
    const service = this as unknown as {
      listLoyaltySettings: (filters: Record<string, unknown>) => Promise<LoyaltySettingsDTO[]>
      createLoyaltySettings: (
        input: LoyaltySettingsDTO,
      ) => Promise<LoyaltySettingsDTO>
    }
    const existing = await service.listLoyaltySettings({
      id: LOYALTY_SETTINGS_ID,
    })

    if (existing.length > 0) {
      return existing[0]
    }

    return service.createLoyaltySettings({
      id: LOYALTY_SETTINGS_ID,
      ...DEFAULT_LOYALTY_SETTINGS,
    })
  }

  /**
   * Updates the singleton settings row. Omitted fields are left unchanged.
   */
  async updateSettings(
    input: UpdateLoyaltySettingsInput,
  ): Promise<LoyaltySettingsDTO> {
    const current = await this.getSettings()
    const next: UpdateLoyaltySettingsInput = {}

    if ("earn_rate_per_100_mur" in input) {
      next.earn_rate_per_100_mur = input.earn_rate_per_100_mur
    }
    if ("redeem_rate_mur_per_100_pts" in input) {
      next.redeem_rate_mur_per_100_pts =
        input.redeem_rate_mur_per_100_pts
    }
    if ("min_redeem_points" in input) {
      next.min_redeem_points = input.min_redeem_points
    }
    if ("welcome_bonus_points" in input) {
      next.welcome_bonus_points = input.welcome_bonus_points
    }
    if ("points_expiry_months" in input) {
      next.points_expiry_months = input.points_expiry_months ?? null
    }

    this.validateSettings({ ...current, ...next })

    const service = this as unknown as {
      updateLoyaltySettings: (
        input: Partial<LoyaltySettingsDTO> & { id: string },
      ) => Promise<LoyaltySettingsDTO>
    }

    return service.updateLoyaltySettings({
      id: LOYALTY_SETTINGS_ID,
      ...next,
    })
  }

  private validateSettings(settings: UpdateLoyaltySettingsInput) {
    for (const key of [
      "earn_rate_per_100_mur",
      "welcome_bonus_points",
    ] as const) {
      const value = settings[key]
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

    for (const key of [
      "redeem_rate_mur_per_100_pts",
      "min_redeem_points",
    ] as const) {
      const value = settings[key]
      if (
        value === undefined ||
        !Number.isFinite(value) ||
        Math.trunc(value) !== value ||
        value <= 0
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${key} must be a positive integer`,
        )
      }
    }

    const expiry = settings.points_expiry_months
    if (
      expiry !== null &&
      expiry !== undefined &&
      (!Number.isFinite(expiry) || Math.trunc(expiry) !== expiry || expiry <= 0)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "points_expiry_months must be null or a positive integer",
      )
    }
  }

  /**
   * Returns the existing account for a customer, or creates a fresh one
   * with zero balances.
   */
  async ensureAccount(customerId: string) {
    if (!customerId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "customerId is required",
      )
    }

    const existing = await this.listLoyaltyAccounts({
      customer_id: customerId,
    })

    if (existing.length > 0) {
      return existing[0]
    }

    return await this.createLoyaltyAccounts({
      customer_id: customerId,
      points_balance: 0,
      lifetime_earned: 0,
      lifetime_redeemed: 0,
    })
  }

  async getAccount(customerId: string) {
    return this.ensureAccount(customerId)
  }

  /**
   * Award points (earn). Always creates a ledger row.
   *
   * Idempotency: if `orderId` is provided and an `earn` transaction already
   * exists for that order_id on this account, this is a no-op and we return
   * the existing account unchanged. The subscriber relies on this.
   */
  async awardPoints(
    customerId: string,
    points: number,
    options: AwardOptions,
  ) {
    if (!Number.isFinite(points) || points <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `awardPoints: points must be a positive integer (got ${points})`,
      )
    }
    const intPoints = Math.floor(points)

    const account = await this.ensureAccount(customerId)

    if (options.orderId) {
      const dupes = await this.listLoyaltyTransactions({
        account_id: account.id,
        order_id: options.orderId,
        type: "earn",
      })
      if (dupes.length > 0) {
        // already awarded for this order; no double-credit.
        return account
      }
    }

    const updated = await this.updateLoyaltyAccounts({
      id: account.id,
      points_balance: account.points_balance + intPoints,
      lifetime_earned: account.lifetime_earned + intPoints,
    })

    await this.createLoyaltyTransactions({
      account_id: account.id,
      type: "earn",
      points: intPoints,
      reason: options.reason,
      order_id: options.orderId ?? null,
    })

    return updated
  }

  /**
   * Redeem points. Throws if balance is insufficient.
   */
  async redeemPoints(
    customerId: string,
    points: number,
    options: RedeemOptions,
  ) {
    if (!Number.isFinite(points) || points <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `redeemPoints: points must be a positive integer (got ${points})`,
      )
    }
    const intPoints = Math.floor(points)

    const account = await this.ensureAccount(customerId)

    if (account.points_balance < intPoints) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Insufficient points balance: have ${account.points_balance}, requested ${intPoints}`,
      )
    }

    const updated = await this.updateLoyaltyAccounts({
      id: account.id,
      points_balance: account.points_balance - intPoints,
      lifetime_redeemed: account.lifetime_redeemed + intPoints,
    })

    await this.createLoyaltyTransactions({
      account_id: account.id,
      type: "redeem",
      points: -intPoints,
      reason: options.reason,
      order_id: options.orderId ?? null,
    })

    return updated
  }

  /**
   * Manual admin adjustment. Positive `delta` credits, negative debits.
   * - Negative deltas may not push the balance below 0.
   * - Lifetime totals are updated to reflect the credit/debit so downstream
   *   reporting stays consistent.
   */
  async adjustPoints(
    customerId: string,
    delta: number,
    options: AdjustOptions,
  ) {
    if (!Number.isFinite(delta) || delta === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "adjustPoints: delta must be a non-zero integer",
      )
    }
    const intDelta = Math.trunc(delta)

    const account = await this.ensureAccount(customerId)
    const newBalance = account.points_balance + intDelta

    if (newBalance < 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Adjustment would push balance below zero (current ${account.points_balance}, delta ${intDelta})`,
      )
    }

    const updateData: {
      id: string
      points_balance: number
      lifetime_earned?: number
      lifetime_redeemed?: number
    } = {
      id: account.id,
      points_balance: newBalance,
    }

    if (intDelta > 0) {
      updateData.lifetime_earned = account.lifetime_earned + intDelta
    } else {
      updateData.lifetime_redeemed = account.lifetime_redeemed + Math.abs(intDelta)
    }

    const updated = await this.updateLoyaltyAccounts(updateData)

    await this.createLoyaltyTransactions({
      account_id: account.id,
      type: "adjustment",
      points: intDelta,
      reason: options.reason,
      order_id: null,
    })

    return updated
  }

  /**
   * Paginated transaction history for a customer.
   * Newest first.
   */
  async listTransactions(
    customerId: string,
    pagination: { limit?: number; offset?: number } = {},
  ) {
    const account = await this.ensureAccount(customerId)
    const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 200)
    const offset = Math.max(pagination.offset ?? 0, 0)

    const [items, count] = await this.listAndCountLoyaltyTransactions(
      { account_id: account.id },
      {
        take: limit,
        skip: offset,
        order: { created_at: "DESC" },
      },
    )

    return { items, count, limit, offset }
  }
}

export default LoyaltyModuleService
