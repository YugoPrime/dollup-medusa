/**
 * DollUp Boutique — Link existing products to the default shipping profile.
 * Run: yarn medusa exec ./src/scripts/link-products-shipping-profile.ts
 *
 * Background: products imported via the inventory-audit `import-medusa.ts`
 * script were created without a `shipping_profile_id`, so they have no
 * link to the default shipping profile. This breaks order fulfillment with:
 *   "Shipping profile sp_xxx does not match the shipping profile of the
 *    order item ordli_yyy"
 *
 * This script is idempotent: it only links products that don't already
 * have a shipping_profile link.
 */
import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

export default async function linkProductsShippingProfile({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const productModuleService = container.resolve(Modules.PRODUCT);

  // 1. Resolve the default shipping profile.
  const profiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  const defaultProfile = profiles[0];
  if (!defaultProfile) {
    throw new Error(
      "No default shipping profile found. Run setup-shipping.ts first.",
    );
  }
  logger.info(`Default shipping profile: ${defaultProfile.id}`);

  // 2. Find all existing product → shipping_profile links.
  const { data: existingLinks } = await query.graph({
    entity: "product_shipping_profile",
    fields: ["product_id", "shipping_profile_id"],
  });
  const linkedProductIds = new Set<string>(
    (existingLinks ?? []).map((l: { product_id: string }) => l.product_id),
  );
  logger.info(`Existing product links: ${linkedProductIds.size}`);

  // 3. List all products.
  const allProducts = await productModuleService.listProducts(
    {},
    { take: 10000, select: ["id"] },
  );
  logger.info(`Total products: ${allProducts.length}`);

  // 4. Identify products with no shipping_profile link.
  const unlinked = allProducts.filter((p) => !linkedProductIds.has(p.id));
  logger.info(`Products needing link: ${unlinked.length}`);

  if (unlinked.length === 0) {
    logger.info("Nothing to do — every product is already linked.");
    return;
  }

  // 5. Create the link for each unlinked product.
  let created = 0;
  for (const product of unlinked) {
    try {
      await link.create({
        [Modules.PRODUCT]: { product_id: product.id },
        [Modules.FULFILLMENT]: { shipping_profile_id: defaultProfile.id },
      });
      created++;
    } catch (err) {
      logger.warn(
        `Failed to link product ${product.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  logger.info(`Linked ${created}/${unlinked.length} products to default shipping profile.`);
  logger.info("=== Done ===");
}
