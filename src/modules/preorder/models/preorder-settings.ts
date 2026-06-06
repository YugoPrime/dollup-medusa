import { model } from "@medusajs/framework/utils"

/**
 * Single-row settings for the SHEIN pre-order subsystem.
 *
 * The service owns the singleton ID and creates the row lazily on first read,
 * matching the LoyaltySettings pattern.
 */
const PreorderSettings = model.define("PreorderSettings", {
  id: model.id({ prefix: "preset" }).primaryKey(),
  fx_rate_usd_to_mur: model.number().default(50),
  customs_percent: model.number().default(25),
  handling_tier_1_max: model.number().default(500),
  handling_tier_1_fee: model.number().default(150),
  handling_tier_2_max: model.number().default(1000),
  handling_tier_2_fee: model.number().default(300),
  handling_tier_3_max: model.number().default(2000),
  handling_tier_3_fee: model.number().default(600),
  handling_tier_4_flat: model.number().default(1000),
  handling_tier_4_percent: model.number().default(30),
  round_to_mur: model.number().default(10),
  eta_min_days: model.number().default(15),
  eta_max_days: model.number().default(20),
  deposit_percent: model.number().default(75),
  submissions_per_ip_per_hour: model.number().default(5),
  submissions_per_day_total: model.number().default(50),
  // Liveness heartbeat written by the SHEIN headless daemon every poll.
  // Used to detect daemon-offline so new quote items go straight to manual.
  shein_daemon_last_seen_at: model.dateTime().nullable(),
})

export default PreorderSettings
