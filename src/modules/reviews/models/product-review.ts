import { model } from "@medusajs/framework/utils"

const ProductReview = model.define("ProductReview", {
  id: model.id({ prefix: "prev" }).primaryKey(),
  order_id: model.text().nullable(),
  product_id: model.text().nullable(),
  email: model.text(),
  rating: model.number(),
  body: model.text(),
  status: model.text().default("pending"), // pending | published | rejected
})

export default ProductReview
