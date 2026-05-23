import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const now = Date.now()
    // carts idle between 1h and 7d
    const upper = new Date(now - ONE_HOUR_MS).toISOString()
    const lower = new Date(now - SEVEN_DAYS_MS).toISOString()

    // Cart totals are top-level computed fields on the cart entity in
    // Medusa v2 (unlike orders, which need summary.*). Request them by name.
    // Ref: https://docs.medusajs.com/resources/commerce-modules/cart/cart-totals
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "completed_at",
        "created_at",
        "updated_at",
        "currency_code",
        "total",
        "subtotal",
        "item_total",
        "shipping_total",
        "discount_total",
        "items.*",
        "shipping_methods.*",
        "shipping_address.*",
        "billing_address.*",
        "customer.*",
      ],
      filters: {
        completed_at: null,
        updated_at: { $gte: lower, $lte: upper },
      },
      pagination: { take: 500, order: { updated_at: "DESC" } },
    })

    if ((carts ?? []).length === 500) {
      logger.warn(
        "[admin/abandoned-carts] result hit 500-row cap — older idle carts truncated",
      )
    }

    res.json({ carts: carts ?? [] })
  } catch (err) {
    const message = (err as Error)?.message ?? "Failed to list abandoned carts"
    logger.error(`[admin/abandoned-carts] ${message}`)
    res.status(500).json({ message })
  }
}
