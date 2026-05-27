/**
 * Doll Up Boutique — Pre-Order Shipping & Fulfillment Setup
 *
 * Run: yarn medusa exec ./src/scripts/setup-preorder-shipping.ts
 *
 * Wires up the Pre-Order sales channel with its own fulfillment chain so it is
 * fully isolated from the apex (in-stock) storefront:
 *
 *   Pre-Order Sales Channel → Pre-Order Fulfillment (stock location, virtual)
 *     → Doll Up Pre-Order Delivery (fulfillment set)
 *       → Pre-Order Mauritius zone (province=MU-*, excluding Rodrigues)
 *           Home delivery   Rs 150
 *           Postage         Rs 70   (requires_prepayment_on_arrival=true)
 *           Pickup Pereybere Rs 0   (is_pickup=true)
 *       → Pre-Order Rodrigues zone (province=MU-RO)
 *           Rodrigues Postage Rs 100 (requires_prepayment_on_arrival=true)
 *
 * Why a separate stock location:
 *   In Medusa v2, a cart's shipping options are derived from
 *   sales_channel → linked stock_locations → fulfillment_sets. Sharing the
 *   stock location with the apex (Default) channel would leak preorder options
 *   into apex checkout. The new "Pre-Order Fulfillment" location is virtual
 *   (same physical address as the warehouse) and exists only to enforce that
 *   isolation. Preorder products are created with manage_inventory=false, so
 *   no real stock is held against it.
 *
 * Idempotent — re-runs find existing entities by name and skip recreation. Safe
 * to run after partial failures.
 *
 * Requires env: PREORDER_SALES_CHANNEL_ID (matches the manually-created
 * Pre-Order channel in Medusa admin).
 */
import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

const PREORDER_LOCATION_NAME = "Pre-Order Fulfillment"
const PREORDER_FULFILLMENT_SET_NAME = "Doll Up Pre-Order Delivery"
const PREORDER_SHIPPING_PROFILE_NAME = "Pre-Order Shipping"
const MAINLAND_ZONE_NAME = "Pre-Order Mauritius"
const RODRIGUES_ZONE_NAME = "Pre-Order Rodrigues"

// All MU ISO 3166-2 province codes except Rodrigues.
const MAINLAND_PROVINCE_CODES = [
  "mu-bl", // Black River
  "mu-fl", // Flacq
  "mu-gp", // Grand Port
  "mu-mo", // Moka
  "mu-pa", // Pamplemousses
  "mu-pl", // Port Louis
  "mu-pw", // Plaines Wilhems
  "mu-rr", // Riviere du Rempart
  "mu-sa", // Savanne
]
const RODRIGUES_PROVINCE_CODE = "mu-ro"

type ShippingOptionSeed = {
  name: string
  code: string
  label: string
  description: string
  amount: number // MUR cents (Rs 150 = 15000)
  zone: "mainland" | "rodrigues"
  data: {
    requires_prepayment_on_arrival: boolean
    is_pickup: boolean
    shipping_zone: "mainland" | "rodrigues"
  }
}

const PREORDER_OPTIONS: ShippingOptionSeed[] = [
  {
    name: "Home delivery (Pre-Order)",
    code: "preorder-home-delivery",
    label: "Home delivery",
    description:
      "Delivered to your door after your piece arrives (~15-20 days from order). Balance paid on delivery.",
    amount: 15000,
    zone: "mainland",
    data: {
      requires_prepayment_on_arrival: false,
      is_pickup: false,
      shipping_zone: "mainland",
    },
  },
  {
    name: "Postage (Pre-Order)",
    code: "preorder-postage",
    label: "Postage",
    description:
      "Sent via Mauritius Post after your piece arrives. Full balance must be paid by Juice before posting.",
    amount: 7000,
    zone: "mainland",
    data: {
      requires_prepayment_on_arrival: true,
      is_pickup: false,
      shipping_zone: "mainland",
    },
  },
  {
    name: "Pickup at Pereybere (Pre-Order)",
    code: "preorder-pickup-pereybere",
    label: "Pickup at Pereybere",
    description:
      "Free pickup at our Pereybere studio once your piece arrives. Balance paid on pickup.",
    amount: 0,
    zone: "mainland",
    data: {
      requires_prepayment_on_arrival: false,
      is_pickup: true,
      shipping_zone: "mainland",
    },
  },
  {
    name: "Rodrigues Postage (Pre-Order)",
    code: "preorder-rodrigues-postage",
    label: "Rodrigues Postage",
    description:
      "Sent via Mauritius Post to Rodrigues after your piece arrives. Full balance must be paid by Juice before posting.",
    amount: 10000,
    zone: "rodrigues",
    data: {
      requires_prepayment_on_arrival: true,
      is_pickup: false,
      shipping_zone: "rodrigues",
    },
  },
]

export default async function setupPreorderShipping({ container }: ExecArgs) {
  const logger = container.resolve("logger" as any) as any

  const PREORDER_SALES_CHANNEL_ID = process.env.PREORDER_SALES_CHANNEL_ID
  if (!PREORDER_SALES_CHANNEL_ID) {
    throw new Error(
      "PREORDER_SALES_CHANNEL_ID env var is required. Create the 'Pre-Order' sales channel in Medusa admin first, then set its ID in the backend env.",
    )
  }

  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const regionService = container.resolve(Modules.REGION)

  // 1. Verify the Pre-Order sales channel exists.
  const preorderChannel = await salesChannelService.retrieveSalesChannel(
    PREORDER_SALES_CHANNEL_ID,
  )
  logger.info(
    `Pre-Order sales channel: ${preorderChannel.id} (${preorderChannel.name})`,
  )

  // 2. Region (re-used) — needed so we can attach MUR prices that resolve in
  //    Mauritius checkout.
  const [region] = await regionService.listRegions({ currency_code: "mur" })
  if (!region) {
    throw new Error(
      "No region with currency_code=mur found. Run setup-shipping.ts first to create the apex Mauritius region.",
    )
  }
  logger.info(`Region: ${region.id} (${region.name})`)

  // 3. Stock location — find-or-create the virtual Pre-Order Fulfillment
  //    location.
  let [preorderLocation] = await stockLocationService.listStockLocations({
    name: PREORDER_LOCATION_NAME,
  })
  if (!preorderLocation) {
    logger.info(`Creating stock location "${PREORDER_LOCATION_NAME}"...`)
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: PREORDER_LOCATION_NAME,
            address: {
              address_1: "Royal Road, Pereybere",
              city: "Pereybere",
              country_code: "mu",
            },
          },
        ],
      },
    })
    preorderLocation = result[0] as any
  } else {
    logger.info(`Stock location already exists: ${preorderLocation.id}`)
  }

  // 4. Link Pre-Order sales channel → Pre-Order stock location. Idempotent —
  //    the workflow no-ops if already linked.
  logger.info("Linking Pre-Order sales channel to Pre-Order stock location...")
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: preorderLocation.id,
      add: [PREORDER_SALES_CHANNEL_ID],
    },
  })

  // 5. Shipping profile — find-or-create dedicated Pre-Order profile.
  let [preorderProfile] = await fulfillmentService.listShippingProfiles({
    name: PREORDER_SHIPPING_PROFILE_NAME,
  })
  if (!preorderProfile) {
    logger.info(`Creating shipping profile "${PREORDER_SHIPPING_PROFILE_NAME}"...`)
    preorderProfile = await fulfillmentService.createShippingProfiles({
      name: PREORDER_SHIPPING_PROFILE_NAME,
      type: "default",
    })
  } else {
    logger.info(`Shipping profile already exists: ${preorderProfile.id}`)
  }

  // 6. Fulfillment set — find-or-create. If creating, also create both service
  //    zones in the same call.
  let [preorderFulfillmentSet] = await fulfillmentService.listFulfillmentSets({
    name: PREORDER_FULFILLMENT_SET_NAME,
  })
  if (!preorderFulfillmentSet) {
    logger.info(
      `Creating fulfillment set "${PREORDER_FULFILLMENT_SET_NAME}" with both service zones...`,
    )
    preorderFulfillmentSet = await fulfillmentService.createFulfillmentSets({
      name: PREORDER_FULFILLMENT_SET_NAME,
      type: "shipping",
      service_zones: [
        {
          name: MAINLAND_ZONE_NAME,
          geo_zones: MAINLAND_PROVINCE_CODES.map((code) => ({
            type: "province" as const,
            country_code: "mu",
            province_code: code,
          })),
        },
        {
          name: RODRIGUES_ZONE_NAME,
          geo_zones: [
            {
              type: "province" as const,
              country_code: "mu",
              province_code: RODRIGUES_PROVINCE_CODE,
            },
          ],
        },
      ],
    })
    logger.info(`Fulfillment set created: ${preorderFulfillmentSet.id}`)

    // Link the new fulfillment set to the Pre-Order stock location via the
    // remote link module. Without this link, list-shipping-options-for-cart
    // won't surface the options because it walks stock_location.fulfillment_sets.
    const remoteLink = container.resolve("remoteLink" as any) as any
    await remoteLink.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: preorderLocation.id },
      [Modules.FULFILLMENT]: {
        fulfillment_set_id: preorderFulfillmentSet.id,
      },
    })
    logger.info("Linked stock location ↔ fulfillment set")
  } else {
    logger.info(
      `Fulfillment set already exists: ${preorderFulfillmentSet.id}`,
    )
  }

  // 7. Resolve service zones (by name) for option creation. Re-fetch the
  //    fulfillment set with service_zones relation since the type-safe filter
  //    on ServiceZone doesn't expose fulfillment_set_id directly.
  const fulfillmentSetWithZones = await fulfillmentService.retrieveFulfillmentSet(
    preorderFulfillmentSet.id,
    { relations: ["service_zones"] },
  )
  const zones = (fulfillmentSetWithZones as any).service_zones ?? []
  const mainlandZone = zones.find((z: any) => z.name === MAINLAND_ZONE_NAME)
  const rodriguesZone = zones.find((z: any) => z.name === RODRIGUES_ZONE_NAME)
  if (!mainlandZone || !rodriguesZone) {
    throw new Error(
      `Service zones missing on fulfillment set ${preorderFulfillmentSet.id}: mainland=${!!mainlandZone}, rodrigues=${!!rodriguesZone}`,
    )
  }

  // 8. Shipping options — find-or-create each by name. We DON'T update prices
  //    on re-runs (avoid surprise edits to live options); ops must adjust in
  //    admin if needed.
  //
  //    Filter via the service_zone relation rather than service_zone_id column
  //    (the FilterableShippingOption type only exposes the nested form).
  const existingOptions = await fulfillmentService.listShippingOptions({
    service_zone: { id: [mainlandZone.id, rodriguesZone.id] },
  } as any)
  const existingByName = new Map<string, any>(
    existingOptions.map((o: any) => [o.name, o]),
  )

  const toCreate = PREORDER_OPTIONS.filter(
    (seed) => !existingByName.has(seed.name),
  )

  if (toCreate.length === 0) {
    logger.info("All 4 pre-order shipping options already exist — skipping.")
  } else {
    logger.info(
      `Creating ${toCreate.length} shipping option(s): ${toCreate
        .map((s) => s.name)
        .join(", ")}`,
    )
    await createShippingOptionsWorkflow(container).run({
      input: toCreate.map((seed) => ({
        name: seed.name,
        price_type: "flat" as const,
        service_zone_id:
          seed.zone === "mainland" ? mainlandZone.id : rodriguesZone.id,
        shipping_profile_id: preorderProfile.id,
        provider_id: "manual_manual",
        type: {
          label: seed.label,
          description: seed.description,
          code: seed.code,
        },
        data: seed.data,
        prices: [
          { currency_code: "mur", amount: seed.amount },
          { region_id: region.id, amount: seed.amount },
        ],
        // Rules: shipping options need at least one non-return rule to be
        // surfaced to a non-return cart. The province-code service zone
        // already does the geographic filtering; this rule just marks the
        // option as a non-return shipping option.
        rules: [
          {
            attribute: "is_return",
            operator: "eq",
            value: "false",
          },
        ],
      })),
    })
  }

  logger.info("")
  logger.info("=== Pre-Order shipping setup complete ✅ ===")
  logger.info(`Sales channel:    ${PREORDER_SALES_CHANNEL_ID}`)
  logger.info(`Stock location:   ${preorderLocation.id}`)
  logger.info(`Shipping profile: ${preorderProfile.id}`)
  logger.info(`Fulfillment set:  ${preorderFulfillmentSet.id}`)
  logger.info(`Mainland zone:    ${mainlandZone.id}`)
  logger.info(`Rodrigues zone:   ${rodriguesZone.id}`)
  logger.info("")
  logger.info(
    "Next: deploy backend (so PREORDER_SHIPPING_PROFILE_ID is read by the product-create route), then create a test preorder product via admin.",
  )
}
