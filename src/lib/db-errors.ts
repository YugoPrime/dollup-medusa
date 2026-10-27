/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505), however
 * the ORM wraps it — e.g. two writers planning the same grid date.
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; name?: unknown } | null
  if (!e) return false
  if (e.code === "23505") return true
  if (e.name === "UniqueConstraintViolationException") return true
  return typeof e.message === "string" && /duplicate key value violates unique constraint/i.test(e.message)
}
