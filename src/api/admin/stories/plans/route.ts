import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../../modules/stories"
import type StoriesModuleService from "../../../../modules/stories/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const from = (req.query.from as string) ?? undefined
  const to = (req.query.to as string) ?? undefined
  const where: Record<string, unknown> = {}
  if (from && to) where.plan_date = { $gte: from, $lte: to }
  const plans = await service.listStoryPlans(where, { take: 100, order: { plan_date: "ASC" } })
  res.json({ plans })
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const plan_date = String(body.plan_date ?? "")
  const category_distribution = Array.isArray(body.category_distribution)
    ? (body.category_distribution as Array<{ category_id: string; count: number }>)
    : []
  const scheduled_times = Array.isArray(body.scheduled_times)
    ? (body.scheduled_times as string[])
    : []
  const notes = typeof body.notes === "string" ? body.notes : null

  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  try {
    const plan = await service.createPlan({
      plan_date,
      category_distribution,
      scheduled_times,
      notes,
    })
    res.status(201).json({ plan })
  } catch (err) {
    res.status(400).json({ message: (err as Error)?.message ?? "Create failed" })
  }
}
