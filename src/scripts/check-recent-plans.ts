import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

export default async function checkRecentPlans({
  container,
}: {
  container: MedusaContainer
}): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const stories = container.resolve<StoriesModuleService>(STORIES_MODULE)

  const plans = await stories.listStoryPlans(
    {},
    { take: 10, order: { plan_date: "DESC" } } as any,
  )

  if (plans.length === 0) {
    logger.info("[check] no story_plan rows at all")
    return
  }

  for (const p of plans) {
    const slots = await stories.listStorySlots(
      { plan_id: p.id } as any,
      { take: 100 } as any,
    )
    const rendered = slots.filter((s: any) => s.video_url).length
    const posted = slots.filter((s: any) => s.posted_at).length
    logger.info(
      `[check] plan_date=${p.plan_date} id=${p.id} status=${p.status} slots=${slots.length} rendered=${rendered} posted=${posted} created=${p.created_at}`,
    )
  }
}
