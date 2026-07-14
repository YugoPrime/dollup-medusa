import {
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"
import { raw, UniqueConstraintViolationException } from "@medusajs/framework/mikro-orm/postgresql"
import type { Context } from "@medusajs/framework/types"
import type { SqlEntityManager } from "@medusajs/framework/mikro-orm/postgresql"

import EventCode from "./models/event-code"
import EventEntry from "./models/event-entry"
import EventReward from "./models/event-reward"
import EventDrawEntry from "./models/event-draw-entry"
import EventSettings from "./models/event-settings"

/**
 * True on a Postgres unique-index violation, regardless of whether MikroORM
 * wrapped it as a typed exception, the raw driver error slipped through, or
 * Medusa's repository layer (`mikroOrmBaseRepositoryFactory` -> `dbErrorMapper`)
 * already intercepted it first and re-threw it as a `MedusaError`
 * (INVALID_DATA, "... already exists.") built via the 2-arg constructor —
 * which leaves `.code` undefined, so the raw driver-code check alone can't
 * see it. `EventCode.code` has a unique index (see models/event-code.ts) —
 * this is what a concurrent `generateCodeBatch` collision on the same
 * random code looks like.
 */
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof UniqueConstraintViolationException) return true
  if ((err as { code?: string })?.code === "23505") return true
  return (
    err instanceof MedusaError &&
    err.type === MedusaError.Types.INVALID_DATA &&
    /already exists/i.test(err.message)
  )
}

export type EventEntryDTO = {
  id: string
  code: string
  email: string
  phone: string
  consent: boolean
  spins_earned: number
  spins_used: number
  review_bonus_claimed: boolean
  social_bonus_claimed: boolean
  customer_id: string | null
  ip: string | null
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
   * Belt-and-braces collision handling:
   *  - A cheap pre-check (`listEventCodes({ code })`) skips the round trip
   *    to a DB constraint error in the common single-caller case.
   *  - The pre-check is inherently check-then-act (racy under concurrent
   *    `generateCodeBatch` calls, or this loop's own earlier iteration in a
   *    rare 32^4 birthday clash), so every insert is still wrapped in a
   *    catch that detects a *mapped* unique-index violation — Medusa's
   *    repository layer intercepts the raw Postgres error and re-throws it
   *    as a `MedusaError` (see `isUniqueViolation`) — and retries with a
   *    freshly rolled code. This guarantees no raw DB error ever escapes
   *    the method, and every code returned is confirmed persisted.
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

      const existing = await this.listEventCodes({ code })
      if (existing.length > 0) {
        // Cheap pre-check caught it — someone already holds this code.
        continue
      }

      try {
        await this.createEventCodes({ code, batch_id: batchId })
        created.push(code)
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Pre-check lost the race (concurrent caller inserted between our
          // check and our insert) — roll a new one and keep going.
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

  /**
   * Redeems the code (single-use, via the atomic `redeemCode`) then creates
   * the entry with `spins_earned = 1`. The entry itself needs no extra
   * atomicity guard here — `redeemCode` already guarantees the code can
   * back at most one entry, so this method can only ever run its
   * `createEventEntries` once per code.
   */
  async createEntry(input: {
    code: string
    email: string
    phone: string
    consent: boolean
    ip?: string
  }): Promise<EventEntryDTO> {
    const email = (input.email ?? "").trim().toLowerCase()
    const phone = (input.phone ?? "").trim()
    if (!email || !/.+@.+\..+/.test(email)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A valid email is required")
    }
    if (!phone) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A phone/WhatsApp number is required")
    }
    // redeemCode enforces single-use + throws NOT_ALLOWED "already used"
    const { code } = await this.redeemCode(input.code)
    const entry = await this.createEventEntries({
      code,
      email,
      phone,
      consent: !!input.consent,
      spins_earned: 1,
      spins_used: 0,
      ip: input.ip ?? null,
    })
    return entry as EventEntryDTO
  }

  /**
   * Claims a bonus spin of the given kind. Atomic + idempotent: the flag
   * flip and the `spins_earned` increment (capped at 3) happen in a single
   * conditional `UPDATE ... WHERE id = ? AND <flag> = false`, mirroring
   * `redeemCodeById_`. Two concurrent claims of the *same* kind can only
   * have one UPDATE match the `<flag> = false` guard — the loser's row is
   * already flagged by the time it runs and its UPDATE affects 0 rows, so
   * it's a no-op. The increment itself is expressed as a raw SQL fragment
   * (`LEAST(spins_earned + 1, 3)`) evaluated by Postgres against the
   * current row under its row lock, not read-then-written in application
   * code — so this is also race-safe across *different* kinds (e.g. a
   * concurrent "review" and "social" claim on the same entry), since the
   * second UPDATE blocks on the row lock and sees the first's committed
   * value before computing its own increment.
   */
  async claimBonusSpin(entryId: string, kind: "review" | "social"): Promise<EventEntryDTO> {
    const flag = kind === "review" ? "review_bonus_claimed" : "social_bonus_claimed"
    await this.claimBonusSpinById_(entryId, flag)
    const entry = await this.retrieveEventEntry(entryId)
    return entry as EventEntryDTO
  }

  @InjectTransactionManager()
  private async claimBonusSpinById_(
    id: string,
    flag: "review_bonus_claimed" | "social_bonus_claimed",
    @MedusaContext() context: Context<SqlEntityManager> = {},
  ): Promise<number> {
    const manager = context.transactionManager!
    return await manager.nativeUpdate(
      "EventEntry",
      { id, [flag]: false },
      { [flag]: true, spins_earned: raw("LEAST(spins_earned + 1, 3)") },
    )
  }
}

export default EventDrawModuleService
