import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { AI_AGENT_MODULE } from "../../../../modules/ai-agent"
import type AiAgentModuleService from "../../../../modules/ai-agent/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
  const entries = await service.listKnowledgeEntries({}, { order: { title: "ASC" } })
  res.json({ entries })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const title = String(body.title ?? "").trim()
  const text = String(body.body ?? "").trim()
  if (!title || !text) {
    res.status(400).json({ message: "title and body are required" })
    return
  }
  const entry = await service.createKnowledgeEntries({
    title,
    body: text,
    tags: Array.isArray(body.tags) ? body.tags : null,
    is_active: body.is_active !== false,
    updated_by: (req as { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? null,
  } as never)
  res.json({ entry })
}
