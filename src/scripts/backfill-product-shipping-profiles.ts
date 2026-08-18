import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Backfill the Default Shipping Profile onto products that have NO shipping
 * profile. Products created via the sourcing push (createProductsWorkflow
 * without shipping_profile_id) land unprofiled — Medusa v2 does NOT auto-attach
 * the default profile for programmatic creates. An unprofiled product cannot be
 * fulfilled: "Mark Delivered" fails with
 *   "Shipping profile sp_... does not match the shipping profile of the order item ..."
 *
 * This links every unprofiled product to a shipping profile:
 *   - handle contains "preorder"  -> Pre-Order Shipping profile
 *   - everything else             -> Default Shipping Profile
 * (A pre-order product on the Default profile would break its pre-order
 * checkout, which uses the Pre-Order shipping options.) It deliberately SKIPS
 * products that already have any profile, so it never re-points existing items.
 *
 * Safe + idempotent: read-then-write, only touches products with no profile.
 *
 *   set -a; . ./.env.local-render; set +a
 *   DRY_RUN=true yarn medusa exec ./src/scripts/backfill-product-shipping-profiles.ts
 *   yarn medusa exec ./src/scripts/backfill-product-shipping-profiles.ts
 *
 * Env flags:
 *   DRY_RUN=true    report which products WOULD be linked, write nothing
 *
 * Keep this script — it's the on-demand fix for any sourced product that hits
 * the "Shipping profile does not match" error on Mark Delivered. The permanent
 * fix is in src/modules/sourcing/service.ts (createProductsWorkflow now passes
 * shipping_profile_id), so going forward new products are profiled on creation;
 * this only repairs the pre-fix backlog.
 */
const DEFAULT_PROFILE_NAME = "Default Shipping Profile"
const PREORDER_PROFILE_NAME = "Pre-Order Shipping"

export default async function backfill({ container }: { container: any }) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  const dryRun = process.env.DRY_RUN === "true"

  // Resolve the Default profile by name (don't hardcode the id — but log it so
  // it's auditable). There are two type=default profiles here (Default +
  // Pre-Order), so we match on name, not type.
  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name"],
  })
  const profileList = profiles as Array<{ id: string; name: string }>
  const defaultProfile = profileList.find((p) => p.name === DEFAULT_PROFILE_NAME)
  const preorderProfile = profileList.find(
    (p) => p.name === PREORDER_PROFILE_NAME,
  )
  if (!defaultProfile) {
    logger.error(
      `Could not find a shipping profile named "${DEFAULT_PROFILE_NAME}". Aborting.`,
    )
    return
  }
  logger.info(`Default profile:  ${defaultProfile.id} ("${defaultProfile.name}")`)
  if (preorderProfile) {
    logger.info(
      `Pre-Order profile: ${preorderProfile.id} ("${preorderProfile.name}")`,
    )
  }

  // Route a product to the right profile: pre-order products (by handle) need
  // the Pre-Order profile so their pre-order checkout/fulfilment works; all
  // others get the Default profile. Falls back to Default if the Pre-Order
  // profile is missing.
  const profileFor = (p: { handle?: string | null }) =>
    p.handle && p.handle.includes("preorder") && preorderProfile
      ? preorderProfile
      : defaultProfile

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "status", "shipping_profile.id"],
  })

  const unprofiled = (products as Array<any>).filter(
    (p) => !p.shipping_profile?.id,
  )

  logger.info(
    `\n${unprofiled.length} product(s) have NO shipping profile:\n`,
  )
  for (const p of unprofiled) {
    const target = profileFor(p)
    const tag = target === preorderProfile ? "PRE-ORDER" : "default"
    logger.info(`  ${p.handle ?? p.id}  [${p.status}]  -> ${tag}  "${p.title}"`)
  }

  if (unprofiled.length === 0) {
    logger.info(`\nNothing to do.`)
    return
  }

  if (dryRun) {
    logger.info(
      `\n[DRY RUN] WOULD link ${unprofiled.length} product(s). Wrote nothing.`,
    )
    return
  }

  let linked = 0
  for (const p of unprofiled) {
    const target = profileFor(p)
    try {
      await link.create({
        [Modules.PRODUCT]: { product_id: p.id },
        [Modules.FULFILLMENT]: { shipping_profile_id: target.id },
      })
      linked++
      logger.info(`linked ${p.handle ?? p.id} -> ${target.id}`)
    } catch (e) {
      logger.error(
        `failed to link ${p.handle ?? p.id}: ${(e as Error).message}`,
      )
    }
  }

  logger.info(`\nDone. Linked ${linked}/${unprofiled.length} product(s).`)
}
