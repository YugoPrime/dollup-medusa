import type { RapidoOrderPayload } from "./rapido-payload"

export type RapidoCreateResult = {
  orderNumber: string
  status: string
  trackingNumbers: string[]
  warnings: string[]
}

const DEFAULT_BASE_URL =
  "https://wktlwrxxgnsirrkkkric.supabase.co/functions/v1/merchant-api"

export class RapidoClient {
  private apiKey: string
  private baseUrl: string

  constructor(opts?: { apiKey?: string; baseUrl?: string }) {
    this.apiKey = opts?.apiKey ?? process.env.RAPIDO_API_KEY ?? ""
    this.baseUrl = opts?.baseUrl ?? process.env.RAPIDO_BASE_URL ?? DEFAULT_BASE_URL
    if (!this.apiKey) throw new Error("RAPIDO_API_KEY is not set")
  }

  async createOrder(
    payload: RapidoOrderPayload,
    idempotencyKey: string,
  ): Promise<RapidoCreateResult> {
    const res = await fetch(`${this.baseUrl}/orders`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "x-idempotency-key": idempotencyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new Error(`Rapido returned non-JSON (HTTP ${res.status})`)
    }

    const body = json as {
      success?: boolean
      error?: string
      data?: {
        orderNumber?: string
        status?: string
        trackingNumbers?: string[]
        warnings?: string[]
      }
    }

    if (!res.ok || !body.success || !body.data) {
      throw new Error(body.error || `Rapido create failed (HTTP ${res.status})`)
    }

    return {
      orderNumber: body.data.orderNumber ?? "",
      status: body.data.status ?? "READY_FOR_PICKUP",
      trackingNumbers: body.data.trackingNumbers ?? [],
      warnings: body.data.warnings ?? [],
    }
  }
}
