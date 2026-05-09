import { Module } from "@medusajs/framework/utils"

import SourcingSettingsService from "./service"

export const SOURCING_SETTINGS_MODULE = "sourcing_settings"

export default Module(SOURCING_SETTINGS_MODULE, {
  service: SourcingSettingsService,
})
