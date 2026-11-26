import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"

import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"

/**
 * GET /store/loyalty/settings
 *
 * Public Doll Rewards rules for the storefront copy (/loyalty, home teaser),
 * so the page always states the rate that is live. No customer auth; the
 * publishable key is required like every /store route.
 */
export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const loyalty = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const s = await loyalty.getSettings()
  res.setHeader("Cache-Control", "public, max-age=300")
  res.json({
    settings: {
      earn_rate_per_100_mur: s.earn_rate_per_100_mur,
      redeem_rate_mur_per_100_pts: s.redeem_rate_mur_per_100_pts,
      min_redeem_points: s.min_redeem_points,
      welcome_bonus_points: s.welcome_bonus_points,
    },
  })
}
