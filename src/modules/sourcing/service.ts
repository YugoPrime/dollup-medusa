import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import Supplier from "./models/supplier"
import DraftOrder, { DRAFT_ORDER_STATUSES } from "./models/draft-order"
import DraftItem from "./models/draft-item"
import DraftVariant from "./models/draft-variant"
import DraftCostHistory from "./models/draft-cost-history"

export type CreateSupplierInput = {
  name: string
  contact_handle?: string | null
  notes?: string | null
}

export type UpdateSupplierInput = Partial<CreateSupplierInput>

type DraftStatus = (typeof DRAFT_ORDER_STATUSES)[number]

const FORWARD: Record<DraftStatus, DraftStatus | null> = {
  drafting: "negotiating",
  negotiating: "paid",
  paid: "shipped",
  shipped: "received",
  received: null,
}

class SourcingModuleService extends MedusaService({
  Supplier,
  DraftOrder,
  DraftItem,
  DraftVariant,
  DraftCostHistory,
}) {
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
    },
    opts: { reason?: string } = {},
  ) {
    const item = await this.retrieveItem(id)
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
    await this.retrieveItem(itemId)
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
}

export default SourcingModuleService
