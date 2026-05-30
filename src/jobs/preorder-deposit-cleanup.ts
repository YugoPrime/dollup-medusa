/**
 * Pre-order deposit lifecycle cron. Runs every 15 minutes.
 *
 * For every order with metadata.cart_type="preorder" and
 * preorder_status="awaiting_deposit":
 *   - now >= deposit_deadline → cancel the order, mark preorder_status="expired",
 *     email the customer a "reservation expired" notice.
 *   - now >= deadline - 1h AND !reminder_sent → email a deposit reminder (reuses
 *     the deposit-instructions template) and set reminder_sent=true.
 *
 * Every transition is guarded on the current status / reminder_sent flag, so the
 * 15-minute cadence never double-reminds or double-expires.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import type { INotificationModuleService } from "@medusajs/framework/types"
import { EmailTemplate, isSendableEmail } from "../modules/notification-resend/service"
import { PAYMENT_INFO } from "../lib/payment-info"

const REMINDER_LEAD_MS = 60 * 60 * 1000

export default async function preorderDepositCleanup(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const orderModule = container.resolve(Modules.ORDER)
  const notify = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION,
  )

  // query.graph has no metadata-filter operator, so pull recent orders and
  // filter in JS (same approach as preorder-availability-check.ts).
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "metadata",
      "shipping_address.first_name",
    ],
  })

  const now = Date.now()
  let reminded = 0
  let expired = 0

  for (const o of orders as Array<{
    id: string
    display_id?: number | string | null
    email?: string | null
    metadata?: Record<string, any> | null
    shipping_address?: { first_name?: string | null } | null
  }>) {
    const meta = (o.metadata ?? {}) as Record<string, any>
    if (meta.cart_type !== "preorder") continue
    if (meta.preorder_status !== "awaiting_deposit") continue

    const deadline = meta.deposit_deadline
      ? Date.parse(meta.deposit_deadline)
      : NaN
    if (!Number.isFinite(deadline)) continue

    const firstName = o.shipping_address?.first_name ?? ""
    const displayId = o.display_id ?? o.id
    const email = o.email ?? null

    if (now >= deadline) {
      // Hard-cancel the order. Throws if it has uncanceled fulfillments — a
      // preorder awaiting deposit won't, but guard anyway and still expire.
      try {
        await cancelOrderWorkflow(container as never).run({
          input: { order_id: o.id, no_notification: true },
        })
      } catch (e) {
        logger.warn(
          `[preorder-cleanup] cancel failed for ${o.id}: ${(e as Error).message}`,
        )
      }
      try {
        await orderModule.updateOrders(o.id, {
          metadata: { ...meta, preorder_status: "expired" },
        })
      } catch (e) {
        logger.error(
          `[preorder-cleanup] mark-expired failed for ${o.id}: ${(e as Error).message}`,
        )
        continue
      }
      if (email && isSendableEmail(email)) {
        await notify
          .createNotifications({
            to: email,
            channel: "email",
            template: EmailTemplate.PREORDER_RESERVATION_EXPIRED,
            data: {
              customerFirstName: firstName,
              displayId,
            } as unknown as Record<string, unknown>,
          })
          .catch(() => {
            /* best-effort */
          })
      }
      expired++
      continue
    }

    if (now >= deadline - REMINDER_LEAD_MS && !meta.reminder_sent) {
      if (email && isSendableEmail(email)) {
        await notify
          .createNotifications({
            to: email,
            channel: "email",
            template: EmailTemplate.PREORDER_DEPOSIT_INSTRUCTIONS,
            data: {
              customerFirstName: firstName,
              displayId,
              depositAmount: Number(meta.deposit_amount ?? 0),
              balanceAmount: Number(meta.balance_amount ?? 0),
              totalAmount: Number(meta.total_amount ?? 0),
              deadlineLabel: new Date(deadline).toLocaleString("en-MU", {
                dateStyle: "medium",
                timeStyle: "short",
              }),
              bank: PAYMENT_INFO.bank,
              accountName: PAYMENT_INFO.account_name,
              accountNumber: PAYMENT_INFO.account_number,
              whatsapp: PAYMENT_INFO.whatsapp,
            } as unknown as Record<string, unknown>,
          })
          .catch(() => {
            /* best-effort */
          })
      }
      try {
        await orderModule.updateOrders(o.id, {
          metadata: { ...meta, reminder_sent: true },
        })
        reminded++
      } catch (e) {
        logger.error(
          `[preorder-cleanup] set reminder_sent failed for ${o.id}: ${(e as Error).message}`,
        )
      }
    }
  }

  logger.info(
    `[preorder-cleanup] reminded=${reminded} expired=${expired}`,
  )
}

export const config = {
  name: "preorder-deposit-cleanup",
  // Every 15 minutes.
  schedule: "*/15 * * * *",
}
