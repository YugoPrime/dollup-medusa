import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * POST /store/orders/lookup
 *
 * Public guest order-tracking endpoint. Accepts a numeric `display_id`
 * (the human-readable "DUB1042" number, minus the prefix) plus a `phone`
 * and returns the order if-and-only-if the phone matches the order's
 * shipping address phone.
 *
 * Why this exists: Medusa v2's built-in `GET /store/orders` (list) requires
 * customer authentication, so a guest with just an order number cannot use
 * it. `GET /store/orders/{id}` works for guests but only by full order id,
 * which the customer never sees. This route bridges that gap for the
 * `/track-order` page on the storefront.
 *
 * Returns the same `{ order }` shape as `sdk.store.order.retrieve(id)` so
 * the Next.js route can post-process it identically.
 *
 * Always 404 on miss — both "no order with that display_id" and
 * "order exists but phone mismatch" — so we don't leak which display_ids
 * are real.
 */

const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
  "fulfillment_status",
  "currency_code",
  // Medusa v2 order totals are calculated fields — without a "+" prefix
  // query.graph returns 0/null instead of the real values.
  "+subtotal",
  "+total",
  "+shipping_total",
  "metadata",
  "created_at",
  "updated_at",
  "canceled_at",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.phone",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.city",
  "shipping_address.province",
  "shipping_address.postal_code",
  "items.id",
  "items.product_title",
  "items.variant_title",
  "items.quantity",
  "items.unit_price",
  "items.thumbnail",
  "fulfillments.id",
  "fulfillments.metadata",
  "fulfillments.packed_at",
  "fulfillments.shipped_at",
  "fulfillments.delivered_at",
]

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("230")) return digits.slice(3)
  return digits
}

function notFound(res: MedusaResponse) {
  res.status(404).json({ error: "not_found" })
}

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { display_id?: unknown; phone?: unknown }

  const displayIdRaw =
    typeof body.display_id === "number"
      ? body.display_id
      : typeof body.display_id === "string"
        ? Number.parseInt(body.display_id, 10)
        : NaN
  const phoneRaw = typeof body.phone === "string" ? body.phone : ""
  const normalizedPhone = normalizePhone(phoneRaw)

  if (
    !Number.isFinite(displayIdRaw) ||
    displayIdRaw <= 0 ||
    !Number.isInteger(displayIdRaw) ||
    normalizedPhone.length < 7
  ) {
    notFound(res)
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ORDER_FIELDS,
    // Medusa's generated filter type mistypes the integer `display_id`
    // column as a string filter; the runtime accepts numbers.
    filters: { display_id: displayIdRaw } as never,
    pagination: { take: 1 },
  })

  const order = orders?.[0]
  if (!order) {
    notFound(res)
    return
  }

  const storedPhone = normalizePhone(
    (order.shipping_address?.phone ?? "") as string,
  )
  if (!storedPhone || storedPhone !== normalizedPhone) {
    notFound(res)
    return
  }

  res.json({ order })
}
