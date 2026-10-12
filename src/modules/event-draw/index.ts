import { Module } from "@medusajs/framework/utils"

import EventDrawModuleService from "./service"

export const EVENT_DRAW_MODULE = "event_draw"

export default Module(EVENT_DRAW_MODULE, {
  service: EventDrawModuleService,
})
