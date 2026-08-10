import { MedusaService } from "@medusajs/framework/utils"

import { AgentRun } from "./models/agent-run"
import { AgentSetting } from "./models/agent-setting"
import { KnowledgeEntry } from "./models/knowledge-entry"

export const AGENT_SETTING_ID = "agset_default"

class AiAgentModuleService extends MedusaService({
  AgentRun,
  AgentSetting,
  KnowledgeEntry,
}) {}

export default AiAgentModuleService
