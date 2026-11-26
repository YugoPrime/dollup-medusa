jest.mock("../grid-planner", () => ({ loadGridProduct: jest.fn() }))

import sharp from "sharp"

import { GET } from "../../api/admin/feed-posts/[id]/preview/route"
import { FEED_POSTS_MODULE } from "../../modules/feed-posts"
import { loadGridProduct } from "../grid-planner"
import { BACK, FRONT, GONE, IS2571_PRODUCT, PLANNED_ROW, whitePng } from "./fixtures/is2571"

/**
 * The Feed Planner's "as it will post" view. Pinned before the row → images
 * logic moved to src/lib/feed-row-preview.ts, so the response stays exactly
 * the same: `{ images, live }`, each image `{ source_url, sizes, price, sku,
 * data_url }` (+ `error` when it couldn't be drawn).
 */

let png: Buffer
beforeAll(async () => {
  png = await whitePng()
})

function fakeReq(rows: Array<Record<string, unknown>>, id: string) {
  const feed = { listFeedPosts: jest.fn(async (f: { id: string }) => rows.filter((r) => r.id === f.id)) }
  const scope = {
    resolve: (key: string) => {
      if (key === FEED_POSTS_MODULE) return feed
      throw new Error(`unexpected resolve ${key}`)
    },
  }
  return { params: { id }, scope } as never
}

function fakeRes() {
  const res = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  return res
}

beforeEach(() => {
  jest.mocked(loadGridProduct).mockReset()
  jest.spyOn(global, "fetch").mockImplementation(async (url) => {
    if (String(url) === GONE) return new Response("", { status: 404 })
    return new Response(new Uint8Array(png))
  })
})
afterEach(() => jest.restoreAllMocks())

describe("GET /admin/feed-posts/:id/preview", () => {
  it("draws a planned row from the live product: { images, live: true }", async () => {
    jest.mocked(loadGridProduct).mockResolvedValue({ product: IS2571_PRODUCT, published: true, socialExcluded: false })
    const res = fakeRes()

    await GET(fakeReq([PLANNED_ROW], "fp_1"), res as never)

    expect(loadGridProduct).toHaveBeenCalledWith(expect.anything(), "prod_is2571")
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledTimes(1)
    const body = res.json.mock.calls[0][0]
    expect(Object.keys(body)).toEqual(["images", "live"])
    expect(body.live).toBe(true)
    expect(body.images.map((i: Record<string, unknown>) => Object.keys(i))).toEqual([
      ["source_url", "sizes", "price", "sku", "data_url"],
      ["source_url", "sizes", "price", "sku", "data_url"],
    ])
    expect(body.images.map((i: Record<string, unknown>) => [i.source_url, i.sizes, i.price, i.sku])).toEqual([
      [FRONT, ["S", "M", "L"], { price_mur: 1100, from: false, was_mur: null }, "IS2571"],
      [BACK, ["S", "M", "L"], { price_mur: 1100, from: false, was_mur: null }, "IS2571"],
    ])
    for (const image of body.images) {
      expect(image.data_url).toMatch(/^data:image\/jpeg;base64,/)
      const meta = await sharp(Buffer.from(image.data_url.split(",")[1], "base64")).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 540, 675])
    }
  })

  it("shows a posted row as stored, without loading the product: live false", async () => {
    const res = fakeRes()

    await GET(fakeReq([{ ...PLANNED_ROW, status: "posted", image_urls: [FRONT] }], "fp_1"), res as never)

    expect(loadGridProduct).not.toHaveBeenCalled()
    const body = res.json.mock.calls[0][0]
    expect(Object.keys(body)).toEqual(["images", "live"])
    expect(body.live).toBe(false)
    expect(body.images.map((i: Record<string, unknown>) => [i.source_url, i.sizes, i.price])).toEqual([
      [FRONT, ["S"], { price_mur: 1250, from: false, was_mur: null }],
    ])
  })

  it("falls back to the stored row when the product can't be refreshed, and reports a photo it couldn't draw", async () => {
    jest.mocked(loadGridProduct).mockResolvedValue({ product: null, published: false, socialExcluded: false })
    const res = fakeRes()

    await GET(fakeReq([{ ...PLANNED_ROW, image_urls: [GONE, FRONT] }], "fp_1"), res as never)

    const body = res.json.mock.calls[0][0]
    expect(body.live).toBe(false)
    expect(Object.keys(body.images[0])).toEqual(["source_url", "sizes", "price", "sku", "data_url", "error"])
    expect(body.images[0]).toMatchObject({ source_url: GONE, data_url: null, error: expect.stringMatching(/HTTP 404/) })
    expect(body.images[1].data_url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it("answers 404 for an unknown feed post", async () => {
    const res = fakeRes()

    await GET(fakeReq([PLANNED_ROW], "fp_nope"), res as never)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ message: "Feed post not found" })
  })
})
