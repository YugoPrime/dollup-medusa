import { RENDER_KEYS } from "./slot-update"

/**
 * One atomic jsonb merge of `patch` into story_slot.metadata. Postgres applies
 * the merge under the row lock, so concurrent writers cannot erase each other's
 * keys (a JS read-merge-write can). Top-level keys only: a key in the patch
 * replaces that key's whole value, and `null` stores JSON null.
 *
 * With `guard`, the write also requires an unposted slot whose current
 * render job is `guard.jobId` (and, optionally, in/not in a given state), so a stale callback cannot overwrite newer state.
 *
 * With `slotGuard`, the write also requires the product_id and pick_attempt the
 * caller read. A swap bumps pick_attempt and a clear nulls product_id, so a
 * write planned from a slot read before either one finds no row.
 */
export type RenderJobStateName = "sent" | "done" | "failed"
export type JobStateGuard = { is?: RenderJobStateName; isNot?: RenderJobStateName }
export type SlotGuard = { productId: string | null; pickAttempt: number | null }

export function mergeSlotMetadataSql(
  slotId: string,
  patch: Record<string, unknown>,
  guard?: { jobId: string; state?: JobStateGuard },
  slotGuard?: SlotGuard,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [JSON.stringify(patch), slotId]
  let guardSql = ""
  if (guard) {
    guardSql = "\n   AND posted_at IS NULL AND metadata -> 'render_job' ->> 'job_id' = ?"
    params.push(guard.jobId)
    if (guard.state?.is) {
      guardSql += "\n   AND metadata -> 'render_job' ->> 'state' = ?"
      params.push(guard.state.is)
    }
    if (guard.state?.isNot) {
      guardSql += "\n   AND (metadata -> 'render_job' ->> 'state') IS DISTINCT FROM ?"
      params.push(guard.state.isNot)
    }
  }
  if (slotGuard) {
    guardSql +=
      "\n   AND product_id IS NOT DISTINCT FROM ? AND pick_attempt IS NOT DISTINCT FROM ?"
    params.push(slotGuard.productId, slotGuard.pickAttempt)
  }
  const sql =
    "UPDATE story_slot\n" +
    "   SET metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb, updated_at = now()\n" +
    " WHERE id = ? AND deleted_at IS NULL" +
    guardSql +
    "\nRETURNING id"
  return { sql, params }
}

/**
 * Atomically removes every render key from a live slot's metadata. Medusa's own
 * update merges metadata and keeps omitted keys, so a swap needs this instead.
 * The keys are trusted constants, inlined as an ARRAY literal.
 */
export function dropRenderKeysSql(slotId: string): { sql: string; params: unknown[] } {
  const keys = RENDER_KEYS.map((k) => `'${k}'`).join(",")
  const sql =
    "UPDATE story_slot\n" +
    `   SET metadata = COALESCE(metadata, '{}'::jsonb) - ARRAY[${keys}]::text[], updated_at = now()\n` +
    " WHERE id = ? AND deleted_at IS NULL\n" +
    "RETURNING id"
  return { sql, params: [slotId] }
}
