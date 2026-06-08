import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createOrderWorkflow,
  createReservationsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  DELIVERY_KEYS,
  DELIVERY_MAP,
  isDeliveryKey,
  REGION_ID_MU,
  SALES_CHANNEL_ID,
} from "./delivery-map"
import { buildManualOrderMetadata } from "./metadata"

/**
 * POST /admin/dollup/manual-orders
 *
 * Creates a real Medusa order from a flat payload produced by the Hermes agent
 * (Messenger / WhatsApp orders that are already paid via MCB Juice / cash).
 *
 * This is the contract between the agent and the store: the agent sends WHAT
 * (variant(s), qty, price, delivery method, paid?), and this route owns HOW
 * (Medusa order creation + the Doll Up metadata conventions). The agent never
 * needs to know region ids, shipping-option ids, or the metadata schema.
 *
 * Items: send either a single item (variant_id/quantity/item_price at the top
 * level) OR an `items: [{variant_id, quantity, item_price}, ...]` array for
 * multi-product orders. The array wins if both are present.
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

type ManualOrderItem = {
  variant_id?: string
  sku?: string
  quantity?: number
  item_price?: number // MUR, integer (e.g. 1000 = Rs 1000)
}

type ManualOrderBody = {
  customer_name?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  // Single-item shape (still supported for backward compatibility):
  variant_id?: string
  sku?: string
  quantity?: number
  item_price?: number // MUR, integer (e.g. 1000 = Rs 1000)
  // Multi-item shape (preferred when an order has 2+ products):
  items?: ManualOrderItem[]
  delivery_method?: string
  delivery_fee?: number // MUR, integer (e.g. 70)
  payment_status?: "paid" | "unpaid" | string
  payment_method?: string // e.g. "Juice / Bank Transfer", "Cash" — free text
  point_of_sale?: string // e.g. "Facebook", "Instagram", "WhatsApp" — free text
  chat_thread_id?: string // chat_thread id for thread ↔ order traceability
  chat_message_id?: string // chat_message id that triggered order creation
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

  // Accept either a single-item payload or an `items` array. Normalize both
  // into one validated list of { variant_id, quantity, item_price, sku }.
  const rawItems: ManualOrderItem[] =
    Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : [
          {
            variant_id: body.variant_id,
            sku: body.sku,
            quantity: body.quantity,
            item_price: body.item_price,
          },
        ]

  const lineItems: {
    variant_id: string
    quantity: number
    item_price: number
    sku?: string
  }[] = []

  rawItems.forEach((it, i) => {
    const label = rawItems.length > 1 ? `items[${i}]` : "item"
    const vId = (it.variant_id ?? "").trim()
    if (!vId) errors.push(`${label}.variant_id is required`)
    const qty = intOrNull(it.quantity) ?? 1
    if (qty < 1) errors.push(`${label}.quantity must be >= 1`)
    const price = intOrNull(it.item_price)
    if (price === null || price < 0) {
      errors.push(`${label}.item_price (MUR integer) is required`)
    }
    if (vId && price !== null && price >= 0) {
      lineItems.push({
        variant_id: vId,
        quantity: qty,
        item_price: price,
        sku: it.sku,
      })
    }
  })

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

    // ---- verify all variants exist (clear error instead of a workflow crash) ----
    const variantIds = lineItems.map((li) => li.variant_id)
    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "title", "sku", "product.title"],
      filters: { id: variantIds },
    })
    const variantById = new Map(
      (
        variants as Array<{
          id: string
          title?: string
          sku?: string
          product?: { title?: string }
        }>
      ).map((v) => [v.id, v]),
    )
    const missing = variantIds.filter((id) => !variantById.has(id))
    if (missing.length > 0) {
      res
        .status(404)
        .json({ message: `variant(s) not found: ${missing.join(", ")}` })
      return
    }

    // ---- build line items for the order ----
    const orderItems = lineItems.map((li) => {
      const v = variantById.get(li.variant_id)!
      const lineTitle = v.product?.title ?? v.title ?? li.sku ?? "Item"
      return {
        variant_id: li.variant_id,
        quantity: li.quantity,
        title: v.title ?? lineTitle,
        product_title: lineTitle,
        unit_price: li.item_price,
      }
    })

    // ---- build metadata exactly as the rest of the system expects ----
    const metadata = buildManualOrderMetadata({
      delivery_method: delivery.metadata_label,
      delivery_fee: deliveryFee,
      is_paid: isPaid,
      channel: "messenger",
      payment_status: body.payment_status,
      payment_method: body.payment_method,
      point_of_sale: body.point_of_sale,
      delivery_date: body.delivery_date,
      note: body.note,
      phone: body.phone,
      external_id: body.external_id,
      chat_thread_id: body.chat_thread_id,
      chat_message_id: body.chat_message_id,
    })

    // ---- create the order ----
    const { result: order } = await createOrderWorkflow(req.scope).run({
      input: {
        region_id: REGION_ID_MU,
        sales_channel_id: SALES_CHANNEL_ID,
        currency_code: "mur",
        email: body.email || undefined,
        status: "pending",
        items: orderItems,
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

    // ---- reserve inventory for each line item ----
    // createOrderWorkflow does NOT create inventory reservations (unlike cart
    // completion). Without a reservation, "Mark Shipped" fails with
    // "No stock reservation found for item ...". Create them here so manual
    // orders behave like storefront orders: stock is held + deducted on fulfil.
    let reservationsOk = true
    try {
      const { data: orderItems2 } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "items.id",
          "items.variant_id",
          "items.variant.manage_inventory",
          "items.variant.inventory_items.inventory_item_id",
          "items.variant.inventory_items.required_quantity",
          "items.variant.inventory_items.inventory.location_levels.location_id",
        ],
        filters: { id: created.id },
      })
      const fullOrder = orderItems2?.[0] as
        | {
            items?: Array<{
              id: string
              variant?: {
                manage_inventory?: boolean
                inventory_items?: Array<{
                  inventory_item_id: string
                  required_quantity?: number
                  inventory?: {
                    location_levels?: Array<{ location_id: string }>
                  }
                }>
              } | null
            }>
          }
        | undefined

      // query.graph does NOT hydrate order.items.quantity, and OrderLineItem
      // has no quantity column (it lives on the OrderItem join). retrieveOrder
      // with the items relation hydrates quantity per line.
      const orderModule = req.scope.resolve(Modules.ORDER)
      const ordWithQty = (await orderModule.retrieveOrder(created.id, {
        select: ["id"],
        relations: ["items"],
      })) as { items?: Array<{ id: string; quantity: number }> }
      const qtyById = new Map(
        (ordWithQty.items ?? []).map((l) => [l.id, Number(l.quantity)]),
      )

      const reservations: Array<{
        line_item_id: string
        inventory_item_id: string
        location_id: string
        quantity: number
      }> = []

      for (const it of fullOrder?.items ?? []) {
        const v = it.variant
        // Skip variants that don't track inventory — nothing to reserve.
        if (!v || v.manage_inventory === false) continue
        const lineQty = qtyById.get(it.id)
        if (!lineQty || !Number.isFinite(lineQty)) continue
        for (const inv of v.inventory_items ?? []) {
          const locationId =
            inv.inventory?.location_levels?.[0]?.location_id
          if (!locationId) continue
          reservations.push({
            line_item_id: it.id,
            inventory_item_id: inv.inventory_item_id,
            location_id: locationId,
            quantity: lineQty * (inv.required_quantity ?? 1),
          })
        }
      }

      if (reservations.length > 0) {
        await createReservationsWorkflow(req.scope).run({
          input: { reservations },
        })
      }
    } catch (resErr) {
      reservationsOk = false
      logger.warn(
        `[admin/dollup/manual-orders] order ${created.id} created but reserving inventory failed: ${
          (resErr as Error).message
        } — fulfilment may fail until stock is reserved/adjusted manually.`,
      )
    }

    const itemsSubtotal = lineItems.reduce(
      (sum, li) => sum + li.item_price * li.quantity,
      0,
    )

    logger.info(
      `[admin/dollup/manual-orders] created order ${created.id} (#${created.display_id}) via hermes, ${lineItems.length} item(s), paid=${isPaid}, delivery=${delivery.metadata_label}`,
    )

    res.status(201).json({
      ok: true,
      order_id: created.id,
      display_id: created.display_id,
      item_count: lineItems.length,
      total_charged: itemsSubtotal + deliveryFee,
      delivery_method: delivery.metadata_label,
      paid: isPaid,
      inventory_reserved: reservationsOk,
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
