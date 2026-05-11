import { randomBytes, timingSafeEqual } from "node:crypto"

import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import EmailSettings from "./models/email-settings"
import ShippingSettings from "./models/shipping-settings"
import StoreSettings from "./models/store-settings"

export const EMAIL_SETTINGS_ID = "email_settings"
export const SHIPPING_SETTINGS_ID = "shipping_settings"
export const STORE_SETTINGS_ID = "store_settings"

export type EmailSettingsDTO = {
  id: string
  enabled_order_placed: boolean
  enabled_order_shipped: boolean
  enabled_welcome: boolean
  enabled_password_reset: boolean
  enabled_order_delivered: boolean
  from_email_mirror: string
}

export type ShippingSettingsDTO = {
  id: string
  free_shipping_threshold_mur: number
  return_fee_mur: number
  preorder_eta_copy: string
}

export type StoreSettingsDTO = {
  id: string
  contact_phone: string
  contact_email: string
  contact_hours: string
  instagram_url: string
  facebook_url: string
  tiktok_url: string
  whatsapp_url: string
  footer_copyright: string
  intimates_unlock_token: string
}

export type UpdateEmailSettingsInput = Partial<
  Omit<EmailSettingsDTO, "id" | "from_email_mirror">
>
export type UpdateShippingSettingsInput = Partial<
  Omit<ShippingSettingsDTO, "id">
>
export type UpdateStoreSettingsInput = Partial<Omit<StoreSettingsDTO, "id">>

export const DEFAULT_EMAIL_SETTINGS: Omit<EmailSettingsDTO, "id"> = {
  enabled_order_placed: true,
  enabled_order_shipped: true,
  enabled_welcome: true,
  enabled_password_reset: true,
  enabled_order_delivered: false,
  from_email_mirror: "",
}

export const DEFAULT_SHIPPING_SETTINGS: Omit<ShippingSettingsDTO, "id"> = {
  free_shipping_threshold_mur: 1500,
  return_fee_mur: 70,
  preorder_eta_copy:
    "Confirm before noon to receive your order the next day across Mauritius.",
}

export const DEFAULT_STORE_SETTINGS: Omit<StoreSettingsDTO, "id"> = {
  contact_phone: "+230 5941 6359",
  contact_email: "hello@dollupboutique.com",
  contact_hours: "Mon-Sat 09:00-18:00 (Mauritius time)",
  instagram_url: "https://www.instagram.com/dollupboutique/",
  facebook_url: "https://www.facebook.com/dollupboutique/",
  tiktok_url: "https://www.tiktok.com/@dollupboutique",
  whatsapp_url: "https://wa.me/23059416359",
  footer_copyright:
    "Doll Up Boutique Limited. BRN C18159019 - VAT 27646277.",
  intimates_unlock_token: "",
}

class StoreConfigModuleService extends MedusaService({
  EmailSettings,
  ShippingSettings,
  StoreSettings,
}) {
  async getEmailSettings(): Promise<EmailSettingsDTO> {
    const service = this as unknown as {
      listEmailSettings: (
        filters: Record<string, unknown>,
      ) => Promise<EmailSettingsDTO[]>
      createEmailSettings: (
        input: EmailSettingsDTO,
      ) => Promise<EmailSettingsDTO>
    }
    const existing = await service.listEmailSettings({ id: EMAIL_SETTINGS_ID })
    const fromMirror = process.env.RESEND_FROM_EMAIL ?? ""

    if (existing.length > 0) {
      if (existing[0].from_email_mirror !== fromMirror) {
        return this.updateEmailSettingsRow({ from_email_mirror: fromMirror })
      }
      return existing[0]
    }

    return service.createEmailSettings({
      id: EMAIL_SETTINGS_ID,
      ...DEFAULT_EMAIL_SETTINGS,
      from_email_mirror: fromMirror,
    })
  }

  async updateEmailSettingsConfig(
    input: UpdateEmailSettingsInput,
  ): Promise<EmailSettingsDTO> {
    await this.getEmailSettings()
    const allowed: UpdateEmailSettingsInput = {}

    for (const key of [
      "enabled_order_placed",
      "enabled_order_shipped",
      "enabled_welcome",
      "enabled_password_reset",
      "enabled_order_delivered",
    ] as const) {
      if (key in input) {
        allowed[key] = Boolean(input[key])
      }
    }

    return this.updateEmailSettingsRow(allowed)
  }

  private async updateEmailSettingsRow(
    input: Partial<EmailSettingsDTO>,
  ): Promise<EmailSettingsDTO> {
    const service = this as unknown as {
      updateEmailSettings: (
        input: Partial<EmailSettingsDTO> & { id: string },
      ) => Promise<EmailSettingsDTO>
    }

    return service.updateEmailSettings({ id: EMAIL_SETTINGS_ID, ...input })
  }

  async getShippingSettings(): Promise<ShippingSettingsDTO> {
    const service = this as unknown as {
      listShippingSettings: (
        filters: Record<string, unknown>,
      ) => Promise<ShippingSettingsDTO[]>
      createShippingSettings: (
        input: ShippingSettingsDTO,
      ) => Promise<ShippingSettingsDTO>
    }
    const existing = await service.listShippingSettings({
      id: SHIPPING_SETTINGS_ID,
    })

    if (existing.length > 0) {
      return existing[0]
    }

    return service.createShippingSettings({
      id: SHIPPING_SETTINGS_ID,
      ...DEFAULT_SHIPPING_SETTINGS,
    })
  }

  async updateShippingSettingsConfig(
    input: UpdateShippingSettingsInput,
  ): Promise<ShippingSettingsDTO> {
    const current = await this.getShippingSettings()
    const next: UpdateShippingSettingsInput = {}

    if ("free_shipping_threshold_mur" in input) {
      next.free_shipping_threshold_mur = input.free_shipping_threshold_mur
    }
    if ("return_fee_mur" in input) {
      next.return_fee_mur = input.return_fee_mur
    }
    if ("preorder_eta_copy" in input) {
      next.preorder_eta_copy = input.preorder_eta_copy
    }

    this.validateShippingSettings({ ...current, ...next })

    const service = this as unknown as {
      updateShippingSettings: (
        input: Partial<ShippingSettingsDTO> & { id: string },
      ) => Promise<ShippingSettingsDTO>
    }

    return service.updateShippingSettings({
      id: SHIPPING_SETTINGS_ID,
      ...next,
    })
  }

  async getStoreSettings(): Promise<StoreSettingsDTO> {
    const service = this as unknown as {
      listStoreSettings: (
        filters: Record<string, unknown>,
      ) => Promise<StoreSettingsDTO[]>
      createStoreSettings: (
        input: StoreSettingsDTO,
      ) => Promise<StoreSettingsDTO>
    }
    const existing = await service.listStoreSettings({ id: STORE_SETTINGS_ID })

    if (existing.length > 0) {
      return existing[0]
    }

    return service.createStoreSettings({
      id: STORE_SETTINGS_ID,
      ...DEFAULT_STORE_SETTINGS,
    })
  }

  async updateStoreSettingsConfig(
    input: UpdateStoreSettingsInput,
  ): Promise<StoreSettingsDTO> {
    const current = await this.getStoreSettings()
    const next: UpdateStoreSettingsInput = {}

    for (const key of [
      "contact_phone",
      "contact_email",
      "contact_hours",
      "instagram_url",
      "facebook_url",
      "tiktok_url",
      "whatsapp_url",
      "footer_copyright",
    ] as const) {
      if (key in input) {
        next[key] = input[key]
      }
    }

    this.validateStoreSettings({ ...current, ...next })

    // intimates_unlock_token is rotated/cleared via dedicated methods, not
    // by hand-typing into this form — silently drop it if it sneaks through.

    const service = this as unknown as {
      updateStoreSettings: (
        input: Partial<StoreSettingsDTO> & { id: string },
      ) => Promise<StoreSettingsDTO>
    }

    return service.updateStoreSettings({ id: STORE_SETTINGS_ID, ...next })
  }

  private validateShippingSettings(settings: UpdateShippingSettingsInput) {
    for (const key of [
      "free_shipping_threshold_mur",
      "return_fee_mur",
    ] as const) {
      const value = settings[key]
      if (
        value === undefined ||
        !Number.isFinite(value) ||
        Math.trunc(value) !== value ||
        value < 0
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${key} must be a non-negative integer`,
        )
      }
    }

    const copy = settings.preorder_eta_copy
    if (!copy || copy.trim().length === 0 || copy.length > 500) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "preorder_eta_copy must be 1-500 characters",
      )
    }
  }

  private validateStoreSettings(settings: UpdateStoreSettingsInput) {
    for (const [key, value] of Object.entries(settings)) {
      if (key === "intimates_unlock_token") continue
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${key} cannot be blank`,
        )
      }
      if (value.length > 500) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${key} must be 500 characters or fewer`,
        )
      }
    }
  }

  async rotateIntimatesUnlockToken(): Promise<string> {
    await this.getStoreSettings()
    const token = randomBytes(24).toString("hex") // 48-char hex string
    const service = this as unknown as {
      updateStoreSettings: (
        input: Partial<StoreSettingsDTO> & { id: string },
      ) => Promise<StoreSettingsDTO>
    }
    await service.updateStoreSettings({
      id: STORE_SETTINGS_ID,
      intimates_unlock_token: token,
    })
    return token
  }

  async clearIntimatesUnlockToken(): Promise<void> {
    await this.getStoreSettings()
    const service = this as unknown as {
      updateStoreSettings: (
        input: Partial<StoreSettingsDTO> & { id: string },
      ) => Promise<StoreSettingsDTO>
    }
    await service.updateStoreSettings({
      id: STORE_SETTINGS_ID,
      intimates_unlock_token: "",
    })
  }

  // Constant-time compare. Empty stored token always returns false so the
  // private catalog stays locked when not provisioned.
  async verifyIntimatesUnlockToken(candidate: string): Promise<boolean> {
    if (typeof candidate !== "string" || candidate.length === 0) return false
    const settings = await this.getStoreSettings()
    const stored = settings.intimates_unlock_token
    if (!stored || stored.length === 0) return false
    const a = Buffer.from(stored)
    const b = Buffer.from(candidate)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }
}

export default StoreConfigModuleService
