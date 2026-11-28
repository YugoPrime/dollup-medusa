/**
 * Doll Rewards clean-up helpers, shared by the subscribers and the
 * POST /admin/loyalty/maintenance route.
 *
 * Raw SQL through the PG_CONNECTION knex instance: these questions join the
 * loyalty module's tables with core order/customer tables, which live in the
 * same Postgres database.
 */

/** The slice of knex these helpers use. */
export type PgRaw = {
  raw: (sql: string, bindings?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
}

type ReverseService = {
  reversePointsForOrder: (
    customerId: string,
    orderId: string,
    options: { reason: string },
  ) => Promise<{ reversed: number; balance: number }>
}

export type CanceledEarnRow = {
  customer_id: string
  order_id: string
  display_id: number | null
  points: number
}

const UNREVERSED_CANCELED_EARNS_SQL = `
select a.customer_id, t.order_id, o.display_id, t.points
from loyalty_transaction t
join loyalty_account a on a.id = t.account_id and a.deleted_at is null
join "order" o on o.id = t.order_id
where t.type = 'earn' and t.deleted_at is null
  and (o.canceled_at is not null or o.status = 'canceled')
  and not exists (
    select 1 from loyalty_transaction r
    where r.account_id = t.account_id and r.order_id = t.order_id
      and r.type = 'adjustment' and r.points < 0 and r.deleted_at is null
  )
order by t.created_at`

/** Earn rows on cancelled orders whose points were never taken back. */
export async function findUnreversedCanceledEarns(pg: PgRaw): Promise<CanceledEarnRow[]> {
  const { rows } = await pg.raw(UNREVERSED_CANCELED_EARNS_SQL)
  return rows.map((r) => ({
    customer_id: String(r.customer_id),
    order_id: String(r.order_id),
    display_id: r.display_id == null ? null : Number(r.display_id),
    points: Number(r.points),
  }))
}

type AdjustService = {
  adjustPoints: (customerId: string, delta: number, options: { reason: string }) => Promise<unknown>
}

export type GuestPointRow = {
  target_customer_id: string
  source_customer_id: string
  points: number
}

/**
 * Guest checkout records (same email as an account, any letter case) that
 * still hold points. Web orders placed before signing up, or while logged
 * out, credit these records, which the customer can never see.
 */
export async function findGuestPointRows(
  pg: PgRaw,
  targetCustomerId?: string,
): Promise<GuestPointRow[]> {
  const sql = `
select r.id as target_customer_id, g.id as source_customer_id, a.points_balance as points
from customer r
join customer g on lower(g.email) = lower(r.email)
  and g.has_account = false and g.deleted_at is null and g.id <> r.id
join loyalty_account a on a.customer_id = g.id and a.deleted_at is null and a.points_balance > 0
where r.has_account = true and r.deleted_at is null${targetCustomerId ? "\n  and r.id = ?" : ""}
order by r.id, g.id`
  const { rows } = await pg.raw(sql, targetCustomerId ? [targetCustomerId] : [])
  return rows.map((r) => ({
    target_customer_id: String(r.target_customer_id),
    source_customer_id: String(r.source_customer_id),
    points: Number(r.points),
  }))
}

/**
 * Move each guest balance into its account: debit the guest record first
 * (adjustPoints refuses to go below zero, so a second run moves nothing),
 * then credit the account. If the credit fails, the guest debit is undone.
 */
export async function moveGuestPoints(
  loyalty: AdjustService,
  rows: GuestPointRow[],
): Promise<{ people: number; points: number }> {
  const people = new Set<string>()
  let points = 0
  for (const row of rows) {
    const amount = Math.floor(Number(row.points))
    if (!(amount > 0)) continue
    try {
      await loyalty.adjustPoints(row.source_customer_id, -amount, {
        reason: `Moved to account ${row.target_customer_id}`,
      })
    } catch {
      continue
    }
    try {
      await loyalty.adjustPoints(row.target_customer_id, amount, {
        reason: "Points from orders before your account",
      })
      people.add(row.target_customer_id)
      points += amount
    } catch {
      await loyalty
        .adjustPoints(row.source_customer_id, amount, {
          reason: `Move to account ${row.target_customer_id} failed, points restored`,
        })
        .catch(() => undefined)
    }
  }
  return { people: people.size, points }
}

type LedgerAccount = {
  id: string
  points_balance: number
  lifetime_earned: number
  lifetime_redeemed: number
}

/** The loyalty service methods followMovedPoints writes through. */
export type FollowService = {
  ensureAccount: (customerId: string) => Promise<LedgerAccount>
  listLoyaltyTransactions: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<{ reason: string; created_at: Date | string }[]>
  updateLoyaltyAccounts: (data: Record<string, unknown>) => Promise<unknown>
  createLoyaltyTransactions: (data: Record<string, unknown>) => Promise<unknown>
}

const MOVED_PREFIX = "Moved to account "

/**
 * A take-back (cancel or refund) runs against the record that earned the
 * points. If that is a guest record whose points already moved to an account
 * (moveGuestPoints), the guest record goes below zero while the account keeps
 * the points. This moves the deficit onto that account instead; the account
 * may go below zero, like any order take-back.
 *
 * Safe to repeat: once the guest record is back at zero there is nothing to do.
 */
export async function followMovedPoints(
  loyalty: FollowService,
  customerId: string,
  options: { orderId: string; reason: string },
): Promise<{ moved: number; target: string | null }> {
  const guest = await loyalty.ensureAccount(customerId)
  if (!(guest.points_balance < 0)) return { moved: 0, target: null }

  const adjustments = await loyalty.listLoyaltyTransactions(
    { account_id: guest.id, type: "adjustment" },
    { order: { created_at: "DESC" } },
  )
  const move = adjustments.find((t) => t.reason?.startsWith(MOVED_PREFIX))
  if (!move) return { moved: 0, target: null }
  const target = move.reason.slice(MOVED_PREFIX.length).trim()
  if (!target || target === customerId) return { moved: 0, target: null }

  const deficit = -guest.points_balance
  await loyalty.updateLoyaltyAccounts({
    id: guest.id,
    points_balance: 0,
    lifetime_earned: guest.lifetime_earned + deficit,
  })
  await loyalty.createLoyaltyTransactions({
    account_id: guest.id,
    type: "adjustment",
    points: deficit,
    reason: `${options.reason}: taken from account ${target} instead`,
    order_id: options.orderId,
  })

  const account = await loyalty.ensureAccount(target)
  await loyalty.updateLoyaltyAccounts({
    id: account.id,
    points_balance: account.points_balance - deficit,
    lifetime_redeemed: account.lifetime_redeemed + deficit,
  })
  await loyalty.createLoyaltyTransactions({
    account_id: account.id,
    type: "adjustment",
    points: -deficit,
    reason: options.reason,
    order_id: options.orderId,
  })
  return { moved: deficit, target }
}

/**
 * Take back an order's points (cancel or refund), following them to the
 * account they moved to if needed. Returns reversePointsForOrder's result.
 */
export async function reverseOrderPoints(
  loyalty: ReverseService & FollowService,
  customerId: string,
  orderId: string,
  reason: string,
): Promise<{ reversed: number; balance: number }> {
  const result = await loyalty.reversePointsForOrder(customerId, orderId, { reason })
  await followMovedPoints(loyalty, customerId, { orderId, reason })
  return result
}

/** Take back the points of each cancelled order. One failure never stops the rest. */
export async function reverseCanceled(
  loyalty: ReverseService & FollowService,
  rows: CanceledEarnRow[],
): Promise<{ orders: number; points: number }> {
  let orders = 0
  let points = 0
  for (const row of rows) {
    try {
      const { reversed } = await reverseOrderPoints(
        loyalty,
        row.customer_id,
        row.order_id,
        `Order #${row.display_id ?? row.order_id} cancelled`,
      )
      if (reversed > 0) {
        orders += 1
        points += Number(reversed)
      }
    } catch {
      // Counted as not done; the dry run shows it again next time.
    }
  }
  return { orders, points }
}
