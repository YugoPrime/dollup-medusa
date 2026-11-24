import { model } from "@medusajs/framework/utils"

// One row per heart: a browser (random id the storefront keeps in
// localStorage) that has a product on its wishlist. No PII: customer_id is
// only set when that browser is signed in, so the admin can count a shopper
// on two devices once. Removing a heart deletes its row.
const WishlistSignal = model
  .define("WishlistSignal", {
    id: model.id({ prefix: "wsig" }).primaryKey(),
    anon_id: model.text(),
    product_id: model.text(),
    customer_id: model.text().nullable(),
  })
  .indexes([
    { on: ["anon_id", "product_id"], unique: true },
    { on: ["product_id"] },
  ])

export default WishlistSignal
