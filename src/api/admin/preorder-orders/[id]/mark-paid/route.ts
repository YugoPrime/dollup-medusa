import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/framework/types"
import {
  EmailTemplate,
  isSendableEmail,
} from "../../../../../modules/notification-resend/service"

/**
 * POST /admin/preorder-orders/:id/mark-paid
 *
 * Advances a pre-order from "awaiting_deposit" to "deposit_paid", stamps
 * deposit_paid_at, and emails the customer a confirmation. Idempotent: a
 * second call on an already-paid order is a no-op. The order then proceeds
 * through normal Medusa fulfilment when the SHEIN stock arrives.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = req.params.id
  try {
    const orderModule = req.scope.resolve(Modules.ORDER)
    const order = (await orderModule.retrieveOrder(orderId, {
      select: ["id", "display_id", "email", "metadata"],
      relations: ["shipping_address"],
    })) as unknown as {
      id: string
      display_id?: number | string | null
      email?: string | null
      metadata?: Record<string, unknown> | null
      shipping_address?: { first_name?: string | null } | null
    }

    const meta = (order.metadata ?? {}) as Record<string, unknown>
    if (meta.cart_type !== "preorder") {
      res.status(400).json({ message: "Not a pre-order order" })
      return
    }
    if (meta.preorder_status === "deposit_paid") {
      res.json({ ok: true, already: true })
      return
    }

    await orderModule.updateOrders(orderId, {
      metadata: {
        ...meta,
        preorder_status: "deposit_paid",
        deposit_paid_at: new Date().toISOString(),
      },
    })

    const email = order.email ?? null
    if (email && isSendableEmail(email)) {
      const notify = req.scope.resolve<INotificationModuleService>(
        Modules.NOTIFICATION,
      )
      await notify
        .createNotifications({
          to: email,
          channel: "email",
          template: EmailTemplate.PREORDER_DEPOSIT_CONFIRMED,
          data: {
            customerFirstName: order.shipping_address?.first_name ?? "",
            displayId: order.display_id ?? order.id,
            balanceAmount: Number(meta.balance_amount ?? 0),
          } as unknown as Record<string, unknown>,
        })
        .catch((e) => {
          logger.warn(
            `[admin/preorder-orders] confirmed email failed for ${orderId}: ${(e as Error).message}`,
          )
        })
    }

    res.json({ ok: true })
  } catch (err) {
    logger.error(
      `[admin/preorder-orders] mark-paid failed for ${orderId}: ${(err as Error).message}`,
    )
    res.status(500).json({ message: "Failed to mark deposit paid" })
  }
}
