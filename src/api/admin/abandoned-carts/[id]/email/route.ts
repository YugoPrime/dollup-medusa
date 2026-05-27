import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/framework/types"

import { EmailTemplate } from "../../../../../modules/notification-resend/service"
import { createPromotionsWorkflow } from "@medusajs/medusa/core-flows"

import {
  generateCouponCode,
  couponExpiryISO,
} from "../../../../../lib/recovery-coupon"

const ALLOWED_TEMPLATES = ["checkin", "coupon"] as const
const COUPON_PERCENTAGE = 5
const COUPON_EXPIRY_DAYS = 14
type Template = (typeof ALLOWED_TEMPLATES)[number]

type RecoveryEmailEntry = {
  template: Template
  sent_at: string
  code?: string
  expires_at?: string
  resend_id?: string
}

type CartLike = {
  id: string
  email?: string | null
  currency_code?: string | null
  metadata?: Record<string, unknown> | null
  shipping_address?: { first_name?: string | null } | null
  billing_address?: { first_name?: string | null } | null
  customer?: { first_name?: string | null } | null
  items?: Array<{
    title?: string | null
    product_title?: string | null
    thumbnail?: string | null
    quantity?: number | null
  }> | null
}

type CartModuleLike = {
  updateCarts: (
    cartId: string,
    data: { metadata?: Record<string, unknown> },
  ) => Promise<unknown>
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const cartId = req.params.id
    const body = (req.body ?? {}) as { template?: unknown }
    const template = body.template

    if (
      typeof template !== "string" ||
      !ALLOWED_TEMPLATES.includes(template as Template)
    ) {
      return res
        .status(400)
        .json({
          message: `template must be one of: ${ALLOWED_TEMPLATES.join(", ")}`,
        })
    }
    const tpl = template as Template

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "currency_code",
        "metadata",
        "items.*",
        "shipping_address.*",
        "billing_address.*",
        "customer.*",
      ],
      filters: { id: cartId },
    })
    const cart = (carts ?? [])[0] as CartLike | undefined
    if (!cart) {
      return res.status(404).json({ message: "cart not found" })
    }
    if (!cart.email) {
      return res.status(400).json({ message: "cart has no email" })
    }

    const existing =
      ((cart.metadata?.recovery_emails ?? []) as RecoveryEmailEntry[]) ?? []
    if (existing.some((e) => e.template === tpl)) {
      return res
        .status(409)
        .json({ message: `${tpl} already sent for this cart` })
    }

    const firstName =
      cart.shipping_address?.first_name ??
      cart.billing_address?.first_name ??
      cart.customer?.first_name ??
      "babe"

    const storefrontUrl = (
      process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://dollupboutique.com"
    ).replace(/\/$/, "")
    const cartResumeUrl = `${storefrontUrl}/cart?cart_id=${cart.id}`

    const items = (cart.items ?? []).map((it) => ({
      title: it.product_title ?? it.title ?? "Item",
      thumbnail: it.thumbnail ?? null,
      quantity: it.quantity ?? 1,
    }))

    let couponCode: string | undefined
    let couponExpiresAt: string | undefined

    if (tpl === "coupon") {
      const currencyCode = (cart.currency_code ?? "mur").toLowerCase()
      couponCode = generateCouponCode()
      couponExpiresAt = couponExpiryISO(COUPON_EXPIRY_DAYS)

      try {
        await createPromotionsWorkflow(req.scope).run({
          input: {
            promotionsData: [
              {
                code: couponCode,
                type: "standard",
                status: "active" as const,
                is_automatic: false,
                application_method: {
                  type: "percentage",
                  target_type: "items",
                  allocation: "across",
                  value: COUPON_PERCENTAGE,
                  currency_code: currencyCode,
                },
                rules: [],
              },
            ],
          },
        })
      } catch (err) {
        const m = (err as Error)?.message ?? "failed to create coupon"
        logger.error(
          `[admin/abandoned-carts email] coupon promo create failed for cart=${cart.id}: ${m}`,
        )
        return res
          .status(500)
          .json({ message: `failed to create coupon: ${m}` })
      }
    }

    const notificationService = req.scope.resolve<INotificationModuleService>(
      Modules.NOTIFICATION,
    )

    const templateKey =
      tpl === "checkin"
        ? EmailTemplate.CART_RECOVERY_CHECKIN
        : EmailTemplate.CART_RECOVERY_COUPON

    const notifData =
      tpl === "checkin"
        ? {
            storefrontUrl,
            customerFirstName: firstName,
            cartResumeUrl,
            items,
          }
        : {
            storefrontUrl,
            customerFirstName: firstName,
            cartResumeUrl: `${cartResumeUrl}&promo=${couponCode}`,
            items,
            couponCode: couponCode!,
            couponExpiresAt: couponExpiresAt!,
            couponPercentage: COUPON_PERCENTAGE,
          }

    const sendResult = (await notificationService.createNotifications({
      to: cart.email,
      channel: "email",
      template: templateKey,
      data: notifData as unknown as Record<string, unknown>,
    })) as { id?: string; provider_id?: string } | { id?: string }[] | undefined

    let resendId: string | undefined
    if (Array.isArray(sendResult)) {
      resendId = (sendResult[0]?.id as string | undefined) ?? undefined
    } else if (sendResult && typeof sendResult === "object") {
      resendId =
        ((sendResult as { id?: string }).id as string | undefined) ?? undefined
    }

    const sent_at = new Date().toISOString()
    const newEntry: RecoveryEmailEntry = {
      template: tpl,
      sent_at,
      ...(couponCode ? { code: couponCode } : {}),
      ...(couponExpiresAt ? { expires_at: couponExpiresAt } : {}),
      ...(resendId ? { resend_id: resendId } : {}),
    }

    const cartModule = req.scope.resolve(Modules.CART) as CartModuleLike
    await cartModule.updateCarts(cart.id, {
      metadata: {
        ...(cart.metadata ?? {}),
        recovery_emails: [...existing, newEntry],
      },
    })

    return res.status(200).json({
      sent_at,
      ...(couponCode ? { code: couponCode } : {}),
      ...(couponExpiresAt ? { expires_at: couponExpiresAt } : {}),
      ...(resendId ? { resend_id: resendId } : {}),
    })
  } catch (err) {
    const message =
      (err as Error)?.message ?? "Failed to send recovery email"
    logger.error(`[admin/abandoned-carts email] ${message}`)
    return res.status(500).json({ message })
  }
}
