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

class LeadsModuleService extends MedusaService({ Lead, LeadList }) {
  async createLead(input: CreateLeadInput): Promise<LeadDTO> {
    const name = input.name?.trim() || null
    const phone = input.phone?.trim() || null
    const note = input.note?.trim() || null

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

    const service = this as unknown as {
      createLeads: (input: CreateLeadInput) => Promise<LeadDTO>
    }
    return service.createLeads({ name, phone, note })
  }

  async listActiveLeads(): Promise<LeadDTO[]> {
    const service = this as unknown as {
      listLeads: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<LeadDTO[]>
    }
    const rows = await service.listLeads(
      { used_at: null },
      { order: { created_at: "DESC" }, take: 200 },
    )
    return rows
  }

  async deleteLeadById(id: string): Promise<void> {
    const service = this as unknown as {
      deleteLeads: (id: string) => Promise<void>
    }
    await service.deleteLeads(id)
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
