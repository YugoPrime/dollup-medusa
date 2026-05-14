import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SIZE_REQUESTS_MODULE } from "../../../../modules/size-requests"
import type SizeRequestsModuleService from "../../../../modules/size-requests/service"

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const id = req.params.id
  if (!id || typeof id !== "string") {
    res.status(400).json({ message: "Missing size request id" })
    return
  }

  const service = req.scope.resolve<SizeRequestsModuleService>(
    SIZE_REQUESTS_MODULE,
  )
  try {
    await service.deleteSizeRequestById(id)
    res.json({ id, deleted: true })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to delete size request",
    })
  }
}
