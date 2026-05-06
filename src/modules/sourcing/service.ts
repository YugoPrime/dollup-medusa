import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import Supplier from "./models/supplier"
import DraftOrder from "./models/draft-order"
import DraftItem from "./models/draft-item"
import DraftVariant from "./models/draft-variant"
import DraftCostHistory from "./models/draft-cost-history"

export type CreateSupplierInput = {
  name: string
  contact_handle?: string | null
  notes?: string | null
}

export type UpdateSupplierInput = Partial<CreateSupplierInput>

class SourcingModuleService extends MedusaService({
  Supplier,
  DraftOrder,
  DraftItem,
  DraftVariant,
  DraftCostHistory,
}) {
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
    // Block deletion if any draft is past drafting.
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

  // Stub — real impl in next task
  async createDraft(_input: { supplier_id: string }): Promise<{ id: string }> {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "createDraft not yet implemented",
    )
  }
  async transitionDraft(
    _id: string,
    _to: string,
  ): Promise<{ id: string; status: string }> {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "transitionDraft not yet implemented",
    )
  }
}

export default SourcingModuleService
