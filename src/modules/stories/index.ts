import { Module } from "@medusajs/framework/utils"

import StoriesModuleService from "./service"

export const STORIES_MODULE = "stories"

export default Module(STORIES_MODULE, {
  service: StoriesModuleService,
})
