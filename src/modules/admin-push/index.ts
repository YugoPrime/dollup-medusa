import { Module } from "@medusajs/framework/utils"

import AdminPushModuleService from "./service"

export const ADMIN_PUSH_MODULE = "admin_push"

export default Module(ADMIN_PUSH_MODULE, {
  service: AdminPushModuleService,
})
