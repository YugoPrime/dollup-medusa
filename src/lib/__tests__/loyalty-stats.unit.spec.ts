import { getLoyaltyStats } from "../loyalty-stats"

const settings = {
  id: "loyalty_settings",
  earn_rate_per_100_mur: 2,
  redeem_rate_mur_per_100_pts: 100,
  min_redeem_points: 150,
  welcome_bonus_points: 100,
  points_expiry_months: null,
}

// Postgres hands count/sum back as strings, and an empty sum as null.
const FIXTURES: Record<string, Record<string, unknown>[]> = {
  members: [{ total: "120", ordered: "37", can_redeem: "12" }],
  new_per_week: [
    { week: "2026-11-16", count: "4" },
    { week: "2026-11-23", count: "4" },
  ],
  points: [
    {
      earned_orders: "40859",
      earned_welcome: "12600",
      earned_other: null,
      redeemed: "0",
      redemptions: "0",
      reversed: "155",
    },
  ],
  outstanding: [{ members: "13989", other: "39326" }],
  orders: [
    {
      window: "since_launch",
      member_orders: "42",
      all_orders: "989",
      member_revenue: "72027.00",
      all_revenue: "1677889.50",
    },
  ],
  repeat: [
    { seg: "member", people: "37", repeaters: "5" },
    { seg: "dm", people: "718", repeaters: "88" },
  ],
}

function fakePg() {
  return {
    raw: jest.fn(async (sql: string, _bindings?: unknown[]) => {
      const marker = /\/\* (\w+) \*\//.exec(sql)?.[1] ?? ""
      return { rows: FIXTURES[marker] ?? [] }
    }),
  }
}

describe("getLoyaltyStats", () => {
  const now = new Date("2026-11-27T10:00:00Z") // Friday, MU week starts Mon 23 Nov

  it("turns every Postgres string into a number", async () => {
    const stats = await getLoyaltyStats(fakePg(), settings, now)
    expect(stats.members).toMatchObject({ total: 120, ordered: 37, can_redeem: 12 })
    expect(stats.points).toEqual({
      earned_orders: 40859,
      earned_welcome: 12600,
      earned_other: 0,
      redeemed: 0,
      redemptions: 0,
      reversed: 155,
      outstanding_members: 13989,
      outstanding_other: 39326,
    })
    expect(stats.orders.since_launch).toEqual({
      member_orders: 42,
      all_orders: 989,
      member_revenue: 72027,
      all_revenue: 1677889.5,
    })
  })

  it("fills missing windows and segments with zeros", async () => {
    const stats = await getLoyaltyStats(fakePg(), settings, now)
    expect(stats.orders.last_30_days).toEqual({
      member_orders: 0,
      all_orders: 0,
      member_revenue: 0,
      all_revenue: 0,
    })
    expect(stats.repeat).toEqual({
      member: { people: 37, repeaters: 5 },
      web_guest: { people: 0, repeaters: 0 },
      dm: { people: 718, repeaters: 88 },
    })
  })

  it("gives 12 Monday weeks in Mauritius time, zero-filled", async () => {
    const pg = fakePg()
    const stats = await getLoyaltyStats(pg, settings, now)
    expect(stats.members.new_per_week).toHaveLength(12)
    expect(stats.members.new_per_week[0]).toEqual({ week: "2026-09-07", count: 0 })
    expect(stats.members.new_per_week[10]).toEqual({ week: "2026-11-16", count: 4 })
    expect(stats.members.new_per_week[11]).toEqual({ week: "2026-11-23", count: 4 })
    const weekCall = pg.raw.mock.calls.find(([sql]) => sql.includes("/* new_per_week */"))
    // Monday 7 Sep 00:00 in Mauritius = Sunday 6 Sep 20:00 UTC
    expect(weekCall?.[1]).toEqual(["2026-09-06T20:00:00.000Z"])
  })

  it("passes the redeem minimum and the windows as bindings", async () => {
    const pg = fakePg()
    await getLoyaltyStats(pg, settings, now)
    const call = (m: string) => pg.raw.mock.calls.find(([sql]) => sql.includes(`/* ${m} */`))
    expect(call("members")?.[1]).toEqual([150])
    expect(call("orders")?.[1]).toEqual([
      "2026-05-06T00:00:00.000Z",
      "2026-05-06T00:00:00.000Z",
      "2026-10-28T10:00:00.000Z",
    ])
  })

  it("echoes the rules and the time", async () => {
    const stats = await getLoyaltyStats(fakePg(), settings, now)
    expect(stats.settings).toEqual({
      earn_rate_per_100_mur: 2,
      redeem_rate_mur_per_100_pts: 100,
      min_redeem_points: 150,
      welcome_bonus_points: 100,
    })
    expect(stats.generated_at).toBe("2026-11-27T10:00:00.000Z")
  })
})
