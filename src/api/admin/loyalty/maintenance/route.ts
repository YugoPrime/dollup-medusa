import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  findGuestPointRows,
  findUnreversedCanceledEarns,
  moveGuestPoints,
  reverseCanceled,
  type PgRaw,
} from "../../../../lib/loyalty-maintenance"
import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"

const JOBS = ["reverse-canceled", "merge-guest-points"] as const
type Job = (typeof JOBS)[number]

/**
 * POST /admin/loyalty/maintenance
 * body: { job: "reverse-canceled" | "merge-guest-points", apply?: boolean }
 *
 * One-off Doll Rewards clean-ups of the past. Dry run unless apply === true:
 * a dry run only counts. Both jobs are safe to repeat (a second apply finds
 * nothing left to do).
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { job?: unknown; apply?: unknown }
  const job = body.job as Job
  if (!JOBS.includes(job)) {
    res.status(400).json({ message: `job must be one of: ${JOBS.join(", ")}` })
    return
  }
  const apply = body.apply === true

  const pg = req.scope.resolve<PgRaw>(ContainerRegistrationKeys.PG_CONNECTION)
  const loyalty = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)

  const rows =
    job === "reverse-canceled"
      ? await findUnreversedCanceledEarns(pg)
      : await findGuestPointRows(pg)
  const points = rows.reduce((sum, row) => sum + row.points, 0)

  let result: unknown = undefined
  if (apply) {
    result =
      job === "reverse-canceled"
        ? await reverseCanceled(loyalty, rows as Awaited<ReturnType<typeof findUnreversedCanceledEarns>>)
        : await moveGuestPoints(loyalty, rows as Awaited<ReturnType<typeof findGuestPointRows>>)
  }

  res.json({ job, apply, rows: rows.length, points, sample: rows.slice(0, 10), result })
}
