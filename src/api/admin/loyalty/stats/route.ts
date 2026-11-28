import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import type { PgRaw } from "../../../../lib/loyalty-maintenance"
import { getLoyaltyStats } from "../../../../lib/loyalty-stats"
import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"

/**
 * GET /admin/loyalty/stats
 *
 * Read-only Doll Rewards numbers for dollup-admin /reports/rewards.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const pg = req.scope.resolve<PgRaw>(ContainerRegistrationKeys.PG_CONNECTION)
  const loyalty = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const settings = await loyalty.getSettings()
  const stats = await getLoyaltyStats(pg, settings)
  res.json({ stats })
}
