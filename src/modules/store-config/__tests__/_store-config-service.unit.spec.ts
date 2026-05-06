import {
  DEFAULT_EMAIL_SETTINGS,
  DEFAULT_SHIPPING_SETTINGS,
  DEFAULT_STORE_SETTINGS,
  EMAIL_SETTINGS_ID,
  SHIPPING_SETTINGS_ID,
  STORE_SETTINGS_ID,
  type EmailSettingsDTO,
  type ShippingSettingsDTO,
  type StoreSettingsDTO,
} from "../service"

describe("store-config DTO contract", () => {
  it("exposes the expected singleton ids", () => {
    expect(EMAIL_SETTINGS_ID).toBe("email_settings")
    expect(SHIPPING_SETTINGS_ID).toBe("shipping_settings")
    expect(STORE_SETTINGS_ID).toBe("store_settings")
  })

  it("keeps email defaults aligned with the current notification behavior", () => {
    const dto: EmailSettingsDTO = {
      id: EMAIL_SETTINGS_ID,
      ...DEFAULT_EMAIL_SETTINGS,
    }

    expect(dto.enabled_order_placed).toBe(true)
    expect(dto.enabled_order_shipped).toBe(true)
    expect(dto.enabled_welcome).toBe(true)
    expect(dto.enabled_password_reset).toBe(true)
    expect(dto.enabled_order_delivered).toBe(false)
    expect(Object.keys(dto)).toHaveLength(7)
  })

  it("keeps shipping defaults aligned with storefront copy", () => {
    const dto: ShippingSettingsDTO = {
      id: SHIPPING_SETTINGS_ID,
      ...DEFAULT_SHIPPING_SETTINGS,
    }

    expect(dto.free_shipping_threshold_mur).toBe(1500)
    expect(dto.return_fee_mur).toBe(70)
    expect(Object.keys(dto)).toHaveLength(4)
  })

  it("keeps store defaults aligned with storefront contact info", () => {
    const dto: StoreSettingsDTO = {
      id: STORE_SETTINGS_ID,
      ...DEFAULT_STORE_SETTINGS,
    }

    expect(dto.contact_phone).toBe("+230 5941 6359")
    expect(dto.contact_email).toBe("hello@dollupboutique.com")
    expect(Object.keys(dto)).toHaveLength(9)
  })
})
