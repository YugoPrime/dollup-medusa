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

  // Stubs that earlier tests reference — full impls come in Task 6.
  async createItem(_input: {
    draft_order_id: string
    working_name?: string | null
    source_url?: string | null
    source_type?: "alibaba" | "pdf" | "manual"
    scraped_title?: string | null
    scraped_image_url?: string | null
    cost_usd?: number
    notes?: string | null
    uploaded_image_r2_key?: string | null
  }): Promise<{
    id: string
    draft_order_id: string
    working_name: string | null
    source_url: string | null
    source_type: "alibaba" | "pdf" | "manual"
    cost_usd: string | number
    position: number
  }> {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "createItem not yet implemented",
    )
  }

  async replaceVariants(
    _itemId: string,
    _variants: Array<{ color: string | null; size: string; qty: number }>,
  ): Promise<void> {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "replaceVariants not yet implemented",
    )
  }
}

export default SourcingModuleService
