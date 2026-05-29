import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/framework/types"

import { computeDeposit } from "../lib/preorder-deposit"
import { EmailTemplate, isSendableEmail } from "../modules/notification-resend/service"
import { PAYMENT_INFO } from "../lib/payment-info"

const DEPOSIT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Server-authoritative deposit stamping for pre-order checkouts.
 *
 *   - Fires on `order.placed`. Only acts on orders whose metadata carries
 *     `cart_type: "preorder"` (already stamped onto the cart → order by the
 *     existing cart-type infrastructure). Every other order is left untouched.
 *   - Idempotent: if `preorder_status` is already set, it has been stamped
 *     before, so we no-op (guards against re-delivery of the event).
 *   - Computes the real deposit via computeDeposit() (MUR whole rupees) and
 *     writes the deposit-lifecycle metadata block that the admin view, deposit
 *     emails, and the reminder cron all read. The storefront only ever showed
 *     an informational figure — THIS is the source of truth.
 *   - Never rethrows: a stamping failure must not break order placement.
 */
export default async function preorderStampOnOrderPlaced({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = event.data?.id
  if (!orderId) {
    return
  }

  try {
    const orderModule = container.resolve(Modules.ORDER)
    const order = (await orderModule.retrieveOrder(orderId, {
      select: [
        "id",
        "email",
        "display_id",
        "item_total",
        "subtotal",
        "shipping_total",
        "metadata",
      ],
      relations: ["shipping_address"],
    })) as unknown as {
      email?: string | null
      display_id?: number | null
      item_total?: number | null
      subtotal?: number | null
      shipping_total?: number | null
      metadata?: Record<string, unknown> | null
      shipping_address?: { first_name?: string | null } | null
    }

    const meta = (order.metadata ?? {}) as Record<string, unknown>
    if (meta.cart_type !== "preorder") {
      // Not a pre-order — nothing to stamp.
      return
    }
    if (meta.preorder_status) {
      // Already stamped on a prior delivery of this event.
      return
    }

    // Totals from retrieveOrder are BigNumberValue; coerce via Number().
    const { total, deposit, balance } = computeDeposit(
      Number(order.item_total ?? order.subtotal ?? 0),
      Number(order.shipping_total ?? 0),
    )
    const deadline = new Date(Date.now() + DEPOSIT_WINDOW_MS).toISOString()

    await orderModule.updateOrders(orderId, {
      metadata: {
        ...meta,
        preorder_status: "awaiting_deposit",
        total_amount: total,
        deposit_amount: deposit,
        balance_amount: balance,
        deposit_deadline: deadline,
        reminder_sent: false,
        deposit_paid_at: null,
      },
    })

    logger.info(
      `[preorder-stamp] order ${orderId} → awaiting_deposit, deposit ${deposit}`,
    )

    // Send the deposit-instructions email (customer + owner copy). Reuse the
    // deposit values already computed above. Email failures must never break
    // order placement, so everything stays inside this try/catch.
    const customerEmail = (order.email as string | null) ?? null
    const firstName = order.shipping_address?.first_name ?? ""
    const displayId = order.display_id ?? orderId
    const deadlineLabel = new Date(deadline).toLocaleString("en-MU", {
      dateStyle: "medium",
      timeStyle: "short",
    })
    const data = {
      customerFirstName: firstName,
      displayId,
      depositAmount: deposit,
      balanceAmount: balance,
      totalAmount: total,
      deadlineLabel,
      bank: PAYMENT_INFO.bank,
      accountName: PAYMENT_INFO.account_name,
      accountNumber: PAYMENT_INFO.account_number,
      whatsapp: PAYMENT_INFO.whatsapp,
    }

    const notify = container.resolve<INotificationModuleService>(
      Modules.NOTIFICATION,
    )
    if (customerEmail && isSendableEmail(customerEmail)) {
      await notify.createNotifications({
        to: customerEmail,
        channel: "email",
        template: EmailTemplate.PREORDER_DEPOSIT_INSTRUCTIONS,
        data: data as unknown as Record<string, unknown>,
      })
    }
    // Owner copy (the Resend wrapper has no cc — send a second notification).
    await notify
      .createNotifications({
        to: "eabmarkets@gmail.com",
        channel: "email",
        template: EmailTemplate.PREORDER_DEPOSIT_INSTRUCTIONS,
        data: data as unknown as Record<string, unknown>,
      })
      .catch(() => {})
  } catch (err) {
    logger.error(
      `[preorder-stamp] failed for ${orderId}: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "preorder-stamp-on-order-placed" },
}
