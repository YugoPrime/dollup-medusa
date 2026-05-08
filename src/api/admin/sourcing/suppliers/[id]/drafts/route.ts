import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  const includeArchived = req.query.archived === "1"
  const drafts = await service.listDraftsForSupplier(req.params.id, {
    includeArchived,
  })
  res.json({ drafts })
}
