/**
 * DollUp Boutique — Shipping & Payment Setup Script
 * Run: medusa exec ./src/scripts/setup-shipping.ts
 *
 * This script sets up:
 * 1. Fulfillment set + service zone for Mauritius
 * 2. Links stock location to fulfillment set
 * 3. Creates standard + express shipping options (free for now)
 * 4. Adds pp_system_default payment provider to Mauritius region
 */
import { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import {
  createShippingOptionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

export default async function setupShipping({ container }: ExecArgs) {
  const logger = container.resolve("logger" as any) as any;

  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const regionModuleService = container.resolve(Modules.REGION);
  const remoteLink = container.resolve("remoteLink" as any) as any;

  const REGION_ID = "reg_01KN0AAX4FA592Q3HAY93W1AHV";
  const STOCK_LOCATION_ID = "sloc_01KN48PYHQ0DTXXN2N0JWZSAYV";
  const SALES_CHANNEL_ID = "sc_01KN07JKHRN9DP25TM5S664C5W";

  // 1. Shipping profile (reuse default)
  logger.info("Getting shipping profile...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({ type: "default" });
  const shippingProfile = shippingProfiles[0];
  if (!shippingProfile) throw new Error("No default shipping profile found");
  logger.info(`Using shipping profile: ${shippingProfile.id}`);

  // 2. Create fulfillment set + Mauritius service zone
  logger.info("Creating fulfillment set...");
  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "DollUp Mauritius Delivery",
    type: "shipping",
    service_zones: [
      {
        name: "Mauritius",
        geo_zones: [{ type: "country", country_code: "mu" }],
      },
    ],
  });
  logger.info(`Fulfillment set created: ${fulfillmentSet.id}`);

  // 3. Link stock location to fulfillment set
  logger.info("Linking stock location to fulfillment set...");
  await remoteLink.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: STOCK_LOCATION_ID },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  });

  // 4. Link sales channel to stock location (in case not done)
  logger.info("Linking sales channel to stock location...");
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: STOCK_LOCATION_ID,
      add: [SALES_CHANNEL_ID],
    },
  });

  const serviceZoneId = fulfillmentSet.service_zones[0].id;

  // 5. Create shipping options
  logger.info("Creating shipping options...");
  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Livraison standard (3-5 jours)",
        price_type: "flat",
        service_zone_id: serviceZoneId,
        shipping_profile_id: shippingProfile.id,
        provider_id: "manual_manual",
        type: {
          label: "Standard",
          description: "Livraison en 3 à 5 jours ouvrables.",
          code: "standard",
        },
        prices: [
          {
            currency_code: "mur",
            amount: 0,
          },
          {
            region_id: REGION_ID,
            amount: 0,
          },
        ],
        rules: [],
      },
      {
        name: "Livraison express (1-2 jours)",
        price_type: "flat",
        service_zone_id: serviceZoneId,
        shipping_profile_id: shippingProfile.id,
        provider_id: "manual_manual",
        type: {
          label: "Express",
          description: "Livraison en 1 à 2 jours ouvrables.",
          code: "express",
        },
        prices: [
          {
            currency_code: "mur",
            amount: 15000,
          },
          {
            region_id: REGION_ID,
            amount: 15000,
          },
        ],
        rules: [],
      },
    ],
  });
  logger.info("Shipping options created ✅");

  // 6. Add payment provider to region
  logger.info("Adding payment provider to region...");
  await regionModuleService.upsertRegions([
    {
      id: REGION_ID,
      payment_providers: ["pp_system_default"],
    } as any,
  ]);
  logger.info("Payment provider added to region ✅");

  logger.info("=== DollUp shipping setup complete ===");
}
