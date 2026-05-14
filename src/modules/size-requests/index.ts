import { Module } from "@medusajs/framework/utils"

import SizeRequestsModuleService from "./service"

export const SIZE_REQUESTS_MODULE = "size_requests"

export default Module(SIZE_REQUESTS_MODULE, {
  service: SizeRequestsModuleService,
})
