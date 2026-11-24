import { QueryContext } from "@medusajs/framework/utils"

type GraphQuery = { graph: (args: any) => Promise<{ data: any[] }> }

/**
 * The `calculated_price` context for every server-side MUR price lookup (stories, feed, newsletter).
 *
 * Always send the Mauritius region, never the currency alone. In Medusa 2.13.1 a currency-only
 * context takes a query path that keeps prices from sale lists that have not started or have
 * ended (their list fails the join, the price row stays, with no list type). That row sorts first,
 * matches no list type, and the variant gets its full price: during Black Friday 2026 most story
 * pieces showed full price while the shop sold them on sale. With a region the rule-matching path
 * runs and drops those rows, the same way the storefront (which sends `region_id`) prices.
 *
 * If no MUR region exists it falls back to the currency alone, so lookups still work.
 */
export async function murPriceContext(query: GraphQuery) {
  const { data } = await query.graph({
    entity: "region",
    fields: ["id"],
    filters: { currency_code: "mur" },
  })
  const regionId: string | undefined = data?.[0]?.id
  if (!regionId) {
    console.warn("[pricing] no MUR region found: pricing with the currency only, so sale prices may show as full price")
  }
  return QueryContext(regionId ? { region_id: regionId, currency_code: "mur" } : { currency_code: "mur" })
}
