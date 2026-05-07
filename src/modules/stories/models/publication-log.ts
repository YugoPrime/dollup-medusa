import { model } from "@medusajs/framework/utils"

/**
 * Append-only-ish log of products that were "Mark posted". Survives plan and
 * slot deletion (slot_id is nullable; ON DELETE SET NULL is enforced via the
 * raw migration since `model.belongsTo` doesn't expose a SET NULL option).
 *
 * The picker queries this table to enforce the anti-repeat window.
 */
const PublicationLog = model
  .define("PublicationLog", {
    id: model.id({ prefix: "stlog" }).primaryKey(),
    product_id: model.text(),
    slot_id: model.text().nullable(),
    posted_at: model.dateTime(),
  })
  .indexes([
    { on: ["product_id", "posted_at"] },
    { on: ["posted_at"] },
  ])

export default PublicationLog
