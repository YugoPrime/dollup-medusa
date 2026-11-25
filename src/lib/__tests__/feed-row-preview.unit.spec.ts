jest.mock("../grid-planner", () => ({ loadGridProduct: jest.fn() }))

import { buildFeedCaption, readFeedCaptionOptionsFromEnv } from "../feed-post-content"
import { previewFeedRow } from "../feed-row-preview"
import { loadGridProduct } from "../grid-planner"
import { BACK, FRONT, GONE, IS2571_PRODUCT, PLANNED_ROW, STORED_SNAPSHOT, whitePng } from "./fixtures/is2571"

const scope = { resolve: jest.fn() } as never

let png: Buffer
beforeAll(async () => {
  png = await whitePng()
})
beforeEach(() => jest.mocked(loadGridProduct).mockReset())

const fetchImage = async (url: string) => {
  if (url === GONE) throw new Error(`HTTP 404 fetching ${url}`)
  return png
}

describe("previewFeedRow", () => {
  it("refreshes a planned row from the live product, as the 18:00 publish does", async () => {
    jest.mocked(loadGridProduct).mockResolvedValue({ product: IS2571_PRODUCT, published: true, socialExcluded: false })

    const preview = await previewFeedRow(scope, PLANNED_ROW, { fetchImage })

    expect(loadGridProduct).toHaveBeenCalledWith(scope, "prod_is2571")
    expect(preview.live).toBe(true)
    expect(preview.image_urls).toEqual([FRONT, BACK])
    expect(preview.product_snapshot).toMatchObject({ name: "Satin Slip Dress", handle: "is2571", price_mur: 1100 })
    // The caption that will go out is rebuilt from the live product, not the stored one.
    expect(preview.caption).toBe(buildFeedCaption(preview.product_snapshot as never, readFeedCaptionOptionsFromEnv()))
    expect(preview.caption).toContain("💰 Rs 1,100")
    expect(preview.images.map((i) => [i.source_url, i.sizes, i.price, i.sku])).toEqual([
      [FRONT, ["S", "M", "L"], { price_mur: 1100, from: false, was_mur: null }, "IS2571"],
      [BACK, ["S", "M", "L"], { price_mur: 1100, from: false, was_mur: null }, "IS2571"],
    ])
    for (const image of preview.images) expect(image.data_url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it("keeps only the reviewed photos still on the product", async () => {
    jest.mocked(loadGridProduct).mockResolvedValue({ product: IS2571_PRODUCT, published: true, socialExcluded: false })

    const preview = await previewFeedRow(scope, { ...PLANNED_ROW, image_urls: [GONE, BACK] }, { fetchImage })

    expect(preview.image_urls).toEqual([BACK])
    expect(preview.images.map((i) => i.source_url)).toEqual([BACK])
  })

  it("shows a posted row as stored, without loading the product", async () => {
    const preview = await previewFeedRow(scope, { ...PLANNED_ROW, status: "posted" }, { fetchImage })

    expect(loadGridProduct).not.toHaveBeenCalled()
    expect(preview.live).toBe(false)
    expect(preview.product_snapshot).toBe(STORED_SNAPSHOT)
    expect(preview.caption).toBe("stored caption")
    expect(preview.images.map((i) => [i.source_url, i.price?.price_mur])).toEqual([
      [FRONT, 1250],
      [BACK, 1250],
    ])
  })

  it("falls back to the stored row when the product is gone, and marks a photo it couldn't draw", async () => {
    jest.mocked(loadGridProduct).mockResolvedValue({ product: null, published: false, socialExcluded: false })

    const preview = await previewFeedRow(scope, { ...PLANNED_ROW, image_urls: [GONE, FRONT] }, { fetchImage })

    expect(preview.live).toBe(false)
    expect(preview.caption).toBe("stored caption")
    expect(preview.images[0]).toMatchObject({ source_url: GONE, data_url: null, error: expect.stringMatching(/HTTP 404/) })
    expect(preview.images[1].data_url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it("shows a row without a product as stored", async () => {
    const preview = await previewFeedRow(scope, { ...PLANNED_ROW, product_id: null }, { fetchImage })

    expect(loadGridProduct).not.toHaveBeenCalled()
    expect(preview.live).toBe(false)
  })
})
