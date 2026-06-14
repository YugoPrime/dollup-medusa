import { Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { SOURCING_MODULE } from "../modules/sourcing"
import type SourcingModuleService from "../modules/sourcing/service"
import { parseIsHandle } from "../modules/sourcing/lib/ref-allocator"

/**
 * Fix the off-by-one ref shift caused by push re-allocating refs contiguously
 * (getNextProductRef = max+1, no gaps) after IS2392 was deleted. Every product
 * from the gap onward ended up one number LOW vs the laptop photo folder.
 *
 * This shifts products with ref >= FROM up by +1 (re-opening the gap), updating
 * product handle + each variant SKU, descending so handles never collide.
 * SCOPED to products linked from the given drafts — touches nothing else.
 *
 *   set -a; . ./.env.local-render; set +a
 *   yarn medusa exec ./src/scripts/shift-product-refs.ts                 # DRY RUN
 *   APPLY=true yarn medusa exec ./src/scripts/shift-product-refs.ts      # WRITE
 *
 * Env: FROM=2392 (inclusive, default)  DRAFT_IDS=dord_a,dord_b  APPLY=true
 */

const DEFAULT_DRAFTS = [
  "dord_01KSZ7E1GE57ZZ7FWKE1KFS0BP",
  "dord_01KS526JXKG4KY4JWBXE7R3AVC",
]

export default async function shiftRefs({ container }: { container: any }) {
  const logger = container.resolve("logger")
  const productModule = container.resolve(Modules.PRODUCT)
  const service = container.resolve(SOURCING_MODULE) as SourcingModuleService

  const apply = process.env.APPLY === "true"
  const from = Number(process.env.FROM ?? 2392)
  const draftIds = (process.env.DRAFT_IDS || DEFAULT_DRAFTS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  // 1. Product ids linked from these drafts.
  const productIds: string[] = []
  for (const d of draftIds) {
    for (const it of await service.listItems(d)) {
      if (it.published_product_id) productIds.push(it.published_product_id)
    }
  }
  if (productIds.length === 0) {
    logger.error("No pushed products found on the given drafts.")
    return
  }

  // 2. Load handle + variants, keep IS#### products at or above FROM.
  const products = await productModule.listProducts(
    { id: productIds },
    { select: ["id", "handle", "title", "status"], relations: ["variants"], take: 1000 },
  )
  type Row = {
    id: string
    n: number
    handle: string
    title: string
    variants: { id: string; sku: string | null }[]
  }
  const rows: Row[] = []
  for (const p of products as any[]) {
    const n = parseIsHandle(p.handle ?? "")
    if (n === null || n < from) continue
    rows.push({
      id: p.id,
      n,
      handle: p.handle,
      title: p.title,
      variants: (p.variants ?? []).map((v: any) => ({ id: v.id, sku: v.sku })),
    })
  }
  if (rows.length === 0) {
    logger.error(`No products with IS#### handle >= IS${from} on these drafts.`)
    return
  }

  // 3. Descending so renaming never collides with an existing handle.
  rows.sort((a, b) => b.n - a.n)
  logger.info(
    `shift-product-refs: ${rows.length} products, IS${rows[rows.length - 1].n}..IS${rows[0].n} -> +1 each. mode=${apply ? "APPLY" : "DRY-RUN"}`,
  )

  for (const r of rows) {
    const newN = r.n + 1
    const newHandle = `is${newN}`
    const variantUpdates = r.variants.map((v) => ({
      id: v.id,
      sku: v.sku ? v.sku.replace(/^IS\d+/i, `IS${newN}`) : v.sku,
    }))
    const skuPreview = variantUpdates
      .map((v) => v.sku)
      .slice(0, 4)
      .join(", ")
    logger.info(
      `  IS${r.n} -> IS${newN}  "${r.title}"  [${skuPreview}${variantUpdates.length > 4 ? ", …" : ""}]`,
    )
    if (!apply) continue
    await updateProductsWorkflow(container as never).run({
      input: { products: [{ id: r.id, handle: newHandle, variants: variantUpdates }] },
    })
  }

  if (!apply) {
    logger.info("\nDRY RUN — nothing written. Re-run with APPLY=true to commit.")
    return
  }
  logger.info(`\nDONE: shifted ${rows.length} product refs up by 1.`)
}
