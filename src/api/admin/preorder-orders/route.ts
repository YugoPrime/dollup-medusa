import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/preorder-orders
 *
 * Lists every order placed through the pre-order storefront
 * (metadata.cart_type === "preorder"), most-recent first. The deposit
 * lifecycle (preorder_status, deposit/balance/total, deadline) lives on each
 * order's metadata — the admin UI groups by preorder_status client-side.
 *
 * query.graph has no metadata-filter operator, so we pull recent orders and
 * filter in JS (same pattern as the abandoned-carts + availability-check code).
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "created_at",
        "metadata",
        "items.title",
        "items.quantity",
        "items.thumbnail",
        "items.unit_price",
        "shipping_address.first_name",
        "shipping_address.last_name",
        "shipping_address.phone",
        "shipping_address.city",
        "shipping_address.address_1",
      ],
    })

    const preorders = (orders as Array<{ metadata?: Record<string, unknown> | null }>)
      .filter((o) => (o.metadata ?? {})["cart_type"] === "preorder")
      // Most-recent first.
      .sort((a, b) => {
        const at = Date.parse((a as { created_at?: string }).created_at ?? "")
        const bt = Date.parse((b as { created_at?: string }).created_at ?? "")
        return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0)
      })

    res.json({ orders: preorders })
  } catch (err) {
    logger.error(
      `[admin/preorder-orders] list failed: ${(err as Error).message}`,
    )
    res.status(500).json({ message: "Failed to list pre-order orders" })
  }
}
