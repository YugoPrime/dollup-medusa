import { Module } from "@medusajs/framework/utils"

import LeadsModuleService from "./service"

export const LEADS_MODULE = "leads"

export default Module(LEADS_MODULE, {
  service: LeadsModuleService,
})
