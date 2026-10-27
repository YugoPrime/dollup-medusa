import { DEFAULT_WEIGHTING } from "../../modules/stories/picker-weighting"
import type { ProductLike } from "../../modules/stories/snapshot"
import {
  gridRowProblem,
  nextRotationKey,
  pickGridProduct,
  rotationKeyForProduct,
} from "../grid-rotation"

const NOW = Date.parse("2026-11-20T12:00:00Z")
const F = ["collection30"]

function make(id: string, opts: { tags?: string[]; qty?: number } = {}): ProductLike {
  return {
    id,
    title: id,
    handle: id,
    created_at: "2026-01-01T00:00:00Z",
    tags: opts.tags ?? [],
    variants: [
      {
        id: `${id}_v`,
        inventory_quantity: opts.qty ?? 2,
        prices: [{ amount: 100000, currency_code: "mur" }],
        options: { color: "Red", size: "M" },
      },
    ],
  }
}

describe("nextRotationKey", () => {
  it("walks dresses → lingerie → beachwear → dresses", () => {
    expect(nextRotationKey("dresses")).toBe("lingerie")
    expect(nextRotationKey("lingerie")).toBe("beachwear")
    expect(nextRotationKey("beachwear")).toBe("dresses")
  })

  it("starts at dresses for null or a category outside the rotation", () => {
    expect(nextRotationKey(null)).toBe("dresses")
    expect(nextRotationKey("tops")).toBe("dresses")
  })
})

describe("rotationKeyForProduct", () => {
  const ids = {
    dresses: new Set(["pcat_d"]),
    lingerie: new Set(["pcat_l"]),
    beachwear: new Set(["pcat_beach", "pcat_bikini"]),
  }

  it("maps a child category to its rotation key", () => {
    expect(rotationKeyForProduct(["pcat_bikini"], ids)).toBe("beachwear")
  })

  it("returns null outside the three categories", () => {
    expect(rotationKeyForProduct(["pcat_tops"], ids)).toBeNull()
  })
})

describe("pickGridProduct", () => {
  const base = {
    excluded: new Set<string>(),
    dedupSince: "2026-10-01",
    weighting: DEFAULT_WEIGHTING,
    now: NOW,
  }

  it("prefers a focus piece never posted on the grid", () => {
    const r = pickGridProduct({
      ...base,
      candidates: [make("focusPosted", { tags: F }), make("focusNew", { tags: F })],
      focusTag: "collection30",
      lastGridDateByProduct: new Map([["focusPosted", "2026-11-02"]]),
      rng: () => 0,
    })
    expect(r?.id).toBe("focusNew")
  })

  it("second round: the focus piece posted longest ago", () => {
    const r = pickGridProduct({
      ...base,
      candidates: [make("fA", { tags: F }), make("fB", { tags: F })],
      focusTag: "collection30",
      lastGridDateByProduct: new Map([
        ["fA", "2026-11-20"],
        ["fB", "2026-11-05"],
      ]),
    })
    expect(r?.id).toBe("fB")
  })

  it("without a focus piece: older stock not posted since dedupSince", () => {
    const r = pickGridProduct({
      ...base,
      dedupSince: "2026-10-15",
      candidates: [make("oldRecent"), make("oldStale")],
      focusTag: "collection30",
      lastGridDateByProduct: new Map([
        ["oldRecent", "2026-11-10"],
        ["oldStale", "2026-09-01"],
      ]),
    })
    expect(r?.id).toBe("oldStale")
  })

  it("returns null when everything is excluded", () => {
    const r = pickGridProduct({
      ...base,
      dedupSince: "2026-10-15",
      candidates: [make("fA", { tags: F })],
      focusTag: "collection30",
      lastGridDateByProduct: new Map(),
      excluded: new Set(["fA"]),
    })
    expect(r).toBeNull()
  })

  it("with focus off, never re-posts inside the dedup window", () => {
    const r = pickGridProduct({
      ...base,
      dedupSince: "2026-10-15",
      candidates: [make("fA", { tags: F })],
      focusTag: null,
      lastGridDateByProduct: new Map([["fA", "2026-11-01"]]),
    })
    expect(r).toBeNull()
  })
})

describe("gridRowProblem", () => {
  const ok = make("ok")

  it("flags a sold-out product", () => {
    expect(
      gridRowProblem({ product: make("s", { qty: 0 }), storyProductIds: new Set(), socialExcluded: false, published: true }),
    ).toBe("sold_out")
  })

  it("flags a product already in that day's stories", () => {
    expect(
      gridRowProblem({ product: ok, storyProductIds: new Set([ok.id]), socialExcluded: false, published: true }),
    ).toBe("in_stories")
  })

  it("flags a product switched off social", () => {
    expect(gridRowProblem({ product: ok, storyProductIds: new Set(), socialExcluded: true, published: true })).toBe(
      "off_social",
    )
  })

  it("flags a missing or unpublished product", () => {
    expect(gridRowProblem({ product: null, storyProductIds: new Set(), socialExcluded: false, published: false })).toBe(
      "missing",
    )
    expect(gridRowProblem({ product: ok, storyProductIds: new Set(), socialExcluded: false, published: false })).toBe(
      "unpublished",
    )
  })

  it("passes a valid product", () => {
    expect(gridRowProblem({ product: ok, storyProductIds: new Set(), socialExcluded: false, published: true })).toBeNull()
  })
})

import { refreshGridContent, stepAfterInspection } from "../grid-rotation"

describe("refreshGridContent", () => {
  const withImages = (price: number, urls: string[]): ProductLike => ({
    id: "p",
    title: "Red Dress",
    handle: "is2451",
    variants: [
      {
        id: "v",
        inventory_quantity: 3,
        prices: [{ amount: price * 100, currency_code: "mur" }],
        options: { color: "Red", size: "M" },
        images: urls.map((url) => ({ url })),
      },
    ],
  })

  it("re-prices the caption from the live product", () => {
    const r = refreshGridContent(["https://cdn/a.jpg"], withImages(990, ["https://cdn/a.jpg"]))
    expect(r?.caption).toContain("Rs 990")
  })

  it("keeps only reviewed photos that are still on the product, in reviewed order", () => {
    const r = refreshGridContent(
      ["https://cdn/b.jpg", "https://cdn/gone.jpg", "https://cdn/a.jpg"],
      withImages(990, ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/new.jpg"]),
    )
    expect(r?.image_urls).toEqual(["https://cdn/b.jpg", "https://cdn/a.jpg"])
  })

  it("returns null when none of the reviewed photos is left", () => {
    expect(refreshGridContent(["https://cdn/gone.jpg"], withImages(990, ["https://cdn/a.jpg"]))).toBeNull()
  })
})

describe("stepAfterInspection", () => {
  it("publishes a valid planned or failed row", () => {
    expect(stepAfterInspection("planned", null)).toBe("publish")
    expect(stepAfterInspection("failed", null)).toBe("publish")
  })
  it("replaces a planned row that can no longer go out", () => {
    expect(stepAfterInspection("planned", "sold_out")).toBe("replace")
  })
  it("never retries a failed row that can no longer go out", () => {
    expect(stepAfterInspection("failed", "off_social")).toBe("skip_with_alert")
  })
})
