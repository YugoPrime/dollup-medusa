import { Module } from "@medusajs/framework/utils"

import StoreConfigModuleService from "./service"

export const STORE_CONFIG_MODULE = "store_config"

export default Module(STORE_CONFIG_MODULE, {
  service: StoreConfigModuleService,
})
