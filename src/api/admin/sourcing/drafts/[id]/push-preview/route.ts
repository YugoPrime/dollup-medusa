import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"
import { getNextRef } from "../../../../../../modules/sourcing/lib/ref-allocator"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const id = String(req.params.id)
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const validation = await service.validateForPush(id)
    let nextRef: string | null = null
    try {
      const manager = req.scope.resolve(ContainerRegistrationKeys.MANAGER)
      nextRef = await getNextRef({
        execute: async (sql: string) => {
          const r = await (
            manager as unknown as {
              execute: (
                s: string,
              ) => Promise<{ rows?: unknown[] } | unknown[]>
            }
          ).execute(sql)
          const rows = (r as { rows?: unknown[] }).rows ?? (r as unknown[])
          return { rows: rows as Array<{ max: number | string | null }> }
        },
      })
    } catch {
      // best-effort; UI shows '?' if preview fails
    }
    res.json({ validation, next_ref_preview: nextRef })
  } catch (err) {
    const e = err as Error
    req.scope
      .resolve<{ error: (msg: string, meta?: unknown) => void }>("logger")
      .error(`GET push-preview ${req.params.id} failed: ${e.message}`, {
        stack: e.stack,
      })
    res.status(400).json({ message: e.message ?? "Failed" })
  }
}
