import { Module } from "@medusajs/framework/utils"
import AiAgentModuleService from "./service"

export const AI_AGENT_MODULE = "ai_agent"

export default Module(AI_AGENT_MODULE, {
  service: AiAgentModuleService,
})
