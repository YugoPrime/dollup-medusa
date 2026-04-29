/**
 * DollUp Boutique — verify hardcoded IDs in setup-shipping.ts
 * Run: yarn medusa exec ./src/scripts/check-ids.ts
 *
 * Lists all regions, stock locations, and sales channels in the DB,
 * then checks whether the IDs hardcoded in setup-shipping.ts still match.
 */
import { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

const HARDCODED = {
  REGION_ID: "reg_01KN0AAX4FA592Q3HAY93W1AHV",
  STOCK_LOCATION_ID: "sloc_01KN48PYHQ0DTXXN2N0JWZSAYV",
  SALES_CHANNEL_ID: "sc_01KN07JKHRN9DP25TM5S664C5W",
};

export default async function checkIds({ container }: ExecArgs) {
  const logger = container.resolve("logger" as any) as any;

  const regionService = container.resolve(Modules.REGION);
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION);
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL);

  const regions = await regionService.listRegions({});
  const stockLocations = await stockLocationService.listStockLocations({});
  const salesChannels = await salesChannelService.listSalesChannels({});

  logger.info("\n=== REGIONS ===");
  regions.forEach((r: any) => {
    const match = r.id === HARDCODED.REGION_ID ? " ← hardcoded" : "";
    logger.info(`  ${r.id}  |  ${r.name}  |  ${r.currency_code}${match}`);
  });

  logger.info("\n=== STOCK LOCATIONS ===");
  stockLocations.forEach((s: any) => {
    const match = s.id === HARDCODED.STOCK_LOCATION_ID ? " ← hardcoded" : "";
    logger.info(`  ${s.id}  |  ${s.name}${match}`);
  });

  logger.info("\n=== SALES CHANNELS ===");
  salesChannels.forEach((sc: any) => {
    const match = sc.id === HARDCODED.SALES_CHANNEL_ID ? " ← hardcoded" : "";
    logger.info(`  ${sc.id}  |  ${sc.name}${match}`);
  });

  logger.info("\n=== VERDICT ===");
  const regionOk = regions.some((r: any) => r.id === HARDCODED.REGION_ID);
  const locOk = stockLocations.some((s: any) => s.id === HARDCODED.STOCK_LOCATION_ID);
  const scOk = salesChannels.some((sc: any) => sc.id === HARDCODED.SALES_CHANNEL_ID);
  logger.info(`  REGION_ID         ${regionOk ? "✅ valid" : "❌ STALE — update setup-shipping.ts"}`);
  logger.info(`  STOCK_LOCATION_ID ${locOk ? "✅ valid" : "❌ STALE — update setup-shipping.ts"}`);
  logger.info(`  SALES_CHANNEL_ID  ${scOk ? "✅ valid" : "❌ STALE — update setup-shipping.ts"}`);
}
