import {
  assertCartHasLoyaltyDiscount,
  buildLoyaltyLineItemAdjustments,
  calculateMaxRedeemablePoints,
  calculateRedemptionDiscount,
  LOYALTY_ADJUSTMENT_PROVIDER_ID,
} from "../apply-loyalty-discount"

describe("loyalty cart discount helpers", () => {
  const settings = {
    min_redeem_points: 500,
    redeem_rate_mur_per_100_pts: 50,
  }

  it("converts 500 points to Rs 250 with the default redemption rate", () => {
    expect(calculateRedemptionDiscount(500, settings)).toBe(250)
  })

  it("caps redeemable points by balance, minimum, and half the subtotal", () => {
    expect(calculateMaxRedeemablePoints(400, 5000, settings)).toBe(0)
    expect(calculateMaxRedeemablePoints(1000, 5000, settings)).toBe(1000)
    expect(calculateMaxRedeemablePoints(10000, 5000, settings)).toBe(5000)
  })

  it("allocates the loyalty discount across discountable line items", () => {
    const adjustments = buildLoyaltyLineItemAdjustments(
      {
        id: "cart_1",
        items: [
          { id: "item_1", subtotal: 100, is_discountable: true },
          { id: "item_2", subtotal: 200, is_discountable: true },
          { id: "item_3", subtotal: 500, is_discountable: false },
        ],
      },
      250,
    )

    expect(adjustments).toEqual([
      expect.objectContaining({
        item_id: "item_1",
        amount: 100,
        provider_id: LOYALTY_ADJUSTMENT_PROVIDER_ID,
      }),
      expect.objectContaining({
        item_id: "item_2",
        amount: 150,
        provider_id: LOYALTY_ADJUSTMENT_PROVIDER_ID,
      }),
    ])
    // Manual adjustments must NOT carry a `code` — Medusa's promotion module
    // strips every coded line-item adjustment on the next refreshCartItems.
    for (const adjustment of adjustments) {
      expect(adjustment).not.toHaveProperty("code")
    }
  })

  it("refuses completion when redemption metadata has no matching adjustment", () => {
    expect(() =>
      assertCartHasLoyaltyDiscount({
        id: "cart_1",
        subtotal: 5000,
        metadata: {
          loyalty_redeem: {
            points: 500,
            discount_mur: 250,
          },
        },
        items: [{ id: "item_1", adjustments: [] }],
      }),
    ).toThrow(/missing/i)
  })

  it("accepts completion when loyalty metadata and adjustment total match", () => {
    expect(() =>
      assertCartHasLoyaltyDiscount({
        id: "cart_1",
        subtotal: 5000,
        metadata: {
          loyalty_redeem: {
            points: 500,
            discount_mur: 250,
          },
        },
        items: [
          {
            id: "item_1",
            adjustments: [
              {
                provider_id: LOYALTY_ADJUSTMENT_PROVIDER_ID,
                amount: 250,
              },
            ],
          },
        ],
      }),
    ).not.toThrow()
  })
})
