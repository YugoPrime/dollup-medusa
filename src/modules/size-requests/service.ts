import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import SizeRequest from "./models/size-request"

export type SizeRequestPlatform =
  | "whatsapp"
  | "instagram"
  | "messenger"
  | "phone"
  | "other"

export type SizeRequestDTO = {
  id: string
  platform: SizeRequestPlatform
  contact: string
  note: string
  created_at: Date
  updated_at: Date
}

export type CreateSizeRequestInput = {
  platform: SizeRequestPlatform
  contact: string
  note: string
}

const ALLOWED_PLATFORMS: ReadonlySet<SizeRequestPlatform> = new Set([
  "whatsapp",
  "instagram",
  "messenger",
  "phone",
  "other",
])

function isPlatform(value: unknown): value is SizeRequestPlatform {
  return (
    typeof value === "string" &&
    ALLOWED_PLATFORMS.has(value as SizeRequestPlatform)
  )
}

class SizeRequestsModuleService extends MedusaService({ SizeRequest }) {
  async createSizeRequest(
    input: CreateSizeRequestInput,
  ): Promise<SizeRequestDTO> {
    const platform = input.platform
    const contact = input.contact?.trim() ?? ""
    const note = input.note?.trim() ?? ""

    if (!isPlatform(platform)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown platform "${String(platform)}"`,
      )
    }
    if (!contact) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Contact is required",
      )
    }
    if (!note) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Size / product note is required",
      )
    }
    if (contact.length > 200) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Contact must be 200 characters or fewer",
      )
    }
    if (note.length > 500) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Note must be 500 characters or fewer",
      )
    }

    const service = this as unknown as {
      createSizeRequests: (
        input: CreateSizeRequestInput,
      ) => Promise<SizeRequestDTO>
    }
    return service.createSizeRequests({ platform, contact, note })
  }

  async listActiveSizeRequests(): Promise<SizeRequestDTO[]> {
    const service = this as unknown as {
      listSizeRequests: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<SizeRequestDTO[]>
    }
    return service.listSizeRequests(
      {},
      { order: { created_at: "DESC" }, take: 200 },
    )
  }

  async deleteSizeRequestById(id: string): Promise<void> {
    const service = this as unknown as {
      deleteSizeRequests: (id: string) => Promise<void>
    }
    await service.deleteSizeRequests(id)
  }
}

export default SizeRequestsModuleService
