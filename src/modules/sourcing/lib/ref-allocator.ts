const IS_HANDLE_RE = /^is(\d+)$/i

export function parseIsHandle(handle: string): number | null {
  const m = handle.match(IS_HANDLE_RE)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function nextRefFromHandles(handles: readonly string[]): string {
  let max = 0
  for (const h of handles) {
    const n = parseIsHandle(h)
    if (n !== null && n > max) max = n
  }
  return `IS${max + 1}`
}

/**
 * Query Medusa products for current max IS\d+ handle and return next.
 * Uses the productModule.list with a regex-style filter via raw query
 * (Medusa v2 query.graph doesn't support regex; we filter in Postgres).
 */
export async function getNextRef(
  manager: { execute: (sql: string) => Promise<{ rows: Array<{ max: number | string | null }> }> },
): Promise<string> {
  const sql = `
    select coalesce(max((substring(handle from '^[Ii][Ss](\\d+)$'))::int), 0) as max
    from product
    where deleted_at is null
      and handle ~* '^is\\d+$'
  `
  const result = await manager.execute(sql)
  const max = Number(result.rows?.[0]?.max ?? 0)
  return `IS${max + 1}`
}
