import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { AI_AGENT_MODULE } from "../../../../modules/ai-agent"
import type AiAgentModuleService from "../../../../modules/ai-agent/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
  const query = req.query as Record<string, unknown>

  const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50))

  // "What did the agent do on this conversation" is the common admin question;
  // without a filter the UI would have to pull everything and filter client-side.
  const filter: Record<string, unknown> = {}
  if (typeof query.thread_id === "string" && query.thread_id.length > 0) {
    filter.thread_id = query.thread_id
  }

  const runs = await service.listAgentRuns(filter, {
    order: { created_at: "DESC" },
    take: limit,
  })
  res.json({ runs })
}
