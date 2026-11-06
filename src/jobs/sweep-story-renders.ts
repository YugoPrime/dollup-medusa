import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { sendTelegram } from "../lib/telegram"
import { listUpcomingPlans } from "../lib/upcoming-story-plans"
import { createCloudDeps } from "../modules/stories-render/cloud/dispatch"
import { resolveRenderMode } from "../modules/stories-render/cloud/mode"
import { sweepCloudRenders } from "../modules/stories-render/cloud/sweep"

const ADMIN_URL = process.env.ADMIN_URL ?? "https://api.dollupboutique.com/app"
const LOOKAHEAD_DAYS = 7

/**
 * Cloud-mode safety net, every 5 minutes: reconciles jobs whose callback never
 * arrived, re-dispatches slots that need it, and sends one Telegram summary per
 * plan once its renders have settled. No-op unless STORIES_RENDER_MODE=cloud.
 */
export default async function sweepStoryRenders(
  container: MedusaContainer,
): Promise<void> {
  if (resolveRenderMode() !== "cloud") return
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const deps = createCloudDeps(container)
    const summary = await sweepCloudRenders({
      ...deps,
      telegram: (html) => sendTelegram(html),
      upcomingPlans: () => listUpcomingPlans(deps.stories, LOOKAHEAD_DAYS),
      adminUrl: ADMIN_URL,
    })
    // Quiet ticks (most of them) log nothing.
    if (summary.reconciled + summary.dispatched + summary.summaries > 0) {
      logger.info(
        `[story-sweep] reconciled ${summary.reconciled}, dispatched ${summary.dispatched}, summaries ${summary.summaries}`,
      )
    }
  } catch (err) {
    logger.error(
      `[story-sweep] failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export const config = {
  name: "sweep-story-renders",
  // Every 5 minutes from minute 2: never minute 0, when create-tomorrow-plan
  // runs (14:00 UTC) and dispatches the same plan.
  schedule: "2-59/5 * * * *",
}
