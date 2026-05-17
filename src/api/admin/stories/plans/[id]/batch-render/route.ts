import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  batchRenderPlan,
  summarizeBatch,
} from "../../../../../../modules/stories-render/batch"

type BatchBody = { force?: boolean }

const planLocks = new Set<string>()

/**
 * HTTP wrapper around batchRenderPlan: enforces a plan-level lock so the
 * same plan can't be batch-rendered twice in parallel, then delegates the
 * loop to the shared lib so the daily auto-plan cron uses the same logic.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const planId = req.params.id
  const body = (req.body ?? {}) as BatchBody
  const force = body.force === true

  if (planLocks.has(planId)) {
    res.status(409).json({ message: "Batch render already in progress for this plan" })
    return
  }
  planLocks.add(planId)

  try {
    const results = await batchRenderPlan(req.scope, planId, { force })
    const summary = summarizeBatch(results)
    res.status(200).json({ plan_id: planId, summary, results })
  } catch (err) {
    const e = err as Error
    if (/not found/i.test(e.message ?? "")) {
      res.status(404).json({ message: e.message })
      return
    }
    console.error("[batch-render] unexpected error", err)
    res.status(500).json({ message: e.message ?? "Batch render failed" })
  } finally {
    planLocks.delete(planId)
  }
}
