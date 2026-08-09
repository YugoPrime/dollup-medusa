import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import ProductReview from "./models/product-review"

export type ProductReviewDTO = {
  id: string; order_id: string | null; product_id: string | null
  email: string; rating: number; body: string; status: string
  created_at: Date; updated_at: Date
}

class ReviewsModuleService extends MedusaService({ ProductReview }) {
  async createReview(input: {
    order_id?: string; product_id?: string; email: string; rating: number; body: string
  }): Promise<ProductReviewDTO> {
    const rating = Number(input.rating)
    const body = (typeof input.body === "string" ? input.body : "").trim()
    const email = (typeof input.email === "string" ? input.email : "").trim().toLowerCase()
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Rating must be 1–5")
    }
    if (body.length < 3 || body.length > 2000) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Review must be 3–2000 characters")
    }
    if (!email) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Email is required")
    const row = await this.createProductReviews({
      order_id: input.order_id ?? null, product_id: input.product_id ?? null,
      email, rating, body, status: "pending",
    })
    return row as ProductReviewDTO
  }

  async moderate(id: string, status: "published" | "rejected"): Promise<ProductReviewDTO> {
    if (status !== "published" && status !== "rejected") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid status")
    }
    const row = await this.updateProductReviews({ id, status })
    return row as ProductReviewDTO
  }
}

export default ReviewsModuleService
