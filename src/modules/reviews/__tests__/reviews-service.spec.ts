import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { REVIEWS_MODULE } from "../index"
import ReviewsModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<ReviewsModuleService>({
  moduleName: REVIEWS_MODULE,
  resolve: "./src/modules/reviews",
  testSuite: ({ service }) => {
    it("creates a pending review and moderates it", async () => {
      const r = await service.createReview({
        order_id: "order_1", email: "r@x.com", rating: 5, body: "Love the fit!",
      })
      expect(r.status).toBe("pending")
      const pub = await service.moderate(r.id, "published")
      expect(pub.status).toBe("published")
    })

    it("rejects an out-of-range rating", async () => {
      await expect(
        service.createReview({ email: "r@x.com", rating: 9, body: "hi there" }),
      ).rejects.toThrow(/1.?5/)
    })
  },
})
