import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createReservationsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Backfill inventory reservations for orders that were created without them
 * (manual / Hermes orders made via /admin/dollup/manual-orders before the
 * endpoint started reserving stock). Without a reservation, "Mark Shipped"
 * fails with "No stock reservation found for item ...".
 *
 * Safe + idempotent: it skips any line item that already has a reservation,
 * and only touches non-fulfilled, non-cancelled orders. Read-then-write.
 *
 *   set -a; . ./.env.local-render; set +a
 *   yarn medusa exec ./src/scripts/backfill-manual-order-reservations.ts
 *
 * Env flags:
 *   ORDER_DISPLAY_ID=211  target a single order by its # number
 *   DRY_RUN=true          report what WOULD be reserved, write nothing
 *   FORCE=true            also fix orders marked fulfilled/delivered that
 *                         never got a real Medusa fulfilment (so still lack
 *                         reservations). Use WITH ORDER_DISPLAY_ID.
 *
 * Keep this script — it's the on-demand fix for any pre-fix order that hits
 * "No stock reservation found" on ship/edit. Do NOT mass-run it across all old
 * orders: many "pending" orders here were already delivered to customers via
 * the DM admin (metadata.dm_status), never fulfilled in Medusa — reserving
 * them retroactively can lock phantom stock. Fix on-demand, per order #.
 */
export default async function backfill({ container }: { container: any }) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderModule = container.resolve(Modules.ORDER)

  // query.graph does NOT hydrate order.items.quantity, and OrderLineItem has no
  // quantity column (it's on the OrderItem join). retrieveOrder with the items
  // relation hydrates quantity per line — map it by line-item id.
  async function quantityMap(orderId: string): Promise<Map<string, number>> {
    const ord = (await orderModule.retrieveOrder(orderId, {
      select: ["id"],
      relations: ["items"],
    })) as { items?: Array<{ id: string; quantity: number }> }
    return new Map((ord.items ?? []).map((l) => [l.id, Number(l.quantity)]))
  }

  const targetDisplayId = process.env.ORDER_DISPLAY_ID
    ? Number(process.env.ORDER_DISPLAY_ID)
    : null

  // Pull candidate orders. We filter in JS (query.graph has no metadata filter).
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "status",
      "fulfillment_status",
      "metadata",
      "items.id",
      "items.quantity",
      "items.title",
      "items.variant_id",
      "items.variant.manage_inventory",
      "items.variant.inventory_items.inventory_item_id",
      "items.variant.inventory_items.required_quantity",
      "items.variant.inventory_items.inventory.location_levels.location_id",
    ],
  })

  // Existing reservations, keyed by line_item_id, so we never double-reserve.
  const { data: existingReservations } = await query.graph({
    entity: "reservation",
    fields: ["id", "line_item_id"],
  })
  const reservedLineItemIds = new Set(
    (existingReservations as Array<{ line_item_id?: string }>)
      .map((r) => r.line_item_id)
      .filter(Boolean) as string[],
  )

  let ordersTouched = 0
  let reservationsCreated = 0

  // FORCE=true bypasses the fulfilled/delivered skip — needed for orders that
  // were marked delivered in the admin WITHOUT a Medusa fulfilment (so they
  // still lack reservations and re-trigger the error on edit). Only meaningful
  // together with ORDER_DISPLAY_ID so you don't sweep all delivered orders.
  const force = process.env.FORCE === "true"
  const dryRun = process.env.DRY_RUN === "true"

  for (const o of orders as Array<any>) {
    if (targetDisplayId != null && o.display_id !== targetDisplayId) continue

    // Skip cancelled orders always.
    if (o.status === "canceled" || o.status === "cancelled") continue
    // Skip already-fulfilled orders unless FORCE.
    if (
      !force &&
      o.fulfillment_status &&
      ["fulfilled", "shipped", "delivered", "partially_fulfilled"].includes(
        o.fulfillment_status,
      )
    ) {
      continue
    }

    const reservations: Array<{
      line_item_id: string
      inventory_item_id: string
      location_id: string
      quantity: number
    }> = []

    const qtyById = await quantityMap(o.id)

    for (const it of o.items ?? []) {
      if (reservedLineItemIds.has(it.id)) continue // already reserved
      const v = it.variant
      if (!v || v.manage_inventory === false) continue
      const lineQty = qtyById.get(it.id)
      if (!lineQty || !Number.isFinite(lineQty)) {
        logger.warn(`#${o.display_id}: no quantity for line ${it.id}, skipping`)
        continue
      }
      for (const inv of v.inventory_items ?? []) {
        const locationId = inv.inventory?.location_levels?.[0]?.location_id
        if (!locationId) continue
        reservations.push({
          line_item_id: it.id,
          inventory_item_id: inv.inventory_item_id,
          location_id: locationId,
          quantity: lineQty * (inv.required_quantity ?? 1),
        })
      }
    }

    if (reservations.length === 0) continue

    if (dryRun) {
      ordersTouched++
      reservationsCreated += reservations.length
      logger.info(
        `[DRY RUN] #${o.display_id} (${o.id}, status=${o.status}/${o.fulfillment_status ?? "n/a"}): WOULD create ${reservations.length} reservation(s)`,
      )
      continue
    }

    try {
      await createReservationsWorkflow(container).run({
        input: { reservations },
      })
      ordersTouched++
      reservationsCreated += reservations.length
      logger.info(
        `#${o.display_id} (${o.id}): created ${reservations.length} reservation(s)`,
      )
    } catch (e) {
      logger.error(
        `#${o.display_id} (${o.id}): reservation failed — ${(e as Error).message}`,
      )
    }
  }

  logger.info(
    `\nBackfill ${dryRun ? "DRY RUN" : "done"}. Orders ${
      dryRun ? "that would be touched" : "touched"
    }: ${ordersTouched}, reservations ${
      dryRun ? "that would be created" : "created"
    }: ${reservationsCreated}.`,
  )
}
