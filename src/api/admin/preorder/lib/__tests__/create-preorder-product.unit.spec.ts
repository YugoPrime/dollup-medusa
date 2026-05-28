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

  it("accepts color without sheinGoodsId — derives from sheinUrl", () => {
    const input = {
      ...valid,
      colors: [
        {
          name: "Orange",
          sheinUrl: "https://shein.com/Foo-p-12345.html",
          // sheinGoodsId omitted
          images: ["https://img.ltwebstatic.com/x.jpg"],
        },
      ],
    }
    expect(() => validateBookmarkletInput(input)).not.toThrow()
  })

  it("rejects when colors length exceeds 20", () => {
    const bad = {
      ...valid,
      colors: Array.from({ length: 21 }, (_, i) => ({
        name: `c${i}`,
        sheinUrl: "https://shein.com/x-p-1.html",
        images: ["https://img.ltwebstatic.com/x.jpg"],
      })),
    }
    expect(() => validateBookmarkletInput(bad)).toThrow(/max 20/i)
  })

  it("rejects when sheinPriceUsd is absurdly large", () => {
    expect(() =>
      validateBookmarkletInput({ ...valid, sheinPriceUsd: 100000 }),
    ).toThrow(/<= 10000/)
  })

  it("rejects non-https image URL even when allowAnyImageHost is true", () => {
    const bad = {
      ...valid,
      colors: [
        {
          name: "Orange",
          sheinUrl: "https://shein.com/x-p-1.html",
          images: ["http://insecure.example.com/x.jpg"],
        },
      ],
    }
    expect(() => validateBookmarkletInput(bad, { allowAnyImageHost: true })).toThrow(/https:/)
  })

  it("accepts non-SHEIN https image URL when allowAnyImageHost is true", () => {
    const ok = {
      ...valid,
      colors: [
        {
          name: "Orange",
          sheinUrl: "https://shein.com/x-p-1.html",
          images: ["https://r2.example.com/x.jpg"],
        },
      ],
    }
    expect(() => validateBookmarkletInput(ok, { allowAnyImageHost: true })).not.toThrow()
  })

  it("rejects non-SHEIN image URL when allowAnyImageHost is unset (strict default)", () => {
    const bad = {
      ...valid,
      colors: [
        {
          name: "Orange",
          sheinUrl: "https://shein.com/x-p-1.html",
          images: ["https://r2.example.com/x.jpg"],
        },
      ],
    }
    expect(() => validateBookmarkletInput(bad)).toThrow(/img\.ltwebstatic\.com/)
  })
})

// TODO(preorder): add shape-level tests for the workflow input
// (variant fan-out, productImages flat-mapping, thumbnail pick,
//  per-color metadata structure). Blocked on cleanly mocking
// createProductsWorkflow + ContainerRegistrationKeys.LINK.
