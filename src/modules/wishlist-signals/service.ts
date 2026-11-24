import { MedusaService } from "@medusajs/framework/utils"

import WishlistSignal from "./models/wishlist-signal"
import type { WishlistEvent } from "./validate"

type SignalRow = {
  id: string
  anon_id: string
  product_id: string
  customer_id: string | null
}

export type WishlistCount = {
  product_id: string
  /** Browsers that saved it while signed out. */
  guests: number
  /** Signed-in customers who saved it, each once. */
  customer_ids: string[]
}

type Generated = {
  listWishlistSignals: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<SignalRow[]>
  createWishlistSignals: (data: Record<string, unknown>[]) => Promise<SignalRow[]>
  updateWishlistSignals: (data: Record<string, unknown>[]) => Promise<SignalRow[]>
  deleteWishlistSignals: (ids: string[]) => Promise<void>
}

class WishlistSignalsModuleService extends MedusaService({ WishlistSignal }) {
  async recordEvent(e: WishlistEvent): Promise<void> {
    const svc = this as unknown as Generated
    const existing = await svc.listWishlistSignals(
      { anon_id: e.anonId, product_id: e.productIds },
      { take: null },
    )

    if (e.action === "remove") {
      if (existing.length) await svc.deleteWishlistSignals(existing.map((r) => r.id))
      return
    }

    const have = new Set(existing.map((r) => r.product_id))
    const fresh = e.productIds
      .filter((id) => !have.has(id))
      .map((product_id) => ({ anon_id: e.anonId, product_id, customer_id: e.customerId }))
    if (fresh.length) await svc.createWishlistSignals(fresh)

    // A guest heart becomes the customer's once that browser signs in. A
    // signed-out add never clears a customer already on the row.
    if (e.customerId) {
      const relink = existing
        .filter((r) => r.customer_id !== e.customerId)
        .map((r) => ({ id: r.id, customer_id: e.customerId }))
      if (relink.length) await svc.updateWishlistSignals(relink)
    }
  }

  async countsByProduct(): Promise<{ counts: WishlistCount[]; browsers: number }> {
    const svc = this as unknown as Generated
    const rows = await svc.listWishlistSignals(
      {},
      { select: ["anon_id", "product_id", "customer_id"], take: null },
    )
    const byProduct = new Map<string, { guests: number; customers: Set<string> }>()
    const browsers = new Set<string>()
    for (const r of rows) {
      browsers.add(r.anon_id)
      const c = byProduct.get(r.product_id) ?? { guests: 0, customers: new Set<string>() }
      if (r.customer_id) c.customers.add(r.customer_id)
      else c.guests += 1
      byProduct.set(r.product_id, c)
    }
    return {
      counts: [...byProduct].map(([product_id, c]) => ({
        product_id,
        guests: c.guests,
        customer_ids: [...c.customers],
      })),
      browsers: browsers.size,
    }
  }
}

export default WishlistSignalsModuleService
