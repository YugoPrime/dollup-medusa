import type { ProductLike } from "../snapshot"
import { clearSlotProductUpdate, swapSlotUpdate } from "../slot-update"

const PRODUCT: ProductLike = {
  id: "p_new",
  title: "New Dress",
  handle: "is2451",
  variants: [
    {
      id: "v1",
      inventory_quantity: 2,
      prices: [{ amount: 129000, currency_code: "mur" }],
      options: { color: "Red", size: "M" },
      images: [{ url: "https://cdn/is2451-red.jpg" }],
    },
  ],
}

const SLOT = {
  id: "stslot_1",
  pick_attempt: 1,
  metadata: {
    render: { template_slug: "cutout-spotlight", mp4_url: "https://cdn/old.mp4" },
    render_error: { message: "x" },
    render_started_at: "2026-11-02T10:00:00Z",
    publish_error: { message: "earlier" },
  },
}

describe("swapSlotUpdate", () => {
  it("drops the old product's render so its video can never post", () => {
    const u = swapSlotUpdate(SLOT, PRODUCT)
    expect(u.metadata).not.toHaveProperty("render")
    expect(u.metadata).not.toHaveProperty("render_error")
    expect(u.metadata).not.toHaveProperty("render_started_at")
  })

  it("keeps other metadata, sets the new product and bumps pick_attempt", () => {
    const u = swapSlotUpdate(SLOT, PRODUCT)
    expect(u.metadata).toHaveProperty("publish_error")
    expect(u.product_id).toBe("p_new")
    expect(u.product_snapshot.handle).toBe("is2451")
    expect(u.pick_attempt).toBe(2)
    expect(u.fallback_used).toBe(false)
  })
})

describe("clearSlotProductUpdate", () => {
  it("empties the slot and drops its render", () => {
    const u = clearSlotProductUpdate(SLOT)
    expect(u.product_id).toBeNull()
    expect(u.product_snapshot).toBeNull()
    expect(u.metadata).not.toHaveProperty("render")
  })
})
