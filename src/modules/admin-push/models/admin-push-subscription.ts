import { model } from "@medusajs/framework/utils"

// One row per browser/device that opted in to admin push. `endpoint` is the
// push service URL and is unique per device (enforced by a DB index; the
// service upserts on it). Rows are hard-deleted when the push service reports
// the subscription gone (404/410) or the user disables notifications.
const AdminPushSubscription = model.define("AdminPushSubscription", {
  id: model.id({ prefix: "apush" }).primaryKey(),
  endpoint: model.text(),
  p256dh: model.text(),
  auth: model.text(),
  username: model.text(),
  user_agent: model.text().nullable(),
})

export default AdminPushSubscription
