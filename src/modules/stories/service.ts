import { MedusaService } from "@medusajs/framework/utils"

import StoryPlan from "./models/story-plan"
import StorySlot from "./models/story-slot"
import PublicationLog from "./models/publication-log"
import StorySettings from "./models/story-settings"
import { buildSnapshot, type ProductLike } from "./snapshot"

export const STORY_SETTINGS_ID = "story_settings"

// Mauritius is UTC+4 with no DST. Plan dates are stored as MU local calendar
// dates ("YYYY-MM-DD"); using UTC here would shift "today" by a day during the
// 20:00–24:00 UTC window (i.e., 00:00–04:00 Mauritius local time).
const MU_OFFSET_MS = 4 * 60 * 60 * 1000
function todayIsoMauritius(): string {
  return new Date(Date.now() + MU_OFFSET_MS).toISOString().slice(0, 10)
}

export type StorySettingsDTO = {
  id: string
  anti_repeat_days: number
  caption_template: string
  default_distribution: Array<{ category_id: string; count: number }>
  default_schedule: string[]
  stock_alert_threshold: number
}

export type UpdateStorySettingsInput = Partial<Omit<StorySettingsDTO, "id">>

export type CreatePlanInput = {
  plan_date: string  // ISO date
  category_distribution: Array<{ category_id: string; count: number }>
  scheduled_times: string[]  // "HH:mm"
  notes?: string | null
}

export type CreateBatchPlansInput = {
  start_date: string  // ISO date for day 0
  days: number        // 1..31
  category_distribution: Array<{ category_id: string; count: number }>
  scheduled_times: string[]
  notes?: string | null
}

export type StoryPlanDTO = {
  id: string
  plan_date: string
  total_slots: number
  status: string
  category_distribution: Array<{ category_id: string; count: number }>
  scheduled_times: string[]
  notes: string | null
}

export type StockAlert = {
  slot_id: string
  plan_id: string
  plan_date: string
  slot_index: number
  scheduled_at: string
  product_id: string
  product_name: string
  current_stock: number
  threshold: number
}

export const DEFAULT_STORY_SETTINGS: Omit<StorySettingsDTO, "id"> = {
  anti_repeat_days: 7,
  caption_template: "{name} — Rs {price} · {sizes} · {link}",
  default_distribution: [],
  default_schedule: [],
  stock_alert_threshold: 0,
}

class StoriesModuleService extends MedusaService({
  StoryPlan,
  StorySlot,
  PublicationLog,
  StorySettings,
}) {
  async getSettings(): Promise<StorySettingsDTO> {
    const existing = await this.listStorySettings({ id: STORY_SETTINGS_ID })
    if (existing[0]) return existing[0] as unknown as StorySettingsDTO

    const created = await this.createStorySettings({
      id: STORY_SETTINGS_ID,
      ...DEFAULT_STORY_SETTINGS,
    } as unknown as Parameters<this["createStorySettings"]>[0])
    return created as unknown as StorySettingsDTO
  }

  async updateSettings(
    input: UpdateStorySettingsInput,
  ): Promise<StorySettingsDTO> {
    await this.getSettings()
    const updated = await this.updateStorySettings({
      id: STORY_SETTINGS_ID,
      ...input,
    } as unknown as Parameters<this["updateStorySettings"]>[0])
    return updated as unknown as StorySettingsDTO
  }

  async createPlan(input: CreatePlanInput): Promise<StoryPlanDTO> {
    const total = input.category_distribution.reduce((s, b) => s + b.count, 0)
    if (total !== input.scheduled_times.length) {
      throw new Error(
        `scheduled_times length (${input.scheduled_times.length}) must equal sum of distribution counts (${total})`,
      )
    }
    const created = await this.createStoryPlans({
      plan_date: input.plan_date,
      total_slots: total,
      category_distribution: input.category_distribution,
      scheduled_times: input.scheduled_times,
      status: "draft",
      notes: input.notes ?? null,
    } as unknown as Parameters<this["createStoryPlans"]>[0])
    return created as unknown as StoryPlanDTO
  }

  /**
   * Stamps slot.posted_at, writes a publication_log row, and (if it was the
   * last unposted slot of its plan) flips plan.status from active → completed.
   * On the first markPosted of a plan, also flips draft → active.
   */
  async markPosted(slotId: string): Promise<void> {
    const [slot] = await this.listStorySlots({ id: slotId })
    if (!slot) throw new Error(`Slot ${slotId} not found`)
    if (!slot.product_id) throw new Error("Cannot mark posted: slot has no product")
    if (slot.posted_at) return  // idempotent

    const now = new Date()

    await this.updateStorySlots({ id: slotId, posted_at: now })
    await this.createPublicationLogs({
      product_id: slot.product_id,
      slot_id: slot.id,
      posted_at: now,
    })

    const [plan] = await this.listStoryPlans({ id: slot.plan_id })
    const allSlots = await this.listStorySlots({ plan_id: plan.id })
    const allPosted = allSlots.every((s) => s.id === slotId || s.posted_at)
    if (plan.status === "draft") {
      await this.updateStoryPlans({ id: plan.id, status: allPosted ? "completed" : "active" })
    } else if (plan.status === "active" && allPosted) {
      await this.updateStoryPlans({ id: plan.id, status: "completed" })
    }
  }

  async unmark(slotId: string): Promise<void> {
    const [slot] = await this.listStorySlots({ id: slotId })
    if (!slot) throw new Error(`Slot ${slotId} not found`)
    if (!slot.posted_at) return  // idempotent

    await this.updateStorySlots({ id: slotId, posted_at: null })
    const logs = await this.listPublicationLogs({ slot_id: slotId })
    for (const log of logs) await this.deletePublicationLogs(log.id)

    const [plan] = await this.listStoryPlans({ id: slot.plan_id })
    if (plan.status === "completed") {
      await this.updateStoryPlans({ id: plan.id, status: "active" })
    }
  }

  async rescheduleSlot(slotId: string, scheduledAt: Date): Promise<void> {
    const [slot] = await this.listStorySlots({ id: slotId })
    if (!slot) throw new Error(`Slot ${slotId} not found`)
    if (slot.posted_at) throw new Error("Cannot reschedule a posted slot")
    await this.updateStorySlots({ id: slotId, scheduled_at: scheduledAt })
  }

  async swapSlotProduct(
    slotId: string,
    product: ProductLike,
  ): Promise<void> {
    const [slot] = await this.listStorySlots({ id: slotId })
    if (!slot) throw new Error(`Slot ${slotId} not found`)
    if (slot.posted_at) throw new Error("Cannot swap product on a posted slot")
    await this.updateStorySlots({
      id: slotId,
      product_id: product.id,
      product_snapshot: buildSnapshot(product),
      fallback_used: false,
      pick_attempt: (slot.pick_attempt ?? 1) + 1,
    })
  }

  async updateSlotMetadata(
    slotId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const [slot] = await this.listStorySlots({ id: slotId })
    if (!slot) throw new Error(`Slot ${slotId} not found`)
    await this.updateStorySlots({
      id: slotId,
      metadata: {
        ...((slot.metadata ?? {}) as Record<string, unknown>),
        ...patch,
      },
    } as unknown as Parameters<this["updateStorySlots"]>[0])
  }

  /**
   * Returns deduped product IDs that have been posted within the last
   * `days` days. Used by the picker to enforce anti-repeat.
   */
  async getExcludedProductIds(days: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const logs = await this.listPublicationLogs(
      { posted_at: { $gte: cutoff } },
      { take: 10000 },
    )
    return Array.from(new Set(logs.map((l) => l.product_id)))
  }

  /**
   * Internal: picks products for every un-posted slot of one plan and writes
   * them. Mutates `excluded` by adding picked ids — caller can carry the set
   * across multiple plan calls (used by createBatchPlans).
   */
  private async pickProductsForPlan(
    planId: string,
    deps: {
      productSource: (filter: { category_id?: string }) => Promise<ProductLike[]>
    },
    excluded: Set<string>,
  ): Promise<void> {
    const [plan] = await this.listStoryPlans({ id: planId })
    if (!plan) throw new Error(`Plan ${planId} not found`)
    if (plan.status === "completed")
      throw new Error("Plan is completed; cannot regenerate")

    const allSlots = await this.listStorySlots({ plan_id: planId })
    const postedSlots = allSlots.filter((s) => s.posted_at)
    const postedIndices = new Set(postedSlots.map((s) => s.slot_index))
    for (const id of postedSlots.map((s) => s.product_id).filter((x): x is string => Boolean(x))) {
      excluded.add(id)
    }

    const unpostedSlots = allSlots.filter((s) => !s.posted_at)
    for (const s of unpostedSlots) await this.deleteStorySlots(s.id)

    type ToFill = { slot_index: number; category_id: string }
    const toFill: ToFill[] = []
    let walker = 0
    const distribution = plan.category_distribution as unknown as Array<{
      category_id: string
      count: number
    }>
    for (const bucket of distribution) {
      for (let i = 0; i < bucket.count; i++) {
        if (!postedIndices.has(walker)) {
          toFill.push({ slot_index: walker, category_id: bucket.category_id })
        }
        walker++
      }
    }
    const scheduledTimes = plan.scheduled_times as unknown as string[]

    const eligible = (p: ProductLike) =>
      p.variants.some((v) => v.inventory_quantity > 0) && !excluded.has(p.id)

    const pickRandom = <T,>(arr: T[]): T | null =>
      arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null

    for (const { slot_index, category_id } of toFill) {
      const scheduledAt = resolveScheduledAt(
        plan.plan_date as unknown as string | Date,
        scheduledTimes[slot_index],
      )

      const inCategory = (await deps.productSource({ category_id })).filter(eligible)
      let product = pickRandom(inCategory)
      let fallbackUsed = false

      if (!product) {
        const union = (await deps.productSource({})).filter(eligible)
        product = pickRandom(union)
        fallbackUsed = product != null
      }

      if (product) {
        await this.createStorySlots({
          plan_id: planId,
          slot_index,
          scheduled_at: scheduledAt,
          category_id,
          product_id: product.id,
          product_snapshot: buildSnapshot(product),
          fallback_used: fallbackUsed,
          pick_attempt: 1,
        })
        excluded.add(product.id)
      } else {
        await this.createStorySlots({
          plan_id: planId,
          slot_index,
          scheduled_at: scheduledAt,
          category_id,
          product_id: null,
          product_snapshot: null,
          fallback_used: false,
          pick_attempt: 1,
        })
      }
    }

    if (plan.status === "draft") {
      await this.updateStoryPlans({ id: planId, status: "active" })
    }
  }

  async regeneratePlan(
    planId: string,
    deps: {
      productSource: (filter: { category_id?: string }) => Promise<ProductLike[]>
    },
  ): Promise<void> {
    const settings = await this.getSettings()
    const excluded = new Set(
      await this.getExcludedProductIds(settings.anti_repeat_days),
    )
    // Schedule-aware dedup: also exclude products already assigned to slots on
    // OTHER plans that haven't posted yet. Publication-log only covers products
    // that have actually shipped; without this, the daily cron at 18:00 MU can
    // assign a product to tomorrow that's still scheduled (e.g. 21:00) today.
    const scheduled = await this.listStorySlots({}, { take: 10000 })
    for (const s of scheduled) {
      if (s.plan_id === planId) continue
      if (s.product_id && !s.posted_at) excluded.add(s.product_id)
    }
    await this.pickProductsForPlan(planId, deps, excluded)
  }

  async getStockAlerts(deps: {
    variantStockLookup: (productIds: string[]) => Promise<Map<string, number>>
    fromDate?: string  // ISO date inclusive, default today (Mauritius)
    toDate?: string    // ISO date inclusive, default fromDate + 7
  }): Promise<StockAlert[]> {
    const settings = await this.getSettings()
    const threshold = settings.stock_alert_threshold

    const from = deps.fromDate ?? todayIsoMauritius()
    const toFallback = new Date(`${from}T00:00:00Z`)
    toFallback.setUTCDate(toFallback.getUTCDate() + 7)
    const to = deps.toDate ?? toFallback.toISOString().slice(0, 10)

    const plans = await this.listStoryPlans(
      { plan_date: { $gte: from, $lte: to } },
      { take: 100 },
    )
    if (plans.length === 0) return []
    const planIds = plans.map((p) => p.id)
    const planById = new Map<string, { id: string; plan_date: string }>(
      plans.map((p) => {
        const pd = p.plan_date as unknown as string | Date
        return [
          p.id,
          {
            id: p.id,
            plan_date:
              typeof pd === "string"
                ? pd.slice(0, 10)
                : pd.toISOString().slice(0, 10),
          },
        ]
      }),
    )

    const slots = await this.listStorySlots(
      { plan_id: { $in: planIds }, posted_at: null } as any,
      { take: 1000 },
    )
    const populated = slots.filter(
      (s): s is typeof s & { product_id: string } => Boolean(s.product_id),
    )
    if (populated.length === 0) return []

    const productIds = Array.from(new Set(populated.map((s) => s.product_id)))
    const stocks = await deps.variantStockLookup(productIds)

    const alerts: StockAlert[] = []
    for (const s of populated) {
      const current = stocks.get(s.product_id) ?? 0
      if (current <= threshold) {
        const plan = planById.get(s.plan_id)!
        const snap = (s.product_snapshot ?? null) as { name?: string } | null
        alerts.push({
          slot_id: s.id,
          plan_id: s.plan_id,
          plan_date: plan.plan_date,
          slot_index: s.slot_index,
          scheduled_at:
            typeof s.scheduled_at === "string"
              ? s.scheduled_at
              : (s.scheduled_at as Date).toISOString(),
          product_id: s.product_id,
          product_name: snap?.name ?? "(unknown)",
          current_stock: current,
          threshold,
        })
      }
    }
    return alerts
  }

  /**
   * Appends a non-product "filler" slot to an existing plan and bumps
   * `total_slots`. Used by the weekly how-to-order rotation (see
   * `lib/stories-filler.ts`) so we can run an editorial / instructional
   * story without burning an anti-repeat product pick.
   *
   * The slot is created with `product_id=null`, `product_snapshot=null`, and
   * `metadata.forced_template_slug=<slug>`. The batch renderer detects the
   * forced slug and renders that template directly, bypassing the picker.
   */
  async addFillerSlot(input: {
    plan_id: string
    template_slug: string
    scheduled_at: Date
    category_id?: string
  }): Promise<{ slot_id: string; slot_index: number }> {
    const [plan] = await this.listStoryPlans({ id: input.plan_id })
    if (!plan) throw new Error(`Plan ${input.plan_id} not found`)

    const allSlots = await this.listStorySlots({ plan_id: input.plan_id })
    const nextIndex = allSlots.reduce((max, s) => Math.max(max, s.slot_index), -1) + 1

    const slot = await this.createStorySlots({
      plan_id: input.plan_id,
      slot_index: nextIndex,
      scheduled_at: input.scheduled_at,
      category_id: input.category_id ?? "__filler__",
      product_id: null,
      product_snapshot: null,
      metadata: { forced_template_slug: input.template_slug },
      fallback_used: false,
      pick_attempt: 1,
    } as unknown as Parameters<this["createStorySlots"]>[0])

    await this.updateStoryPlans({
      id: input.plan_id,
      total_slots: (plan.total_slots ?? 0) + 1,
    } as unknown as Parameters<this["updateStoryPlans"]>[0])

    return { slot_id: slot.id, slot_index: nextIndex }
  }

  async createBatchPlans(
    input: CreateBatchPlansInput,
    deps: {
      productSource: (filter: { category_id?: string }) => Promise<ProductLike[]>
    },
  ): Promise<StoryPlanDTO[]> {
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > 31) {
      throw new Error("days must be an integer between 1 and 31")
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.start_date)
    if (!m) throw new Error("start_date must be ISO YYYY-MM-DD")
    const year = Number(m[1])
    const month = Number(m[2])
    const day = Number(m[3])

    const dates: string[] = []
    for (let i = 0; i < input.days; i++) {
      // Date.UTC handles month overflow (e.g., Aug 31 + 1 day → Sep 1)
      const d = new Date(Date.UTC(year, month - 1, day + i))
      dates.push(d.toISOString().slice(0, 10))
    }

    // Medusa v2 list filters accept arrays as IN queries; cast through `any`
    // because the generated types only declare scalar/object filters.
    const existing = await this.listStoryPlans(
      { plan_date: { $in: dates } } as any,
    )
    const conflicts = (existing as Array<{ plan_date: string | Date }>).map((p) =>
      typeof p.plan_date === "string"
        ? p.plan_date.slice(0, 10)
        : p.plan_date.toISOString().slice(0, 10),
    )
    if (conflicts.length > 0) {
      throw new Error(`Plans already exist for: ${conflicts.join(", ")}`)
    }

    const settings = await this.getSettings()
    const excluded = new Set(await this.getExcludedProductIds(settings.anti_repeat_days))

    const created: StoryPlanDTO[] = []
    for (const date of dates) {
      const plan = await this.createPlan({
        plan_date: date,
        category_distribution: input.category_distribution,
        scheduled_times: input.scheduled_times,
        notes: input.notes ?? null,
      })
      await this.pickProductsForPlan(plan.id, deps, excluded)
      created.push(plan)
    }
    return created
  }
}

function resolveScheduledAt(planDate: string | Date, time: string): Date {
  const date =
    typeof planDate === "string" ? planDate : planDate.toISOString().slice(0, 10)
  return new Date(`${date}T${time}:00+04:00`)
}

export default StoriesModuleService
