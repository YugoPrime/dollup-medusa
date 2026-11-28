import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { POST } from "../../api/admin/loyalty/maintenance/route"
import { LOYALTY_MODULE } from "../../modules/loyalty"

function makeRes() {
  const res: any = {}
  res.status = jest.fn(() => res)
  res.json = jest.fn(() => res)
  return res
}

describe("POST /admin/loyalty/maintenance", () => {
  const raw = jest.fn()
  const reversePointsForOrder = jest.fn()
  const adjustPoints = jest.fn()
  const scope = {
    resolve: (key: unknown) => {
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return { raw }
      if (key === LOYALTY_MODULE) return { reversePointsForOrder, adjustPoints }
      throw new Error(`unexpected resolve ${String(key)}`)
    },
  }
  const call = async (body: unknown) => {
    const res = makeRes()
    await POST({ body, scope } as any, res)
    return res
  }

  beforeEach(() => jest.clearAllMocks())

  it("rejects an unknown job", async () => {
    const res = await call({ job: "nope" })
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("dry-runs by default: counts, changes nothing", async () => {
    raw.mockResolvedValue({
      rows: [
        { customer_id: "c1", order_id: "o1", display_id: 1, points: "30" },
        { customer_id: "c2", order_id: "o2", display_id: 2, points: "12" },
      ],
    })
    const res = await call({ job: "reverse-canceled" })
    expect(reversePointsForOrder).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ job: "reverse-canceled", apply: false, rows: 2, points: 42 }),
    )
  })

  it("applies when asked", async () => {
    raw.mockResolvedValue({
      rows: [{ target_customer_id: "m1", source_customer_id: "g1", points: "40" }],
    })
    adjustPoints.mockResolvedValue({})
    const res = await call({ job: "merge-guest-points", apply: true })
    expect(adjustPoints).toHaveBeenCalledTimes(2)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        apply: true,
        rows: 1,
        points: 40,
        result: { people: 1, points: 40 },
      }),
    )
  })
})
