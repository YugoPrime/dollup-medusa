import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { FEED_POSTS_MODULE } from "../index"
import FeedPostsModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<FeedPostsModuleService>({
  moduleName: FEED_POSTS_MODULE,
  resolve: "./src/modules/feed-posts",
  testSuite: ({ service }) => {
    describe("FeedPostsModuleService — planner methods", () => {
      beforeEach(async () => {
        await service.createPlanned({
          post_date: "2026-07-01", product_id: "prod_a",
          product_snapshot: null, image_urls: ["x"], caption: null,
        })
        await service.createPlanned({
          post_date: "2026-07-05", product_id: "prod_b",
          product_snapshot: null, image_urls: ["y"], caption: null,
          status: "posted",
        })
        await service.createPlanned({
          post_date: "2026-07-20", product_id: "prod_c",
          product_snapshot: null, image_urls: ["z"], caption: null,
        })
      })

      it("listByDateRange returns only rows within the inclusive range", async () => {
        const rows = await service.listByDateRange("2026-07-01", "2026-07-10")
        const dates = rows.map((r) => r.post_date).sort()
        expect(dates).toEqual(["2026-07-01", "2026-07-05"])
      })

      it("deletePlannedByDate deletes only planned rows, never posted", async () => {
        const deletedPlanned = await service.deletePlannedByDate("2026-07-01")
        expect(deletedPlanned).toBe(1)
        const deletedPosted = await service.deletePlannedByDate("2026-07-05")
        expect(deletedPosted).toBe(0)
        const remaining = await service.listByDateRange("2026-07-01", "2026-07-31")
        expect(remaining.map((r) => r.post_date).sort()).toEqual([
          "2026-07-05", "2026-07-20",
        ])
      })
    })
  },
})
