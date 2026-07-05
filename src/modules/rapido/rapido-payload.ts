export type RapidoItem = {
  productName: string
  unitPrice: number
  quantity: number
}

export type RapidoOrderPayload = {
  recipientName: string
  recipientPhone: string
  // Optional backup number (8 digits) the driver can call if the main fails.
  recipientPhoneAlt?: string
  deliveryAddress: string
  zone: string
  parcelCount: number
  codAmount: number
  deliveryFeeBearer: "merchant" | "customer"
  externalOrderRef: string
  items: RapidoItem[]
  // Optional. true → Rapido stages the order as DRAFT (not released for pickup).
  draft?: boolean
}

export function validateRapidoPayload(
  payload: unknown,
): { ok: true; value: RapidoOrderPayload } | { ok: false; error: string } {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "payload must be an object" }
  }
  const p = payload as Record<string, unknown>
  if (typeof p.recipientName !== "string" || p.recipientName.trim() === "") {
    return { ok: false, error: "recipientName is required" }
  }
  if (typeof p.recipientPhone !== "string" || !/^\d{8}$/.test(p.recipientPhone)) {
    return { ok: false, error: "recipientPhone must be 8 digits" }
  }
  if (
    p.recipientPhoneAlt !== undefined &&
    (typeof p.recipientPhoneAlt !== "string" || !/^\d{8}$/.test(p.recipientPhoneAlt))
  ) {
    return { ok: false, error: "recipientPhoneAlt must be 8 digits" }
  }
  if (typeof p.deliveryAddress !== "string" || p.deliveryAddress.trim() === "") {
    return { ok: false, error: "deliveryAddress is required" }
  }
  if (typeof p.zone !== "string" || p.zone.trim() === "") {
    return { ok: false, error: "zone is required" }
  }
  if (typeof p.parcelCount !== "number" || !Number.isInteger(p.parcelCount) || p.parcelCount < 1) {
    return { ok: false, error: "parcelCount must be a positive integer" }
  }
  if (typeof p.codAmount !== "number" || p.codAmount < 0) {
    return { ok: false, error: "codAmount must be >= 0" }
  }
  if (p.deliveryFeeBearer !== "merchant" && p.deliveryFeeBearer !== "customer") {
    return { ok: false, error: "deliveryFeeBearer is invalid" }
  }
  if (typeof p.externalOrderRef !== "string" || p.externalOrderRef.trim() === "") {
    return { ok: false, error: "externalOrderRef is required" }
  }
  if (p.draft !== undefined && typeof p.draft !== "boolean") {
    return { ok: false, error: "draft must be a boolean" }
  }
  if (!Array.isArray(p.items) || p.items.length === 0) {
    return { ok: false, error: "items must be a non-empty array" }
  }
  for (const item of p.items) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "each item needs a productName" }
    }
    const itemObj = item as Record<string, unknown>
    if (typeof itemObj.productName !== "string" || itemObj.productName.trim() === "") {
      return { ok: false, error: "each item needs a productName" }
    }
    if (typeof itemObj.unitPrice !== "number" || itemObj.unitPrice < 0) {
      return { ok: false, error: "each item needs a unitPrice >= 0" }
    }
    if (typeof itemObj.quantity !== "number" || !Number.isInteger(itemObj.quantity) || itemObj.quantity < 1) {
      return { ok: false, error: "each item needs a quantity >= 1" }
    }
  }
  return { ok: true, value: p as unknown as RapidoOrderPayload }
}
