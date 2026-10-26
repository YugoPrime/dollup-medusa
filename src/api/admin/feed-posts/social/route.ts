import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { setProductNoSocial } from "../../../../lib/product-social"

/**
 * POST /admin/feed-posts/social { product_id, no_social } — the owner's
 * "keep off social" switch. Turning it on replans the product's upcoming grid
 * posts and returns the unposted story slots still holding it.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { product_id?: unknown; no_social?: unknown }
  const productId = typeof body.product_id === "string" ? body.product_id : ""
  if (!productId || typeof body.no_social !== "boolean") {
    res.status(400).json({ message: "product_id (string) and no_social (boolean) are required" })
    return
  }
  try {
    const result = await setProductNoSocial(req.scope, productId, body.no_social)
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = (err as Error)?.message ?? "Update failed"
    res.status(/not found/i.test(msg) ? 404 : 500).json({ message: msg })
  }
}
