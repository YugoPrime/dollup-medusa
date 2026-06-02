/**
 * Maps the agent's clean delivery-method keys to (a) the real Mauritius
 * shipping-option id and (b) the raw `delivery_method` metadata string the rest
 * of the Doll Up system expects.
 *
 * The metadata strings here MUST match what `email-on-order-shipped.ts`
 * (normalizeDeliveryMethod) and `export-orders-csv.ts` read. See those files
 * before changing any value.
 *
 * Shipping-option ids were pulled from the live Mauritius region on 2026-06-02.
 * If shipping options are recreated, re-probe and update these.
 */

export type DeliveryKey =
  | "home_delivery"
  | "post_office"
  | "express"
  | "pickup"
  | "rodrigues"

type DeliveryConfig = {
  /** Real shipping_option_id in the Mauritius service zone. */
  shipping_option_id: string
  /** Human label shown on the shipping method line. */
  shipping_method_name: string
  /** The exact string written to order.metadata.delivery_method. */
  metadata_label: string
}

export const REGION_ID_MU = "reg_01KN0AAX4FA592Q3HAY93W1AHV"
export const SALES_CHANNEL_ID = "sc_01KN07JKHRN9DP25TM5S664C5W"

export const DELIVERY_MAP: Record<DeliveryKey, DeliveryConfig> = {
  home_delivery: {
    shipping_option_id: "so_01KN7026VC5TN711WFX5WJ42Y7",
    shipping_method_name: "Home/Office Delivery",
    metadata_label: "Home Delivery",
  },
  post_office: {
    shipping_option_id: "so_01KN7026VC8N1SNK1RRP1DK14H",
    shipping_method_name: "Registered Postage",
    metadata_label: "Postage",
  },
  express: {
    shipping_option_id: "so_01KN7026VD4JX2MACM6SK4PQR3",
    shipping_method_name: "Express Postage",
    metadata_label: "Express Postage",
  },
  pickup: {
    shipping_option_id: "so_01KN7026VDVZEGH4TX9TDQE4PA",
    shipping_method_name: "Pick Up Pereybere",
    metadata_label: "Pick Up",
  },
  rodrigues: {
    shipping_option_id: "so_01KQVHBYDRPW5M8AJRK123GJ9N",
    shipping_method_name: "Rodrigues Postage",
    metadata_label: "Rodrigues Postage",
  },
}

export const DELIVERY_KEYS = Object.keys(DELIVERY_MAP) as DeliveryKey[]

export function isDeliveryKey(v: unknown): v is DeliveryKey {
  return typeof v === "string" && (DELIVERY_KEYS as string[]).includes(v)
}
