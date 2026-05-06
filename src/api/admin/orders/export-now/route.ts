import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { runExport } from "../../../../jobs/export-orders-csv"

/**
 * On-demand trigger for the nightly orders CSV → Drive export.
 *
 * Useful for:
 *   - smoke-testing the export pipeline after deploying / rotating the SA key
 *   - producing an extra backup before risky operations
 *   - re-running after fixing a bad metadata value
 *
 * Same logic as the scheduled job — overwrites today's file if it already
 * exists in the Drive folder.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info("[export-orders-csv] manual trigger via /admin/orders/export-now")
  try {
    const result = await runExport(req.scope)
    if (result.ok) {
      res.json(result)
    } else {
      res.status(500).json(result)
    }
  } catch (err) {
    const msg = (err as Error).message || "unknown error"
    logger.error(`[export-orders-csv] manual trigger failed: ${msg}`)
    res.status(500).json({ ok: false, error: msg })
  }
}
