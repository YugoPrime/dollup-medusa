/**
 * One-off diagnostic: for every plan in the lookahead window, report
 * which slots have products with `metadata.cutout_image_url` set and
 * which do not. Pinpoints why "no cutout templates were picked" — is it
 * because no picked product has a cutout PNG, or because of a picker bug?
 *
 * Run: yarn medusa exec ./src/scripts/diag-cutout-coverage.ts
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { mauritiusToday, addDaysToMauritiusDate } from "../lib/mauritius-date"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

const LOOKAHEAD_DAYS = 3

function toIsoDate(value: unknown): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10)
}

export default async function diagCutoutCoverage({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const stories = container.resolve<StoriesModuleService>(STORIES_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const today = mauritiusToday()
  const horizon = addDaysToMauritiusDate(today, LOOKAHEAD_DAYS)

  const allPlans = await stories.listStoryPlans({} as any, { take: 200 })
  const planDates = new Set<string>()
  for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
    planDates.add(addDaysToMauritiusDate(today, i))
  }

  const upcoming = allPlans
    .filter((p) => {
      const pd = toIsoDate(p.plan_date)
      return planDates.has(pd)
    })
    .sort((a, b) => String(a.plan_date).localeCompare(String(b.plan_date)))

  if (upcoming.length === 0) {
    logger.info(`[diag-cutout] no plans in ${today}..${horizon}`)
    return
  }

  for (const plan of upcoming) {
    const planDate = toIsoDate(plan.plan_date)
    const slots = await stories.listStorySlots({ plan_id: plan.id })
    const productIds = slots
      .map((s) => s.product_id)
      .filter((id): id is string => Boolean(id))

    if (productIds.length === 0) {
      logger.info(`[diag-cutout] plan ${planDate}: no products in slots`)
      continue
    }

    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "handle", "metadata"],
      filters: { id: productIds },
    })

    const cutoutMap = new Map<string, string | null>()
    for (const p of products as any[]) {
      const md = (p.metadata ?? null) as Record<string, unknown> | null
      const url =
        typeof md?.cutout_image_url === "string" && md.cutout_image_url
          ? md.cutout_image_url
          : null
      cutoutMap.set(p.id, url)
    }

    let withCutout = 0
    let withoutCutout = 0
    let singleColorWithCutout = 0
    const lines: string[] = []
    for (const slot of slots) {
      if (!slot.product_id) continue
      const url = cutoutMap.get(slot.product_id) ?? null
      const snap = (slot.product_snapshot as any) ?? {}
      const name = snap.name ?? slot.product_id
      const colorCount = (snap.variants_in_stock ?? []).length
      const isSingle = colorCount === 1
      if (url) {
        withCutout++
        if (isSingle) {
          singleColorWithCutout++
          lines.push(
            `    idx=${slot.slot_index} ${name} ✓ cutout (${colorCount}c, ELIGIBLE)`,
          )
        } else {
          lines.push(
            `    idx=${slot.slot_index} ${name} ◯ cutout (${colorCount}c, multi-color → cutout SKIPPED per 2026-05-26 policy)`,
          )
        }
      } else {
        withoutCutout++
        lines.push(
          `    idx=${slot.slot_index} ${name} ✗ no cutout PNG (${colorCount}c)`,
        )
      }
    }

    logger.info(
      `[diag-cutout] plan ${planDate}: ${withCutout}/${withCutout + withoutCutout} slots have cutout PNG; ${singleColorWithCutout} are single-color (eligible under 2026-05-26 policy)`,
    )
    for (const l of lines) logger.info(l)
  }
}
