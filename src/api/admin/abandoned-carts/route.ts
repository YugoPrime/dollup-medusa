import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000

type CartLike = {
  summary?: { current_order_total?: number; original_order_total?: number }
} & Record<string, unknown>

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

    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "completed_at",
        "created_at",
        "updated_at",
        "currency_code",
        "summary.*",
        "items.*",
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

    const shaped = (carts ?? []).map((c: CartLike) => ({
      ...c,
      total:
        c.summary?.current_order_total ??
        c.summary?.original_order_total ??
        0,
    }))

    if (shaped.length === 500) {
      logger.warn(
        "[admin/abandoned-carts] result hit 500-row cap — older idle carts truncated",
      )
    }

    res.json({ carts: shaped })
  } catch (err) {
    const message = (err as Error)?.message ?? "Failed to list abandoned carts"
    logger.error(`[admin/abandoned-carts] ${message}`)
    res.status(500).json({ message })
  }
}
