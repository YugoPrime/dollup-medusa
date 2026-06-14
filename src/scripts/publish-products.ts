import { Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { SOURCING_MODULE } from "../modules/sourcing"
import type SourcingModuleService from "../modules/sourcing/service"

/**
 * Publish (draft -> published) the pushed products of the given drafts, with
 * optional category filtering and optional unlisting.
 *
 *   set -a; . ./.env.local-render; set +a
 *   yarn medusa exec ./src/scripts/publish-products.ts                              # DRY
 *   APPLY=true SKIP_CATEGORIES=intimates yarn medusa exec ...publish-products.ts    # fashion only
 *   APPLY=true ONLY_CATEGORIES=intimates UNLISTED=true yarn medusa exec ...         # After Dark, hidden
 *   APPLY=true ONLY_CATEGORIES=intimates yarn medusa exec ...                       # After Dark, public
 *
 * Env: APPLY  SKIP_CATEGORIES=h1,h2  ONLY_CATEGORIES=h1,h2  UNLISTED=true  DRAFT_IDS=
 */

const DEFAULT_DRAFTS = [
  "dord_01KSZ7E1GE57ZZ7FWKE1KFS0BP",
  "dord_01KS526JXKG4KY4JWBXE7R3AVC",
]

export default async function publish({ container }: { container: any }) {
  const logger = container.resolve("logger")
  const productModule = container.resolve(Modules.PRODUCT)
  const service = container.resolve(SOURCING_MODULE) as SourcingModuleService

  const apply = process.env.APPLY === "true"
  const unlisted = process.env.UNLISTED === "true"
  const skip = (process.env.SKIP_CATEGORIES || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  const only = (process.env.ONLY_CATEGORIES || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  const draftIds = (process.env.DRAFT_IDS || DEFAULT_DRAFTS.join(","))
    .split(",").map((s) => s.trim()).filter(Boolean)

  const ids: string[] = []
  for (const d of draftIds)
    for (const it of await service.listItems(d))
      if (it.published_product_id) ids.push(it.published_product_id)

  const products = await productModule.listProducts(
    { id: ids },
    { select: ["id", "handle", "status", "metadata"], relations: ["categories"], take: 1000 },
  )

  const targets: any[] = []
  for (const p of products as any[]) {
    const cats = (p.categories ?? []).map((c: any) => (c.handle ?? "").toLowerCase())
    if (only.length && !cats.some((c: string) => only.includes(c))) continue
    if (skip.length && cats.some((c: string) => skip.includes(c))) continue
    targets.push(p)
  }
  targets.sort((a, b) => (a.handle ?? "").localeCompare(b.handle ?? ""))

  logger.info(
    `publish-products: ${targets.length}/${products.length} match` +
      `${only.length ? ` only=[${only}]` : ""}${skip.length ? ` skip=[${skip}]` : ""}` +
      `${unlisted ? " +UNLISTED" : ""}  mode=${apply ? "APPLY" : "DRY-RUN"}`,
  )
  logger.info(`  ${targets.map((p) => p.handle?.toUpperCase()).join(", ")}`)

  if (!apply) {
    logger.info("\nDRY RUN — nothing published. Re-run with APPLY=true.")
    return
  }

  let done = 0
  for (const p of targets) {
    const input: any = { id: p.id, status: "published" as const }
    if (unlisted) input.metadata = { ...(p.metadata ?? {}), unlisted: true }
    await updateProductsWorkflow(container as never).run({ input: { products: [input] } })
    done++
  }
  logger.info(`\nDONE: published ${done} products${unlisted ? " (unlisted)" : ""}.`)
}
