import { QueryContext } from "@medusajs/framework/utils"
import { murPriceContext } from "../pricing-context"

function fakeQuery(regions: Array<{ id: string }>) {
  return { graph: jest.fn(async () => ({ data: regions })) }
}

describe("murPriceContext", () => {
  it("prices with the Mauritius region, so a sale list that has not started or has ended is ignored", async () => {
    const query = fakeQuery([{ id: "reg_mu" }])

    const ctx = await murPriceContext(query)

    expect(ctx).toMatchObject({ region_id: "reg_mu", currency_code: "mur" })
    expect(QueryContext.isQueryContext(ctx)).toBe(true)
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "region", filters: { currency_code: "mur" } }),
    )
  })

  it("falls back to the currency alone when no MUR region exists", async () => {
    const ctx = await murPriceContext(fakeQuery([]))

    expect(ctx).toMatchObject({ currency_code: "mur" })
    expect(ctx).not.toHaveProperty("region_id")
    expect(QueryContext.isQueryContext(ctx)).toBe(true)
  })
})
