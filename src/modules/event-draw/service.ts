import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import EventCode from "./models/event-code"
import EventEntry from "./models/event-entry"
import EventReward from "./models/event-reward"
import EventDrawEntry from "./models/event-draw-entry"
import EventSettings from "./models/event-settings"

class EventDrawModuleService extends MedusaService({
  EventCode,
  EventEntry,
  EventReward,
  EventDrawEntry,
  EventSettings,
}) {
  private static ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I

  normalizeCode(raw: string): string {
    return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "")
  }

  private randomCode(): string {
    const a = EventDrawModuleService.ALPHABET
    let s = ""
    for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]
    return `DUB-${s}`
  }

  async generateCodeBatch(count: number, batchId: string): Promise<string[]> {
    if (!Number.isInteger(count) || count <= 0 || count > 5000) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "count must be 1..5000")
    }
    const created: string[] = []
    const seen = new Set<string>()
    let guard = 0
    while (created.length < count && guard < count * 20) {
      guard++
      const code = this.randomCode()
      if (seen.has(code)) continue
      const existing = await this.listEventCodes({ code })
      if (existing.length) continue
      seen.add(code)
      await this.createEventCodes({ code, batch_id: batchId })
      created.push(code)
    }
    if (created.length < count) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "could not generate enough unique codes")
    }
    return created
  }

  async redeemCode(rawCode: string): Promise<{ code: string }> {
    const code = this.normalizeCode(rawCode)
    const [found] = await this.listEventCodes({ code })
    if (!found) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Code not found")
    }
    if (found.redeemed_at) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Code already used")
    }
    await this.updateEventCodes({ id: found.id, redeemed_at: new Date() })
    return { code }
  }
}

export default EventDrawModuleService
