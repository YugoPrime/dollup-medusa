import { model } from "@medusajs/framework/utils"

/**
 * Personal access token for the SHEIN bookmarklet. Single active row at a
 * time — generating a new token revokes any prior unrevoked rows in the
 * service layer.
 *
 * Stored as sha-256 hex of the plaintext. The plaintext is shown to the user
 * exactly once on generation and never returned again from any endpoint.
 */
const PreorderToken = model.define("PreorderToken", {
  id: model.id({ prefix: "pretok" }).primaryKey(),
  token_hash: model.text(),
  expires_at: model.dateTime().nullable(),
  last_used_at: model.dateTime().nullable(),
  revoked_at: model.dateTime().nullable(),
})

export default PreorderToken
