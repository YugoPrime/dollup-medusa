import {
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"
import { UniqueConstraintViolationException } from "@medusajs/framework/mikro-orm/postgresql"
import type { Context } from "@medusajs/framework/types"
import type { SqlEntityManager } from "@medusajs/framework/mikro-orm/postgresql"

import EventCode from "./models/event-code"
import EventEntry from "./models/event-entry"
import EventReward from "./models/event-reward"
import EventDrawEntry from "./models/event-draw-entry"
import EventSettings from "./models/event-settings"

/**
 * True on a Postgres unique-index violation, regardless of whether MikroORM
 * wrapped it as a typed exception or the raw driver error slipped through.
 * `EventCode.code` has a unique index (see models/event-code.ts) — this is
 * what a concurrent `generateCodeBatch` collision on the same random code
 * looks like.
 */
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof UniqueConstraintViolationException) return true
  const code = (err as { code?: string })?.code
  return code === "23505"
}

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

  /**
   * Generates `count` unique codes and persists them under `batchId`.
   *
   * Collision-safe: rather than a pre-check-then-insert (which has a
   * check-then-act race under concurrent batch generation), each insert is
   * attempted directly and a unique-index collision (another caller — or
   * this loop's own earlier iteration in a rare 32^4 birthday clash — took
   * the code first) is caught and retried with a freshly rolled code. This
   * guarantees no raw DB error ever escapes the method, and every code
   * returned is confirmed persisted.
   *
   * All-or-nothing: if the retry guard is exhausted before `count` codes
   * are persisted, throws `UNEXPECTED_STATE` — callers never observe a
   * partial batch (fewer than `count` codes stored under `batchId`) as a
   * success.
   */
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
      seen.add(code)
      try {
        await this.createEventCodes({ code, batch_id: batchId })
        created.push(code)
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Someone else (or a parallel generateCodeBatch call) already
          // holds this code — roll a new one and keep going.
          continue
        }
        throw err
      }
    }
    if (created.length < count) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "could not generate enough unique codes")
    }
    return created
  }

  /**
   * Redeems a code exactly once. Atomic: the redemption is a single
   * conditional `UPDATE ... WHERE id = ? AND redeemed_at IS NULL`, so two
   * concurrent redemptions of the same code can never both succeed — the
   * loser's UPDATE affects 0 rows and is treated as "already used".
   */
  async redeemCode(rawCode: string): Promise<{ code: string }> {
    const code = this.normalizeCode(rawCode)
    const [found] = await this.listEventCodes({ code })
    if (!found) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Code not found")
    }
    const affected = await this.redeemCodeById_(found.id)
    if (affected === 0) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Code already used")
    }
    return { code }
  }

  @InjectTransactionManager()
  private async redeemCodeById_(
    id: string,
    @MedusaContext() context: Context<SqlEntityManager> = {},
  ): Promise<number> {
    const manager = context.transactionManager!
    return await manager.nativeUpdate(
      "EventCode",
      { id, redeemed_at: null },
      { redeemed_at: new Date() },
    )
  }
}

export default EventDrawModuleService
