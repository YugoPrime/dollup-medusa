import { Module } from "@medusajs/framework/utils"
import ChatModuleService from "./service"

export const CHAT_MODULE = "chat"

export default Module(CHAT_MODULE, {
  service: ChatModuleService,
})
