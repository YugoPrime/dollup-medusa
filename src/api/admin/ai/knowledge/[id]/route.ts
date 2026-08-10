import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { AI_AGENT_MODULE } from "../../../../../modules/ai-agent"
import type AiAgentModuleService from "../../../../../modules/ai-agent/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = { id: req.params.id }
  if (typeof body.title === "string") patch.title = body.title.trim()
  if (typeof body.body === "string") patch.body = body.body.trim()
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active
  if (Array.isArray(body.tags)) patch.tags = body.tags
  patch.updated_by =
    (req as { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? null
  res.json({ entry: await service.updateKnowledgeEntries(patch as never) })
}

/**
 * Soft-delete only. Knowledge entries are hand-written by the shop owner and
 * a hard delete is unrecoverable; the knowledge page already has an active
 * toggle, so deactivating gets the same "take this out of the agent's context"
 * effect without destroying the row. Callers see `deactivated: true` (not
 * `deleted`) so this doesn't read as more destructive than it is.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
  await service.updateKnowledgeEntries({
    id: req.params.id,
    is_active: false,
  } as never)
  res.json({ id: req.params.id, deactivated: true })
}
