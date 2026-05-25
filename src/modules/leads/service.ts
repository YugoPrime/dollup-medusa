import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import Lead from "./models/lead"
import LeadList from "./models/lead-list"

export type LeadDTO = {
  id: string
  name: string | null
  phone: string | null
  note: string | null
  used_at: Date | null
  used_for_order_id: string | null
  created_at: Date
  updated_at: Date
}

export type CreateLeadInput = {
  name?: string | null
  phone?: string | null
  note?: string | null
  list_id?: string
}

export type LeadListDTO = {
  id: string
  name: string
  created_at: Date
  updated_at: Date
}

export type LeadListWithCountDTO = LeadListDTO & { lead_count: number }

export type CreateLeadListInput = { name: string }
export type RenameLeadListInput = { id: string; name: string }
export type DeleteLeadListInput = { id: string; move_to: string }

export type UpdateLeadInput = {
  id: string
  name?: string | null
  phone?: string | null
  note?: string | null
  list_id?: string
}

export type MatchAndUseInput = {
  name?: string | null
  phone?: string | null
  order_id: string
}

export function normalizeName(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value.trim().replace(/\s+/g, " ").toLowerCase()
  return cleaned.length === 0 ? null : cleaned
}

// Mauritian mobile numbers are 8 digits. Strip non-digits and take the last 8
// so "+230 5123 4567" matches "57123 4567" matches "57123467" (typo) closely
// enough for operator UX. Operators can always delete a mis-matched lead.
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, "")
  if (digits.length === 0) return null
  return digits.slice(-8)
}

function validateListName(name: string): string {
  const trimmed = (name ?? "").trim()
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "List name must be 1..80 characters",
    )
  }
  return trimmed
}

class LeadsModuleService extends MedusaService({ Lead, LeadList }) {
  async createLead(input: CreateLeadInput): Promise<LeadDTO> {
    const name = input.name?.trim() || null
    const phone = input.phone?.trim() || null
    const note = input.note?.trim() || null
    const list_id = input.list_id?.trim() || "leadlist_general"

    if (!name && !phone) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Lead requires at least a name or a phone number",
      )
    }

    if (name && name.length > 200) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Name must be 200 characters or fewer",
      )
    }
    if (phone && phone.length > 50) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Phone must be 50 characters or fewer",
      )
    }
    if (note && note.length > 500) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Note must be 500 characters or fewer",
      )
    }

    // Verify the target list exists; otherwise fall back to General. The
    // generated listLeadLists method (lowercase l) is the framework's CRUD
    // helper — distinct from the custom getLeadListsWithCounts wrapper added
    // in B1.
    const service = this as unknown as {
      createLeads: (input: {
        name: string | null
        phone: string | null
        note: string | null
        list_id: string
      }) => Promise<LeadDTO>
      listLeadLists: (
        filters: Record<string, unknown>,
      ) => Promise<Array<{ id: string }>>
    }
    const found = await service.listLeadLists({ id: list_id })
    const safeListId = found.length > 0 ? list_id : "leadlist_general"

    return service.createLeads({ name, phone, note, list_id: safeListId })
  }

  async listActiveLeads(filters?: {
    list_id?: string
    used?: boolean
  }): Promise<LeadDTO[]> {
    const service = this as unknown as {
      listLeads: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<LeadDTO[]>
    }
    const where: Record<string, unknown> = {}
    if (filters?.used === true) {
      where.used_at = { $ne: null }
    } else if (filters?.used === false || filters?.used === undefined) {
      where.used_at = null
    }
    if (filters?.list_id) {
      where.list_id = filters.list_id
    }
    const rows = await service.listLeads(where, {
      order: { created_at: "DESC" },
      take: 200,
    })
    return rows
  }

  async deleteLeadById(id: string): Promise<void> {
    const service = this as unknown as {
      deleteLeads: (id: string) => Promise<void>
    }
    await service.deleteLeads(id)
  }

  async createLeadList(input: CreateLeadListInput): Promise<LeadListDTO> {
    const name = validateListName(input.name)
    const service = this as unknown as {
      createLeadLists: (input: CreateLeadListInput) => Promise<LeadListDTO>
    }
    return service.createLeadLists({ name })
  }

  async getLeadListsWithCounts(): Promise<LeadListWithCountDTO[]> {
    const service = this as unknown as {
      listLeadLists: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<LeadListDTO[]>
      listLeads: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<Array<{ list_id: string }>>
    }
    const [lists, activeLeads] = await Promise.all([
      service.listLeadLists({}, { order: { created_at: "ASC" } }),
      service.listLeads({ used_at: null }, { take: 1000 }),
    ])
    const counts = new Map<string, number>()
    for (const l of activeLeads) {
      counts.set(l.list_id, (counts.get(l.list_id) ?? 0) + 1)
    }
    return lists.map((l) => ({ ...l, lead_count: counts.get(l.id) ?? 0 }))
  }

  async renameLeadList(input: RenameLeadListInput): Promise<LeadListDTO> {
    const name = validateListName(input.name)
    const service = this as unknown as {
      updateLeadLists: (
        input: { id: string; name: string },
      ) => Promise<LeadListDTO>
    }
    return service.updateLeadLists({ id: input.id, name })
  }

  async deleteLeadList(input: DeleteLeadListInput): Promise<void> {
    if (input.id === input.move_to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot move leads to the list being deleted",
      )
    }
    const service = this as unknown as {
      retrieveLeadList: (id: string) => Promise<LeadListDTO | null>
      listLeadLists: (
        filters: Record<string, unknown>,
      ) => Promise<LeadListDTO[]>
      listLeads: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<Array<{ id: string }>>
      updateLeads: (
        input: { id: string; list_id: string },
      ) => Promise<unknown>
      deleteLeadLists: (id: string) => Promise<void>
    }

    const allLists = await service.listLeadLists({})
    if (allLists.length <= 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot delete the last remaining list",
      )
    }
    const target = allLists.find((l) => l.id === input.move_to)
    if (!target) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "move_to list does not exist",
      )
    }

    const leadsInList = await service.listLeads(
      { list_id: input.id },
      { take: 1000 },
    )
    for (const lead of leadsInList) {
      await service.updateLeads({ id: lead.id, list_id: input.move_to })
    }
    await service.deleteLeadLists(input.id)
  }

  async updateLead(input: UpdateLeadInput): Promise<LeadDTO> {
    const patch: Record<string, unknown> = { id: input.id }
    if (input.name !== undefined) {
      const trimmed = input.name?.trim() || null
      if (trimmed && trimmed.length > 200) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Name must be 200 characters or fewer",
        )
      }
      patch.name = trimmed
    }
    if (input.phone !== undefined) {
      const trimmed = input.phone?.trim() || null
      if (trimmed && trimmed.length > 50) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Phone must be 50 characters or fewer",
        )
      }
      patch.phone = trimmed
    }
    if (input.note !== undefined) {
      const trimmed = input.note?.trim() || null
      if (trimmed && trimmed.length > 500) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Note must be 500 characters or fewer",
        )
      }
      patch.note = trimmed
    }
    if (input.list_id !== undefined) {
      patch.list_id = input.list_id
    }

    const service = this as unknown as {
      updateLeads: (input: Record<string, unknown>) => Promise<LeadDTO>
    }
    return service.updateLeads(patch)
  }

  // Returns how many leads were marked used. Matches active (used_at IS NULL)
  // rows by normalized name OR normalized phone; ties are resolved by oldest
  // created_at first (FIFO conversion).
  async matchAndUse(input: MatchAndUseInput): Promise<{ matched: number }> {
    const targetName = normalizeName(input.name)
    const targetPhone = normalizePhone(input.phone)

    if (!targetName && !targetPhone) {
      return { matched: 0 }
    }

    const service = this as unknown as {
      listLeads: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<LeadDTO[]>
      updateLeads: (
        input: { id: string; used_at: Date; used_for_order_id: string },
      ) => Promise<LeadDTO>
    }

    const active = await service.listLeads(
      { used_at: null },
      { order: { created_at: "ASC" }, take: 500 },
    )

    const matchedIds: string[] = []
    for (const row of active) {
      const rowName = normalizeName(row.name)
      const rowPhone = normalizePhone(row.phone)
      const nameHit = !!(targetName && rowName && rowName === targetName)
      const phoneHit = !!(targetPhone && rowPhone && rowPhone === targetPhone)
      if (nameHit || phoneHit) {
        matchedIds.push(row.id)
      }
    }

    const now = new Date()
    for (const id of matchedIds) {
      await service.updateLeads({
        id,
        used_at: now,
        used_for_order_id: input.order_id,
      })
    }

    return { matched: matchedIds.length }
  }
}

export default LeadsModuleService
