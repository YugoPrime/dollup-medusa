import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"

type Incoming = { color: string | null; size: string; qty: number }

function logError(
  req: AuthenticatedMedusaRequest,
  context: string,
  err: Error,
): void {
  try {
    const logger = req.scope.resolve<{
      error: (msg: string, meta?: unknown) => void
    }>("logger")
    logger.error(`${context}: ${err.message}`, { stack: err.stack })
  } catch {
    // best-effort
  }
}

export const PUT = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const body = (req.body ?? {}) as { variants?: unknown }
    if (!Array.isArray(body.variants)) {
      return res.status(400).json({ message: "variants must be an array" })
    }
    const variants: Incoming[] = body.variants.map((raw) => {
      const v = raw as Record<string, unknown>
      return {
        color:
          v.color === undefined || v.color === null || v.color === ""
            ? null
            : String(v.color),
        size: String(v.size ?? ""),
        qty: Number(v.qty),
      }
    })
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    await service.replaceVariants(req.params.id, variants)
    const persisted = await service.listVariants(req.params.id)
    res.json({ variants: persisted })
  } catch (err) {
    const e = err as Error
    logError(req, `PUT /admin/sourcing/items/${req.params.id}/variants`, e)
    res.status(400).json({ message: e.message ?? "Failed to replace variants" })
  }
}
