import { Module } from "@medusajs/framework/utils"

import StoriesRenderModuleService from "./service"

export const STORIES_RENDER_MODULE = "stories_render"

export default Module(STORIES_RENDER_MODULE, {
  service: StoriesRenderModuleService,
})

