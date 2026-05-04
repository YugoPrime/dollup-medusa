/**
 * DollUp Boutique — verify records used by setup-shipping.ts
 * Run: yarn medusa exec ./src/scripts/check-ids.ts
 *
 * Lists all regions, stock locations, and sales channels in the DB,
 * then checks whether setup-shipping.ts can resolve the expected records.
 */
import { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

export default async function checkIds({ container }: ExecArgs) {
  const logger = container.resolve("logger" as any) as any;

  const regionService = container.resolve(Modules.REGION);
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION);
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL);

  const regionCurrency = "mur";
  const stockLocationName = process.env.SETUP_SHIPPING_STOCK_LOCATION_NAME || "European Warehouse";
  const salesChannelName = process.env.SETUP_SHIPPING_SALES_CHANNEL_NAME || "Default Sales Channel";

  const regions = await regionService.listRegions({});
  const stockLocations = await stockLocationService.listStockLocations({});
  const salesChannels = await salesChannelService.listSalesChannels({});

  logger.info("\n=== REGIONS ===");
  regions.forEach((r: any) => {
    const match = r.currency_code === regionCurrency ? " ← setup-shipping match" : "";
    logger.info(`  ${r.id}  |  ${r.name}  |  ${r.currency_code}${match}`);
  });

  logger.info("\n=== STOCK LOCATIONS ===");
  stockLocations.forEach((s: any) => {
    const match = s.name === stockLocationName ? " ← setup-shipping match" : "";
    logger.info(`  ${s.id}  |  ${s.name}${match}`);
  });

  logger.info("\n=== SALES CHANNELS ===");
  salesChannels.forEach((sc: any) => {
    const match = sc.name === salesChannelName ? " ← setup-shipping match" : "";
    logger.info(`  ${sc.id}  |  ${sc.name}${match}`);
  });

  logger.info("\n=== VERDICT ===");
  const regionOk = regions.some((r: any) => r.currency_code === regionCurrency);
  const locOk = stockLocations.some((s: any) => s.name === stockLocationName);
  const scOk = salesChannels.some((sc: any) => sc.name === salesChannelName);
  logger.info(`  REGION currency "${regionCurrency}"                 ${regionOk ? "valid" : "MISSING"}`);
  logger.info(`  STOCK_LOCATION name "${stockLocationName}" ${locOk ? "valid" : "MISSING"}`);
  logger.info(`  SALES_CHANNEL name "${salesChannelName}"   ${scOk ? "valid" : "MISSING"}`);
}
