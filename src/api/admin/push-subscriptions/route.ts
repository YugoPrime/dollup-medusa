import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { ADMIN_PUSH_MODULE } from "../../../modules/admin-push"
import type AdminPushModuleService from "../../../modules/admin-push/service"
import { validateSubscriptionInput } from "../../../modules/admin-push/service"

function publicShape(row: { endpoint: string; user_agent: string | null; created_at: Date }) {
  return { endpoint: row.endpoint, user_agent: row.user_agent, created_at: row.created_at }
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AdminPushModuleService>(ADMIN_PUSH_MODULE)
  const query = req.query as Record<string, unknown>
  const username = typeof query.username === "string" ? query.username.trim() : ""
  const rows = username ? await service.listForUser(username) : await service.listAll()
  res.json({ subscriptions: rows.map(publicShape) })
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AdminPushModuleService>(ADMIN_PUSH_MODULE)
  try {
    const input = validateSubscriptionInput(req.body)
    const row = await service.upsertByEndpoint(input)
    res.json({ subscription: publicShape(row) })
  } catch (err) {
    if (err instanceof MedusaError && err.type === MedusaError.Types.INVALID_DATA) {
      res.status(400).json({ message: err.message })
      return
    }
    throw err
  }
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AdminPushModuleService>(ADMIN_PUSH_MODULE)
  const query = req.query as Record<string, unknown>
  const endpoint = typeof query.endpoint === "string" ? query.endpoint.trim() : ""
  if (!endpoint) {
    res.status(400).json({ message: "endpoint query parameter is required" })
    return
  }
  const deleted = await service.removeByEndpoint(endpoint)
  res.json({ deleted })
}
