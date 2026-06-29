export type RapidoItem = {
  productName: string
  unitPrice: number
  quantity: number
}

export type RapidoOrderPayload = {
  recipientName: string
  recipientPhone: string
  deliveryAddress: string
  zone: string
  parcelCount: number
  codAmount: number
  deliveryFeeBearer: "merchant" | "customer"
  externalOrderRef: string
  items: RapidoItem[]
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
  if (typeof p.deliveryAddress !== "string" || p.deliveryAddress.trim() === "") {
    return { ok: false, error: "deliveryAddress is required" }
  }
  if (typeof p.zone !== "string" || p.zone.trim() === "") {
    return { ok: false, error: "zone is required" }
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
  if (!Array.isArray(p.items) || p.items.length === 0) {
    return { ok: false, error: "items must be a non-empty array" }
  }
  return { ok: true, value: p as unknown as RapidoOrderPayload }
}
