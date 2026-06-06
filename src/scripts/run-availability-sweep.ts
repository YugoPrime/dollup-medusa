import type { ExecArgs } from "@medusajs/framework/types"
import preorderAvailabilityCheck from "../jobs/preorder-availability-check"

/** Laptop-run daily SHEIN availability sweep (browser-based). */
export default async function runAvailabilitySweep({ container }: ExecArgs) {
  process.env.AVAILABILITY_SWEEP_ENABLED = "true"
  await preorderAvailabilityCheck(container)
}
