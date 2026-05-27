import { validateBookmarkletInput } from "../create-preorder-product"

describe("validateBookmarkletInput", () => {
  const valid = {
    title: "Aloruh Halter Dress",
    sheinUrl: "https://shein.com/Aloruh-p-415495791.html",
    sheinPriceUsd: 16.7,
    sizes: ["XS", "S", "M", "L"],
    colors: [
      {
        name: "Orange",
        sheinUrl: "https://shein.com/Aloruh-p-415495791.html",
        sheinGoodsId: "415495791",
        images: [
          "https://img.ltwebstatic.com/v4/orange-1.webp",
          "https://img.ltwebstatic.com/v4/orange-2.webp",
        ],
      },
      {
        name: "Light Yellow",
        sheinUrl: "https://shein.com/Aloruh-p-373210897.html",
        sheinGoodsId: "373210897",
        images: ["https://img.ltwebstatic.com/v4/yellow-1.webp"],
      },
    ],
    bookmarkletVersion: "1.0.0",
  }

  it("passes a valid multi-color payload", () => {
    expect(() => validateBookmarkletInput(valid)).not.toThrow()
  })

  it("rejects when colors is empty", () => {
    expect(() => validateBookmarkletInput({ ...valid, colors: [] })).toThrow(
      /at least one color/i,
    )
  })

  it("rejects when a color has zero images", () => {
    const bad = {
      ...valid,
      colors: [{ ...valid.colors[0], images: [] }],
    }
    expect(() => validateBookmarkletInput(bad)).toThrow(/at least one image/i)
  })

  it("rejects when a color image URL is not on the SHEIN CDN", () => {
    const bad = {
      ...valid,
      colors: [
        { ...valid.colors[0], images: ["https://evil.com/x.jpg"] },
      ],
    }
    expect(() => validateBookmarkletInput(bad)).toThrow(/img\.ltwebstatic/i)
  })

  it("rejects when sheinPriceUsd is zero or negative", () => {
    expect(() =>
      validateBookmarkletInput({ ...valid, sheinPriceUsd: 0 }),
    ).toThrow(/positive/i)
    expect(() =>
      validateBookmarkletInput({ ...valid, sheinPriceUsd: -5 }),
    ).toThrow(/positive/i)
  })

  it("rejects when sizes is empty", () => {
    expect(() => validateBookmarkletInput({ ...valid, sizes: [] })).toThrow(
      /at least one size/i,
    )
  })
})
