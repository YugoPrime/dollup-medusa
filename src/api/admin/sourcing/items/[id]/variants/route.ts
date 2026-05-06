import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"

type Incoming = { color: string | null; size: string; qty: number }

export const PUT = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
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
  try {
    await service.replaceVariants(req.params.id, variants)
    const persisted = await service.listVariants(req.params.id)
    res.json({ variants: persisted })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Failed to replace variants",
    })
  }
}
