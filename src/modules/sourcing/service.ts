import {
  ContainerRegistrationKeys,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"
import {
  createProductsWorkflow,
  createInventoryLevelsWorkflow,
  updateProductsWorkflow,
  deleteProductsWorkflow,
} from "@medusajs/medusa/core-flows"

import Supplier from "./models/supplier"
import DraftOrder, { DRAFT_ORDER_STATUSES } from "./models/draft-order"
import DraftItem from "./models/draft-item"
import DraftVariant from "./models/draft-variant"
import DraftCostHistory from "./models/draft-cost-history"
import { getNextRef } from "./lib/ref-allocator"

export type CreateSupplierInput = {
  name: string
  contact_handle?: string | null
  notes?: string | null
}

export type UpdateSupplierInput = Partial<CreateSupplierInput>

export const PUSH_VALIDATION_REASONS = [
  "draft_not_received",
  "missing_selling_price",
  "missing_image",
  "missing_category",
  "no_qty",
  "invalid_variant_override_price",
] as const

export type PushValidationReason = (typeof PUSH_VALIDATION_REASONS)[number]

export type PushValidationResult = {
  ok: boolean
  items: Array<{
    id: string
    ref_preview: string | null
    reasons: PushValidationReason[]
  }>
}

export type PushDraftResult = {
  pushed: Array<{
    draft_item_id: string
    ref: string
    product_id: string
  }>
  failed: Array<{
    draft_item_id: string
    reason: string
  }>
}

type DraftStatus = (typeof DRAFT_ORDER_STATUSES)[number]

export type SupplierDraftCounts = {
  active: number
  paid: number
}

export type DraftSummary = {
  item_count: number
  total_pcs: number
  total_usd: number
}

const FORWARD: Record<DraftStatus, DraftStatus | null> = {
  drafting: "negotiating",
  negotiating: "paid",
  paid: "shipped",
  shipped: "received",
  received: null,
}

const ACTIVE_DRAFT_STATUSES = new Set<DraftStatus>(["drafting", "negotiating"])
const PAID_DRAFT_STATUSES = new Set<DraftStatus>(["paid", "shipped", "received"])

class SourcingModuleService extends MedusaService({
  Supplier,
  DraftOrder,
  DraftItem,
  DraftVariant,
  DraftCostHistory,
}) {
  // ---------- Internal guards ----------

  /**
   * Throws if the item is published. Authoritative server-side boundary
   * for all draft-mutation methods; the admin UI hides these controls
   * when locked but a stale browser tab or direct curl could otherwise
   * still mutate a published item and orphan its draft data.
   */
  private async assertItemEditable(itemId: string): Promise<void> {
    const item = await this.retrieveItem(itemId)
    if (item.published_product_id && String(item.published_product_id).length > 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Item is published — locked",
      )
    }
  }

  // ---------- Suppliers ----------

  async createSupplier(input: CreateSupplierInput) {
    const name = (input.name ?? "").trim()
    if (!name) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Supplier name is required",
      )
    }
    const svc = this as unknown as {
      createSuppliers: (data: Record<string, unknown>) => Promise<unknown>
    }
    return (await svc.createSuppliers({
      name,
      contact_handle: input.contact_handle ?? null,
      notes: input.notes ?? null,
    })) as {
      id: string
      name: string
      contact_handle: string | null
      notes: string | null
      archived_at: Date | null
    }
  }

  async updateSupplier(id: string, input: UpdateSupplierInput) {
    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Supplier name cannot be blank",
        )
      }
      patch.name = name
    }
    if (input.contact_handle !== undefined)
      patch.contact_handle = input.contact_handle
    if (input.notes !== undefined) patch.notes = input.notes

    const svc = this as unknown as {
      updateSuppliers: (data: { id: string } & Record<string, unknown>) => Promise<unknown>
    }
    return await svc.updateSuppliers({ id, ...patch })
  }

  async archiveSupplier(id: string) {
    const svc = this as unknown as {
      updateSuppliers: (data: Record<string, unknown>) => Promise<unknown>
    }
    return await svc.updateSuppliers({ id, archived_at: new Date() })
  }

  async unarchiveSupplier(id: string) {
    const svc = this as unknown as {
      updateSuppliers: (data: Record<string, unknown>) => Promise<unknown>
    }
    return await svc.updateSuppliers({ id, archived_at: null })
  }

  async listActiveSuppliers() {
    const svc = this as unknown as {
      listSuppliers: (filters: Record<string, unknown>) => Promise<unknown[]>
    }
    return (await svc.listSuppliers({ archived_at: null })) as Array<{
      id: string
      name: string
      contact_handle: string | null
      notes: string | null
      archived_at: Date | null
    }>
  }

  async listAllSuppliers() {
    const svc = this as unknown as {
      listSuppliers: (filters: Record<string, unknown>) => Promise<unknown[]>
    }
    return (await svc.listSuppliers({})) as Array<{
      id: string
      name: string
      contact_handle: string | null
      notes: string | null
      archived_at: Date | null
    }>
  }

  async countDraftsForSuppliers(
    supplierIds: string[],
  ): Promise<Record<string, SupplierDraftCounts>> {
    const ids = [...new Set(supplierIds.filter(Boolean))]
    const counts = Object.fromEntries(
      ids.map((id) => [id, { active: 0, paid: 0 }]),
    ) as Record<string, SupplierDraftCounts>
    if (ids.length === 0) return counts

    const svc = this as unknown as {
      listDraftOrders: (filters: Record<string, unknown>) => Promise<Array<{
        supplier_id: string
        status: DraftStatus
        archived_at: Date | null
      }>>
    }
    const drafts = await svc.listDraftOrders({ supplier_id: ids })
    for (const draft of drafts) {
      if (draft.archived_at) continue
      const row = counts[draft.supplier_id]
      if (!row) continue
      if (ACTIVE_DRAFT_STATUSES.has(draft.status)) row.active += 1
      else if (PAID_DRAFT_STATUSES.has(draft.status)) row.paid += 1
    }
    return counts
  }

  async deleteSupplierStrict(id: string) {
    const svc = this as unknown as {
      listDraftOrders: (filters: Record<string, unknown>) => Promise<Array<{ status: string }>>
      deleteSuppliers: (id: string) => Promise<void>
    }
    const drafts = await svc.listDraftOrders({ supplier_id: id })
    const blockers = drafts.filter((d) => d.status !== "drafting")
    if (blockers.length > 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Supplier has ${blockers.length} draft(s) past drafting; archive instead`,
      )
    }
    await svc.deleteSuppliers(id)
  }

  // ---------- Drafts ----------

  async createDraft(input: { supplier_id: string }) {
    const svc = this as unknown as {
      retrieveSupplier: (id: string) => Promise<unknown>
      createDraftOrders: (data: Record<string, unknown>) => Promise<unknown>
    }
    await svc.retrieveSupplier(input.supplier_id)
    const draft = await svc.createDraftOrders({
      supplier_id: input.supplier_id,
      status: "drafting",
      currency: "USD",
      landed_cost_multiplier: 1.5,
    })
    return draft as {
      id: string
      status: DraftStatus
      currency: string
      landed_cost_multiplier: string | number
    }
  }

  async retrieveDraft(id: string) {
    const svc = this as unknown as {
      retrieveDraftOrder: (id: string) => Promise<unknown>
    }
    return (await svc.retrieveDraftOrder(id)) as {
      id: string
      supplier_id: string
      status: DraftStatus
      currency: string
      landed_cost_multiplier: string | number
      notes: string | null
      paid_at: Date | null
      shipped_at: Date | null
      received_at: Date | null
      archived_at: Date | null
    }
  }

  async listDraftsForSupplier(
    supplierId: string,
    opts: { includeArchived?: boolean } = {},
  ) {
    const svc = this as unknown as {
      listDraftOrders: (filters: Record<string, unknown>) => Promise<unknown[]>
    }
    const filters: Record<string, unknown> = { supplier_id: supplierId }
    if (!opts.includeArchived) filters.archived_at = null
    return (await svc.listDraftOrders(filters)) as Array<
      Awaited<ReturnType<typeof this.retrieveDraft>>
    >
  }

  async summarizeDrafts(draftIds: string[]): Promise<Record<string, DraftSummary>> {
    const ids = [...new Set(draftIds.filter(Boolean))]
    const summaries = Object.fromEntries(
      ids.map((id) => [
        id,
        { item_count: 0, total_pcs: 0, total_usd: 0 },
      ]),
    ) as Record<string, DraftSummary>
    if (ids.length === 0) return summaries

    const svc = this as unknown as {
      listDraftItems: (filters: Record<string, unknown>) => Promise<Array<{
        id: string
        draft_order_id: string
        cost_usd: string | number
      }>>
      listDraftVariants: (filters: Record<string, unknown>) => Promise<Array<{
        draft_item_id: string
        qty: number
      }>>
    }
    const items = await svc.listDraftItems({ draft_order_id: ids })
    const itemIds = items.map((item) => item.id)
    const qtyByItemId = new Map<string, number>()
    if (itemIds.length > 0) {
      const variants = await svc.listDraftVariants({ draft_item_id: itemIds })
      for (const variant of variants) {
        qtyByItemId.set(
          variant.draft_item_id,
          (qtyByItemId.get(variant.draft_item_id) ?? 0) + Number(variant.qty ?? 0),
        )
      }
    }

    for (const item of items) {
      const summary = summaries[item.draft_order_id]
      if (!summary) continue
      const qty = qtyByItemId.get(item.id) ?? 0
      summary.item_count += 1
      summary.total_pcs += qty
      summary.total_usd += Number(item.cost_usd ?? 0) * qty
    }
    for (const summary of Object.values(summaries)) {
      summary.total_usd = Math.round(summary.total_usd * 100) / 100
    }
    return summaries
  }

  async listDraftsForSupplierWithSummary(
    supplierId: string,
    opts: { includeArchived?: boolean } = {},
  ) {
    const drafts = await this.listDraftsForSupplier(supplierId, opts)
    const summaries = await this.summarizeDrafts(drafts.map((draft) => draft.id))
    return drafts.map((draft) => ({
      ...draft,
      summary: summaries[draft.id] ?? {
        item_count: 0,
        total_pcs: 0,
        total_usd: 0,
      },
    }))
  }

  async transitionDraft(
    id: string,
    to: DraftStatus,
    opts: { reason?: string } = {},
  ) {
    const draft = await this.retrieveDraft(id)
    const current = draft.status
    if (current === to) return draft

    const expectedForward = FORWARD[current]
    const isForward = expectedForward === to
    const isBackward =
      !isForward && (DRAFT_ORDER_STATUSES as readonly string[]).includes(to)

    if (!isForward && !isBackward) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Transition ${current} → ${to} not allowed`,
      )
    }
    if (!isForward) {
      if (!opts.reason || opts.reason.trim().length === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Backward transition ${current} → ${to} requires a reason`,
        )
      }
    }
    if (isForward && to === "paid") {
      await this.assertReadyForPaid(id)
    }

    const patch: Record<string, unknown> = { id, status: to }
    const now = new Date()
    if (to === "paid" && !draft.paid_at) patch.paid_at = now
    if (to === "shipped" && !draft.shipped_at) patch.shipped_at = now
    if (to === "received" && !draft.received_at) patch.received_at = now

    const svc = this as unknown as {
      updateDraftOrders: (data: Record<string, unknown>) => Promise<unknown>
    }

    if (to === "received") {
      await this.setReceivedQtyDefaults(id)
    }

    await svc.updateDraftOrders(patch)

    if (!isForward && opts.reason) {
      const note = `\n[${now.toISOString()}] Reverted ${current} → ${to}: ${opts.reason}`
      await svc.updateDraftOrders({
        id,
        notes: (draft.notes ?? "") + note,
      })
    }
    return await this.retrieveDraft(id)
  }

  private async assertReadyForPaid(draftOrderId: string) {
    const svc = this as unknown as {
      listDraftItems: (
        filters: Record<string, unknown>,
      ) => Promise<Array<{ id: string; cost_usd: string | number; working_name: string | null }>>
      listDraftVariants: (
        filters: Record<string, unknown>,
      ) => Promise<Array<{ qty: number }>>
    }
    const items = await svc.listDraftItems({ draft_order_id: draftOrderId })
    if (items.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Draft has no items — add at least one before marking as paid",
      )
    }
    for (const item of items) {
      if (Number(item.cost_usd) <= 0) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Item "${item.working_name ?? item.id}" has no cost — set it before marking as paid`,
        )
      }
      const variants = await svc.listDraftVariants({ draft_item_id: item.id })
      const total = variants.reduce((acc, v) => acc + Number(v.qty), 0)
      if (total <= 0) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Item "${item.working_name ?? item.id}" has 0 total qty — fill the matrix or remove it`,
        )
      }
    }
  }

  async deleteDraftStrict(id: string) {
    const draft = await this.retrieveDraft(id)
    if (draft.status !== "drafting") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Only drafts in 'drafting' status can be deleted; archive others instead",
      )
    }
    const svc = this as unknown as {
      deleteDraftOrders: (id: string) => Promise<void>
    }
    await svc.deleteDraftOrders(id)
  }

  async archiveDraft(id: string) {
    const svc = this as unknown as {
      updateDraftOrders: (data: Record<string, unknown>) => Promise<unknown>
    }
    return await svc.updateDraftOrders({ id, archived_at: new Date() })
  }

  async updateDraftMeta(
    id: string,
    input: {
      notes?: string | null
      landed_cost_multiplier?: number
      paid_at?: Date | null
      shipped_at?: Date | null
      received_at?: Date | null
    },
  ) {
    const patch: Record<string, unknown> = { id }
    if (input.notes !== undefined) patch.notes = input.notes
    if (input.landed_cost_multiplier !== undefined) {
      if (input.landed_cost_multiplier <= 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "landed_cost_multiplier must be > 0",
        )
      }
      patch.landed_cost_multiplier = input.landed_cost_multiplier
    }
    if (input.paid_at !== undefined) patch.paid_at = input.paid_at
    if (input.shipped_at !== undefined) patch.shipped_at = input.shipped_at
    if (input.received_at !== undefined) patch.received_at = input.received_at
    const svc = this as unknown as {
      updateDraftOrders: (data: Record<string, unknown>) => Promise<unknown>
    }
    await svc.updateDraftOrders(patch)
    return await this.retrieveDraft(id)
  }

  // ---------- Items ----------

  async createItem(input: {
    draft_order_id: string
    working_name?: string | null
    source_url?: string | null
    source_type?: "alibaba" | "pdf" | "manual"
    scraped_title?: string | null
    scraped_image_url?: string | null
    cost_usd?: number
    notes?: string | null
    uploaded_image_r2_key?: string | null
    category_id?: string | null
  }) {
    await this.retrieveDraft(input.draft_order_id)
    const svc = this as unknown as {
      listDraftItems: (filters: Record<string, unknown>) => Promise<Array<{ position: number }>>
      createDraftItems: (data: Record<string, unknown>) => Promise<unknown>
    }
    const existing = await svc.listDraftItems({ draft_order_id: input.draft_order_id })
    const nextPos = existing.reduce((max, i) => Math.max(max, i.position), -1) + 1
    const item = await svc.createDraftItems({
      draft_order_id: input.draft_order_id,
      working_name: input.working_name ?? null,
      source_url: input.source_url ?? null,
      source_type: input.source_type ?? "manual",
      scraped_title: input.scraped_title ?? null,
      scraped_image_url: input.scraped_image_url ?? null,
      cost_usd: input.cost_usd ?? 0,
      notes: input.notes ?? null,
      uploaded_image_r2_key: input.uploaded_image_r2_key ?? null,
      category_id: input.category_id ?? null,
      position: nextPos,
    })
    return item as {
      id: string
      draft_order_id: string
      working_name: string | null
      source_url: string | null
      source_type: "alibaba" | "pdf" | "manual"
      cost_usd: string | number
      position: number
    }
  }

  async retrieveItem(id: string) {
    const svc = this as unknown as {
      retrieveDraftItem: (id: string) => Promise<unknown>
    }
    return (await svc.retrieveDraftItem(id)) as {
      id: string
      draft_order_id: string
      working_name: string | null
      source_url: string | null
      source_type: "alibaba" | "pdf" | "manual"
      scraped_title: string | null
      scraped_image_url: string | null
      cost_usd: string | number
      notes: string | null
      position: number
      uploaded_image_r2_key: string | null
      color_images: Record<string, string> | null
      ref: string | null
      selling_price_mur: string | number | null
      category_id: string | null
      published_product_id: string | null
      published_at: Date | null
    }
  }

  async listItems(draftOrderId: string) {
    const svc = this as unknown as {
      listDraftItems: (filters: Record<string, unknown>) => Promise<unknown[]>
    }
    return (await svc.listDraftItems({ draft_order_id: draftOrderId })) as Array<
      Awaited<ReturnType<typeof this.retrieveItem>>
    >
  }

  async updateItem(
    id: string,
    input: {
      working_name?: string | null
      cost_usd?: number
      notes?: string | null
      scraped_title?: string | null
      scraped_image_url?: string | null
      source_url?: string | null
      source_type?: "alibaba" | "pdf" | "manual"
      uploaded_image_r2_key?: string | null
      category_id?: string | null
      color_images?: Record<string, string> | null
    },
    opts: { reason?: string } = {},
  ) {
    const item = await this.retrieveItem(id)
    if (item.published_product_id && String(item.published_product_id).length > 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Item is published — locked",
      )
    }
    const draft = await this.retrieveDraft(item.draft_order_id)
    const requiresHistory = ["paid", "shipped", "received"].includes(draft.status)

    const patch: Record<string, unknown> = { id }
    if (input.working_name !== undefined) patch.working_name = input.working_name
    if (input.notes !== undefined) patch.notes = input.notes
    if (input.scraped_title !== undefined) patch.scraped_title = input.scraped_title
    if (input.scraped_image_url !== undefined)
      patch.scraped_image_url = input.scraped_image_url
    if (input.source_url !== undefined) patch.source_url = input.source_url
    if (input.source_type !== undefined) patch.source_type = input.source_type
    if (input.uploaded_image_r2_key !== undefined)
      patch.uploaded_image_r2_key = input.uploaded_image_r2_key
    if (input.category_id !== undefined) patch.category_id = input.category_id
    if (input.color_images !== undefined) {
      // Normalize: drop empty/null entries; null whole map if it becomes empty
      const ci = input.color_images
      if (ci === null) {
        patch.color_images = null
      } else {
        const cleaned: Record<string, string> = {}
        for (const [k, v] of Object.entries(ci)) {
          if (typeof v === "string" && v.length > 0) cleaned[k] = v
        }
        patch.color_images =
          Object.keys(cleaned).length === 0 ? null : cleaned
      }
    }

    const oldCost = Number(item.cost_usd)
    const newCost = input.cost_usd
    const costChanging = newCost !== undefined && Number(newCost) !== oldCost

    if (costChanging) {
      if (requiresHistory && (!opts.reason || opts.reason.trim().length === 0)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Cost edit on a ${draft.status} draft requires a reason`,
        )
      }
      patch.cost_usd = newCost
    }

    const svc = this as unknown as {
      updateDraftItems: (data: Record<string, unknown>) => Promise<unknown>
      createDraftCostHistories: (data: Record<string, unknown>) => Promise<unknown>
    }
    await svc.updateDraftItems(patch)

    if (costChanging && requiresHistory) {
      await svc.createDraftCostHistories({
        draft_item_id: id,
        old_cost_usd: oldCost,
        new_cost_usd: newCost,
        reason: opts.reason!.trim(),
        changed_at: new Date(),
      })
    }
    return await this.retrieveItem(id)
  }

  async reorderItem(id: string, newPosition: number) {
    const item = await this.retrieveItem(id)
    const items = await this.listItems(item.draft_order_id)
    const sorted = items.sort((a, b) => a.position - b.position)
    const without = sorted.filter((i) => i.id !== id)
    const clamped = Math.max(0, Math.min(newPosition, without.length))
    const reordered = [
      ...without.slice(0, clamped),
      item,
      ...without.slice(clamped),
    ]
    const svc = this as unknown as {
      updateDraftItems: (data: Record<string, unknown>) => Promise<unknown>
    }
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].position !== i) {
        await svc.updateDraftItems({ id: reordered[i].id, position: i })
      }
    }
  }

  async deleteItem(id: string) {
    await this.assertItemEditable(id)
    const svc = this as unknown as {
      deleteDraftItems: (id: string) => Promise<void>
    }
    await svc.deleteDraftItems(id)
  }

  // ---------- Variants ----------

  async replaceVariants(
    itemId: string,
    variants: Array<{ color: string | null; size: string; qty: number }>,
  ) {
    await this.assertItemEditable(itemId)
    const seen = new Set<string>()
    for (const v of variants) {
      if (!v.size || v.size.trim().length === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "size is required",
        )
      }
      if (!Number.isFinite(v.qty) || v.qty < 0 || Math.trunc(v.qty) !== v.qty) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "qty must be a non-negative integer",
        )
      }
      const key = `${v.color ?? ""}__${v.size}`
      if (seen.has(key)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `duplicate (color, size) row: ${v.color ?? "—"} / ${v.size}`,
        )
      }
      seen.add(key)
    }
    const filtered = variants.filter((v) => v.qty > 0)

    const svc = this as unknown as {
      listDraftVariants: (filters: Record<string, unknown>) => Promise<Array<{ id: string }>>
      deleteDraftVariants: (id: string) => Promise<void>
      createDraftVariants: (data: Record<string, unknown>) => Promise<unknown>
    }
    const existing = await svc.listDraftVariants({ draft_item_id: itemId })
    for (const row of existing) {
      await svc.deleteDraftVariants(row.id)
    }
    for (const v of filtered) {
      await svc.createDraftVariants({
        draft_item_id: itemId,
        color: v.color,
        size: v.size.trim(),
        qty: v.qty,
      })
    }
  }

  async listVariants(itemId: string) {
    const svc = this as unknown as {
      listDraftVariants: (filters: Record<string, unknown>) => Promise<unknown[]>
    }
    return (await svc.listDraftVariants({ draft_item_id: itemId })) as Array<{
      id: string
      color: string | null
      size: string
      qty: number
      received_qty: number | null
      override_price_mur: string | number | null
    }>
  }

  async listCostHistory(itemId: string) {
    const svc = this as unknown as {
      listDraftCostHistories: (filters: Record<string, unknown>) => Promise<unknown[]>
    }
    return (await svc.listDraftCostHistories({ draft_item_id: itemId })) as Array<{
      id: string
      old_cost_usd: string | number
      new_cost_usd: string | number
      reason: string
      changed_at: Date
    }>
  }

  // ---------- Stage B: pricing, receiving, publish, ref ----------

  async setItemPrice(itemId: string, priceMur: number) {
    if (!Number.isFinite(priceMur) || priceMur <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "selling_price_mur must be > 0",
      )
    }
    await this.assertItemEditable(itemId)
    const svc = this as unknown as {
      updateDraftItems: (data: Record<string, unknown>) => Promise<unknown>
    }
    await svc.updateDraftItems({ id: itemId, selling_price_mur: priceMur })
    return await this.retrieveItem(itemId)
  }

  async setVariantOverridePrice(variantId: string, priceMur: number | null) {
    if (priceMur !== null && (!Number.isFinite(priceMur) || priceMur <= 0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "override_price_mur must be > 0 or null",
      )
    }
    const svc = this as unknown as {
      retrieveDraftVariant: (id: string) => Promise<{ draft_item_id: string }>
      updateDraftVariants: (data: Record<string, unknown>) => Promise<unknown>
    }
    const variant = await svc.retrieveDraftVariant(variantId)
    await this.assertItemEditable(variant.draft_item_id)
    await svc.updateDraftVariants({ id: variantId, override_price_mur: priceMur })
  }

  async setReceivedQty(variantId: string, qty: number) {
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "received_qty must be a non-negative integer",
      )
    }
    const svc = this as unknown as {
      retrieveDraftVariant: (id: string) => Promise<{ draft_item_id: string }>
      updateDraftVariants: (data: Record<string, unknown>) => Promise<unknown>
    }
    const variant = await svc.retrieveDraftVariant(variantId)
    await this.assertItemEditable(variant.draft_item_id)
    await svc.updateDraftVariants({ id: variantId, received_qty: qty })
  }

  async markItemPublished(itemId: string, productId: string) {
    if (!productId || productId.trim().length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "productId is required",
      )
    }
    const svc = this as unknown as {
      updateDraftItems: (data: Record<string, unknown>) => Promise<unknown>
    }
    await svc.updateDraftItems({
      id: itemId,
      published_product_id: productId,
      published_at: new Date(),
    })
  }

  async assignItemRef(itemId: string, ref: string) {
    if (!/^IS\d+$/.test(ref)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ref must match IS\\d+",
      )
    }
    const svc = this as unknown as {
      updateDraftItems: (data: Record<string, unknown>) => Promise<unknown>
    }
    await svc.updateDraftItems({ id: itemId, ref })
  }

  async clearItemRef(itemId: string) {
    const svc = this as unknown as {
      updateDraftItems: (data: Record<string, unknown>) => Promise<unknown>
    }
    await svc.updateDraftItems({ id: itemId, ref: null })
  }

  async validateForPush(draftOrderId: string): Promise<PushValidationResult> {
    const draft = await this.retrieveDraft(draftOrderId)
    if (draft.status !== "received") {
      return {
        ok: false,
        items: [
          {
            id: draftOrderId,
            ref_preview: null,
            reasons: ["draft_not_received"],
          },
        ],
      }
    }
    const svc = this as unknown as {
      listDraftItems: (filters: Record<string, unknown>) => Promise<unknown[]>
      listDraftVariants: (filters: Record<string, unknown>) => Promise<unknown[]>
    }
    const rawItems = (await svc.listDraftItems({
      draft_order_id: draftOrderId,
    })) as Array<{
      id: string
      selling_price_mur: string | number | null
      scraped_image_url: string | null
      uploaded_image_r2_key: string | null
      category_id: string | null
      published_product_id: string | null
      ref: string | null
    }>

    const reports: PushValidationResult["items"] = []
    for (const item of rawItems) {
      const reasons: PushValidationReason[] = []
      if (item.published_product_id) {
        reports.push({ id: item.id, ref_preview: item.ref, reasons: [] })
        continue
      }
      if (item.selling_price_mur === null || Number(item.selling_price_mur) <= 0) {
        reasons.push("missing_selling_price")
      }
      if (!item.scraped_image_url && !item.uploaded_image_r2_key) {
        reasons.push("missing_image")
      }
      if (!item.category_id || String(item.category_id).trim().length === 0) {
        reasons.push("missing_category")
      }
      const variants = (await svc.listDraftVariants({
        draft_item_id: item.id,
      })) as Array<{
        qty: string | number | null
        override_price_mur: string | number | null
      }>
      const totalQty = variants.reduce(
        (acc, v) => acc + Number(v.qty ?? 0),
        0,
      )
      if (totalQty <= 0) reasons.push("no_qty")
      const hasInvalidOverride = variants.some((v) => {
        if (v.override_price_mur === null) return false
        const n = Number(v.override_price_mur)
        return !Number.isFinite(n) || n <= 0
      })
      if (hasInvalidOverride) reasons.push("invalid_variant_override_price")
      reports.push({ id: item.id, ref_preview: null, reasons })
    }

    return { ok: reports.every((r) => r.reasons.length === 0), items: reports }
  }

  /**
   * Push a 'received' draft to Medusa: for each unpublished item, allocate
   * the next IS Ref, create a Medusa product (status=published) with a
   * Color/Size or Size-only variant matrix, and seed inventory levels at the
   * default stock location. Per-item rollback on failure clears the assigned
   * Ref so a retry re-allocates; other items keep going.
   *
   * Idempotent: items with `published_product_id` already set are skipped.
   *
   * Container-using ops (core-flows + query.graph) read `this.__container__`
   * which the MedusaService base class populates from its constructor — no
   * need to override the constructor.
   */
  async pushDraftToMedusa(draftOrderId: string): Promise<PushDraftResult> {
    const draft = await this.retrieveDraft(draftOrderId)
    // Status gate intentionally dropped: pushing creates products in `draft`
    // status, invisible to the storefront. Operator flips to `published` per
    // item via the goLive action after real photos are uploaded.
    void draft
    const validation = await this.validateForPush(draftOrderId)
    if (!validation.ok) {
      const failing = validation.items.filter((i) => i.reasons.length)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Push validation failed: ${JSON.stringify(failing)}`,
      )
    }

    // MedusaService base class assigns the DI container to `this.__container__`
    // in its constructor; v2 doesn't expose a public accessor. We need the
    // container to invoke core-flow workflows and query.graph, neither of
    // which are reachable from MedusaService alone.
    const container = (this as unknown as { __container__: unknown })
      .__container__ as {
      resolve: (key: string) => unknown
    }

    const svc = this as unknown as {
      listDraftItems: (filters: Record<string, unknown>) => Promise<unknown[]>
      listDraftVariants: (
        filters: Record<string, unknown>,
      ) => Promise<unknown[]>
    }

    const items = (await svc.listDraftItems({
      draft_order_id: draftOrderId,
    })) as Array<{
      id: string
      working_name: string | null
      selling_price_mur: string | number | null
      scraped_image_url: string | null
      uploaded_image_r2_key: string | null
      color_images: Record<string, string> | null
      category_id: string | null
      published_product_id: string | null
      ref: string | null
    }>

    const pushed: PushDraftResult["pushed"] = []
    const failed: PushDraftResult["failed"] = []

    const salesChannelId =
      process.env.MEDUSA_DEFAULT_SALES_CHANNEL_ID ??
      "sc_01KN07JKHRN9DP25TM5S664C5W"
    const stockLocationId =
      process.env.MEDUSA_DEFAULT_STOCK_LOCATION_ID ??
      "sloc_01KN48PYHQ0DTXXN2N0JWZSAYV"
    const r2PublicUrl = process.env.R2_PUBLIC_URL ?? ""

    for (const item of items) {
      if (item.published_product_id) continue

      let assignedRef: string | null = null
      let createdProductId: string | null = null
      try {
        const manager = (
          container.resolve(ContainerRegistrationKeys.MANAGER) as {
            execute: (sql: string) => Promise<{
              rows?: Array<{ max: number | string | null }>
            }>
          }
        )
        assignedRef = await getNextRef({
          execute: async (sql: string) => {
            const res = await manager.execute(sql)
            return { rows: res.rows ?? [] }
          },
        })
        await this.assignItemRef(item.id, assignedRef)

        const variants = (await svc.listDraftVariants({
          draft_item_id: item.id,
        })) as Array<{
          id: string
          color: string | null
          size: string
          qty: number
          received_qty: number | null
          override_price_mur: string | number | null
        }>
        const usable = variants.filter((v) => Number(v.qty ?? 0) > 0)
        if (usable.length === 0) {
          throw new Error("no_qty")
        }

        const hasColors = usable.some(
          (v) => v.color !== null && v.color !== "",
        )
        const colors = Array.from(
          new Set(
            usable.map((v) => v.color).filter((c): c is string => !!c),
          ),
        )
        const sizes = Array.from(new Set(usable.map((v) => v.size)))

        const itemPriceMur = Number(item.selling_price_mur ?? 0)
        const productOptions = hasColors
          ? [
              { title: "Color", values: colors },
              { title: "Size", values: sizes },
            ]
          : [{ title: "Size", values: sizes }]

        const r2Base = r2PublicUrl.replace(/\/$/, "")
        const colorImageUrls: Record<string, string> = {}
        if (item.color_images && typeof item.color_images === "object") {
          for (const [color, key] of Object.entries(item.color_images)) {
            if (typeof key === "string" && key.length > 0) {
              colorImageUrls[color] = `${r2Base}/${key}`
            }
          }
        }

        const productVariants = usable.map((v) => {
          const priceMur =
            v.override_price_mur !== null
              ? Number(v.override_price_mur)
              : itemPriceMur
          const sku = `${assignedRef}-${v.size}${v.color ? "-" + v.color : ""}`
          const variantOptions: Record<string, string> = hasColors
            ? { Color: v.color ?? "", Size: v.size }
            : { Size: v.size }
          const variantImageUrl =
            v.color && colorImageUrls[v.color] ? colorImageUrls[v.color] : null
          return {
            title: v.color ? `${v.color} / ${v.size}` : v.size,
            sku,
            manage_inventory: true,
            options: variantOptions,
            prices: [
              {
                amount: Math.round(priceMur * 100),
                currency_code: "mur",
              },
            ],
            ...(variantImageUrl
              ? { metadata: { image_urls: [variantImageUrl] } }
              : {}),
          }
        })

        const primaryImageUrl = item.uploaded_image_r2_key
          ? `${r2Base}/${item.uploaded_image_r2_key}`
          : item.scraped_image_url ?? null

        // Build product images list: primary first (becomes thumbnail), then
        // each unique color image. Storefront swaps via variant.metadata.image_url.
        const imageList: string[] = []
        if (primaryImageUrl) imageList.push(primaryImageUrl)
        for (const url of Object.values(colorImageUrls)) {
          if (!imageList.includes(url)) imageList.push(url)
        }

        const productInput = {
          title: (item.working_name && item.working_name.trim()) || assignedRef,
          handle: assignedRef.toLowerCase(),
          status: "draft" as const,
          options: productOptions,
          variants: productVariants,
          sales_channels: [{ id: salesChannelId }],
          ...(item.category_id
            ? { categories: [{ id: item.category_id }] }
            : {}),
          ...(imageList.length > 0
            ? {
                images: imageList.map((url) => ({ url })),
                thumbnail: imageList[0],
              }
            : {}),
        }
        const { result: prodResult } = await createProductsWorkflow(
          container as never,
        ).run({
          input: { products: [productInput] },
        })
        const product = prodResult[0] as { id: string }
        const productId: string = product.id
        createdProductId = productId

        const skuToQty = new Map<string, number>()
        for (const v of usable) {
          const sku = `${assignedRef}-${v.size}${v.color ? "-" + v.color : ""}`
          skuToQty.set(sku, Number(v.qty ?? 0))
        }

        const remoteQuery = container.resolve(
          ContainerRegistrationKeys.QUERY,
        ) as {
          graph: (input: {
            entity: string
            fields: string[]
            filters?: Record<string, unknown>
          }) => Promise<{ data: unknown[] }>
        }
        const { data: variantData } = await remoteQuery.graph({
          entity: "variant",
          fields: ["id", "sku", "inventory_items.inventory.id"],
          filters: { product_id: productId },
        })

        const levelInputs: Array<{
          inventory_item_id: string
          location_id: string
          stocked_quantity: number
        }> = []
        for (const v of variantData as Array<{
          sku: string
          inventory_items?: Array<{ inventory?: { id: string } }>
        }>) {
          const qty = skuToQty.get(v.sku) ?? 0
          const invItemId = v.inventory_items?.[0]?.inventory?.id
          if (!invItemId) continue
          levelInputs.push({
            inventory_item_id: invItemId,
            location_id: stockLocationId,
            stocked_quantity: qty,
          })
        }
        if (levelInputs.length !== usable.length) {
          throw new Error(
            `inventory_link_resolution_failed: expected ${usable.length} inventory items, got ${levelInputs.length}`,
          )
        }

        await createInventoryLevelsWorkflow(container as never).run({
          input: { inventory_levels: levelInputs },
        })

        // Product stays in status="draft" until the operator clicks "Go Live"
        // in the admin (after real photos are uploaded via the script). This
        // lets us push immediately on order placement without exposing
        // half-photographed products on the storefront.
        await this.markItemPublished(item.id, productId)
        pushed.push({
          draft_item_id: item.id,
          ref: assignedRef,
          product_id: productId,
        })
      } catch (err) {
        // Best-effort: delete orphaned draft product if we got that far.
        // It's still in draft so it's invisible to the storefront; this
        // just keeps the admin product list clean.
        if (createdProductId) {
          try {
            await deleteProductsWorkflow(container as never).run({
              input: { ids: [createdProductId] },
            })
          } catch {
            // best-effort
          }
        }
        if (assignedRef) {
          try {
            await this.clearItemRef(item.id)
          } catch {
            // best-effort
          }
        }
        const e = err as Error & { code?: string; type?: string }
        const reason =
          e.code === "23505" && /handle/i.test(e.message)
            ? "ref_collision_retry"
            : e.code
              ? `${e.code}: ${e.message}`
              : e.message
        failed.push({ draft_item_id: item.id, reason })
      }
    }

    return { pushed, failed }
  }

  /**
   * Preview the next IS ref that will be allocated on push. Uses the same
   * SQL path as the real allocator but doesn't write anything. Returns null
   * if container/manager isn't accessible (in which case the admin just
   * hides the preview pill — push itself is unaffected).
   *
   * Lives on the service rather than in the route because routes can't
   * resolve "manager" from req.scope on this Medusa version; the service's
   * MedusaService base class gives us __container__ which can.
   */
  async previewNextRef(): Promise<string | null> {
    try {
      const container = (this as unknown as { __container__: unknown })
        .__container__ as {
        resolve: (key: string) => unknown
      }
      const manager = container.resolve(
        ContainerRegistrationKeys.MANAGER,
      ) as {
        execute: (
          sql: string,
        ) => Promise<{ rows?: unknown[] } | unknown[]>
      }
      return await getNextRef({
        execute: async (sql: string) => {
          const r = await manager.execute(sql)
          const rows = (r as { rows?: unknown[] }).rows ?? (r as unknown[])
          return { rows: rows as Array<{ max: number | string | null }> }
        },
      })
    } catch {
      return null
    }
  }

  /**
   * Flip a pushed draft item's Medusa product from `draft` to `published`.
   * Idempotent: re-running on an already-published product is a no-op.
   * Throws if the item has no published_product_id (i.e. not pushed yet).
   */
  async goLive(itemId: string): Promise<{ product_id: string }> {
    const svc = this as unknown as {
      retrieveDraftItem: (id: string) => Promise<{
        id: string
        published_product_id: string | null
      } | null>
    }
    const item = await svc.retrieveDraftItem(itemId)
    if (!item) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "draft item not found")
    }
    if (!item.published_product_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "item has not been pushed yet",
      )
    }
    const container = (this as unknown as { __container__: unknown })
      .__container__ as { resolve: (key: string) => unknown }
    await updateProductsWorkflow(container as never).run({
      input: {
        products: [
          { id: item.published_product_id, status: "published" as const },
        ],
      },
    })
    return { product_id: item.published_product_id }
  }

  async setReceivedQtyDefaults(draftOrderId: string) {
    // Called on transition into 'received' to default received_qty = qty
    // for any variants where received_qty is null.
    const svc = this as unknown as {
      listDraftItems: (filters: Record<string, unknown>) => Promise<Array<{ id: string }>>
      listDraftVariants: (filters: Record<string, unknown>) => Promise<Array<{ id: string; qty: number; received_qty: number | null }>>
      updateDraftVariants: (data: Record<string, unknown>) => Promise<unknown>
    }
    const items = await svc.listDraftItems({ draft_order_id: draftOrderId })
    for (const item of items) {
      const variants = await svc.listDraftVariants({ draft_item_id: item.id })
      for (const v of variants) {
        if (v.received_qty === null || v.received_qty === undefined) {
          await svc.updateDraftVariants({ id: v.id, received_qty: v.qty })
        }
      }
    }
  }
}

export default SourcingModuleService
