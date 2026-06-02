import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import {
  DELIVERY_KEYS,
  DELIVERY_MAP,
  isDeliveryKey,
  REGION_ID_MU,
  SALES_CHANNEL_ID,
} from "./delivery-map"

/**
 * POST /admin/dollup/manual-orders
 *
 * Creates a real Medusa order from a flat payload produced by the Hermes agent
 * (Messenger / WhatsApp orders that are already paid via MCB Juice / cash).
 *
 * This is the contract between the agent and the store: the agent sends WHAT
 * (variant, qty, price, delivery method, paid?), and this route owns HOW
 * (Medusa order creation + the Doll Up metadata conventions). The agent never
 * needs to know region ids, shipping-option ids, or the metadata schema.
 *
 * It stamps the same metadata the rest of the system reads:
 *  - metadata.delivery_method  → raw label ("Home Delivery", "Postage", ...)
 *                                read by email-on-order-shipped + CSV export
 *  - metadata.sale_type="paid" → how the system detects a paid manual order
 *                                (detectIsPaid checks this first)
 *  - metadata.source="hermes"  → so these orders are identifiable / auditable
 *
 * Auth: requires admin authentication (Secret API key tied to the `hermes`
 * user, sent as `Authorization: Basic base64(sk_...:)`).
 *
 * Inventory: createOrderWorkflow reserves/deducts inventory like a real order.
 *
 * Idempotency: pass `external_id` (e.g. the Messenger thread/message id) to
 * prevent duplicate orders if the agent retries — a matching existing order is
 * returned instead of creating a second one.
 */

type ManualOrderBody = {
  customer_name?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  variant_id?: string
  sku?: string
  quantity?: number
  item_price?: number // MUR, integer (e.g. 1000 = Rs 1000)
  delivery_method?: string
  delivery_fee?: number // MUR, integer (e.g. 70)
  payment_status?: "paid" | "unpaid" | string
  delivery_date?: string
  note?: string
  external_id?: string // idempotency key (Messenger thread/message id)
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v)
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Math.round(Number(v))
  }
  return null
}

function splitName(body: ManualOrderBody): {
  first_name: string
  last_name: string
} {
  if (body.first_name || body.last_name) {
    return {
      first_name: (body.first_name ?? "").trim(),
      last_name: (body.last_name ?? "").trim(),
    }
  }
  const full = (body.customer_name ?? "").trim()
  if (!full) return { first_name: "", last_name: "" }
  const parts = full.split(/\s+/)
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  }
}

export const POST = async (
  req: AuthenticatedMedusaRequest<ManualOrderBody>,
  res: MedusaResponse,
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const body = (req.body ?? {}) as ManualOrderBody

  // ---- validate ----
  const errors: string[] = []

  const variantId = (body.variant_id ?? "").trim()
  if (!variantId) errors.push("variant_id is required")

  const quantity = intOrNull(body.quantity) ?? 1
  if (quantity < 1) errors.push("quantity must be >= 1")

  const itemPrice = intOrNull(body.item_price)
  if (itemPrice === null || itemPrice < 0) {
    errors.push("item_price (MUR integer) is required")
  }

  const deliveryFee = intOrNull(body.delivery_fee) ?? 0

  const deliveryRaw = (body.delivery_method ?? "").trim()
  if (!deliveryRaw) errors.push("delivery_method is required")
  else if (!isDeliveryKey(deliveryRaw)) {
    errors.push(
      `delivery_method "${deliveryRaw}" is invalid. Use one of: ${DELIVERY_KEYS.join(", ")}`,
    )
  }

  const { first_name, last_name } = splitName(body)
  if (!first_name) errors.push("customer_name (or first_name) is required")

  const address1 = (body.address ?? "").trim()
  if (!address1) errors.push("address is required")

  if (errors.length > 0) {
    res.status(400).json({ message: "Validation failed", errors })
    return
  }

  const delivery = DELIVERY_MAP[deliveryRaw as keyof typeof DELIVERY_MAP]
  const isPaid = (body.payment_status ?? "").toLowerCase() === "paid"

  try {
    // ---- idempotency: short-circuit if we already created this order ----
    if (body.external_id) {
      const { data: existing } = await query.graph({
        entity: "order",
        fields: ["id", "display_id", "metadata"],
        filters: {} as Record<string, never>,
      })
      const dupe = (
        existing as Array<{
          id: string
          display_id?: number | string
          metadata?: Record<string, unknown> | null
        }>
      ).find((o) => (o.metadata ?? {})["external_id"] === body.external_id)
      if (dupe) {
        res.json({
          ok: true,
          duplicate: true,
          order_id: dupe.id,
          display_id: dupe.display_id,
          message: "Order with this external_id already exists",
        })
        return
      }
    }

    // ---- verify the variant exists (clear error instead of a workflow crash) ----
    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "title", "sku", "product.title"],
      filters: { id: variantId },
    })
    const variant = variants?.[0] as
      | { id: string; title?: string; sku?: string; product?: { title?: string } }
      | undefined
    if (!variant) {
      res.status(404).json({ message: `variant_id "${variantId}" not found` })
      return
    }

    const lineTitle =
      variant.product?.title ?? variant.title ?? body.sku ?? "Item"

    // ---- build metadata exactly as the rest of the system expects ----
    const metadata: Record<string, unknown> = {
      delivery_method: delivery.metadata_label,
      source: "hermes",
      channel: "messenger",
      delivery_fee: deliveryFee,
    }
    if (isPaid) metadata.sale_type = "paid"
    if (body.payment_status) metadata.payment_status = body.payment_status
    if (body.delivery_date) metadata.delivery_date = body.delivery_date
    if (body.note) metadata.note = body.note
    if (body.phone) metadata.phone = body.phone
    if (body.external_id) metadata.external_id = body.external_id

    // ---- create the order ----
    const { result: order } = await createOrderWorkflow(req.scope).run({
      input: {
        region_id: REGION_ID_MU,
        sales_channel_id: SALES_CHANNEL_ID,
        currency_code: "mur",
        email: body.email || undefined,
        status: "pending",
        items: [
          {
            variant_id: variantId,
            quantity,
            title: variant.title ?? lineTitle,
            product_title: lineTitle,
            unit_price: itemPrice as number,
          },
        ],
        shipping_methods: [
          {
            name: delivery.shipping_method_name,
            shipping_option_id: delivery.shipping_option_id,
            amount: deliveryFee,
          },
        ],
        shipping_address: {
          first_name,
          last_name,
          phone: body.phone || undefined,
          address_1: address1,
          city: body.city || "Mauritius",
          country_code: "mu",
        },
        metadata,
      },
    })

    const created = order as { id: string; display_id?: number | string }

    logger.info(
      `[admin/dollup/manual-orders] created order ${created.id} (#${created.display_id}) via hermes, paid=${isPaid}, delivery=${delivery.metadata_label}`,
    )

    res.status(201).json({
      ok: true,
      order_id: created.id,
      display_id: created.display_id,
      total_charged: (itemPrice as number) * quantity + deliveryFee,
      delivery_method: delivery.metadata_label,
      paid: isPaid,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error"
    logger.error(`[admin/dollup/manual-orders] failed: ${message}`)
    // Surface stock errors distinctly so the agent can tell the customer.
    if (/inventory|stock|not stocked|insufficient/i.test(message)) {
      res.status(409).json({
        message: "Item is out of stock",
        detail: message,
      })
      return
    }
    res.status(500).json({ message: "Failed to create manual order", detail: message })
  }
}
