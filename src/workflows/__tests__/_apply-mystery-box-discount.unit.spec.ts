import {
  assertCartHasMysteryBoxDiscount,
  buildMysteryBoxLineItemAdjustments,
  calculateMysteryBoxDiscount,
  MYSTERY_BOX_ADJUSTMENT_CODE,
  MYSTERY_BOX_FLAT_PRICE_MUR,
  readMysteryBoxMetadata,
} from "../apply-mystery-box-discount"

describe("mystery box cart discount helpers", () => {
  it("calculates the discount needed to reach the flat price", () => {
    expect(calculateMysteryBoxDiscount(5000)).toBe(1500)
    expect(calculateMysteryBoxDiscount(10000, 3500)).toBe(6500)
  })

  it("does not discount carts already at or below the flat price", () => {
    expect(calculateMysteryBoxDiscount(3500)).toBe(0)
    expect(calculateMysteryBoxDiscount(2000)).toBe(0)
    expect(calculateMysteryBoxDiscount(0)).toBe(0)
    expect(calculateMysteryBoxDiscount(-100)).toBe(0)
    expect(calculateMysteryBoxDiscount(NaN)).toBe(0)
  })

  it("floors calculated discounts to integer rupees", () => {
    expect(calculateMysteryBoxDiscount(5000.7)).toBe(1500)
  })

  it("allocates the mystery discount across discountable line items", () => {
    const adjustments = buildMysteryBoxLineItemAdjustments(
      {
        id: "cart_1",
        items: [
          { id: "item_1", subtotal: 1000, is_discountable: true },
          { id: "item_2", subtotal: 1500, is_discountable: true },
          { id: "item_3", subtotal: 2000, is_discountable: true },
        ],
      },
      1500,
    )

    expect(adjustments).toEqual([
      expect.objectContaining({
        item_id: "item_1",
        amount: 1000,
        code: MYSTERY_BOX_ADJUSTMENT_CODE,
      }),
      expect.objectContaining({
        item_id: "item_2",
        amount: 500,
        code: MYSTERY_BOX_ADJUSTMENT_CODE,
      }),
    ])
  })

  it("skips non-discountable line items", () => {
    const adjustments = buildMysteryBoxLineItemAdjustments(
      {
        id: "cart_2",
        items: [
          { id: "item_1", subtotal: 1000, is_discountable: false },
          { id: "item_2", subtotal: 2000, is_discountable: true },
        ],
      },
      500,
    )

    expect(adjustments).toEqual([
      expect.objectContaining({
        item_id: "item_2",
        amount: 500,
        code: MYSTERY_BOX_ADJUSTMENT_CODE,
      }),
    ])
  })

  it("throws when the discount exceeds the discountable subtotal", () => {
    expect(() =>
      buildMysteryBoxLineItemAdjustments(
        {
          id: "cart_3",
          items: [{ id: "item_1", subtotal: 1000, is_discountable: true }],
        },
        2000,
      ),
    ).toThrow(/exceeds discountable/i)
  })

  it("parses valid mystery box metadata", () => {
    const metadata = readMysteryBoxMetadata({
      mystery_box: {
        id: "MB-2026-05-06-x7k2",
        size: "M",
        flat_price_mur: 3500,
        original_subtotal_mur: 5200,
        applied_at: "2026-05-06T12:00:00Z",
      },
    })

    expect(metadata).toEqual({
      id: "MB-2026-05-06-x7k2",
      size: "M",
      flat_price_mur: 3500,
      original_subtotal_mur: 5200,
      applied_at: "2026-05-06T12:00:00Z",
    })
  })

  it("ignores missing or malformed mystery box metadata", () => {
    expect(readMysteryBoxMetadata(null)).toBeNull()
    expect(readMysteryBoxMetadata({})).toBeNull()
    expect(readMysteryBoxMetadata({ mystery_box: "bad" })).toBeNull()
    expect(
      readMysteryBoxMetadata({
        mystery_box: {
          id: "x",
          size: "M",
          flat_price_mur: 0,
          original_subtotal_mur: 1,
          applied_at: "now",
        },
      }),
    ).toBeNull()
  })

  it("refuses completion when mystery metadata has no matching adjustment", () => {
    expect(() =>
      assertCartHasMysteryBoxDiscount({
        id: "cart_1",
        subtotal: 5000,
        metadata: {
          mystery_box: {
            id: "MB-2026-05-06-x7k2",
            size: "M",
            flat_price_mur: MYSTERY_BOX_FLAT_PRICE_MUR,
            original_subtotal_mur: 5000,
            applied_at: "2026-05-06T12:00:00Z",
          },
        },
        items: [{ id: "item_1", adjustments: [] }],
      }),
    ).toThrow(/missing/i)
  })

  it("accepts completion when mystery adjustment total matches", () => {
    expect(() =>
      assertCartHasMysteryBoxDiscount({
        id: "cart_1",
        subtotal: 5000,
        metadata: {
          mystery_box: {
            id: "MB-2026-05-06-x7k2",
            size: "M",
            flat_price_mur: MYSTERY_BOX_FLAT_PRICE_MUR,
            original_subtotal_mur: 5000,
            applied_at: "2026-05-06T12:00:00Z",
          },
        },
        items: [
          {
            id: "item_1",
            adjustments: [
              { code: MYSTERY_BOX_ADJUSTMENT_CODE, amount: 1500 },
            ],
          },
        ],
      }),
    ).not.toThrow()
  })
})
