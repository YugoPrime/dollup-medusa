/**
 * Manual one-shot wrapper for preorder-availability-check.ts. Triggers the
 * same logic the cron will run nightly, but you control the timing.
 *
 * Run: yarn medusa exec ./src/scripts/run-availability-check-now.ts
 */
import { ExecArgs } from "@medusajs/framework/types"

import preorderAvailabilityCheck from "../jobs/preorder-availability-check"

export default async function runNow({ container }: ExecArgs) {
  await preorderAvailabilityCheck(container)
}
