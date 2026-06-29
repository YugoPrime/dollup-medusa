import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { validateRapidoPayload } from "../../../../modules/rapido/rapido-payload"
import { RapidoClient } from "../../../../modules/rapido/client"

/** POST /admin/rapido/dispatch { orderId, payload } */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { orderId?: unknown; payload?: unknown }
  const orderId = typeof body.orderId === "string" ? body.orderId : ""
  if (!orderId) {
    res.status(400).json({ ok: false, message: "orderId is required" })
    return
  }

  const validation = validateRapidoPayload(body.payload)
  if (!validation.ok) {
    res.status(400).json({ ok: false, message: validation.error })
    return
  }

  // Fetch order to verify it exists and read current metadata for merge.
  // Mirror notify-shipped: use query.graph rather than orderModule.retrieveOrder.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: orderId },
  })
  const order = orders?.[0]
  if (!order) {
    res.status(404).json({ ok: false, message: `Order ${orderId} not found` })
    return
  }

  // Dispatch to Rapido.
  let result: Awaited<ReturnType<RapidoClient["createOrder"]>>
  try {
    result = await new RapidoClient().createOrder(validation.value, orderId)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Rapido dispatch failed"
    console.error("[admin/rapido/dispatch] Rapido call failed:", err)
    res.status(502).json({ ok: false, message })
    return
  }

  // Merge metadata — Medusa replaces the whole object on update, so we must
  // spread the existing metadata first (same pattern as notify-shipped).
  const orderModule = req.scope.resolve(Modules.ORDER)
  try {
    const newMetadata = {
      ...((order.metadata ?? {}) as Record<string, unknown>),
      rapido_order_number: result.orderNumber,
      rapido_tracking: result.trackingNumbers[0] ?? null,
      rapido_status: result.status,
      rapido_dispatched_at: new Date().toISOString(),
      rapido_fee_bearer: "merchant",
    }
    await orderModule.updateOrders(orderId, { metadata: newMetadata })
  } catch (err) {
    // Rapido order WAS created (idempotency key = orderId protects a retry).
    // Surface the persistence failure but report the order number so it's not lost.
    console.error("[admin/rapido/dispatch] metadata write failed:", err)
    res.status(500).json({
      ok: false,
      message: `Rapido order ${result.orderNumber} created but saving to the order failed — retry to re-sync.`,
    })
    return
  }

  res.json({
    ok: true,
    orderNumber: result.orderNumber,
    status: result.status,
    trackingNumbers: result.trackingNumbers,
    warnings: result.warnings,
  })
}
