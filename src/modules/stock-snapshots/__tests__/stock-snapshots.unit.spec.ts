import { GET } from "../../../api/admin/stock-snapshots/route"
import StockSnapshotsModuleService from "../service"
import { takeStockSnapshot } from "../take-snapshot"

const proto = StockSnapshotsModuleService.prototype

const value = {
  units: 10,
  cost_value_mur: 2000,
  retail_value_mur: 5000,
  uncosted_units: 1,
  products: 3,
}

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (s: number) => {
    res.statusCode = s
    return res
  }
  res.json = (b: unknown) => {
    res.body = b
    return res
  }
  return res
}

describe("StockSnapshotsModuleService.upsertDay", () => {
  it("creates the day's row the first time", async () => {
    const fake = {
      listStockSnapshots: jest.fn(async () => []),
      createStockSnapshots: jest.fn(async (d: object) => ({ id: "stksnap_1", ...d })),
      updateStockSnapshots: jest.fn(),
    }
    await proto.upsertDay.call(fake, "2026-11-26", value)
    expect(fake.listStockSnapshots).toHaveBeenCalledWith({ day: "2026-11-26" }, { take: 1 })
    expect(fake.createStockSnapshots).toHaveBeenCalledWith({ day: "2026-11-26", ...value })
    expect(fake.updateStockSnapshots).not.toHaveBeenCalled()
  })

  it("replaces an earlier run of the same day instead of adding a second row", async () => {
    const fake = {
      listStockSnapshots: jest.fn(async () => [{ id: "stksnap_1", day: "2026-11-26" }]),
      createStockSnapshots: jest.fn(),
      updateStockSnapshots: jest.fn(async (d: object) => d),
    }
    await proto.upsertDay.call(fake, "2026-11-26", { ...value, units: 9 })
    expect(fake.createStockSnapshots).not.toHaveBeenCalled()
    expect(fake.updateStockSnapshots).toHaveBeenCalledWith({ id: "stksnap_1", ...value, units: 9 })
  })
})

describe("StockSnapshotsModuleService.listRange", () => {
  it("lists the range oldest first, without the default page limit", async () => {
    const fake = { listStockSnapshots: jest.fn(async () => []) }
    await proto.listRange.call(fake, "2026-11-01", "2026-11-30")
    expect(fake.listStockSnapshots).toHaveBeenCalledWith(
      { day: { $gte: "2026-11-01", $lte: "2026-11-30" } },
      { order: { day: "ASC" }, take: null },
    )
  })
})

describe("takeStockSnapshot", () => {
  function product(id: string, stock: number, price: number) {
    return {
      id,
      variants: [
        {
          id: `${id}_v`,
          manage_inventory: true,
          metadata: {},
          prices: [{ amount: price, currency_code: "mur", price_list_id: null, rules_count: 0 }],
          inventory_items: [
            { inventory: { location_levels: [{ stocked_quantity: stock, reserved_quantity: 0 }] } },
          ],
        },
      ],
    }
  }

  function scope(pages: unknown[][], total: number) {
    const graph = jest.fn(async ({ pagination }: { pagination: { skip: number } }) => ({
      data: pages[pagination.skip / 100] ?? [],
      metadata: { count: total },
    }))
    const upsertDay = jest.fn(async (day: string, v: object) => ({ id: "stksnap_1", day, ...v }))
    const listDraftItems = jest.fn(async () => [
      {
        published_product_id: "prod_1",
        cost_usd: 2,
        published_at: "2026-11-01T08:00:00Z",
        draft_order: { landed_cost_multiplier: 1.5, received_at: null },
      },
    ])
    const services: Record<string, unknown> = {
      query: { graph },
      sourcing: { listDraftItems },
      sourcing_settings: { getSettings: async () => ({ fx_rate: 50, flat_add_mur: 200 }) },
      stock_snapshots: { upsertDay },
    }
    return {
      scope: { resolve: (k: string) => services[k] },
      graph,
      upsertDay,
      listDraftItems,
    }
  }

  it("reads every page of products, values them, and files them under the Mauritius day", async () => {
    const first = Array.from({ length: 100 }, (_, i) => product(`prod_${i}`, i === 1 ? 4 : 0, 500))
    const second = [product("prod_x", 2, 300)]
    const s = scope([first, second], 101)

    // 20:30 UTC on 25 Nov is 00:30 on 26 Nov in Mauritius.
    const row = await takeStockSnapshot(s.scope, new Date("2026-11-25T20:30:00Z"))

    expect(s.graph).toHaveBeenCalledTimes(2)
    expect(s.listDraftItems).toHaveBeenCalledWith(
      { published_product_id: { $ne: null } },
      { relations: ["draft_order"], take: null },
    )
    // prod_1: 4 pcs at 2 x 50 x 1.5 = Rs 150 (no flat add). prod_x: 2 pcs, no cost.
    expect(s.upsertDay).toHaveBeenCalledWith("2026-11-26", {
      units: 6,
      cost_value_mur: 600,
      retail_value_mur: 4 * 500 + 2 * 300,
      uncosted_units: 2,
      products: 2,
    })
    expect(row.day).toBe("2026-11-26")
  })

  it("stops after one short page", async () => {
    const s = scope([[product("prod_1", 1, 100)]], 1)
    await takeStockSnapshot(s.scope, new Date("2026-11-25T10:00:00Z"))
    expect(s.graph).toHaveBeenCalledTimes(1)
  })
})

describe("GET /admin/stock-snapshots", () => {
  it("rejects a date that isn't a real day", async () => {
    const res = fakeRes()
    const req = {
      query: { from: "2026-13-01", to: "2026-11-25" },
      scope: { resolve: () => ({ listRange: jest.fn() }) },
    }
    await GET(req as any, res)
    expect(res.statusCode).toBe(400)
  })

  it("defaults to the year up to today", async () => {
    const listRange = jest.fn(async () => [{ day: "2026-11-25" }])
    const res = fakeRes()
    await GET({ query: { to: "2026-11-25" }, scope: { resolve: () => ({ listRange }) } } as any, res)
    expect(listRange).toHaveBeenCalledWith("2025-11-26", "2026-11-25")
    expect(res.body).toEqual({ snapshots: [{ day: "2026-11-25" }] })
  })
})
