import {
  isSalePricedLine,
  mysteryBoxExclusion,
} from "../mystery-box-eligibility"

describe("mystery box eligibility", () => {
  const dress = {
    discountable: true,
    metadata: {},
    tags: [{ value: "stock" }],
    categories: [{ handle: "dresses" }],
  }

  it("lets a plain dress in", () => {
    expect(mysteryBoxExclusion(dress)).toBeNull()
    expect(mysteryBoxExclusion({})).toBeNull()
  })

  it("keeps lingerie in (owner has not ruled it out)", () => {
    expect(
      mysteryBoxExclusion({ ...dress, categories: [{ handle: "lingerie" }] }),
    ).toBeNull()
  })

  it("keeps Ali30 (collection30) out, whatever the case", () => {
    expect(
      mysteryBoxExclusion({ ...dress, tags: [{ value: "collection30" }] }),
    ).toBe("excluded_tag")
    expect(
      mysteryBoxExclusion({ ...dress, tags: [{ value: " Collection30 " }] }),
    ).toBe("excluded_tag")
    expect(
      mysteryBoxExclusion({ ...dress, tags: [{ value: "collection28" }] }),
    ).toBeNull()
  })

  it("keeps After Dark (intimates, toys) out", () => {
    expect(
      mysteryBoxExclusion({ ...dress, categories: [{ handle: "toys" }] }),
    ).toBe("excluded_category")
    expect(
      mysteryBoxExclusion({
        ...dress,
        categories: [{ handle: "dresses" }, { handle: "intimates" }],
      }),
    ).toBe("excluded_category")
  })

  it("keeps unlisted and non-discountable products out", () => {
    expect(
      mysteryBoxExclusion({ ...dress, metadata: { unlisted: true } }),
    ).toBe("unlisted")
    expect(mysteryBoxExclusion({ ...dress, discountable: false })).toBe(
      "not_discountable",
    )
  })

  it("spots lines priced from a sale price list", () => {
    expect(
      isSalePricedLine({ unit_price: 550, compare_at_unit_price: 1100 }),
    ).toBe(true)
    expect(
      isSalePricedLine({
        unit_price: { value: "550" },
        compare_at_unit_price: { value: "1100" },
      }),
    ).toBe(true)
    expect(
      isSalePricedLine({ unit_price: 1100, compare_at_unit_price: 1100 }),
    ).toBe(false)
    expect(
      isSalePricedLine({ unit_price: 1100, compare_at_unit_price: null }),
    ).toBe(false)
    expect(isSalePricedLine({ unit_price: 1100 })).toBe(false)
  })
})
