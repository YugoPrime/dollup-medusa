import { Modules } from "@medusajs/framework/utils"
import { SOURCING_MODULE } from "../modules/sourcing"
import type SourcingModuleService from "../modules/sourcing/service"

/**
 * After shift-product-refs renumbered the live products, the draft items still
 * carry their stale (contiguous) refs. This re-points each pushed draft item's
 * ref to its product's current handle, so draft ref == product handle == folder.
 *
 *   set -a; . ./.env.local-render; set +a
 *   yarn medusa exec ./src/scripts/sync-draft-refs-to-products.ts              # DRY
 *   APPLY=true yarn medusa exec ./src/scripts/sync-draft-refs-to-products.ts   # WRITE
 *
 * Env: DRAFT_IDS=dord_a,dord_b  APPLY=true
 */

const DEFAULT_DRAFTS = [
  "dord_01KSZ7E1GE57ZZ7FWKE1KFS0BP",
  "dord_01KS526JXKG4KY4JWBXE7R3AVC",
]

export default async function syncRefs({ container }: { container: any }) {
  const logger = container.resolve("logger")
  const productModule = container.resolve(Modules.PRODUCT)
  const service = container.resolve(SOURCING_MODULE) as SourcingModuleService

  const apply = process.env.APPLY === "true"
  const draftIds = (process.env.DRAFT_IDS || DEFAULT_DRAFTS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  // Collect first, then apply DESCENDING by new ref — otherwise setting
  // IS2392->IS2393 while another item still holds IS2393 hits the unique
  // constraint on draft_item.ref. (Same reason shift-product-refs goes desc.)
  const plan: { itemId: string; cur: string; newRef: string; newN: number }[] = []
  for (const d of draftIds) {
    for (const it of await service.listItems(d)) {
      if (!it.published_product_id) continue
      const product = await productModule.retrieveProduct(
        it.published_product_id,
        { select: ["id", "handle"] },
      )
      const newRef = (product.handle ?? "").toUpperCase()
      const m = newRef.match(/^IS(\d+)$/)
      if (!m) {
        logger.warn(`  ${it.ref} -> product handle "${product.handle}" not IS#### — skipped`)
        continue
      }
      if (newRef === (it.ref ?? "").toUpperCase()) continue
      plan.push({ itemId: it.id, cur: it.ref ?? "(none)", newRef, newN: Number(m[1]) })
    }
  }
  plan.sort((a, b) => b.newN - a.newN)

  let changed = 0
  for (const p of plan) {
    logger.info(`  ${p.cur} -> ${p.newRef}`)
    changed++
    if (apply) await service.assignItemRef(p.itemId, p.newRef)
  }
  logger.info(
    apply
      ? `\nDONE: synced ${changed} draft refs.`
      : `\nDRY RUN — ${changed} draft refs would change. APPLY=true to write.`,
  )
}
