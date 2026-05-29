import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import type {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { Resend } from "resend"
import * as React from "react"

import OrderPlacedEmail, {
  type OrderPlacedEmailData,
} from "./templates/order-placed"
import OrderShippedEmail, {
  type OrderShippedEmailData,
} from "./templates/order-shipped"
import WelcomeEmail, { type WelcomeEmailData } from "./templates/welcome"
import PasswordResetEmail, {
  type PasswordResetEmailData,
} from "./templates/password-reset"
import CartRecoveryCheckinEmail, {
  type CartRecoveryCheckinData,
} from "./templates/cart-recovery-checkin"
import CartRecoveryCouponEmail, {
  type CartRecoveryCouponData,
} from "./templates/cart-recovery-coupon"
import PreorderDepositInstructionsEmail, {
  type PreorderDepositInstructionsData,
} from "./templates/preorder-deposit-instructions"
import PreorderDepositConfirmedEmail, {
  type PreorderDepositConfirmedData,
} from "./templates/preorder-deposit-confirmed"
import PreorderReservationExpiredEmail, {
  type PreorderReservationExpiredData,
} from "./templates/preorder-reservation-expired"

export enum EmailTemplate {
  ORDER_PLACED = "order-placed",
  ORDER_SHIPPED = "order-shipped",
  WELCOME = "welcome",
  PASSWORD_RESET = "password-reset",
  CART_RECOVERY_CHECKIN = "cart-recovery-checkin",
  CART_RECOVERY_COUPON = "cart-recovery-coupon",
  PREORDER_DEPOSIT_INSTRUCTIONS = "preorder-deposit-instructions",
  PREORDER_DEPOSIT_CONFIRMED = "preorder-deposit-confirmed",
  PREORDER_RESERVATION_EXPIRED = "preorder-reservation-expired",
}

// RFC 2606 reserved TLDs that will never resolve on the public internet.
// dollup-admin synthesizes `dm-<phone>@dollupboutique.local` for DM orders
// where the customer has no real email — sending to them guarantees a bounce
// and erodes Resend domain reputation.
const NON_SENDABLE_TLDS = new Set([
  "local",
  "localhost",
  "test",
  "invalid",
  "example",
])

export function isSendableEmail(addr: string): boolean {
  if (typeof addr !== "string") return false
  const at = addr.lastIndexOf("@")
  if (at < 1 || at === addr.length - 1) return false
  const domain = addr.slice(at + 1).toLowerCase()
  const tld = domain.includes(".") ? domain.split(".").pop()! : domain
  return !NON_SENDABLE_TLDS.has(tld)
}

type TemplateRenderer = (data: unknown) => React.ReactNode

const renderers: Record<EmailTemplate, TemplateRenderer> = {
  [EmailTemplate.ORDER_PLACED]: (data) =>
    React.createElement(OrderPlacedEmail, data as OrderPlacedEmailData),
  [EmailTemplate.ORDER_SHIPPED]: (data) =>
    React.createElement(OrderShippedEmail, data as OrderShippedEmailData),
  [EmailTemplate.WELCOME]: (data) =>
    React.createElement(WelcomeEmail, data as WelcomeEmailData),
  [EmailTemplate.PASSWORD_RESET]: (data) =>
    React.createElement(PasswordResetEmail, data as PasswordResetEmailData),
  [EmailTemplate.CART_RECOVERY_CHECKIN]: (data) =>
    React.createElement(
      CartRecoveryCheckinEmail,
      data as CartRecoveryCheckinData,
    ),
  [EmailTemplate.CART_RECOVERY_COUPON]: (data) =>
    React.createElement(
      CartRecoveryCouponEmail,
      data as CartRecoveryCouponData,
    ),
  [EmailTemplate.PREORDER_DEPOSIT_INSTRUCTIONS]: (data) =>
    React.createElement(
      PreorderDepositInstructionsEmail,
      data as PreorderDepositInstructionsData,
    ),
  [EmailTemplate.PREORDER_DEPOSIT_CONFIRMED]: (data) =>
    React.createElement(
      PreorderDepositConfirmedEmail,
      data as PreorderDepositConfirmedData,
    ),
  [EmailTemplate.PREORDER_RESERVATION_EXPIRED]: (data) =>
    React.createElement(
      PreorderReservationExpiredEmail,
      data as PreorderReservationExpiredData,
    ),
}

const defaultSubjects: Record<EmailTemplate, (data: unknown) => string> = {
  [EmailTemplate.ORDER_PLACED]: (data) => {
    const id = (data as OrderPlacedEmailData).displayId
    return `Order #${id} confirmed — thank you!`
  },
  [EmailTemplate.ORDER_SHIPPED]: (data) => {
    const d = data as OrderShippedEmailData
    if (d.deliveryMethod === "pickup") {
      return `Order #${d.displayId} ready for pickup`
    }
    if (d.deliveryMethod === "home_delivery") {
      return `Order #${d.displayId} scheduled for delivery${
        d.deliveryDate ? ` on ${d.deliveryDate}` : ""
      }`
    }
    return `Order #${d.displayId} has shipped`
  },
  [EmailTemplate.WELCOME]: () => "Welcome to Doll Up Boutique",
  [EmailTemplate.PASSWORD_RESET]: () =>
    "Reset your Doll Up Boutique password",
  [EmailTemplate.CART_RECOVERY_CHECKIN]: () =>
    "Did something go wrong with your order? 💭",
  [EmailTemplate.CART_RECOVERY_COUPON]: (data) => {
    const pct = (data as CartRecoveryCouponData).couponPercentage
    return `Here's ${pct}% off to come back 🎁`
  },
  [EmailTemplate.PREORDER_DEPOSIT_INSTRUCTIONS]: (data) => {
    const id = (data as PreorderDepositInstructionsData).displayId
    return `Reserve your pre-order #${id} — deposit due`
  },
  [EmailTemplate.PREORDER_DEPOSIT_CONFIRMED]: (data) => {
    const id = (data as PreorderDepositConfirmedData).displayId
    return `Deposit received — your pre-order #${id} is confirmed`
  },
  [EmailTemplate.PREORDER_RESERVATION_EXPIRED]: (data) => {
    const id = (data as PreorderReservationExpiredData).displayId
    return `Your pre-order #${id} reservation expired`
  },
}

export type ResendNotificationOptions = {
  api_key: string
  from: string
  from_name?: string
  reply_to?: string
}

type InjectedDependencies = {
  logger: Logger
}

class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-resend"

  private resendClient: Resend
  private options: ResendNotificationOptions
  private logger: Logger

  constructor(
    { logger }: InjectedDependencies,
    options: ResendNotificationOptions,
  ) {
    super()
    this.resendClient = new Resend(options.api_key)
    this.options = options
    this.logger = logger
  }

  static validateOptions(options: Record<string, unknown>) {
    if (!options.api_key || typeof options.api_key !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "notification-resend: `api_key` is required",
      )
    }
    if (!options.from || typeof options.from !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "notification-resend: `from` (sender email) is required",
      )
    }
  }

  private formatFrom(): string {
    const { from, from_name } = this.options
    return from_name ? `${from_name} <${from}>` : from
  }

  private getRenderer(template: string): TemplateRenderer | null {
    const allowed = Object.values(EmailTemplate) as string[]
    if (!allowed.includes(template)) {
      return null
    }
    return renderers[template as EmailTemplate]
  }

  private getSubject(
    template: string,
    data: unknown,
    overrideSubject?: string,
  ): string {
    if (overrideSubject) {
      return overrideSubject
    }
    const allowed = Object.values(EmailTemplate) as string[]
    if (!allowed.includes(template)) {
      return "Doll Up Boutique"
    }
    return defaultSubjects[template as EmailTemplate](data)
  }

  async send(
    notification: ProviderSendNotificationDTO,
  ): Promise<ProviderSendNotificationResultsDTO> {
    if (!notification.to) {
      this.logger.warn(
        `notification-resend: missing recipient for template ${notification.template}`,
      )
      return {}
    }

    if (!isSendableEmail(notification.to)) {
      this.logger.info(
        `notification-resend: skipping ${notification.template} → ${notification.to} (non-sendable placeholder address)`,
      )
      return {}
    }

    const renderer = this.getRenderer(notification.template)
    if (!renderer) {
      this.logger.error(
        `notification-resend: unknown template "${notification.template}". Allowed: ${Object.values(
          EmailTemplate,
        ).join(", ")}`,
      )
      return {}
    }

    const data = (notification.data ?? {}) as Record<string, unknown>
    const subjectOverride =
      typeof data.subject === "string" ? data.subject : undefined
    const subject = this.getSubject(
      notification.template,
      data,
      subjectOverride,
    )

    try {
      const { data: result, error } = await this.resendClient.emails.send({
        from: this.formatFrom(),
        to: [notification.to],
        subject,
        replyTo: this.options.reply_to ?? this.options.from,
        react: renderer(data),
      })

      if (error) {
        this.logger.error(
          `notification-resend: Resend rejected email (${notification.template} → ${notification.to}): ${error.name} ${error.message}`,
        )
        return {}
      }

      if (!result?.id) {
        this.logger.error(
          `notification-resend: Resend returned no id for ${notification.template} → ${notification.to}`,
        )
        return {}
      }

      this.logger.info(
        `notification-resend: sent ${notification.template} to ${notification.to} (id ${result.id})`,
      )
      return { id: result.id }
    } catch (err) {
      this.logger.error(
        `notification-resend: send threw for ${notification.template} → ${notification.to}: ${
          (err as Error).message
        }`,
      )
      return {}
    }
  }
}

export default ResendNotificationProviderService
