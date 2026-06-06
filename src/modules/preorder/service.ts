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
import {
  parseQuoteUrlsCapped,
  isValidSheinUrl,
  isDaemonOnline,
  isLockStale,
  rollupRequestStatus,
} from "./lib/quote-helpers"

export const PREORDER_SETTINGS_ID = "preorder_settings"

// Quote-intake policy knobs (kept named so the three distinct "5"s don't drift).
const MAX_LINKS_PER_REQUEST = 5
const DAEMON_HEARTBEAT_WINDOW_MIN = 5 // daemon considered offline past this
const SCRAPE_LOCK_TTL_MIN = 5 // a scraping lock older than this is reclaimable
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // per-IP rate-limit window (1h)
const QUOTE_TTL_MS = 48 * 60 * 60 * 1000 // unreserved request lifetime (48h)

// Shape the daemon + storefront actually read off a quote item. Loosely typed
// (the MedusaService CRUD returns untyped rows) but enough to catch field typos
// at the daemon/admin call sites.
export type QuoteItemRow = {
  id: string
  request_id: string
  position: number
  shein_url: string
  status: string
  attempts: number
  locked_at: Date | null
  last_attempt_at: Date | null
  last_error_kind: string | null
  scraped_title: string | null
  scraped_thumbnail: string | null
  scraped_price_usd: number | null
  color_options: unknown
  size_options: unknown
  all_in_price_mur: number | null
  price_breakdown: unknown
  fx_rate_used: number | null
  settings_snapshot: unknown
  selected_size: string | null
  selected_color: string | null
  reserved_product_id: string | null
  reserved_at: Date | null
}

export type PreorderSettingsDTO = PreorderSettingsLike & {
  id: string
  // Daemon liveness heartbeat — lives on the settings row, not part of the
  // pricing-math shape (PreorderSettingsLike).
  shein_daemon_last_seen_at?: Date | null
}

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

  /**
   * Create a quote request + its item rows. Enforces <=5 links and the per-IP
   * hourly rate limit (settings.submissions_per_ip_per_hour). If the SHEIN
   * daemon is offline (stale heartbeat), items are created directly as
   * "needs_manual" so the storefront shows the by-hand card immediately
   * instead of an indefinite spinner.
   */
  async createQuoteRequest(input: {
    contact: { whatsapp: string; name?: string }
    rawUrls: string
    clientIp?: string | null
    notes?: string | null
    now?: Date
  }): Promise<{ requestId: string; itemCount: number; dropped: number; invalidCount: number }> {
    const now = input.now ?? new Date()
    const settings = await this.getSettings()

    const { urls, dropped } = parseQuoteUrlsCapped(input.rawUrls, MAX_LINKS_PER_REQUEST)
    const valid = urls.filter((u) => isValidSheinUrl(u))
    const invalidCount = urls.length - valid.length
    if (valid.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No valid SHEIN links found. Links must be shein.com product URLs.",
      )
    }

    // Per-IP rate limit (NAT-friendly default lives in settings).
    if (input.clientIp) {
      const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS)
      const recent = await (this as any).listPreorderQuoteRequests(
        { client_ip: input.clientIp, created_at: { $gte: windowStart } },
        { take: 100 },
      )
      const limit = Number(settings.submissions_per_ip_per_hour ?? 5)
      if (recent.length >= limit) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "rate_limited")
      }
    }

    // NOTE: settings.submissions_per_day_total (global daily cap) is NOT yet
    // enforced here — deferred to the store-route layer in Plan B. The per-IP
    // hourly limit above is the only cap active in this foundation layer.

    const daemonOnline = isDaemonOnline(
      settings.shein_daemon_last_seen_at
        ? new Date(settings.shein_daemon_last_seen_at)
        : null,
      now,
      DAEMON_HEARTBEAT_WINDOW_MIN,
    )
    const initialStatus = daemonOnline ? "pending" : "needs_manual"

    const request = await (this as any).createPreorderQuoteRequests({
      contact: input.contact,
      notes: input.notes ?? null,
      items_count: valid.length,
      client_ip: input.clientIp ?? null,
      status: initialStatus,
      expires_at: new Date(now.getTime() + QUOTE_TTL_MS),
    })

    await (this as any).createPreorderQuoteItems(
      valid.map((url, i) => ({
        request_id: request.id,
        position: i,
        shein_url: url,
        status: initialStatus,
      })),
    )

    return { requestId: request.id, itemCount: valid.length, dropped, invalidCount }
  }

  /** Daemon poll: oldest pending jobs first. */
  async listQuoteJobs(opts: { status?: string; limit?: number } = {}): Promise<QuoteItemRow[]> {
    const status = opts.status ?? "pending"
    const take = opts.limit ?? 5
    return (this as any).listPreorderQuoteItems(
      { status },
      { take, order: { created_at: "ASC" } },
    ) as Promise<QuoteItemRow[]>
  }

  /**
   * Claim a job for scraping. Returns false if the row is already locked by a
   * fresh (non-stale) lock — prevents double-scrape across poll cycles. A
   * scraping row whose lock is stale (> SCRAPE_LOCK_TTL_MIN) is reclaimable.
   *
   * NOTE: read-then-update, NOT a DB-level compare-and-swap. Safe because the
   * daemon is a single serial poller. If concurrent pollers are ever added,
   * this must become a raw `UPDATE … WHERE status='pending' RETURNING *`.
   */
  async claimQuoteJob(itemId: string, now: Date = new Date()): Promise<boolean> {
    const [item] = await (this as any).listPreorderQuoteItems({ id: itemId })
    if (!item) return false
    // Only pending or stale-scraping items are claimable. A quoted/failed/
    // needs_manual/reserved item must NOT be clobbered back to scraping.
    const claimable =
      item.status === "pending" ||
      (item.status === "scraping" &&
        isLockStale(item.locked_at ? new Date(item.locked_at) : null, now, SCRAPE_LOCK_TTL_MIN))
    if (!claimable) return false
    await (this as any).updatePreorderQuoteItems({
      id: itemId,
      status: "scraping",
      locked_at: now,
      last_attempt_at: now,
      attempts: Number(item.attempts ?? 0) + 1,
    })
    return true
  }

  /** Return a job to the pending pool for another daemon tick (pre-budget-exhaustion retry). */
  async requeueQuoteJob(itemId: string): Promise<void> {
    await (this as any).updatePreorderQuoteItems({
      id: itemId,
      status: "pending",
      locked_at: null,
    })
  }

  /**
   * Record a daemon (or manual) scrape result and bubble the request status.
   */
  async recordScrapeResult(
    itemId: string,
    payload: {
      outcome: "quoted" | "failed" | "needs_manual"
      scraped_title?: string | null
      scraped_thumbnail?: string | null
      scraped_price_usd?: number | null
      color_options?: unknown
      size_options?: unknown
      all_in_price_mur?: number | null
      price_breakdown?: unknown
      fx_rate_used?: number | null
      settings_snapshot?: unknown
      last_error_kind?: string | null
    },
  ): Promise<void> {
    const [item] = await (this as any).listPreorderQuoteItems({ id: itemId })
    if (!item) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "quote item not found")
    }
    await (this as any).updatePreorderQuoteItems({
      id: itemId,
      status: payload.outcome,
      locked_at: null,
      scraped_title: payload.scraped_title ?? item.scraped_title ?? null,
      scraped_thumbnail: payload.scraped_thumbnail ?? item.scraped_thumbnail ?? null,
      scraped_price_usd: payload.scraped_price_usd ?? item.scraped_price_usd ?? null,
      color_options: payload.color_options ?? item.color_options ?? null,
      size_options: payload.size_options ?? item.size_options ?? null,
      all_in_price_mur: payload.all_in_price_mur ?? item.all_in_price_mur ?? null,
      price_breakdown: payload.price_breakdown ?? item.price_breakdown ?? null,
      fx_rate_used: payload.fx_rate_used ?? item.fx_rate_used ?? null,
      settings_snapshot: payload.settings_snapshot ?? item.settings_snapshot ?? null,
      // Unlike the scrape fields above, last_error_kind does NOT fall back to
      // the prior value — a successful re-quote must clear the old error.
      last_error_kind: payload.last_error_kind ?? null,
    })
    await this.recomputeRequestStatus(item.request_id)
  }

  /** Re-roll a request's status from its items. Never resurrects a request that
   *  has already reached a terminal owner-set status (expired/abandoned). */
  async recomputeRequestStatus(requestId: string): Promise<void> {
    const [request] = await (this as any).listPreorderQuoteRequests({ id: requestId })
    if (!request) return
    if (request.status === "expired" || request.status === "abandoned") return
    const items = await (this as any).listPreorderQuoteItems({
      request_id: requestId,
    })
    const next = rollupRequestStatus(
      items.map((i: any) => ({ status: i.status })),
    )
    await (this as any).updatePreorderQuoteRequests({ id: requestId, status: next })
  }

  /** Daemon liveness — write heartbeat on the singleton settings row. */
  async recordDaemonHeartbeat(now: Date = new Date()): Promise<void> {
    const settings = await this.getSettings()
    await (this as any).updatePreorderSettings({
      id: settings.id,
      shein_daemon_last_seen_at: now,
    })
  }

  /** Storefront poll + admin detail. */
  async getQuoteRequest(
    id: string,
    opts: { withItems?: boolean } = {},
  ): Promise<any> {
    const [request] = await (this as any).listPreorderQuoteRequests({ id })
    if (!request) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "request not found")
    }
    if (!opts.withItems) return request
    const items = await (this as any).listPreorderQuoteItems(
      { request_id: id },
      { order: { position: "ASC" } },
    )
    return { ...request, items }
  }

  /**
   * Admin inline manual quote: owner types the SHEIN USD price, we run the same
   * pricing math the daemon would and write a binding snapshot.
   */
  async setManualQuote(
    itemId: string,
    input: { priceUsd: number },
  ): Promise<void> {
    if (!Number.isFinite(input.priceUsd) || input.priceUsd <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "priceUsd must be a positive number",
      )
    }
    // Read settings adjacent to the price computation so the snapshot reflects
    // the same fx/handling used by previewPrice (best-effort; previewPrice reads
    // settings internally — a separate edit between these two lines is the only
    // gap, acceptable for a solo-admin store).
    const settings = await this.getSettings()
    const preview = await this.previewPrice({ sheinPriceUsd: input.priceUsd })
    await this.recordScrapeResult(itemId, {
      outcome: "quoted",
      scraped_price_usd: input.priceUsd,
      all_in_price_mur: preview.finalPriceMur,
      price_breakdown: preview,
      fx_rate_used: preview.fxRateUsed,
      settings_snapshot: settings,
    })
  }

  /** Client picks size/colour on a quoted card. */
  async selectQuoteItemOptions(
    itemId: string,
    input: { size?: string | null; color?: string | null },
  ): Promise<void> {
    await (this as any).updatePreorderQuoteItems({
      id: itemId,
      selected_size: input.size ?? null,
      selected_color: input.color ?? null,
    })
  }

  /** Cron: mark unreserved requests older than 48h as expired. */
  async expireOldRequests(now: Date = new Date()): Promise<number> {
    const requests = await (this as any).listPreorderQuoteRequests({
      status: ["pending", "quoted", "partial", "needs_manual"],
    })
    let expired = 0
    for (const r of requests) {
      if (r.expires_at && new Date(r.expires_at).getTime() < now.getTime()) {
        await (this as any).updatePreorderQuoteRequests({
          id: r.id,
          status: "expired",
        })
        expired++
      }
    }
    return expired
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
