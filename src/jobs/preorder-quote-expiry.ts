import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PREORDER_MODULE } from "../modules/preorder"
import type PreorderModuleService from "../modules/preorder/service"

/** Hourly: mark unreserved quote requests past their 48h TTL as expired. */
export default async function preorderQuoteExpiry(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc = container.resolve<PreorderModuleService>(PREORDER_MODULE)
  const n = await svc.expireOldRequests()
  if (n > 0) logger.info(`[preorder-quote-expiry] expired ${n} request(s)`)
}

export const config = {
  name: "preorder-quote-expiry",
  schedule: "0 * * * *", // hourly
}
