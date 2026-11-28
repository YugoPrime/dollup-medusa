import type { PgRaw } from "./loyalty-maintenance"
import type { LoyaltySettingsDTO } from "../modules/loyalty/service"

/**
 * Doll Rewards numbers for the dollup-admin /reports/rewards page.
 * Read-only SQL through PG_CONNECTION (loyalty tables join core order and
 * customer tables in the same database).
 *
 * Segments: member = customer.has_account; DM = email ending ".local";
 * web guest = everyone else. Orders count when not deleted, not cancelled,
 * not a draft; the total is the latest order_summary current_order_total.
 * "Redeemed" counts only real redemptions (type 'redeem'), never refund or
 * cancel reversals, and points moved from guest records to an account are
 * a transfer, not new points.
 */

export type Seg = { people: number; repeaters: number }
export type Share = {
  member_orders: number
  all_orders: number
  member_revenue: number
  all_revenue: number
}
export type LoyaltyStats = {
  generated_at: string
  settings: {
    earn_rate_per_100_mur: number
    redeem_rate_mur_per_100_pts: number
    min_redeem_points: number
    welcome_bonus_points: number
  }
  members: {
    total: number
    ordered: number
    can_redeem: number
    new_per_week: { week: string; count: number }[]
  }
  points: {
    earned_orders: number
    earned_welcome: number
    earned_other: number
    redeemed: number
    redemptions: number
    reversed: number
    outstanding_members: number
    outstanding_other: number
  }
  orders: { last_30_days: Share; since_launch: Share }
  repeat: { member: Seg; web_guest: Seg; dm: Seg }
}

/** Doll Rewards went live on 6 May 2026. */
export const LOYALTY_LAUNCH = new Date("2026-05-06T00:00:00.000Z")
const MU_OFFSET_MS = 4 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WEEKS = 12

const LIVE_ORDER = `o.deleted_at is null and o.canceled_at is null
    and o.status <> 'canceled' and o.is_draft_order = false`

// Internal transfers written by moveGuestPoints (lib/loyalty-maintenance).
const NOT_A_MOVE = `t.reason not like 'Moved to account %'
    and t.reason <> 'Points from orders before your account'
    and t.reason not like 'Move to account % failed%'`

const SQL = {
  members: `/* members */
select count(*) as total,
  count(*) filter (where exists (
    select 1 from "order" o where o.customer_id = c.id and ${LIVE_ORDER})) as ordered,
  count(*) filter (where a.points_balance >= ?) as can_redeem
from customer c
left join loyalty_account a on a.customer_id = c.id and a.deleted_at is null
where c.deleted_at is null and c.has_account = true`,

  new_per_week: `/* new_per_week */
select to_char(date_trunc('week', c.created_at at time zone 'Indian/Mauritius'), 'YYYY-MM-DD') as week,
  count(*) as count
from customer c
where c.deleted_at is null and c.has_account = true and c.created_at >= ?
group by 1`,

  points: `/* points */
select
  sum(t.points) filter (where t.type = 'earn' and t.reason ilike 'order%') as earned_orders,
  sum(t.points) filter (where t.type = 'earn' and t.reason ilike 'welcome%') as earned_welcome,
  sum(t.points) filter (where
    (t.type = 'earn' and t.reason not ilike 'order%' and t.reason not ilike 'welcome%')
    or (t.type = 'adjustment' and t.order_id is null and ${NOT_A_MOVE})) as earned_other,
  -sum(t.points) filter (where t.type = 'redeem') as redeemed,
  count(*) filter (where t.type = 'redeem') as redemptions,
  -sum(t.points) filter (where t.type = 'adjustment' and t.order_id is not null) as reversed
from loyalty_transaction t
where t.deleted_at is null`,

  outstanding: `/* outstanding */
select sum(a.points_balance) filter (where c.has_account = true) as members,
  sum(a.points_balance) filter (where c.has_account is distinct from true) as other
from loyalty_account a
left join customer c on c.id = a.customer_id and c.deleted_at is null
where a.deleted_at is null`,

  orders: `/* orders */
with o as (
  select o.created_at, coalesce(c.has_account, false) as member,
    (select (s.totals->>'current_order_total')::numeric from order_summary s
      where s.order_id = o.id and s.deleted_at is null order by s.version desc limit 1) as total
  from "order" o
  left join customer c on c.id = o.customer_id
  where ${LIVE_ORDER} and o.created_at >= ?
)
select w.name as window,
  count(*) filter (where o.member) as member_orders,
  count(*) as all_orders,
  sum(o.total) filter (where o.member) as member_revenue,
  sum(o.total) as all_revenue
from o
join (values ('since_launch', ?::timestamptz), ('last_30_days', ?::timestamptz)) as w(name, since)
  on o.created_at >= w.since
group by w.name`,

  repeat: `/* repeat */
with o as (
  select lower(coalesce(c.email, o.email)) as em, coalesce(c.has_account, false) as member
  from "order" o
  left join customer c on c.id = o.customer_id
  where ${LIVE_ORDER} and o.created_at >= ?
), p as (
  select em, bool_or(member) as member, count(*) as n from o where em is not null group by em
)
select case when member then 'member' when em like '%.local' then 'dm' else 'web_guest' end as seg,
  count(*) as people,
  count(*) filter (where n >= 2) as repeaters
from p
group by 1`,
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** The 12 Monday week starts (MU calendar) ending with the current one. */
export function muWeekStarts(now: Date, weeks = WEEKS): string[] {
  const mu = new Date(now.getTime() + MU_OFFSET_MS)
  const sinceMonday = (mu.getUTCDay() + 6) % 7
  const monday = Date.UTC(mu.getUTCFullYear(), mu.getUTCMonth(), mu.getUTCDate() - sinceMonday)
  return Array.from({ length: weeks }, (_, i) =>
    new Date(monday - (weeks - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10),
  )
}

const emptyShare = (): Share => ({ member_orders: 0, all_orders: 0, member_revenue: 0, all_revenue: 0 })

export async function getLoyaltyStats(
  pg: PgRaw,
  settings: LoyaltySettingsDTO,
  now: Date = new Date(),
): Promise<LoyaltyStats> {
  const weeks = muWeekStarts(now)
  const firstWeekUtc = new Date(Date.parse(`${weeks[0]}T00:00:00.000Z`) - MU_OFFSET_MS).toISOString()
  const launch = LOYALTY_LAUNCH.toISOString()
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString()

  const [members, perWeek, points, outstanding, orders, repeat] = await Promise.all([
    pg.raw(SQL.members, [settings.min_redeem_points]),
    pg.raw(SQL.new_per_week, [firstWeekUtc]),
    pg.raw(SQL.points),
    pg.raw(SQL.outstanding),
    pg.raw(SQL.orders, [launch, launch, since30]),
    pg.raw(SQL.repeat, [launch]),
  ])

  const m = members.rows[0] ?? {}
  const p = points.rows[0] ?? {}
  const out = outstanding.rows[0] ?? {}
  const countByWeek = new Map(perWeek.rows.map((r) => [String(r.week), num(r.count)]))

  const share = (window: string): Share => {
    const r = orders.rows.find((row) => row.window === window)
    if (!r) return emptyShare()
    return {
      member_orders: num(r.member_orders),
      all_orders: num(r.all_orders),
      member_revenue: num(r.member_revenue),
      all_revenue: num(r.all_revenue),
    }
  }
  const seg = (name: string): Seg => {
    const r = repeat.rows.find((row) => row.seg === name)
    return { people: num(r?.people), repeaters: num(r?.repeaters) }
  }

  return {
    generated_at: now.toISOString(),
    settings: {
      earn_rate_per_100_mur: settings.earn_rate_per_100_mur,
      redeem_rate_mur_per_100_pts: settings.redeem_rate_mur_per_100_pts,
      min_redeem_points: settings.min_redeem_points,
      welcome_bonus_points: settings.welcome_bonus_points,
    },
    members: {
      total: num(m.total),
      ordered: num(m.ordered),
      can_redeem: num(m.can_redeem),
      new_per_week: weeks.map((week) => ({ week, count: countByWeek.get(week) ?? 0 })),
    },
    points: {
      earned_orders: num(p.earned_orders),
      earned_welcome: num(p.earned_welcome),
      earned_other: num(p.earned_other),
      redeemed: num(p.redeemed),
      redemptions: num(p.redemptions),
      reversed: num(p.reversed),
      outstanding_members: num(out.members),
      outstanding_other: num(out.other),
    },
    orders: { last_30_days: share("last_30_days"), since_launch: share("since_launch") },
    repeat: { member: seg("member"), web_guest: seg("web_guest"), dm: seg("dm") },
  }
}
