import { Module } from "@medusajs/framework/utils"

import SourcingModuleService from "./service"

export const SOURCING_MODULE = "sourcing"

export default Module(SOURCING_MODULE, {
  service: SourcingModuleService,
})
