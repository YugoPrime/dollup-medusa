import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { verifyRapidoSignature } from "../../../modules/rapido/verify-rapido-signature"
import { isDeliveredStatus } from "../../../modules/rapido/delivered-status"
import { markOrderDeliveredFromCourier } from "../../../modules/rapido/mark-delivered"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const rawBody = req.body as Buffer
  const signature = req.headers["x-rapido-signature"] as string | undefined
  const secret = process.env.RAPIDO_WEBHOOK_SECRET || ""

  if (!verifyRapidoSignature(rawBody, signature, secret)) {
    res.status(401).send("bad signature")
    return
  }

  let event: {
    externalOrderRef?: string
    orderNumber?: string
    status?: string
    trackingNumber?: string
  }
  try {
    event = JSON.parse(rawBody.toString("utf8"))
  } catch {
    res.status(400).send("invalid json")
    return
  }

  const orderId = event.externalOrderRef
  if (!orderId || !event.status) {
    // Nothing actionable; ack so Rapido doesn't retry a malformed event forever.
    res.status(200).send("ignored")
    return
  }

  try {
    // Mirror dispatch route: use query.graph for the read, orderModule for the write.
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: { id: orderId },
    })
    const order = orders?.[0]
    if (!order) {
      // Unknown order — ack so Rapido doesn't retry forever (order may have been deleted).
      console.warn(`[hooks/rapido] unknown order id: ${orderId}`)
      res.status(200).send("ignored")
      return
    }

    const newMetadata: Record<string, unknown> = {
      ...((order.metadata ?? {}) as Record<string, unknown>),
      rapido_status: event.status,
    }
    if (event.trackingNumber) {
      newMetadata.rapido_tracking = event.trackingNumber
    }

    if (isDeliveredStatus(event.status)) {
      // Owns the metadata write itself (Medusa replaces metadata wholesale, so
      // two writers would clobber each other). A failed *fulfillment* is
      // swallowed in there and reported via outcome.error, since retrying it
      // forever would achieve nothing; a failed read/write still throws to the
      // catch below, where a 500 correctly asks Rapido to retry.
      const outcome = await markOrderDeliveredFromCourier(
        req.scope,
        orderId,
        newMetadata,
      )
      res.status(200).send(outcome.error ? "ok (degraded)" : "ok")
      return
    }

    // Not a delivered status: record it and leave the order alone. Failed and
    // returned deliveries land here on purpose — they're for a human to action.
    console.info(
      `[hooks/rapido] order ${orderId}: status "${event.status}" is not a delivered status; stored only`,
    )

    const orderModule = req.scope.resolve(Modules.ORDER)
    await orderModule.updateOrders(orderId, { metadata: newMetadata })
  } catch (err) {
    console.error("[hooks/rapido] failed to apply event:", err)
    res.status(500).send("apply failed") // 500 → Rapido retries; status converges
    return
  }

  res.status(200).send("ok")
}
